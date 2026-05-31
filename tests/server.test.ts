import Database from 'better-sqlite3';
import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { setDb, closeDb } from '../src/main/db';
import { initQueues } from '../src/main/queue';
import { createExpressApp } from '../src/main/server';
import type { Config } from '../src/main/config';

vi.mock('../src/main/order-check', () => ({
  checkOrder: vi.fn().mockResolvedValue('ready'),
}));

vi.mock('../src/main/events', () => ({
  registerWsClient: vi.fn(),
  broadcast: vi.fn(),
  broadcastQueueState: vi.fn(),
}));

vi.mock('../src/main/printer', () => ({
  printTicket: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/main/tts', () => ({
  announceNumber: vi.fn(),
  isTtsAvailable: vi.fn().mockReturnValue(false),
}));

const Q_NORMAL = { id: 1, name: 'Cassa', description: '', type: 'normal' as const };
const Q_ORDER  = { id: 2, name: 'Ritiro', description: '', type: 'order_pickup' as const, orderCheckUrl: 'https://example.com/orders' };
const Q_NO_URL = { id: 3, name: 'Senza URL', description: '', type: 'order_pickup' as const };

const baseConfig: Config = {
  queues: [Q_NORMAL, Q_ORDER, Q_NO_URL],
  displays: { kioskDisplayId: null, displayDisplayId: null },
  printerPath: '/dev/null',
  adminToken: 'test-token',
  brandColor: '#000',
  slidesDir: '/tmp',
  slideshowIntervalMs: 10000,
  openTime: '00:00',
  closeTime: '23:59',
  resetTime: '09:00',
  lastReset: '',
  ttsEnabled: false,
  ttsLanguage: 'it',
  language: 'it',
};

let app: ReturnType<typeof createExpressApp>;

beforeEach(() => {
  setDb(new Database(':memory:'));
  initQueues([Q_NORMAL, Q_ORDER, Q_NO_URL]);
  app = createExpressApp(baseConfig);
});

afterEach(() => {
  closeDb();
  vi.clearAllMocks();
});

// ── POST /api/check-order (SSRF remediation) ────────────────────────────────

describe('POST /api/check-order', () => {
  it('returns 400 when queueId is missing', async () => {
    const res = await request(app).post('/api/check-order').send({ orderNumber: '123' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/required/i);
  });

  it('returns 400 when orderNumber is missing', async () => {
    const res = await request(app).post('/api/check-order').send({ queueId: 2 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/required/i);
  });

  it('returns 404 when queueId does not exist', async () => {
    const res = await request(app).post('/api/check-order').send({ queueId: 999, orderNumber: '42' });
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it('returns 400 when queue has no orderCheckUrl configured', async () => {
    const res = await request(app).post('/api/check-order').send({ queueId: Q_NO_URL.id, orderNumber: '42' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/order check url/i);
  });

  it('does not accept a URL from the client body (SSRF guard)', async () => {
    const { checkOrder } = await import('../src/main/order-check');
    const res = await request(app).post('/api/check-order').send({
      queueId: Q_ORDER.id,
      orderNumber: '42',
      orderCheckUrl: 'http://169.254.169.254/latest/meta-data/',
    });
    expect(res.status).toBe(200);
    expect(checkOrder).toHaveBeenCalledWith(Q_ORDER.orderCheckUrl, '42');
    expect(checkOrder).not.toHaveBeenCalledWith('http://169.254.169.254/latest/meta-data/', expect.any(String));
  });

  it('calls checkOrder with the configured queue URL on success', async () => {
    const { checkOrder } = await import('../src/main/order-check');
    const res = await request(app).post('/api/check-order').send({ queueId: Q_ORDER.id, orderNumber: '42' });
    expect(res.status).toBe(200);
    expect(res.body.result).toBe('ready');
    expect(checkOrder).toHaveBeenCalledWith('https://example.com/orders', '42');
  });
});
