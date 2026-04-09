'use strict';

const store = require('./store');

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

async function handleApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const segments = url.pathname.split('/').filter(Boolean); // ['api', 'habits', ...]

  // GET /api/habits
  if (req.method === 'GET' && segments.length === 2 && segments[1] === 'habits') {
    return json(res, 200, store.listHabits());
  }

  // POST /api/habits
  if (req.method === 'POST' && segments.length === 2 && segments[1] === 'habits') {
    let body;
    try { body = await parseBody(req); } catch { return json(res, 400, { error: 'Invalid JSON' }); }
    const name = (body.name || '').trim();
    if (!name) return json(res, 400, { error: 'Name is required' });
    if (name.length > 100) return json(res, 400, { error: 'Name must be 100 characters or fewer' });
    const habit = store.createHabit(name, body.color);
    return json(res, 201, habit);
  }

  // Routes with :id
  if (segments.length >= 3 && segments[1] === 'habits') {
    const id = segments[2];

    // DELETE /api/habits/:id
    if (req.method === 'DELETE' && segments.length === 3) {
      const ok = store.deleteHabit(id);
      if (!ok) return json(res, 404, { error: 'Habit not found' });
      return json(res, 200, { deleted: true });
    }

    // POST /api/habits/:id/check
    if (req.method === 'POST' && segments.length === 4 && segments[3] === 'check') {
      const habit = store.checkToday(id);
      if (!habit) return json(res, 404, { error: 'Habit not found' });
      return json(res, 200, habit);
    }

    // DELETE /api/habits/:id/check
    if (req.method === 'DELETE' && segments.length === 4 && segments[3] === 'check') {
      const habit = store.uncheckToday(id);
      if (!habit) return json(res, 404, { error: 'Habit not found' });
      return json(res, 200, habit);
    }

    // GET /api/habits/:id/history
    if (req.method === 'GET' && segments.length === 4 && segments[3] === 'history') {
      const history = store.getHistory(id);
      if (!history) return json(res, 404, { error: 'Habit not found' });
      return json(res, 200, history);
    }
  }

  return json(res, 404, { error: 'Not found' });
}

module.exports = { handleApi };
