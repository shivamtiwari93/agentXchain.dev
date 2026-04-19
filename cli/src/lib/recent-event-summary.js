import { readRunEvents } from './run-events.js';

export const RECENT_EVENT_WINDOW_MINUTES = 15;
export const RECENT_EVENT_WINDOW_MS = RECENT_EVENT_WINDOW_MINUTES * 60 * 1000;

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isValidTimestamp(timestamp) {
  return typeof timestamp === 'string' && timestamp.trim().length > 0 && !Number.isNaN(new Date(timestamp).getTime());
}

function trimToNull(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function describeEvent(eventType, entry) {
  const repoId = trimToNull(entry.repo_id);
  const roleId = trimToNull(entry.role_id);
  const gateId = trimToNull(entry.payload?.gate_id) || trimToNull(entry.gate);
  const prefix = repoId ? `[${repoId}] ` : '';

  switch (eventType) {
    case 'turn_dispatched':
    case 'turn_accepted':
    case 'turn_rejected':
      return `${prefix}${eventType}${roleId ? ` [${roleId}]` : ''}`;
    case 'phase_entered': {
      const fromPhase = trimToNull(entry.payload?.from);
      const toPhase = trimToNull(entry.payload?.to) || trimToNull(entry.phase);
      if (fromPhase && toPhase) return `${prefix}${eventType} ${fromPhase} -> ${toPhase}`;
      return `${prefix}${eventType}`;
    }
    case 'gate_pending':
    case 'gate_approved':
    case 'gate_failed':
      return `${prefix}${eventType}${gateId ? ` (${gateId})` : ''}`;
    case 'turn_conflicted':
      return `${prefix}${eventType}${roleId ? ` [${roleId}]` : ''}`;
    case 'conflict_resolved': {
      const resolution = trimToNull(entry.payload?.resolution);
      return `${prefix}${eventType}${roleId ? ` [${roleId}]` : ''}${resolution ? ` via ${resolution}` : ''}`;
    }
    case 'coordinator_retry': {
      const wsId = trimToNull(entry.payload?.workstream_id);
      const retryRepo = trimToNull(entry.payload?.repo_id);
      return `${prefix}${eventType}${wsId ? ` ${wsId}` : ''}${retryRepo ? ` (${retryRepo})` : ''}`;
    }
    case 'coordinator_retry_projection_warning': {
      const wsIdWarn = trimToNull(entry.payload?.workstream_id);
      const warnRepo = trimToNull(entry.payload?.repo_id);
      return `${prefix}${eventType}${wsIdWarn ? ` ${wsIdWarn}` : ''}${warnRepo ? ` (${warnRepo})` : ''} — reconciliation required`;
    }
    case 'turn_checkpointed':
      return `${prefix}${eventType}${roleId ? ` [${roleId}]` : ''}`;
    case 'dispatch_progress':
      return `${prefix}${eventType}${roleId ? ` [${roleId}]` : ''}`;
    case 'intents_migrated':
    case 'intents_superseded':
    case 'intent_retired_by_phase_advance': {
      const count = Number.isFinite(entry.payload?.archived_count)
        ? entry.payload.archived_count
        : (
          Number.isFinite(entry.payload?.superseded_count)
            ? entry.payload.superseded_count
            : (Number.isFinite(entry.payload?.retired_count) ? entry.payload.retired_count : null)
        );
      return `${prefix}${eventType}${count !== null ? ` (${count})` : ''}`;
    }
    case 'run_blocked':
    case 'run_completed':
    case 'run_started':
    case 'escalation_raised':
    case 'escalation_resolved':
    case 'budget_exceeded_warn':
      return `${prefix}${eventType}`;
    default:
      if (trimToNull(entry.summary)) return entry.summary.trim();
      return `${prefix}${eventType || 'unknown_event'}`;
  }
}

export function normalizeRecentEventEntry(entry) {
  if (!isObject(entry)) return null;
  const turn = isObject(entry.turn) ? entry.turn : null;
  const eventType = trimToNull(entry.event_type) || trimToNull(entry.type) || 'unknown_event';
  const phase = trimToNull(entry.phase);
  const status = trimToNull(entry.status);
  const turnId = trimToNull(turn?.turn_id) || trimToNull(entry.turn_id) || null;
  const roleId = trimToNull(turn?.role_id)
    || trimToNull(turn?.assigned_role)
    || trimToNull(entry.role_id)
    || trimToNull(entry.role)
    || null;
  const repoId = trimToNull(entry.repo_id);
  const timestamp = trimToNull(entry.timestamp);

  return {
    event_type: eventType,
    timestamp,
    phase,
    status,
    turn_id: turnId,
    role_id: roleId,
    repo_id: repoId,
    summary: describeEvent(eventType, { ...entry, role_id: roleId, repo_id: repoId, turn }),
  };
}

export function buildRecentEventSummary(entries, { now = Date.now(), windowMs = RECENT_EVENT_WINDOW_MS } = {}) {
  const normalized = Array.isArray(entries)
    ? entries.map(normalizeRecentEventEntry).filter(Boolean)
    : [];

  if (normalized.length === 0) {
    return {
      window_minutes: Math.round(windowMs / 60000),
      freshness: 'no_events',
      recent_count: 0,
      latest_event: null,
    };
  }

  const latestEvent = normalized[normalized.length - 1];
  const recentCount = normalized.filter((event) => {
    if (!isValidTimestamp(event.timestamp)) return false;
    return (now - new Date(event.timestamp).getTime()) <= windowMs;
  }).length;

  let freshness = 'unknown';
  if (isValidTimestamp(latestEvent.timestamp)) {
    freshness = (now - new Date(latestEvent.timestamp).getTime()) <= windowMs ? 'recent' : 'quiet';
  }

  return {
    window_minutes: Math.round(windowMs / 60000),
    freshness,
    recent_count: recentCount,
    latest_event: latestEvent,
  };
}

export function readRecentRunEventSummary(root, opts = {}) {
  const events = readRunEvents(root);
  return buildRecentEventSummary(events, opts);
}

export function formatRecentEventSummaryLine(summary, scopeLabel = null) {
  const prefix = scopeLabel ? `${scopeLabel}: ` : '';
  if (!summary || typeof summary !== 'object') return `${prefix}unknown`;
  const countLabel = `${summary.recent_count || 0} in last ${summary.window_minutes || RECENT_EVENT_WINDOW_MINUTES}m`;
  switch (summary.freshness) {
    case 'recent':
      return `${prefix}recent (${countLabel})`;
    case 'quiet':
      return `${prefix}quiet (${countLabel})`;
    case 'unknown':
      return `${prefix}unknown timing`;
    case 'no_events':
    default:
      return `${prefix}none recorded`;
  }
}
