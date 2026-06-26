/**
 * M4 Acceptance: Crash Recovery via step --resume
 *
 * Proves that a simulated crash during a dev turn in the implementation phase
 * recovers cleanly via `step --resume`. Exercises the full governed state machine:
 * crash detection → PID guard → dispatch-progress cleanup → re-dispatch →
 * turn completion → acceptance → history promotion.
 *
 * These are integration-level acceptance tests — the adapter is mocked, but all
 * state transitions use real production code.
 *
 * Acceptance criterion: ROADMAP.md:64
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { randomBytes } from 'crypto';
import { tmpdir } from 'os';
import { dirname, join } from 'path';

vi.mock('../src/lib/adapters/local-cli-adapter.js', () => ({
  dispatchLocalCli: vi.fn(async () => ({ ok: true, logs: [] })),
  resolveStartupWatchdogMs: vi.fn(() => 30000),
  saveDispatchLogs: vi.fn(),
  resolvePromptTransport: vi.fn(() => 'dispatch_bundle_only'),
}));

import { stepCommand } from '../src/commands/step.js';
import { scaffoldGoverned } from '../src/commands/init.js';
import {
  acceptGovernedTurn,
  assignGovernedTurn,
  getActiveTurn,
  initializeGovernedRun,
  markRunBlocked,
  normalizeGovernedStateShape,
  STATE_PATH,
  transitionActiveTurnLifecycle,
} from '../src/lib/governed-state.js';
import { getDispatchProgressRelativePath } from '../src/lib/dispatch-progress.js';
import { getTurnStagingResultPath } from '../src/lib/turn-paths.js';
import { dispatchLocalCli } from '../src/lib/adapters/local-cli-adapter.js';

const DEAD_PID = 99999999;
const HISTORY_PATH = '.agentxchain/history.jsonl';

function makeTmpDir() {
  const dir = join(tmpdir(), `axc-crash-accept-${randomBytes(6).toString('hex')}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeConfig() {
  return {
    schema_version: '1.0',
    protocol_mode: 'governed',
    project: { id: 'crash-accept-test', name: 'Crash Accept Test', default_branch: 'main' },
    roles: {
      pm: {
        title: 'Product Manager',
        mandate: 'Protect user value.',
        write_authority: 'authoritative',
        runtime: 'local-pm',
      },
      dev: {
        title: 'Developer',
        mandate: 'Implement approved work safely.',
        write_authority: 'authoritative',
        runtime: 'local-dev',
      },
      qa: {
        title: 'QA',
        mandate: 'Challenge correctness.',
        write_authority: 'authoritative',
        runtime: 'local-qa',
      },
    },
    runtimes: {
      'local-pm': { type: 'local_cli', command: 'mock-agent', prompt_transport: 'dispatch_bundle_only' },
      'local-dev': { type: 'local_cli', command: 'mock-agent', prompt_transport: 'dispatch_bundle_only' },
      'local-qa': { type: 'local_cli', command: 'mock-agent', prompt_transport: 'dispatch_bundle_only' },
    },
    routing: {
      planning: { entry_role: 'pm', allowed_next_roles: ['pm', 'dev', 'human'], exit_gate: 'planning_signoff' },
      implementation: { entry_role: 'dev', allowed_next_roles: ['dev', 'qa', 'human'], exit_gate: 'implementation_complete' },
      qa: { entry_role: 'qa', allowed_next_roles: ['dev', 'qa', 'human'], exit_gate: 'qa_ship_verdict' },
    },
    gates: {
      planning_signoff: { requires_files: [], requires_human_approval: false },
      implementation_complete: { requires_files: [], requires_verification_pass: false },
      qa_ship_verdict: { requires_files: [], requires_human_approval: false },
    },
    budget: { per_turn_max_usd: 2.0, per_run_max_usd: 50.0, on_exceed: 'pause_and_escalate' },
    retention: { talk_strategy: 'append_only', history_strategy: 'jsonl_append_only' },
    prompts: {},
    rules: { challenge_required: true, max_turn_retries: 2 },
    files: { talk: 'TALK.md', history: '.agentxchain/history.jsonl', state: '.agentxchain/state.json' },
  };
}

function writeJson(filePath, value) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n');
}

function readState(root) {
  const parsed = JSON.parse(readFileSync(join(root, STATE_PATH), 'utf8'));
  return normalizeGovernedStateShape(parsed).state;
}

function readJsonl(root, relPath) {
  const abs = join(root, relPath);
  if (!existsSync(abs)) return [];
  const raw = readFileSync(abs, 'utf8').trim();
  if (!raw) return [];
  return raw.split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

/**
 * Build a valid PM turn result that requests phase transition to implementation.
 */
function makePmTurnResult(state) {
  const turn = getActiveTurn(state);
  return {
    schema_version: '1.0',
    run_id: state.run_id,
    turn_id: turn.turn_id,
    role: 'pm',
    runtime_id: turn.runtime_id,
    status: 'completed',
    summary: 'Planning complete, advancing to implementation.',
    decisions: [{ id: 'DEC-001', category: 'scope', statement: 'Scoped crash recovery acceptance.', rationale: 'Required by M4.' }],
    objections: [],
    files_changed: [],
    artifacts_created: [],
    verification: { status: 'skipped' },
    artifact: { type: 'review', ref: null },
    proposed_next_role: 'dev',
    phase_transition_request: 'implementation',
    run_completion_request: null,
    needs_human_reason: null,
    cost: { input_tokens: 100, output_tokens: 50, usd: 0.01 },
  };
}

/**
 * Build a valid dev turn result for use in mock dispatch.
 */
function makeDevTurnResult(state) {
  const turn = getActiveTurn(state);
  return {
    schema_version: '1.0',
    run_id: state.run_id,
    turn_id: turn.turn_id,
    role: 'dev',
    runtime_id: turn.runtime_id,
    status: 'completed',
    summary: 'Implementation complete.',
    decisions: [{ id: 'DEC-001', category: 'implementation', statement: 'Implemented feature X.', rationale: 'Required by spec.' }],
    objections: [],
    files_changed: ['src/feature.js'],
    artifacts_created: [],
    verification: { status: 'pass', commands: ['npm test'], evidence_summary: 'All tests pass.', machine_evidence: [{ command: 'npm test', exit_code: 0 }] },
    artifact: { type: 'workspace', ref: null },
    proposed_next_role: 'qa',
    phase_transition_request: null,
    run_completion_request: null,
    needs_human_reason: null,
    cost: { input_tokens: 5000, output_tokens: 2000, usd: 0.05 },
  };
}

function writeDispatchProgress(root, turnId, pid = DEAD_PID) {
  writeJson(join(root, getDispatchProgressRelativePath(turnId)), {
    turn_id: turnId,
    adapter_type: 'local_cli',
    started_at: new Date().toISOString(),
    last_activity_at: new Date().toISOString(),
    activity_type: 'output',
    activity_summary: 'stale fixture progress',
    output_lines: 1,
    pid,
  });
}

function setRunningTurn(root, turnId, pid) {
  const dispatched = transitionActiveTurnLifecycle(root, turnId, 'dispatched');
  assert.equal(dispatched.ok, true, dispatched.error);
  const starting = pid == null
    ? transitionActiveTurnLifecycle(root, turnId, 'starting')
    : transitionActiveTurnLifecycle(root, turnId, 'starting', { pid });
  assert.equal(starting.ok, true, starting.error);
  const running = transitionActiveTurnLifecycle(root, turnId, 'running', { stream: 'stdout' });
  assert.equal(running.ok, true, running.error);
  return running.state;
}

/**
 * Set up a governed project, complete a PM turn (advancing to implementation),
 * then assign a dev turn and set it to running with a dead PID.
 *
 * Returns the project root, config, state, and dev turn metadata.
 */
function setupCrashedDevTurn(root) {
  const config = makeConfig();

  // Scaffold governed project
  scaffoldGoverned(root, 'Crash Accept Test', 'crash-accept-test');
  writeJson(join(root, 'agentxchain.json'), config);

  // Initialize governed run
  const initialized = initializeGovernedRun(root, config);
  assert.equal(initialized.ok, true, initialized.error);

  // Assign PM turn and advance through lifecycle
  const pmAssigned = assignGovernedTurn(root, config, 'pm');
  assert.equal(pmAssigned.ok, true, pmAssigned.error);
  const pmTurn = getActiveTurn(pmAssigned.state);

  // Transition PM turn through lifecycle: dispatched → starting → running
  setRunningTurn(root, pmTurn.turn_id, null);

  // Write PM staged turn result with phase_transition_request: 'implementation'
  const pmState = readState(root);
  const pmResult = makePmTurnResult(pmState);
  writeJson(join(root, getTurnStagingResultPath(pmTurn.turn_id)), pmResult);

  // Accept PM turn — should advance to implementation phase
  const accepted = acceptGovernedTurn(root, config);
  assert.equal(accepted.ok, true, `PM acceptance failed: ${accepted.error}`);

  // Verify we're now in implementation phase
  const postPmState = readState(root);
  assert.equal(postPmState.phase, 'implementation', 'Expected implementation phase after PM acceptance');

  // Assign dev turn
  const devAssigned = assignGovernedTurn(root, config, 'dev');
  assert.equal(devAssigned.ok, true, devAssigned.error);
  const devTurn = getActiveTurn(devAssigned.state);

  // Set dev turn to running with a dead PID
  const runningState = setRunningTurn(root, devTurn.turn_id, DEAD_PID);

  // Write stale dispatch-progress to simulate in-flight state
  writeDispatchProgress(root, devTurn.turn_id, DEAD_PID);

  return { config, state: runningState, devTurn };
}

async function runStep(root, opts = {}) {
  const previousCwd = process.cwd();
  process.chdir(root);
  try {
    await stepCommand({ resume: true, poll: '1', ...opts });
  } finally {
    process.chdir(previousCwd);
  }
}

let tmpDirs = [];

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  for (const dir of tmpDirs) {
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }
  tmpDirs = [];
});

describe('M4 acceptance: simulated crash during dev turn recovers cleanly via step --resume', () => {
  it('AT-CRASH-001: dev turn crash detected and re-dispatched', async () => {
    const root = makeTmpDir();
    tmpDirs.push(root);
    const { config, devTurn } = setupCrashedDevTurn(root);

    // Mock: write valid staged dev turn result on re-dispatch
    dispatchLocalCli.mockImplementation(async (dispatchRoot, state) => {
      const turn = getActiveTurn(state);
      writeJson(join(dispatchRoot, getTurnStagingResultPath(turn.turn_id)), makeDevTurnResult(state));
      return { ok: true, logs: [] };
    });

    const progressPath = join(root, getDispatchProgressRelativePath(devTurn.turn_id));
    assert.equal(existsSync(progressPath), true, 'Precondition: dispatch-progress file exists');

    await runStep(root);

    // 1. dispatchLocalCli was called exactly once (re-dispatch)
    expect(dispatchLocalCli).toHaveBeenCalledTimes(1);

    // 2. The state passed to dispatch has correct status
    const dispatchedState = dispatchLocalCli.mock.calls[0][1];
    assert.equal(dispatchedState.active_turns[devTurn.turn_id].status, 'dispatched',
      'Re-dispatched turn should have status "dispatched"');

    // 3. worker_pid is cleared
    assert.equal(dispatchedState.active_turns[devTurn.turn_id].worker_pid, undefined,
      'Re-dispatched turn should have no worker_pid');

    // 4. Stale dispatch-progress file removed
    assert.equal(existsSync(progressPath), false,
      'Stale dispatch-progress should be deleted');

    // 5. Phase is still implementation (no phase regression)
    const finalState = readState(root);
    assert.equal(finalState.phase, 'implementation',
      'Phase should remain "implementation" after crash recovery');
  });

  it('AT-CRASH-002: re-dispatched dev turn completes and is accepted', async () => {
    const root = makeTmpDir();
    tmpDirs.push(root);
    const { config, state, devTurn } = setupCrashedDevTurn(root);

    const initialSequence = readState(root).turn_sequence;

    // Mock: write valid staged dev turn result on re-dispatch
    dispatchLocalCli.mockImplementation(async (dispatchRoot, dispatchState) => {
      const turn = getActiveTurn(dispatchState);
      writeJson(join(dispatchRoot, getTurnStagingResultPath(turn.turn_id)), makeDevTurnResult(dispatchState));
      return { ok: true, logs: [] };
    });

    await runStep(root);

    const finalState = readState(root);

    // 1. active_turns no longer contains the dev turn (consumed)
    assert.equal(finalState.active_turns[devTurn.turn_id], undefined,
      'Accepted turn should be removed from active_turns');

    // 2. History contains the dev turn with status: 'completed'
    const history = readJsonl(root, HISTORY_PATH);
    const devEntry = history.find((e) => e.turn_id === devTurn.turn_id);
    assert.ok(devEntry, 'Dev turn should be present in history');
    assert.equal(devEntry.status, 'completed', 'History entry should have status "completed"');

    // 3. History entry has correct role
    assert.equal(devEntry.role, 'dev', 'History entry should have role "dev"');

    // 4. turn_sequence incremented
    assert.ok(finalState.turn_sequence > initialSequence,
      'turn_sequence should increment after acceptance');

    // 5. last_completed_turn_id matches
    assert.equal(finalState.last_completed_turn_id, devTurn.turn_id,
      'last_completed_turn_id should match the dev turn');
  });

  it('AT-CRASH-003: no residual stale state after recovery', async () => {
    const root = makeTmpDir();
    tmpDirs.push(root);
    const { config, devTurn } = setupCrashedDevTurn(root);

    // Write a stale staged result from the "crashed" first attempt
    const staleResult = readState(root);
    writeJson(join(root, getTurnStagingResultPath(devTurn.turn_id)), {
      schema_version: '1.0',
      run_id: staleResult.run_id,
      turn_id: devTurn.turn_id,
      role: 'dev',
      status: 'completed',
      summary: 'Stale partial result from crashed attempt.',
    });

    // Mock: re-dispatch overwrites with fresh valid result
    dispatchLocalCli.mockImplementation(async (dispatchRoot, dispatchState) => {
      const turn = getActiveTurn(dispatchState);
      writeJson(join(dispatchRoot, getTurnStagingResultPath(turn.turn_id)), makeDevTurnResult(dispatchState));
      return { ok: true, logs: [] };
    });

    await runStep(root);

    // 1. No dispatch-progress file for the dev turn
    assert.equal(
      existsSync(join(root, getDispatchProgressRelativePath(devTurn.turn_id))),
      false,
      'No dispatch-progress file should remain',
    );

    // 2. state.json has no orphaned active_turns entries
    const finalState = readState(root);
    assert.equal(finalState.active_turns[devTurn.turn_id], undefined,
      'No orphaned active_turns entry for the completed turn');

    // 3. No worker_pid remnants in state for completed turn
    // (turn is gone from active_turns entirely, so no pid possible)
    const activeTurnValues = Object.values(finalState.active_turns);
    for (const t of activeTurnValues) {
      assert.notEqual(t.turn_id, devTurn.turn_id, 'Completed turn should not appear in active_turns');
    }

    // 4. events.jsonl does not contain duplicate turn_accepted events
    const events = readJsonl(root, '.agentxchain/events.jsonl');
    const acceptedEvents = events.filter(
      (e) => e.event_type === 'turn_accepted' && e.turn?.turn_id === devTurn.turn_id,
    );
    assert.ok(acceptedEvents.length <= 1,
      `Expected at most 1 turn_accepted event for the dev turn, got ${acceptedEvents.length}`);
  });

  it('AT-CRASH-004: blocked run with retained dev turn recovers via step --resume', async () => {
    const root = makeTmpDir();
    tmpDirs.push(root);
    const { config, devTurn } = setupCrashedDevTurn(root);

    // Mark the run as blocked with the dev turn retained
    const blocked = markRunBlocked(root, {
      blockedOn: 'dispatch:crash',
      category: 'dispatch_error',
      recovery: {
        typed_reason: 'dispatch_error',
        owner: 'human',
        recovery_action: 'Run step --resume',
        turn_retained: true,
        detail: 'Worker crashed.',
      },
      turnId: devTurn.turn_id,
      notificationConfig: config,
    });
    assert.equal(blocked.ok, true, `markRunBlocked failed: ${blocked.error}`);

    // Verify precondition: run is blocked
    const blockedState = readState(root);
    assert.equal(blockedState.status, 'blocked', 'Precondition: run should be blocked');

    // Mock: write valid staged dev turn result on re-dispatch
    dispatchLocalCli.mockImplementation(async (dispatchRoot, dispatchState) => {
      const turn = getActiveTurn(dispatchState);
      writeJson(join(dispatchRoot, getTurnStagingResultPath(turn.turn_id)), makeDevTurnResult(dispatchState));
      return { ok: true, logs: [] };
    });

    await runStep(root);

    // 1. dispatchLocalCli called once (re-dispatch of retained turn)
    expect(dispatchLocalCli).toHaveBeenCalledTimes(1);

    // 2. Stale dispatch-progress file deleted
    assert.equal(
      existsSync(join(root, getDispatchProgressRelativePath(devTurn.turn_id))),
      false,
      'Stale dispatch-progress should be deleted after recovery',
    );

    // 3. After completion, turn is in history, not in active_turns
    const finalState = readState(root);
    assert.equal(finalState.active_turns[devTurn.turn_id], undefined,
      'Recovered turn should be removed from active_turns');

    const history = readJsonl(root, HISTORY_PATH);
    const devEntry = history.find((e) => e.turn_id === devTurn.turn_id);
    assert.ok(devEntry, 'Recovered turn should be present in history');

    // 4. Run status is active (not blocked)
    assert.equal(finalState.status, 'active',
      'Run should be active after blocked recovery');
  });

  it('AT-CRASH-005: crash with no prior staged result recovers cleanly', async () => {
    const root = makeTmpDir();
    tmpDirs.push(root);
    const { config, devTurn } = setupCrashedDevTurn(root);

    // Ensure there is NO pre-existing staged result (simulates crash before output)
    const stagedPath = join(root, getTurnStagingResultPath(devTurn.turn_id));
    if (existsSync(stagedPath)) {
      rmSync(stagedPath);
    }

    // Mock: write a fresh staged result on re-dispatch
    dispatchLocalCli.mockImplementation(async (dispatchRoot, dispatchState) => {
      const turn = getActiveTurn(dispatchState);
      writeJson(join(dispatchRoot, getTurnStagingResultPath(turn.turn_id)), makeDevTurnResult(dispatchState));
      return { ok: true, logs: [] };
    });

    await runStep(root);

    // 1. PID guard detected dead worker and cleaned up dispatch-progress
    assert.equal(
      existsSync(join(root, getDispatchProgressRelativePath(devTurn.turn_id))),
      false,
      'Dispatch-progress should be cleaned up by PID guard',
    );

    // 2. Re-dispatch succeeded
    expect(dispatchLocalCli).toHaveBeenCalledTimes(1);

    // 3. Fresh staged result written by mock, turn accepted
    const finalState = readState(root);
    assert.equal(finalState.active_turns[devTurn.turn_id], undefined,
      'Turn should be accepted and removed from active_turns');

    // 4. Full lifecycle completed — turn in history
    const history = readJsonl(root, HISTORY_PATH);
    const devEntry = history.find((e) => e.turn_id === devTurn.turn_id);
    assert.ok(devEntry, 'Turn should be present in history after recovery');
    assert.equal(devEntry.status, 'completed', 'History entry status should be "completed"');
    assert.equal(devEntry.role, 'dev', 'History entry role should be "dev"');
    assert.equal(devEntry.phase, 'implementation', 'History entry phase should be "implementation"');
  });
});
