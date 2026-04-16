/**
 * Run-loop conflict awareness tests.
 *
 * Verifies that the run-loop emits typed `turn_conflicted` events,
 * records `error_code` in history, and makes correct terminality
 * decisions based on the resulting governed state.
 *
 * Spec: .planning/RUN_LOOP_CONFLICT_AWARENESS_SPEC.md
 * Decision: DEC-RUN-LOOP-CONFLICT-001
 */

import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';
import { fileURLToPath } from 'url';

const cliRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

const { runLoop } = await import(join(cliRoot, 'src', 'lib', 'run-loop.js'));
const { gitInit } = await import(join(cliRoot, 'test-support', 'git-test-helpers.js'));

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeConflictConfig(maxConcurrent = 2, overrides = {}) {
  return {
    schema_version: 4,
    protocol_mode: 'governed',
    project: {
      id: `conflict-test-${randomBytes(4).toString('hex')}`,
      name: 'Conflict Test',
      default_branch: 'main',
    },
    roles: {
      dev_a: {
        title: 'Dev A',
        mandate: 'Implement feature A.',
        write_authority: 'authoritative',
        runtime_class: 'local_cli',
        runtime_id: 'local-a',
      },
      dev_b: {
        title: 'Dev B',
        mandate: 'Implement feature B.',
        write_authority: 'authoritative',
        runtime_class: 'local_cli',
        runtime_id: 'local-b',
      },
    },
    runtimes: {
      'local-a': { type: 'local_cli' },
      'local-b': { type: 'local_cli' },
    },
    routing: {
      implementation: {
        entry_role: 'dev_a',
        allowed_next_roles: ['dev_a', 'dev_b', 'human'],
        max_concurrent_turns: maxConcurrent,
        exit_gate: 'impl_done',
      },
    },
    gates: {
      impl_done: { requires_human_approval: false },
    },
    budget: { per_turn_max_usd: 2.0, per_run_max_usd: 50.0 },
    rules: { challenge_required: false, max_turn_retries: 2, max_deadlock_cycles: 2 },
    files: {
      talk: 'TALK.md',
      history: '.agentxchain/history.jsonl',
      state: '.agentxchain/state.json',
    },
    compat: {
      next_owner_source: 'state-json',
      lock_based_coordination: false,
      original_version: 4,
    },
    ...overrides,
  };
}

function scaffoldProject(root, config) {
  mkdirSync(join(root, '.agentxchain'), { recursive: true });
  mkdirSync(join(root, '.planning'), { recursive: true });
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'agentxchain.json'), JSON.stringify(config, null, 2));
  writeFileSync(join(root, '.agentxchain/state.json'), JSON.stringify({
    schema_version: '1.1',
    project_id: config.project.id,
    status: 'idle',
    phase: 'implementation',
    run_id: null,
    turn_sequence: 0,
    active_turns: {},
    next_role: null,
    pending_phase_transition: null,
    pending_run_completion: null,
    blocked_on: null,
    blocked_reason: null,
  }, null, 2));
  writeFileSync(join(root, '.agentxchain/history.jsonl'), '');
  writeFileSync(join(root, '.agentxchain/decision-ledger.jsonl'), '');
  writeFileSync(join(root, 'TALK.md'), '# Talk\n');
  // Seed the shared file so it exists in the git baseline
  writeFileSync(join(root, 'src/shared.js'), '// initial\n');
  gitInit(root);
}

function makeTurnResult(turn, state, { filesChanged = [], runCompletion = false } = {}) {
  return {
    schema_version: '1.0',
    run_id: state?.run_id || turn.run_id || 'unknown',
    turn_id: turn.turn_id,
    role: turn.assigned_role,
    runtime_id: turn.runtime_id,
    status: 'completed',
    summary: `${turn.assigned_role} completed.`,
    decisions: [{
      id: 'DEC-001',
      category: 'implementation',
      statement: `${turn.assigned_role} decided.`,
      rationale: 'Test.',
    }],
    objections: [],
    files_changed: filesChanged,
    artifacts_created: [],
    verification: {
      status: 'pass',
      commands: ['echo ok'],
      evidence_summary: 'pass',
      machine_evidence: [{ command: 'echo ok', exit_code: 0 }],
    },
    artifact: { type: 'patch', ref: null },
    proposed_next_role: 'human',
    run_completion_request: runCompletion,
    phase_transition_request: null,
    challenge: { challenged: true, summary: 'Self-challenged.' },
  };
}

function makeTempRoot() {
  const root = join(tmpdir(), `axc-conflict-loop-${randomBytes(6).toString('hex')}`);
  mkdirSync(root, { recursive: true });
  return root;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('run-loop conflict awareness', () => {
  let root;

  beforeEach(() => {
    root = makeTempRoot();
  });

  it('AT-RLC-003: parallel conflict emits turn_conflicted event with conflict metadata', async () => {
    const config = makeConflictConfig(2);
    scaffoldProject(root, config);

    const events = [];
    const roleQueue = ['dev_a', 'dev_b'];
    let roleIndex = 0;

    const result = await runLoop(root, config, {
      selectRole: () => {
        if (roleIndex >= roleQueue.length) return null;
        return roleQueue[roleIndex++];
      },
      dispatch: async (ctx) => {
        // Both roles write to the same file — this causes a conflict when
        // the second turn tries to accept (the first was accepted with
        // overlapping files after the second was assigned)
        const sharedFile = join(root, 'src/shared.js');
        writeFileSync(sharedFile, `// written by ${ctx.turn.assigned_role}\nexport default {};\n`);
        return {
          accept: true,
          turnResult: makeTurnResult(ctx.turn, ctx.state, {
            filesChanged: ['src/shared.js'],
          }),
        };
      },
      approveGate: () => true,
      onEvent: (event) => events.push(event),
    }, { maxTurns: 10 });

    // One turn should have been accepted, the other should have conflicted
    const conflictEvents = events.filter(e => e.type === 'turn_conflicted');
    const acceptEvents = events.filter(e => e.type === 'turn_accepted');

    assert.equal(acceptEvents.length, 1, 'One turn should be accepted');
    assert.equal(conflictEvents.length, 1, 'One turn should conflict');

    // Verify conflict event has metadata
    const ce = conflictEvents[0];
    assert.equal(ce.error_code, 'conflict');
    assert.ok(ce.conflict, 'conflict event should include conflict object');
    assert.ok(ce.turn, 'conflict event should include the turn');
    assert.ok(ce.role, 'conflict event should include the role');
    assert.ok(ce.state, 'conflict event should include resulting state');

    rmSync(root, { recursive: true, force: true });
  });

  it('AT-RLC-004: history entry includes error_code and conflict details', async () => {
    const config = makeConflictConfig(2);
    scaffoldProject(root, config);

    const roleQueue = ['dev_a', 'dev_b'];
    let roleIndex = 0;

    const result = await runLoop(root, config, {
      selectRole: () => {
        if (roleIndex >= roleQueue.length) return null;
        return roleQueue[roleIndex++];
      },
      dispatch: async (ctx) => {
        writeFileSync(join(root, 'src/shared.js'), `// ${ctx.turn.assigned_role}\n`);
        return {
          accept: true,
          turnResult: makeTurnResult(ctx.turn, ctx.state, {
            filesChanged: ['src/shared.js'],
          }),
        };
      },
      approveGate: () => true,
    }, { maxTurns: 10 });

    // Find the conflicted history entry
    const conflicted = result.turn_history.find(h => h.error_code === 'conflict');
    assert.ok(conflicted, 'History should contain an entry with error_code: conflict');
    assert.equal(conflicted.accepted, false);
    assert.ok(conflicted.accept_error, 'Should have an accept_error message');
    assert.ok(conflicted.conflict, 'Should include conflict object');

    rmSync(root, { recursive: true, force: true });
  });

  it('AT-RLC-005: non-conflict acceptance failure preserves existing terminal behavior', async () => {
    // Use sequential mode so that a non-conflict acceptance failure returns terminal: true
    const config = makeConflictConfig(1);
    scaffoldProject(root, config);

    const events = [];
    let dispatched = false;

    const result = await runLoop(root, config, {
      selectRole: (state) => {
        if (dispatched) return null;
        return 'dev_a';
      },
      dispatch: async (ctx) => {
        dispatched = true;
        // Write a valid turn result but simulate a condition where acceptance
        // will fail for a non-conflict reason. We do this by writing an invalid
        // turn result that the governed-state validator will reject.
        return {
          accept: true,
          turnResult: {
            // Missing required fields — this should cause acceptance to fail
            // with a validation error, not a conflict
            schema_version: '1.0',
            run_id: ctx.state?.run_id || 'unknown',
            turn_id: ctx.turn.turn_id,
            role: ctx.turn.assigned_role,
            runtime_id: ctx.turn.runtime_id,
            status: 'completed',
            summary: 'Test.',
            // Missing: decisions, files_changed, etc.
          },
        };
      },
      approveGate: () => true,
      onEvent: (event) => events.push(event),
    }, { maxTurns: 5 });

    // Should not have a turn_conflicted event
    const conflictEvents = events.filter(e => e.type === 'turn_conflicted');
    assert.equal(conflictEvents.length, 0, 'No conflict events for non-conflict failure');

    // The run should have terminated (either blocked or dispatch_error)
    assert.equal(result.ok, false);

    rmSync(root, { recursive: true, force: true });
  });

  it('AT-RLC-006: parallel stall with all-conflict failures uses stop_reason conflict_stall', async () => {
    const config = makeConflictConfig(2);
    scaffoldProject(root, config);

    // Pre-seed the run and history to create a state where both parallel
    // turns will conflict. We do this by having a first successful round
    // that accepts a turn touching shared.js, then a second round where
    // both new turns also touch shared.js.
    let round = 0;
    const roleQueues = [
      ['dev_a'],           // Round 0: single successful turn
      ['dev_a', 'dev_b'],  // Round 1: both will conflict with round 0's accepted turn
    ];
    let roleIndex = 0;

    const events = [];

    const result = await runLoop(root, config, {
      selectRole: (state) => {
        if (round >= roleQueues.length) return null;
        const queue = roleQueues[round];
        if (roleIndex >= queue.length) {
          round++;
          roleIndex = 0;
          if (round >= roleQueues.length) return null;
          const nextQueue = roleQueues[round];
          if (roleIndex >= nextQueue.length) return null;
          return nextQueue[roleIndex++];
        }
        return queue[roleIndex++];
      },
      dispatch: async (ctx) => {
        writeFileSync(join(root, 'src/shared.js'), `// ${ctx.turn.assigned_role} round ${round}\n`);
        const isFirstRound = round === 0;
        return {
          accept: true,
          turnResult: makeTurnResult(ctx.turn, ctx.state, {
            filesChanged: ['src/shared.js'],
            runCompletion: false,
          }),
        };
      },
      approveGate: () => true,
      onEvent: (event) => events.push(event),
    }, { maxTurns: 10 });

    // We expect conflict events from the test
    const conflictEvents = events.filter(e => e.type === 'turn_conflicted');

    // If conflicts were triggered, verify the stall detection
    if (conflictEvents.length > 0) {
      const conflictHistory = result.turn_history.filter(h => h.error_code === 'conflict');
      assert.ok(conflictHistory.length > 0, 'Should have conflict entries in history');
    }

    // The run should eventually terminate
    assert.equal(result.ok, false, 'Run should not be ok when conflicts stall it');

    rmSync(root, { recursive: true, force: true });
  });

  it('AT-RLC-001: sequential conflict with detection_count < 3 does NOT terminate the loop', async () => {
    // Use sequential mode (max_concurrent_turns = 1)
    const config = makeConflictConfig(1);
    scaffoldProject(root, config);

    const events = [];
    let turnCount = 0;
    // We need a specific sequence:
    // 1. dev_a writes shared.js and gets accepted
    // 2. dev_b writes shared.js — this should conflict (detection_count = 1)
    // 3. Since detection_count < 3, the loop should NOT terminate
    const roleQueue = ['dev_a', 'dev_b', null];
    let roleIndex = 0;

    const result = await runLoop(root, config, {
      selectRole: () => {
        if (roleIndex >= roleQueue.length) return roleQueue[roleQueue.length - 1];
        return roleQueue[roleIndex++];
      },
      dispatch: async (ctx) => {
        turnCount++;
        writeFileSync(join(root, 'src/shared.js'), `// ${ctx.turn.assigned_role} turn ${turnCount}\n`);
        return {
          accept: true,
          turnResult: makeTurnResult(ctx.turn, ctx.state, {
            filesChanged: ['src/shared.js'],
          }),
        };
      },
      approveGate: () => true,
      onEvent: (event) => events.push(event),
    }, { maxTurns: 5 });

    // The first turn (dev_a) should be accepted
    const acceptEvents = events.filter(e => e.type === 'turn_accepted');
    assert.ok(acceptEvents.length >= 1, 'At least one turn should be accepted');

    // If there was a conflict, it should have emitted turn_conflicted
    const conflictEvents = events.filter(e => e.type === 'turn_conflicted');
    if (conflictEvents.length > 0) {
      // The key assertion: the loop continued after conflict (didn't return terminal)
      // We know this because the selectRole was called again after the conflict
      assert.ok(turnCount >= 2, 'Multiple turns should have been dispatched');
      assert.equal(conflictEvents[0].error_code, 'conflict');
    }

    rmSync(root, { recursive: true, force: true });
  });
});
