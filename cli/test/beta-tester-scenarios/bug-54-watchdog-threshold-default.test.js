/**
 * BUG-54 beta-tester scenario: default startup watchdog threshold.
 *
 * The tester's real Claude Max subprocess produced first stdout at 113094ms
 * for a realistic 17.7KB dispatch bundle. The old 30000ms default killed that
 * healthy subprocess before it could emit startup proof. This test locks the
 * default above the old threshold by spawning a shim that emits its first byte
 * after 31s and proving the adapter does not SIGTERM it.
 */

import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { dispatchLocalCli } from '../../src/lib/adapters/local-cli-adapter.js';
import { detectGhostTurns } from '../../src/lib/stale-turn-watchdog.js';
import { writeDispatchBundle } from '../../src/lib/dispatch-bundle.js';

const tempDirs = [];

afterEach(() => {
  while (tempDirs.length) {
    const dir = tempDirs.pop();
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});

function makeTmp() {
  const dir = mkdtempSync(join(tmpdir(), 'axc-bug54-threshold-'));
  tempDirs.push(dir);
  return dir;
}

function makeState(overrides = {}) {
  const turn = {
    turn_id: 'turn_bug54_slow_stdout',
    assigned_role: 'pm',
    status: 'running',
    attempt: 1,
    started_at: new Date().toISOString(),
    dispatched_at: new Date().toISOString(),
    deadline_at: new Date(Date.now() + 90_000).toISOString(),
    runtime_id: 'local-pm',
    ...overrides.turn,
  };
  return {
    run_id: 'run_bug54_threshold',
    status: 'active',
    phase: 'planning',
    current_turn: turn,
    active_turns: { [turn.turn_id]: turn },
    accepted_integration_ref: 'git:abc123',
    last_completed_turn_id: null,
    blocked_on: null,
    escalation: null,
    budget_status: { spent_usd: 0, remaining_usd: 50 },
    phase_gate_status: {},
    ...overrides.state,
  };
}

function makeConfig(runtime) {
  return {
    schema_version: 4,
    protocol_mode: 'governed',
    project: { id: 'bug54-threshold', name: 'BUG-54 Threshold', default_branch: 'main' },
    roles: {
      pm: {
        title: 'PM',
        mandate: 'Plan.',
        write_authority: 'authoritative',
        runtime_class: 'local_cli',
        runtime_id: 'local-pm',
      },
    },
    runtimes: { 'local-pm': runtime },
    routing: { planning: { entry_role: 'pm', allowed_next_roles: ['pm', 'dev', 'human'] } },
    gates: {},
    budget: { per_turn_max_usd: 2.0, per_run_max_usd: 50.0 },
    rules: { challenge_required: true, max_turn_retries: 2 },
  };
}

describe('BUG-54 default startup watchdog threshold', () => {
  it('does not kill a subprocess that emits first stdout after the old 30s default', { timeout: 45_000 }, async () => {
    const root = makeTmp();
    mkdirSync(join(root, '.agentxchain'), { recursive: true });
    const scriptPath = join(root, 'slow-first-byte.js');
    writeFileSync(scriptPath, `
      setTimeout(() => {
        process.stdout.write('first-byte-after-old-threshold\\n');
        process.exit(0);
      }, 31_000);
    `);

    const state = makeState();
    const config = makeConfig({
      type: 'local_cli',
      command: ['node', scriptPath],
      cwd: '.',
    });
    writeDispatchBundle(root, state, config);

    const result = await dispatchLocalCli(root, state, config);
    const log = result.logs.join('');

    assert.equal(result.ok, false, 'shim exits without staging a turn result');
    assert.notEqual(result.startupFailure, true, 'slow first stdout must not be treated as failed_start');
    assert.match(log, /\[adapter:diag\] spawn_attached /);
    assert.match(log, /\[adapter:diag\] first_output /);
    assert.match(log, /first-byte-after-old-threshold/);
    assert.doesNotMatch(log, /\[adapter:diag\] startup_watchdog_fired /);
    assert.doesNotMatch(log, /"exit_signal":"SIGTERM"/);
  });

  it('does not classify a no-output local_cli turn as ghost at 31s by default', () => {
    const root = makeTmp();
    const startedAt = new Date(Date.now() - 31_000).toISOString();
    const state = makeState({
      turn: {
        started_at: startedAt,
        dispatched_at: startedAt,
      },
    });
    const config = makeConfig({
      type: 'local_cli',
      command: ['node', '-e', 'setTimeout(() => {}, 60000);'],
      cwd: '.',
    });

    const ghosts = detectGhostTurns(root, state, config);
    assert.deepEqual(ghosts, [], '31s with no output is below the 180s default after BUG-54');
  });

  it('still fails a silent subprocess when an operator sets a tight explicit watchdog', async () => {
    const root = makeTmp();
    mkdirSync(join(root, '.agentxchain'), { recursive: true });
    const state = makeState();
    const config = makeConfig({
      type: 'local_cli',
      command: ['node', '-e', 'setTimeout(() => {}, 30000);'],
      cwd: '.',
    });
    config.run_loop = { startup_watchdog_ms: 100 };
    writeDispatchBundle(root, state, config);

    const result = await dispatchLocalCli(root, state, config);
    assert.equal(result.ok, false);
    assert.equal(result.startupFailure, true);
    assert.equal(result.startupFailureType, 'no_subprocess_output');
    assert.match(result.logs.join(''), /\[adapter:diag\] startup_watchdog_fired /);
  });
});
