import Database from 'better-sqlite3';
import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { setDb, getDb, closeDb } from '../src/main/db';
import {
  initQueues,
  issueTicket,
  callNext,
  resetQueue,
  getQueue,
  getTicketPosition,
  estimatedWaitSeconds,
  getQueueStatus,
} from '../src/main/queue';

const TEST_QUEUE = {
  id: 1,
  name: 'Cassa',
  description: 'Fila principale',
  type: 'normal' as const,
};

beforeEach(() => {
  setDb(new Database(':memory:'));
  initQueues([TEST_QUEUE]);
});

afterEach(() => {
  closeDb();
});

// ── issueTicket ──────────────────────────────────────────────────────────────

describe('issueTicket', () => {
  it('issues the first ticket as #1', () => {
    const ticket = issueTicket(1);
    expect(ticket.number).toBe(1);
    expect(ticket.status).toBe('waiting');
    expect(ticket.queueId).toBe(1);
  });

  it('increments the number with each issuance', () => {
    expect(issueTicket(1).number).toBe(1);
    expect(issueTicket(1).number).toBe(2);
    expect(issueTicket(1).number).toBe(3);
  });

  it('wraps from 999 back to 1', () => {
    getDb().prepare('UPDATE queues SET current_number=999 WHERE id=1').run();
    expect(issueTicket(1).number).toBe(1);
  });

  it('marks the previous waiting ticket as done when wrapping', () => {
    const firstTicket = issueTicket(1);
    getDb().prepare('UPDATE queues SET current_number=999 WHERE id=1').run();
    issueTicket(1);
    const row = getDb().prepare('SELECT status FROM tickets WHERE id=?').get(firstTicket.id) as any;
    expect(row.status).toBe('done');
  });

  it('throws when the queue does not exist', () => {
    expect(() => issueTicket(99)).toThrow();
  });
});

// ── callNext ─────────────────────────────────────────────────────────────────

describe('callNext', () => {
  it('returns the lowest waiting ticket number', () => {
    issueTicket(1);
    issueTicket(1);
    expect(callNext(1)).toBe(1);
  });

  it('marks the ticket as called', () => {
    const ticket = issueTicket(1);
    callNext(1);
    const row = getDb().prepare('SELECT status FROM tickets WHERE id=?').get(ticket.id) as any;
    expect(row.status).toBe('called');
  });

  it('marks the previously called ticket as done on the next call', () => {
    issueTicket(1);
    issueTicket(1);
    callNext(1);
    callNext(1);
    const row = getDb().prepare('SELECT status FROM tickets WHERE queue_id=1 AND number=1').get() as any;
    expect(row.status).toBe('done');
  });

  it('throws EMPTY_QUEUE when no tickets are waiting', () => {
    expect(() => callNext(1)).toThrow('EMPTY_QUEUE');
  });

  it('records the call in the calls table with the caller id', () => {
    issueTicket(1);
    callNext(1, 'desk-1');
    const call = getDb().prepare('SELECT * FROM calls WHERE queue_id=1').get() as any;
    expect(call.number).toBe(1);
    expect(call.called_by).toBe('desk-1');
  });

  it('updates last_called on the queue', () => {
    issueTicket(1);
    callNext(1);
    expect(getQueue(1)?.lastCalled).toBe(1);
  });
});

// ── resetQueue ───────────────────────────────────────────────────────────────

describe('resetQueue', () => {
  it('resets current_number and last_called to 0', () => {
    issueTicket(1);
    issueTicket(1);
    callNext(1);
    resetQueue(1);
    const queue = getQueue(1);
    expect(queue?.currentNumber).toBe(0);
    expect(queue?.lastCalled).toBe(0);
  });

  it('marks all waiting and called tickets as done', () => {
    issueTicket(1);
    issueTicket(1);
    callNext(1);
    resetQueue(1);
    const active = getDb().prepare(
      "SELECT COUNT(*) as n FROM tickets WHERE queue_id=1 AND status IN ('waiting','called')"
    ).get() as any;
    expect(active.n).toBe(0);
  });
});

// ── getTicketPosition ─────────────────────────────────────────────────────────

describe('getTicketPosition', () => {
  it('returns null for a non-existent ticket', () => {
    expect(getTicketPosition(9999)).toBeNull();
  });

  it('returns 0 for the only waiting ticket', () => {
    const ticket = issueTicket(1);
    expect(getTicketPosition(ticket.id)?.position).toBe(0);
  });

  it('returns the correct position based on waiting tickets ahead', () => {
    const t1 = issueTicket(1);
    const t2 = issueTicket(1);
    const t3 = issueTicket(1);
    expect(getTicketPosition(t1.id)?.position).toBe(0);
    expect(getTicketPosition(t2.id)?.position).toBe(1);
    expect(getTicketPosition(t3.id)?.position).toBe(2);
  });

  it('does not count called tickets in the position', () => {
    const t1 = issueTicket(1);
    const t2 = issueTicket(1);
    callNext(1);
    expect(getTicketPosition(t1.id)?.position).toBe(0); // t1 is called, not waiting
    expect(getTicketPosition(t2.id)?.position).toBe(0); // t1 is ahead but not waiting
  });
});

// ── estimatedWaitSeconds ──────────────────────────────────────────────────────

describe('estimatedWaitSeconds', () => {
  it('returns null with fewer than 11 calls', () => {
    const db = getDb();
    const now = Date.now();
    for (let i = 0; i < 10; i++) {
      db.prepare('INSERT INTO calls (queue_id, number, called_at, called_by) VALUES (?,?,?,?)').run(
        1, i + 1, new Date(now - i * 60_000).toISOString(), 'operator'
      );
    }
    expect(estimatedWaitSeconds(1)).toBeNull();
  });

  it('estimates wait time from the average interval between recent calls', () => {
    const db = getDb();
    const now = Date.now();
    // 11 calls spaced 60 s apart → avg interval = 60 s
    for (let i = 0; i < 11; i++) {
      db.prepare('INSERT INTO calls (queue_id, number, called_at, called_by) VALUES (?,?,?,?)').run(
        1, i + 1, new Date(now - i * 60_000).toISOString(), 'operator'
      );
    }
    issueTicket(1);
    issueTicket(1);
    issueTicket(1);
    expect(estimatedWaitSeconds(1)).toBe(180); // 3 waiting × 60 s
  });
});

// ── getQueueStatus ────────────────────────────────────────────────────────────

describe('getQueueStatus', () => {
  it('reports zero waiting tickets for an empty queue', () => {
    const status = getQueueStatus();
    expect(status).toHaveLength(1);
    expect(status[0].waiting).toBe(0);
  });

  it('counts only waiting tickets, not called ones', () => {
    issueTicket(1);
    issueTicket(1);
    callNext(1);
    expect(getQueueStatus()[0].waiting).toBe(1);
  });
});
