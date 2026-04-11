import { existsSync, mkdirSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { safeWriteJson } from './safe-write.js';
import { loadProjectState } from './config.js';

export const SCHEDULE_STATE_PATH = '.agentxchain/schedule-state.json';
const SCHEDULE_STATE_SCHEMA_VERSION = '0.1';

function parseIsoTime(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const ts = Date.parse(value);
  return Number.isFinite(ts) ? ts : null;
}

function toIso(value) {
  return new Date(value).toISOString();
}

function normalizeScheduleStateRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {
      last_started_at: null,
      last_finished_at: null,
      last_run_id: null,
      last_status: null,
      last_skip_at: null,
      last_skip_reason: null,
    };
  }

  return {
    last_started_at: typeof value.last_started_at === 'string' ? value.last_started_at : null,
    last_finished_at: typeof value.last_finished_at === 'string' ? value.last_finished_at : null,
    last_run_id: typeof value.last_run_id === 'string' ? value.last_run_id : null,
    last_status: typeof value.last_status === 'string' ? value.last_status : null,
    last_skip_at: typeof value.last_skip_at === 'string' ? value.last_skip_at : null,
    last_skip_reason: typeof value.last_skip_reason === 'string' ? value.last_skip_reason : null,
  };
}

function normalizeScheduleState(value, config) {
  const schedules = {};
  const configuredIds = Object.keys(config?.schedules || {});
  for (const scheduleId of configuredIds) {
    schedules[scheduleId] = normalizeScheduleStateRecord(value?.schedules?.[scheduleId]);
  }

  return {
    schema_version: SCHEDULE_STATE_SCHEMA_VERSION,
    schedules,
  };
}

export function readScheduleState(root, config) {
  const absPath = join(root, SCHEDULE_STATE_PATH);
  if (!existsSync(absPath)) {
    return normalizeScheduleState(null, config);
  }

  try {
    const parsed = JSON.parse(readFileSync(absPath, 'utf8'));
    return normalizeScheduleState(parsed, config);
  } catch {
    return normalizeScheduleState(null, config);
  }
}

export function writeScheduleState(root, state) {
  const absPath = join(root, SCHEDULE_STATE_PATH);
  mkdirSync(dirname(absPath), { recursive: true });
  safeWriteJson(absPath, state);
}

export function updateScheduleState(root, config, scheduleId, updater) {
  const state = readScheduleState(root, config);
  const current = normalizeScheduleStateRecord(state.schedules[scheduleId]);
  state.schedules[scheduleId] = normalizeScheduleStateRecord(updater(current));
  writeScheduleState(root, state);
  return state.schedules[scheduleId];
}

export function computeScheduleStatus(schedule, record, now = Date.now()) {
  if (schedule.enabled === false) {
    return {
      due: false,
      next_due_at: null,
      due_reason: 'disabled',
    };
  }

  const lastStartedAt = parseIsoTime(record.last_started_at);
  if (lastStartedAt === null) {
    return {
      due: true,
      next_due_at: toIso(now),
      due_reason: 'never_started',
    };
  }

  const nextDueTs = lastStartedAt + (schedule.every_minutes * 60 * 1000);
  return {
    due: now >= nextDueTs,
    next_due_at: toIso(nextDueTs),
    due_reason: now >= nextDueTs ? 'interval_elapsed' : 'waiting_interval',
  };
}

export function listSchedules(root, config, { at } = {}) {
  const now = at ? Date.parse(at) : Date.now();
  const scheduleState = readScheduleState(root, config);
  const projectState = loadProjectState(root, config);
  const projectStatus = projectState?.status || 'missing';

  return Object.entries(config?.schedules || {}).map(([scheduleId, schedule]) => {
    const record = scheduleState.schedules[scheduleId] || normalizeScheduleStateRecord(null);
    const status = computeScheduleStatus(schedule, record, now);
    return {
      id: scheduleId,
      enabled: schedule.enabled !== false,
      every_minutes: schedule.every_minutes,
      auto_approve: schedule.auto_approve !== false,
      max_turns: schedule.max_turns ?? 50,
      initial_role: schedule.initial_role || null,
      trigger_reason: schedule.trigger_reason || `schedule:${scheduleId}`,
      due: status.due,
      due_reason: status.due_reason,
      next_due_at: status.next_due_at,
      project_status: projectStatus,
      last_started_at: record.last_started_at,
      last_finished_at: record.last_finished_at,
      last_run_id: record.last_run_id,
      last_status: record.last_status,
      last_skip_at: record.last_skip_at,
      last_skip_reason: record.last_skip_reason,
    };
  });
}

export function evaluateScheduleLaunchEligibility(root, config) {
  const projectState = loadProjectState(root, config);
  const status = projectState?.status || 'missing';

  if (status === 'missing' || status === 'idle' || status === 'completed') {
    return { ok: true, status };
  }

  if (status === 'blocked') {
    return { ok: false, status, reason: 'run_blocked' };
  }

  if (status === 'active') {
    return { ok: false, status, reason: 'run_active' };
  }

  if (status === 'paused') {
    return { ok: false, status, reason: 'run_paused' };
  }

  return { ok: false, status, reason: `run_${status}` };
}
