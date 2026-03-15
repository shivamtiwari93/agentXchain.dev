import { randomUUID } from 'crypto';
import { getDb } from '../db.js';
import { resolveUser, getOrCreateUserAndSession } from '../session.js';

const MOODS = ['great', 'good', 'okay', 'low', 'anxious'];

function getSessionToken(req) {
  return req.cookies?.session || req.get('X-Session-Token') || null;
}

export function registerMoodRoutes(app) {
  app.post('/api/mood', (req, res) => {
    let token = getSessionToken(req);
    let userId = token ? resolveUser(token) : null;
    let sessionToken = null;
    if (!userId) {
      const result = getOrCreateUserAndSession(token);
      if (typeof result === 'object' && result.sessionToken) {
        userId = result.userId;
        sessionToken = result.sessionToken;
      } else {
        userId = result;
      }
    }
    const { mood, note, tags } = req.body || {};
    if (!mood || !MOODS.includes(mood)) {
      res.status(400).json({ error: 'mood required; must be one of: ' + MOODS.join(', ') });
      return;
    }
    const id = randomUUID();
    const created_at = Date.now();
    const tagsStr = Array.isArray(tags) ? JSON.stringify(tags) : (tags ? JSON.stringify([].concat(tags)) : null);
    getDb().prepare(
      'INSERT INTO mood_entries (id, user_id, mood, note, tags, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(id, userId, mood, note || null, tagsStr, created_at);
    const payload = { id, user_id: userId, mood, note: note || null, tags: tags || [], created_at };
    if (sessionToken) {
      res.cookie('session', sessionToken, { httpOnly: true, maxAge: 30 * 24 * 60 * 60 * 1000, path: '/' });
    }
    res.status(201).json(payload);
  });

  app.get('/api/mood', (req, res) => {
    const token = getSessionToken(req);
    let userId = resolveUser(token);
    if (!userId) {
      const result = getOrCreateUserAndSession(token);
      if (typeof result === 'object' && result.sessionToken) {
        userId = result.userId;
        res.cookie('session', result.sessionToken, { httpOnly: true, maxAge: 30 * 24 * 60 * 60 * 1000, path: '/' });
      } else {
        userId = result;
      }
    }
    const { from, to, tag } = req.query;
    let sql = 'SELECT id, user_id, mood, note, tags, created_at FROM mood_entries WHERE user_id = ?';
    const args = [userId];
    if (from) { sql += ' AND created_at >= ?'; args.push(Number(from)); }
    if (to) { sql += ' AND created_at <= ?'; args.push(Number(to)); }
    sql += ' ORDER BY created_at DESC';
    const rows = getDb().prepare(sql).all(...args);
    let entries = rows.map(r => ({
      id: r.id,
      user_id: r.user_id,
      mood: r.mood,
      note: r.note,
      tags: r.tags ? JSON.parse(r.tags) : [],
      created_at: r.created_at
    }));
    if (tag) {
      entries = entries.filter(e => e.tags && e.tags.includes(tag));
    }
    res.json({ entries });
  });

  app.get('/api/insight', (req, res) => {
    const token = getSessionToken(req);
    const userId = resolveUser(token);
    if (!userId) {
      res.json({ insight: null, message: 'Log at least one mood to see insights.' });
      return;
    }
    const db = getDb();
    const entries = db.prepare(
      'SELECT mood, created_at FROM mood_entries WHERE user_id = ? ORDER BY created_at DESC'
    ).all(userId);
    if (entries.length === 0) {
      res.json({ insight: null, message: 'Log at least one mood to see insights.' });
      return;
    }
    const now = Date.now();
    const oneWeek = 7 * 24 * 60 * 60 * 1000;
    const thisWeek = entries.filter(e => e.created_at >= now - oneWeek);
    const lastWeek = entries.filter(e => e.created_at >= now - 2 * oneWeek && e.created_at < now - oneWeek);
    const avg = (arr) => {
      if (arr.length === 0) return 0;
      const score = { great: 5, good: 4, okay: 3, low: 2, anxious: 1 };
      return arr.reduce((s, e) => s + (score[e.mood] || 0), 0) / arr.length;
    };
    const avgThis = avg(thisWeek);
    const avgLast = avg(lastWeek);
    const counts = {};
    entries.forEach(e => { counts[e.mood] = (counts[e.mood] || 0) + 1; });
    const mostCommon = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    res.json({
      insight: {
        most_common_mood: mostCommon ? mostCommon[0] : null,
        week_over_week: lastWeek.length > 0 ? (avgThis - avgLast).toFixed(2) : null,
        entries_this_week: thisWeek.length,
        total_entries: entries.length
      },
      message: null
    });
  });
}
