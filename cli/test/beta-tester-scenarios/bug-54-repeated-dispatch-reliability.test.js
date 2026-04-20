/**
 * BUG-54 beta-tester scenario: repeated-dispatch reliability.
 *
 * Reproduces the tester's v2.147.0 run `run_4b24e171693ac091` pattern — 6
 * consecutive QA turn startup failures alternating between `runtime_spawn_failed`
 * (subprocess never started) and `no_subprocess_output` (subprocess started
 * but produced no first byte). HUMAN-ROADMAP BUG-54 fix requirement #4:
 * "Add tester-sequence test that dispatches 10 consecutive QA turns and asserts
 * ≥9 complete successfully. Single-turn tests don't catch this class of
 * reliability bug."
 *
 * This slice of the fix does NOT close BUG-54. It does two things that no other
 * test in the repo currently does:
 *
 *   1. Dispatches the local-cli adapter 10 times in a tight loop against a
 *      spawn-but-silent subprocess and asserts that the adapter's failure
 *      classification is deterministic across iterations (not flaky) and that
 *      every dispatch produces the structured BUG-54 startup diagnostics GPT
 *      5.4 shipped in `c838eb5c fix(adapter): add BUG-54 startup diagnostics`.
 *
 *   2. Audits Node's active-handle and active-request counts before and after
 *      the loop to detect the fd/resource-leak hypothesis #1 from the
 *      HUMAN-ROADMAP BUG-54 entry. If handle counts grow monotonically across
 *      iterations, the adapter is leaking — that's the root cause. If they
 *      stay bounded, the adapter cleanup is clean and the reliability
 *      regression lives elsewhere (Claude CLI subprocess semantics, runtime
 *      matrix, or stdin delivery against a specific binary).
 *
 * Intentionally narrow: this test uses a node subprocess, not the real Claude
 * CLI. The goal here is to isolate "does the adapter itself leak across
 * repeated failing dispatches" from "does the Claude CLI invocation produce
 * inconsistent startup behavior under repeated load." Once this passes, the
 * next slice can narrow to a Claude-CLI-specific reproduction with a real
 * `claude --print` style invocation.
 */

import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

import { dispatchLocalCli } from '../../src/lib/adapters/local-cli-adapter.js';
import { writeDispatchBundle } from '../../src/lib/dispatch-bundle.js';

const tempDirs = [];

afterEach(() => {
  while (tempDirs.length) {
    const dir = tempDirs.pop();
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }
});

function makeTmp() {
  const dir = mkdtempSync(join(tmpdir(), 'axc-bug54-'));
  tempDirs.push(dir);
  return dir;
}

function makeState(turnId) {
  return {
    run_id: 'run_bug54_reliability',
    status: 'active',
    phase: 'qa',
    accepted_integration_ref: 'git:abc123',
    current_turn: {
      turn_id: turnId,
      assigned_role: 'qa',
      status: 'running',
      attempt: 1,
      started_at: new Date().toISOString(),
      // Short deadline keeps the test fast; adapter deadline != watchdog.
      deadline_at: new Date(Date.now() + 60_000).toISOString(),
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

function makeConfig(runtime) {
  return {
    schema_version: 4,
    protocol_mode: 'governed',
    project: { id: 'bug54', name: 'BUG-54', default_branch: 'main' },
    roles: {
      qa: {
        title: 'QA',
        mandate: 'Validate.',
        write_authority: 'authoritative',
        runtime_class: 'local_cli',
        runtime_id: 'local-qa',
      },
    },
    runtimes: { 'local-qa': runtime },
    routing: { qa: { entry_role: 'qa', allowed_next_roles: ['qa', 'launch', 'human'] } },
    gates: {},
    budget: { per_turn_max_usd: 2.0, per_run_max_usd: 50.0 },
    rules: { challenge_required: true, max_turn_retries: 2 },
    run_loop: { startup_watchdog_ms: 600 },
  };
}

function countDiagnosticOccurrences(logs, label) {
  const needle = `[adapter:diag] ${label} `;
  return logs.reduce((n, line) => (typeof line === 'string' && line.includes(needle) ? n + 1 : n), 0);
}

describe('BUG-54 repeated-dispatch reliability', () => {
  it('10 consecutive spawn-but-silent dispatches all fail deterministically with BUG-54 diagnostics', async (t) => {
    const root = makeTmp();
    mkdirSync(join(root, '.agentxchain'), { recursive: true });

    // Spawn-but-silent subprocess: starts, never writes, just waits.
    // Watchdog (600ms) will SIGTERM it. Mirrors the tester's repeated
    // `no_subprocess_output` pattern.
    const runtime = {
      type: 'local_cli',
      command: ['node', '-e', 'setTimeout(() => {}, 30_000);'],
      cwd: '.',
    };
    const config = makeConfig(runtime);

    const ITER = 10;
    const results = [];

    // Snapshot handle counts BEFORE the loop so we can detect accumulation.
    // Node exposes these as underscore APIs — they are informative, not
    // contractual, so we tolerate small churn but fail on unbounded growth.
    const handlesBefore = process._getActiveHandles?.().length ?? 0;
    const requestsBefore = process._getActiveRequests?.().length ?? 0;

    for (let i = 0; i < ITER; i++) {
      const turnId = `turn_bug54_${i}_${randomBytes(3).toString('hex')}`;
      const state = makeState(turnId);
      // Each iteration needs its own dispatch bundle.
      writeDispatchBundle(root, state, config);

      const result = await dispatchLocalCli(root, state, config);
      results.push({ i, result });
    }

    // Give Node one tick to process pending stream 'close' events that fire
    // after the adapter's promise resolves. In `run --continuous` the outer
    // governance loop naturally provides this gap; the test must mirror that
    // to audit steady-state handle counts rather than instantaneous snapshot.
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setTimeout(r, 50));

    const handlesAfter = process._getActiveHandles?.().length ?? 0;
    const requestsAfter = process._getActiveRequests?.().length ?? 0;

    // 1. Every iteration must return (no hangs). The loop finishing at all
    //    already proves this, but be explicit.
    assert.equal(results.length, ITER, 'all iterations must return');

    // 2. Every iteration must classify as a startup failure with the same
    //    failure type. Flapping between types would itself be a reliability
    //    signal — call it out so the next slice can investigate.
    const failureTypes = new Set(results.map(({ result }) => result.startupFailureType || 'none'));
    assert.ok(
      results.every(({ result }) => result.ok === false && result.startupFailure === true),
      `all ${ITER} dispatches must fail with startupFailure=true; got: ${JSON.stringify(results.map((r) => ({ i: r.i, ok: r.result.ok, startupFailure: r.result.startupFailure, startupFailureType: r.result.startupFailureType })))}`,
    );
    assert.ok(
      failureTypes.size === 1,
      `failure classification must be deterministic across ${ITER} iterations; got distinct types: ${[...failureTypes].join(', ')}`,
    );

    // 3. BUG-54 diagnostics must be emitted for every iteration. If GPT's
    //    c838eb5c diagnostics silently skip on any iteration, the tester
    //    can't debug the real Claude repro.
    for (const { i, result } of results) {
      const logs = result.logs || [];
      assert.ok(
        countDiagnosticOccurrences(logs, 'spawn_prepare') === 1,
        `iteration ${i}: expected exactly 1 spawn_prepare diagnostic`,
      );
      assert.ok(
        countDiagnosticOccurrences(logs, 'spawn_attached') === 1,
        `iteration ${i}: expected exactly 1 spawn_attached diagnostic (child started)`,
      );
      assert.ok(
        countDiagnosticOccurrences(logs, 'startup_watchdog_fired') === 1,
        `iteration ${i}: expected exactly 1 startup_watchdog_fired diagnostic`,
      );
      assert.ok(
        countDiagnosticOccurrences(logs, 'process_exit') === 1,
        `iteration ${i}: expected exactly 1 process_exit diagnostic`,
      );
    }

    // 4. PIDs must be unique across iterations — proves each dispatch actually
    //    spawned a fresh subprocess (not silently reusing a hung one).
    const pids = new Set();
    for (const { result } of results) {
      const match = result.logs.join('').match(/"pid":\s*(\d+)/g);
      if (match) {
        for (const m of match) {
          const pid = Number(m.replace(/"pid":\s*/, ''));
          if (pid > 0) pids.add(pid);
        }
      }
    }
    assert.ok(pids.size >= ITER, `expected at least ${ITER} distinct pids across iterations; got ${pids.size}`);

    // 5. Resource-accumulation audit — hypothesis #1 of BUG-54.
    //    If the adapter leaks a child handle, a timer, or a listener per
    //    failed dispatch, this delta grows to ITER (or beyond). Tolerating a
    //    small noise floor for the test framework's own handles.
    const handleDelta = handlesAfter - handlesBefore;
    const requestDelta = requestsAfter - requestsBefore;
    assert.ok(
      handleDelta <= 3,
      `active handles grew by ${handleDelta} across ${ITER} dispatches — possible adapter leak (hypothesis #1). before=${handlesBefore} after=${handlesAfter}`,
    );
    assert.ok(
      requestDelta <= 3,
      `active requests grew by ${requestDelta} across ${ITER} dispatches — possible adapter leak (hypothesis #1). before=${requestsBefore} after=${requestsAfter}`,
    );
  });

  it('10 consecutive nonexistent-binary dispatches emit runtime_spawn_failed without leaking', async () => {
    const root = makeTmp();
    mkdirSync(join(root, '.agentxchain'), { recursive: true });

    const runtime = {
      type: 'local_cli',
      command: ['/nonexistent/binary/for/bug54/reliability', '--print'],
      cwd: '.',
    };
    const config = makeConfig(runtime);

    const ITER = 10;
    const results = [];

    const handlesBefore = process._getActiveHandles?.().length ?? 0;

    for (let i = 0; i < ITER; i++) {
      const turnId = `turn_bug54_nobin_${i}_${randomBytes(3).toString('hex')}`;
      const state = makeState(turnId);
      writeDispatchBundle(root, state, config);
      const result = await dispatchLocalCli(root, state, config);
      results.push({ i, result });
    }

    // See tick rationale in the spawn-but-silent subtest. Without the
    // adapter's explicit `child.stdin/stdout/stderr.destroy()` on the error
    // path (BUG-54 hypothesis #1 fix), this delta was ~40 across 10 failed
    // dispatches — 4 handles (3 stdio Sockets + 1 ChildProcess) per failure
    // held until GC. With the destroy fix, handles release within one tick.
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setTimeout(r, 50));

    const handlesAfter = process._getActiveHandles?.().length ?? 0;

    // The spawn call for a nonexistent path on Darwin/Linux emits 'error'
    // asynchronously on the child; the adapter classifies this as
    // `runtime_spawn_failed`. Assert every iteration lands there.
    for (const { i, result } of results) {
      assert.equal(result.ok, false, `iteration ${i}: expected ok=false`);
      assert.equal(result.startupFailure, true, `iteration ${i}: expected startupFailure=true`);
      assert.equal(
        result.startupFailureType,
        'runtime_spawn_failed',
        `iteration ${i}: expected runtime_spawn_failed; got ${result.startupFailureType}`,
      );
      // Every iteration must log spawn_prepare at minimum; spawn_error is the
      // failure-specific diagnostic for this path.
      const logs = result.logs || [];
      assert.ok(
        countDiagnosticOccurrences(logs, 'spawn_prepare') === 1,
        `iteration ${i}: expected exactly 1 spawn_prepare diagnostic`,
      );
      assert.ok(
        countDiagnosticOccurrences(logs, 'spawn_error') >= 1,
        `iteration ${i}: expected at least 1 spawn_error diagnostic for nonexistent binary`,
      );
    }

    const handleDelta = handlesAfter - handlesBefore;
    assert.ok(
      handleDelta <= 3,
      `active handles grew by ${handleDelta} across ${ITER} nonexistent-binary dispatches — possible adapter leak. before=${handlesBefore} after=${handlesAfter}`,
    );
  });
});
