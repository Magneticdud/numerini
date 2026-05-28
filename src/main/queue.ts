import { getDb } from './db';
import type { QueueConfig } from './config';

const MAX_QUEUE_NUMBER = 999;

export interface Queue {
  id: number;
  name: string;
  description: string;
  type: 'normal' | 'order_pickup';
  orderCheckUrl?: string;
  currentNumber: number;
  lastCalled: number;
  active: boolean;
}

export interface Ticket {
  id: number;
  queueId: number;
  number: number;
  issuedAt: string;
  status: 'waiting' | 'called' | 'done';
}

export interface CallRecord {
  id: number;
  queueId: number;
  number: number;
  calledAt: string;
  calledBy: string;
}

// ── Queue CRUD ──────────────────────────────────────────────────────────────

export function initQueues(configs: QueueConfig[]): void {
  const db = getDb();
  const existing = db.prepare('SELECT id FROM queues').all() as { id: number }[];
  const existingIds = new Set(existing.map(r => r.id));

  for (const cfg of configs) {
    if (existingIds.has(cfg.id)) {
      db.prepare(`
        UPDATE queues SET name=?, description=?, type=?, order_check_url=? WHERE id=?
      `).run(cfg.name, cfg.description, cfg.type, cfg.orderCheckUrl ?? null, cfg.id);
    } else {
      db.prepare(`
        INSERT INTO queues (id, name, description, type, order_check_url)
        VALUES (?, ?, ?, ?, ?)
      `).run(cfg.id, cfg.name, cfg.description, cfg.type, cfg.orderCheckUrl ?? null);
    }
  }
}

export function getQueue(id: number): Queue | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM queues WHERE id=? AND active=1').get(id) as any;
  return row ? rowToQueue(row) : null;
}

export function getAllQueues(): Queue[] {
  const db = getDb();
  return (db.prepare('SELECT * FROM queues WHERE active=1 ORDER BY id').all() as any[]).map(rowToQueue);
}

// ── Ticket issuance ─────────────────────────────────────────────────────────

export function issueTicket(queueId: number): Ticket {
  const db = getDb();
  const queue = db.prepare('SELECT * FROM queues WHERE id=? AND active=1').get(queueId) as any;
  if (!queue) throw new Error(`Queue ${queueId} not found`);

  const nextNumber = queue.current_number >= MAX_QUEUE_NUMBER ? 1 : queue.current_number + 1;

  const txn = db.transaction(() => {
    db.prepare('UPDATE queues SET current_number=? WHERE id=?').run(nextNumber, queueId);
    // Mark previous ticket for this number as done (wrap case)
    db.prepare(`
      UPDATE tickets SET status='done', called_at=CURRENT_TIMESTAMP
      WHERE queue_id=? AND number=? AND status='waiting'
    `).run(queueId, nextNumber);

    const result = db.prepare(`
      INSERT INTO tickets (queue_id, number, status) VALUES (?, ?, 'waiting')
    `).run(queueId, nextNumber);

    return db.prepare('SELECT * FROM tickets WHERE id=?').get(result.lastInsertRowid) as any;
  });

  const row = txn() as any;
  return rowToTicket(row);
}

// ── Call next ───────────────────────────────────────────────────────────────

export function callNext(queueId: number, calledBy = 'operator'): number {
  const db = getDb();
  const queue = db.prepare('SELECT * FROM queues WHERE id=? AND active=1').get(queueId) as any;
  if (!queue) throw new Error(`Queue ${queueId} not found`);

  const waiting = db.prepare(`
    SELECT number FROM tickets
    WHERE queue_id=? AND status='waiting'
    ORDER BY number ASC LIMIT 1
  `).get(queueId) as { number: number } | undefined;

  if (!waiting) throw new Error('EMPTY_QUEUE');

  const nextCalled = waiting.number;

  const txn = db.transaction(() => {
    // Mark previous called ticket as done
    db.prepare(`
      UPDATE tickets SET status='done', called_at=CURRENT_TIMESTAMP
      WHERE queue_id=? AND status='called'
    `).run(queueId);
    // Mark this one as called
    db.prepare(`
      UPDATE tickets SET status='called', called_at=CURRENT_TIMESTAMP
      WHERE queue_id=? AND number=? AND status='waiting'
    `).run(queueId, nextCalled);
    db.prepare('UPDATE queues SET last_called=? WHERE id=?').run(nextCalled, queueId);
    db.prepare('INSERT INTO calls (queue_id, number, called_by) VALUES (?,?,?)').run(queueId, nextCalled, calledBy);
  });

  txn();
  return nextCalled;
}

// ── Reset ───────────────────────────────────────────────────────────────────

export function resetQueue(queueId: number): void {
  const db = getDb();
  const txn = db.transaction(() => {
    db.prepare('UPDATE queues SET current_number=0, last_called=0 WHERE id=?').run(queueId);
    db.prepare(`UPDATE tickets SET status='done' WHERE queue_id=? AND status IN ('waiting','called')`).run(queueId);
  });
  txn();
}

export function resetAllQueues(): void {
  getAllQueues().forEach(q => resetQueue(q.id));
}

// ── Stats / wait time ───────────────────────────────────────────────────────

export function estimatedWaitSeconds(queueId: number): number | null {
  const db = getDb();
  const recentCalls = db.prepare(`
    SELECT called_at FROM calls
    WHERE queue_id=?
    ORDER BY called_at DESC LIMIT 31
  `).all(queueId) as { called_at: string }[];

  if (recentCalls.length < 11) return null; // need at least 10 intervals

  const intervals: number[] = [];
  for (let i = 0; i < recentCalls.length - 1; i++) {
    const a = new Date(recentCalls[i].called_at).getTime();
    const b = new Date(recentCalls[i + 1].called_at).getTime();
    intervals.push((a - b) / 1000);
  }

  const avg = intervals.slice(0, 30).reduce((s, n) => s + n, 0) / Math.min(intervals.length, 30);
  const queue = getQueue(queueId);
  if (!queue) return null;

  const waiting = (db.prepare(`
    SELECT COUNT(*) as n FROM tickets WHERE queue_id=? AND status='waiting'
  `).get(queueId) as { n: number }).n;

  return Math.round(waiting * avg);
}

export function getTicketPosition(ticketId: number): { position: number; queueId: number; number: number; status: string } | null {
  const db = getDb();
  const ticket = db.prepare('SELECT * FROM tickets WHERE id=?').get(ticketId) as any;
  if (!ticket) return null;

  const position = (db.prepare(`
    SELECT COUNT(*) as n FROM tickets
    WHERE queue_id=? AND number<? AND status='waiting'
  `).get(ticket.queue_id, ticket.number) as { n: number }).n;

  return { position, queueId: ticket.queue_id, number: ticket.number, status: ticket.status };
}

export function getQueueStatus(): { queue: Queue; waiting: number; lastCalled: number }[] {
  return getAllQueues().map(queue => {
    const db = getDb();
    const waiting = (db.prepare(`
      SELECT COUNT(*) as n FROM tickets WHERE queue_id=? AND status='waiting'
    `).get(queue.id) as { n: number }).n;
    return { queue, waiting, lastCalled: queue.lastCalled };
  });
}

// ── Row mappers ─────────────────────────────────────────────────────────────

function rowToQueue(row: any): Queue {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    type: row.type,
    orderCheckUrl: row.order_check_url ?? undefined,
    currentNumber: row.current_number,
    lastCalled: row.last_called,
    active: Boolean(row.active),
  };
}

function rowToTicket(row: any): Ticket {
  return {
    id: row.id,
    queueId: row.queue_id,
    number: row.number,
    issuedAt: row.issued_at,
    status: row.status,
  };
}
