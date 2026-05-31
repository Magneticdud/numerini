import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';
import fs from 'fs';

const DB_DIR = path.join(os.homedir(), '.config', 'numerini');
const DB_PATH = path.join(DB_DIR, 'numerini.db');

let db: Database.Database | undefined;

export function getDb(): Database.Database {
  if (!db) {
    if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    migrate(db);
  }
  return db!;
}

export function setDb(database: Database.Database): void {
  db = database;
  migrate(db);
}

function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS queues (
      id            INTEGER PRIMARY KEY,
      name          TEXT    NOT NULL,
      description   TEXT    DEFAULT '',
      type          TEXT    DEFAULT 'normal',
      order_check_url TEXT,
      current_number INTEGER DEFAULT 0,
      last_called   INTEGER DEFAULT 0,
      active        BOOLEAN DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS tickets (
      id        INTEGER PRIMARY KEY,
      queue_id  INTEGER REFERENCES queues(id),
      number    INTEGER NOT NULL,
      issued_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      called_at DATETIME,
      status    TEXT    DEFAULT 'waiting'
    );

    CREATE TABLE IF NOT EXISTS calls (
      id        INTEGER PRIMARY KEY,
      queue_id  INTEGER REFERENCES queues(id),
      number    INTEGER NOT NULL,
      called_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      called_by TEXT    DEFAULT 'operator'
    );

    CREATE INDEX IF NOT EXISTS idx_calls_queue_time
      ON calls(queue_id, called_at DESC);

    CREATE INDEX IF NOT EXISTS idx_tickets_queue_status
      ON tickets(queue_id, status);
  `);
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = undefined;
  }
}
