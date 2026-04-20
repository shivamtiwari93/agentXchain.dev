/**
 * BUG-54 beta-tester scenario — real `claude` binary reliability loop.
 *
 * Sister to `bug-54-repeated-dispatch-reliability.test.js`, which uses a node
 * subprocess substitute to isolate adapter-only leaks. This test runs the same
 * tight-loop audit against the REAL `claude` binary so the adapter cleanup
 * claim (Turn 63 / Turn 67) is backed by real-runtime evidence, not just a
 * node-subprocess analog.
 *
 * Gated: if `claude` is not on PATH, the test skips. CI runners without Claude
 * Code installed will skip cleanly; developer machines that have the binary
 * will exercise the full path.
 *
 * Scenarios (each iterates 10 dispatches):
 *   A. `claude --version`        — spawn OK, writes stdout ~21 bytes, exits 0,
 *                                  no staging → expects `exited_no_staging`
 *                                  classification (NOT a startup failure
 *                                  because first_output fired).
 *   B. same with 50ms watchdog   — watchdog fires before first output → expects
 *                                  `no_subprocess_output` startup failure
 *                                  across all iterations. Exercises the
 *                                  watchdog→SIGTERM→close cleanup path on a
 *                                  real binary.
 *   C. `claude --bogus-flag`     — spawn OK, binary errors, exits 1 →
 *                                  expects `exited_no_staging`.
 *
 * Handle-leak audit on every scenario: after the 10-iteration loop plus one
 * event-loop tick, active-handle growth must be bounded (≤3). If this assertion
 * fails, the adapter is leaking on a real-binary failure path and the Turn 63
 * cleanup claim is wrong for that path.
 */

import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';

import { dispatchLocalCli } from '../../src/lib/adapters/local-cli-adapter.js';
import { writeDispatchBundle } from '../../src/lib/dispatch-bundle.js';

const CLAUDE_AVAILABLE = (() => {
  try {
    const r = spawnSync('claude', ['--version'], { encoding: 'utf8', timeout: 10_000 });
    return r.status === 0 && /\d+\.\d+\.\d+/.test(r.stdout || '');
  } catch {
    return false;
  }
})();

const tempDirs = [];
afterEach(() => {
  while (tempDirs.length) {
    const dir = tempDirs.pop();
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});

function makeTmp() {
  const dir = mkdtempSync(join(tmpdir(), 'axc-bug54-real-'));
  tempDirs.push(dir);
  return dir;
}

function makeState(turnId) {
  return {
    run_id: 'run_bug54_real',
    status: 'active',
    phase: 'qa',
    accepted_integration_ref: 'git:abc123',
    current_turn: {
      turn_id: turnId,
      assigned_role: 'qa',
      status: 'running',
      attempt: 1,
      started_at: new Date().toISOString(),
      deadline_at: new Date(Date.now() + 30_000).toISOString(),
      runtime_id: 'local-qa',
    },
    last_completed_turn_id: null,
    blocked_on: null,
    escalation: null,
    budget_status: { spent_usd: 0, remaining_usd: 50 },
    phase_gate_status: {},
    active_turns: {},
  };
}

function makeConfig(runtime, watchdogMs = 30_000) {
  return {
    schema_version: 4,
    protocol_mode: 'governed',
    project: { id: 'bug54real', name: 'BUG-54 real-claude', default_branch: 'main' },
    roles: {
      qa: {
        title: 'QA', mandate: 'Validate.',
        write_authority: 'authoritative', runtime_class: 'local_cli', runtime_id: 'local-qa',
      },
    },
    runtimes: { 'local-qa': runtime },
    routing: { qa: { entry_role: 'qa', allowed_next_roles: ['qa', 'launch', 'human'] } },
    gates: {},
    budget: { per_turn_max_usd: 2.0, per_run_max_usd: 50.0 },
    rules: { challenge_required: true, max_turn_retries: 2 },
    run_loop: { startup_watchdog_ms: watchdogMs },
  };
}

function countDiag(logs, label) {
  const needle = `[adapter:diag] ${label} `;
  return logs.reduce((n, line) => (typeof line === 'string' && line.includes(needle) ? n + 1 : n), 0);
}

async function runLoop(runtime, watchdogMs, iterations) {
  const root = makeTmp();
  mkdirSync(join(root, '.agentxchain'), { recursive: true });
  const config = makeConfig(runtime, watchdogMs);

  const handlesBefore = process._getActiveHandles?.().length ?? 0;
  const results = [];
  for (let i = 0; i < iterations; i++) {
    const turnId = `turn_bug54real_${i}_${randomBytes(3).toString('hex')}`;
    const state = makeState(turnId);
    writeDispatchBundle(root, state, config);
    const result = await dispatchLocalCli(root, state, config);
    results.push(result);
  }
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setTimeout(r, 100));
  const handlesAfter = process._getActiveHandles?.().length ?? 0;

  return { results, handleDelta: handlesAfter - handlesBefore };
}

describe('BUG-54 real-claude reliability', () => {
  it('Scenario A: 10 consecutive `claude --version` dispatches exit cleanly without leaking', { skip: !CLAUDE_AVAILABLE }, async () => {
    const runtime = {
      type: 'local_cli',
      command: ['claude', '--version'],
      cwd: '.',
      prompt_transport: 'dispatch_bundle_only',
    };
    const { results, handleDelta } = await runLoop(runtime, 30_000, 10);

    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      assert.equal(r.ok, false, `iter ${i}: expected ok=false (no staged result)`);
      // Real claude writes stdout, so first_output fires, so this is NOT a
      // startup failure — it's the "exited cleanly without staging" path.
      assert.equal(r.startupFailure, undefined, `iter ${i}: expected no startupFailure (first_output fired)`);
      const logs = r.logs || [];
      assert.equal(countDiag(logs, 'spawn_prepare'), 1, `iter ${i}: spawn_prepare`);
      assert.equal(countDiag(logs, 'spawn_attached'), 1, `iter ${i}: spawn_attached`);
      assert.equal(countDiag(logs, 'first_output'), 1, `iter ${i}: first_output`);
      assert.equal(countDiag(logs, 'process_exit'), 1, `iter ${i}: process_exit`);
    }

    assert.ok(handleDelta <= 3,
      `real-claude version loop leaked handles: delta=${handleDelta} — cleanup path failed`);
  });

  it('Scenario B: 10 consecutive `claude --version` with 50ms watchdog all fire watchdog→SIGTERM→close without leaking', { skip: !CLAUDE_AVAILABLE }, async () => {
    const runtime = {
      type: 'local_cli',
      command: ['claude', '--version'],
      cwd: '.',
      prompt_transport: 'dispatch_bundle_only',
    };
    const { results, handleDelta } = await runLoop(runtime, 50, 10);

    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      assert.equal(r.ok, false, `iter ${i}: expected ok=false`);
      assert.equal(r.startupFailure, true, `iter ${i}: expected startupFailure=true`);
      assert.equal(r.startupFailureType, 'no_subprocess_output',
        `iter ${i}: expected no_subprocess_output; got ${r.startupFailureType}`);
      const logs = r.logs || [];
      assert.equal(countDiag(logs, 'spawn_attached'), 1, `iter ${i}: spawn_attached`);
      assert.equal(countDiag(logs, 'startup_watchdog_fired'), 1, `iter ${i}: watchdog must fire`);
      assert.equal(countDiag(logs, 'process_exit'), 1, `iter ${i}: process_exit`);
      // first_output MUST NOT fire — that's the whole point of the 50ms race.
      // Real claude takes ~250-350ms to print its version, well past 50ms.
      assert.equal(countDiag(logs, 'first_output'), 0, `iter ${i}: first_output must not fire before watchdog`);
    }

    // This is the assertion that validates the Turn 63 cleanup claim on a
    // real binary: watchdog→SIGTERM→close path releases stdio handles
    // promptly. If this fails, the close-path cleanup is not backed for
    // real claude and we need explicit stdio destroy() on the watchdog
    // SIGTERM path too.
    assert.ok(handleDelta <= 3,
      `real-claude watchdog→SIGTERM→close loop leaked handles: delta=${handleDelta} — close path cleanup insufficient for real binary`);
  });

  it('Scenario C: 10 consecutive `claude --bogus-flag` dispatches exit non-zero without leaking', { skip: !CLAUDE_AVAILABLE }, async () => {
    const runtime = {
      type: 'local_cli',
      command: ['claude', '--this-flag-does-not-exist-bug54'],
      cwd: '.',
      prompt_transport: 'dispatch_bundle_only',
    };
    const { results, handleDelta } = await runLoop(runtime, 30_000, 10);

    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      assert.equal(r.ok, false, `iter ${i}: expected ok=false`);
      const logs = r.logs || [];
      assert.equal(countDiag(logs, 'spawn_prepare'), 1, `iter ${i}: spawn_prepare`);
      assert.equal(countDiag(logs, 'spawn_attached'), 1, `iter ${i}: spawn_attached`);
      assert.equal(countDiag(logs, 'process_exit'), 1, `iter ${i}: process_exit`);
    }

    assert.ok(handleDelta <= 3,
      `real-claude bogus-flag loop leaked handles: delta=${handleDelta}`);
  });
});
