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

function makeTmpDir() {
  return join(tmpdir(), `axc-step-crash-resume-${randomBytes(6).toString('hex')}`);
}

function makeConfig() {
  return {
    schema_version: '1.0',
    protocol_mode: 'governed',
    project: { id: 'test-project', name: 'Test Project', default_branch: 'main' },
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
      planning_signoff: {
        requires_files: ['.planning/PM_SIGNOFF.md', '.planning/ROADMAP.md', '.planning/SYSTEM_SPEC.md'],
        requires_human_approval: true,
        credentialed: false,
      },
      implementation_complete: {
        requires_files: ['.planning/IMPLEMENTATION_NOTES.md'],
        requires_verification_pass: true,
        credentialed: false,
      },
      qa_ship_verdict: {
        requires_files: ['.planning/acceptance-matrix.md', '.planning/ship-verdict.md', '.planning/RELEASE_NOTES.md'],
        requires_human_approval: true,
        requires_verification_pass: true,
        credentialed: false,
      },
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

function makeTurnResult(state) {
  const turn = getActiveTurn(state);
  return {
    schema_version: '1.0',
    run_id: state.run_id,
    turn_id: turn.turn_id,
    role: turn.assigned_role,
    runtime_id: turn.runtime_id,
    status: 'completed',
    summary: 'Mock local CLI completed.',
    decisions: [],
    objections: [
      {
        id: 'OBJ-001',
        severity: 'low',
        statement: 'Test fixture objection for review-only role.',
        status: 'raised',
      },
    ],
    files_changed: [],
    artifacts_created: [],
    verification: { status: 'skipped' },
    artifact: { type: 'review', ref: null },
    proposed_next_role: 'dev',
    phase_transition_request: null,
    run_completion_request: null,
    needs_human_reason: null,
    cost: { input_tokens: 0, output_tokens: 0, usd: 0 },
  };
}

function writeStagedTurnResult(root, state) {
  const turn = getActiveTurn(state);
  writeJson(join(root, getTurnStagingResultPath(turn.turn_id)), makeTurnResult(state));
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

function setupProject(root) {
  const config = makeConfig();
  scaffoldGoverned(root, 'Test Project', 'test-project');
  writeJson(join(root, 'agentxchain.json'), config);
  const initialized = initializeGovernedRun(root, config);
  assert.equal(initialized.ok, true, initialized.error);
  const assigned = assignGovernedTurn(root, config, 'pm');
  assert.equal(assigned.ok, true, assigned.error);
  return { config, state: assigned.state, turn: getActiveTurn(assigned.state) };
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

async function runStep(root, opts = {}) {
  const previousCwd = process.cwd();
  process.chdir(root);
  try {
    await stepCommand({ resume: true, poll: '1', ...opts });
  } finally {
    process.chdir(previousCwd);
  }
}

async function captureExit(fn) {
  const originalExit = process.exit;
  const originalLog = console.log;
  const output = [];
  let exitCode = null;
  process.exit = (code = 0) => {
    exitCode = code;
    throw new Error(`process.exit:${code}`);
  };
  console.log = (...args) => {
    output.push(args.join(' '));
  };
  try {
    await fn();
    return { exited: false, exitCode, output: output.join('\n') };
  } catch (err) {
    if (String(err?.message || '').startsWith('process.exit:')) {
      return { exited: true, exitCode, output: output.join('\n') };
    }
    throw err;
  } finally {
    process.exit = originalExit;
    console.log = originalLog;
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

describe('step --resume crash recovery', () => {
  it('re-dispatches an active running turn with a dead worker pid and removes stale dispatch-progress', async () => {
    const root = makeTmpDir();
    tmpDirs.push(root);
    const { state, turn } = setupProject(root);
    const runningState = setRunningTurn(root, turn.turn_id, DEAD_PID);
    writeDispatchProgress(root, turn.turn_id, DEAD_PID);
    writeStagedTurnResult(root, runningState);

    const progressPath = join(root, getDispatchProgressRelativePath(turn.turn_id));
    assert.equal(existsSync(progressPath), true);

    await runStep(root);

    assert.equal(existsSync(progressPath), false);
    expect(dispatchLocalCli).toHaveBeenCalledTimes(1);
    const dispatchedState = dispatchLocalCli.mock.calls[0][1];
    assert.equal(dispatchedState.active_turns[turn.turn_id].status, 'dispatched');
    assert.equal(dispatchedState.active_turns[turn.turn_id].worker_pid, undefined);
  });

  it('rejects active running turn resume when the previous worker pid is still alive', async () => {
    const root = makeTmpDir();
    tmpDirs.push(root);
    const { turn } = setupProject(root);
    setRunningTurn(root, turn.turn_id, process.pid);
    writeDispatchProgress(root, turn.turn_id, process.pid);

    const result = await captureExit(() => runStep(root));

    assert.equal(result.exited, true);
    assert.equal(result.exitCode, 1);
    assert.match(result.output, /Worker process \(PID \d+\) is still alive/);
    expect(dispatchLocalCli).not.toHaveBeenCalled();
    assert.equal(readState(root).active_turns[turn.turn_id].status, 'running');
    assert.equal(existsSync(join(root, getDispatchProgressRelativePath(turn.turn_id))), true);
  });

  it('keeps no-pid active running turn resume backwards compatible', async () => {
    const root = makeTmpDir();
    tmpDirs.push(root);
    const { turn } = setupProject(root);
    const runningState = setRunningTurn(root, turn.turn_id, null);
    writeStagedTurnResult(root, runningState);

    await runStep(root);

    expect(dispatchLocalCli).toHaveBeenCalledTimes(1);
    assert.equal(readState(root).active_turns[turn.turn_id], undefined);
  });

  it('re-dispatches a blocked retained turn with a dead worker pid and removes stale dispatch-progress', async () => {
    const root = makeTmpDir();
    tmpDirs.push(root);
    const { config, turn } = setupProject(root);
    const runningState = setRunningTurn(root, turn.turn_id, DEAD_PID);
    writeDispatchProgress(root, turn.turn_id, DEAD_PID);
    const blocked = markRunBlocked(root, {
      blockedOn: 'dispatch:timeout',
      category: 'dispatch_error',
      recovery: {
        typed_reason: 'dispatch_error',
        owner: 'human',
        recovery_action: 'Resolve the dispatch issue, then run agentxchain step --resume',
        turn_retained: true,
        detail: 'Test retained turn block.',
      },
      turnId: turn.turn_id,
      notificationConfig: config,
    });
    assert.equal(blocked.ok, true, blocked.error);
    writeStagedTurnResult(root, runningState);

    const progressPath = join(root, getDispatchProgressRelativePath(turn.turn_id));
    await runStep(root);

    assert.equal(existsSync(progressPath), false);
    expect(dispatchLocalCli).toHaveBeenCalledTimes(1);
    assert.equal(readState(root).status, 'active');
  });
});
