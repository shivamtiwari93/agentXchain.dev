import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';
import { execSync } from 'child_process';

import {
  initializeGovernedRun,
  assignGovernedTurn,
  acceptGovernedTurn,
  STATE_PATH,
  STAGING_PATH,
} from '../src/lib/governed-state.js';
import { scaffoldGoverned } from '../src/commands/init.js';
import { loadProjectState } from '../src/lib/config.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeTmpDir() {
  const dir = join(tmpdir(), `axc-budget-${randomBytes(6).toString('hex')}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeConfig(budgetOverrides = {}) {
  return {
    schema_version: 4,
    protocol_mode: 'governed',
    project: { id: 'budget-test', name: 'Budget Test', default_branch: 'main' },
    roles: {
      pm: { title: 'PM', mandate: 'Test', write_authority: 'review_only', runtime_class: 'manual', runtime_id: 'manual-pm' },
      dev: { title: 'Dev', mandate: 'Test', write_authority: 'authoritative', runtime_class: 'local_cli', runtime_id: 'local-dev' },
    },
    runtimes: {
      'manual-pm': { type: 'manual' },
      'local-dev': { type: 'local_cli' },
    },
    routing: {
      planning: { entry_role: 'pm', allowed_next_roles: ['pm', 'dev', 'human'], exit_gate: 'planning_signoff' },
      implementation: { entry_role: 'dev', allowed_next_roles: ['dev', 'pm', 'human'], exit_gate: 'implementation_complete' },
    },
    gates: {},
    budget: { per_turn_max_usd: 2.0, per_run_max_usd: 5.0, on_exceed: 'pause_and_escalate', ...budgetOverrides },
    rules: { challenge_required: true, max_turn_retries: 2, max_deadlock_cycles: 2 },
    files: { talk: 'TALK.md', history: '.agentxchain/history.jsonl', state: '.agentxchain/state.json' },
    compat: { next_owner_source: 'state-json', lock_based_coordination: false, original_version: 4 },
  };
}

function makeTurnResult(state, turnId, role, cost = 0.01) {
  return {
    schema_version: '1.0',
    run_id: state.run_id,
    turn_id: turnId,
    role,
    runtime_id: role === 'pm' ? 'manual-pm' : 'local-dev',
    status: 'completed',
    summary: 'Budget test turn.',
    decisions: [{ id: 'DEC-001', category: 'implementation', statement: 'Test.', rationale: 'Test.' }],
    objections: [{ id: 'OBJ-001', severity: 'low', statement: 'None.', status: 'raised' }],
    files_changed: [],
    artifacts_created: [],
    verification: {
      status: 'pass',
      commands: ['echo ok'],
      evidence_summary: 'Pass.',
      machine_evidence: [{ command: 'echo ok', exit_code: 0 }],
    },
    artifact: { type: 'review', ref: null },
    proposed_next_role: 'dev',
    phase_transition_request: null,
    run_completion_request: false,
    needs_human_reason: null,
    cost: { input_tokens: 100, output_tokens: 50, usd: cost },
  };
}

function initRepo() {
  const dir = makeTmpDir();
  execSync('git init -q && git config user.email "test@example.com" && git config user.name "Test User" && git add -A && git commit -q -m init --allow-empty', { cwd: dir, stdio: 'ignore' });
  return dir;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Budget Enforcement — DEC-BUDGET-ENFORCE-001', () => {
  let dir, config;

  beforeEach(() => {
    dir = makeTmpDir();
    config = makeConfig();
    scaffoldGoverned(dir, 'Budget Test', 'budget-test');
    try { execSync('git init -q && git config user.email "test@example.com" && git config user.name "Test User" && git add -A && git commit -q -m init --allow-empty', { cwd: dir, stdio: 'ignore' }); } catch {}
    initializeGovernedRun(dir, config);
  });
  afterEach(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });

  it('blocks run when accepted turn exhausts budget (post-acceptance enforcement)', () => {
    // Set budget to $5, assign a turn, accept with $5.50 cost
    const assign = assignGovernedTurn(dir, config, 'pm');
    assert.ok(assign.ok, `Assign failed: ${assign.error}`);
    const turn = Object.values(assign.state.active_turns)[0];

    const tr = makeTurnResult(assign.state, turn.turn_id, 'pm', 5.50);
    writeFileSync(join(dir, STAGING_PATH), JSON.stringify(tr, null, 2));

    const result = acceptGovernedTurn(dir, config);
    assert.ok(result.ok, `Accept failed: ${result.error}`);

    // Run should be blocked
    assert.equal(result.state.status, 'blocked');
    assert.equal(result.state.blocked_on, 'budget:exhausted');
    assert.equal(result.state.blocked_reason.category, 'budget_exhausted');

    // Budget status should reflect exhaustion
    assert.equal(result.state.budget_status.spent_usd, 5.50);
    assert.ok(result.state.budget_status.remaining_usd < 0);
    assert.equal(result.state.budget_status.exhausted, true);
    assert.ok(result.state.budget_status.exhausted_at);
    assert.equal(result.state.budget_status.exhausted_after_turn, turn.turn_id);
  });

  it('blocks run when cumulative spend exhausts budget across multiple turns', () => {
    // Turn 1: spend $3 of $5
    const a1 = assignGovernedTurn(dir, config, 'pm');
    assert.ok(a1.ok);
    const t1 = Object.values(a1.state.active_turns)[0];
    const tr1 = makeTurnResult(a1.state, t1.turn_id, 'pm', 3.00);
    writeFileSync(join(dir, STAGING_PATH), JSON.stringify(tr1, null, 2));
    const r1 = acceptGovernedTurn(dir, config);
    assert.ok(r1.ok);
    assert.equal(r1.state.status, 'active'); // Still active, $2 remaining

    // Turn 2: spend $2.50 — should exhaust budget
    const a2 = assignGovernedTurn(dir, config, 'pm');
    assert.ok(a2.ok, `Second assign failed: ${a2.error}`);
    const t2 = Object.values(a2.state.active_turns)[0];
    const tr2 = makeTurnResult(a2.state, t2.turn_id, 'pm', 2.50);
    writeFileSync(join(dir, STAGING_PATH), JSON.stringify(tr2, null, 2));
    const r2 = acceptGovernedTurn(dir, config);
    assert.ok(r2.ok);
    assert.equal(r2.state.status, 'blocked');
    assert.equal(r2.state.blocked_reason.category, 'budget_exhausted');
    assert.equal(r2.state.budget_status.spent_usd, 5.50);
  });

  it('rejects assignment when budget is already exhausted (pre-assignment guard)', () => {
    // Exhaust budget first
    const a1 = assignGovernedTurn(dir, config, 'pm');
    const t1 = Object.values(a1.state.active_turns)[0];
    const tr1 = makeTurnResult(a1.state, t1.turn_id, 'pm', 5.50);
    writeFileSync(join(dir, STAGING_PATH), JSON.stringify(tr1, null, 2));
    acceptGovernedTurn(dir, config);

    // Now try to assign another turn — should fail (either because run is blocked or budget exhausted)
    const a2 = assignGovernedTurn(dir, config, 'pm');
    assert.ok(!a2.ok);
    assert.ok(
      a2.error.includes('budget') || a2.error.includes('blocked'),
      `Expected budget or blocked error, got: ${a2.error}`
    );
  });

  it('provides explicit recovery guidance in blocked reason', () => {
    const a1 = assignGovernedTurn(dir, config, 'pm');
    const t1 = Object.values(a1.state.active_turns)[0];
    const tr1 = makeTurnResult(a1.state, t1.turn_id, 'pm', 6.00);
    writeFileSync(join(dir, STAGING_PATH), JSON.stringify(tr1, null, 2));
    const result = acceptGovernedTurn(dir, config);
    assert.ok(result.ok);

    const recovery = result.state.blocked_reason.recovery;
    assert.equal(recovery.typed_reason, 'budget_exhausted');
    assert.equal(recovery.owner, 'human');
    assert.ok(recovery.recovery_action.includes('per_run_max_usd'));
    assert.ok(recovery.recovery_action.includes('agentxchain resume'));
    assert.ok(recovery.detail.includes('$6.00'));
    assert.ok(recovery.detail.includes('$5.00'));
  });

  it('reconciles exhausted budget state after per_run_max_usd changes', () => {
    const a1 = assignGovernedTurn(dir, config, 'pm');
    const t1 = Object.values(a1.state.active_turns)[0];
    const tr1 = makeTurnResult(a1.state, t1.turn_id, 'pm', 6.00);
    writeFileSync(join(dir, STAGING_PATH), JSON.stringify(tr1, null, 2));
    const blocked = acceptGovernedTurn(dir, config);
    assert.ok(blocked.ok);
    assert.equal(blocked.state.status, 'blocked');

    const recoveredConfig = makeConfig({ per_run_max_usd: 9.0 });
    const reconciled = loadProjectState(dir, recoveredConfig);
    assert.ok(reconciled, 'Expected loadProjectState to return reconciled governed state');
    assert.equal(reconciled.budget_status.remaining_usd, 3.0);
    assert.equal(reconciled.budget_status.exhausted, undefined);
    assert.equal(reconciled.blocked_reason.category, 'budget_exhausted');
    assert.equal(reconciled.blocked_reason.recovery.recovery_action, 'Run agentxchain resume to assign the next turn');
    assert.match(reconciled.blocked_reason.recovery.detail, /\$3\.00 remaining/);

    const persisted = JSON.parse(readFileSync(join(dir, STATE_PATH), 'utf8'));
    assert.equal(persisted.budget_status.remaining_usd, 3.0);
    assert.equal(persisted.budget_status.exhausted, undefined);
  });

  it('releases reservation and tracks actual cost on acceptance', () => {
    const assign = assignGovernedTurn(dir, config, 'pm');
    const turn = Object.values(assign.state.active_turns)[0];

    // Verify reservation exists
    assert.ok(assign.state.budget_reservations[turn.turn_id]);
    assert.equal(assign.state.budget_reservations[turn.turn_id].reserved_usd, 2.0);

    // Accept with actual cost different from reservation
    const tr = makeTurnResult(assign.state, turn.turn_id, 'pm', 1.50);
    writeFileSync(join(dir, STAGING_PATH), JSON.stringify(tr, null, 2));
    const result = acceptGovernedTurn(dir, config);
    assert.ok(result.ok);

    // Reservation cleared, actual cost tracked
    assert.equal(result.state.budget_reservations[turn.turn_id], undefined);
    assert.equal(result.state.budget_status.spent_usd, 1.50);
    assert.equal(result.state.budget_status.remaining_usd, 3.50);
  });

  it('emits budget_warning when actual cost exceeds reservation', () => {
    const assign = assignGovernedTurn(dir, config, 'pm');
    const turn = Object.values(assign.state.active_turns)[0];

    // Reserved $2.00, actual cost $3.00
    const tr = makeTurnResult(assign.state, turn.turn_id, 'pm', 3.00);
    writeFileSync(join(dir, STAGING_PATH), JSON.stringify(tr, null, 2));
    const result = acceptGovernedTurn(dir, config);
    assert.ok(result.ok);
    assert.ok(result.budget_warning, 'Expected budget_warning in result');
    assert.ok(result.budget_warning.includes('$3.00'));
    assert.ok(result.budget_warning.includes('$2.00'));
  });

  it('does not enforce budget when per_run_max_usd is null', () => {
    // Fresh dir with no budget config
    const noBudgetDir = makeTmpDir();
    const noBudgetConfig = makeConfig({ per_run_max_usd: undefined });
    scaffoldGoverned(noBudgetDir, 'No Budget Test', 'no-budget-test');
    try { execSync('git init -q && git config user.email "test@example.com" && git config user.name "Test User" && git add -A && git commit -q -m init --allow-empty', { cwd: noBudgetDir, stdio: 'ignore' }); } catch {}
    initializeGovernedRun(noBudgetDir, noBudgetConfig);

    const assign = assignGovernedTurn(noBudgetDir, noBudgetConfig, 'pm');
    assert.ok(assign.ok, `Assign failed: ${assign.error}`);
    const turn = Object.values(assign.state.active_turns)[0];

    // Spend a huge amount — should not block
    const tr = makeTurnResult(assign.state, turn.turn_id, 'pm', 999.99);
    writeFileSync(join(noBudgetDir, STAGING_PATH), JSON.stringify(tr, null, 2));
    const result = acceptGovernedTurn(noBudgetDir, noBudgetConfig);
    assert.ok(result.ok);
    assert.equal(result.state.status, 'active');
    assert.equal(result.state.budget_status.remaining_usd, null);

    try { rmSync(noBudgetDir, { recursive: true, force: true }); } catch {}
  });

  it('preserves turn work when budget is exhausted (turn is accepted)', () => {
    const assign = assignGovernedTurn(dir, config, 'pm');
    const turn = Object.values(assign.state.active_turns)[0];
    const tr = makeTurnResult(assign.state, turn.turn_id, 'pm', 10.00);
    writeFileSync(join(dir, STAGING_PATH), JSON.stringify(tr, null, 2));

    const result = acceptGovernedTurn(dir, config);
    assert.ok(result.ok, 'Turn should be accepted even when it exhausts budget');
    assert.equal(result.state.status, 'blocked');
    // The turn IS in history (accepted)
    assert.equal(result.accepted.turn_id, turn.turn_id);
    assert.equal(result.state.last_completed_turn_id, turn.turn_id);
  });

  it('blocks at exact budget boundary (remaining_usd === 0)', () => {
    const assign = assignGovernedTurn(dir, config, 'pm');
    const turn = Object.values(assign.state.active_turns)[0];
    // Spend exactly $5.00 — remaining becomes 0
    const tr = makeTurnResult(assign.state, turn.turn_id, 'pm', 5.00);
    writeFileSync(join(dir, STAGING_PATH), JSON.stringify(tr, null, 2));
    const result = acceptGovernedTurn(dir, config);
    assert.ok(result.ok);
    assert.equal(result.state.status, 'blocked');
    assert.equal(result.state.blocked_reason.category, 'budget_exhausted');
    assert.equal(result.state.budget_status.remaining_usd, 0);
  });
});
