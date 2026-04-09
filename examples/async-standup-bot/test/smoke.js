'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.STANDUP_BOT_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'async-standup-smoke-'));

const store = require('../src/store');

store.clear();

const team = store.createTeam({
  name: 'Launch',
  channel: '#launch-async',
  timezone: 'America/Toronto',
  reminderHour: 10,
  retentionDays: 14,
});
const alex = store.addMember(team.id, { name: 'Alex', timezone: 'America/Toronto', slackHandle: '@alex' });
store.addMember(team.id, { name: 'Blair', timezone: 'America/Toronto', slackHandle: '@blair' });

store.submitCheckin(team.id, {
  memberId: alex.id,
  date: '2026-04-09',
  yesterday: 'Published release notes',
  today: 'Watch deployment',
  blockers: 'Awaiting DNS cutover',
  status: 'blocked',
});

const summary = store.getSummary(team.id, '2026-04-09');
assert.match(summary.markdown, /Launch async standup/);
assert.match(summary.markdown, /Blair/);
assert.equal(summary.blockerCount, 1);

console.log('PASS');
