import { randomUUID } from 'crypto';
import { getDb } from './db.js';

const SESSION_DAYS = 30;

export function getOrCreateUserAndSession(token) {
  const db = getDb();
  if (token) {
    const row = db.prepare(
      'SELECT s.user_id FROM sessions s WHERE s.token = ? AND s.expires_at > ?'
    ).get(token, Date.now());
    if (row) return row.user_id;
  }
  const userId = randomUUID();
  const sessionId = randomUUID();
  const newToken = randomUUID();
  const expiresAt = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
  db.prepare('INSERT INTO users (id, created_at) VALUES (?, ?)').run(userId, Date.now());
  db.prepare(
    'INSERT INTO sessions (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)'
  ).run(sessionId, userId, newToken, expiresAt);
  return { userId, sessionToken: newToken };
}

export function resolveUser(token) {
  if (!token) return null;
  const db = getDb();
  const row = db.prepare(
    'SELECT user_id FROM sessions WHERE token = ? AND expires_at > ?'
  ).get(token, Date.now());
  return row ? row.user_id : null;
}
