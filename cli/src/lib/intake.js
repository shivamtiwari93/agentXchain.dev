import { existsSync, readFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { safeWriteJson } from './safe-write.js';
import { VALID_GOVERNED_TEMPLATE_IDS } from './governed-templates.js';

const VALID_SOURCES = ['manual', 'ci_failure', 'git_ref_change', 'schedule'];
const VALID_PRIORITIES = ['p0', 'p1', 'p2', 'p3'];
const EVENT_ID_RE = /^evt_\d+_[0-9a-f]{4}$/;
const INTENT_ID_RE = /^intent_\d+_[0-9a-f]{4}$/;

// V3-S1 states only
const S1_STATES = new Set(['detected', 'triaged', 'approved', 'planned', 'suppressed', 'rejected']);
const TERMINAL_STATES = new Set(['suppressed', 'rejected']);

const VALID_TRANSITIONS = {
  detected: ['triaged', 'suppressed'],
  triaged: ['approved', 'rejected'],
  approved: ['planned'],
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
// Exports for testing
// ---------------------------------------------------------------------------

export { VALID_SOURCES, VALID_PRIORITIES, VALID_TRANSITIONS, S1_STATES, TERMINAL_STATES };
