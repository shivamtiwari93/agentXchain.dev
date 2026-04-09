'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function getDataDir() {
  return process.env.STANDUP_BOT_DATA_DIR || path.join(__dirname, '..', 'data');
}

function getDataFile() {
  return path.join(getDataDir(), 'standups.json');
}

function ensureDataDir() {
  if (!fs.existsSync(getDataDir())) {
    fs.mkdirSync(getDataDir(), { recursive: true });
  }
}

function load() {
  ensureDataDir();
  try {
    const raw = fs.readFileSync(getDataFile(), 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.teams) || !Array.isArray(parsed.checkins)) {
      return { teams: [], checkins: [] };
    }
    return parsed;
  } catch {
    return { teams: [], checkins: [] };
  }
}

function save(data) {
  ensureDataDir();
  fs.writeFileSync(getDataFile(), JSON.stringify(data, null, 2));
}

function createStoreError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function todayDateString(value) {
  const date = value ? new Date(value) : new Date();
  return date.toISOString().slice(0, 10);
}

function isValidDateString(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function normalizeHour(value) {
  const hour = Number(value);
  return Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : 10;
}

function getTeamRecord(data, teamId) {
  return data.teams.find(team => team.id === teamId) || null;
}

function getCheckinsForTeamDate(data, teamId, date) {
  return data.checkins.filter(checkin => checkin.teamId === teamId && checkin.date === date);
}

function formatReminderHour(hour) {
  return `${String(hour).padStart(2, '0')}:00`;
}

function deriveStatus(status, blockers) {
  if (status) {
    return status;
  }
  return blockers && blockers.trim() ? 'blocked' : 'green';
}

function createTeam({ name, channel, timezone, reminderHour, retentionDays }) {
  const data = load();
  const team = {
    id: crypto.randomUUID(),
    name,
    channel,
    timezone: timezone || 'UTC',
    reminderHour: normalizeHour(reminderHour),
    retentionDays: Number.isInteger(Number(retentionDays)) ? Number(retentionDays) : 30,
    createdAt: new Date().toISOString(),
    members: [],
  };
  data.teams.push(team);
  save(data);
  return team;
}

function listTeams(date) {
  const data = load();
  const targetDate = date || todayDateString();
  return data.teams
    .map(team => {
      const summary = getSummary(team.id, targetDate, data);
      return {
        id: team.id,
        name: team.name,
        channel: team.channel,
        timezone: team.timezone,
        reminderHour: team.reminderHour,
        retentionDays: team.retentionDays,
        memberCount: team.members.length,
        submittedCount: summary.submitted.length,
        pendingCount: summary.missingMembers.length,
        blockerCount: summary.blockerCount,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function getTeam(teamId, date, dataOverride) {
  const data = dataOverride || load();
  const targetDate = date || todayDateString();
  const team = getTeamRecord(data, teamId);
  if (!team) {
    return null;
  }

  const checkins = getCheckinsForTeamDate(data, teamId, targetDate);
  const checkinByMember = new Map(checkins.map(checkin => [checkin.memberId, checkin]));

  return {
    ...team,
    members: [...team.members]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(member => ({
        ...member,
        submitted: checkinByMember.has(member.id),
        status: checkinByMember.get(member.id)?.status || null,
      })),
  };
}

function addMember(teamId, { name, timezone, slackHandle }) {
  const data = load();
  const team = getTeamRecord(data, teamId);
  if (!team) {
    throw createStoreError('TEAM_NOT_FOUND', 'Team not found');
  }
  const normalizedName = name.trim().toLowerCase();
  if (team.members.some(member => member.name.trim().toLowerCase() === normalizedName)) {
    throw createStoreError('DUPLICATE_MEMBER', 'Member name already exists on this team');
  }

  const member = {
    id: crypto.randomUUID(),
    name,
    timezone,
    slackHandle: slackHandle || '',
    createdAt: new Date().toISOString(),
  };
  team.members.push(member);
  team.members.sort((a, b) => a.name.localeCompare(b.name));
  save(data);
  return member;
}

function submitCheckin(teamId, { memberId, yesterday, today, blockers, status, date }) {
  const data = load();
  const team = getTeamRecord(data, teamId);
  if (!team) {
    throw createStoreError('TEAM_NOT_FOUND', 'Team not found');
  }
  const member = team.members.find(entry => entry.id === memberId);
  if (!member) {
    throw createStoreError('MEMBER_NOT_FOUND', 'Member not found');
  }

  const targetDate = date || todayDateString();
  const finalStatus = deriveStatus(status, blockers);
  const existing = data.checkins.find(
    checkin => checkin.teamId === teamId && checkin.memberId === memberId && checkin.date === targetDate,
  );

  if (existing) {
    existing.yesterday = yesterday;
    existing.today = today;
    existing.blockers = blockers || '';
    existing.status = finalStatus;
    existing.submittedAt = new Date().toISOString();
    save(data);
    return { created: false, checkin: existing };
  }

  const checkin = {
    id: crypto.randomUUID(),
    teamId,
    memberId,
    date: targetDate,
    yesterday,
    today,
    blockers: blockers || '',
    status: finalStatus,
    submittedAt: new Date().toISOString(),
  };
  data.checkins.push(checkin);
  save(data);
  return { created: true, checkin };
}

function getSummary(teamId, date, dataOverride) {
  const data = dataOverride || load();
  const targetDate = date || todayDateString();
  const team = getTeamRecord(data, teamId);
  if (!team) {
    throw createStoreError('TEAM_NOT_FOUND', 'Team not found');
  }

  const checkins = getCheckinsForTeamDate(data, teamId, targetDate);
  const membersById = new Map(team.members.map(member => [member.id, member]));
  const submitted = checkins
    .map(checkin => ({
      ...checkin,
      memberName: membersById.get(checkin.memberId)?.name || 'Unknown member',
      slackHandle: membersById.get(checkin.memberId)?.slackHandle || '',
    }))
    .sort((a, b) => a.memberName.localeCompare(b.memberName));
  const submittedIds = new Set(submitted.map(entry => entry.memberId));
  const missingMembers = team.members
    .filter(member => !submittedIds.has(member.id))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(member => ({
      id: member.id,
      name: member.name,
      slackHandle: member.slackHandle,
      timezone: member.timezone,
    }));
  const blockerCount = submitted.filter(entry => entry.status === 'blocked' || entry.blockers.trim()).length;

  const markdownLines = [
    `# ${team.name} async standup (${targetDate})`,
    `Channel: ${team.channel}`,
    `Submitted: ${submitted.length}/${team.members.length}`,
    `Missing: ${missingMembers.length ? missingMembers.map(member => member.name).join(', ') : 'none'}`,
    `Blockers: ${blockerCount}`,
    '',
    '## Updates',
  ];

  if (submitted.length === 0) {
    markdownLines.push('- No updates submitted yet.');
  } else {
    for (const entry of submitted) {
      markdownLines.push(`- ${entry.memberName} [${entry.status}]`);
      markdownLines.push(`  Yesterday: ${entry.yesterday}`);
      markdownLines.push(`  Today: ${entry.today}`);
      markdownLines.push(`  Blockers: ${entry.blockers || 'none'}`);
    }
  }

  return {
    team: {
      id: team.id,
      name: team.name,
      channel: team.channel,
      timezone: team.timezone,
      reminderHour: team.reminderHour,
      retentionDays: team.retentionDays,
    },
    date: targetDate,
    submitted,
    missingMembers,
    blockerCount,
    markdown: markdownLines.join('\n'),
  };
}

function getReminderPreview(teamId, date, dataOverride) {
  const summary = getSummary(teamId, date, dataOverride);
  return {
    team: summary.team,
    date: summary.date,
    reminders: summary.missingMembers.map(member => ({
      memberId: member.id,
      memberName: member.name,
      slackHandle: member.slackHandle,
      message: `Reminder for ${member.name}: please post your async standup in ${summary.team.channel} by ${formatReminderHour(summary.team.reminderHour)} ${summary.team.timezone}.`,
    })),
  };
}

function pruneRetention(beforeDate) {
  const data = load();
  const originalCount = data.checkins.length;
  data.checkins = data.checkins.filter(checkin => checkin.date >= beforeDate);
  const removed = originalCount - data.checkins.length;
  save(data);
  return { removed, remaining: data.checkins.length };
}

function clear() {
  save({ teams: [], checkins: [] });
}

module.exports = {
  addMember,
  clear,
  createTeam,
  getReminderPreview,
  getSummary,
  getTeam,
  isValidDateString,
  listTeams,
  load,
  pruneRetention,
  submitCheckin,
  todayDateString,
};
