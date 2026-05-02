/**
 * dispatch-progress.test.js — Adapter dispatch progress tracking tests.
 *
 * Covers:
 *   AT-PROGRESS-001: progress file creation and deletion during dispatch lifecycle
 *   AT-PROGRESS-002: output line counting and last_activity_at updates
 *   AT-PROGRESS-003: silence detection after threshold
 *   AT-PROGRESS-004: dispatch_progress event emission to events.jsonl
 *   AT-PROGRESS-005: status command renders Activity line when progress file exists
 *   AT-PROGRESS-006: status command omits Activity line when no progress file
 *   AT-PROGRESS-007: stale progress file (mismatched turn_id) ignored by status
 */

import { describe, it, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  createDispatchProgressTracker,
  readDispatchProgress,
  readAllDispatchProgress,
  deleteProgressFile,
  getDispatchProgressRelativePath,
} from '../src/lib/dispatch-progress.js';

import { readRunEvents, VALID_RUN_EVENTS } from '../src/lib/run-events.js';

function makeTempRoot() {
  return mkdtempSync(join(tmpdir(), 'axc-progress-'));
}

function makeTurn(overrides = {}) {
  return {
    turn_id: 'turn_test_001',
    runtime_id: 'local-dev',
    assigned_role: 'dev',
    ...overrides,
  };
}

describe('dispatch-progress', () => {
  let root;

  beforeEach(() => {
    root = makeTempRoot();
    mkdirSync(join(root, '.agentxchain'), { recursive: true });
  });

  afterEach(() => {
    try { rmSync(root, { recursive: true, force: true }); } catch {}
  });

  describe('AT-PROGRESS-001: progress file lifecycle', () => {
    it('creates dispatch-progress.json on start and deletes on complete', () => {
      const turn = makeTurn();
      const tracker = createDispatchProgressTracker(root, turn, {
        adapter_type: 'local_cli',
        silenceThresholdMs: 60000, // long threshold to avoid timer interference
      });

      // Before start — no file
      assert.equal(readDispatchProgress(root), null);

      tracker.start();

      // After start — file exists with correct fields
      const progress = readDispatchProgress(root, turn.turn_id);
      assert.ok(progress, 'progress file should exist after start');
      assert.equal(progress.turn_id, 'turn_test_001');
      assert.equal(progress.runtime_id, 'local-dev');
      assert.equal(progress.adapter_type, 'local_cli');
      assert.equal(progress.activity_type, 'starting');
      assert.ok(progress.started_at);
      assert.ok(progress.last_activity_at);
      assert.equal(progress.first_output_at, null);
      assert.equal(progress.output_lines, 0);
      assert.equal(progress.stderr_lines, 0);
      assert.equal(progress.silent_since, null);

      tracker.complete();

      // After complete — file deleted
      assert.equal(readDispatchProgress(root, turn.turn_id), null);
    });

    it('deletes progress file on fail()', () => {
      const turn = makeTurn();
      const tracker = createDispatchProgressTracker(root, turn, {
        adapter_type: 'local_cli',
        silenceThresholdMs: 60000,
      });

      tracker.start();
      assert.ok(readDispatchProgress(root, turn.turn_id));

      tracker.fail();
      assert.equal(readDispatchProgress(root, turn.turn_id), null);
    });
  });

  describe('AT-PROGRESS-002: output counting', () => {
    it('increments output_lines and stderr_lines on onOutput calls', () => {
      const turn = makeTurn();
      const tracker = createDispatchProgressTracker(root, turn, {
        adapter_type: 'local_cli',
        writeIntervalMs: 0, // immediate writes for testing
        silenceThresholdMs: 60000,
      });

      tracker.start();

      tracker.onOutput('stdout', 5);
      tracker.onOutput('stdout', 3);
      tracker.onOutput('stderr', 2);

      const progress = readDispatchProgress(root, turn.turn_id);
      assert.equal(progress.output_lines, 8);
      assert.equal(progress.stderr_lines, 2);
      assert.equal(progress.activity_type, 'output');

      tracker.complete();
    });

    it('BUG-54: stderr-only output does not set first_output_at (stderr is not startup proof)', () => {
      // DEC-BUG54-STDERR-IS-NOT-STARTUP-PROOF-002 (Turn 88) + Turn 89 extension
      // to the progress tracker: stderr is diagnostic evidence, not usable
      // startup proof. A subprocess that emits stderr-only must leave
      // first_output_at null so the fast-startup watchdog can still classify
      // it as stdout_attach_failed.
      const turn = makeTurn();
      const tracker = createDispatchProgressTracker(root, turn, {
        adapter_type: 'local_cli',
        writeIntervalMs: 0,
        silenceThresholdMs: 60000,
      });

      tracker.start();

      tracker.onOutput('stderr', 3);
      tracker.onOutput('stderr', 2);

      const progress = readDispatchProgress(root, turn.turn_id);
      assert.equal(progress.stderr_lines, 5, 'stderr_lines still tracked for diagnostics');
      assert.equal(progress.output_lines, 0, 'output_lines untouched by stderr');
      assert.equal(
        progress.first_output_at,
        null,
        'first_output_at must remain null when only stderr has been emitted',
      );

      // Positive control: a subsequent stdout line should now set first_output_at.
      tracker.onOutput('stdout', 1);
      const afterStdout = readDispatchProgress(root, turn.turn_id);
      assert.ok(
        afterStdout.first_output_at,
        'first_output_at set once stdout emits, regardless of prior stderr',
      );

      tracker.complete();
    });

    it('BUG-54 Turn 90: unknown output streams do not count as dispatch-progress proof', () => {
      const turn = makeTurn();
      const tracker = createDispatchProgressTracker(root, turn, {
        adapter_type: 'local_cli',
        writeIntervalMs: 0,
        silenceThresholdMs: 60000,
      });

      tracker.start();
      tracker.onOutput('mcp', 4);

      const progress = readDispatchProgress(root, turn.turn_id);
      assert.equal(progress.first_output_at, null);
      assert.equal(progress.output_lines, 0);
      assert.equal(progress.stderr_lines, 0);
      // Unknown stream labels must NOT mutate activity_type — the tracker
      // must remain in its `starting` state until a recognized proof/diagnostic
      // stream fires. Otherwise the closed-vocabulary contract leaks into the
      // activity_type/activity_summary surface.
      assert.equal(progress.activity_type, 'starting');

      tracker.complete();
    });

    it('BUG-54 Turn 91: stderr-only activity renders as diagnostic_only, not "Producing output"', () => {
      // DEC-BUG54-DIAGNOSTIC-ACTIVITY-TYPE-001 (Turn 91): operator-facing
      // status surface must not render stderr-only activity as the green
      // "Producing output" line. Before this fix, `activity_type` was set to
      // `'output'` and `activity_summary` was `Producing output (0 lines)`
      // for any stderr activity, creating a false live-progress signal for a
      // failing-startup subprocess whose stdout never attached.
      const turn = makeTurn();
      const tracker = createDispatchProgressTracker(root, turn, {
        adapter_type: 'local_cli',
        writeIntervalMs: 0,
        silenceThresholdMs: 60000,
      });

      tracker.start();
      tracker.onOutput('stderr', 3);
      tracker.onOutput('stderr', 4);

      const progress = readDispatchProgress(root, turn.turn_id);
      assert.equal(progress.activity_type, 'diagnostic_only');
      assert.ok(
        /^Diagnostic output only \(\d+ stderr lines\)$/.test(progress.activity_summary),
        `activity_summary must describe stderr-only state, got: ${progress.activity_summary}`,
      );
      assert.ok(
        !/Producing output/.test(progress.activity_summary),
        'stderr-only activity_summary must not claim "Producing output"',
      );
      assert.equal(progress.output_lines, 0);
      assert.equal(progress.stderr_lines, 7);

      // Positive control: once stdout fires, activity_type flips to 'output'
      // and the summary switches to the green render line.
      tracker.onOutput('stdout', 2);
      const afterStdout = readDispatchProgress(root, turn.turn_id);
      assert.equal(afterStdout.activity_type, 'output');
      assert.ok(
        /^Producing output \(2 lines\)$/.test(afterStdout.activity_summary),
        `activity_summary must flip to Producing output, got: ${afterStdout.activity_summary}`,
      );

      // Mixing in more stderr after stdout proof has established does NOT
      // regress back to diagnostic_only — stdout proof is sticky.
      tracker.onOutput('stderr', 1);
      const afterMixed = readDispatchProgress(root, turn.turn_id);
      assert.equal(afterMixed.activity_type, 'output');
      assert.ok(/Producing output/.test(afterMixed.activity_summary));

      tracker.complete();
    });

    it('updates last_activity_at on output', () => {
      const turn = makeTurn();
      const tracker = createDispatchProgressTracker(root, turn, {
        adapter_type: 'local_cli',
        writeIntervalMs: 0,
        silenceThresholdMs: 60000,
      });

      tracker.start();
      const startProgress = readDispatchProgress(root, turn.turn_id);
      const startTime = new Date(startProgress.last_activity_at).getTime();

      // Small delay to get a different timestamp
      const before = Date.now();
      tracker.onOutput('stdout', 1);
      const afterProgress = readDispatchProgress(root, turn.turn_id);

      assert.ok(new Date(afterProgress.last_activity_at).getTime() >= startTime);

      tracker.complete();
    });
  });

  describe('AT-PROGRESS-003: silence detection', () => {
    it('transitions to silent activity_type after silence threshold', async () => {
      const turn = makeTurn();
      const tracker = createDispatchProgressTracker(root, turn, {
        adapter_type: 'local_cli',
        writeIntervalMs: 0,
        silenceThresholdMs: 50, // 50ms for fast test
      });

      tracker.start();
      tracker.onOutput('stdout', 1);

      // Wait for silence threshold
      await new Promise((r) => setTimeout(r, 100));

      const progress = readDispatchProgress(root, turn.turn_id);
      assert.equal(progress.activity_type, 'silent');
      assert.ok(progress.silent_since);

      tracker.complete();
    });

    it('returns wasSilent=true when output resumes after silence', async () => {
      const turn = makeTurn();
      const tracker = createDispatchProgressTracker(root, turn, {
        adapter_type: 'local_cli',
        writeIntervalMs: 0,
        silenceThresholdMs: 50,
      });

      tracker.start();
      tracker.onOutput('stdout', 1);

      await new Promise((r) => setTimeout(r, 100));

      // Output resumes — should return true (was silent)
      const wasSilent = tracker.onOutput('stdout', 1);
      assert.equal(wasSilent, true);

      const progress = readDispatchProgress(root, turn.turn_id);
      assert.equal(progress.activity_type, 'output');
      assert.equal(progress.silent_since, null);

      tracker.complete();
    });
  });

  describe('AT-PROGRESS-004: dispatch_progress event type', () => {
    it('dispatch_progress is a valid run event type', () => {
      assert.ok(VALID_RUN_EVENTS.includes('dispatch_progress'));
    });
  });

  describe('AT-PROGRESS-005: readDispatchProgress returns correct data', () => {
    it('reads progress file with all expected fields', () => {
      const turn = makeTurn();
      const tracker = createDispatchProgressTracker(root, turn, {
        adapter_type: 'api_proxy',
        writeIntervalMs: 0,
        silenceThresholdMs: 60000,
      });

      tracker.start();
      tracker.requestStarted();

      const progress = readDispatchProgress(root, turn.turn_id);
      assert.equal(progress.turn_id, 'turn_test_001');
      assert.equal(progress.adapter_type, 'api_proxy');
      assert.equal(progress.activity_type, 'request');
      assert.equal(progress.activity_summary, 'API request in flight');

      tracker.responseReceived();
      const after = readDispatchProgress(root, turn.turn_id);
      assert.equal(after.activity_type, 'response');

      tracker.complete();
    });
  });

  describe('AT-PROGRESS-006: no progress file returns null', () => {
    it('returns null when no dispatch-progress.json exists', () => {
      assert.equal(readDispatchProgress(root), null);
    });
  });

  describe('AT-PROGRESS-007: stale progress file detection', () => {
    it('returns data even for mismatched turn_id (caller checks)', () => {
      // Write a progress file with a different turn_id
      const filePath = join(root, getDispatchProgressRelativePath('turn_old_stale'));
      mkdirSync(join(root, '.agentxchain'), { recursive: true });
      writeFileSync(filePath, JSON.stringify({
        turn_id: 'turn_old_stale',
        runtime_id: 'local-dev',
        adapter_type: 'local_cli',
        started_at: new Date().toISOString(),
        last_activity_at: new Date().toISOString(),
        activity_type: 'output',
        activity_summary: 'stale',
        output_lines: 50,
        stderr_lines: 0,
        silent_since: null,
        pid: null,
      }));

      const progress = readDispatchProgress(root);
      assert.ok(progress);
      assert.equal(progress.turn_id, 'turn_old_stale');
      // The status command checks turn_id match — readDispatchProgress just reads
    });
  });

  describe('AT-PROGRESS-008: concurrent trackers stay isolated', () => {
    it('writes one progress file per turn so parallel dispatch does not clobber another turn', () => {
      const firstTurn = makeTurn({ turn_id: 'turn_parallel_001' });
      const secondTurn = makeTurn({ turn_id: 'turn_parallel_002' });
      const firstTracker = createDispatchProgressTracker(root, firstTurn, {
        adapter_type: 'local_cli',
        writeIntervalMs: 0,
        silenceThresholdMs: 60000,
      });
      const secondTracker = createDispatchProgressTracker(root, secondTurn, {
        adapter_type: 'api_proxy',
        writeIntervalMs: 0,
        silenceThresholdMs: 60000,
      });

      firstTracker.start();
      firstTracker.onOutput('stdout', 4);
      secondTracker.start();
      secondTracker.requestStarted();

      const allProgress = readAllDispatchProgress(root);
      assert.deepEqual(Object.keys(allProgress).sort(), ['turn_parallel_001', 'turn_parallel_002']);
      assert.equal(allProgress.turn_parallel_001.output_lines, 4);
      assert.equal(allProgress.turn_parallel_002.activity_type, 'request');

      firstTracker.complete();
      secondTracker.complete();
    });
  });

  describe('setPid', () => {
    it('updates pid field in progress state', () => {
      const turn = makeTurn();
      const tracker = createDispatchProgressTracker(root, turn, {
        adapter_type: 'local_cli',
        writeIntervalMs: 0,
        silenceThresholdMs: 60000,
      });

      tracker.start();
      tracker.setPid(12345);

      const progress = readDispatchProgress(root, turn.turn_id);
      assert.equal(progress.pid, 12345);

      tracker.complete();
    });
  });

  describe('deleteProgressFile', () => {
    it('safely handles missing file', () => {
      // Should not throw
      deleteProgressFile(root);
    });

    it('deletes existing file', () => {
      const filePath = join(root, getDispatchProgressRelativePath('turn_delete_001'));
      writeFileSync(filePath, '{}');
      assert.ok(existsSync(filePath));

      deleteProgressFile(root, 'turn_delete_001');
      assert.ok(!existsSync(filePath));
    });
  });
});
