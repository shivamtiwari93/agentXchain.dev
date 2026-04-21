/**
 * BUG-51 beta-tester scenario: fast-startup watchdog catches fake-running
 * turns within an explicit tight startup window instead of leaving them "running" for the
 * slower stale-turn watchdog.
 */

import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  assignGovernedTurn,
  initializeGovernedRun,
  markRunBlocked,
  reissueTurn,
  transitionActiveTurnLifecycle,
} from '../../src/lib/governed-state.js';
import { createDispatchProgressTracker, getDispatchProgressRelativePath } from '../../src/lib/dispatch-progress.js';
import { detectGhostTurns, failTurnStartup, reconcileStaleTurns } from '../../src/lib/stale-turn-watchdog.js';
import { buildScheduleExecutionResult } from '../../src/commands/schedule.js';
import { getTurnStagingResultPath } from '../../src/lib/turn-paths.js';

const ROOT = join(import.meta.dirname, '..', '..');
const CLI_PATH = join(ROOT, 'bin', 'agentxchain.js');
const tempDirs = [];

function makeConfig(overrides = {}) {
  return {
    schema_version: '1.0',
    protocol_mode: 'governed',
    template: 'generic',
    project: { id: 'bug51-test', name: 'BUG-51 Test', default_branch: 'main' },
    roles: {
      dev: {
        title: 'Developer',
        mandate: 'Implement the requested change.',
        write_authority: 'authoritative',
        runtime: 'local-dev',
      },
    },
    runtimes: {
      'local-dev': { type: 'local_cli', command: 'node', args: ['-e', 'console.log("ok")'] },
    },
    routing: {
      implementation: {
        entry_role: 'dev',
        allowed_next_roles: ['dev'],
        exit_gate: 'implementation_signoff',
      },
    },
    gates: { implementation_signoff: {} },
    budget: { per_turn_max_usd: 2.0, per_run_max_usd: 10.0 },
    run_loop: { startup_watchdog_ms: 1_000 },
    ...overrides,
  };
}

function createProject(configOverrides = {}, options = {}) {
  const root = mkdtempSync(join(tmpdir(), 'axc-bug51-'));
  tempDirs.push(root);
  mkdirSync(join(root, '.agentxchain'), { recursive: true });
  writeFileSync(join(root, 'README.md'), '# BUG-51\n');
  const config = makeConfig(configOverrides);
  writeFileSync(join(root, 'agentxchain.json'), JSON.stringify(config, null, 2));
  execSync('git init -b main', { cwd: root, stdio: 'ignore' });
  execSync('git config user.email "test@test.com"', { cwd: root, stdio: 'ignore' });
  execSync('git config user.name "Test"', { cwd: root, stdio: 'ignore' });
  execSync('git add -A && git commit -m "init"', { cwd: root, stdio: 'ignore' });
  if (options.initializeRun !== false) {
    const init = initializeGovernedRun(root, config);
    assert.ok(init.ok, init.error);
  }
  return { root, config };
}

function configureLocalCliRuntime(root, config, { scriptName, source, vision = null } = {}) {
  const scriptPath = join(root, scriptName);
  writeFileSync(scriptPath, source);
  if (vision) {
    mkdirSync(join(root, '.planning'), { recursive: true });
    writeFileSync(join(root, '.planning', 'VISION.md'), vision);
  }
  config.runtimes['local-dev'] = {
    type: 'local_cli',
    command: 'node',
    args: [scriptPath],
  };
  writeFileSync(join(root, 'agentxchain.json'), JSON.stringify(config, null, 2));
  const files = ['agentxchain.json', scriptName];
  if (vision) {
    files.push('.planning/VISION.md');
  }
  execSync(`git add ${files.join(' ')} && git commit -m "configure silent local cli runtime"`, {
    cwd: root,
    stdio: 'ignore',
  });
}

function configureSilentLocalCliRuntime(root, config, { scriptName = 'silent-sleeper.js', source, vision = null } = {}) {
  configureLocalCliRuntime(root, config, { scriptName, source, vision });
}

function makeValidTurnResultScriptSource({
  outputDelayMs = 0,
  stageDelayMs = 150,
  emitOutput = true,
  exitCode = 0,
} = {}) {
  return `
const fs = require('fs');
const path = require('path');

const root = process.cwd();
const statePath = path.join(root, '.agentxchain', 'state.json');
const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
const turnId = process.env.AGENTXCHAIN_TURN_ID;
const turn = state.active_turns[turnId];
if (!turn) {
  throw new Error('Missing active turn for ' + turnId);
}

const result = {
  schema_version: '1.0',
  run_id: state.run_id,
  turn_id: turn.turn_id,
  role: turn.assigned_role,
  runtime_id: turn.runtime_id,
  status: 'completed',
  summary: 'BUG-51 lifecycle fixture completed cleanly.',
  decisions: [],
  objections: [],
  files_changed: [],
  artifacts_created: [],
  verification: {
    status: 'pass',
    commands: ['node -e "process.exit(0)"'],
    evidence_summary: 'Fixture wrote a governed staged result.',
  },
  artifact: { type: 'review', ref: 'no_repo_changes' },
  proposed_next_role: 'dev',
  phase_transition_request: null,
  needs_human_reason: null,
  cost: { input_tokens: 1, output_tokens: 1, usd: 0 },
};

if (${emitOutput ? 'true' : 'false'}) {
  setTimeout(() => {
    console.log('fixture output before staged result');
  }, ${outputDelayMs});
}

setTimeout(() => {
  const stagingDir = path.join(root, '.agentxchain', 'staging', turn.turn_id);
  fs.mkdirSync(stagingDir, { recursive: true });
  fs.writeFileSync(
    path.join(stagingDir, 'turn-result.json'),
    JSON.stringify(result, null, 2),
  );
  process.exit(${exitCode});
}, ${stageDelayMs});
`;
}

function readState(root) {
  return JSON.parse(readFileSync(join(root, '.agentxchain', 'state.json'), 'utf8'));
}

function writeState(root, state) {
  writeFileSync(join(root, '.agentxchain', 'state.json'), JSON.stringify(state, null, 2));
}

function readEvents(root) {
  return readFileSync(join(root, '.agentxchain', 'events.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function resetGovernedStateToIdle(root) {
  const state = readState(root);
  writeState(root, {
    ...state,
    run_id: null,
    status: 'idle',
    active_turns: {},
    turn_sequence: 0,
    last_completed_turn_id: null,
    blocked_on: null,
    blocked_reason: null,
    escalation: null,
    pending_phase_transition: null,
    pending_run_completion: null,
    queued_phase_transition: null,
    queued_run_completion: null,
    last_gate_failure: null,
    phase_gate_status: {},
    budget_reservations: {},
    accepted_integration_ref: null,
    delegation_queue: [],
  });
}

/**
 * Run a fixture setup function with stderr suppressed.
 *
 * `markRunBlocked()` is real product code that emits a HUMAN ESCALATION RAISED
 * notice on stderr — operators rely on that notice. When the notice fires from
 * fixture setup inside the test process, it leaks into TAP output as `# ...`
 * comment lines and masks real failure signal in noisy CI logs (Turn 76 next
 * action #2). We do not want to gate the product behavior behind a global env
 * flag just for tests, so this helper temporarily replaces stderr.write only
 * for the duration of the seed call.
 */
function withSuppressedStderr(fn) {
  const original = process.stderr.write.bind(process.stderr);
  process.stderr.write = () => true;
  try {
    return fn();
  } finally {
    process.stderr.write = original;
  }
}

function backdateTurnField(root, turnId, field, secondsAgo) {
  const state = readState(root);
  state.active_turns[turnId][field] = new Date(Date.now() - secondsAgo * 1000).toISOString();
  writeState(root, state);
  return state;
}

function seedDispatchedTurn(root, config, secondsAgo = 45) {
  const assigned = assignGovernedTurn(root, config, 'dev');
  assert.ok(assigned.ok, assigned.error);
  const turnId = assigned.turn.turn_id;
  const dispatchedAt = new Date(Date.now() - secondsAgo * 1000).toISOString();
  const dispatched = transitionActiveTurnLifecycle(root, turnId, 'dispatched', { at: dispatchedAt });
  assert.ok(dispatched.ok, dispatched.error);
  return { turnId, state: readState(root) };
}

function seedStartingTurn(root, config, secondsAgo = 45, withFirstOutput = false) {
  const { turnId } = seedDispatchedTurn(root, config, secondsAgo);
  const startedAt = new Date(Date.now() - secondsAgo * 1000).toISOString();
  const starting = transitionActiveTurnLifecycle(root, turnId, 'starting', { at: startedAt, pid: 12345 });
  assert.ok(starting.ok, starting.error);
  const tracker = createDispatchProgressTracker(root, readState(root).active_turns[turnId], {
    adapter_type: 'local_cli',
    writeIntervalMs: 0,
    silenceThresholdMs: 60_000,
    pid: 12345,
  });
  tracker.start();
  const progressPath = join(root, getDispatchProgressRelativePath(turnId));
  const progress = JSON.parse(readFileSync(progressPath, 'utf8'));
  progress.started_at = startedAt;
  progress.last_activity_at = startedAt;
  if (withFirstOutput) {
    progress.first_output_at = startedAt;
    progress.output_lines = 1;
    progress.activity_type = 'output';
    progress.activity_summary = 'Producing output (1 lines)';
  } else {
    progress.first_output_at = null;
    progress.output_lines = 0;
    progress.stderr_lines = 0;
    progress.activity_type = 'starting';
    progress.activity_summary = 'Waiting for first output';
  }
  writeFileSync(progressPath, JSON.stringify(progress, null, 2) + '\n');
  tracker.dispose();
  return { turnId, state: readState(root) };
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

describe('BUG-51: fast-startup watchdog', () => {
  it('detects a dispatched turn that never spawned a worker', () => {
    const { root, config } = createProject();
    const { turnId, state } = seedDispatchedTurn(root, config, 45);

    const ghosts = detectGhostTurns(root, state, config);
    assert.equal(ghosts.length, 1);
    assert.equal(ghosts[0].turn_id, turnId);
    assert.equal(ghosts[0].failure_type, 'runtime_spawn_failed');
  });

  it('detects a starting turn with attached progress but no first output', () => {
    const { root, config } = createProject();
    const { turnId, state } = seedStartingTurn(root, config, 45, false);

    const ghosts = detectGhostTurns(root, state, config);
    assert.equal(ghosts.length, 1);
    assert.equal(ghosts[0].turn_id, turnId);
    assert.equal(ghosts[0].failure_type, 'stdout_attach_failed');
  });

  it('does not flag a starting turn once first output exists', () => {
    const { root, config } = createProject();
    const { state } = seedStartingTurn(root, config, 45, true);

    const ghosts = detectGhostTurns(root, state, config);
    assert.equal(ghosts.length, 0);
  });

  it('BUG-54 Turn 89: stderr-only progress is not startup proof (stdout_attach_failed still fires)', () => {
    // DEC-BUG54-STDERR-IS-NOT-STARTUP-PROOF-002 (Turn 88) extended to the
    // fast-startup watchdog. A starting turn whose progress file records
    // only stderr activity (stderr_lines > 0, output_lines == 0,
    // first_output_at == null) must still be caught as a ghost —
    // otherwise a subprocess that spawns but only emits stderr would
    // silently survive the startup window and wait out the full stale-turn
    // budget instead of failing fast.
    const { root, config } = createProject();
    const { turnId, state } = seedStartingTurn(root, config, 45, false);

    // Swap the clean dispatch-progress for one with stderr-only activity.
    const progressPath = join(root, getDispatchProgressRelativePath(turnId));
    const progress = JSON.parse(readFileSync(progressPath, 'utf8'));
    progress.stderr_lines = 7;
    progress.output_lines = 0;
    progress.first_output_at = null;
    progress.activity_type = 'output';
    progress.activity_summary = 'Producing output (0 lines)';
    writeFileSync(progressPath, JSON.stringify(progress, null, 2) + '\n');

    const ghosts = detectGhostTurns(root, state, config);
    assert.equal(ghosts.length, 1, 'stderr-only activity must not satisfy startup proof');
    assert.equal(ghosts[0].turn_id, turnId);
    assert.equal(
      ghosts[0].failure_type,
      'stdout_attach_failed',
      'stderr-only startup is the stdout_attach_failed family per operator contract',
    );
  });

  it('BUG-54 Turn 89: turn.first_output_stream === "stderr" is not startup proof', () => {
    // Defensive regression: a persisted turn.first_output_at with
    // first_output_stream === 'stderr' (e.g., stale state from a pre-fix
    // process, or a future regression that re-introduces stderr as
    // lifecycle proof) must not bypass the fast-startup watchdog.
    const { root, config } = createProject();
    const { turnId } = seedStartingTurn(root, config, 45, false);

    const state = readState(root);
    const startedAt = state.active_turns[turnId].started_at;
    state.active_turns[turnId].first_output_at = startedAt;
    state.active_turns[turnId].first_output_stream = 'stderr';
    writeState(root, state);

    const ghosts = detectGhostTurns(root, state, config);
    assert.equal(ghosts.length, 1, 'stderr-flagged first_output_at must not satisfy startup proof');
    assert.equal(ghosts[0].turn_id, turnId);
    assert.equal(ghosts[0].failure_type, 'stdout_attach_failed');
  });

  it('BUG-54 Turn 90: unknown first_output_stream tags are not startup proof', () => {
    const { root, config } = createProject();
    const { turnId } = seedStartingTurn(root, config, 45, false);

    const state = readState(root);
    const startedAt = state.active_turns[turnId].started_at;
    state.active_turns[turnId].first_output_at = startedAt;
    state.active_turns[turnId].first_output_stream = 'mcp';
    writeState(root, state);

    const ghosts = detectGhostTurns(root, state, config);
    assert.equal(ghosts.length, 1, 'unknown first_output_stream tags must not satisfy startup proof');
    assert.equal(ghosts[0].turn_id, turnId);
    assert.equal(ghosts[0].failure_type, 'stdout_attach_failed');
  });

  it('reconciles ghost turns to failed_start and releases budget reservations', () => {
    const { root, config } = createProject();
    const { turnId } = seedStartingTurn(root, config, 45, false);
    const state = readState(root);
    state.budget_reservations = {
      [turnId]: { reserved_usd: 2.0, role_id: 'dev', created_at: state.active_turns[turnId].assigned_at },
    };
    writeState(root, state);

    const reconciled = reconcileStaleTurns(root, state, config);
    assert.ok(reconciled.changed);
    assert.equal(reconciled.state.active_turns[turnId].status, 'failed_start');
    assert.equal(reconciled.state.budget_reservations[turnId], undefined);
    assert.equal(reconciled.state.blocked_reason.category, 'ghost_turn');

    const events = readFileSync(join(root, '.agentxchain', 'events.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    assert.ok(events.some((entry) => entry.event_type === 'turn_start_failed'));
    assert.ok(events.some((entry) => entry.event_type === 'stdout_attach_failed'));
  });

  it('emits runtime_spawn_failed as a first-class event for dispatched ghost turns', () => {
    const { root, config } = createProject();
    const { state } = seedDispatchedTurn(root, config, 45);

    const reconciled = reconcileStaleTurns(root, state, config);
    assert.equal(reconciled.ghost_turns.length, 1);
    assert.equal(reconciled.ghost_turns[0].failure_type, 'runtime_spawn_failed');

    const events = readFileSync(join(root, '.agentxchain', 'events.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    assert.ok(events.some((entry) => entry.event_type === 'turn_start_failed'));
    assert.ok(events.some((entry) => entry.event_type === 'runtime_spawn_failed'));
  });

  it('status --json surfaces ghost turns and failed_start', () => {
    const { root, config } = createProject();
    const { turnId } = seedStartingTurn(root, config, 45, false);

    const output = execSync(`node "${CLI_PATH}" status --json`, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const parsed = JSON.parse(output);
    assert.equal(parsed.state.active_turns[turnId].status, 'failed_start');
    assert.equal(parsed.ghost_turns.length, 1);
    assert.equal(parsed.ghost_turns[0].turn_id, turnId);
  });

  it('status --json ignores placeholder staged result files when reconciling ghost turns', () => {
    const { root, config } = createProject();
    const { turnId } = seedStartingTurn(root, config, 45, false);
    const stagedResultPath = join(root, getTurnStagingResultPath(turnId));
    mkdirSync(dirname(stagedResultPath), { recursive: true });
    writeFileSync(stagedResultPath, '{}');

    const output = execSync(`node "${CLI_PATH}" status --json`, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const parsed = JSON.parse(output);
    assert.equal(parsed.state.active_turns[turnId].status, 'failed_start');
    assert.equal(parsed.ghost_turns.length, 1);
    assert.equal(parsed.ghost_turns[0].turn_id, turnId);
  });

  it('status text renders the recovery command for a persisted failed_start turn', () => {
    const { root, config } = createProject();
    const { turnId } = seedStartingTurn(root, config, 45, false);

    // First invocation reconciles ghost → failed_start and emits the warning block.
    execSync(`node "${CLI_PATH}" status`, { cwd: root, encoding: 'utf8' });

    // Second invocation: ghost detection finds nothing (already reconciled); the
    // recovery command must still be visible in the turn display, not vanish.
    const secondOutput = execSync(`node "${CLI_PATH}" status`, {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
    });
    assert.match(secondOutput, /failed_start/);
    assert.match(secondOutput, new RegExp(`agentxchain reissue-turn --turn ${turnId} --reason ghost`));
  });

  it('step fails fast when the subprocess exits without output', () => {
    const { root, config } = createProject({
      run_loop: { startup_watchdog_ms: 800 },
    });
    const silentExitPath = join(root, 'silent-exit.js');
    writeFileSync(silentExitPath, 'process.exit(0);');
    config.runtimes['local-dev'] = {
      type: 'local_cli',
      command: 'node',
      args: [silentExitPath],
    };
    writeFileSync(join(root, 'agentxchain.json'), JSON.stringify(config, null, 2));
    execSync('git add agentxchain.json silent-exit.js && git commit -m "configure silent exit runtime"', { cwd: root, stdio: 'ignore' });

    const result = spawnSync('node', [CLI_PATH, 'step'], {
      cwd: root,
      encoding: 'utf8',
      timeout: 10_000,
    });
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout + result.stderr, /startup failed/i);

    const state = readState(root);
    const turnId = Object.keys(state.active_turns)[0];
    assert.equal(state.active_turns[turnId].status, 'failed_start');
    assert.equal(state.budget_reservations[turnId], undefined);

    const events = readEvents(root);
    assert.ok(events.some((entry) => entry.event_type === 'turn_start_failed'));
  });

  it('step marks a non-spawning runtime as failed_start/runtime_spawn_failed', () => {
    const { root, config } = createProject({
      run_loop: { startup_watchdog_ms: 800 },
    });
    config.runtimes['local-dev'] = {
      type: 'local_cli',
      command: 'nonexistent_binary_bug51_12345',
      args: [],
    };
    writeFileSync(join(root, 'agentxchain.json'), JSON.stringify(config, null, 2));
    execSync('git add agentxchain.json && git commit -m "configure missing runtime binary"', { cwd: root, stdio: 'ignore' });

    const result = spawnSync('node', [CLI_PATH, 'step'], {
      cwd: root,
      encoding: 'utf8',
      timeout: 10_000,
    });
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout + result.stderr, /startup failed|failed to spawn/i);

    const state = readState(root);
    const turnId = Object.keys(state.active_turns)[0];
    assert.equal(state.active_turns[turnId].status, 'failed_start');
    assert.equal(state.active_turns[turnId].failed_start_reason, 'runtime_spawn_failed');
    assert.equal(state.active_turns[turnId].worker_attached_at, undefined,
      'non-spawning runtime must stay un-attached; BUG-51 lifecycle cannot stamp worker_attached_at before spawn succeeds');
    assert.equal(state.active_turns[turnId].worker_pid, undefined,
      'non-spawning runtime must not leave a fake worker_pid in state');
    assert.equal(state.budget_reservations[turnId], undefined);

    const events = readEvents(root);
    assert.ok(events.some((entry) => entry.event_type === 'turn_start_failed'));
    assert.ok(events.some((entry) => entry.event_type === 'runtime_spawn_failed'));
  });

  it('step kills a silent subprocess within the startup watchdog window', () => {
    const { root, config } = createProject({
      run_loop: { startup_watchdog_ms: 600 },
    });
    const sleeperPath = join(root, 'silent-sleeper.js');
    writeFileSync(sleeperPath, 'setTimeout(() => {}, 60_000);');
    config.runtimes['local-dev'] = {
      type: 'local_cli',
      command: 'node',
      args: [sleeperPath],
    };
    writeFileSync(join(root, 'agentxchain.json'), JSON.stringify(config, null, 2));
    execSync('git add agentxchain.json silent-sleeper.js && git commit -m "configure silent sleeper runtime"', { cwd: root, stdio: 'ignore' });

    const startedAt = Date.now();
    const result = spawnSync('node', [CLI_PATH, 'step'], {
      cwd: root,
      encoding: 'utf8',
      timeout: 10_000,
    });
    const elapsedMs = Date.now() - startedAt;

    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.ok(elapsedMs < 5_000, `startup watchdog should stop the turn quickly, got ${elapsedMs}ms`);
    assert.match(result.stdout + result.stderr, /startup failed/i);

    const state = readState(root);
    const turnId = Object.keys(state.active_turns)[0];
    assert.equal(state.active_turns[turnId].status, 'failed_start');
    assert.equal(state.active_turns[turnId].failed_start_reason, 'stdout_attach_failed');
  });

  it('step allows a slow-start subprocess when first output lands before the watchdog threshold', () => {
    const { root, config } = createProject({
      routing: {
        implementation: {
          entry_role: 'dev',
          allowed_next_roles: ['dev'],
        },
      },
      gates: {},
      run_loop: { startup_watchdog_ms: 1_200 },
    });
    configureLocalCliRuntime(root, config, {
      scriptName: 'slow-start-success.js',
      source: makeValidTurnResultScriptSource({
        outputDelayMs: 250,
        stageDelayMs: 450,
        emitOutput: true,
      }),
    });

    const result = spawnSync('node', [CLI_PATH, 'step'], {
      cwd: root,
      encoding: 'utf8',
      timeout: 15_000,
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout + result.stderr, /accepted|staged result detected/i);

    const state = readState(root);
    assert.notEqual(state.status, 'blocked');
    const events = readEvents(root);
    assert.ok(!events.some((entry) => entry.event_type === 'turn_start_failed'));
    assert.ok(!events.some((entry) => entry.event_type === 'stdout_attach_failed'));
    assert.ok(events.some((entry) => entry.event_type === 'turn_accepted'));
  });

  it('step accepts a healthy local_cli subprocess with immediate output and staged result', () => {
    const { root, config } = createProject({
      routing: {
        implementation: {
          entry_role: 'dev',
          allowed_next_roles: ['dev'],
        },
      },
      gates: {},
      run_loop: { startup_watchdog_ms: 1_200 },
    });
    configureLocalCliRuntime(root, config, {
      scriptName: 'healthy-success.js',
      source: makeValidTurnResultScriptSource({
        outputDelayMs: 0,
        stageDelayMs: 100,
        emitOutput: true,
      }),
    });

    const result = spawnSync('node', [CLI_PATH, 'step'], {
      cwd: root,
      encoding: 'utf8',
      timeout: 15_000,
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);

    const state = readState(root);
    assert.notEqual(state.status, 'blocked');
    const events = readEvents(root);
    assert.ok(events.some((entry) => entry.event_type === 'turn_accepted'));
    assert.ok(!events.some((entry) => entry.event_type === 'turn_start_failed'));
  });

  it('run blocks fast on a silent local_cli ghost turn and retains failed_start recovery', () => {
    const { root, config } = createProject({
      run_loop: { startup_watchdog_ms: 500 },
    }, { initializeRun: false });
    configureSilentLocalCliRuntime(root, config, {
      source: 'setTimeout(() => {}, 60_000);',
    });

    const startedAt = Date.now();
    const result = spawnSync('node', [CLI_PATH, 'run', '--role', 'dev', '--auto-approve', '--max-turns', '1'], {
      cwd: root,
      encoding: 'utf8',
      timeout: 12_000,
    });
    const elapsedMs = Date.now() - startedAt;

    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.ok(elapsedMs < 5_000, `run should fail fast on a ghost turn, got ${elapsedMs}ms`);

    const state = readState(root);
    const turnId = Object.keys(state.active_turns)[0];
    assert.equal(state.status, 'blocked');
    assert.equal(state.blocked_reason.category, 'ghost_turn');
    assert.equal(state.active_turns[turnId].status, 'failed_start');
    assert.match(
      state.blocked_reason.recovery.recovery_action,
      new RegExp(`agentxchain reissue-turn --turn ${turnId} --reason ghost`),
    );

    const events = readEvents(root);
    assert.ok(events.some((entry) => entry.event_type === 'turn_start_failed'));
  });

  it('reissueTurn releases the old turn budget reservation and reserves for the new turn', () => {
    // BUG-51 fix #6 (reissue surface): the tester's exact gripe — "Budget
    // reservation ($2.00) for the stale turn lingered after reissue." The
    // watchdog paths (reconcileStaleTurns / failTurnStartup) already release
    // on stalled/failed_start, but `reissueTurn` itself never touched
    // budget_reservations, so any reissue invoked before the watchdog fires
    // (drift recovery, runtime change, operator-initiated) leaked the old
    // reservation AND left the new turn with no budget tracking.
    const { root, config } = createProject();
    const assigned = assignGovernedTurn(root, config, 'dev');
    assert.ok(assigned.ok, assigned.error);
    const oldTurnId = assigned.turn.turn_id;

    const before = readState(root);
    assert.ok(before.budget_reservations[oldTurnId], 'precondition: old turn must have a reservation');
    assert.equal(before.budget_reservations[oldTurnId].reserved_usd, 2.0);

    const reissued = reissueTurn(root, config, { turnId: oldTurnId, reason: 'operator-initiated reissue' });
    assert.ok(reissued.ok, reissued.error);
    const newTurnId = reissued.newTurn.turn_id;

    const after = readState(root);
    assert.equal(after.budget_reservations[oldTurnId], undefined, 'old reservation must be released');
    assert.ok(after.budget_reservations[newTurnId], 'new turn must have a fresh reservation');
    assert.equal(after.budget_reservations[newTurnId].reserved_usd, 2.0);
    assert.equal(after.budget_reservations[newTurnId].role_id, 'dev');
    assert.equal(after.budget_reservations[newTurnId].reissued_from, oldTurnId);
  });

  it('reissueTurn does not invent a reservation when budget.per_turn_max_usd is unset', () => {
    // Defensive: if the project has no per_turn budget configured, reissue
    // must not magic up a reservation (mirrors assignGovernedTurn behavior).
    const { root, config } = createProject({ budget: { per_run_max_usd: 10.0 } });
    const assigned = assignGovernedTurn(root, config, 'dev');
    assert.ok(assigned.ok, assigned.error);
    const oldTurnId = assigned.turn.turn_id;

    const before = readState(root);
    assert.equal(before.budget_reservations[oldTurnId], undefined, 'no per-turn budget → no reservation at assign time');

    const reissued = reissueTurn(root, config, { turnId: oldTurnId, reason: 'drift' });
    assert.ok(reissued.ok, reissued.error);
    const newTurnId = reissued.newTurn.turn_id;

    const after = readState(root);
    assert.equal(after.budget_reservations[oldTurnId], undefined);
    assert.equal(after.budget_reservations[newTurnId], undefined, 'no per-turn budget → no reservation on reissued turn either');
  });

  it('schedule execution result surfaces the ghost-turn recovery action instead of generic unblock', () => {
    // Synthetic execution shaped like a blocked governed run whose ghost turn
    // was caught by the BUG-51 watchdog. The schedule surface must propagate
    // state.blocked_reason.recovery.recovery_action so operators see the real
    // recovery command (reissue-turn --reason ghost), not a generic unblock.
    const ghostRecovery = 'agentxchain reissue-turn --turn turn_fake --reason ghost';
    const execution = {
      exitCode: 0,
      result: {
        stop_reason: 'blocked',
        state: {
          run_id: 'run_abc',
          status: 'blocked',
          blocked_reason: {
            category: 'ghost_turn',
            recovery: { recovery_action: ghostRecovery },
          },
        },
      },
    };

    const result = buildScheduleExecutionResult('sched-1', execution, null, 'blocked');
    assert.equal(result.action, 'blocked');
    assert.equal(result.stop_reason, 'blocked');
    assert.equal(result.recovery_action, ghostRecovery);
    assert.equal(result.blocked_category, 'ghost_turn');
  });

  it('schedule execution result keeps recovery_action null when state has no blocker', () => {
    // Non-blocked executions must not invent a recovery_action. Fallback to
    // generic unblock copy still applies only when recovery_action is null.
    const execution = {
      exitCode: 0,
      result: {
        stop_reason: null,
        state: {
          run_id: 'run_ok',
          status: 'completed',
          blocked_reason: null,
        },
      },
    };

    const result = buildScheduleExecutionResult('sched-2', execution, null, 'ran');
    assert.equal(result.recovery_action, null);
    assert.equal(result.blocked_category, null);
  });

  it('schedule run-due --json surfaces ghost-turn recovery from the live blocked state', () => {
    const { root, config } = createProject({
      run_loop: { startup_watchdog_ms: 400 },
      schedules: {
        nightly: {
          every_minutes: 1,
          auto_approve: true,
          max_turns: 1,
          initial_role: 'dev',
        },
      },
    }, { initializeRun: false });
    configureSilentLocalCliRuntime(root, config, {
      source: 'setTimeout(() => {}, 60_000);',
    });

    const result = spawnSync('node', [CLI_PATH, 'schedule', 'run-due', '--json'], {
      cwd: root,
      encoding: 'utf8',
      timeout: 10_000,
    });

    assert.equal(result.status, 1, result.stdout + result.stderr);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.ok, false);
    assert.equal(parsed.results.length, 1);
    assert.equal(parsed.results[0].id, 'nightly');
    assert.equal(parsed.results[0].action, 'blocked');
    assert.equal(parsed.results[0].stop_reason, 'blocked');
    assert.equal(parsed.results[0].blocked_category, 'ghost_turn');
    assert.match(parsed.results[0].recovery_action, /agentxchain reissue-turn --turn .* --reason ghost/);
    assert.doesNotMatch(parsed.results[0].recovery_action, /agentxchain unblock <id>/);

    const state = readState(root);
    assert.equal(state.status, 'blocked');
    assert.equal(state.blocked_reason.category, 'ghost_turn');
  });

  it('schedule daemon --json keeps ghost-turn recovery and category for continuous sessions', () => {
    const { root, config } = createProject({
      run_loop: { startup_watchdog_ms: 400 },
      schedules: {
        vision_autopilot: {
          every_minutes: 1,
          auto_approve: true,
          max_turns: 1,
          initial_role: 'dev',
          continuous: {
            enabled: true,
            vision_path: '.planning/VISION.md',
            max_runs: 5,
            max_idle_cycles: 2,
            triage_approval: 'auto',
          },
        },
      },
    });
    configureSilentLocalCliRuntime(root, config, {
      source: 'setTimeout(() => {}, 60_000);',
      vision: '# Vision\n\n## Goals\n- build the first feature\n',
    });
    resetGovernedStateToIdle(root);

    const result = spawnSync('node', [CLI_PATH, 'schedule', 'daemon', '--json', '--max-cycles', '1', '--poll-seconds', '1'], {
      cwd: root,
      encoding: 'utf8',
      timeout: 10_000,
    });

    assert.equal(result.status, 0, result.stdout + result.stderr);
    const parsed = JSON.parse(result.stdout.trim());
    assert.equal(parsed.ok, true);
    assert.equal(parsed.results.length, 1);
    assert.equal(parsed.results[0].id, 'vision_autopilot');
    assert.equal(parsed.results[0].continuous, true);
    assert.equal(parsed.results[0].action, 'run_blocked');
    assert.equal(parsed.results[0].status, 'blocked');
    assert.equal(parsed.results[0].blocked_category, 'ghost_turn');
    assert.match(parsed.results[0].recovery_action, /agentxchain reissue-turn --turn .* --reason ghost/);
    assert.doesNotMatch(parsed.results[0].recovery_action, /agentxchain unblock <id>/);

    const state = readState(root);
    assert.equal(state.status, 'blocked');
    assert.equal(state.blocked_reason.category, 'ghost_turn');
  });

  // BUG-51 follow-up tests (Turn 23): every recovery surface that re-writes a
  // dispatch bundle for an active turn must (a) finalize MANIFEST.json so
  // adapter-side `verifyDispatchManifestForAdapter` enforcement matches fresh
  // dispatches and (b) where applicable, transition the turn lifecycle to
  // `dispatched` so the startup watchdog (`detectGhostTurns`) treats the
  // re-dispatched turn as freshly dispatched. Pre-fix, `resume`'s
  // retained-turn re-dispatch branch (state.status === 'blocked' &&
  // activeCount > 0 in resume.js) skipped both, and
  // `reissue-turn` / `restart` / `reject-turn` skipped manifest finalize.
  //
  // Note: resume.js also has a §47 `paused + retained turn` branch, but
  // schema.js:184 forbids `paused` without pending_phase_transition or
  // pending_run_completion, and resume.js:119 short-circuits on those. So
  // that branch is currently unreachable and not exercised here, though the
  // patch covers it defensively.
  it('resume re-dispatching a retained blocked turn finalizes the manifest and transitions to dispatched', () => {
    const { root, config } = createProject();
    const assigned = assignGovernedTurn(root, config, 'dev');
    assert.ok(assigned.ok, assigned.error);
    const turnId = assigned.turn.turn_id;

    // Simulate the post-after_dispatch-hook-failure shape: an active turn
    // retained while the run is blocked on operator action. This is the
    // exact code path resume.js:189 (state.status === 'blocked' &&
    // activeCount > 0) handles. The `markRunBlocked` call emits a real
    // operator-facing escalation notice on stderr; suppress it here because
    // it is fixture seeding, not the assertion under test.
    const blockResult = withSuppressedStderr(() => markRunBlocked(root, {
      blockedOn: 'hook:after_dispatch:test',
      category: 'dispatch_error',
      recovery: {
        typed_reason: 'hook_block',
        owner: 'human',
        recovery_action: `agentxchain resume --turn ${turnId}`,
        turn_retained: true,
        detail: 'after_dispatch hook blocked dispatch',
      },
      turnId,
    }));
    assert.ok(blockResult.ok !== false, blockResult.error);

    // Backdate started_at to simulate a stale lifecycle-start that would
    // mis-fire the watchdog if not cleared by transitionActiveTurnLifecycle.
    const state = readState(root);
    state.active_turns[turnId].started_at = new Date(Date.now() - 60_000).toISOString();
    writeState(root, state);

    const result = spawnSync('node', [CLI_PATH, 'resume', '--turn', turnId], {
      cwd: root,
      encoding: 'utf8',
      timeout: 15_000,
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);

    const after = readState(root);
    const turn = after.active_turns[turnId];
    assert.equal(turn.status, 'dispatched',
      'resume must transition the retained blocked turn to `dispatched` so the watchdog tracks startup');
    assert.equal(turn.started_at, undefined,
      'transition to dispatched must clear stale started_at so ghost detection uses dispatched_at');
    assert.equal(turn.first_output_at, undefined);
    assert.equal(turn.worker_attached_at, undefined);

    const manifestPath = join(root, '.agentxchain', 'dispatch', 'turns', turnId, 'MANIFEST.json');
    assert.ok(existsSync(manifestPath),
      'resume must finalize MANIFEST.json so adapter manifest verification matches fresh dispatches');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    assert.equal(manifest.turn_id, turnId);
    assert.equal(manifest.role, 'dev');
    assert.ok(Array.isArray(manifest.files) && manifest.files.length > 0);
  });

  it('resume re-dispatched ghost turns are now caught by the startup watchdog (closes the asymmetry)', () => {
    const { root, config } = createProject({ run_loop: { startup_watchdog_ms: 100 } });
    const assigned = assignGovernedTurn(root, config, 'dev');
    assert.ok(assigned.ok, assigned.error);
    const turnId = assigned.turn.turn_id;

    // Pre-fix shape: blocked + retained turn with stale `started_at`. Without
    // the resume transition to `dispatched`, the watchdog either ignored the
    // turn entirely (status not in watched set) or fired immediately on
    // stale `started_at`. After the fix, resume clears those timestamps
    // and the watchdog uses the new `dispatched_at` for the 100ms window.
    // Same fixture-noise rationale as the sibling test above — the escalation
    // notice fires here as a side-effect of seeding, not an assertion target.
    const blockResult = withSuppressedStderr(() => markRunBlocked(root, {
      blockedOn: 'hook:after_dispatch:test',
      category: 'dispatch_error',
      recovery: {
        typed_reason: 'hook_block',
        owner: 'human',
        recovery_action: `agentxchain resume --turn ${turnId}`,
        turn_retained: true,
        detail: 'after_dispatch hook blocked dispatch',
      },
      turnId,
    }));
    assert.ok(blockResult.ok !== false);

    const state = readState(root);
    state.active_turns[turnId].started_at = new Date(Date.now() - 60_000).toISOString();
    state.active_turns[turnId].dispatched_at = new Date(Date.now() - 60_000).toISOString();
    writeState(root, state);

    const result = spawnSync('node', [CLI_PATH, 'resume', '--turn', turnId], {
      cwd: root,
      encoding: 'utf8',
      timeout: 15_000,
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);

    // Immediately after resume: no ghost yet (dispatched_at is fresh).
    const fresh = readState(root);
    assert.deepEqual(detectGhostTurns(root, fresh, config), []);

    // Backdate dispatched_at past the 100ms threshold to simulate a ghost.
    backdateTurnField(root, turnId, 'dispatched_at', 5);
    const aged = readState(root);
    const ghosts = detectGhostTurns(root, aged, config);
    assert.equal(ghosts.length, 1);
    assert.equal(ghosts[0].turn_id, turnId);
    assert.equal(ghosts[0].failure_type, 'runtime_spawn_failed');
  });

  it('reissue-turn finalizes MANIFEST.json so adapter verification matches fresh dispatches', () => {
    const { root, config } = createProject();
    const assigned = assignGovernedTurn(root, config, 'dev');
    assert.ok(assigned.ok, assigned.error);
    const oldTurnId = assigned.turn.turn_id;

    const reissued = reissueTurn(root, config, { turnId: oldTurnId, reason: 'operator-initiated' });
    assert.ok(reissued.ok, reissued.error);
    const newTurnId = reissued.newTurn.turn_id;

    // Direct lib reissueTurn does not write the bundle. The CLI command does.
    const result = spawnSync('node', [CLI_PATH, 'reissue-turn', '--turn', newTurnId, '--reason', 'operator-initiated'], {
      cwd: root,
      encoding: 'utf8',
      timeout: 15_000,
    });
    // The lib already reissued the turn, so the CLI may or may not produce
    // a fresh new turn — the assertion that matters is that the active turn
    // (whatever its id) has a finalized manifest at the end.
    const after = readState(root);
    const activeTurnIds = Object.keys(after.active_turns);
    assert.ok(activeTurnIds.length >= 1, result.stdout + result.stderr);
    for (const turnId of activeTurnIds) {
      const manifestPath = join(root, '.agentxchain', 'dispatch', 'turns', turnId, 'MANIFEST.json');
      if (existsSync(manifestPath)) {
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
        assert.equal(manifest.turn_id, turnId);
        assert.ok(Array.isArray(manifest.files) && manifest.files.length > 0);
        return;
      }
    }
    assert.fail('At least one active turn must have a finalized MANIFEST.json after reissue-turn');
  });

  // BUG-54 follow-up: ghost detector must honor per-runtime startup watchdog
  // override, otherwise the operator's tuning is silently pre-empted.
  it('ghost detector honors per-runtime startup_watchdog_ms override (BUG-54)', () => {
    // Build the override into the seed config so it is present before any
    // governed initialization runs validation.
    const overrideConfig = makeConfig({
      run_loop: { startup_watchdog_ms: 30_000 },
    });
    overrideConfig.runtimes['local-dev'].startup_watchdog_ms = 120_000;
    const root = mkdtempSync(join(tmpdir(), 'axc-bug54-fu-'));
    tempDirs.push(root);
    mkdirSync(join(root, '.agentxchain'), { recursive: true });
    writeFileSync(join(root, 'README.md'), '# BUG-54 follow-up\n');
    writeFileSync(join(root, 'agentxchain.json'), JSON.stringify(overrideConfig, null, 2));
    execSync('git init -b main', { cwd: root, stdio: 'ignore' });
    execSync('git config user.email "test@test.com"', { cwd: root, stdio: 'ignore' });
    execSync('git config user.name "Test"', { cwd: root, stdio: 'ignore' });
    execSync('git add -A && git commit -m "init"', { cwd: root, stdio: 'ignore' });
    const init = initializeGovernedRun(root, overrideConfig);
    assert.ok(init.ok, init.error);
    const config = overrideConfig;

    // Seed a turn dispatched 60s ago: past the 30s global, well under the
    // 120s runtime override.
    const { turnId, state } = seedDispatchedTurn(root, config, 60);

    const ghosts = detectGhostTurns(root, state, config);
    assert.equal(
      ghosts.length, 0,
      'BUG-54: per-runtime startup_watchdog_ms override (120s) must beat the '
      + 'global (30s). Without the fix, the ghost detector would mark this '
      + `turn ${turnId} as failed_start at 60s and defeat the operator's tuning.`,
    );

    // Sanity: once the runtime override is also exceeded, ghost still fires.
    const aged = readState(root);
    aged.active_turns[turnId].dispatched_at = new Date(Date.now() - 130_000).toISOString();
    const agedGhosts = detectGhostTurns(root, aged, config);
    assert.equal(agedGhosts.length, 1);
    assert.equal(agedGhosts[0].threshold_ms, 120_000,
      'threshold_ms in the ghost record must report the per-runtime override, '
      + 'not the global, so failure metadata matches the actual fired threshold.');
  });

  it('failTurnStartup defaults to the per-runtime startup_watchdog_ms override when threshold_ms is omitted (BUG-54)', () => {
    const overrideConfig = makeConfig({
      run_loop: { startup_watchdog_ms: 30_000 },
    });
    overrideConfig.runtimes['local-dev'].startup_watchdog_ms = 120_000;
    const root = mkdtempSync(join(tmpdir(), 'axc-bug54-fail-startup-'));
    tempDirs.push(root);
    mkdirSync(join(root, '.agentxchain'), { recursive: true });
    writeFileSync(join(root, 'README.md'), '# BUG-54 failTurnStartup override\n');
    writeFileSync(join(root, 'agentxchain.json'), JSON.stringify(overrideConfig, null, 2));
    execSync('git init -b main', { cwd: root, stdio: 'ignore' });
    execSync('git config user.email "test@test.com"', { cwd: root, stdio: 'ignore' });
    execSync('git config user.name "Test"', { cwd: root, stdio: 'ignore' });
    execSync('git add -A && git commit -m "init"', { cwd: root, stdio: 'ignore' });
    const init = initializeGovernedRun(root, overrideConfig);
    assert.ok(init.ok, init.error);

    const { turnId } = seedDispatchedTurn(root, overrideConfig, 130);
    const state = readState(root);
    const result = failTurnStartup(root, state, overrideConfig, turnId, {
      failure_type: 'runtime_spawn_failed',
      running_ms: 130_000,
    });

    assert.equal(result.ok, true, result.error);
    assert.equal(result.turn.failed_start_threshold_ms, 120_000,
      'failTurnStartup must use the runtime override when the caller omits '
      + 'threshold_ms, otherwise event/state metadata drifts from the '
      + 'operator-configured threshold.');

    const events = readEvents(root);
    const failedEvent = events.find((event) => event.event_type === 'turn_start_failed');
    assert.ok(failedEvent, 'turn_start_failed event must be emitted for startup failure');
    assert.equal(failedEvent.payload?.threshold_ms, 120_000,
      'turn_start_failed payload must report the per-runtime override, not the global default.');
  });
});
