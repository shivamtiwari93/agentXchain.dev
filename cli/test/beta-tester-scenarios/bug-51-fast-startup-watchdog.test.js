/**
 * BUG-51 beta-tester scenario: fast-startup watchdog catches fake-running
 * turns within the startup window instead of leaving them "running" for the
 * slower stale-turn watchdog.
 */

import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  assignGovernedTurn,
  initializeGovernedRun,
  reissueTurn,
  transitionActiveTurnLifecycle,
} from '../../src/lib/governed-state.js';
import { createDispatchProgressTracker, getDispatchProgressRelativePath } from '../../src/lib/dispatch-progress.js';
import { detectGhostTurns, reconcileStaleTurns } from '../../src/lib/stale-turn-watchdog.js';
import { buildScheduleExecutionResult } from '../../src/commands/schedule.js';

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

function configureSilentLocalCliRuntime(root, config, { scriptName = 'silent-sleeper.js', source, vision = null } = {}) {
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

function readState(root) {
  return JSON.parse(readFileSync(join(root, '.agentxchain', 'state.json'), 'utf8'));
}

function writeState(root, state) {
  writeFileSync(join(root, '.agentxchain', 'state.json'), JSON.stringify(state, null, 2));
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

    const events = readFileSync(join(root, '.agentxchain', 'events.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    assert.ok(events.some((entry) => entry.event_type === 'turn_start_failed'));
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
});
