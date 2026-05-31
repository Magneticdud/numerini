import { getDb } from './db';
import type { QueueConfig } from './config';
import Database from 'better-sqlite3';

const MAX_QUEUE_NUMBER = 999;
// Letters available for transfer suffix. 'A' is reserved to avoid visual
// confusion with queue-letter prefixes on receipts (e.g. "A-22").
const SUFFIX_ALPHABET = 'BCDEFGHIJKLMNOPQRSTUVWXYZ';

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
  suffix: string | null;
  issuedAt: string;
  originalIssuedAt: string | null;
  status: 'waiting' | 'called' | 'done' | 'transferred';
}

export interface CallRecord {
  id: number;
  queueId: number;
  number: number;
  calledAt: string;
  calledBy: string;
}

export interface TransferResult {
  newTicket: Ticket;
  originalTicketId: number;
  fromQueueId: number;
  transferId: number;
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
    // On wrap-around, mark the old waiting ticket done — but only non-suffix
    // tickets, so any transferred ticket (suffix='B' etc.) at the same number
    // is not accidentally clobbered.
    db.prepare(`
      UPDATE tickets SET status='done', called_at=CURRENT_TIMESTAMP
      WHERE queue_id=? AND number=? AND suffix IS NULL AND status='waiting'
    `).run(queueId, nextNumber);

    const result = db.prepare(`
      INSERT INTO tickets (queue_id, number, status) VALUES (?, ?, 'waiting')
    `).run(queueId, nextNumber);

    return db.prepare('SELECT * FROM tickets WHERE id=?').get(result.lastInsertRowid) as any;
  });

  return rowToTicket(txn());
}

// ── Call next ───────────────────────────────────────────────────────────────

// Returns the full Ticket that was called (includes suffix, e.g. '22B').
export function callNext(queueId: number, calledBy = 'operator'): Ticket {
  const db = getDb();
  const queue = db.prepare('SELECT * FROM queues WHERE id=? AND active=1').get(queueId) as any;
  if (!queue) throw new Error(`Queue ${queueId} not found`);

  // Pick the next ticket respecting composite ordering: number ASC, then
  // suffix ASC NULLS FIRST (NULL < 'B' < 'C' ...), so 22 is called before 22B.
  const waitingRow = db.prepare(`
    SELECT * FROM tickets
    WHERE queue_id=? AND status='waiting'
    ORDER BY number ASC, suffix ASC NULLS FIRST
    LIMIT 1
  `).get(queueId) as any | undefined;

  if (!waitingRow) throw new Error('EMPTY_QUEUE');

  const ticketId = waitingRow.id as number;
  const nextNumber = waitingRow.number as number;

  const txn = db.transaction(() => {
    // Mark the previously called ticket as done
    db.prepare(`
      UPDATE tickets SET status='done', called_at=CURRENT_TIMESTAMP
      WHERE queue_id=? AND status='called'
    `).run(queueId);
    // Mark THIS ticket as called — use id to be precise (avoids suffix IS ? binding)
    db.prepare(`
      UPDATE tickets SET status='called', called_at=CURRENT_TIMESTAMP
      WHERE id=?
    `).run(ticketId);
    db.prepare('UPDATE queues SET last_called=? WHERE id=?').run(nextNumber, queueId);
    db.prepare('INSERT INTO calls (queue_id, number, called_by) VALUES (?,?,?)').run(queueId, nextNumber, calledBy);
  });

  txn();
  return rowToTicket(db.prepare('SELECT * FROM tickets WHERE id=?').get(ticketId) as any);
}

// ── Transfer ticket ─────────────────────────────────────────────────────────

export function transferTicket(ticketId: number, targetQueueId: number): TransferResult {
  const db = getDb();

  const sourceRow = db.prepare('SELECT * FROM tickets WHERE id=?').get(ticketId) as any;
  if (!sourceRow) throw new Error('TICKET_NOT_FOUND');
  if (sourceRow.status === 'done' || sourceRow.status === 'transferred') {
    throw new Error('TICKET_NOT_TRANSFERABLE');
  }
  if (sourceRow.queue_id === targetQueueId) throw new Error('SELF_TRANSFER');

  const targetQueue = db.prepare('SELECT * FROM queues WHERE id=? AND active=1').get(targetQueueId) as any;
  if (!targetQueue) throw new Error('TARGET_QUEUE_NOT_FOUND');

  // Carry the oldest ancestor's timestamp through re-transfer chains
  const originalIssuedAt = (sourceRow.original_issued_at ?? sourceRow.issued_at) as string;

  const txn = db.transaction(() => {
    const { insertAfterNumber, suffix } = computeTransferPosition(
      db, originalIssuedAt, targetQueueId, targetQueue.last_called as number,
    );

    const insertResult = db.prepare(`
      INSERT INTO tickets (queue_id, number, suffix, original_issued_at, status)
      VALUES (?, ?, ?, ?, 'waiting')
    `).run(targetQueueId, insertAfterNumber, suffix, originalIssuedAt);

    const newTicketRow = db.prepare('SELECT * FROM tickets WHERE id=?').get(insertResult.lastInsertRowid) as any;

    db.prepare(`
      UPDATE tickets SET status='transferred', called_at=CURRENT_TIMESTAMP WHERE id=?
    `).run(ticketId);

    const transferRow = db.prepare(`
      INSERT INTO ticket_transfers (original_ticket_id, new_ticket_id, from_queue_id, to_queue_id)
      VALUES (?, ?, ?, ?)
    `).run(ticketId, insertResult.lastInsertRowid, sourceRow.queue_id, targetQueueId);

    return {
      newTicket: rowToTicket(newTicketRow),
      originalTicketId: ticketId,
      fromQueueId: sourceRow.queue_id as number,
      transferId: Number(transferRow.lastInsertRowid),
    };
  });

  return txn() as TransferResult;
}

// Determine where to insert a transferred ticket in the target queue.
// Uses COALESCE(original_issued_at, issued_at) as the effective arrival time
// so re-transferred tickets keep their original position.
function computeTransferPosition(
  db: Database.Database,
  originalIssuedAt: string,
  targetQueueId: number,
  lastCalled: number,
): { insertAfterNumber: number; suffix: string } {
  const waitingTickets = db.prepare(`
    SELECT number, COALESCE(original_issued_at, issued_at) AS effective_at
    FROM tickets
    WHERE queue_id=? AND status='waiting'
    ORDER BY effective_at ASC
  `).all(targetQueueId) as { number: number; effective_at: string }[];

  // Walk the sorted list to find where originalIssuedAt fits.
  // insertAfterNumber = null means Tizio arrived before everyone.
  let insertAfterNumber: number | null = null;
  for (const ticket of waitingTickets) {
    if (ticket.effective_at <= originalIssuedAt) {
      insertAfterNumber = ticket.number;
    } else {
      break;
    }
  }

  // null sentinel → arrived before all waiting → use lastCalled as the base
  // so the new ticket sorts before the first waiting number.
  const baseNumber = insertAfterNumber ?? lastCalled;

  // Find the next unused suffix letter at this base number.
  const usedSuffixes = new Set(
    (db.prepare(`
      SELECT suffix FROM tickets
      WHERE queue_id=? AND number=? AND suffix IS NOT NULL AND status='waiting'
    `).all(targetQueueId, baseNumber) as { suffix: string }[]).map(r => r.suffix),
  );

  let suffix = 'B'; // fallback if alphabet is somehow exhausted
  for (const letter of SUFFIX_ALPHABET) {
    if (!usedSuffixes.has(letter)) {
      suffix = letter;
      break;
    }
  }

  return { insertAfterNumber: baseNumber, suffix };
}

// Returns the new ticket ID created by the most recent transfer of originalTicketId,
// or null if no transfer record exists.
export function getTransferNewTicketId(originalTicketId: number): number | null {
  const db = getDb();
  const row = db.prepare(
    'SELECT new_ticket_id FROM ticket_transfers WHERE original_ticket_id=? ORDER BY id DESC LIMIT 1',
  ).get(originalTicketId) as { new_ticket_id: number } | undefined;
  return row?.new_ticket_id ?? null;
}

// ── Reset ───────────────────────────────────────────────────────────────────

export function resetQueue(queueId: number): void {
  const db = getDb();
  const txn = db.transaction(() => {
    db.prepare('UPDATE queues SET current_number=0, last_called=0 WHERE id=?').run(queueId);
    // Include 'transferred' so source tickets don't accumulate across resets.
    db.prepare(`
      UPDATE tickets SET status='done'
      WHERE queue_id=? AND status IN ('waiting','called','transferred')
    `).run(queueId);
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

  if (recentCalls.length < 11) return null;

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

export function getTicketPosition(
  ticketId: number,
): { position: number; queueId: number; number: number; suffix: string | null; status: string } | null {
  const db = getDb();
  const ticket = db.prepare('SELECT * FROM tickets WHERE id=?').get(ticketId) as any;
  if (!ticket) return null;

  // Fetch all waiting tickets in call order, then find this ticket's index.
  // Simple findIndex avoids complex SQL with multiple bound parameters for
  // the composite (number, suffix) comparison.
  const waiting = db.prepare(`
    SELECT id FROM tickets
    WHERE queue_id=? AND status='waiting'
    ORDER BY number ASC, suffix ASC NULLS FIRST
  `).all(ticket.queue_id) as { id: number }[];

  const pos = waiting.findIndex(r => r.id === ticket.id);

  return {
    position: pos === -1 ? 0 : pos,
    queueId: ticket.queue_id,
    number: ticket.number,
    suffix: ticket.suffix ?? null,
    status: ticket.status,
  };
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
    suffix: row.suffix ?? null,
    issuedAt: row.issued_at,
    originalIssuedAt: row.original_issued_at ?? null,
    status: row.status,
  };
}
