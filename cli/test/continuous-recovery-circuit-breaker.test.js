import { describe, it, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { execFileSync } from 'child_process';

import {
  resolveContinuousOptions,
  readContinuousSession,
  executeContinuousRun,
} from '../src/lib/continuous-run.js';

// ---------------------------------------------------------------------------
// RB-13 regression: the recover-and-continue branch of executeContinuousRun
// previously had NO retry cap and NO backoff. A deterministic recurring failure
// (e.g. an unclean baseline) spun the loop ~582x/second forever. The
// circuit-breaker must halt the loop after `maxConsecutiveRecoveries` identical
// recoveries, mark the session 'blocked', emit `continuous_recovery_circuit_open`,
// and RETURN with exitCode 1 instead of hanging.
//
// Scenario (realistic unclean-baseline path, per the RB-13 task):
//   * Real git project with an ACTIVE governed run (status: 'active', run_id).
//   * A queued `planned` intent scoped to that run, so the loop's advance step
//     reaches prepareIntentForDispatch -> startIntent -> assignGovernedTurn.
//   * An untracked, actor-owned `.planning/IMPLEMENTATION_NOTES.md` makes
//     checkCleanBaseline() fail with the SAME reason every iteration, so each
//     advance step returns { status: 'failed', action: 'prepare_failed',
//     stop_reason: <identical> } while the governed run stays active -> the
//     recover-and-continue branch fires identically each loop.
//   * The dispatch never reaches executeGovernedRun (the failure happens during
//     prepare), so the stub asserts if it is ever invoked.
// ---------------------------------------------------------------------------

function createTmpProject() {
  const dir = join(tmpdir(), `axc-cb-test-${randomUUID().slice(0, 8)}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'agentxchain.json'), JSON.stringify({
    schema_version: '1.0',
    protocol_mode: 'governed',
    template: 'generic',
    project: { name: 'continuous-test', id: 'ct-001', default_branch: 'main' },
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
    project_id: 'ct-001',
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

function readTestConfig(dir) {
  return {
    ...JSON.parse(readFileSync(join(dir, 'agentxchain.json'), 'utf8')),
    files: { state: '.agentxchain/state.json' },
  };
}

function readEvents(dir) {
  const path = join(dir, '.agentxchain', 'events.jsonl');
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

// Mirror of continuous-run.test.js initContinuousGitProject(): builds a real
// git temp project with an ACTIVE governed run (run_bug62) + session.json.
function initContinuousGitProject(dir) {
  const git = (args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
  git(['init', '-q']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'user.name', 'Test User']);
  writeFileSync(join(dir, 'product.txt'), 'baseline\n');
  git(['add', 'agentxchain.json', '.agentxchain/state.json', '.agentxchain/history.jsonl', '.agentxchain/decision-ledger.jsonl', 'product.txt']);
  git(['commit', '-q', '-m', 'baseline']);
  const baseline = git(['rev-parse', 'HEAD']);
  writeFileSync(join(dir, '.agentxchain', 'state.json'), JSON.stringify({
    schema_version: '1.0',
    run_id: 'run_bug62',
    project_id: 'ct-001',
    status: 'active',
    phase: 'implementation',
    accepted_integration_ref: `git:${baseline}`,
    active_turns: {},
    turn_sequence: 0,
    last_completed_turn_id: null,
    last_completed_turn: {
      turn_id: 'turn_checkpointed',
      role: 'dev',
      phase: 'implementation',
      checkpoint_sha: baseline,
      checkpointed_at: '2026-04-22T00:00:00Z',
      intent_id: 'intent_bug62',
    },
    blocked_on: null,
    blocked_reason: null,
    escalation: null,
    phase_gate_status: {},
  }, null, 2));
  writeFileSync(join(dir, '.agentxchain', 'session.json'), JSON.stringify({
    session_id: 'session_bug62',
    run_id: 'run_bug62',
    started_at: '2026-04-22T00:00:00Z',
    last_checkpoint_at: '2026-04-22T00:00:00Z',
    checkpoint_reason: 'turn_checkpointed',
    run_status: 'active',
    phase: 'implementation',
    baseline_ref: {
      git_head: baseline,
      git_branch: git(['rev-parse', '--abbrev-ref', 'HEAD']),
      workspace_dirty: false,
    },
  }, null, 2));
  return { baseline, git };
}

// Write a planned intent + its source event, scoped to the active run so the
// continuous loop's findNextDispatchableIntent() picks it up and routes it
// through prepareIntentForDispatch -> startIntent -> assignGovernedTurn.
function writePlannedIntentForRun(dir, runId, { intentId = 'intent_cb_001', eventId = 'evt_cb_0001' } = {}) {
  const intakeBase = join(dir, '.agentxchain', 'intake');
  const eventsDir = join(intakeBase, 'events');
  const intentsDir = join(intakeBase, 'intents');
  mkdirSync(eventsDir, { recursive: true });
  mkdirSync(intentsDir, { recursive: true });

  const now = new Date().toISOString();
  writeFileSync(join(eventsDir, `${eventId}.json`), JSON.stringify({
    schema_version: '1.0',
    event_id: eventId,
    source: 'operator',
    category: 'feature_request',
    signal: { description: 'circuit-breaker regression intent' },
    created_at: now,
  }, null, 2));

  writeFileSync(join(intentsDir, `${intentId}.json`), JSON.stringify({
    schema_version: '1.0',
    intent_id: intentId,
    event_id: eventId,
    status: 'planned',
    priority: 'p2',
    template: 'generic',
    charter: 'Deliver the circuit-breaker regression objective.',
    acceptance_contract: ['Deliver the circuit-breaker regression objective.'],
    // Empty planning_artifacts so startIntent's artifact-existence guard passes
    // and execution proceeds to assignGovernedTurn (where the baseline fails).
    planning_artifacts: [],
    approved_run_id: runId,
    approved_at: now,
    planned_at: now,
    created_at: now,
    updated_at: now,
    history: [],
  }, null, 2));

  return { intentId, eventId };
}

describe('RB-13 continuous-loop recovery circuit-breaker', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTmpProject();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('halts (does not spin) and blocks when the same recoverable failure recurs', async () => {
    initContinuousGitProject(tmpDir);

    // VISION.md must exist for executeContinuousRun to proceed.
    const planDir = join(tmpDir, '.planning');
    mkdirSync(planDir, { recursive: true });
    writeFileSync(join(planDir, 'VISION.md'), '# Vision\n\n## Goal\nShip circuit-breaker.\n', 'utf8');

    // Queue a planned intent bound to the active run.
    writePlannedIntentForRun(tmpDir, 'run_bug62');

    // UNCLEAN BASELINE: an untracked, actor-owned planning file. This is NOT
    // baseline-exempt, so checkCleanBaseline() fails identically each loop and
    // assignGovernedTurn refuses the authoritative dev turn deterministically.
    writeFileSync(join(planDir, 'IMPLEMENTATION_NOTES.md'), 'uncommitted actor notes\n', 'utf8');

    const context = { root: tmpDir, config: readTestConfig(tmpDir) };
    const maxConsecutiveRecoveries = 2;
    const contOpts = {
      ...resolveContinuousOptions({ continuous: true }, context.config),
      visionPath: '.planning/VISION.md',
      // continueFrom must stay unset so the loop binds to the existing active run.
      maxConsecutiveRecoveries,
      cooldownSeconds: 0, // keep backoff at the 1000ms floor -> test stays ~1-2s.
    };

    // The failure happens during prepare (before dispatch), so the governed run
    // must never actually execute. If it does, the scenario is wrong.
    const executeGovernedRun = async () => {
      assert.fail('executeGovernedRun must not run — the loop fails at prepareIntentForDispatch');
    };

    // (1) Must RETURN (not hang) with exitCode 1. A generous timeout guards
    // against regression: with no breaker this promise never resolves.
    const runPromise = executeContinuousRun(context, contOpts, executeGovernedRun, () => {});
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('executeContinuousRun did not return — circuit-breaker missing (loop is spinning)')), 15000));
    const result = await Promise.race([runPromise, timeout]);

    assert.equal(result.exitCode, 1, 'circuit-breaker should return exitCode 1');
    assert.ok(result.session, 'a session should be returned');

    // (2) The circuit-open run event must be written.
    const events = readEvents(tmpDir);
    const circuitOpen = events.filter((e) => e.event_type === 'continuous_recovery_circuit_open');
    assert.equal(circuitOpen.length, 1, 'exactly one continuous_recovery_circuit_open event expected');
    assert.equal(circuitOpen[0].payload.failed_action, 'prepare_failed');
    assert.equal(circuitOpen[0].payload.consecutive_recoveries, maxConsecutiveRecoveries);

    // (3) Final session status is 'blocked' (in the returned session and on disk).
    assert.equal(result.session.status, 'blocked', 'returned session should be blocked');
    const savedSession = readContinuousSession(tmpDir);
    assert.equal(savedSession.status, 'blocked', 'persisted continuous session should be blocked');

    // (4) Recovery count is BOUNDED, not hundreds. The breaker trips on the
    // Nth identical recovery, so only (maxConsecutiveRecoveries - 1) recoveries
    // are recorded before it opens the circuit.
    const recovered = events.filter((e) => e.event_type === 'session_failed_recovered_active_run');
    assert.equal(
      recovered.length,
      maxConsecutiveRecoveries - 1,
      `recovery count must be bounded (~${maxConsecutiveRecoveries - 1}), not hundreds`,
    );
    assert.ok(recovered.length < 10, 'sanity: recovery count must never reach the runaway-spin range');
  }, 20000);
});
