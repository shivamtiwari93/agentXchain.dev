'use strict';

const store = require('./store');

const VALID_STATUSES = new Set(['green', 'yellow', 'blocked']);

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
    });
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

function mapStoreError(res, error) {
  if (error.code === 'TEAM_NOT_FOUND' || error.code === 'MEMBER_NOT_FOUND') {
    return json(res, 404, { error: error.message });
  }
  if (error.code === 'DUPLICATE_MEMBER') {
    return json(res, 409, { error: error.message });
  }
  return json(res, 500, { error: 'Internal server error' });
}

function readDateParam(url) {
  const date = url.searchParams.get('date');
  if (date && !store.isValidDateString(date)) {
    return { error: 'Date must use YYYY-MM-DD' };
  }
  return { date: date || store.todayDateString() };
}

async function handleApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const segments = url.pathname.split('/').filter(Boolean);

  if (req.method === 'GET' && segments.length === 2 && segments[1] === 'teams') {
    return json(res, 200, store.listTeams());
  }

  if (req.method === 'POST' && segments.length === 2 && segments[1] === 'teams') {
    let body;
    try {
      body = await parseBody(req);
    } catch {
      return json(res, 400, { error: 'Invalid JSON' });
    }

    const name = (body.name || '').trim();
    const channel = (body.channel || '').trim();
    const timezone = (body.timezone || 'UTC').trim();
    const reminderHour = Number(body.reminderHour ?? 10);
    const retentionDays = Number(body.retentionDays ?? 30);

    if (!name) {
      return json(res, 400, { error: 'Team name is required' });
    }
    if (!channel) {
      return json(res, 400, { error: 'Channel is required' });
    }
    if (!Number.isInteger(reminderHour) || reminderHour < 0 || reminderHour > 23) {
      return json(res, 400, { error: 'Reminder hour must be an integer between 0 and 23' });
    }
    if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 365) {
      return json(res, 400, { error: 'Retention days must be an integer between 1 and 365' });
    }

    const team = store.createTeam({ name, channel, timezone, reminderHour, retentionDays });
    return json(res, 201, team);
  }

  if (segments.length >= 3 && segments[1] === 'teams') {
    const teamId = segments[2];

    if (req.method === 'GET' && segments.length === 3) {
      const targetDate = readDateParam(url);
      if (targetDate.error) {
        return json(res, 400, { error: targetDate.error });
      }
      const team = store.getTeam(teamId, targetDate.date);
      if (!team) {
        return json(res, 404, { error: 'Team not found' });
      }
      return json(res, 200, team);
    }

    if (req.method === 'POST' && segments.length === 4 && segments[3] === 'members') {
      let body;
      try {
        body = await parseBody(req);
      } catch {
        return json(res, 400, { error: 'Invalid JSON' });
      }

      const name = (body.name || '').trim();
      const timezone = (body.timezone || '').trim();
      const slackHandle = (body.slackHandle || '').trim();

      if (!name) {
        return json(res, 400, { error: 'Member name is required' });
      }
      if (!timezone) {
        return json(res, 400, { error: 'Timezone is required' });
      }

      try {
        const member = store.addMember(teamId, { name, timezone, slackHandle });
        return json(res, 201, member);
      } catch (error) {
        return mapStoreError(res, error);
      }
    }

    if (req.method === 'POST' && segments.length === 4 && segments[3] === 'checkins') {
      let body;
      try {
        body = await parseBody(req);
      } catch {
        return json(res, 400, { error: 'Invalid JSON' });
      }

      const memberId = (body.memberId || '').trim();
      const yesterday = (body.yesterday || '').trim();
      const today = (body.today || '').trim();
      const blockers = typeof body.blockers === 'string' ? body.blockers.trim() : '';
      const status = body.status ? String(body.status).trim() : '';
      const date = body.date ? String(body.date).trim() : '';

      if (!memberId) {
        return json(res, 400, { error: 'memberId is required' });
      }
      if (!yesterday || !today) {
        return json(res, 400, { error: 'Yesterday and today fields are required' });
      }
      if (status && !VALID_STATUSES.has(status)) {
        return json(res, 400, { error: 'Status must be green, yellow, or blocked' });
      }
      if (date && !store.isValidDateString(date)) {
        return json(res, 400, { error: 'Date must use YYYY-MM-DD' });
      }

      try {
        const result = store.submitCheckin(teamId, { memberId, yesterday, today, blockers, status, date });
        return json(res, result.created ? 201 : 200, result.checkin);
      } catch (error) {
        return mapStoreError(res, error);
      }
    }

    if (req.method === 'GET' && segments.length === 4 && segments[3] === 'summary') {
      const targetDate = readDateParam(url);
      if (targetDate.error) {
        return json(res, 400, { error: targetDate.error });
      }
      try {
        return json(res, 200, store.getSummary(teamId, targetDate.date));
      } catch (error) {
        return mapStoreError(res, error);
      }
    }

    if (req.method === 'GET' && segments.length === 4 && segments[3] === 'reminders') {
      const targetDate = readDateParam(url);
      if (targetDate.error) {
        return json(res, 400, { error: targetDate.error });
      }
      try {
        return json(res, 200, store.getReminderPreview(teamId, targetDate.date));
      } catch (error) {
        return mapStoreError(res, error);
      }
    }
  }

  if (req.method === 'POST' && segments.length === 3 && segments[1] === 'ops' && segments[2] === 'prune-retention') {
    let body;
    try {
      body = await parseBody(req);
    } catch {
      return json(res, 400, { error: 'Invalid JSON' });
    }

    const beforeDate = String(body.beforeDate || '').trim();
    if (!store.isValidDateString(beforeDate)) {
      return json(res, 400, { error: 'beforeDate must use YYYY-MM-DD' });
    }

    return json(res, 200, store.pruneRetention(beforeDate));
  }

  return json(res, 404, { error: 'Not found' });
}

module.exports = { handleApi };
