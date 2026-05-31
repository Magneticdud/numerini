import { app, ipcMain } from 'electron';
import { loadConfig, configExists, logError } from './config';
import { getDb, closeDb } from './db';
import { initQueues, issueTicket, callNext, resetQueue, getQueueStatus, estimatedWaitSeconds, getQueue } from './queue';
import { createExpressApp, startHttpServer } from './server';
import { createWindows, openAssignmentWizard } from './display-manager';
import { startScheduler, stopScheduler } from './scheduler';
import { announceNumber, isTtsAvailable } from './tts';
import { printTicket } from './printer';
import { broadcast, broadcastQueueState } from './events';

app.commandLine.appendSwitch('no-sandbox');
// Target X11 explicitly for kiosk mode
process.env.ELECTRON_OZONE_PLATFORM_HINT = 'x11';

async function main(): Promise<void> {
  await app.whenReady();

  const config = loadConfig();

  // Initialize DB and queues
  getDb();
  initQueues(config.queues);

  // Start HTTP server
  const expressApp = createExpressApp(config);
  const { server, wss } = startHttpServer(expressApp, config.adminToken);

  // Start scheduler
  startScheduler();

  // Open windows (wizard if not configured)
  createWindows(config);

  // ── IPC handlers ─────────────────────────────────────────────────────────

  ipcMain.handle('get-config', () => loadConfig());

  ipcMain.handle('get-queues', () => getQueueStatus().map(s => ({
    id: s.queue.id,
    name: s.queue.name,
    description: s.queue.description,
    type: s.queue.type,
    orderCheckUrl: s.queue.orderCheckUrl,
    currentNumber: s.queue.currentNumber,
    lastCalled: s.lastCalled,
    waiting: s.waiting,
    eta: estimatedWaitSeconds(s.queue.id),
  })));

  ipcMain.handle('issue-ticket', async (_event, queueId: number) => {
    try {
      const ticket = issueTicket(queueId);
      const status = getQueueStatus();
      const qs = status.find(s => s.queue.id === queueId);
      if (qs) broadcastQueueState(qs.queue.id, qs.lastCalled, qs.waiting);

      // Print
      const queue = config.queues.find(q => q.id === queueId);
      printTicket(config.printerPath, {
        shopName: 'Il Negozio',
        queueName: queue?.name ?? 'Coda',
        number: ticket.number,
      }).catch(err => logError(`Print error: ${err.message}`));

      return { ok: true, ticket };
    } catch (err: any) {
      logError(`issue-ticket IPC error: ${err.message}`);
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('call-next', async (_event, queueId: number) => {
    try {
      const number = callNext(queueId, 'operator');
      const status = getQueueStatus();
      const qs = status.find(s => s.queue.id === queueId);
      const queue = config.queues.find(q => q.id === queueId);

      broadcast({ type: 'call', queueId, number, calledBy: 'operator' });
      if (qs) broadcastQueueState(qs.queue.id, qs.lastCalled, qs.waiting);

      if (config.ttsEnabled && isTtsAvailable()) {
        announceNumber(number, queue?.name ?? '', config.ttsLanguage);
      }

      return { ok: true, number };
    } catch (err: any) {
      if (err.message === 'EMPTY_QUEUE') return { ok: false, error: 'EMPTY_QUEUE' };
      logError(`call-next IPC error: ${err.message}`);
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('reset-queue', async (_event, queueId: number) => {
    try {
      resetQueue(queueId);
      broadcast({ type: 'reset', queueId });
      const status = getQueueStatus();
      const qs = status.find(s => s.queue.id === queueId);
      if (qs) broadcastQueueState(qs.queue.id, qs.lastCalled, qs.waiting);
      return { ok: true };
    } catch (err: any) {
      logError(`reset-queue IPC error: ${err.message}`);
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('check-order', async (_event, { queueId, orderNumber }: { queueId: number; orderNumber: string }) => {
    const { checkOrder } = await import('./order-check');
    const queue = getQueue(Number(queueId));
    if (!queue?.orderCheckUrl) return 'error';
    return checkOrder(queue.orderCheckUrl, orderNumber);
  });

  // ── Cleanup ───────────────────────────────────────────────────────────────

  app.on('before-quit', () => {
    stopScheduler();
    server.close();
    closeDb();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}

main().catch(err => {
  logError(`Fatal: ${err.message}`);
  process.exit(1);
});
