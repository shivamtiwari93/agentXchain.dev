'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

process.env.STANDUP_BOT_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'async-standup-api-'));

const store = require('../src/store');
const { server } = require('../src/server');

function request(port, method, route, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: route,
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
      },
      res => {
        let data = '';
        res.on('data', chunk => {
          data += chunk;
        });
        res.on('end', () => {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: data,
            json: res.headers['content-type']?.includes('application/json') ? JSON.parse(data) : null,
          });
        });
      },
    );
    req.on('error', reject);
    if (body !== undefined) {
      req.write(body);
    }
    req.end();
  });
}

let listener;
let port;

test.before(async () => {
  await new Promise(resolve => {
    listener = server.listen(0, () => {
      port = listener.address().port;
      resolve();
    });
  });
});

test.after(async () => {
  await new Promise(resolve => listener.close(resolve));
});

test.beforeEach(() => {
  store.clear();
});

test('serves the browser UI at root', async () => {
  const response = await request(port, 'GET', '/');
  assert.equal(response.status, 200);
  assert.match(response.body, /Async Standup Bot/);
});

test('creates a team and exposes it through list and detail endpoints', async () => {
  const create = await request(
    port,
    'POST',
    '/api/teams',
    JSON.stringify({
      name: 'Engineering',
      channel: '#eng-async',
      timezone: 'America/Toronto',
      reminderHour: 10,
      retentionDays: 30,
    }),
  );
  assert.equal(create.status, 201);

  const list = await request(port, 'GET', '/api/teams');
  assert.equal(list.status, 200);
  assert.equal(list.json.length, 1);

  const detail = await request(port, 'GET', `/api/teams/${create.json.id}?date=2026-04-09`);
  assert.equal(detail.status, 200);
  assert.equal(detail.json.name, 'Engineering');
});

test('rejects invalid team payloads', async () => {
  const response = await request(port, 'POST', '/api/teams', JSON.stringify({ name: '', channel: '' }));
  assert.equal(response.status, 400);
  assert.equal(response.json.error, 'Team name is required');
});

test('adds members and rejects duplicate names', async () => {
  const create = await request(
    port,
    'POST',
    '/api/teams',
    JSON.stringify({ name: 'Product', channel: '#product', timezone: 'UTC', reminderHour: 9, retentionDays: 30 }),
  );

  const first = await request(
    port,
    'POST',
    `/api/teams/${create.json.id}/members`,
    JSON.stringify({ name: 'Alex', timezone: 'UTC', slackHandle: '@alex' }),
  );
  assert.equal(first.status, 201);

  const duplicate = await request(
    port,
    'POST',
    `/api/teams/${create.json.id}/members`,
    JSON.stringify({ name: 'alex', timezone: 'UTC', slackHandle: '@alex2' }),
  );
  assert.equal(duplicate.status, 409);
});

test('submits standups, generates summaries, and previews reminders', async () => {
  const team = await request(
    port,
    'POST',
    '/api/teams',
    JSON.stringify({ name: 'Platform', channel: '#platform', timezone: 'UTC', reminderHour: 11, retentionDays: 30 }),
  );
  const alex = await request(
    port,
    'POST',
    `/api/teams/${team.json.id}/members`,
    JSON.stringify({ name: 'Alex', timezone: 'UTC', slackHandle: '@alex' }),
  );
  await request(
    port,
    'POST',
    `/api/teams/${team.json.id}/members`,
    JSON.stringify({ name: 'Blair', timezone: 'UTC', slackHandle: '@blair' }),
  );

  const checkin = await request(
    port,
    'POST',
    `/api/teams/${team.json.id}/checkins`,
    JSON.stringify({
      memberId: alex.json.id,
      date: '2026-04-09',
      yesterday: 'Shipped release',
      today: 'Watch metrics',
      blockers: 'Waiting on deploy window',
      status: 'blocked',
    }),
  );
  assert.equal(checkin.status, 201);

  const summary = await request(port, 'GET', `/api/teams/${team.json.id}/summary?date=2026-04-09`);
  assert.equal(summary.status, 200);
  assert.equal(summary.json.blockerCount, 1);
  assert.equal(summary.json.missingMembers.length, 1);
  assert.match(summary.json.markdown, /Waiting on deploy window/);

  const reminders = await request(port, 'GET', `/api/teams/${team.json.id}/reminders?date=2026-04-09`);
  assert.equal(reminders.status, 200);
  assert.equal(reminders.json.reminders.length, 1);
  assert.equal(reminders.json.reminders[0].memberName, 'Blair');
});

test('upserts checkins for the same member and date', async () => {
  const team = await request(
    port,
    'POST',
    '/api/teams',
    JSON.stringify({ name: 'Ops', channel: '#ops', timezone: 'UTC', reminderHour: 10, retentionDays: 30 }),
  );
  const member = await request(
    port,
    'POST',
    `/api/teams/${team.json.id}/members`,
    JSON.stringify({ name: 'Mina', timezone: 'UTC', slackHandle: '@mina' }),
  );

  const first = await request(
    port,
    'POST',
    `/api/teams/${team.json.id}/checkins`,
    JSON.stringify({
      memberId: member.json.id,
      date: '2026-04-09',
      yesterday: 'Checked alerts',
      today: 'Review retention',
      blockers: '',
      status: 'green',
    }),
  );
  const second = await request(
    port,
    'POST',
    `/api/teams/${team.json.id}/checkins`,
    JSON.stringify({
      memberId: member.json.id,
      date: '2026-04-09',
      yesterday: 'Checked alerts',
      today: 'Review retention policy',
      blockers: '',
      status: 'yellow',
    }),
  );

  assert.equal(first.status, 201);
  assert.equal(second.status, 200);

  const summary = await request(port, 'GET', `/api/teams/${team.json.id}/summary?date=2026-04-09`);
  assert.equal(summary.json.submitted.length, 1);
  assert.equal(summary.json.submitted[0].status, 'yellow');
});

test('prunes historical retention entries', async () => {
  const team = store.createTeam({ name: 'QA', channel: '#qa', timezone: 'UTC', reminderHour: 10, retentionDays: 30 });
  const member = store.addMember(team.id, { name: 'Kai', timezone: 'UTC', slackHandle: '@kai' });
  store.submitCheckin(team.id, { memberId: member.id, date: '2026-04-01', yesterday: 'A', today: 'B', blockers: '', status: 'green' });
  store.submitCheckin(team.id, { memberId: member.id, date: '2026-04-09', yesterday: 'C', today: 'D', blockers: '', status: 'green' });

  const prune = await request(port, 'POST', '/api/ops/prune-retention', JSON.stringify({ beforeDate: '2026-04-05' }));
  assert.equal(prune.status, 200);
  assert.deepEqual(prune.json, { removed: 1, remaining: 1 });
});

test('returns truthful JSON errors for invalid JSON and unknown members', async () => {
  const invalid = await request(port, 'POST', '/api/teams', '{broken');
  assert.equal(invalid.status, 400);

  const team = await request(
    port,
    'POST',
    '/api/teams',
    JSON.stringify({ name: 'Legal', channel: '#legal', timezone: 'UTC', reminderHour: 10, retentionDays: 30 }),
  );

  const unknownMember = await request(
    port,
    'POST',
    `/api/teams/${team.json.id}/checkins`,
    JSON.stringify({
      memberId: 'missing',
      date: '2026-04-09',
      yesterday: 'A',
      today: 'B',
      blockers: '',
      status: 'green',
    }),
  );
  assert.equal(unknownMember.status, 404);
});
