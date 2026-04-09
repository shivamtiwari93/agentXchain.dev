'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.STANDUP_BOT_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'async-standup-store-'));

const store = require('../src/store');

test.beforeEach(() => {
  store.clear();
});

test('creates and lists teams with empty submission state', () => {
  const team = store.createTeam({
    name: 'Platform',
    channel: '#platform-standup',
    timezone: 'America/Toronto',
    reminderHour: 9,
    retentionDays: 21,
  });

  const teams = store.listTeams('2026-04-09');
  assert.equal(teams.length, 1);
  assert.equal(teams[0].id, team.id);
  assert.equal(teams[0].submittedCount, 0);
  assert.equal(teams[0].pendingCount, 0);
});

test('adds members and rejects duplicate names on the same team', () => {
  const team = store.createTeam({ name: 'Growth', channel: '#growth', timezone: 'UTC', reminderHour: 10, retentionDays: 30 });

  const member = store.addMember(team.id, { name: 'Avery', timezone: 'UTC', slackHandle: '@avery' });
  assert.equal(member.name, 'Avery');

  assert.throws(
    () => store.addMember(team.id, { name: 'avery', timezone: 'UTC', slackHandle: '' }),
    error => error.code === 'DUPLICATE_MEMBER',
  );
});

test('upserts standups per member and date instead of duplicating them', () => {
  const team = store.createTeam({ name: 'Core', channel: '#core', timezone: 'UTC', reminderHour: 10, retentionDays: 30 });
  const member = store.addMember(team.id, { name: 'Jules', timezone: 'UTC', slackHandle: '@jules' });

  const first = store.submitCheckin(team.id, {
    memberId: member.id,
    date: '2026-04-09',
    yesterday: 'Shipped dashboard slice',
    today: 'Polish tests',
    blockers: '',
    status: 'green',
  });
  const second = store.submitCheckin(team.id, {
    memberId: member.id,
    date: '2026-04-09',
    yesterday: 'Shipped dashboard slice',
    today: 'Fix retention copy',
    blockers: 'Waiting on review',
    status: 'blocked',
  });

  const data = store.load();
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(data.checkins.length, 1);
  assert.equal(data.checkins[0].today, 'Fix retention copy');
  assert.equal(data.checkins[0].status, 'blocked');
});

test('builds a summary with missing members and blocker count', () => {
  const team = store.createTeam({ name: 'Product', channel: '#product', timezone: 'UTC', reminderHour: 10, retentionDays: 30 });
  const alex = store.addMember(team.id, { name: 'Alex', timezone: 'UTC', slackHandle: '@alex' });
  store.addMember(team.id, { name: 'Blair', timezone: 'UTC', slackHandle: '@blair' });

  store.submitCheckin(team.id, {
    memberId: alex.id,
    date: '2026-04-09',
    yesterday: 'Closed launch checklist',
    today: 'Draft onboarding email',
    blockers: 'Waiting on legal copy',
    status: 'blocked',
  });

  const summary = store.getSummary(team.id, '2026-04-09');
  assert.equal(summary.submitted.length, 1);
  assert.equal(summary.missingMembers.length, 1);
  assert.equal(summary.missingMembers[0].name, 'Blair');
  assert.equal(summary.blockerCount, 1);
  assert.match(summary.markdown, /Waiting on legal copy/);
});

test('creates reminder previews only for members who have not submitted', () => {
  const team = store.createTeam({ name: 'Ops', channel: '#ops', timezone: 'UTC', reminderHour: 11, retentionDays: 30 });
  const sam = store.addMember(team.id, { name: 'Sam', timezone: 'UTC', slackHandle: '@sam' });
  store.addMember(team.id, { name: 'Taylor', timezone: 'UTC', slackHandle: '@taylor' });

  store.submitCheckin(team.id, {
    memberId: sam.id,
    date: '2026-04-09',
    yesterday: 'Cleared alerts',
    today: 'Audit dashboards',
    blockers: '',
    status: 'green',
  });

  const reminders = store.getReminderPreview(team.id, '2026-04-09');
  assert.equal(reminders.reminders.length, 1);
  assert.equal(reminders.reminders[0].memberName, 'Taylor');
  assert.match(reminders.reminders[0].message, /#ops/);
});

test('prunes historical standups older than the cutoff date', () => {
  const team = store.createTeam({ name: 'QA', channel: '#qa', timezone: 'UTC', reminderHour: 10, retentionDays: 30 });
  const member = store.addMember(team.id, { name: 'Mina', timezone: 'UTC', slackHandle: '@mina' });

  store.submitCheckin(team.id, {
    memberId: member.id,
    date: '2026-04-01',
    yesterday: 'Regression testing',
    today: 'Retry flaky spec',
    blockers: '',
    status: 'green',
  });
  store.submitCheckin(team.id, {
    memberId: member.id,
    date: '2026-04-09',
    yesterday: 'Closed flaky spec',
    today: 'Ship patch',
    blockers: '',
    status: 'green',
  });

  const result = store.pruneRetention('2026-04-05');
  assert.deepEqual(result, { removed: 1, remaining: 1 });
  assert.equal(store.load().checkins.length, 1);
  assert.equal(store.load().checkins[0].date, '2026-04-09');
});

test('recovers from a corrupted data file with an empty store', () => {
  fs.writeFileSync(path.join(process.env.STANDUP_BOT_DATA_DIR, 'standups.json'), '{not-json');
  const data = store.load();
  assert.deepEqual(data, { teams: [], checkins: [] });
});
