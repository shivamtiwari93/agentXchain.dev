import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { mkdirSync, existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, '..', 'data');
const defaultDbPath = join(dataDir, 'mood.db');
const dbPath = process.env.DB_PATH?.trim() || defaultDbPath;

let db;

export function getDb() {
  if (!db) {
    if (dbPath !== ':memory:') {
      const dbDir = dirname(dbPath);
      if (!existsSync(dbDir)) mkdirSync(dbDir, { recursive: true });
    }
    db = new Database(dbPath);
    initSchema(db);
  }
  return db;
}

function initSchema(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      token TEXT UNIQUE NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS mood_entries (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id),
      mood TEXT NOT NULL,
      note TEXT,
      tags TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_mood_user_created ON mood_entries(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);
  `);
}

export function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}
