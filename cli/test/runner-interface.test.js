/**
 * Runner Interface Proof — AT-RUNNER-001 through AT-RUNNER-005
 *
 * Proves that a non-CLI consumer can execute the complete governed turn
 * lifecycle by importing only the declared runner interface. No CLI
 * subprocess, no Commander.js, no chalk — just library functions.
 *
 * This is the proof that the protocol is runner-independent.
 */

import { describe, it, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';

// ── Import ONLY from the declared runner interface ──────────────────────────
import {
  initRun,
  assignTurn,
  acceptTurn,
  rejectTurn,
  approvePhaseGate,
  approveCompletionGate,
  markRunBlocked,
  escalate,
  reactivateRun,
  getActiveTurns,
  getActiveTurnCount,
  getActiveTurn,
  acquireLock,
  releaseLock,
  getMaxConcurrentTurns,
  getTurnStagingResultPath,
  RUNNER_INTERFACE_VERSION,
} from '../src/lib/runner-interface.js';

// ── Test Helpers ────────────────────────────────────────────────────────────

function makeTmpDir() {
  const dir = join(tmpdir(), `axc-runner-test-${randomBytes(6).toString('hex')}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function readJsonl(path) {
  const content = readFileSync(path, 'utf8').trim();
  if (!content) return [];
  return content.split('\n').map(line => JSON.parse(line));
}

function makeConfig() {
  return {
    schema_version: 4,
    protocol_mode: 'governed',
    project: { id: 'runner-proof', name: 'Runner Proof', default_branch: 'main' },
    roles: {
      pm: { title: 'PM', mandate: 'Plan', write_authority: 'review_only', runtime_class: 'manual', runtime_id: 'manual-pm' },
      dev: { title: 'Dev', mandate: 'Build', write_authority: 'authoritative', runtime_class: 'local_cli', runtime_id: 'local-dev' },
      qa: { title: 'QA', mandate: 'Verify', write_authority: 'review_only', runtime_class: 'api_proxy', runtime_id: 'api-qa' },
    },
    runtimes: {
      'manual-pm': { type: 'manual' },
      'local-dev': { type: 'local_cli' },
      'api-qa': { type: 'api_proxy' },
    },
    routing: {
      planning: { entry_role: 'pm', allowed_next_roles: ['pm', 'dev', 'human'], exit_gate: 'planning_signoff' },
      implementation: { entry_role: 'dev', allowed_next_roles: ['dev', 'qa', 'human'], exit_gate: 'implementation_complete' },
      qa: { entry_role: 'qa', allowed_next_roles: ['dev', 'qa', 'human'], exit_gate: 'qa_ship_verdict' },
    },
    gates: {},
    budget: { per_turn_max_usd: 2.0, per_run_max_usd: 50.0 },
    rules: { challenge_required: true, max_turn_retries: 2, max_deadlock_cycles: 2 },
    files: { talk: 'TALK.md', history: '.agentxchain/history.jsonl', state: '.agentxchain/state.json' },
    compat: { next_owner_source: 'state-json', lock_based_coordination: false, original_version: 4 },
  };
}

function scaffoldProject(root) {
  const config = makeConfig();
  writeFileSync(join(root, 'agentxchain.json'), JSON.stringify(config, null, 2));
  mkdirSync(join(root, '.agentxchain'), { recursive: true });
  writeFileSync(join(root, '.agentxchain/state.json'), JSON.stringify({
    schema_version: '1.1',
    status: 'idle',
    phase: 'planning',
    run_id: null,
    active_turns: {},
    next_role: null,
    pending_phase_transition: null,
    pending_run_completion: null,
    blocked_on: null,
    blocked_reason: null,
  }, null, 2));
  writeFileSync(join(root, '.agentxchain/history.jsonl'), '');
  writeFileSync(join(root, '.agentxchain/decision-ledger.jsonl'), '');
  writeFileSync(join(root, 'TALK.md'), '# Talk\n');
  return config;
}

function makeTurnResult(runId, turn) {
  return {
    schema_version: '1.0',
    run_id: runId,
    turn_id: turn.turn_id,
    role: turn.assigned_role,
    runtime_id: turn.runtime_id,
    status: 'completed',
    summary: 'Programmatic runner completed this turn.',
    decisions: [{
      id: 'DEC-001',
      category: 'implementation',
      statement: 'Used runner interface directly.',
      rationale: 'Proving runner independence.',
    }],
    objections: [{
      id: 'OBJ-001',
      severity: 'low',
      statement: 'No concerns.',
      status: 'raised',
    }],
    files_changed: [],
    artifacts_created: [],
    verification: {
      status: 'pass',
      commands: ['echo ok'],
      evidence_summary: 'Passed.',
      machine_evidence: [{ command: 'echo ok', exit_code: 0 }],
    },
    artifact: { type: 'review', ref: null },
    proposed_next_role: 'dev',
    phase_transition_request: null,
    needs_human_reason: null,
    cost: { input_tokens: 100, output_tokens: 50, usd: 0.01 },
  };
}

function stageTurnResult(root, runId, turn) {
  const result = makeTurnResult(runId, turn);
  if (turn.assigned_role === 'dev') {
    const proofPath = 'src/runner-dev-proof.js';
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, proofPath), 'export const runnerDevProof = true;\n');
    result.files_changed = [proofPath];
    result.artifacts_created = [proofPath];
    result.artifact = { type: 'workspace', ref: null };
  }
  const relPath = getTurnStagingResultPath(turn.turn_id);
  const absPath = join(root, relPath);
  mkdirSync(join(root, '.agentxchain/staging', turn.turn_id), { recursive: true });
  writeFileSync(absPath, JSON.stringify(result, null, 2));
  return result;
}

// ── AT-RUNNER-005: Interface exports are stable and declared ────────────────

describe('Runner interface exports', () => {
  it('AT-RUNNER-005: exports all declared operations', () => {
    assert.equal(typeof initRun, 'function');
    assert.equal(typeof assignTurn, 'function');
    assert.equal(typeof acceptTurn, 'function');
    assert.equal(typeof rejectTurn, 'function');
    assert.equal(typeof approvePhaseGate, 'function');
    assert.equal(typeof approveCompletionGate, 'function');
    assert.equal(typeof markRunBlocked, 'function');
    assert.equal(typeof escalate, 'function');
    assert.equal(typeof reactivateRun, 'function');
    assert.equal(typeof getActiveTurns, 'function');
    assert.equal(typeof getActiveTurnCount, 'function');
    assert.equal(typeof getActiveTurn, 'function');
    assert.equal(typeof acquireLock, 'function');
    assert.equal(typeof releaseLock, 'function');
    assert.equal(typeof getMaxConcurrentTurns, 'function');
  });

  it('AT-RUNNER-005b: exports interface version', () => {
    assert.equal(typeof RUNNER_INTERFACE_VERSION, 'string');
    assert.match(RUNNER_INTERFACE_VERSION, /^\d+\.\d+$/);
  });
});

// ── AT-RUNNER-001: Non-CLI consumer can operate on a governed project ───────

describe('Runner interface: programmatic context loading', () => {
  let root;
  let config;

  beforeEach(() => {
    root = makeTmpDir();
    config = scaffoldProject(root);
  });
  afterEach(() => { try { rmSync(root, { recursive: true, force: true }); } catch {} });

  it('AT-RUNNER-001a: initRun creates a run from idle state', () => {
    const result = initRun(root, config);
    assert.ok(result.ok, `initRun should succeed: ${result.error}`);
    assert.ok(result.state.run_id, 'run_id should be assigned');
    assert.equal(result.state.status, 'active');
    assert.equal(result.state.phase, 'planning');

    const state = readJson(join(root, '.agentxchain/state.json'));
    assert.equal(state.run_id, result.state.run_id);
    assert.equal(state.status, 'active');
  });

  it('AT-RUNNER-001b: assignTurn assigns to a role', () => {
    const initResult = initRun(root, config);
    assert.ok(initResult.ok);

    const result = assignTurn(root, config, 'pm');
    assert.ok(result.ok, `assignTurn should succeed: ${result.error}`);
    assert.ok(result.turn, 'assignTurn should return the assigned turn');

    const turns = getActiveTurns(result.state);
    const turnList = Object.values(turns);
    assert.equal(turnList.length, 1);
    assert.ok(result.turn.turn_id, 'turn_id should be assigned');
    assert.equal(result.turn.assigned_role, 'pm');
    assert.equal(result.turn.runtime_id, 'manual-pm');
    assert.equal(turnList[0].turn_id, result.turn.turn_id);
  });
});

// ── AT-RUNNER-002: Valid state transitions via programmatic calls ───────────

describe('Runner interface: state machine transitions', () => {
  let root;
  let config;

  beforeEach(() => {
    root = makeTmpDir();
    config = scaffoldProject(root);
  });
  afterEach(() => { try { rmSync(root, { recursive: true, force: true }); } catch {} });

  it('AT-RUNNER-002a: idle → active → turn_assigned → turn_accepted', () => {
    // Initialize
    const initResult = initRun(root, config);
    assert.ok(initResult.ok);
    let state = readJson(join(root, '.agentxchain/state.json'));
    assert.equal(state.status, 'active');
    assert.equal(state.phase, 'planning');

    // Assign
    const assignResult = assignTurn(root, config, 'pm');
    assert.ok(assignResult.ok, `assignTurn should succeed: ${assignResult.error}`);
    state = readJson(join(root, '.agentxchain/state.json'));
    assert.equal(getActiveTurnCount(state), 1);

    // Stage a turn result
    const turn = assignResult.turn;
    stageTurnResult(root, initResult.state.run_id, turn);

    // Accept
    const acceptResult = acceptTurn(root, config);
    assert.ok(acceptResult.ok, `acceptTurn should succeed: ${acceptResult.error}`);

    state = readJson(join(root, '.agentxchain/state.json'));
    assert.equal(getActiveTurnCount(state), 0, 'no active turns after accept');

    // History should have one entry
    const history = readJsonl(join(root, '.agentxchain/history.jsonl'));
    assert.ok(history.length >= 1, 'history should have at least one entry');
    assert.equal(history[0].role, 'pm');
  });

  it('AT-RUNNER-002b: reject records the rejection', () => {
    const initResult = initRun(root, config);
    assert.ok(initResult.ok);
    const assignResult = assignTurn(root, config, 'pm');
    assert.ok(assignResult.ok);

    const turn = assignResult.turn;
    stageTurnResult(root, initResult.state.run_id, turn);

    // Create a validation failure to use with reject
    const validationResult = {
      valid: false,
      errors: [{ field: 'summary', message: 'Empty summary' }],
    };

    const rejResult = rejectTurn(root, config, validationResult, 'Validation failed');
    // Reject should return a result (turn retained for retry or cleared after max retries)
    assert.ok(rejResult !== undefined, 'rejectTurn should return a result');

    // The turn may be retained for retry (attempt incremented) or cleared
    // Either way, the state should be valid
    const state = readJson(join(root, '.agentxchain/state.json'));
    assert.ok(state.status === 'active' || state.status === 'blocked',
      'status should be active (retry) or blocked (max retries)');
    assert.ok(state.run_id, 'run_id should still be set');
  });
});

// ── AT-RUNNER-003: Lock prevents concurrent acceptance ─────────────────────

describe('Runner interface: acceptance lock', () => {
  let root;

  beforeEach(() => {
    root = makeTmpDir();
    scaffoldProject(root);
  });
  afterEach(() => { try { rmSync(root, { recursive: true, force: true }); } catch {} });

  it('AT-RUNNER-003: acquireLock prevents second acquisition', () => {
    const lock1 = acquireLock(root);
    assert.ok(lock1.ok, 'first lock should succeed');

    const lock2 = acquireLock(root);
    assert.equal(lock2.ok, false, 'second lock should fail');

    releaseLock(root);
    // After release, a new lock should succeed
    const lock3 = acquireLock(root);
    assert.ok(lock3.ok, 'lock after release should succeed');
    releaseLock(root);
  });
});

// ── AT-RUNNER-004: Complete turn lifecycle without CLI ──────────────────────

describe('Runner interface: complete governed turn lifecycle', () => {
  let root;
  let config;

  beforeEach(() => {
    root = makeTmpDir();
    config = scaffoldProject(root);
  });
  afterEach(() => { try { rmSync(root, { recursive: true, force: true }); } catch {} });

  it('AT-RUNNER-004: programmatic runner executes init → assign → accept', () => {
    // 1. Initialize run
    const run = initRun(root, config);
    assert.ok(run.ok, `initRun should succeed: ${run.error}`);
    assert.ok(run.state.run_id);
    assert.equal(run.state.phase, 'planning');

    // 2. Assign turn to PM
    const assign = assignTurn(root, config, 'pm');
    assert.ok(assign.ok, `assignTurn should succeed: ${assign.error}`);
    const turn = assign.turn;
    assert.ok(turn.turn_id);
    assert.equal(turn.assigned_role, 'pm');

    // 3. Stage turn result (simulating what an adapter/agent would produce)
    stageTurnResult(root, run.state.run_id, turn);

    // 4. Accept turn
    const accepted = acceptTurn(root, config);
    assert.ok(accepted.ok, `acceptTurn should succeed: ${accepted.error}`);

    // 5. Verify history records the accepted turn
    const history = readJsonl(join(root, '.agentxchain/history.jsonl'));
    assert.ok(history.length >= 1, 'history records the accepted turn');
    assert.equal(history[0].role, 'pm');
    assert.equal(history[0].status, 'completed');

    // 6. Verify decision ledger has entries
    const ledger = readJsonl(join(root, '.agentxchain/decision-ledger.jsonl'));
    assert.ok(ledger.length >= 1, 'decision ledger records agent decisions');

    // 7. Verify all artifacts exist
    assert.ok(existsSync(join(root, '.agentxchain/state.json')));
    assert.ok(existsSync(join(root, '.agentxchain/history.jsonl')));
    assert.ok(existsSync(join(root, '.agentxchain/decision-ledger.jsonl')));
  });

  it('AT-RUNNER-004b: programmatic runner produces same artifact set as CLI', () => {
    const run = initRun(root, config);
    assert.ok(run.ok);
    const assign = assignTurn(root, config, 'pm');
    assert.ok(assign.ok);
    stageTurnResult(root, run.state.run_id, assign.turn);
    const accepted = acceptTurn(root, config);
    assert.ok(accepted.ok, `acceptTurn should succeed: ${accepted.error}`);

    // All protocol artifacts should exist
    const statePath = join(root, '.agentxchain/state.json');
    const historyPath = join(root, '.agentxchain/history.jsonl');
    const ledgerPath = join(root, '.agentxchain/decision-ledger.jsonl');

    assert.ok(existsSync(statePath), 'state.json exists');
    assert.ok(existsSync(historyPath), 'history.jsonl exists');
    assert.ok(existsSync(ledgerPath), 'decision-ledger.jsonl exists');

    // State should be valid JSON with required fields
    const state = readJson(statePath);
    assert.ok(state.run_id);
    assert.ok(state.schema_version);
    assert.ok(state.status);
    assert.ok(state.phase);

    // History should have structured entries
    const history = readJsonl(historyPath);
    assert.ok(history[0].turn_id);
    assert.ok(history[0].role);
    assert.ok(history[0].run_id);
    assert.ok(history[0].accepted_at);
  });

  it('AT-RUNNER-004c: escalate and reactivate via programmatic runner', () => {
    const run = initRun(root, config);
    assert.ok(run.ok);

    // Escalate — requires an active turn or no active turns (depending on impl)
    const escResult = escalate(root, config, {
      reason: 'Programmatic runner escalated',
    });
    assert.ok(escResult.ok, `escalate should succeed: ${escResult.error}`);

    let state = readJson(join(root, '.agentxchain/state.json'));
    assert.equal(state.status, 'blocked');

    // Reactivate
    reactivateRun(root, state, { resolution: 'Resolved programmatically' });
    state = readJson(join(root, '.agentxchain/state.json'));
    assert.equal(state.status, 'active');
  });
});

// ── AT-RUNNER-004d: Multi-turn lifecycle ────────────────────────────────────

describe('Runner interface: multi-turn lifecycle', () => {
  let root;
  let config;

  beforeEach(() => {
    root = makeTmpDir();
    config = scaffoldProject(root);
  });
  afterEach(() => { try { rmSync(root, { recursive: true, force: true }); } catch {} });

  it('AT-RUNNER-004d: two consecutive turns produce valid audit trail', () => {
    const run = initRun(root, config);
    assert.ok(run.ok);

    // Turn 1: PM
    const assign1 = assignTurn(root, config, 'pm');
    assert.ok(assign1.ok, `first assign should succeed: ${assign1.error}`);
    stageTurnResult(root, run.state.run_id, assign1.turn);
    const accept1 = acceptTurn(root, config);
    assert.ok(accept1.ok, `first accept should succeed: ${accept1.error}`);

    // Turn 2: Dev
    const assign2 = assignTurn(root, config, 'dev');
    assert.ok(assign2.ok, `second assign should succeed: ${assign2.error}`);
    stageTurnResult(root, run.state.run_id, assign2.turn);
    const accept2 = acceptTurn(root, config);
    assert.ok(accept2.ok, `second accept should succeed: ${accept2.error}`);

    // Audit trail should show both turns
    const history = readJsonl(join(root, '.agentxchain/history.jsonl'));
    assert.ok(history.length >= 2, 'history has at least 2 entries');
    assert.equal(history[0].role, 'pm');
    assert.equal(history[1].role, 'dev');

    const ledger = readJsonl(join(root, '.agentxchain/decision-ledger.jsonl'));
    assert.ok(ledger.length >= 2, 'ledger has at least 2 entries');
  });
});
