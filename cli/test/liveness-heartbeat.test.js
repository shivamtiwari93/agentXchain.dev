/**
 * RB-6: local_cli liveness heartbeat — unit + integration tests.
 *
 * A dev turn that does real work then runs a long output-silent operation
 * (e.g. the full test suite) used to go silent past the stale-turn watchdog
 * threshold and get killed, discarding completed work. The liveness heartbeat
 * keeps the dispatch-progress `last_activity_at` fresh for the whole lifetime of
 * an alive subprocess (unlike the startup heartbeat, which stops at first
 * output), so an alive-but-quiet turn is not misclassified as stalled. Genuine
 * hangs remain bounded by the per-turn hard timeout.
 *
 * Covers:
 *   - resolveLivenessHeartbeatMs precedence (override > runtime > run_loop > default)
 *   - the stale-turn watchdog does NOT flag a running turn whose dispatch-progress
 *     last_activity_at is fresh (the contract the heartbeat keeps satisfied), and
 *     DOES flag it when last_activity_at is stale
 *   - the liveness heartbeat fires while a subprocess is alive but output-silent
 *     AFTER first output (the exact RB-6 failure mode)
 */

import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

import {
  resolveLivenessHeartbeatMs,
  dispatchLocalCli,
} from '../src/lib/adapters/local-cli-adapter.js';
import { detectStaleTurns } from '../src/lib/stale-turn-watchdog.js';
import { getDispatchProgressRelativePath } from '../src/lib/dispatch-progress.js';
import { getDispatchTurnDir } from '../src/lib/turn-paths.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeTmpDir() {
  const dir = join(tmpdir(), `axc-liveness-test-${randomBytes(6).toString('hex')}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeShim(root, name, contents) {
  const shimDir = join(root, 'shim-bin');
  mkdirSync(shimDir, { recursive: true });
  const shimPath = join(shimDir, name);
  writeFileSync(shimPath, contents);
  chmodSync(shimPath, 0o755);
  return shimPath;
}

function scaffoldDispatch(root, turnId) {
  const dispatchDir = join(root, getDispatchTurnDir(turnId));
  mkdirSync(dispatchDir, { recursive: true });
  writeFileSync(join(dispatchDir, 'PROMPT.md'), '# Test prompt');
  const stagingDir = join(root, '.agentxchain', 'staging', turnId);
  mkdirSync(stagingDir, { recursive: true });
}

function writeProgress(root, turnId, lastActivityAt) {
  mkdirSync(join(root, '.agentxchain'), { recursive: true });
  writeFileSync(join(root, getDispatchProgressRelativePath(turnId)), JSON.stringify({
    turn_id: turnId,
    runtime_id: 'test-rt',
    adapter_type: 'local_cli',
    started_at: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
    last_activity_at: lastActivityAt,
    activity_type: 'heartbeat',
    output_lines: 5,
  }, null, 2));
}

// ── resolveLivenessHeartbeatMs precedence ───────────────────────────────────

describe('resolveLivenessHeartbeatMs', () => {
  const localCliRuntime = { type: 'local_cli', liveness_heartbeat_ms: 7000 };

  it('AT-LV-001: explicit override wins over everything', () => {
    assert.equal(resolveLivenessHeartbeatMs({ run_loop: { liveness_heartbeat_ms: 5000 } }, localCliRuntime, 1234), 1234);
  });

  it('AT-LV-002: runtime override beats run_loop config and default', () => {
    assert.equal(resolveLivenessHeartbeatMs({ run_loop: { liveness_heartbeat_ms: 5000 } }, localCliRuntime), 7000);
  });

  it('AT-LV-003: run_loop config used when no runtime override', () => {
    assert.equal(resolveLivenessHeartbeatMs({ run_loop: { liveness_heartbeat_ms: 5000 } }, { type: 'local_cli' }), 5000);
  });

  it('AT-LV-004: falls back to the 60s default when nothing is set', () => {
    assert.equal(resolveLivenessHeartbeatMs({}, { type: 'local_cli' }), 60000);
  });

  it('AT-LV-005: ignores non-positive / non-integer overrides', () => {
    assert.equal(resolveLivenessHeartbeatMs({}, { type: 'local_cli' }, 0), 60000);
    assert.equal(resolveLivenessHeartbeatMs({}, { type: 'local_cli' }, -5), 60000);
    assert.equal(resolveLivenessHeartbeatMs({}, { type: 'local_cli' }, 1.5), 60000);
  });

  it('AT-LV-006: runtime liveness override only honored for local_cli runtimes', () => {
    assert.equal(resolveLivenessHeartbeatMs({}, { type: 'api_proxy', liveness_heartbeat_ms: 7000 }), 60000);
  });

  it('AT-LV-010: NaN override falls through to default', () => {
    assert.equal(resolveLivenessHeartbeatMs({}, { type: 'local_cli' }, NaN), 60000);
  });

  it('AT-LV-011: Infinity override falls through to default', () => {
    assert.equal(resolveLivenessHeartbeatMs({}, { type: 'local_cli' }, Infinity), 60000);
    assert.equal(resolveLivenessHeartbeatMs({}, { type: 'local_cli' }, -Infinity), 60000);
  });

  it('AT-LV-012: string override falls through to default', () => {
    assert.equal(resolveLivenessHeartbeatMs({}, { type: 'local_cli' }, '100'), 60000);
  });

  it('AT-LV-013: null/undefined config and runtime handled gracefully', () => {
    assert.equal(resolveLivenessHeartbeatMs(null, null), 60000);
    assert.equal(resolveLivenessHeartbeatMs(undefined, undefined), 60000);
    assert.equal(resolveLivenessHeartbeatMs(null, null, null), 60000);
  });
});

// ── stale-turn watchdog honors last_activity_at (the heartbeat's contract) ──

describe('stale-turn watchdog respects a fresh last_activity_at', () => {
  const config = { runtimes: { 'test-rt': { type: 'local_cli' } } };

  function runningTurnState(turnId) {
    return {
      run_id: 'run_lv',
      active_turns: {
        [turnId]: {
          turn_id: turnId,
          assigned_role: 'dev',
          runtime_id: 'test-rt',
          status: 'running',
          // 30m ago — well past the 10m local_cli stale threshold
          started_at: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
        },
      },
    };
  }

  it('AT-LV-007: a long-running turn with a FRESH heartbeat is NOT stale', () => {
    const root = makeTmpDir();
    const turnId = 'turn_lv_fresh';
    writeProgress(root, turnId, new Date(Date.now() - 60 * 1000).toISOString()); // 1m ago — fresh
    const stale = detectStaleTurns(root, runningTurnState(turnId), config);
    assert.equal(stale.length, 0);
    rmSync(root, { recursive: true, force: true });
  });

  it('AT-LV-008: the same turn with a STALE heartbeat IS flagged stale', () => {
    const root = makeTmpDir();
    const turnId = 'turn_lv_stale';
    writeProgress(root, turnId, new Date(Date.now() - 20 * 60 * 1000).toISOString()); // 20m ago — stale
    const stale = detectStaleTurns(root, runningTurnState(turnId), config);
    assert.equal(stale.length, 1);
    assert.equal(stale[0].turn_id, turnId);
    rmSync(root, { recursive: true, force: true });
  });
});

// ── integration: liveness heartbeat fires during output-silent execution ────

describe('liveness heartbeat during an alive-but-output-silent subprocess', () => {
  it('AT-LV-009: fires AFTER first output while the subprocess works silently', async () => {
    const root = makeTmpDir();
    const turnId = 'turn_lv_int_001';
    scaffoldDispatch(root, turnId);

    // Prints one line (first output → clears the startup heartbeat), then stays
    // alive and SILENT for ~300ms (simulating a long quiet operation such as a
    // test suite), then exits. The liveness heartbeat must keep firing.
    const shimPath = writeShim(root, 'agent', `#!/bin/sh
echo "starting work"
sleep 0.3
echo "done"
`);

    const state = {
      run_id: 'run_lv',
      phase: 'implementation',
      active_turns: {
        [turnId]: { turn_id: turnId, assigned_role: 'dev', runtime_id: 'test-rt', attempt: 1 },
      },
    };
    const config = {
      runtimes: {
        'test-rt': { type: 'local_cli', command: [shimPath], prompt_transport: 'dispatch_bundle_only' },
      },
    };

    const beats = [];
    await dispatchLocalCli(root, state, config, {
      turnId,
      startupWatchdogMs: 5000,
      livenessHeartbeatMs: 40,
      onLivenessHeartbeat: (payload) => beats.push(payload),
    });

    assert.ok(beats.length >= 1, `expected >=1 liveness beat during silence, got ${beats.length}`);
    // Beats must occur AFTER first output — proving the liveness heartbeat
    // survives first output (unlike the startup heartbeat). This is the RB-6 fix.
    assert.ok(beats.some((b) => b.first_output_at), 'expected at least one beat after first output');

    rmSync(root, { recursive: true, force: true });
  });

  it('AT-LV-014: heartbeat payload includes all documented fields', async () => {
    const root = makeTmpDir();
    const turnId = 'turn_lv_int_014';
    scaffoldDispatch(root, turnId);

    const shimPath = writeShim(root, 'agent', `#!/bin/sh
echo "hello"
sleep 0.2
`);

    const state = {
      run_id: 'run_lv',
      phase: 'implementation',
      active_turns: {
        [turnId]: { turn_id: turnId, assigned_role: 'dev', runtime_id: 'test-rt', attempt: 1 },
      },
    };
    const config = {
      runtimes: {
        'test-rt': { type: 'local_cli', command: [shimPath], prompt_transport: 'dispatch_bundle_only' },
      },
    };

    const beats = [];
    await dispatchLocalCli(root, state, config, {
      turnId,
      startupWatchdogMs: 5000,
      livenessHeartbeatMs: 30,
      onLivenessHeartbeat: (payload) => beats.push(payload),
    });

    assert.ok(beats.length >= 1, `expected >=1 liveness beat, got ${beats.length}`);
    const beat = beats[0];
    // All 7 documented payload fields must be present
    assert.ok('liveness_heartbeat_ms' in beat, 'missing liveness_heartbeat_ms');
    assert.ok('pid' in beat, 'missing pid');
    assert.ok('spawn_confirmed_at' in beat, 'missing spawn_confirmed_at');
    assert.ok('elapsed_since_spawn_ms' in beat, 'missing elapsed_since_spawn_ms');
    assert.ok('first_output_at' in beat, 'missing first_output_at');
    assert.ok('stdout_bytes' in beat, 'missing stdout_bytes');
    assert.ok('stderr_bytes' in beat, 'missing stderr_bytes');
    assert.equal(beat.liveness_heartbeat_ms, 30);
    assert.equal(typeof beat.elapsed_since_spawn_ms, 'number');

    rmSync(root, { recursive: true, force: true });
  });
});
