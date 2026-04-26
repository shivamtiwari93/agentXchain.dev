/**
 * run-events.js — Repo-local structured event log for governed runs.
 *
 * Appends lifecycle events to `.agentxchain/events.jsonl` so operators
 * can observe run progress without webhooks or dashboard.
 */

import { appendFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';

export const RUN_EVENTS_PATH = '.agentxchain/events.jsonl';

export const VALID_RUN_EVENTS = [
  'run_started',
  'phase_entered',
  'intents_migrated',
  'intents_superseded',
  'intent_retired_by_phase_advance',
  'turn_dispatched',
  'turn_accepted',
  'turn_rejected',
  'turn_conflicted',
  'conflict_resolved',
  'acceptance_failed',
  'turn_reissued',
  'turn_stalled',
  'turn_start_failed',
  'runtime_spawn_failed',
  'stdout_attach_failed',
  'turn_checkpointed',
  'coordinator_retry',
  'coordinator_retry_projection_warning',
  'run_blocked',
  'run_completed',
  'escalation_raised',
  'escalation_resolved',
  'gate_pending',
  'gate_approved',
  'gate_failed',
  'phase_cleanup',
  'budget_exceeded_warn',
  'human_escalation_raised',
  'human_escalation_resolved',
  'dispatch_progress',
  'session_continuation',
  'auto_retried_ghost',
  'ghost_retry_exhausted',
  'state_reconciled_operator_commits',
  'operator_commit_reconcile_refused',
  'charter_materialization_required',
  'artifact_type_auto_normalized',
];

/**
 * Emit a structured lifecycle event to the local event log.
 *
 * @param {string} root        - Project root directory
 * @param {string} eventType   - One of VALID_RUN_EVENTS
 * @param {object} details     - Event details
 * @param {string} [details.run_id]  - Current run ID
 * @param {string} [details.phase]   - Current phase
 * @param {string} [details.status]  - Current run status
 * @param {object} [details.turn]    - Turn context (turn_id, role_id, etc.)
 * @param {string} [details.intent_id] - Intake intent id when the event services queued intake work
 * @param {object} [details.payload] - Additional event-specific data
 * @returns {{ ok: boolean, event_id: string }}
 */
export function emitRunEvent(root, eventType, details = {}) {
  const event_id = `evt_${randomBytes(8).toString('hex')}`;
  const entry = {
    event_id,
    event_type: eventType,
    timestamp: new Date().toISOString(),
    run_id: details.run_id || null,
    phase: details.phase || null,
    status: details.status || null,
    turn: details.turn || null,
    intent_id: details.intent_id || null,
    payload: details.payload || {},
  };

  try {
    const filePath = join(root, RUN_EVENTS_PATH);
    const dir = dirname(filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    appendFileSync(filePath, `${JSON.stringify(entry)}\n`);
    return { ok: true, event_id };
  } catch (err) {
    // Best-effort — never interrupt governed operations for event logging.
    if (process.env.AGENTXCHAIN_DEBUG) {
      process.stderr.write(`[run-events] write failed: ${err.message}\n`);
    }
    return { ok: false, event_id };
  }
}

/**
 * Read events from the local event log.
 *
 * @param {string} root      - Project root directory
 * @param {object} [opts]    - Filter options
 * @param {string} [opts.type]   - Comma-separated event types to include
 * @param {string} [opts.since]  - ISO-8601 timestamp; only events after this
 * @param {number} [opts.limit]  - Max events to return (from end of file)
 * @returns {object[]}
 */
export function readRunEvents(root, opts = {}) {
  const filePath = join(root, RUN_EVENTS_PATH);
  if (!existsSync(filePath)) return [];

  const raw = readFileSync(filePath, 'utf8');
  const lines = raw.split('\n').filter(Boolean);

  let events = [];
  for (const line of lines) {
    try {
      events.push(JSON.parse(line));
    } catch {
      // Skip malformed lines.
    }
  }

  // Apply type filter.
  if (opts.type) {
    const types = new Set(opts.type.split(',').map(t => t.trim()));
    events = events.filter(e => types.has(e.event_type));
  }

  // Apply since filter.
  if (opts.since) {
    const sinceMs = new Date(opts.since).getTime();
    if (!Number.isNaN(sinceMs)) {
      events = events.filter(e => new Date(e.timestamp).getTime() > sinceMs);
    }
  }

  // Apply limit (from end).
  if (opts.limit && opts.limit > 0 && events.length > opts.limit) {
    events = events.slice(-opts.limit);
  }

  return events;
}
