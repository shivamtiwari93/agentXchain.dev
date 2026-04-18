import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, basename, resolve as pathResolve } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { safeWriteJson } from './safe-write.js';
import { VALID_GOVERNED_TEMPLATE_IDS, loadGovernedTemplate } from './governed-templates.js';
import {
  initializeGovernedRun,
  assignGovernedTurn,
  getActiveTurns,
  getActiveTurnCount,
  STATE_PATH,
} from './governed-state.js';
import { loadProjectContext, loadProjectState } from './config.js';
import { writeDispatchBundle } from './dispatch-bundle.js';
import { finalizeDispatchManifest } from './dispatch-manifest.js';
import { getDispatchTurnDir } from './turn-paths.js';
import { loadCoordinatorConfig } from './coordinator-config.js';
import { loadCoordinatorState, readBarriers } from './coordinator-state.js';
import { writeCoordinatorHandoff } from './intake-handoff.js';

const VALID_SOURCES = ['manual', 'ci_failure', 'git_ref_change', 'schedule', 'vision_scan'];
const VALID_PRIORITIES = ['p0', 'p1', 'p2', 'p3'];
const EVENT_ID_RE = /^evt_\d+_[0-9a-f]{4}$/;
const INTENT_ID_RE = /^intent_\d+_[0-9a-f]{4}$/;

// V3-S1 through S5 states. `failed` remains read-tolerant for historical/manual
// intent files, but current first-party intake writers do not transition into it.
const S1_STATES = new Set(['detected', 'triaged', 'approved', 'planned', 'executing', 'blocked', 'completed', 'failed', 'suppressed', 'rejected']);
const TERMINAL_STATES = new Set(['suppressed', 'rejected', 'completed', 'failed']);
const DISPATCHABLE_STATUSES = new Set(['planned', 'approved']);
const PRIORITY_RANK = { p0: 0, p1: 1, p2: 2, p3: 3 };

const VALID_TRANSITIONS = {
  detected: ['triaged', 'suppressed'],
  triaged: ['approved', 'rejected'],
  approved: ['planned'],
  planned: ['executing'],
  executing: ['blocked', 'completed'],
  blocked: ['approved'],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateId(prefix) {
  const ts = Date.now();
  const rand = randomBytes(2).toString('hex');
  return `${prefix}_${ts}_${rand}`;
}

function computeDedupKey(source, signal) {
  const sorted = JSON.stringify(signal, Object.keys(signal).sort());
  const hash = createHash('sha256').update(sorted).digest('hex').slice(0, 16);
  return `${source}:${hash}`;
}

function nowISO() {
  return new Date().toISOString();
}

function intakeDirs(root) {
  const base = join(root, '.agentxchain', 'intake');
  return {
    base,
    events: join(base, 'events'),
    intents: join(base, 'intents'),
  };
}

function readIntent(root, intentId) {
  const dirs = intakeDirs(root);
  const intentPath = join(dirs.intents, `${intentId}.json`);
  if (!existsSync(intentPath)) {
    return { ok: false, error: `intent ${intentId} not found`, exitCode: 2 };
  }

  return {
    ok: true,
    intentPath,
    dirs,
    intent: JSON.parse(readFileSync(intentPath, 'utf8')),
  };
}

function readEvent(root, eventId) {
  const dirs = intakeDirs(root);
  const eventPath = join(dirs.events, `${eventId}.json`);
  if (!existsSync(eventPath)) {
    return { ok: false, error: `event ${eventId} not found`, exitCode: 2 };
  }

  return {
    ok: true,
    eventPath,
    event: JSON.parse(readFileSync(eventPath, 'utf8')),
  };
}

function getWorkstreamCompletionBarrierId(workstreamId) {
  return `${workstreamId}_completion`;
}

function ensureIntakeDirs(root) {
  const dirs = intakeDirs(root);
  mkdirSync(dirs.events, { recursive: true });
  mkdirSync(dirs.intents, { recursive: true });
  return dirs;
}

function readJsonDir(dirPath) {
  if (!existsSync(dirPath)) return [];
  return readdirSync(dirPath)
    .filter(f => f.endsWith('.json') && !f.startsWith('.tmp-'))
    .map(f => {
      try {
        return JSON.parse(readFileSync(join(dirPath, f), 'utf8'));
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function buildIntakeNextAction(intent) {
  const intentId = intent?.intent_id || '<intent_id>';
  const status = intent?.status || 'unknown';
  const resolveCommand = `agentxchain intake resolve --intent ${intentId}`;

  switch (status) {
    case 'detected':
      return {
        label: 'triage',
        summary: 'Triage this detected intent so it can enter governed delivery.',
        command: `agentxchain intake triage --intent ${intentId} --priority <p0-p3> --template <template_id> --charter "<charter>" --acceptance "<criterion>"`,
        alternatives: [
          `agentxchain intake triage --intent ${intentId} --suppress --reason "<reason>"`,
        ],
        recovery: null,
        action_required: true,
      };
    case 'triaged':
      return {
        label: 'approve',
        summary: 'Approve this triaged intent for planning or reject it explicitly.',
        command: `agentxchain intake approve --intent ${intentId}`,
        alternatives: [
          `agentxchain intake triage --intent ${intentId} --reject --reason "<reason>"`,
        ],
        recovery: null,
        action_required: true,
      };
    case 'approved':
      return {
        label: 'plan',
        summary: 'Generate planning artifacts for this approved intent.',
        command: `agentxchain intake plan --intent ${intentId}`,
        alternatives: [],
        recovery: null,
        action_required: true,
      };
    case 'planned':
      return {
        label: 'start',
        summary: 'Start repo-local execution or hand the intent off to a coordinator workstream.',
        command: `agentxchain intake start --intent ${intentId}`,
        alternatives: [
          `agentxchain intake handoff --intent ${intentId} --coordinator-root <path> --workstream <id>`,
        ],
        recovery: null,
        action_required: true,
      };
    case 'executing':
      return {
        label: 'resolve',
        summary: intent?.target_workstream
          ? 'Re-check the coordinator workstream outcome for this intent.'
          : 'Re-check the governed run outcome for this intent.',
        command: resolveCommand,
        alternatives: [],
        recovery: null,
        action_required: true,
      };
    case 'blocked':
      return {
        label: 'recover',
        summary: 'Resolve the linked run blockage, then re-check intake resolution.',
        command: resolveCommand,
        alternatives: [],
        recovery: intent?.run_blocked_recovery || null,
        action_required: true,
      };
    case 'completed':
      return {
        label: 'none',
        summary: 'No action required. This intent completed successfully.',
        command: null,
        alternatives: [],
        recovery: null,
        action_required: false,
      };
    case 'suppressed':
      return {
        label: 'none',
        summary: 'No action required. This intent was suppressed.',
        command: null,
        alternatives: [],
        recovery: null,
        action_required: false,
      };
    case 'rejected':
      return {
        label: 'none',
        summary: 'No action required. This intent was rejected.',
        command: null,
        alternatives: [],
        recovery: null,
        action_required: false,
      };
    case 'failed':
      return {
        label: 'inspect',
        summary: 'Manual inspection required. This intent is in a reserved failed state.',
        command: null,
        alternatives: [],
        recovery: 'Inspect the linked intent and run artifacts manually before continuing.',
        action_required: true,
      };
    default:
      return {
        label: 'inspect',
        summary: 'Manual inspection required. The intent state is not recognized by the current intake surface.',
        command: null,
        alternatives: [],
        recovery: null,
        action_required: true,
      };
  }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export function validateEventPayload(payload) {
  const errors = [];

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { valid: false, errors: ['payload must be a JSON object'] };
  }

  if (!VALID_SOURCES.includes(payload.source)) {
    errors.push(`source must be one of: ${VALID_SOURCES.join(', ')}`);
  }

  if (!payload.signal || typeof payload.signal !== 'object' || Array.isArray(payload.signal) || Object.keys(payload.signal).length === 0) {
    errors.push('signal must be a non-empty object');
  }

  if (!Array.isArray(payload.evidence) || payload.evidence.length === 0) {
    errors.push('evidence must be a non-empty array');
  } else {
    for (const e of payload.evidence) {
      if (!e || typeof e !== 'object') {
        errors.push('each evidence entry must be an object');
      } else {
        if (!['url', 'file', 'text'].includes(e.type)) {
          errors.push(`evidence type must be one of: url, file, text (got "${e.type}")`);
        }
        if (typeof e.value !== 'string' || !e.value.trim()) {
          errors.push('evidence value must be a non-empty string');
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

export function validateTriageFields(fields) {
  const errors = [];

  if (!VALID_PRIORITIES.includes(fields.priority)) {
    errors.push(`priority must be one of: ${VALID_PRIORITIES.join(', ')}`);
  }

  if (!VALID_GOVERNED_TEMPLATE_IDS.includes(fields.template)) {
    errors.push(`template must be one of: ${VALID_GOVERNED_TEMPLATE_IDS.join(', ')}`);
  }

  if (typeof fields.charter !== 'string' || !fields.charter.trim()) {
    errors.push('charter must be a non-empty string');
  }

  if (!Array.isArray(fields.acceptance_contract) || fields.acceptance_contract.length === 0) {
    errors.push('acceptance_contract must be a non-empty array');
  }

  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Record
// ---------------------------------------------------------------------------

export function recordEvent(root, payload) {
  const validation = validateEventPayload(payload);
  if (!validation.valid) {
    return { ok: false, error: validation.errors.join('; '), exitCode: 1 };
  }

  const dirs = ensureIntakeDirs(root);
  const dedupKey = computeDedupKey(payload.source, payload.signal);

  // Check for duplicate
  const existingEvents = readJsonDir(dirs.events);
  const dup = existingEvents.find(e => e.dedup_key === dedupKey);
  if (dup) {
    const existingIntents = readJsonDir(dirs.intents);
    const linkedIntent = existingIntents.find(i => i.event_id === dup.event_id);
    return { ok: true, event: dup, intent: linkedIntent || null, deduplicated: true, exitCode: 0 };
  }

  const now = nowISO();
  const eventId = generateId('evt');
  const event = {
    schema_version: '1.0',
    event_id: eventId,
    source: payload.source,
    category: payload.category || `${payload.source}_signal`,
    created_at: now,
    repo: payload.repo || null,
    ref: payload.ref || null,
    signal: payload.signal,
    evidence: payload.evidence,
    dedup_key: dedupKey,
  };

  safeWriteJson(join(dirs.events, `${eventId}.json`), event);

  // Create detected intent
  const intentId = generateId('intent');
  const intent = {
    schema_version: '1.0',
    intent_id: intentId,
    event_id: eventId,
    status: 'detected',
    priority: null,
    template: null,
    charter: null,
    acceptance_contract: [],
    requires_human_start: true,
    target_run: null,
    created_at: now,
    updated_at: now,
    history: [
      { from: null, to: 'detected', at: now, reason: 'event ingested' },
    ],
  };

  safeWriteJson(join(dirs.intents, `${intentId}.json`), intent);

  return { ok: true, event, intent, deduplicated: false, exitCode: 0 };
}

// ---------------------------------------------------------------------------
// Triage
// ---------------------------------------------------------------------------

export function triageIntent(root, intentId, fields) {
  const dirs = intakeDirs(root);
  const intentPath = join(dirs.intents, `${intentId}.json`);

  if (!existsSync(intentPath)) {
    return { ok: false, error: `intent ${intentId} not found`, exitCode: 2 };
  }

  const intent = JSON.parse(readFileSync(intentPath, 'utf8'));

  // Suppress path
  if (fields.suppress) {
    if (intent.status !== 'detected') {
      return { ok: false, error: `cannot suppress from status "${intent.status}" (must be detected)`, exitCode: 1 };
    }
    if (!fields.reason) {
      return { ok: false, error: 'suppress requires --reason', exitCode: 1 };
    }
    const now = nowISO();
    intent.status = 'suppressed';
    intent.updated_at = now;
    intent.history.push({ from: 'detected', to: 'suppressed', at: now, reason: fields.reason });
    safeWriteJson(intentPath, intent);
    return { ok: true, intent, exitCode: 0 };
  }

  // Reject path
  if (fields.reject) {
    if (intent.status !== 'triaged') {
      return { ok: false, error: `cannot reject from status "${intent.status}" (must be triaged)`, exitCode: 1 };
    }
    if (!fields.reason) {
      return { ok: false, error: 'reject requires --reason', exitCode: 1 };
    }
    const now = nowISO();
    intent.status = 'rejected';
    intent.updated_at = now;
    intent.history.push({ from: 'triaged', to: 'rejected', at: now, reason: fields.reason });
    safeWriteJson(intentPath, intent);
    return { ok: true, intent, exitCode: 0 };
  }

  // Triage path: detected -> triaged
  if (intent.status !== 'detected') {
    return { ok: false, error: `cannot triage from status "${intent.status}" (must be detected)`, exitCode: 1 };
  }

  const validation = validateTriageFields(fields);
  if (!validation.valid) {
    return { ok: false, error: validation.errors.join('; '), exitCode: 1 };
  }

  const now = nowISO();
  intent.status = 'triaged';
  intent.priority = fields.priority;
  intent.template = fields.template;
  intent.charter = fields.charter;
  intent.acceptance_contract = fields.acceptance_contract;
  intent.updated_at = now;
  intent.history.push({ from: 'detected', to: 'triaged', at: now, reason: 'triage completed' });

  safeWriteJson(intentPath, intent);
  return { ok: true, intent, exitCode: 0 };
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export function intakeStatus(root, intentId) {
  const dirs = intakeDirs(root);

  if (intentId) {
    const intentPath = join(dirs.intents, `${intentId}.json`);
    if (!existsSync(intentPath)) {
      return { ok: false, error: `intent ${intentId} not found`, exitCode: 2 };
    }
    const intent = JSON.parse(readFileSync(intentPath, 'utf8'));
    const eventPath = join(dirs.events, `${intent.event_id}.json`);
    const event = existsSync(eventPath) ? JSON.parse(readFileSync(eventPath, 'utf8')) : null;
    return {
      ok: true,
      intent,
      event,
      next_action: buildIntakeNextAction(intent),
      exitCode: 0,
    };
  }

  const events = readJsonDir(dirs.events);
  const intents = readJsonDir(dirs.intents);

  const counts = {};
  for (const intent of intents) {
    counts[intent.status] = (counts[intent.status] || 0) + 1;
  }

  const summary = {
    schema_version: '1.0',
    last_updated_at: nowISO(),
    total_events: events.length,
    total_intents: intents.length,
    by_status: counts,
    intents: intents
      .sort((a, b) => (b.updated_at || b.created_at).localeCompare(a.updated_at || a.created_at))
      .map(i => ({
        intent_id: i.intent_id,
        priority: i.priority,
        template: i.template,
        status: i.status,
        updated_at: i.updated_at,
        next_action: buildIntakeNextAction(i),
      })),
  };

  // Write loop-state cache
  const loopState = {
    schema_version: '1.0',
    last_updated_at: summary.last_updated_at,
    pending_events: events.filter(e => {
      const linked = intents.find(i => i.event_id === e.event_id);
      return !linked || linked.status === 'detected';
    }).length,
    pending_intents: intents.filter(i => i.status === 'detected' || i.status === 'triaged').length,
    active_intents: intents.filter(i => !TERMINAL_STATES.has(i.status) && i.status !== 'detected').length,
  };

  try {
    ensureIntakeDirs(root);
    safeWriteJson(join(dirs.base, 'loop-state.json'), loopState);
  } catch {
    // non-fatal — loop-state is a cache
  }

  return { ok: true, summary, exitCode: 0 };
}

export function findNextDispatchableIntent(root, options = {}) {
  const dirs = intakeDirs(root);
  if (!existsSync(dirs.intents)) {
    return { ok: false, error: 'no intents directory' };
  }

  const scopeRunId = options.run_id || null;

  let intents = readJsonDir(dirs.intents)
    .filter((intent) => intent && DISPATCHABLE_STATUSES.has(intent.status));

  // BUG-34: when run_id scoping is active, filter out intents that belong to
  // a different run. `cross_run_durable` is only a pre-run holding state for
  // freshly approved idle intents. Once a run starts, those intents must be
  // rebound onto that run and the flag cleared; it must never override an
  // existing run binding.
  if (scopeRunId) {
    intents = intents.filter((intent) => {
      if (intent.approved_run_id === scopeRunId) return true;
      if (!intent.approved_run_id && intent.cross_run_durable === true) return true;
      // Legacy intent with no run binding — stale, skip it
      if (!intent.approved_run_id) return false;
      // Intent bound to a different run — stale, skip it
      return false;
    });
  }

  if (intents.length === 0) {
    return { ok: false, error: 'no dispatchable intents' };
  }

  const approved = intents.filter((intent) => intent.status === 'approved');
  const candidates = approved.length > 0 ? approved : intents;

  candidates.sort((a, b) => {
    const aPriority = PRIORITY_RANK[a.priority] ?? Number.MAX_SAFE_INTEGER;
    const bPriority = PRIORITY_RANK[b.priority] ?? Number.MAX_SAFE_INTEGER;
    if (aPriority !== bPriority) return aPriority - bPriority;

    const aTime = Date.parse(a.approved_at || a.planned_at || a.created_at || a.updated_at || 0);
    const bTime = Date.parse(b.approved_at || b.planned_at || b.created_at || b.updated_at || 0);
    if (Number.isFinite(aTime) && Number.isFinite(bTime) && aTime !== bTime) {
      return aTime - bTime;
    }

    return String(a.intent_id || '').localeCompare(String(b.intent_id || ''));
  });

  const intent = candidates[0];
  return {
    ok: true,
    intentId: intent.intent_id,
    status: intent.status,
    priority: intent.priority || null,
    charter: intent.charter || null,
    acceptance_count: Array.isArray(intent.acceptance_contract) ? intent.acceptance_contract.length : 0,
    intent,
  };
}

/**
 * Return all approved-but-unconsumed intents sorted by priority (BUG-15).
 * Used by `status` to surface the pending intent queue.
 */
export function findPendingApprovedIntents(root, options = {}) {
  const dirs = intakeDirs(root);
  if (!existsSync(dirs.intents)) return [];

  const scopeRunId = options.run_id || null;

  return readJsonDir(dirs.intents)
    .filter((intent) => {
      if (!intent || intent.status !== 'approved') return false;
      // BUG-34: run_id scoping — same logic as findNextDispatchableIntent.
      // `cross_run_durable` only applies before the first run binding exists.
      if (scopeRunId) {
        if (intent.approved_run_id === scopeRunId) return true;
        if (!intent.approved_run_id && intent.cross_run_durable === true) return true;
        return false;
      }
      return true;
    })
    .sort((a, b) => {
      const aPriority = PRIORITY_RANK[a.priority] ?? Number.MAX_SAFE_INTEGER;
      const bPriority = PRIORITY_RANK[b.priority] ?? Number.MAX_SAFE_INTEGER;
      if (aPriority !== bPriority) return aPriority - bPriority;
      const aTime = Date.parse(a.approved_at || a.created_at || 0);
      const bTime = Date.parse(b.approved_at || b.created_at || 0);
      if (Number.isFinite(aTime) && Number.isFinite(bTime) && aTime !== bTime) return aTime - bTime;
      return String(a.intent_id || '').localeCompare(String(b.intent_id || ''));
    })
    .map((intent) => ({
      intent_id: intent.intent_id,
      priority: intent.priority || 'p0',
      charter: intent.charter || intent.description || null,
      acceptance_count: Array.isArray(intent.acceptance_contract) ? intent.acceptance_contract.length : 0,
      approved_at: intent.approved_at || null,
    }));
}

/**
 * BUG-34: Archive stale intents from prior runs.
 * Called during run initialization to prevent cross-run intent leakage.
 * Transitions approved/planned intents that don't belong to the new run into
 * 'suppressed' status with an archival reason.
 *
 * @param {string} root
 * @param {string} newRunId - the run_id of the newly initialized run
 * @returns {{ archived: number }}
 */
export function archiveStaleIntents(root, newRunId) {
  const dirs = intakeDirs(root);
  if (!existsSync(dirs.intents)) return { archived: 0, adopted: 0 };

  const now = nowISO();
  let archived = 0;
  let adopted = 0;

  const files = readdirSync(dirs.intents).filter(f => f.endsWith('.json') && !f.startsWith('.tmp-'));
  for (const file of files) {
    const intentPath = join(dirs.intents, file);
    let intent;
    try {
      intent = JSON.parse(readFileSync(intentPath, 'utf8'));
    } catch {
      continue;
    }

    if (!intent || !DISPATCHABLE_STATUSES.has(intent.status)) continue;

    if (intent.cross_run_durable === true && !intent.approved_run_id) {
      intent.approved_run_id = newRunId;
      delete intent.cross_run_durable;
      intent.updated_at = now;
      if (!intent.history) intent.history = [];
      intent.history.push({
        from: intent.status,
        to: intent.status,
        at: now,
        reason: `pre-run durable approval bound to run ${newRunId}`,
      });
      safeWriteJson(intentPath, intent);
      adopted++;
      continue;
    }

    if (intent.cross_run_durable === true && intent.approved_run_id === newRunId) {
      delete intent.cross_run_durable;
      intent.updated_at = now;
      safeWriteJson(intentPath, intent);
      continue;
    }

    if (intent.approved_run_id === newRunId) continue;

    if (intent.approved_run_id && intent.approved_run_id !== newRunId) {
      // Intent from a different run — archive it
      intent.status = 'suppressed';
      intent.updated_at = now;
      intent.archived_reason = `stale: approved under run ${intent.approved_run_id}, archived on run ${newRunId} initialization`;
      if (!intent.history) intent.history = [];
      intent.history.push({ from: 'approved', to: 'suppressed', at: now, reason: intent.archived_reason });
      safeWriteJson(intentPath, intent);
      archived++;
    } else if (!intent.approved_run_id) {
      // BUG-39: pre-BUG-34 legacy intent with no run binding — archive it
      // with explicit migration reason. Do NOT adopt into current run.
      const prevStatus = intent.status;
      intent.status = 'archived_migration';
      intent.updated_at = now;
      intent.archived_reason = `pre-BUG-34 intent with no run scope; archived during migration on run ${newRunId}`;
      if (!intent.history) intent.history = [];
      intent.history.push({ from: prevStatus, to: 'archived_migration', at: now, reason: intent.archived_reason });
      safeWriteJson(intentPath, intent);
      archived++;
    }
  }

  return { archived, adopted };
}

/**
 * Unified intent consumption entry point (BUG-16).
 * Both manual (resume/step --resume) and continuous/scheduler paths should call
 * this single function to consume the next approved intent.
 *
 * @param {string} root
 * @param {{ role?: string, writeDispatchBundle?: boolean, allowTerminalRestart?: boolean, provenance?: object }} options
 * @returns {{ ok: boolean, intentId?: string, intent?: object, error?: string }}
 */
export function consumeNextApprovedIntent(root, options = {}) {
  let runId = options.run_id || null;
  if (!runId) {
    try {
      const context = loadProjectContext(root);
      const state = context ? loadProjectState(root, context.config) : null;
      runId = state?.run_id || null;
    } catch {
      runId = null;
    }
  }

  if (runId && options.auto_archive_stale !== false) {
    archiveStaleIntents(root, runId);
  }

  const queued = findNextDispatchableIntent(root, { run_id: runId });
  if (!queued.ok) {
    return { ok: false, error: queued.error || 'no dispatchable intents' };
  }

  const prepared = prepareIntentForDispatch(root, queued.intentId, {
    role: options.role,
    writeDispatchBundle: options.writeDispatchBundle ?? false,
    allowTerminalRestart: options.allowTerminalRestart ?? false,
    provenance: options.provenance,
  });

  if (!prepared.ok) {
    return { ok: false, error: prepared.error, intentId: queued.intentId };
  }

  return {
    ok: true,
    intentId: queued.intentId,
    status: queued.status,
    priority: queued.priority,
    charter: queued.charter,
    intent: prepared.intent,
    run_id: prepared.run_id,
    turn_id: prepared.turn_id,
    role: prepared.role,
  };
}

export function prepareIntentForDispatch(root, intentId, options = {}) {
  const loadedIntent = readIntent(root, intentId);
  if (!loadedIntent.ok) {
    return loadedIntent;
  }

  const startingStatus = loadedIntent.intent.status;
  let intent = loadedIntent.intent;
  let planned = false;

  if (intent.status === 'approved') {
    const plannedResult = planIntent(root, intent.intent_id, {
      projectName: options.projectName,
      force: options.forcePlan === true,
    });
    if (!plannedResult.ok) {
      return {
        ok: false,
        error: `plan failed: ${plannedResult.error}`,
        intent_status: intent.status,
        exitCode: plannedResult.exitCode || 1,
      };
    }
    intent = plannedResult.intent;
    planned = true;
  }

  if (intent.status === 'planned') {
    const startResult = startIntent(root, intent.intent_id, {
      allowTerminalRestart: options.allowTerminalRestart === true,
      provenance: options.provenance,
      role: options.role || undefined,
      writeDispatchBundle: options.writeDispatchBundle,
    });
    if (!startResult.ok) {
      return {
        ok: false,
        error: `start failed: ${startResult.error}`,
        intent_status: intent.status,
        exitCode: startResult.exitCode || 1,
      };
    }
    return {
      ok: true,
      intent_id: intent.intent_id,
      starting_status: startingStatus,
      final_status: startResult.intent.status,
      planned,
      started: true,
      run_id: startResult.run_id,
      turn_id: startResult.turn_id,
      role: startResult.role,
      intent: startResult.intent,
      exitCode: 0,
    };
  }

  if (intent.status === 'executing') {
    return {
      ok: true,
      intent_id: intent.intent_id,
      starting_status: startingStatus,
      final_status: intent.status,
      planned,
      started: false,
      run_id: intent.target_run || null,
      turn_id: intent.target_turn || null,
      role: options.role || null,
      intent,
      exitCode: 0,
    };
  }

  return {
    ok: false,
    error: `intent ${intentId} is in unsupported status "${intent.status}" for dispatch preparation`,
    intent_status: intent.status,
    exitCode: 1,
  };
}

// ---------------------------------------------------------------------------
// Approve
// ---------------------------------------------------------------------------

export function approveIntent(root, intentId, options = {}) {
  const dirs = intakeDirs(root);
  const intentPath = join(dirs.intents, `${intentId}.json`);

  if (!existsSync(intentPath)) {
    return { ok: false, error: `intent ${intentId} not found`, exitCode: 2 };
  }

  const intent = JSON.parse(readFileSync(intentPath, 'utf8'));

  if (intent.status !== 'triaged' && intent.status !== 'blocked') {
    return { ok: false, error: `cannot approve from status "${intent.status}" (must be triaged or blocked)`, exitCode: 1 };
  }

  const approver = options.approver || 'operator';
  const previousStatus = intent.status;
  const reason = options.reason || (previousStatus === 'blocked' ? 're-approved after block resolution' : 'approved for planning');
  const now = nowISO();

  // BUG-34/39: stamp the current run_id on approval so the intent is scoped
  // to the run that approved it. When approval happens before any governed
  // run exists, hold the intent in a pre-run durable state so the *next* run
  // initialization can bind it to that run. The flag is not an evergreen
  // cross-run bypass; it exists only until first run binding happens.
  if (!intent.approved_run_id) {
    const statePath = join(root, '.agentxchain', 'state.json');
    if (existsSync(statePath)) {
      try {
        const state = JSON.parse(readFileSync(statePath, 'utf8'));
        if (state.run_id) {
          intent.approved_run_id = state.run_id;
        } else {
          intent.cross_run_durable = true;
        }
      } catch {
        // non-fatal — stamp is best-effort during approval
      }
    } else {
      intent.cross_run_durable = true;
    }
  }

  intent.status = 'approved';
  intent.approved_by = approver;
  intent.updated_at = now;
  intent.history.push({ from: previousStatus, to: 'approved', at: now, reason, approver });

  safeWriteJson(intentPath, intent);
  return { ok: true, intent, exitCode: 0 };
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

export function planIntent(root, intentId, options = {}) {
  const dirs = intakeDirs(root);
  const intentPath = join(dirs.intents, `${intentId}.json`);

  if (!existsSync(intentPath)) {
    return { ok: false, error: `intent ${intentId} not found`, exitCode: 2 };
  }

  const intent = JSON.parse(readFileSync(intentPath, 'utf8'));

  if (intent.status !== 'approved') {
    return { ok: false, error: `cannot plan from status "${intent.status}" (must be approved)`, exitCode: 1 };
  }

  // Load the governed template
  let manifest;
  try {
    manifest = loadGovernedTemplate(intent.template);
  } catch (err) {
    return { ok: false, error: err.message, exitCode: 2 };
  }

  const planningDir = join(root, '.planning');
  const projectName = options.projectName || basename(root);
  const artifacts = manifest.planning_artifacts || [];

  // Check for conflicts
  if (!options.force) {
    const conflicts = [];
    for (const artifact of artifacts) {
      const targetPath = join(planningDir, artifact.filename);
      if (existsSync(targetPath)) {
        conflicts.push(`.planning/${artifact.filename}`);
      }
    }
    if (conflicts.length > 0) {
      return {
        ok: false,
        error: 'existing planning artifacts would be overwritten',
        conflicts,
        exitCode: 1,
      };
    }
  }

  // Generate artifacts
  mkdirSync(planningDir, { recursive: true });
  const generated = [];
  for (const artifact of artifacts) {
    const targetPath = join(planningDir, artifact.filename);
    const content = artifact.content_template.replace(/\{\{project_name\}\}/g, projectName);
    writeFileSync(targetPath, content + '\n');
    generated.push(`.planning/${artifact.filename}`);
  }

  const now = nowISO();
  intent.status = 'planned';
  intent.planning_artifacts = generated;
  intent.updated_at = now;
  intent.history.push({
    from: 'approved',
    to: 'planned',
    at: now,
    reason: `generated ${generated.length} planning artifact(s) from template "${intent.template}"`,
    artifacts: generated,
  });

  safeWriteJson(intentPath, intent);
  return { ok: true, intent, artifacts_generated: generated, artifacts_skipped: [], exitCode: 0 };
}

// ---------------------------------------------------------------------------
// Start — planned → executing bridge (V3-S3)
// ---------------------------------------------------------------------------

export function startIntent(root, intentId, options = {}) {
  const dirs = intakeDirs(root);
  const intentPath = join(dirs.intents, `${intentId}.json`);

  if (!existsSync(intentPath)) {
    return { ok: false, error: `intent ${intentId} not found`, exitCode: 2 };
  }

  const intent = JSON.parse(readFileSync(intentPath, 'utf8'));

  if (intent.status !== 'planned') {
    return { ok: false, error: `cannot start from status "${intent.status}" (must be planned)`, exitCode: 1 };
  }

  // Verify planning artifacts still exist on disk
  const planningArtifacts = intent.planning_artifacts || [];
  const missingArtifacts = [];
  for (const relPath of planningArtifacts) {
    if (!existsSync(join(root, relPath))) {
      missingArtifacts.push(relPath);
    }
  }
  if (missingArtifacts.length > 0) {
    return {
      ok: false,
      error: 'recorded planning artifacts are missing on disk',
      missing: missingArtifacts,
      exitCode: 1,
    };
  }

  const loadedEvent = readEvent(root, intent.event_id);
  if (!loadedEvent.ok) {
    return loadedEvent;
  }
  const { event } = loadedEvent;
  const intakeContext = {
    intent_id: intent.intent_id,
    event_id: intent.event_id,
    source: event.source || null,
    category: event.category || null,
    charter: intent.charter || null,
    acceptance_contract: Array.isArray(intent.acceptance_contract) ? intent.acceptance_contract : [],
  };

  // Load governed project context
  const context = loadProjectContext(root);
  if (!context) {
    return { ok: false, error: 'agentxchain.json not found or invalid', exitCode: 2 };
  }
  const { config } = context;

  if (config.protocol_mode !== 'governed') {
    return { ok: false, error: 'intake start requires a governed project', exitCode: 2 };
  }

  // Load governed state
  const statePath = join(root, STATE_PATH);
  if (!existsSync(statePath)) {
    return { ok: false, error: 'No governed state.json found', exitCode: 2 };
  }

  let state = loadProjectState(root, config);
  if (!state) {
    return { ok: false, error: 'Failed to parse governed state.json', exitCode: 2 };
  }

  const allowCompletedRestart = options.allowTerminalRestart === true
    && state.status === 'completed'
    && getActiveTurnCount(state) === 0;

  const startProvenance = {
    trigger: 'intake',
    intake_intent_id: intent.intent_id,
    trigger_reason: intent.charter || null,
    created_by: 'operator',
    ...(options.provenance && typeof options.provenance === 'object' ? options.provenance : {}),
  };

  // Check busy-run conditions
  const activeTurns = getActiveTurns(state);
  const activeCount = getActiveTurnCount(state);

  if (activeCount > 0) {
    const turnIds = Object.keys(activeTurns);
    return {
      ok: false,
      error: `cannot start: active turn(s) already exist: ${turnIds.join(', ')}`,
      exitCode: 1,
    };
  }

  if (state.status === 'blocked') {
    const reason = state.blocked_reason?.recovery?.detail || state.blocked_on || 'unknown';
    return { ok: false, error: `cannot start: run is blocked (${reason})`, exitCode: 1 };
  }

  if (state.status === 'completed' && !allowCompletedRestart) {
    const restartCmd = `agentxchain intake start --intent ${intent.intent_id} --restart-completed`;
    return {
      ok: false,
      error: `cannot start: governed run is already completed. Re-run with "${restartCmd}" to initialize a fresh governed run.`,
      exitCode: 1,
    };
  }

  if (state.status === 'paused') {
    return { ok: false, error: 'cannot start: run is paused (awaiting approval). Resolve the blocking gate before starting a new intake turn.', exitCode: 1 };
  }

  if (state.pending_phase_transition) {
    return { ok: false, error: `cannot start: pending phase transition to "${state.pending_phase_transition}"`, exitCode: 1 };
  }

  if (state.pending_run_completion) {
    return { ok: false, error: 'cannot start: pending run completion approval', exitCode: 1 };
  }

  // Bootstrap: idle with no run → initialize
  if ((state.status === 'idle' && !state.run_id) || allowCompletedRestart) {
    const initResult = initializeGovernedRun(root, config, {
      provenance: startProvenance,
      allow_terminal_restart: allowCompletedRestart,
    });
    if (!initResult.ok) {
      return { ok: false, error: `run initialization failed: ${initResult.error}`, exitCode: 1 };
    }
    state = initResult.state;
  }

  // Resolve role
  const roleId = resolveIntakeRole(options.role, state, config);
  if (!roleId.ok) {
    return { ok: false, error: roleId.error, exitCode: 1 };
  }

  // Assign governed turn
  const assignResult = assignGovernedTurn(root, config, roleId.role, {
    intakeContext,
  });
  if (!assignResult.ok) {
    return { ok: false, error: `turn assignment failed: ${assignResult.error}`, exitCode: 1 };
  }
  state = assignResult.state;

  // Find the newly assigned turn
  const newActiveTurns = getActiveTurns(state);
  const assignedTurn = Object.values(newActiveTurns).find(t => t.assigned_role === roleId.role);
  if (!assignedTurn) {
    return { ok: false, error: 'turn assignment succeeded but turn not found in state', exitCode: 1 };
  }

  if (options.writeDispatchBundle !== false) {
    const bundleResult = writeDispatchBundle(root, state, config);
    if (!bundleResult.ok) {
      return { ok: false, error: `dispatch bundle failed: ${bundleResult.error}`, exitCode: 1 };
    }

    finalizeDispatchManifest(root, assignedTurn.turn_id, {
      run_id: state.run_id,
      role: assignedTurn.assigned_role,
    });
  }

  // Update intent: planned → executing
  const now = nowISO();
  intent.status = 'executing';
  intent.target_run = state.run_id;
  intent.target_turn = assignedTurn.turn_id;
  intent.started_at = now;
  intent.updated_at = now;
  intent.history.push({
    from: 'planned',
    to: 'executing',
    at: now,
    run_id: state.run_id,
    turn_id: assignedTurn.turn_id,
    role: roleId.role,
    reason: 'governed execution started',
  });

  safeWriteJson(intentPath, intent);

  return {
    ok: true,
    intent,
    run_id: state.run_id,
    turn_id: assignedTurn.turn_id,
    role: roleId.role,
    dispatch_dir: getDispatchTurnDir(assignedTurn.turn_id),
    exitCode: 0,
  };
}

function resolveIntakeRole(roleOverride, state, config) {
  const phase = state.phase;
  const routing = config.routing?.[phase];

  if (roleOverride) {
    if (!config.roles?.[roleOverride]) {
      const available = Object.keys(config.roles || {}).join(', ');
      return { ok: false, error: `unknown role: "${roleOverride}". Available: ${available}` };
    }
    return { ok: true, role: roleOverride };
  }

  if (routing?.entry_role) {
    return { ok: true, role: routing.entry_role };
  }

  const roles = Object.keys(config.roles || {});
  if (roles.length > 0) {
    return { ok: true, role: roles[0] };
  }

  return { ok: false, error: 'no roles defined in project config' };
}

// ---------------------------------------------------------------------------
// Handoff — planned → coordinator-mediated executing bridge
// ---------------------------------------------------------------------------

export function handoffIntent(root, intentId, options = {}) {
  const loadedIntent = readIntent(root, intentId);
  if (!loadedIntent.ok) {
    return loadedIntent;
  }

  const { intent, intentPath } = loadedIntent;

  if (intent.status !== 'planned') {
    return {
      ok: false,
      error: `intent must be in planned state for handoff (current: ${intent.status})`,
      exitCode: 1,
    };
  }

  const coordinatorRoot = options.coordinatorRoot ? pathResolve(options.coordinatorRoot) : null;
  if (!coordinatorRoot) {
    return { ok: false, error: 'coordinator root does not contain agentxchain-multi.json', exitCode: 1 };
  }

  const coordinatorConfigResult = loadCoordinatorConfig(coordinatorRoot);
  if (!coordinatorConfigResult.ok) {
    return { ok: false, error: 'coordinator root does not contain agentxchain-multi.json', exitCode: 1 };
  }
  const coordinatorConfig = coordinatorConfigResult.config;

  const workstreamId = options.workstreamId;
  const workstream = coordinatorConfig.workstreams?.[workstreamId];
  if (!workstream) {
    return { ok: false, error: `workstream ${workstreamId} not found in coordinator config`, exitCode: 1 };
  }

  const context = loadProjectContext(root);
  if (!context) {
    return { ok: false, error: 'agentxchain.json not found or invalid', exitCode: 2 };
  }

  const sourceRepoId = context.config.project?.id;
  if (!sourceRepoId) {
    return { ok: false, error: 'governed project id is missing from agentxchain.json', exitCode: 2 };
  }

  if (!workstream.repos.includes(sourceRepoId)) {
    return {
      ok: false,
      error: `repo ${sourceRepoId} is not a member of workstream ${workstreamId}`,
      exitCode: 1,
    };
  }

  const coordinatorState = loadCoordinatorState(coordinatorRoot);
  if (!coordinatorState || coordinatorState.status !== 'active') {
    return {
      ok: false,
      error: `coordinator run is not active (status: ${coordinatorState?.status || 'not_initialized'})`,
      exitCode: 1,
    };
  }

  const loadedEvent = readEvent(root, intent.event_id);
  if (!loadedEvent.ok) {
    return loadedEvent;
  }
  const { event } = loadedEvent;

  const now = nowISO();
  const handoff = {
    schema_version: '1.0',
    super_run_id: coordinatorState.super_run_id,
    intent_id: intent.intent_id,
    source_repo: sourceRepoId,
    source_event_id: intent.event_id,
    source_signal_source: event.source || null,
    source_signal_category: event.category || null,
    source_event_ref: `.agentxchain/intake/events/${intent.event_id}.json`,
    workstream_id: workstreamId,
    charter: intent.charter,
    acceptance_contract: Array.isArray(intent.acceptance_contract) ? intent.acceptance_contract : [],
    evidence_refs: [`.agentxchain/intake/events/${intent.event_id}.json`],
    handed_off_at: now,
    handed_off_by: options.handedOffBy || 'operator',
  };
  const handoffPath = writeCoordinatorHandoff(coordinatorRoot, intent.intent_id, handoff);

  intent.status = 'executing';
  intent.target_run = null;
  intent.target_turn = null;
  intent.target_workstream = {
    coordinator_root: coordinatorRoot,
    workstream_id: workstreamId,
    super_run_id: coordinatorState.super_run_id,
  };
  intent.started_at = now;
  intent.updated_at = now;
  intent.history.push({
    from: 'planned',
    to: 'executing',
    at: now,
    super_run_id: coordinatorState.super_run_id,
    workstream_id: workstreamId,
    coordinator_root: coordinatorRoot,
    reason: `handed off to coordinator workstream "${workstreamId}"`,
  });

  safeWriteJson(intentPath, intent);

  return {
    ok: true,
    intent,
    handoff_path: handoffPath,
    super_run_id: coordinatorState.super_run_id,
    exitCode: 0,
  };
}

// ---------------------------------------------------------------------------
// Resolve — execution exit and intent closure linkage (V3-S5)
// ---------------------------------------------------------------------------

export function resolveIntent(root, intentId) {
  const loadedIntent = readIntent(root, intentId);
  if (!loadedIntent.ok) {
    return loadedIntent;
  }

  const { intent, intentPath, dirs } = loadedIntent;

  if (intent.status === 'completed') {
    return {
      ok: true,
      intent,
      previous_status: 'completed',
      new_status: 'completed',
      run_outcome: 'completed',
      no_change: true,
      exitCode: 0,
    };
  }

  if (intent.status !== 'executing' && intent.status !== 'blocked') {
    return {
      ok: false,
      error: `cannot resolve from status "${intent.status}" (must be executing or blocked)`,
      exitCode: 1,
    };
  }

  if (intent.target_workstream) {
    return resolveCoordinatorBackedIntent(root, intentPath, dirs, intent);
  }

  if (!intent.target_run) {
    return { ok: false, error: `intent ${intentId} has no linked run (target_run is null)`, exitCode: 1 };
  }

  return resolveRepoBackedIntent(root, intentPath, dirs, intent);
}

function resolveRepoBackedIntent(root, intentPath, dirs, intent) {
  const statePath = join(root, STATE_PATH);
  if (!existsSync(statePath)) {
    return { ok: false, error: 'governed state not found at .agentxchain/state.json', exitCode: 1 };
  }

  let state;
  try {
    state = JSON.parse(readFileSync(statePath, 'utf8'));
  } catch {
    return { ok: false, error: 'failed to parse governed state.json', exitCode: 1 };
  }

  // Validate run identity
  if (state.run_id !== intent.target_run) {
    return {
      ok: false,
      error: `run_id mismatch: intent targets ${intent.target_run} but governed state has ${state.run_id}`,
      exitCode: 1,
    };
  }

  if (state.status === 'idle') {
    return {
      ok: false,
      error: 'governed run is idle — state may have been reset after intent start',
      exitCode: 1,
    };
  }

  // Map run outcome to intent transition
  const now = nowISO();
  const previousStatus = intent.status;

  // Run-level 'failed' is reserved/unreached in current governed writers (DEC-RUN-STATUS-001).
  // Fail closed if encountered — operator must investigate manually.
  if (state.status === 'failed') {
    return {
      ok: false,
      error: 'governed run has reserved status "failed" which is not emitted by current governed writers. Manual inspection required. See DEC-RUN-STATUS-001.',
      exitCode: 1,
    };
  }

  if (state.status === 'blocked') {
    intent.status = 'blocked';
    intent.run_blocked_on = state.blocked_on || null;
    intent.run_blocked_reason = state.blocked_reason?.category || null;
    intent.run_blocked_recovery = state.blocked_reason?.recovery?.recovery_action || null;
    intent.updated_at = now;
    intent.history.push({
      from: previousStatus,
      to: 'blocked',
      at: now,
      reason: `governed run ${intent.target_run} reached status blocked`,
      run_id: intent.target_run,
      run_status: 'blocked',
    });

    safeWriteJson(intentPath, intent);
    return {
      ok: true,
      intent,
      previous_status: previousStatus,
      new_status: 'blocked',
      run_outcome: 'blocked',
      no_change: false,
      exitCode: 0,
    };
  }

  if (state.status === 'completed') {
    intent.status = 'completed';
    intent.run_completed_at = state.completed_at || now;
    intent.run_final_turn = state.last_completed_turn_id || null;
    intent.updated_at = now;
    intent.history.push({
      from: previousStatus,
      to: 'completed',
      at: now,
      reason: `governed run ${intent.target_run} reached status completed`,
      run_id: intent.target_run,
      run_status: 'completed',
    });

    // Create observation directory scaffold
    const obsDir = join(dirs.base, 'observations', intent.intent_id);
    mkdirSync(obsDir, { recursive: true });

    safeWriteJson(intentPath, intent);
    return {
      ok: true,
      intent,
      previous_status: previousStatus,
      new_status: 'completed',
      run_outcome: 'completed',
      no_change: false,
      exitCode: 0,
    };
  }

  // active or paused — no transition yet
  return {
    ok: true,
    intent,
    previous_status: previousStatus,
    new_status: previousStatus,
    run_outcome: state.status,
    no_change: true,
    exitCode: 0,
  };
}

function resolveCoordinatorBackedIntent(root, intentPath, dirs, intent) {
  const targetWorkstream = intent.target_workstream;
  const coordinatorRoot = targetWorkstream?.coordinator_root;
  const workstreamId = targetWorkstream?.workstream_id;
  const expectedSuperRunId = targetWorkstream?.super_run_id;

  if (!coordinatorRoot || !workstreamId || !expectedSuperRunId) {
    return { ok: false, error: 'intent target_workstream is incomplete', exitCode: 1 };
  }

  const coordinatorState = loadCoordinatorState(coordinatorRoot);
  if (!coordinatorState) {
    return { ok: false, error: `coordinator state not found at ${coordinatorRoot}`, exitCode: 1 };
  }

  if (coordinatorState.super_run_id !== expectedSuperRunId) {
    return {
      ok: false,
      error: `super_run_id mismatch: intent targets ${expectedSuperRunId} but coordinator state has ${coordinatorState.super_run_id}`,
      exitCode: 1,
    };
  }

  const barriers = readBarriers(coordinatorRoot);
  const barrier = barriers[getWorkstreamCompletionBarrierId(workstreamId)];
  if (!barrier) {
    return { ok: false, error: `completion barrier not found for workstream ${workstreamId}`, exitCode: 1 };
  }

  const now = nowISO();
  const previousStatus = intent.status;

  if (barrier.status === 'satisfied') {
    intent.status = 'completed';
    intent.run_completed_at = now;
    intent.run_final_turn = null;
    intent.updated_at = now;
    intent.history.push({
      from: previousStatus,
      to: 'completed',
      at: now,
      reason: `coordinator workstream ${workstreamId} satisfied completion barrier`,
      super_run_id: expectedSuperRunId,
      run_status: coordinatorState.status,
    });

    const obsDir = join(dirs.base, 'observations', intent.intent_id);
    mkdirSync(obsDir, { recursive: true });

    safeWriteJson(intentPath, intent);
    return {
      ok: true,
      intent,
      previous_status: previousStatus,
      new_status: 'completed',
      run_outcome: coordinatorState.status,
      no_change: false,
      exitCode: 0,
    };
  }

  if (coordinatorState.status === 'blocked') {
    intent.status = 'blocked';
    intent.run_blocked_on = `coordinator:${workstreamId}`;
    intent.run_blocked_reason = coordinatorState.blocked_reason || 'coordinator_blocked';
    intent.run_blocked_recovery = 'resolve coordinator blocked state, then rerun agentxchain intake resolve';
    intent.updated_at = now;
    intent.history.push({
      from: previousStatus,
      to: 'blocked',
      at: now,
      reason: `coordinator run ${expectedSuperRunId} is blocked for workstream ${workstreamId}`,
      super_run_id: expectedSuperRunId,
      run_status: coordinatorState.status,
    });

    safeWriteJson(intentPath, intent);
    return {
      ok: true,
      intent,
      previous_status: previousStatus,
      new_status: 'blocked',
      run_outcome: coordinatorState.status,
      no_change: false,
      exitCode: 0,
    };
  }

  // Coordinator run-level 'failed' is reserved/unreached (DEC-RUN-STATUS-001). Fail closed.
  if (coordinatorState.status === 'failed') {
    return {
      ok: false,
      error: `coordinator run ${expectedSuperRunId} has reserved status "failed" which is not emitted by current governed writers. Manual inspection required. See DEC-RUN-STATUS-001.`,
      exitCode: 1,
    };
  }

  if (coordinatorState.status === 'completed') {
    intent.status = 'blocked';
    intent.run_blocked_on = `coordinator:completed_without_workstream:${workstreamId}`;
    intent.run_blocked_reason = 'coordinator_completed_without_workstream';
    intent.run_blocked_recovery = `Coordinator run ${expectedSuperRunId} completed without satisfying workstream ${workstreamId}. Re-approve the intent and start a new run.`;
    intent.updated_at = now;
    intent.history.push({
      from: previousStatus,
      to: 'blocked',
      at: now,
      reason: `coordinator run ${expectedSuperRunId} completed without satisfying workstream ${workstreamId}`,
      super_run_id: expectedSuperRunId,
      run_status: coordinatorState.status,
    });

    safeWriteJson(intentPath, intent);
    return {
      ok: true,
      intent,
      previous_status: previousStatus,
      new_status: 'blocked',
      run_outcome: coordinatorState.status,
      no_change: false,
      exitCode: 0,
    };
  }

  return {
    ok: true,
    intent,
    previous_status: previousStatus,
    new_status: previousStatus,
    run_outcome: coordinatorState.status,
    no_change: true,
    exitCode: 0,
  };
}

// ---------------------------------------------------------------------------
// Scan — deterministic source-snapshot ingestion (V3-S4)
// ---------------------------------------------------------------------------

const SCAN_SOURCES = ['ci_failure', 'git_ref_change', 'schedule'];

function validateSnapshotItem(item) {
  const errors = [];
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    return { valid: false, errors: ['item must be a JSON object'] };
  }
  if (!item.signal || typeof item.signal !== 'object' || Array.isArray(item.signal) || Object.keys(item.signal).length === 0) {
    errors.push('signal must be a non-empty object');
  }
  if (!Array.isArray(item.evidence) || item.evidence.length === 0) {
    errors.push('evidence must be a non-empty array');
  } else {
    for (const e of item.evidence) {
      if (!e || typeof e !== 'object') {
        errors.push('each evidence entry must be an object');
      } else {
        if (!['url', 'file', 'text'].includes(e.type)) {
          errors.push(`evidence type must be one of: url, file, text (got "${e.type}")`);
        }
        if (typeof e.value !== 'string' || !e.value.trim()) {
          errors.push('evidence value must be a non-empty string');
        }
      }
    }
  }
  return { valid: errors.length === 0, errors };
}

export function scanSource(root, source, snapshot) {
  // Validate source
  if (!SCAN_SOURCES.includes(source)) {
    return {
      ok: false,
      error: `unknown scan source: "${source}". Supported: ${SCAN_SOURCES.join(', ')}`,
      exitCode: 1,
    };
  }

  // Validate snapshot structure
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    return { ok: false, error: 'snapshot must be a JSON object', exitCode: 1 };
  }

  if (snapshot.source !== source) {
    return {
      ok: false,
      error: `source mismatch: CLI flag "${source}" but snapshot declares "${snapshot.source}"`,
      exitCode: 1,
    };
  }

  if (!Array.isArray(snapshot.items) || snapshot.items.length === 0) {
    return { ok: false, error: 'snapshot must contain a non-empty items array', exitCode: 1 };
  }

  const results = [];
  let created = 0;
  let deduplicated = 0;
  let rejected = 0;

  for (let i = 0; i < snapshot.items.length; i++) {
    const item = snapshot.items[i];

    // Validate item structure
    const validation = validateSnapshotItem(item);
    if (!validation.valid) {
      results.push({
        status: 'rejected',
        index: i,
        error: validation.errors.join('; '),
      });
      rejected++;
      continue;
    }

    // Build recordEvent payload from snapshot item
    const payload = {
      source,
      signal: item.signal,
      evidence: item.evidence,
      category: item.category || undefined,
      repo: item.repo || undefined,
      ref: item.ref || undefined,
    };

    const recordResult = recordEvent(root, payload);
    if (!recordResult.ok) {
      results.push({
        status: 'rejected',
        index: i,
        error: recordResult.error,
      });
      rejected++;
      continue;
    }

    if (recordResult.deduplicated) {
      results.push({
        status: 'deduplicated',
        event_id: recordResult.event.event_id,
        intent_id: recordResult.intent?.intent_id || null,
      });
      deduplicated++;
    } else {
      results.push({
        status: 'created',
        event_id: recordResult.event.event_id,
        intent_id: recordResult.intent?.intent_id || null,
      });
      created++;
    }
  }

  // If every item was rejected, fail
  if (created === 0 && deduplicated === 0) {
    return {
      ok: false,
      error: 'all scanned items were rejected',
      source,
      scanned: snapshot.items.length,
      created,
      deduplicated,
      rejected,
      results,
      exitCode: 1,
    };
  }

  return {
    ok: true,
    source,
    scanned: snapshot.items.length,
    created,
    deduplicated,
    rejected,
    results,
    exitCode: 0,
  };
}

// ---------------------------------------------------------------------------
// Inject — composed record + triage + approve in one operation
// ---------------------------------------------------------------------------

const PREEMPTION_MARKER_PATH = '.agentxchain/intake/injected-priority.json';

function preemptionMarkerPath(root) {
  return join(root, PREEMPTION_MARKER_PATH);
}

export function readPreemptionMarker(root) {
  const p = preemptionMarkerPath(root);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

export function clearPreemptionMarker(root) {
  const p = preemptionMarkerPath(root);
  if (existsSync(p)) {
    try {
      unlinkSync(p);
    } catch {
      // best-effort
    }
  }
}

export function consumePreemptionMarker(root, options = {}) {
  const marker = readPreemptionMarker(root);
  if (!marker?.intent_id) {
    return { ok: false, error: 'no preemption marker found', exitCode: 1 };
  }

  const loadedIntent = readIntent(root, marker.intent_id);
  if (!loadedIntent.ok) {
    return {
      ok: false,
      error: `preemption marker references missing intent ${marker.intent_id}`,
      marker,
      exitCode: 1,
    };
  }

  const prepared = prepareIntentForDispatch(root, marker.intent_id, options);
  if (!prepared.ok) {
    return {
      ...prepared,
      error: `failed to prepare injected intent ${marker.intent_id}: ${prepared.error}`,
      marker,
    };
  }

  if (prepared.final_status === 'executing') {
    clearPreemptionMarker(root);
    return {
      ok: true,
      marker,
      intent_id: prepared.intent_id,
      starting_status: prepared.starting_status,
      final_status: prepared.final_status,
      planned: prepared.planned,
      started: prepared.started,
      run_id: prepared.run_id,
      turn_id: prepared.turn_id,
      role: prepared.role,
      intent: prepared.intent,
      exitCode: 0,
    };
  }

  return {
    ok: false,
    error: `cannot consume preemption marker from intent status "${prepared.final_status}"`,
    marker,
    intent_id: prepared.intent_id,
    intent_status: prepared.final_status,
    exitCode: 1,
  };
}

export function injectIntent(root, description, options = {}) {
  if (!description || typeof description !== 'string' || !description.trim()) {
    return { ok: false, error: 'description is required', exitCode: 1 };
  }

  const priority = options.priority || 'p0';
  if (!VALID_PRIORITIES.includes(priority)) {
    return { ok: false, error: `priority must be one of: ${VALID_PRIORITIES.join(', ')}`, exitCode: 1 };
  }

  const template = options.template || 'generic';
  if (!VALID_GOVERNED_TEMPLATE_IDS.includes(template)) {
    return { ok: false, error: `template must be one of: ${VALID_GOVERNED_TEMPLATE_IDS.join(', ')}`, exitCode: 1 };
  }

  const charter = options.charter || description.trim();
  const acceptance_contract = options.acceptance
    ? options.acceptance.split(',').map(s => s.trim()).filter(Boolean)
    : [description.trim()];
  const approver = options.approver || 'human';
  const noApprove = options.noApprove === true;

  // Step 1: Record event
  const recordResult = recordEvent(root, {
    source: 'manual',
    category: 'operator_injection',
    signal: { description: description.trim(), injected: true, priority },
    evidence: [{ type: 'text', value: description.trim() }],
  });

  if (!recordResult.ok) {
    return recordResult;
  }

  // If deduplicated, return existing intent
  if (recordResult.deduplicated) {
    return {
      ok: true,
      intent: recordResult.intent,
      event: recordResult.event,
      deduplicated: true,
      preemption_marker: false,
      exitCode: 0,
    };
  }

  const intentId = recordResult.intent.intent_id;

  // Step 2: Triage
  const triageResult = triageIntent(root, intentId, {
    priority,
    template,
    charter,
    acceptance_contract,
  });

  if (!triageResult.ok) {
    return { ok: false, error: `triage failed: ${triageResult.error}`, exitCode: 1 };
  }

  // Step 3: Approve (unless --no-approve)
  if (!noApprove) {
    const approveResult = approveIntent(root, intentId, { approver, reason: 'operator injection' });
    if (!approveResult.ok) {
      return { ok: false, error: `approve failed: ${approveResult.error}`, exitCode: 1 };
    }
  }

  // Step 4: Write preemption marker for p0
  let preemptionMarker = false;
  if (priority === 'p0' && !noApprove) {
    const marker = {
      intent_id: intentId,
      priority,
      description: description.trim(),
      injected_at: nowISO(),
    };
    ensureIntakeDirs(root);
    safeWriteJson(preemptionMarkerPath(root), marker);
    preemptionMarker = true;
  }

  // Re-read final intent state
  const finalRead = readIntent(root, intentId);
  const finalIntent = finalRead.ok ? finalRead.intent : triageResult.intent;

  return {
    ok: true,
    intent: finalIntent,
    event: recordResult.event,
    deduplicated: false,
    preemption_marker: preemptionMarker,
    exitCode: 0,
  };
}

// ---------------------------------------------------------------------------
// Exports for testing
// ---------------------------------------------------------------------------

export { VALID_SOURCES, VALID_PRIORITIES, VALID_TRANSITIONS, S1_STATES, TERMINAL_STATES, SCAN_SOURCES, PREEMPTION_MARKER_PATH };
