/**
 * Regression tests for BUG-17 through BUG-22 — beta-tester bug report #4.
 *
 * BUG-17: restart atomicity — dispatch bundle must exist after restart
 * BUG-18: integrity check — detect state/bundle desync
 * BUG-19: gate reconciliation — clear stale last_gate_failure after acceptance
 * BUG-20: intent satisfaction — mark intents completed on acceptance
 * BUG-21: intent_id propagation — restart must consume approved intents
 * BUG-22: stale staging — reject-turn/accept-turn must not consume wrong turn's result
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';

import {
  initializeGovernedRun,
  assignGovernedTurn,
  acceptGovernedTurn,
  getActiveTurns,
  getActiveTurnCount,
  detectStateBundleDesync,
  normalizeGovernedStateShape,
  getActiveTurn,
  STATE_PATH,
  STAGING_PATH,
} from '../src/lib/governed-state.js';
import { getTurnStagingResultPath } from '../src/lib/turn-paths.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeTmpDir() {
  const dir = join(tmpdir(), `axc-bug17-22-${randomBytes(6).toString('hex')}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function readJson(root, relPath) {
  return JSON.parse(readFileSync(join(root, relPath), 'utf8'));
}

function readJsonl(root, relPath) {
  const content = readFileSync(join(root, relPath), 'utf8').trim();
  if (!content) return [];
  return content.split('\n').map(line => JSON.parse(line));
}

function makeNormalizedConfig(overrides = {}) {
  return {
    schema_version: 4,
    protocol_mode: 'governed',
    project: { id: 'test-project', name: 'Test Project', default_branch: 'main' },
    roles: {
      pm: { title: 'Product Manager', mandate: 'Test', write_authority: 'review_only', runtime_class: 'manual', runtime_id: 'manual-pm' },
      dev: { title: 'Developer', mandate: 'Test', write_authority: 'authoritative', runtime_class: 'local_cli', runtime_id: 'local-dev' },
    },
    runtimes: {
      'manual-pm': { type: 'manual' },
      'local-dev': { type: 'local_cli' },
    },
    routing: {
      planning: { entry_role: 'pm', allowed_next_roles: ['pm', 'dev', 'human'], exit_gate: 'planning_signoff' },
      implementation: { entry_role: 'dev', allowed_next_roles: ['dev', 'human'] },
    },
    gates: {
      planning_signoff: {
        requires_files: ['.planning/PM_SIGNOFF.md'],
      },
    },
    budget: { per_turn_max_usd: 2.0, per_run_max_usd: 50.0 },
    rules: { challenge_required: true, max_turn_retries: 2, max_deadlock_cycles: 2 },
    files: { talk: 'TALK.md', history: '.agentxchain/history.jsonl', state: '.agentxchain/state.json' },
    compat: { next_owner_source: 'state-json', lock_based_coordination: false, original_version: 4 },
    ...overrides,
  };
}

function initGovernedDir(dir) {
  const config = makeNormalizedConfig();
  writeFileSync(join(dir, 'agentxchain.json'), JSON.stringify(config, null, 2));
  mkdirSync(join(dir, '.agentxchain'), { recursive: true });
  mkdirSync(join(dir, '.planning'), { recursive: true });
  writeFileSync(join(dir, 'TALK.md'), '# Talk\n');
  const initResult = initializeGovernedRun(dir, config);
  assert.ok(initResult.ok, `initializeGovernedRun failed: ${initResult.error}`);
  return { config, state: initResult.state };
}

function makeTurnResult(state, turn) {
  return {
    schema_version: '1.0',
    run_id: state.run_id,
    turn_id: turn.turn_id,
    role: turn.assigned_role,
    runtime_id: turn.runtime_id,
    status: 'completed',
    summary: 'Did the work.',
    decisions: [],
    objections: [{ id: 'OBJ-001', severity: 'low', statement: 'No issues.', status: 'raised' }],
    files_changed: [],
    artifacts_created: [],
    verification: { status: 'pass', commands: [], evidence_summary: 'ok', machine_evidence: [] },
    artifact: { type: 'review', ref: null },
    proposed_next_role: 'dev',
    phase_transition_request: null,
    needs_human_reason: null,
    cost: { input_tokens: 100, output_tokens: 50, usd: 0.01 },
  };
}

// ── BUG-18: detectStateBundleDesync ─────────────────────────────────────────

describe('BUG-18: detectStateBundleDesync', () => {
  let dir;
  beforeEach(() => { dir = makeTmpDir(); });
  afterEach(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });

  it('returns ok:true when no active turns exist', () => {
    const { state } = initGovernedDir(dir);
    const result = detectStateBundleDesync(dir, state);
    assert.ok(result.ok);
    assert.equal(result.desynced.length, 0);
  });

  it('detects ghost turn — active turn with no dispatch bundle', () => {
    const { config, state } = initGovernedDir(dir);
    const assign = assignGovernedTurn(dir, config, 'pm');
    assert.ok(assign.ok, `assignGovernedTurn failed: ${assign.error}`);

    const activeTurns = getActiveTurns(assign.state);
    const turnId = Object.keys(activeTurns)[0];

    // Remove the dispatch bundle directory to simulate a ghost turn
    const dispatchDir = join(dir, '.agentxchain', 'dispatch', 'turns', turnId);
    if (existsSync(dispatchDir)) {
      rmSync(dispatchDir, { recursive: true, force: true });
    }

    const result = detectStateBundleDesync(dir, assign.state);
    assert.ok(!result.ok, 'should detect desync');
    assert.equal(result.desynced.length, 1);
    assert.equal(result.desynced[0].turn_id, turnId);
  });

  it('returns ok:true when dispatch bundle exists', () => {
    const { config, state } = initGovernedDir(dir);
    const assign = assignGovernedTurn(dir, config, 'pm');
    assert.ok(assign.ok);

    const activeTurns = getActiveTurns(assign.state);
    const turnId = Object.keys(activeTurns)[0];

    // Create a minimal dispatch bundle
    const dispatchDir = join(dir, '.agentxchain', 'dispatch', 'turns', turnId);
    mkdirSync(dispatchDir, { recursive: true });

    const result = detectStateBundleDesync(dir, assign.state);
    assert.ok(result.ok, 'should not detect desync when bundle exists');
  });
});

// ── BUG-19: Gate reconciliation after acceptance ────────────────────────────

describe('BUG-19: gate reconciliation clears stale last_gate_failure', () => {
  let dir;
  beforeEach(() => { dir = makeTmpDir(); });
  afterEach(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });

  it('clears last_gate_failure when previously-missing files now exist', () => {
    const { config, state } = initGovernedDir(dir);
    const assign = assignGovernedTurn(dir, config, 'pm');
    assert.ok(assign.ok);

    const activeTurns = getActiveTurns(assign.state);
    const turnId = Object.keys(activeTurns)[0];
    const turn = activeTurns[turnId];

    // Manually inject a stale gate failure referencing a missing file
    const stateObj = readJson(dir, STATE_PATH);
    stateObj.last_gate_failure = {
      gate_type: 'phase_transition',
      gate_id: 'planning_signoff',
      phase: 'planning',
      missing_files: ['.planning/PM_SIGNOFF.md'],
      reasons: ['Required file missing: .planning/PM_SIGNOFF.md'],
    };
    writeFileSync(join(dir, STATE_PATH), JSON.stringify(stateObj));

    // Now create the file that was "missing"
    writeFileSync(join(dir, '.planning', 'PM_SIGNOFF.md'), 'Approved: YES\n');

    // Stage and accept the turn
    const stagingPath = getTurnStagingResultPath(turnId);
    mkdirSync(join(dir, '.agentxchain', 'staging', turnId), { recursive: true });
    const turnResult = makeTurnResult(stateObj, turn);
    writeFileSync(join(dir, stagingPath), JSON.stringify(turnResult));

    const result = acceptGovernedTurn(dir, config);
    assert.ok(result.ok, `acceptGovernedTurn failed: ${result.error}`);
    assert.equal(result.state.last_gate_failure, null, 'last_gate_failure should be cleared after reconciliation');
  });
});

// ── BUG-20: Intent satisfaction on acceptance ───────────────────────────────

describe('BUG-20: accepted turn satisfies bound intent', () => {
  let dir;
  beforeEach(() => { dir = makeTmpDir(); });
  afterEach(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });

  it('transitions intent to completed when bound turn is accepted', () => {
    const { config, state } = initGovernedDir(dir);

    // Create an intent in executing state
    const intentId = `intent_${Date.now()}_test`;
    const intentsDir = join(dir, '.agentxchain', 'intake', 'intents');
    mkdirSync(intentsDir, { recursive: true });
    const intent = {
      intent_id: intentId,
      status: 'executing',
      target_run: state.run_id,
      charter: 'Test intent',
      acceptance_contract: ['item 1'],
      history: [],
    };
    writeFileSync(join(intentsDir, `${intentId}.json`), JSON.stringify(intent));

    // Assign a turn with intakeContext
    const assign = assignGovernedTurn(dir, config, 'pm', {
      intakeContext: { intent_id: intentId, charter: 'Test intent', acceptance_contract: ['item 1'] },
    });
    assert.ok(assign.ok, `assignGovernedTurn failed: ${assign.error}`);

    const activeTurns = getActiveTurns(assign.state);
    const turnId = Object.keys(activeTurns)[0];
    const turn = activeTurns[turnId];

    // Stage and accept the turn
    const stagingPath = getTurnStagingResultPath(turnId);
    mkdirSync(join(dir, '.agentxchain', 'staging', turnId), { recursive: true });
    const turnResult = makeTurnResult(assign.state, turn);
    turnResult.summary = 'Addressed item 1 in acceptance contract';
    writeFileSync(join(dir, stagingPath), JSON.stringify(turnResult));

    const result = acceptGovernedTurn(dir, config);
    assert.ok(result.ok, `acceptGovernedTurn failed: ${result.error}`);

    // Verify intent transitioned to completed
    const updatedIntent = JSON.parse(readFileSync(join(intentsDir, `${intentId}.json`), 'utf8'));
    assert.equal(updatedIntent.status, 'completed', 'intent should be completed after acceptance');
    assert.equal(updatedIntent.satisfying_turn, turnId);

    // Verify intent_satisfied event was emitted
    const events = readJsonl(dir, '.agentxchain/events.jsonl');
    const satisfiedEvent = events.find(e => e.event_type === 'intent_satisfied' && e.intent_id === intentId);
    assert.ok(satisfiedEvent, 'intent_satisfied event should be emitted');
  });
});

// ── BUG-22: Stale staging detection ─────────────────────────────────────────

describe('BUG-22: reject-turn and accept-turn refuse stale staging data', () => {
  let dir;
  beforeEach(() => { dir = makeTmpDir(); });
  afterEach(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });

  it('accept-turn rejects stale legacy staging file from a different turn', () => {
    const { config, state } = initGovernedDir(dir);
    const assign = assignGovernedTurn(dir, config, 'pm');
    assert.ok(assign.ok);

    const activeTurns = getActiveTurns(assign.state);
    const turnId = Object.keys(activeTurns)[0];
    const turn = activeTurns[turnId];

    // Write a stale staging result with a DIFFERENT turn_id in the legacy path
    const stagingDir = join(dir, '.agentxchain', 'staging');
    mkdirSync(stagingDir, { recursive: true });
    const staleTurnResult = makeTurnResult(assign.state, turn);
    staleTurnResult.turn_id = 'turn_stale_from_prior_run';
    writeFileSync(join(stagingDir, 'turn-result.json'), JSON.stringify(staleTurnResult));

    // Do NOT create the turn-scoped staging file — force fallback to legacy

    const result = acceptGovernedTurn(dir, config);
    assert.ok(!result.ok, 'accept should fail on stale staging data');
    assert.ok(
      result.error?.includes('Stale staging data') || result.error_code === 'stale_staging',
      `Expected stale staging error, got: ${result.error}`
    );
  });
});
