import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import fs from 'fs';
import qrcode from 'qrcode';
import type { Config } from './config';
import { logError } from './config';
import {
  getAllQueues, getQueue, callNext, resetQueue, issueTicket,
  estimatedWaitSeconds, getTicketPosition, getQueueStatus,
} from './queue';
import { registerWsClient, broadcast, broadcastQueueState } from './events';
import { checkOrder } from './order-check';

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

  // ── Static HTML pages ──────────────────────────────────────────────────────

  app.get('/admin', (_req, res) => {
    if (!isBusinessHours(config)) {
      return res.sendFile(path.join(SERVER_HTML, 'siamo-chiusi.html'));
    }
    res.sendFile(path.join(SERVER_HTML, 'admin.html'));
  });

  app.get('/wait/:ticketId', (req, res) => {
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
      const number = callNext(Number(req.params.id), 'api');
      const status = getQueueStatus();
      const qs = status.find(s => s.queue.id === Number(req.params.id));
      broadcast({ type: 'call', queueId: Number(req.params.id), number, calledBy: 'api' });
      if (qs) broadcastQueueState(qs.queue.id, qs.lastCalled, qs.waiting);
      res.json({ number });
    } catch (err: any) {
      if (err?.message === 'EMPTY_QUEUE') return res.status(409).json({ error: 'Nessun cliente in attesa' });
      logError(`callNext API error: ${err?.message}`);
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
    const pos = getTicketPosition(Number(req.params.ticketId));
    if (!pos) return res.status(404).json({ error: 'Ticket not found' });
    const eta = estimatedWaitSeconds(pos.queueId);
    res.json({ ...pos, eta });
  });

  app.post('/api/issue', auth, async (req, res) => {
    const { queueId } = req.body;
    if (!queueId) return res.status(400).json({ error: 'queueId required' });
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
    const { orderCheckUrl, orderNumber } = req.body;
    if (!orderCheckUrl || !orderNumber) {
      return res.status(400).json({ error: 'orderCheckUrl and orderNumber required' });
    }
    const result = await checkOrder(orderCheckUrl, String(orderNumber));
    res.json({ result });
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
