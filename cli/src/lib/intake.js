import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
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

const VALID_SOURCES = ['manual', 'ci_failure', 'git_ref_change', 'schedule'];
const VALID_PRIORITIES = ['p0', 'p1', 'p2', 'p3'];
const EVENT_ID_RE = /^evt_\d+_[0-9a-f]{4}$/;
const INTENT_ID_RE = /^intent_\d+_[0-9a-f]{4}$/;

// V3-S1 through S5 states
const S1_STATES = new Set(['detected', 'triaged', 'approved', 'planned', 'executing', 'blocked', 'completed', 'failed', 'suppressed', 'rejected']);
const TERMINAL_STATES = new Set(['suppressed', 'rejected', 'completed', 'failed']);

const VALID_TRANSITIONS = {
  detected: ['triaged', 'suppressed'],
  triaged: ['approved', 'rejected'],
  approved: ['planned'],
  planned: ['executing'],
  executing: ['blocked', 'completed', 'failed'],
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
    return { ok: true, intent, event, exitCode: 0 };
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

  if (state.status === 'completed') {
    return {
      ok: false,
      error: 'cannot start: governed run is already completed. S3 does not reopen completed runs.',
      exitCode: 1,
    };
  }

  if (state.pending_phase_transition) {
    return { ok: false, error: `cannot start: pending phase transition to "${state.pending_phase_transition}"`, exitCode: 1 };
  }

  if (state.pending_run_completion) {
    return { ok: false, error: 'cannot start: pending run completion approval', exitCode: 1 };
  }

  // Bootstrap: idle with no run → initialize
  if (state.status === 'idle' && !state.run_id) {
    const initResult = initializeGovernedRun(root, config);
    if (!initResult.ok) {
      return { ok: false, error: `run initialization failed: ${initResult.error}`, exitCode: 1 };
    }
    state = initResult.state;
  }

  // Resume: paused with no active turns → reactivate
  if (state.status === 'paused' && state.run_id) {
    state.status = 'active';
    state.blocked_on = null;
    state.escalation = null;
    safeWriteJson(statePath, state);
  }

  // Resolve role
  const roleId = resolveIntakeRole(options.role, state, config);
  if (!roleId.ok) {
    return { ok: false, error: roleId.error, exitCode: 1 };
  }

  // Assign governed turn
  const assignResult = assignGovernedTurn(root, config, roleId.role);
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

  // Write dispatch bundle
  const bundleResult = writeDispatchBundle(root, state, config);
  if (!bundleResult.ok) {
    return { ok: false, error: `dispatch bundle failed: ${bundleResult.error}`, exitCode: 1 };
  }

  // Finalize dispatch manifest
  finalizeDispatchManifest(root, assignedTurn.turn_id, {
    run_id: state.run_id,
    role: assignedTurn.assigned_role,
  });

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

  if (intent.status !== 'executing') {
    return { ok: false, error: `cannot resolve from status "${intent.status}" (must be executing)`, exitCode: 1 };
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

  if (state.status === 'blocked' || state.status === 'failed') {
    const newStatus = state.status === 'blocked' ? 'blocked' : 'failed';
    intent.status = newStatus;
    intent.run_blocked_on = state.blocked_on || null;
    intent.run_blocked_reason = state.blocked_reason?.category || null;
    intent.run_blocked_recovery = state.blocked_reason?.recovery?.recovery_action || null;
    if (newStatus === 'failed') {
      intent.run_failed_at = now;
    }
    intent.updated_at = now;
    intent.history.push({
      from: previousStatus,
      to: newStatus,
      at: now,
      reason: `governed run ${intent.target_run} reached status ${state.status}`,
      run_id: intent.target_run,
      run_status: state.status,
    });

    safeWriteJson(intentPath, intent);
    return {
      ok: true,
      intent,
      previous_status: previousStatus,
      new_status: newStatus,
      run_outcome: state.status,
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

  if (coordinatorState.status === 'failed' || coordinatorState.status === 'completed') {
    intent.status = 'failed';
    intent.run_failed_at = now;
    intent.updated_at = now;
    intent.history.push({
      from: previousStatus,
      to: 'failed',
      at: now,
      reason: `coordinator run ${expectedSuperRunId} ended without satisfying workstream ${workstreamId}`,
      super_run_id: expectedSuperRunId,
      run_status: coordinatorState.status,
    });

    safeWriteJson(intentPath, intent);
    return {
      ok: true,
      intent,
      previous_status: previousStatus,
      new_status: 'failed',
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
// Exports for testing
// ---------------------------------------------------------------------------

export { VALID_SOURCES, VALID_PRIORITIES, VALID_TRANSITIONS, S1_STATES, TERMINAL_STATES, SCAN_SOURCES };
