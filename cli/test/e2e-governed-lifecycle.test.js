/**
 * E2E Smoke Test — Full Governed Lifecycle
 *
 * Validates: init → resume → stage → validate → accept → transition → completion
 * Uses mock turn results (no live LLM). Exercises every governed state function
 * and every file write in a single sequential lifecycle.
 *
 * See: .planning/E2E_SMOKE_TEST_SPEC.md
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, cpSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

import {
  initializeGovernedRun,
  assignGovernedTurn,
  acceptGovernedTurn,
  rejectGovernedTurn,
  approvePhaseTransition,
  approveRunCompletion,
  STATE_PATH,
  HISTORY_PATH,
  LEDGER_PATH,
  STAGING_PATH,
  TALK_PATH,
} from '../src/lib/governed-state.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXAMPLE_DIR = join(__dirname, '..', '..', 'examples', 'governed-todo-app');

// ── Helpers ──────────────────────────────────────────────────────────────────

function readJson(root, relPath) {
  return JSON.parse(readFileSync(join(root, relPath), 'utf8'));
}

function readJsonl(root, relPath) {
  const content = readFileSync(join(root, relPath), 'utf8').trim();
  if (!content) return [];
  return content.split('\n').map(line => JSON.parse(line));
}

function makeConfig() {
  // This matches the governed-todo-app config after normalization.
  return {
    schema_version: 4,
    protocol_mode: 'governed',
    project: { id: 'governed-todo-app', name: 'Governed Todo App', default_branch: 'main' },
    roles: {
      pm: { title: 'Product Manager', mandate: 'Protect user value', write_authority: 'review_only', runtime_class: 'manual', runtime_id: 'manual-pm' },
      dev: { title: 'Developer', mandate: 'Implement approved work', write_authority: 'authoritative', runtime_class: 'local_cli', runtime_id: 'local-dev' },
      qa: { title: 'QA', mandate: 'Challenge correctness', write_authority: 'review_only', runtime_class: 'api_proxy', runtime_id: 'api-qa' },
      eng_director: { title: 'Engineering Director', mandate: 'Resolve deadlocks', write_authority: 'review_only', runtime_class: 'manual', runtime_id: 'manual-director' },
    },
    runtimes: {
      'manual-pm': { type: 'manual' },
      'local-dev': { type: 'local_cli' },
      'api-qa': { type: 'api_proxy' },
      'manual-director': { type: 'manual' },
    },
    routing: {
      planning: { entry_role: 'pm', allowed_next_roles: ['pm', 'eng_director', 'human'], exit_gate: 'planning_signoff' },
      implementation: { entry_role: 'dev', allowed_next_roles: ['dev', 'qa', 'eng_director', 'human'], exit_gate: 'implementation_complete' },
      qa: { entry_role: 'qa', allowed_next_roles: ['dev', 'qa', 'eng_director', 'human'], exit_gate: 'qa_ship_verdict' },
    },
    gates: {
      planning_signoff: { requires_files: ['.planning/PM_SIGNOFF.md', '.planning/ROADMAP.md'], requires_human_approval: true },
      implementation_complete: { requires_verification_pass: true },
      qa_ship_verdict: { requires_files: ['.planning/acceptance-matrix.md', '.planning/ship-verdict.md'], requires_human_approval: true },
    },
    budget: { per_turn_max_usd: 2.0, per_run_max_usd: 50.0 },
    rules: { challenge_required: true, max_turn_retries: 2, max_deadlock_cycles: 2 },
    files: { talk: 'TALK.md', history: '.agentxchain/history.jsonl', state: '.agentxchain/state.json' },
    compat: { next_owner_source: 'state-json', lock_based_coordination: false, original_version: 4 },
  };
}

function stageTurnResult(root, state, overrides = {}) {
  const base = {
    schema_version: '1.0',
    run_id: state.run_id,
    turn_id: state.current_turn.turn_id,
    role: state.current_turn.assigned_role,
    runtime_id: state.current_turn.runtime_id,
    status: 'completed',
    summary: `Turn completed by ${state.current_turn.assigned_role}.`,
    decisions: [{ id: 'DEC-001', category: 'implementation', statement: 'Approach chosen.', rationale: 'Best fit.' }],
    objections: [{ id: 'OBJ-001', severity: 'low', statement: 'Minor concern noted.', status: 'raised' }],
    files_changed: [],
    artifacts_created: [],
    verification: { status: 'pass', commands: ['echo ok'], evidence_summary: 'All good.', machine_evidence: [{ command: 'echo ok', exit_code: 0 }] },
    artifact: { type: 'review', ref: null },
    proposed_next_role: 'dev',
    phase_transition_request: null,
    run_completion_request: null,
    needs_human_reason: null,
    cost: { input_tokens: 100, output_tokens: 50, usd: 0.01 },
  };
  const result = { ...base, ...overrides };
  const stagingDir = join(root, '.agentxchain', 'staging');
  mkdirSync(stagingDir, { recursive: true });
  writeFileSync(join(root, STAGING_PATH), JSON.stringify(result, null, 2));
  return result;
}

// ── E2E Lifecycle Test ──────────────────────────────────────────────────────

describe('E2E governed lifecycle (3-phase happy path)', () => {
  let root;
  let config;

  before(() => {
    // Copy example project to temp dir
    root = join(tmpdir(), `axc-e2e-${randomBytes(6).toString('hex')}`);
    cpSync(EXAMPLE_DIR, root, { recursive: true });

    // Initialize git repo (required for baseline capture)
    execSync('git init', { cwd: root, stdio: 'ignore' });
    execSync('git add -A', { cwd: root, stdio: 'ignore' });
    execSync('git -c user.name="test" -c user.email="test@test" commit -m "initial"', { cwd: root, stdio: 'ignore' });

    config = makeConfig();
  });

  after(() => {
    try { rmSync(root, { recursive: true, force: true }); } catch {}
  });

  // ── Phase 1: Planning ──────────────────────────────────────────────────────

  it('Phase 1a: initializes a governed run from idle', () => {
    const result = initializeGovernedRun(root, config);
    assert.ok(result.ok, `initializeGovernedRun failed: ${result.error}`);
    assert.ok(result.state.run_id);
    assert.equal(result.state.status, 'active');
    assert.equal(result.state.phase, 'planning');
  });

  it('Phase 1b: assigns PM turn', () => {
    const result = assignGovernedTurn(root, config, 'pm');
    assert.ok(result.ok, `assignGovernedTurn failed: ${result.error}`);
    assert.ok(result.state.current_turn);
    assert.equal(result.state.current_turn.assigned_role, 'pm');
    assert.equal(result.state.current_turn.status, 'running');
  });

  it('Phase 1c: rejects double-assignment', () => {
    const result = assignGovernedTurn(root, config, 'pm');
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('Turn already assigned'));
  });

  it('Phase 1d: accepts PM turn with phase transition request', () => {
    const state = readJson(root, STATE_PATH);

    // Create gate-required files
    mkdirSync(join(root, '.planning'), { recursive: true });
    writeFileSync(join(root, '.planning', 'PM_SIGNOFF.md'), '# PM Signoff\nApproved: YES\n');
    writeFileSync(join(root, '.planning', 'ROADMAP.md'), '# Roadmap\n## MVP Scope\nTodo app.\n');

    // Stage and commit the gate files so baseline is clean
    execSync('git add -A', { cwd: root, stdio: 'ignore' });
    execSync('git -c user.name="test" -c user.email="test@test" commit -m "add pm artifacts"', { cwd: root, stdio: 'ignore' });

    stageTurnResult(root, state, {
      phase_transition_request: 'implementation',
      artifact: { type: 'review', path: '.planning/PM_SIGNOFF.md' },
      proposed_next_role: 'human',  // planning phase only allows: pm, eng_director, human
    });

    const result = acceptGovernedTurn(root, config);
    assert.ok(result.ok, `acceptGovernedTurn failed: ${result.error}`);

    // Should pause for human approval (planning_signoff gate has requires_human_approval: true)
    assert.equal(result.state.status, 'paused');
    assert.ok(result.state.pending_phase_transition);
    assert.equal(result.state.pending_phase_transition.from, 'planning');
    assert.equal(result.state.pending_phase_transition.to, 'implementation');
    assert.equal(result.state.current_turn, null);

    // History should have 1 entry
    const history = readJsonl(root, HISTORY_PATH);
    assert.equal(history.length, 1);
    assert.equal(history[0].role, 'pm');
  });

  it('Phase 1e: approves phase transition to implementation', () => {
    const result = approvePhaseTransition(root);
    assert.ok(result.ok, `approvePhaseTransition failed: ${result.error}`);
    assert.equal(result.state.phase, 'implementation');
    assert.equal(result.state.status, 'active');
    assert.equal(result.state.pending_phase_transition, null);
    assert.equal(result.state.phase_gate_status.planning_signoff, 'passed');
  });

  // ── Phase 2: Implementation ────────────────────────────────────────────────

  it('Phase 2a: assigns dev turn', () => {
    // Commit any orchestrator-generated files (TALK.md, state.json, history, etc.)
    // so the worktree is clean for the authoritative dev turn
    execSync('git add -A', { cwd: root, stdio: 'ignore' });
    execSync('git -c user.name="test" -c user.email="test@test" commit -m "orchestrator: accept pm turn" --allow-empty', { cwd: root, stdio: 'ignore' });

    const result = assignGovernedTurn(root, config, 'dev');
    assert.ok(result.ok, `assignGovernedTurn failed: ${result.error}`);
    assert.equal(result.state.current_turn.assigned_role, 'dev');
  });

  it('Phase 2b: accepts dev turn with phase transition to qa', () => {
    const state = readJson(root, STATE_PATH);

    // Create a source file (simulating dev work)
    writeFileSync(join(root, 'index.js'), 'console.log("todo app");\n');
    execSync('git add -A', { cwd: root, stdio: 'ignore' });
    execSync('git -c user.name="test" -c user.email="test@test" commit -m "implement todo app"', { cwd: root, stdio: 'ignore' });

    stageTurnResult(root, state, {
      files_changed: ['index.js'],
      artifact: { type: 'commit', ref: 'mock-sha' },
      phase_transition_request: 'qa',
      proposed_next_role: 'qa',
      verification: { status: 'pass', commands: ['node index.js'], evidence_summary: 'Runs successfully.', machine_evidence: [{ command: 'node index.js', exit_code: 0 }] },
    });

    const result = acceptGovernedTurn(root, config);
    assert.ok(result.ok, `acceptGovernedTurn failed: ${result.error}`);

    // implementation_complete gate has requires_verification_pass: true but no requires_human_approval
    // So it should auto-advance to qa phase
    assert.equal(result.state.phase, 'qa');
    assert.equal(result.state.status, 'active');
    assert.equal(result.state.phase_gate_status.implementation_complete, 'passed');

    const history = readJsonl(root, HISTORY_PATH);
    assert.equal(history.length, 2);
    assert.equal(history[1].role, 'dev');
  });

  // ── Phase 3: QA ────────────────────────────────────────────────────────────

  it('Phase 3a: assigns qa turn', () => {
    // Commit orchestrator files so worktree is clean for QA (review_only, but keep it tidy)
    execSync('git add -A', { cwd: root, stdio: 'ignore' });
    execSync('git -c user.name="test" -c user.email="test@test" commit -m "orchestrator: accept dev turn" --allow-empty', { cwd: root, stdio: 'ignore' });

    const result = assignGovernedTurn(root, config, 'qa');
    assert.ok(result.ok, `assignGovernedTurn failed: ${result.error}`);
    assert.equal(result.state.current_turn.assigned_role, 'qa');
  });

  it('Phase 3b: accepts qa turn with run_completion_request', () => {
    const state = readJson(root, STATE_PATH);

    // Create qa gate-required files
    writeFileSync(join(root, '.planning', 'acceptance-matrix.md'), '# Acceptance Matrix\nAll pass.\n');
    writeFileSync(join(root, '.planning', 'ship-verdict.md'), '# Ship Verdict\nSHIP IT.\n');
    execSync('git add -A', { cwd: root, stdio: 'ignore' });
    execSync('git -c user.name="test" -c user.email="test@test" commit -m "add qa artifacts"', { cwd: root, stdio: 'ignore' });

    stageTurnResult(root, state, {
      run_completion_request: true,
      phase_transition_request: null,
      artifact: { type: 'review', ref: null },
      proposed_next_role: 'human',
      verification: { status: 'pass', commands: ['npm test'], evidence_summary: 'All 5 criteria met.', machine_evidence: [{ command: 'npm test', exit_code: 0 }] },
    });

    const result = acceptGovernedTurn(root, config);
    assert.ok(result.ok, `acceptGovernedTurn failed: ${result.error}`);

    // qa_ship_verdict gate has requires_human_approval: true
    assert.equal(result.state.status, 'paused');
    assert.ok(result.state.pending_run_completion);
    assert.equal(result.state.pending_run_completion.gate, 'qa_ship_verdict');
  });

  it('Phase 3c: approves run completion', () => {
    const result = approveRunCompletion(root);
    assert.ok(result.ok, `approveRunCompletion failed: ${result.error}`);
    assert.equal(result.state.status, 'completed');
    assert.ok(result.state.completed_at);
    assert.equal(result.state.pending_run_completion, null);
  });

  // ── Final Assertions ──────────────────────────────────────────────────────

  it('final: history has exactly 3 accepted entries', () => {
    const history = readJsonl(root, HISTORY_PATH);
    assert.equal(history.length, 3);
    assert.equal(history[0].role, 'pm');
    assert.equal(history[1].role, 'dev');
    assert.equal(history[2].role, 'qa');
  });

  it('final: decision ledger has entries from all phases', () => {
    const ledger = readJsonl(root, LEDGER_PATH);
    assert.ok(ledger.length >= 3, `Expected at least 3 ledger entries, got ${ledger.length}`);
  });

  it('final: TALK.md was appended to by all 3 turns', () => {
    const talk = readFileSync(join(root, TALK_PATH), 'utf8');
    assert.ok(talk.includes('pm'), 'TALK.md should mention pm role');
    assert.ok(talk.includes('dev'), 'TALK.md should mention dev role');
    assert.ok(talk.includes('qa'), 'TALK.md should mention qa role');
  });

  it('final: state.json shows completed run', () => {
    const state = readJson(root, STATE_PATH);
    assert.equal(state.status, 'completed');
    assert.ok(state.completed_at);
    assert.ok(state.run_id);
    assert.equal(state.current_turn, null);
    assert.equal(state.pending_phase_transition, null);
    assert.equal(state.pending_run_completion, null);
  });

  it('final: staging is empty', () => {
    assert.ok(!existsSync(join(root, STAGING_PATH)), 'Staging file should be cleared after final accept');
  });

  it('final: all gate statuses are passed', () => {
    const state = readJson(root, STATE_PATH);
    assert.equal(state.phase_gate_status.planning_signoff, 'passed');
    assert.equal(state.phase_gate_status.implementation_complete, 'passed');
    assert.equal(state.phase_gate_status.qa_ship_verdict, 'passed');
  });
});
