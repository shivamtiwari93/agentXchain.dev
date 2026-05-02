import { describe, it, beforeEach, afterEach } from 'vitest';
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
import { validateV4Config } from '../src/lib/normalized-config.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeTmpDir() {
  const dir = join(tmpdir(), `axc-warn-${randomBytes(6).toString('hex')}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeConfig(budgetOverrides = {}) {
  return {
    schema_version: 4,
    protocol_mode: 'governed',
    project: { id: 'warn-test', name: 'Warn Test', default_branch: 'main' },
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
    budget: { per_turn_max_usd: 2.0, per_run_max_usd: 5.0, on_exceed: 'warn', ...budgetOverrides },
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
    summary: 'Budget warn test turn.',
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

function setupDir() {
  const dir = makeTmpDir();
  try { execSync('git init -q && git config user.email "test@example.com" && git config user.name "Test User" && git add -A && git commit -q -m init --allow-empty', { cwd: dir, stdio: 'ignore' }); } catch {}
  return dir;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Budget on_exceed: warn — DEC-BUDGET-WARN-001', () => {
  let dir, config;

  beforeEach(() => {
    dir = makeTmpDir();
    config = makeConfig();
    scaffoldGoverned(dir, 'Warn Test', 'warn-test');
    try { execSync('git init -q && git config user.email "test@example.com" && git config user.name "Test User" && git add -A && git commit -q -m init --allow-empty', { cwd: dir, stdio: 'ignore' }); } catch {}
    initializeGovernedRun(dir, config);
  });
  afterEach(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });

  it('AT-1: warn mode allows run to continue past budget exhaustion', () => {
    const assign = assignGovernedTurn(dir, config, 'pm');
    assert.ok(assign.ok, `Assign failed: ${assign.error}`);
    const turn = Object.values(assign.state.active_turns)[0];

    const tr = makeTurnResult(assign.state, turn.turn_id, 'pm', 6.00);
    writeFileSync(join(dir, STAGING_PATH), JSON.stringify(tr, null, 2));

    const result = acceptGovernedTurn(dir, config);
    assert.ok(result.ok, `Accept failed: ${result.error}`);

    // Run should NOT be blocked
    assert.equal(result.state.status, 'active');
    assert.notEqual(result.state.blocked_on, 'budget:exhausted');

    // Budget status should reflect exhaustion in warn mode
    assert.equal(result.state.budget_status.exhausted, true);
    assert.ok(result.state.budget_status.exhausted_at);
    assert.equal(result.state.budget_status.exhausted_after_turn, turn.turn_id);
    assert.equal(result.state.budget_status.warn_mode, true);
    assert.equal(result.state.budget_status.spent_usd, 6.00);
    assert.ok(result.state.budget_status.remaining_usd < 0);
  });

  it('AT-2: warn mode emits budget_warning in acceptance result', () => {
    const assign = assignGovernedTurn(dir, config, 'pm');
    const turn = Object.values(assign.state.active_turns)[0];

    const tr = makeTurnResult(assign.state, turn.turn_id, 'pm', 6.00);
    writeFileSync(join(dir, STAGING_PATH), JSON.stringify(tr, null, 2));

    const result = acceptGovernedTurn(dir, config);
    assert.ok(result.ok);
    assert.ok(result.budget_warning, 'Expected budget_warning in result');
    assert.ok(result.budget_warning.includes('warn mode'), `Expected warn mode text, got: ${result.budget_warning}`);
    assert.ok(result.budget_warning.includes('$6.00'));
  });

  it('AT-3: pre-assignment succeeds in warn mode even when budget exhausted', () => {
    // Exhaust budget first
    const a1 = assignGovernedTurn(dir, config, 'pm');
    const t1 = Object.values(a1.state.active_turns)[0];
    const tr1 = makeTurnResult(a1.state, t1.turn_id, 'pm', 6.00);
    writeFileSync(join(dir, STAGING_PATH), JSON.stringify(tr1, null, 2));
    acceptGovernedTurn(dir, config);

    // Now try to assign another turn — should succeed in warn mode
    const a2 = assignGovernedTurn(dir, config, 'pm');
    assert.ok(a2.ok, `Second assign should succeed in warn mode, got: ${a2.error}`);
    assert.ok(a2.warnings?.length > 0, 'Expected warnings about budget exhaustion');
    assert.ok(a2.warnings.some(w => w.includes('warn mode')), `Expected warn mode text in warnings, got: ${a2.warnings}`);
  });

  it('AT-4: cumulative warn-mode tracking across multiple turns past budget', () => {
    // Turn 1: spend $4 of $5
    const a1 = assignGovernedTurn(dir, config, 'pm');
    const t1 = Object.values(a1.state.active_turns)[0];
    writeFileSync(join(dir, STAGING_PATH), JSON.stringify(makeTurnResult(a1.state, t1.turn_id, 'pm', 4.00), null, 2));
    const r1 = acceptGovernedTurn(dir, config);
    assert.ok(r1.ok);
    assert.equal(r1.state.status, 'active');
    assert.equal(r1.state.budget_status.exhausted, undefined); // Not yet exhausted

    // Turn 2: spend $3 more — now exhausted but still active
    const a2 = assignGovernedTurn(dir, config, 'pm');
    assert.ok(a2.ok);
    const t2 = Object.values(a2.state.active_turns)[0];
    writeFileSync(join(dir, STAGING_PATH), JSON.stringify(makeTurnResult(a2.state, t2.turn_id, 'pm', 3.00), null, 2));
    const r2 = acceptGovernedTurn(dir, config);
    assert.ok(r2.ok);
    assert.equal(r2.state.status, 'active');
    assert.equal(r2.state.budget_status.exhausted, true);
    assert.equal(r2.state.budget_status.warn_mode, true);
    assert.equal(r2.state.budget_status.spent_usd, 7.00);

    // Turn 3: spend $2 more — still active in warn mode
    const a3 = assignGovernedTurn(dir, config, 'pm');
    assert.ok(a3.ok, `Third assign should succeed in warn mode, got: ${a3.error}`);
    const t3 = Object.values(a3.state.active_turns)[0];
    writeFileSync(join(dir, STAGING_PATH), JSON.stringify(makeTurnResult(a3.state, t3.turn_id, 'pm', 2.00), null, 2));
    const r3 = acceptGovernedTurn(dir, config);
    assert.ok(r3.ok);
    assert.equal(r3.state.status, 'active');
    assert.equal(r3.state.budget_status.spent_usd, 9.00);
    assert.equal(r3.state.budget_status.warn_mode, true);
  });

  it('AT-5: switching from warn to pause_and_escalate blocks next assignment', () => {
    // Exhaust budget in warn mode
    const a1 = assignGovernedTurn(dir, config, 'pm');
    const t1 = Object.values(a1.state.active_turns)[0];
    writeFileSync(join(dir, STAGING_PATH), JSON.stringify(makeTurnResult(a1.state, t1.turn_id, 'pm', 6.00), null, 2));
    acceptGovernedTurn(dir, config);

    // Switch policy
    const strictConfig = makeConfig({ on_exceed: 'pause_and_escalate' });

    // Assignment should fail because budget is exhausted and policy is now pause_and_escalate
    const a2 = assignGovernedTurn(dir, strictConfig, 'pm');
    assert.ok(!a2.ok, 'Expected assignment to fail after policy switch');
    assert.ok(a2.error.includes('budget'), `Expected budget error, got: ${a2.error}`);
  });

  it('AT-6: config validation accepts "warn"', () => {
    const result = validateV4Config({
      schema_version: '1.0',
      project: { id: 'test', name: 'Test' },
      roles: { dev: { title: 'Dev', mandate: 'Build.', write_authority: 'authoritative', runtime: 'local-dev' } },
      runtimes: { 'local-dev': { type: 'local_cli', command: ['claude', '--print'] } },
      budget: { per_turn_max_usd: 2.0, per_run_max_usd: 10.0, on_exceed: 'warn' },
    });
    assert.ok(result.ok, `Validation should accept warn, got errors: ${result.errors?.join(', ')}`);
  });

  it('AT-7: exhausted_after_turn is set only once on first exhaustion in warn mode', () => {
    // Turn 1: exhaust budget
    const a1 = assignGovernedTurn(dir, config, 'pm');
    const t1 = Object.values(a1.state.active_turns)[0];
    writeFileSync(join(dir, STAGING_PATH), JSON.stringify(makeTurnResult(a1.state, t1.turn_id, 'pm', 6.00), null, 2));
    const r1 = acceptGovernedTurn(dir, config);
    const firstExhaustedTurn = r1.state.budget_status.exhausted_after_turn;
    assert.equal(firstExhaustedTurn, t1.turn_id);

    // Turn 2: spend more, exhausted_after_turn should not change
    const a2 = assignGovernedTurn(dir, config, 'pm');
    const t2 = Object.values(a2.state.active_turns)[0];
    writeFileSync(join(dir, STAGING_PATH), JSON.stringify(makeTurnResult(a2.state, t2.turn_id, 'pm', 2.00), null, 2));
    const r2 = acceptGovernedTurn(dir, config);
    assert.equal(r2.state.budget_status.exhausted_after_turn, firstExhaustedTurn);
    assert.equal(r2.state.budget_status.exhausted, true);
    assert.equal(r2.state.budget_status.warn_mode, true);
  });

  it('AT-8: budget_exceeded_warn event is emitted to events log', () => {
    const assign = assignGovernedTurn(dir, config, 'pm');
    const turn = Object.values(assign.state.active_turns)[0];
    writeFileSync(join(dir, STAGING_PATH), JSON.stringify(makeTurnResult(assign.state, turn.turn_id, 'pm', 6.00), null, 2));
    acceptGovernedTurn(dir, config);

    // Check events.jsonl for budget_exceeded_warn
    const eventsPath = join(dir, '.agentxchain', 'events.jsonl');
    const events = readFileSync(eventsPath, 'utf8').trim().split('\n').map(l => JSON.parse(l));
    const warnEvents = events.filter(e => e.event_type === 'budget_exceeded_warn');
    assert.ok(warnEvents.length > 0, 'Expected budget_exceeded_warn event in events log');
    assert.ok(warnEvents[0].payload.spent_usd >= 6.00);
    assert.ok(warnEvents[0].payload.warning.includes('warn mode'));
  });
});
