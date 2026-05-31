import Database from 'better-sqlite3';
import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { setDb, getDb, closeDb } from '../src/main/db';
import {
  initQueues,
  issueTicket,
  callNext,
  resetQueue,
  transferTicket,
  getQueue,
  getTicketPosition,
  estimatedWaitSeconds,
  getQueueStatus,
} from '../src/main/queue';

const Q1 = { id: 1, name: 'Cassa',    description: 'Fila principale', type: 'normal' as const };
const Q2 = { id: 2, name: 'Farmacia', description: 'Farmacia',        type: 'normal' as const };

beforeEach(() => {
  setDb(new Database(':memory:'));
  initQueues([Q1, Q2]);
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
    expect(ticket.suffix).toBeNull();
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

  // REGRESSION: wrap must NOT clobber a suffix ticket (22B) sitting at the same
  // base number when the queue wraps around to that number.
  it('wrap-around does not mark a suffix ticket as done', () => {
    // Simulate a transferred ticket at number=1 with suffix='B'
    getDb().prepare(`
      INSERT INTO tickets (queue_id, number, suffix, status) VALUES (1, 1, 'B', 'waiting')
    `).run();
    // Wrap from 999 back to 1
    getDb().prepare('UPDATE queues SET current_number=999 WHERE id=1').run();
    issueTicket(1);
    // The suffix='B' ticket must still be waiting
    const row = getDb().prepare(
      "SELECT status FROM tickets WHERE queue_id=1 AND number=1 AND suffix='B'"
    ).get() as any;
    expect(row.status).toBe('waiting');
  });

  it('throws when the queue does not exist', () => {
    expect(() => issueTicket(99)).toThrow();
  });
});

// ── callNext ─────────────────────────────────────────────────────────────────

describe('callNext', () => {
  it('returns the called ticket with number and null suffix', () => {
    issueTicket(1);
    issueTicket(1);
    const ticket = callNext(1);
    expect(ticket.number).toBe(1);
    expect(ticket.suffix).toBeNull();
    expect(ticket.status).toBe('called');
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

  // REGRESSION: suffix ticket must be called BEFORE the next integer ticket.
  // With number ASC, suffix ASC NULLS FIRST: 22(null) < 22B < 23(null).
  it('calls a suffix ticket before the next base number', () => {
    // Manually set up: queue has called up to 22, waiting: 22B then 23
    getDb().prepare('UPDATE queues SET last_called=22 WHERE id=1').run();
    getDb().prepare(`
      INSERT INTO tickets (queue_id, number, suffix, status) VALUES (1, 22, 'B', 'waiting')
    `).run();
    getDb().prepare(`
      INSERT INTO tickets (queue_id, number, suffix, status) VALUES (1, 23, NULL, 'waiting')
    `).run();

    const first = callNext(1);
    expect(first.number).toBe(22);
    expect(first.suffix).toBe('B');

    const second = callNext(1);
    expect(second.number).toBe(23);
    expect(second.suffix).toBeNull();
  });

  // REGRESSION: calling next must NOT mark both 22 and 22B as 'called'.
  // Previously the UPDATE matched by (queue_id, number) which would hit both rows.
  it('marks only the correct suffix ticket as called, leaving others untouched', () => {
    getDb().prepare('UPDATE queues SET last_called=21 WHERE id=1').run();
    const row22 = getDb().prepare(`
      INSERT INTO tickets (queue_id, number, suffix, status) VALUES (1, 22, NULL, 'waiting')
    `).run();
    const row22B = getDb().prepare(`
      INSERT INTO tickets (queue_id, number, suffix, status) VALUES (1, 22, 'B', 'waiting')
    `).run();

    callNext(1); // should call 22 (null suffix first)

    const t22  = getDb().prepare('SELECT status FROM tickets WHERE id=?').get(row22.lastInsertRowid)  as any;
    const t22B = getDb().prepare('SELECT status FROM tickets WHERE id=?').get(row22B.lastInsertRowid) as any;
    expect(t22.status).toBe('called');
    expect(t22B.status).toBe('waiting'); // must still be waiting
  });
});

// ── resetQueue ───────────────────────────────────────────────────────────────

describe('resetQueue', () => {
  it('resets current_number and last_called to 0', () => {
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

  // REGRESSION: a 'transferred' source ticket in the queue must also be marked
  // done on reset so it doesn't accumulate across daily resets.
  it("marks 'transferred' source tickets as done on reset", () => {
    const t = issueTicket(1);
    // Simulate what transferTicket does: mark the source ticket as transferred
    getDb().prepare("UPDATE tickets SET status='transferred' WHERE id=?").run(t.id);

    resetQueue(1);

    const row = getDb().prepare('SELECT status FROM tickets WHERE id=?').get(t.id) as any;
    expect(row.status).toBe('done');
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
    expect(getTicketPosition(t2.id)?.position).toBe(0); // t1 is called, only t2 is waiting
  });

  // REGRESSION: a suffix ticket (22B) inserted between 22 and 23 must report
  // position 1 (after 22, before 23) — not 0 (the old COUNT WHERE number < 22).
  it('suffix ticket reports correct position between base numbers', () => {
    getDb().prepare('UPDATE queues SET last_called=21 WHERE id=1').run();
    getDb().prepare(`
      INSERT INTO tickets (queue_id, number, suffix, status) VALUES (1, 22, NULL,  'waiting')
    `).run();
    const r22B = getDb().prepare(`
      INSERT INTO tickets (queue_id, number, suffix, status) VALUES (1, 22, 'B', 'waiting')
    `).run();
    getDb().prepare(`
      INSERT INTO tickets (queue_id, number, suffix, status) VALUES (1, 23, NULL,  'waiting')
    `).run();

    // 22 → pos 0, 22B → pos 1, 23 → pos 2
    const pos = getTicketPosition(Number(r22B.lastInsertRowid));
    expect(pos?.position).toBe(1);
    expect(pos?.suffix).toBe('B');
  });
});

// ── transferTicket ────────────────────────────────────────────────────────────

describe('transferTicket', () => {
  // ── Error cases ────────────────────────────────────────────────────────────

  it('throws TICKET_NOT_FOUND for a non-existent ticket', () => {
    expect(() => transferTicket(9999, 2)).toThrow('TICKET_NOT_FOUND');
  });

  it('throws TICKET_NOT_TRANSFERABLE for a done ticket', () => {
    const t = issueTicket(1);
    getDb().prepare("UPDATE tickets SET status='done' WHERE id=?").run(t.id);
    expect(() => transferTicket(t.id, 2)).toThrow('TICKET_NOT_TRANSFERABLE');
  });

  it('throws TICKET_NOT_TRANSFERABLE for an already-transferred ticket', () => {
    const t = issueTicket(1);
    getDb().prepare("UPDATE tickets SET status='transferred' WHERE id=?").run(t.id);
    expect(() => transferTicket(t.id, 2)).toThrow('TICKET_NOT_TRANSFERABLE');
  });

  it('throws SELF_TRANSFER when source and target are the same queue', () => {
    const t = issueTicket(1);
    expect(() => transferTicket(t.id, 1)).toThrow('SELF_TRANSFER');
  });

  it('throws TARGET_QUEUE_NOT_FOUND for an inactive or missing queue', () => {
    const t = issueTicket(1);
    expect(() => transferTicket(t.id, 99)).toThrow('TARGET_QUEUE_NOT_FOUND');
  });

  // ── Happy path: middle insertion ──────────────────────────────────────────

  it('inserts the transferred ticket between the correct waiting tickets', () => {
    // Q2 has: ticket @09:05 (number=1), ticket @09:22 (number=2)
    // Tizio's Q1 ticket was issued at 09:10 → should go between 1 and 2
    const now = new Date('2026-05-31T09:22:00Z').toISOString();
    const before = new Date('2026-05-31T09:05:00Z').toISOString();

    const q2t1 = getDb().prepare(`
      INSERT INTO tickets (queue_id, number, issued_at, status) VALUES (2, 1, ?, 'waiting')
    `).run(before);
    const q2t2 = getDb().prepare(`
      INSERT INTO tickets (queue_id, number, issued_at, status) VALUES (2, 2, ?, 'waiting')
    `).run(now);

    // Tizio's ticket was issued at 09:10 (between before and now)
    const tizio = getDb().prepare(`
      INSERT INTO tickets (queue_id, number, issued_at, status) VALUES (1, 5, '2026-05-31T09:10:00Z', 'waiting')
    `).run();
    getDb().prepare("UPDATE queues SET last_called=0 WHERE id=2").run();

    const result = transferTicket(Number(tizio.lastInsertRowid), 2);

    // New ticket must be at position 1 (after ticket #1, before ticket #2)
    expect(result.newTicket.number).toBe(1); // insertAfterNumber = 1
    expect(result.newTicket.suffix).toBe('B');
    expect(result.newTicket.queueId).toBe(2);
    expect(result.newTicket.status).toBe('waiting');

    // Verify ordering: [1(null), 1B, 2(null)]
    const pos = getTicketPosition(result.newTicket.id);
    expect(pos?.position).toBe(1);
  });

  // ── Edge: Tizio arrived before all waiting ────────────────────────────────

  it('inserts as first-to-be-called when arrival is before all waiting tickets', () => {
    // Q2 has tickets issued at 09:30, 09:45
    getDb().prepare(`
      INSERT INTO tickets (queue_id, number, issued_at, status) VALUES (2, 3, '2026-05-31T09:30:00Z', 'waiting')
    `).run();
    getDb().prepare(`
      INSERT INTO tickets (queue_id, number, issued_at, status) VALUES (2, 4, '2026-05-31T09:45:00Z', 'waiting')
    `).run();
    getDb().prepare("UPDATE queues SET last_called=2 WHERE id=2").run();

    // Tizio was issued at 09:00 — before everyone in Q2
    const tizio = getDb().prepare(`
      INSERT INTO tickets (queue_id, number, issued_at, status) VALUES (1, 5, '2026-05-31T09:00:00Z', 'waiting')
    `).run();

    const result = transferTicket(Number(tizio.lastInsertRowid), 2);

    // Should be based on lastCalled=2 → number=2, suffix='B'
    expect(result.newTicket.number).toBe(2);
    expect(result.newTicket.suffix).toBe('B');

    // Position 0 — called before ticket #3 and #4
    const pos = getTicketPosition(result.newTicket.id);
    expect(pos?.position).toBe(0);
  });

  // ── Edge: Tizio arrived after all waiting ─────────────────────────────────

  it('inserts at the end when arrival is after all waiting tickets', () => {
    getDb().prepare(`
      INSERT INTO tickets (queue_id, number, issued_at, status) VALUES (2, 1, '2026-05-31T08:00:00Z', 'waiting')
    `).run();
    getDb().prepare(`
      INSERT INTO tickets (queue_id, number, issued_at, status) VALUES (2, 2, '2026-05-31T08:30:00Z', 'waiting')
    `).run();
    getDb().prepare("UPDATE queues SET last_called=0 WHERE id=2").run();

    // Tizio arrives at 10:00 — after everyone
    const tizio = getDb().prepare(`
      INSERT INTO tickets (queue_id, number, issued_at, status) VALUES (1, 5, '2026-05-31T10:00:00Z', 'waiting')
    `).run();

    const result = transferTicket(Number(tizio.lastInsertRowid), 2);

    // Should go after ticket #2 (insertAfterNumber=2)
    expect(result.newTicket.number).toBe(2);
    expect(result.newTicket.suffix).toBe('B');

    const pos = getTicketPosition(result.newTicket.id);
    expect(pos?.position).toBe(2); // after 1 and 2
  });

  // ── Edge: suffix conflict at same insertion point ─────────────────────────

  it("assigns 'C' when 'B' is already taken at the same position", () => {
    getDb().prepare(`
      INSERT INTO tickets (queue_id, number, suffix, issued_at, status)
      VALUES (2, 5, 'B', '2026-05-31T09:10:00Z', 'waiting')
    `).run();
    getDb().prepare("UPDATE queues SET last_called=5 WHERE id=2").run();

    // Tizio also arrived at 09:05 — before the 09:10 ticket
    const tizio = getDb().prepare(`
      INSERT INTO tickets (queue_id, number, issued_at, status) VALUES (1, 3, '2026-05-31T09:05:00Z', 'waiting')
    `).run();

    const result = transferTicket(Number(tizio.lastInsertRowid), 2);
    // insertAfterNumber=5 (lastCalled), suffix='B' already taken → gets 'C'
    expect(result.newTicket.suffix).toBe('C');
  });

  // ── Source ticket marked as transferred ───────────────────────────────────

  it("marks the source ticket as 'transferred'", () => {
    const t = issueTicket(1);
    transferTicket(t.id, 2);
    const row = getDb().prepare('SELECT status FROM tickets WHERE id=?').get(t.id) as any;
    expect(row.status).toBe('transferred');
  });

  // ── Transfer record written ───────────────────────────────────────────────

  it('writes a row to ticket_transfers', () => {
    const t = issueTicket(1);
    const result = transferTicket(t.id, 2);

    const transfer = getDb().prepare('SELECT * FROM ticket_transfers WHERE id=?').get(result.transferId) as any;
    expect(transfer).toBeTruthy();
    expect(transfer.original_ticket_id).toBe(t.id);
    expect(transfer.new_ticket_id).toBe(result.newTicket.id);
    expect(transfer.from_queue_id).toBe(1);
    expect(transfer.to_queue_id).toBe(2);
  });

  // ── Re-transfer preserves original_issued_at ──────────────────────────────

  it('carries original_issued_at through re-transfer chains', () => {
    const original = new Date('2026-05-31T09:00:00Z').toISOString();
    const tizio = getDb().prepare(`
      INSERT INTO tickets (queue_id, number, issued_at, status) VALUES (1, 1, ?, 'waiting')
    `).run(original);

    // First transfer: Q1 → Q2
    const r1 = transferTicket(Number(tizio.lastInsertRowid), 2);
    expect(r1.newTicket.originalIssuedAt).toBe(original);

    // Second transfer: Q2 → back to Q1 (different queue for test simplicity)
    // We need a 3rd queue for this — add one
    getDb().prepare(`
      INSERT INTO queues (id, name, description, type, active)
      VALUES (3, 'Extra', '', 'normal', 1)
    `).run();
    const r2 = transferTicket(r1.newTicket.id, 3);
    // Must carry the original 09:00 timestamp, not the intermediate time
    expect(r2.newTicket.originalIssuedAt).toBe(original);
  });

  // ── Atomicity ─────────────────────────────────────────────────────────────

  it('is atomic: if it fails mid-way, no partial state is written', () => {
    const t = issueTicket(1);
    // Attempting transfer to non-existent queue must throw AND leave source
    // ticket untouched.
    expect(() => transferTicket(t.id, 99)).toThrow();

    const row = getDb().prepare('SELECT status FROM tickets WHERE id=?').get(t.id) as any;
    expect(row.status).toBe('waiting'); // untouched
    const transfers = getDb().prepare('SELECT COUNT(*) as n FROM ticket_transfers').get() as any;
    expect(transfers.n).toBe(0); // nothing written
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
    for (let i = 0; i < 11; i++) {
      db.prepare('INSERT INTO calls (queue_id, number, called_at, called_by) VALUES (?,?,?,?)').run(
        1, i + 1, new Date(now - i * 60_000).toISOString(), 'operator'
      );
    }
    issueTicket(1);
    issueTicket(1);
    issueTicket(1);
    expect(estimatedWaitSeconds(1)).toBe(180);
  });
});

// ── getQueueStatus ────────────────────────────────────────────────────────────

describe('getQueueStatus', () => {
  it('reports zero waiting tickets for an empty queue', () => {
    const status = getQueueStatus();
    expect(status).toHaveLength(2); // Q1 + Q2
    expect(status[0].waiting).toBe(0);
  });

  it('counts only waiting tickets, not called ones', () => {
    issueTicket(1);
    issueTicket(1);
    callNext(1);
    expect(getQueueStatus().find(s => s.queue.id === 1)?.waiting).toBe(1);
  });
});
