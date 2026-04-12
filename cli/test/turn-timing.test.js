import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';
import { execSync } from 'child_process';

import {
  initializeGovernedRun,
  assignGovernedTurn,
  acceptGovernedTurn,
  getActiveTurn,
  normalizeGovernedStateShape,
  HISTORY_PATH,
} from '../src/lib/governed-state.js';
import { scaffoldGoverned } from '../src/commands/init.js';
import { RUN_EVENTS_PATH } from '../src/lib/run-events.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeTmpDir() {
  const dir = join(tmpdir(), `axc-timing-${randomBytes(6).toString('hex')}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function readJsonl(root, relPath) {
  const content = readFileSync(join(root, relPath), 'utf8').trim();
  if (!content) return [];
  return content.split('\n').map(line => JSON.parse(line));
}

function makeNormalizedConfig() {
  return {
    schema_version: 4,
    protocol_mode: 'governed',
    project: { id: 'test-timing', name: 'Test Timing', default_branch: 'main' },
    roles: {
      dev: { title: 'Developer', mandate: 'Test', write_authority: 'authoritative', runtime_class: 'local_cli', runtime_id: 'local-dev' },
    },
    runtimes: { 'local-dev': { type: 'local_cli' } },
    routing: {
      planning: { entry_role: 'dev', allowed_next_roles: ['dev', 'human'], exit_gate: 'planning_signoff' },
    },
    gates: {},
    budget: { per_turn_max_usd: 2.0, per_run_max_usd: 50.0 },
    rules: { challenge_required: false, max_turn_retries: 2, max_deadlock_cycles: 2 },
    files: { talk: 'TALK.md', history: '.agentxchain/history.jsonl', state: '.agentxchain/state.json' },
    compat: { next_owner_source: 'state-json', lock_based_coordination: false, original_version: 4 },
  };
}

function makeTurnResult(state) {
  const turn = getActiveTurn(state);
  return {
    schema_version: '1.0',
    run_id: state.run_id,
    turn_id: turn.turn_id,
    role: turn.assigned_role,
    runtime_id: turn.runtime_id,
    status: 'completed',
    summary: 'Timing test turn.',
    decisions: [],
    objections: [],
    files_changed: [],
    artifacts_created: [],
    verification: { status: 'pass', commands: ['echo ok'], evidence_summary: 'OK', machine_evidence: [{ command: 'echo ok', exit_code: 0 }] },
    artifact: { type: 'review', ref: null },
    proposed_next_role: 'dev',
    phase_transition_request: null,
    needs_human_reason: null,
    cost: { input_tokens: 100, output_tokens: 50, usd: 0.01 },
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Turn Timing Observability', () => {
  let dir, config;

  beforeEach(() => {
    dir = makeTmpDir();
    config = makeNormalizedConfig();
    scaffoldGoverned(dir, 'Test Timing', 'test-timing');
    initializeGovernedRun(dir, config);
  });

  afterEach(() => {
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  });

  it('history entry includes started_at and duration_ms after acceptance', () => {
    const assignResult = assignGovernedTurn(dir, config, 'dev');
    assert.ok(assignResult.ok);

    const state = assignResult.state;
    const turnResult = makeTurnResult(state);
    const stagingPath = join(dir, '.agentxchain', 'staging', 'turn-result.json');
    mkdirSync(join(dir, '.agentxchain', 'staging'), { recursive: true });
    writeFileSync(stagingPath, JSON.stringify(turnResult, null, 2));

    const acceptResult = acceptGovernedTurn(dir, config);
    assert.ok(acceptResult.ok, `Accept failed: ${acceptResult.error}`);

    const history = readJsonl(dir, HISTORY_PATH);
    assert.equal(history.length, 1);

    const entry = history[0];
    assert.ok(entry.started_at, 'history entry must have started_at');
    assert.ok(entry.accepted_at, 'history entry must have accepted_at');
    assert.equal(typeof entry.duration_ms, 'number', 'history entry must have duration_ms as a number');
    assert.ok(entry.duration_ms >= 0, 'duration_ms must be non-negative');

    // started_at must be a valid ISO date
    assert.ok(!isNaN(new Date(entry.started_at).getTime()), 'started_at must be valid ISO date');

    // started_at must be before or equal to accepted_at
    assert.ok(
      new Date(entry.started_at).getTime() <= new Date(entry.accepted_at).getTime(),
      'started_at must be <= accepted_at',
    );
  });

  it('turn_accepted event includes timing in payload', () => {
    const assignResult = assignGovernedTurn(dir, config, 'dev');
    assert.ok(assignResult.ok);

    const state = assignResult.state;
    const turnResult = makeTurnResult(state);
    const stagingPath = join(dir, '.agentxchain', 'staging', 'turn-result.json');
    mkdirSync(join(dir, '.agentxchain', 'staging'), { recursive: true });
    writeFileSync(stagingPath, JSON.stringify(turnResult, null, 2));

    acceptGovernedTurn(dir, config);

    const events = readJsonl(dir, RUN_EVENTS_PATH);
    const acceptedEvents = events.filter(e => e.event_type === 'turn_accepted');
    assert.ok(acceptedEvents.length >= 1, 'must have at least one turn_accepted event');

    const ev = acceptedEvents[acceptedEvents.length - 1];
    assert.ok(ev.payload, 'turn_accepted event must have payload');
    assert.ok(ev.payload.started_at, 'payload must include started_at');
    assert.equal(typeof ev.payload.duration_ms, 'number', 'payload must include duration_ms as number');
    assert.ok(ev.payload.duration_ms >= 0, 'duration_ms must be non-negative');
  });

  it('duration_ms is consistent with started_at and accepted_at', () => {
    const assignResult = assignGovernedTurn(dir, config, 'dev');
    assert.ok(assignResult.ok);

    const state = assignResult.state;
    const turnResult = makeTurnResult(state);
    const stagingPath = join(dir, '.agentxchain', 'staging', 'turn-result.json');
    mkdirSync(join(dir, '.agentxchain', 'staging'), { recursive: true });
    writeFileSync(stagingPath, JSON.stringify(turnResult, null, 2));

    acceptGovernedTurn(dir, config);

    const history = readJsonl(dir, HISTORY_PATH);
    const entry = history[0];
    const expectedDuration = new Date(entry.accepted_at).getTime() - new Date(entry.started_at).getTime();
    assert.equal(entry.duration_ms, expectedDuration, 'duration_ms must equal accepted_at - started_at');
  });

  it('gracefully handles missing started_at on legacy turns', () => {
    // Simulate a legacy turn without started_at
    const assignResult = assignGovernedTurn(dir, config, 'dev');
    assert.ok(assignResult.ok);

    // Manually remove started_at from the active turn in state
    const stateRaw = JSON.parse(readFileSync(join(dir, '.agentxchain', 'state.json'), 'utf8'));
    const normalized = normalizeGovernedStateShape(stateRaw).state;
    const activeTurn = getActiveTurn(normalized);
    const turnId = activeTurn.turn_id;

    // Remove started_at from active_turns
    if (stateRaw.active_turns?.[turnId]) {
      delete stateRaw.active_turns[turnId].started_at;
    }
    // Also handle legacy current_turn
    if (stateRaw.current_turn) {
      delete stateRaw.current_turn.started_at;
    }
    writeFileSync(join(dir, '.agentxchain', 'state.json'), JSON.stringify(stateRaw, null, 2) + '\n');

    const state = assignResult.state;
    const turnResult = makeTurnResult(state);
    const stagingPath = join(dir, '.agentxchain', 'staging', 'turn-result.json');
    mkdirSync(join(dir, '.agentxchain', 'staging'), { recursive: true });
    writeFileSync(stagingPath, JSON.stringify(turnResult, null, 2));

    // Acceptance must not crash
    const acceptResult = acceptGovernedTurn(dir, config);
    assert.ok(acceptResult.ok, `Accept must not crash on legacy turn: ${acceptResult.error}`);

    const history = readJsonl(dir, HISTORY_PATH);
    const entry = history[0];
    assert.ok(entry.accepted_at, 'accepted_at must still be present');
    // started_at and duration_ms should be absent
    assert.equal(entry.started_at, undefined, 'started_at should be absent for legacy turns');
    assert.equal(entry.duration_ms, undefined, 'duration_ms should be absent for legacy turns');
  });
});
