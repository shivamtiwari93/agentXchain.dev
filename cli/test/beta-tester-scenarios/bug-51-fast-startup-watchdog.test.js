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
  transitionActiveTurnLifecycle,
} from '../../src/lib/governed-state.js';
import { createDispatchProgressTracker, getDispatchProgressRelativePath } from '../../src/lib/dispatch-progress.js';
import { detectGhostTurns, reconcileStaleTurns } from '../../src/lib/stale-turn-watchdog.js';

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

function createProject(configOverrides = {}) {
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
  const init = initializeGovernedRun(root, config);
  assert.ok(init.ok, init.error);
  return { root, config };
}

function readState(root) {
  return JSON.parse(readFileSync(join(root, '.agentxchain', 'state.json'), 'utf8'));
}

function writeState(root, state) {
  writeFileSync(join(root, '.agentxchain', 'state.json'), JSON.stringify(state, null, 2));
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
    assert.equal(ghosts[0].failure_type, 'no_subprocess_output');
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
    assert.equal(state.active_turns[turnId].failed_start_reason, 'no_subprocess_output');
  });
});
