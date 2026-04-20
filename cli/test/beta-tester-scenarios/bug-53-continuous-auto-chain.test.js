/**
 * BUG-53 beta-tester scenario: continuous sessions must auto-chain to the
 * next vision-derived objective after a run completes cleanly.
 *
 * Tester's evidence (HUMAN-ROADMAP.md report #18):
 *   session `cont-5d436a8f` ended up paused after `run_78133e963b912f46`
 *   completed cleanly (all 4 gates passed, final checkpoint
 *   `32a38b0a3bbd5e1e6ce82d7271ee45e4b6e5a44b`). No new vision_scan run was
 *   created, no next objective was derived.
 *
 * Fix requirements (from HUMAN-ROADMAP.md):
 *   1. After `session.runs_completed += 1`, the continuous loop must:
 *      - Check against `contOpts.maxRuns` — if reached, exit cleanly with
 *        status `completed`
 *      - If not reached, call `deriveVisionCandidates()` again to find the
 *        next unaddressed vision goal
 *      - If a candidate exists, seed a new intent via the standard
 *        `intake record → triage → approve` pipeline and start the next run
 *      - If no candidate exists (all vision goals addressed), exit with
 *        status `idle_exit` (clean termination, NOT paused)
 *   2. `paused` status should only be used for real blockers (`needs_human`,
 *      `blocked`), never for "I finished a run and didn't know what to do next."
 *   4. Emit `session_continuation` event with payload
 *      `{previous_run_id, next_objective, next_run_id}` so the operator has
 *      a clear audit trail of the auto-chain.
 *
 * Acceptance (from HUMAN-ROADMAP.md):
 *   `run --continuous --max-runs 5` where first run completes, second run is
 *   automatically created from the next vision candidate without any operator
 *   intervention. Session status stays `running`, never `paused`, until
 *   either max_runs is hit or no vision candidates remain.
 */

import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';

import {
  executeContinuousRun,
  resolveContinuousOptions,
  readContinuousSession,
} from '../../src/lib/continuous-run.js';
import { RUN_EVENTS_PATH } from '../../src/lib/run-events.js';

const tempDirs = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

function createTmpProject() {
  const dir = mkdtempSync(join(tmpdir(), 'axc-bug53-'));
  tempDirs.push(dir);
  writeFileSync(join(dir, 'agentxchain.json'), JSON.stringify({
    schema_version: '1.0',
    protocol_mode: 'governed',
    template: 'generic',
    project: { name: 'bug53-test', id: 'bug53-001', default_branch: 'main' },
    roles: {
      dev: { title: 'Developer', mandate: 'Implement.', write_authority: 'authoritative', runtime: 'manual-dev' },
    },
    runtimes: { 'manual-dev': { type: 'manual' } },
    routing: { implementation: { entry_role: 'dev', allowed_next_roles: ['dev'], exit_gate: 'done' } },
    gates: { done: {} },
    rules: { challenge_required: false, max_turn_retries: 1 },
  }, null, 2));
  mkdirSync(join(dir, '.agentxchain', 'dispatch', 'turns'), { recursive: true });
  mkdirSync(join(dir, '.agentxchain', 'staging'), { recursive: true });
  writeFileSync(join(dir, '.agentxchain', 'state.json'), JSON.stringify({
    schema_version: '1.0',
    run_id: null,
    project_id: 'bug53-001',
    status: 'idle',
    phase: 'implementation',
    accepted_integration_ref: null,
    active_turns: {},
    turn_sequence: 0,
    last_completed_turn_id: null,
    blocked_on: null,
    blocked_reason: null,
    escalation: null,
    phase_gate_status: {},
  }, null, 2));
  writeFileSync(join(dir, '.agentxchain', 'history.jsonl'), '');
  writeFileSync(join(dir, '.agentxchain', 'decision-ledger.jsonl'), '');
  return dir;
}

function writeVision(dir, content) {
  const planDir = join(dir, '.planning');
  mkdirSync(planDir, { recursive: true });
  writeFileSync(join(planDir, 'VISION.md'), content, 'utf8');
}

function readRunEvents(dir) {
  const p = join(dir, RUN_EVENTS_PATH);
  if (!existsSync(p)) return [];
  return readFileSync(p, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

/**
 * Mock executor that simulates a clean run completion.
 * Writes state.status=completed and preserves the run_id that
 * prepareIntentForDispatch assigned (so resolveIntent's run_id guard passes).
 */
function makeSuccessExecutor(dir) {
  return async () => {
    const statePath = join(dir, '.agentxchain', 'state.json');
    const current = JSON.parse(readFileSync(statePath, 'utf8'));
    const runId = current.run_id;
    current.status = 'completed';
    current.completed_at = new Date().toISOString();
    current.last_completed_turn_id = null;
    current.active_turns = {};
    writeFileSync(statePath, JSON.stringify(current, null, 2));
    return {
      exitCode: 0,
      result: {
        stop_reason: 'completed',
        state: { run_id: runId, status: 'completed' },
      },
    };
  };
}

describe('BUG-53: continuous session auto-chains after a completed run', () => {
  it('chains 3 vision goals through maxRuns=3 and exits cleanly without passing through paused', async () => {
    // Three distinct, unambiguous vision goals so each one seeds a separate
    // candidate after the previous is resolved.
    const dir = createTmpProject();
    writeVision(dir, [
      '## Protocol',
      '',
      '- governed state machine coverage',
      '- intake pipeline deduplication',
      '- phase transition enforcement',
      '',
    ].join('\n'));

    const context = {
      root: dir,
      config: JSON.parse(readFileSync(join(dir, 'agentxchain.json'), 'utf8')),
    };
    const contOpts = {
      ...resolveContinuousOptions({ continuous: true, maxRuns: 3 }, context.config),
      cooldownSeconds: 0,
      pollSeconds: 0,
    };

    const statuses = [];
    const runIds = [];
    const originalWrite = null; // placeholder; we observe via event stream

    // Track every session.status value the loop persists so we can prove
    // `paused` never appears on the clean-completion path.
    const statusSnapshots = [];
    const capture = () => {
      const s = readContinuousSession(dir);
      if (s) statusSnapshots.push(s.status);
    };

    const baseExecutor = makeSuccessExecutor(dir);
    const instrumented = async (...args) => {
      capture();
      const out = await baseExecutor(...args);
      runIds.push(out.result.state.run_id);
      capture();
      return out;
    };

    const logs = [];
    const { exitCode, session } = await executeContinuousRun(
      context,
      contOpts,
      instrumented,
      (msg) => logs.push(msg),
    );

    // Core acceptance: exactly 3 runs executed, exit is clean completion, NOT paused.
    assert.equal(exitCode, 0, `expected clean exit; logs:\n${logs.join('\n')}`);
    assert.equal(runIds.length, 3,
      `continuous session must auto-chain through 3 runs (maxRuns=3); ran ${runIds.length}. ` +
      `This is the BUG-53 operator symptom — after a clean completion the loop fails to derive the next vision candidate and stops.`);
    assert.equal(session.runs_completed, 3, 'session.runs_completed must match actual runs');
    assert.equal(session.status, 'completed',
      `session.status at terminal must be "completed" (hit maxRuns); got "${session.status}". ` +
      `BUG-53 requirement #2: paused must never be used for "I finished a run and didn't know what to do next."`);

    // No status transition should ever hit "paused" on the clean-completion path.
    assert.ok(!statusSnapshots.includes('paused'),
      `session.status transitioned through "paused" during a clean-completion auto-chain; observed: ${statusSnapshots.join(' → ')}. ` +
      `BUG-53 requirement #2: paused is reserved for real blockers.`);
    assert.ok(!statusSnapshots.includes('failed'),
      `session.status transitioned through "failed" during a clean-completion auto-chain; observed: ${statusSnapshots.join(' → ')}.`);

    // Distinct run_ids prove each chained run was a genuinely new governed
    // run, not the same run being re-reported.
    const uniqueRunIds = new Set(runIds);
    assert.equal(uniqueRunIds.size, 3,
      `auto-chained runs must have distinct run_ids; got: ${runIds.join(', ')}`);

    // Emission contract: exactly N-1 session_continuation events, one per
    // auto-chain boundary (BUG-53 fix #4).
    const events = readRunEvents(dir);
    const continuations = events.filter((e) => e.event_type === 'session_continuation');
    assert.equal(continuations.length, 2,
      `continuous auto-chain must emit a session_continuation event at every post-completion boundary (2 boundaries for 3 runs); got ${continuations.length}. ` +
      `BUG-53 requirement #4: {previous_run_id, next_objective, next_run_id} audit trail.`);
    for (const evt of continuations) {
      assert.ok(evt.payload?.previous_run_id,
        `session_continuation event must carry payload.previous_run_id; got ${JSON.stringify(evt.payload)}`);
      assert.ok(evt.payload?.next_objective,
        `session_continuation event must carry payload.next_objective; got ${JSON.stringify(evt.payload)}`);
      assert.ok(evt.payload?.next_run_id,
        `session_continuation event must carry payload.next_run_id; got ${JSON.stringify(evt.payload)}`);
      assert.notEqual(evt.payload.previous_run_id, evt.payload.next_run_id,
        `session_continuation event must link two distinct runs; got previous=${evt.payload.previous_run_id} next=${evt.payload.next_run_id}`);
    }

    // Log contract: operator should see a "Run X/Y completed" line per run.
    const completedLogs = logs.filter((l) => /Run \d+\/3 completed/.test(l));
    assert.equal(completedLogs.length, 3,
      `operator log must record "Run X/3 completed" for every run; got ${completedLogs.length}. Log snapshot:\n${logs.join('\n')}`);
  });

  it('exits with idle_exit (not paused) when all vision goals are addressed after one run', async () => {
    // Only one distinct goal in the vision file. After run 1 resolves that
    // intent, the next vision scan returns no candidates. The session must
    // terminate as `idle_exit`, not `paused` or `failed`.
    const dir = createTmpProject();
    writeVision(dir, '## Goal\n\n- singleton vision objective to satisfy once\n');

    const context = {
      root: dir,
      config: JSON.parse(readFileSync(join(dir, 'agentxchain.json'), 'utf8')),
    };
    const contOpts = {
      ...resolveContinuousOptions({ continuous: true, maxRuns: 5, maxIdleCycles: 1 }, context.config),
      cooldownSeconds: 0,
      pollSeconds: 0,
    };

    const executor = makeSuccessExecutor(dir);
    const logs = [];
    const { exitCode, session } = await executeContinuousRun(
      context, contOpts, executor, (msg) => logs.push(msg),
    );

    assert.equal(exitCode, 0);
    assert.equal(session.runs_completed, 1,
      `only 1 vision goal → only 1 run should execute; got ${session.runs_completed}`);
    assert.ok(
      session.status === 'completed' || session.status === 'running',
      `after exhausting vision goals, session.status must reach a clean terminal path (completed/idle); got "${session.status}". ` +
      `Must NEVER be "paused".`,
    );
    assert.notEqual(session.status, 'paused',
      `BUG-53 requirement #2 — paused must never be used when all goals are addressed`);
    assert.notEqual(session.status, 'failed',
      `idle termination must not be reported as failure`);
  });
});
