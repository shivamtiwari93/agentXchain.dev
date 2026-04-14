import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';
import { fileURLToPath } from 'url';

const cliRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

const { runLoop, DEFAULT_MAX_TURNS } = await import(join(cliRoot, 'src', 'lib', 'run-loop.js'));
const {
  loadState,
  initRun,
  getActiveTurns,
  getActiveTurnCount,
  RUNNER_INTERFACE_VERSION,
} = await import(join(cliRoot, 'src', 'lib', 'runner-interface.js'));
const { gitInit } = await import(join(cliRoot, 'test-support', 'git-test-helpers.js'));

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeParallelConfig(maxConcurrent = 2, overrides = {}) {
  return {
    schema_version: 4,
    protocol_mode: 'governed',
    project: {
      id: `par-loop-test-${randomBytes(4).toString('hex')}`,
      name: 'Parallel Run Loop Test',
      default_branch: 'main',
    },
    roles: {
      planner: {
        title: 'Planner',
        mandate: 'Plan.',
        write_authority: 'review_only',
        runtime_class: 'api_proxy',
        runtime_id: 'api-planner',
      },
      reviewer: {
        title: 'Reviewer',
        mandate: 'Review.',
        write_authority: 'review_only',
        runtime_class: 'api_proxy',
        runtime_id: 'api-reviewer',
      },
      qa: {
        title: 'QA',
        mandate: 'Test.',
        write_authority: 'review_only',
        runtime_class: 'api_proxy',
        runtime_id: 'api-qa',
      },
    },
    runtimes: {
      'api-planner': { type: 'api_proxy', provider: 'anthropic', model: 'claude-haiku-4-5-20251001' },
      'api-reviewer': { type: 'api_proxy', provider: 'anthropic', model: 'claude-haiku-4-5-20251001' },
      'api-qa': { type: 'api_proxy', provider: 'anthropic', model: 'claude-haiku-4-5-20251001' },
    },
    routing: {
      work: {
        entry_role: 'planner',
        allowed_next_roles: ['planner', 'reviewer', 'qa', 'human'],
        max_concurrent_turns: maxConcurrent,
        exit_gate: 'work_complete',
      },
    },
    gates: {
      work_complete: {
        requires_human_approval: false,
      },
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
  writeFileSync(join(root, 'agentxchain.json'), JSON.stringify(config, null, 2));
  writeFileSync(join(root, '.agentxchain/state.json'), JSON.stringify({
    schema_version: '1.1',
    project_id: config.project.id,
    status: 'idle',
    phase: 'work',
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
  gitInit(root);
}

function makeTurnResult(turn, state, { proposedNextRole = 'human', runCompletion = true } = {}) {
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
    files_changed: [],
    artifacts_created: [],
    verification: {
      status: 'pass',
      commands: ['echo ok'],
      evidence_summary: 'pass',
      machine_evidence: [{ command: 'echo ok', exit_code: 0 }],
    },
    artifact: { type: 'review', ref: null },
    proposed_next_role: proposedNextRole,
    run_completion_request: runCompletion,
    phase_transition_request: null,
    challenge: { challenged: true, summary: 'Self-challenged.' },
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('parallel run-loop', () => {
  let root;

  beforeEach(() => {
    root = join(tmpdir(), `axc-par-loop-${randomBytes(6).toString('hex')}`);
  });

  after(() => {
    // Cleanup is per-test via rmSync in each test
  });

  it('AT-PRL-001: dispatches 2 turns concurrently with max_concurrent_turns=2', async () => {
    const config = makeParallelConfig(2);
    scaffoldProject(root, config);

    const dispatchedTurnIds = [];
    let dispatchCallCount = 0;
    const roleQueue = ['planner', 'reviewer'];
    let roleIndex = 0;

    const result = await runLoop(root, config, {
      selectRole: (state, cfg) => {
        if (roleIndex >= roleQueue.length) return null;
        return roleQueue[roleIndex++];
      },
      dispatch: async (ctx) => {
        dispatchCallCount++;
        dispatchedTurnIds.push(ctx.turn.turn_id);
        // Simulate concurrent work with a small delay
        await new Promise(r => setTimeout(r, 10));
        return { accept: true, turnResult: makeTurnResult(ctx.turn, ctx.state) };
      },
      approveGate: () => true,
    }, { maxTurns: 10 });

    assert.ok(result.ok, `Expected ok, got: ${JSON.stringify(result.errors)}`);
    assert.equal(result.turns_executed, 2, 'Should execute 2 turns');
    assert.equal(result.turn_history.length, 2, 'History should have 2 entries');
    assert.equal(dispatchCallCount, 2, 'dispatch should be called twice');

    // Both turns should be in the history
    const roles = result.turn_history.map(h => h.role).sort();
    assert.deepEqual(roles, ['planner', 'reviewer']);

    rmSync(root, { recursive: true, force: true });
  });

  it('AT-PRL-002: sequential mode (max_concurrent_turns=1) unchanged', async () => {
    const config = makeParallelConfig(1);
    scaffoldProject(root, config);

    const dispatchOrder = [];
    const roleQueue = ['planner', 'reviewer'];
    let roleIndex = 0;

    const result = await runLoop(root, config, {
      selectRole: (state, cfg) => {
        if (roleIndex >= roleQueue.length) return null;
        return roleQueue[roleIndex++];
      },
      dispatch: async (ctx) => {
        dispatchOrder.push(ctx.turn.assigned_role);
        // Only request completion on the last turn
        const isLast = ctx.turn.assigned_role === 'reviewer';
        return { accept: true, turnResult: makeTurnResult(ctx.turn, ctx.state, { runCompletion: isLast }) };
      },
      approveGate: () => true,
    }, { maxTurns: 10 });

    assert.ok(result.ok, `Expected ok, got: ${JSON.stringify(result.errors)}`);
    assert.equal(result.turns_executed, 2, 'Should execute 2 turns');
    // In sequential mode, turns are dispatched one at a time
    assert.deepEqual(dispatchOrder, ['planner', 'reviewer']);

    rmSync(root, { recursive: true, force: true });
  });

  it('AT-PRL-003: mixed accept/reject in parallel — accepted turns counted, rejected retried or escalated', async () => {
    const config = makeParallelConfig(2);
    scaffoldProject(root, config);

    const roleQueue = ['planner', 'reviewer'];
    let roleIndex = 0;
    let iteration = 0;

    const result = await runLoop(root, config, {
      selectRole: (state, cfg) => {
        if (roleIndex >= roleQueue.length) return null;
        return roleQueue[roleIndex++];
      },
      dispatch: async (ctx) => {
        iteration++;
        if (ctx.turn.assigned_role === 'reviewer' && ctx.turn.attempt === 1) {
          // Reject reviewer on first attempt
          return { accept: false, reason: 'Review incomplete' };
        }
        return { accept: true, turnResult: makeTurnResult(ctx.turn, ctx.state) };
      },
      approveGate: () => true,
    }, { maxTurns: 10 });

    // Planner should succeed. Reviewer should be retried and succeed on attempt 2.
    assert.ok(result.ok, `Expected ok, got: ${JSON.stringify(result.errors)}`);
    assert.ok(result.turns_executed >= 2, `Should execute at least 2 turns, got ${result.turns_executed}`);

    const acceptedRoles = result.turn_history
      .filter(h => h.accepted)
      .map(h => h.role)
      .sort();
    assert.ok(acceptedRoles.includes('planner'), 'planner should be accepted');
    assert.ok(acceptedRoles.includes('reviewer'), 'reviewer should be accepted (after retry)');

    rmSync(root, { recursive: true, force: true });
  });

  it('AT-PRL-004: selectRole returns null early — dispatches only filled slots', async () => {
    const config = makeParallelConfig(3); // 3 slots but only 1 role
    scaffoldProject(root, config);

    let selectCalls = 0;
    let dispatchCount = 0;

    const result = await runLoop(root, config, {
      selectRole: (state, cfg) => {
        selectCalls++;
        if (selectCalls === 1) return 'planner';
        return null; // Only fill 1 of 3 slots
      },
      dispatch: async (ctx) => {
        dispatchCount++;
        return { accept: true, turnResult: makeTurnResult(ctx.turn, ctx.state) };
      },
      approveGate: () => true,
    }, { maxTurns: 10 });

    assert.ok(result.ok, `Expected ok, got: ${JSON.stringify(result.errors)}`);
    assert.equal(result.turns_executed, 1, 'Should execute 1 turn');
    assert.equal(dispatchCount, 1, 'dispatch should be called once');

    rmSync(root, { recursive: true, force: true });
  });

  it('AT-PRL-006: turnsExecuted accurately counts accepted turns across parallel iterations', async () => {
    const config = makeParallelConfig(3);
    scaffoldProject(root, config);

    const roleQueue = ['planner', 'reviewer', 'qa'];
    let roleIndex = 0;

    const result = await runLoop(root, config, {
      selectRole: (state, cfg) => {
        if (roleIndex >= roleQueue.length) return null;
        return roleQueue[roleIndex++];
      },
      dispatch: async (ctx) => {
        return { accept: true, turnResult: makeTurnResult(ctx.turn, ctx.state) };
      },
      approveGate: () => true,
    }, { maxTurns: 10 });

    assert.ok(result.ok, `Expected ok, got: ${JSON.stringify(result.errors)}`);
    assert.equal(result.turns_executed, 3, 'Should count exactly 3 accepted turns');
    assert.equal(result.turn_history.length, 3, 'History should have 3 entries');
    assert.ok(result.turn_history.every(h => h.accepted), 'All turns should be accepted');

    rmSync(root, { recursive: true, force: true });
  });

  it('emits parallel_dispatch event with turn count', async () => {
    const config = makeParallelConfig(2);
    scaffoldProject(root, config);

    const events = [];
    const roleQueue = ['planner', 'reviewer'];
    let roleIndex = 0;

    const result = await runLoop(root, config, {
      selectRole: (state, cfg) => {
        if (roleIndex >= roleQueue.length) return null;
        return roleQueue[roleIndex++];
      },
      dispatch: async (ctx) => {
        return { accept: true, turnResult: makeTurnResult(ctx.turn, ctx.state) };
      },
      approveGate: () => true,
      onEvent: (e) => events.push(e),
    }, { maxTurns: 10 });

    assert.ok(result.ok, `Expected ok, got: ${JSON.stringify(result.errors)}`);

    const parallelEvent = events.find(e => e.type === 'parallel_dispatch');
    assert.ok(parallelEvent, 'Should emit parallel_dispatch event');
    assert.equal(parallelEvent.count, 2, 'Event should report 2 concurrent turns');
    assert.equal(parallelEvent.turns.length, 2, 'Event should list 2 turn IDs');

    rmSync(root, { recursive: true, force: true });
  });

  it('AT-PRL-007: alternate-role fallback fills second slot when selectRole returns the same role', async () => {
    const config = makeParallelConfig(2);
    scaffoldProject(root, config);

    // selectRole always returns 'planner' — the loop should detect the duplicate
    // and try other allowed_next_roles from routing to fill the second slot
    const result = await runLoop(root, config, {
      selectRole: () => 'planner',
      dispatch: async (ctx) => {
        return { accept: true, turnResult: makeTurnResult(ctx.turn, ctx.state) };
      },
      approveGate: () => true,
    }, { maxTurns: 10 });

    assert.ok(result.ok, `Expected ok, got: ${JSON.stringify(result.errors)}`);
    assert.equal(result.turns_executed, 2, 'Should execute 2 turns via alternate-role fallback');

    const roles = result.turn_history.map(h => h.role).sort();
    assert.ok(roles.includes('planner'), 'planner should be in history');
    // The second role should be one of the alternates (reviewer or qa)
    assert.ok(roles.some(r => r === 'reviewer' || r === 'qa'), 'an alternate role should fill the second slot');

    rmSync(root, { recursive: true, force: true });
  });
});
