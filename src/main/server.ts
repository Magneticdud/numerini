import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import fs from 'fs';
import qrcode from 'qrcode';
import rateLimit from 'express-rate-limit';
import type { Config } from './config';
import { logError } from './config';
import {
  getAllQueues, getQueue, callNext, resetQueue, issueTicket,
  estimatedWaitSeconds, getTicketPosition, getQueueStatus, transferTicket,
  getTransferNewTicketId,
} from './queue';
import { registerWsClient, broadcast, broadcastQueueState } from './events';
import { checkOrder } from './order-check';
import { printTicket } from './printer';

const SERVER_HTML = path.resolve(__dirname, '../../dist/server');

function isBusinessHours(config: Config): boolean {
  const now = new Date();
  const [oh, om] = config.openTime.split(':').map(Number);
  const [ch, cm] = config.closeTime.split(':').map(Number);
  const openMin  = oh * 60 + om;
  const closeMin = ch * 60 + cm;
  const nowMin   = now.getHours() * 60 + now.getMinutes();
  return nowMin >= openMin && nowMin < closeMin;
}

function authMiddleware(adminToken: string) {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const auth = req.headers['authorization'] ?? '';
    if (auth === `Bearer ${adminToken}`) return next();
    res.status(401).json({ error: 'Unauthorized' });
  };
}

export function createExpressApp(config: Config, tunnelUrl?: string): ReturnType<typeof express> {
  const app = express();
  app.use(express.json());

  // CSP on all responses
  app.use((_req, res, next) => {
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws: wss:;");
    next();
  });

  const auth = authMiddleware(config.adminToken);

  const pageRateLimit = rateLimit({ windowMs: 60_000, max: 60, standardHeaders: true, legacyHeaders: false });

  // ── Static HTML pages ──────────────────────────────────────────────────────

  app.get('/admin', pageRateLimit, (_req, res) => {
    if (!isBusinessHours(config)) {
      return res.sendFile(path.join(SERVER_HTML, 'siamo-chiusi.html'));
    }
    res.sendFile(path.join(SERVER_HTML, 'admin.html'));
  });

  app.get('/wait/:ticketId', pageRateLimit, (req, res) => {
    if (!isBusinessHours(config)) {
      return res.sendFile(path.join(SERVER_HTML, 'siamo-chiusi.html'));
    }
    res.sendFile(path.join(SERVER_HTML, 'wait.html'));
  });

  // ── REST API ────────────────────────────────────────────────────────────────

  app.get('/api/status', (_req, res) => {
    res.json({
      ok: true,
      version: '0.1.0',
      businessHours: isBusinessHours(config),
      queues: getQueueStatus().map(s => ({
        id: s.queue.id,
        name: s.queue.name,
        lastCalled: s.lastCalled,
        waiting: s.waiting,
      })),
    });
  });

  app.get('/api/queues', (_req, res) => {
    res.json(getAllQueues());
  });

  app.get('/api/queues/:id', (req, res) => {
    const queue = getQueue(Number(req.params.id));
    if (!queue) return res.status(404).json({ error: 'Not found' });
    res.json(queue);
  });

  app.post('/api/queues/:id/next', auth, (req, res) => {
    try {
      const ticket = callNext(Number(req.params.id), 'api');
      const status = getQueueStatus();
      const qs = status.find(s => s.queue.id === Number(req.params.id));
      broadcast({ type: 'call', queueId: ticket.queueId, number: ticket.number, suffix: ticket.suffix, calledBy: 'api' });
      if (qs) broadcastQueueState(qs.queue.id, qs.lastCalled, qs.waiting);
      res.json({ ticket_id: ticket.id, number: ticket.number, suffix: ticket.suffix, display: String(ticket.number).padStart(3, '0') + (ticket.suffix ?? '') });
    } catch (err: any) {
      if (err?.message === 'EMPTY_QUEUE') return res.status(409).json({ error: 'Nessun cliente in attesa' });
      logError(`callNext API error: ${err?.message}`);
      res.status(500).json({ error: 'Internal error' });
    }
  });

  app.post('/api/tickets/:id/transfer', auth, (req, res) => {
    const ticketId = Number(req.params.id);
    const { target_queue_id, print = true } = req.body ?? {};
    if (!target_queue_id) return res.status(400).json({ error: 'target_queue_id required' });
    try {
      const result = transferTicket(ticketId, Number(target_queue_id));
      const { newTicket } = result;

      // Broadcast transfer event to display, admin, and the wait client
      // that was tracking the original ticket (so /wait can redirect).
      broadcast({
        type: 'ticket:transferred',
        queueId: newTicket.queueId,
        newTicketId: newTicket.id,
        number: newTicket.number,
        suffix: newTicket.suffix,
        originalTicketId: result.originalTicketId,
      });

      // Update badge counters on both affected queues using fromQueueId from the result
      const status = getQueueStatus();
      const srcQueue = status.find(s => s.queue.id === result.fromQueueId);
      const tgtQueue = status.find(s => s.queue.id === newTicket.queueId);
      if (srcQueue) broadcastQueueState(srcQueue.queue.id, srcQueue.lastCalled, srcQueue.waiting);
      if (tgtQueue) broadcastQueueState(tgtQueue.queue.id, tgtQueue.lastCalled, tgtQueue.waiting);

      let waitUrl: string | undefined;
      if (tunnelUrl) {
        waitUrl = `${tunnelUrl.replace(/\/$/, '')}/wait/${newTicket.id}`;
      }

      const displayLabel = String(newTicket.number).padStart(3, '0') + (newTicket.suffix ?? '');
      res.json({
        new_ticket: { ...newTicket, display: displayLabel },
        original_ticket_id: result.originalTicketId,
        transfer_id: result.transferId,
        wait_url: waitUrl,
      });

      // Print the new transfer receipt if requested (default: true).
      // Fire-and-forget: transfer is already committed; print failure doesn't roll it back.
      if (print) {
        const queueCfg = config.queues.find(q => q.id === newTicket.queueId);
        printTicket(config.printerPath, {
          shopName: 'Numerini',
          queueName: queueCfg?.name ?? '',
          ticketLabel: displayLabel,
          advisory: 'Numero trasferito.\nIl tuo posto è garantito.',
          waitUrl,
        }).catch(err => logError(`Transfer print error: ${err.message}`));
      }
    } catch (err: any) {
      const knownErrors: Record<string, [number, string]> = {
        TICKET_NOT_FOUND:       [404, 'Ticket non trovato'],
        TICKET_NOT_TRANSFERABLE:[400, 'Il ticket non è trasferibile (già completato o trasferito)'],
        SELF_TRANSFER:          [400, 'Coda di destinazione uguale alla coda sorgente'],
        TARGET_QUEUE_NOT_FOUND: [404, 'Coda di destinazione non trovata'],
      };
      const mapped = knownErrors[err?.message];
      if (mapped) return res.status(mapped[0]).json({ error: mapped[1] });
      logError(`transfer API error: ${err?.message}`);
      res.status(500).json({ error: 'Internal error' });
    }
  });

  app.post('/api/queues/:id/reset', auth, (req, res) => {
    try {
      resetQueue(Number(req.params.id));
      broadcast({ type: 'reset', queueId: Number(req.params.id) });
      res.json({ ok: true });
    } catch (err: any) {
      logError(`reset API error: ${err?.message}`);
      res.status(500).json({ error: 'Internal error' });
    }
  });

  app.put('/api/queues/:id', auth, (req, res) => {
    // Queue config changes require a restart to take effect — for now return 501
    res.status(501).json({ error: 'Queue config changes require restart' });
  });

  app.get('/api/ticket/:ticketId/status', (req, res) => {
    const ticketId = Number(req.params.ticketId);
    const pos = getTicketPosition(ticketId);
    if (!pos) return res.status(404).json({ error: 'Ticket not found' });
    const eta = estimatedWaitSeconds(pos.queueId);
    const response: Record<string, unknown> = { ...pos, eta };
    // When transferred, include new ticket ID so the /wait page can redirect
    if (pos.status === 'transferred') {
      const newId = getTransferNewTicketId(ticketId);
      if (newId) response.new_ticket_id = newId;
    }
    res.json(response);
  });

  app.post('/api/issue', auth, async (req, res) => {
    const { queueId } = req.body;
    if (queueId == null) return res.status(400).json({ error: 'queueId required' });
    try {
      const ticket = issueTicket(Number(queueId));
      const status = getQueueStatus();
      const qs = status.find(s => s.queue.id === ticket.queueId);
      if (qs) broadcastQueueState(qs.queue.id, qs.lastCalled, qs.waiting);

      let waitUrl: string | undefined;
      if (tunnelUrl) {
        waitUrl = `${tunnelUrl.replace(/\/$/, '')}/wait/${ticket.id}`;
      }

      res.json({ ticket, waitUrl });
    } catch (err: any) {
      logError(`issue API error: ${err?.message}`);
      res.status(500).json({ error: 'Internal error' });
    }
  });

  app.post('/api/check-order', async (req, res) => {
    const { queueId, orderNumber } = req.body;
    if (queueId == null || !orderNumber) {
      return res.status(400).json({ error: 'queueId and orderNumber required' });
    }
    const queue = getQueue(Number(queueId));
    if (!queue) return res.status(404).json({ error: 'Queue not found' });
    if (!queue.orderCheckUrl) return res.status(400).json({ error: 'No order check URL configured for this queue' });
    try {
      const result = await checkOrder(queue.orderCheckUrl, String(orderNumber));
      res.json({ result });
    } catch (err: any) {
      logError(`check-order API error: ${err?.message}`);
      res.status(500).json({ error: 'Internal error' });
    }
  });

  return app;
}

export function startHttpServer(app: ReturnType<typeof express>, adminToken: string): { server: ReturnType<typeof createServer>; wss: WebSocketServer } {
  const server = createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws: WebSocket, req) => {
    const url = new URL(req.url ?? '/', `http://localhost`);
    const role = (url.searchParams.get('role') ?? 'wait') as 'display' | 'admin' | 'wait';
    const ticketId = role === 'wait' ? Number(url.searchParams.get('ticketId')) : undefined;
    const token = url.searchParams.get('token') ?? '';

    registerWsClient(ws, role, { ticketId, token, adminToken });

    // On connect, send current state to admin clients
    if (role === 'admin') {
      const status = getQueueStatus();
      for (const s of status) {
        broadcastQueueState(s.queue.id, s.lastCalled, s.waiting);
      }
    }

    // For wait clients, send current position immediately
    if (role === 'wait' && ticketId) {
      const pos = getTicketPosition(ticketId);
      if (pos) {
        const eta = estimatedWaitSeconds(pos.queueId);
        ws.send(JSON.stringify({ type: 'ticket_status', ticketId, position: pos.position, eta }));
      }
    }
  });

  server.listen(8080, '0.0.0.0', () => {
    console.log('Numerini server listening on :8080');
  });

  return { server, wss };
}
