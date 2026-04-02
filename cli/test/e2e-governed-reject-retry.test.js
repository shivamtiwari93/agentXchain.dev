/**
 * E2E Reject/Retry Test — Governed Lifecycle Unhappy Path
 *
 * Validates: init → planning accept → implementation assign →
 * invalid staged result → reject → retry dispatch → accept corrected retry
 *
 * See: .planning/E2E_REJECT_RETRY_SPEC.md
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, cpSync, readdirSync } from 'fs';
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
  normalizeGovernedStateShape,
  getActiveTurn,
  STATE_PATH,
  HISTORY_PATH,
  LEDGER_PATH,
  STAGING_PATH,
} from '../src/lib/governed-state.js';
import { validateStagedTurnResult } from '../src/lib/turn-result-validator.js';
import { writeDispatchBundle } from '../src/lib/dispatch-bundle.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXAMPLE_DIR = join(__dirname, '..', '..', 'examples', 'governed-todo-app');

function readJson(root, relPath) {
  const parsed = JSON.parse(readFileSync(join(root, relPath), 'utf8'));
  if (relPath === STATE_PATH || relPath.endsWith('state.json')) {
    const normalized = normalizeGovernedStateShape(parsed).state;
    Object.defineProperty(normalized, 'current_turn', {
      configurable: true,
      enumerable: false,
      get() {
        return getActiveTurn(normalized);
      },
    });
    return normalized;
  }
  return parsed;
}

function readJsonl(root, relPath) {
  const content = readFileSync(join(root, relPath), 'utf8').trim();
  if (!content) return [];
  return content.split('\n').map(line => JSON.parse(line));
}

function makeConfig() {
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
  mkdirSync(join(root, '.agentxchain', 'staging'), { recursive: true });
  writeFileSync(join(root, STAGING_PATH), JSON.stringify(result, null, 2));
  return result;
}

describe('E2E governed reject/retry lifecycle', () => {
  let root;
  let config;
  let rejectedFilesBefore;

  before(() => {
    root = join(tmpdir(), `axc-e2e-retry-${randomBytes(6).toString('hex')}`);
    cpSync(EXAMPLE_DIR, root, { recursive: true });

    execSync('git init', { cwd: root, stdio: 'ignore' });
    execSync('git add -A', { cwd: root, stdio: 'ignore' });
    execSync('git -c user.name="test" -c user.email="test@test" commit -m "initial"', { cwd: root, stdio: 'ignore' });

    config = makeConfig();
    rejectedFilesBefore = [];
  });

  after(() => {
    try { rmSync(root, { recursive: true, force: true }); } catch {}
  });

  it('accepts planning, rejects an invalid dev result, and accepts the corrected retry', () => {
    const initResult = initializeGovernedRun(root, config);
    assert.ok(initResult.ok, `initializeGovernedRun failed: ${initResult.error}`);

    const assignPmResult = assignGovernedTurn(root, config, 'pm');
    assert.ok(assignPmResult.ok, `assignGovernedTurn(pm) failed: ${assignPmResult.error}`);

    mkdirSync(join(root, '.planning'), { recursive: true });
    writeFileSync(join(root, '.planning', 'PM_SIGNOFF.md'), '# PM Signoff\nApproved: YES\n');
    writeFileSync(join(root, '.planning', 'ROADMAP.md'), '# Roadmap\n## MVP Scope\nTodo app.\n');
    execSync('git add -A', { cwd: root, stdio: 'ignore' });
    execSync('git -c user.name="test" -c user.email="test@test" commit -m "add pm artifacts"', { cwd: root, stdio: 'ignore' });

    stageTurnResult(root, readJson(root, STATE_PATH), {
      phase_transition_request: 'implementation',
      artifact: { type: 'review', path: '.planning/PM_SIGNOFF.md' },
      proposed_next_role: 'human',
    });

    const acceptPmResult = acceptGovernedTurn(root, config);
    assert.ok(acceptPmResult.ok, `acceptGovernedTurn(pm) failed: ${acceptPmResult.error}`);
    assert.equal(acceptPmResult.state.status, 'paused');
    assert.equal(acceptPmResult.state.pending_phase_transition.to, 'implementation');

    const approveResult = approvePhaseTransition(root);
    assert.ok(approveResult.ok, `approvePhaseTransition failed: ${approveResult.error}`);
    assert.equal(approveResult.state.phase, 'implementation');
    assert.equal(approveResult.state.status, 'active');

    execSync('git add -A', { cwd: root, stdio: 'ignore' });
    execSync('git -c user.name="test" -c user.email="test@test" commit -m "orchestrator: accept pm turn" --allow-empty', { cwd: root, stdio: 'ignore' });

    const assignDevResult = assignGovernedTurn(root, config, 'dev');
    assert.ok(assignDevResult.ok, `assignGovernedTurn(dev) failed: ${assignDevResult.error}`);

    const firstBundle = writeDispatchBundle(root, assignDevResult.state, config);
    assert.ok(firstBundle.ok, `writeDispatchBundle(initial) failed: ${firstBundle.error}`);

    mkdirSync(join(root, '.agentxchain', 'staging'), { recursive: true });
    writeFileSync(join(root, STAGING_PATH), '{"bad": true}\n');

    const stateBeforeReject = readJson(root, STATE_PATH);
    const validation = validateStagedTurnResult(root, stateBeforeReject, config);
    assert.equal(validation.ok, false, 'Invalid staged turn unexpectedly passed validation');
    assert.equal(validation.stage, 'schema');
    assert.ok(validation.errors.some(error => error.includes('Missing required field: schema_version')));

    const rejectedDir = join(root, '.agentxchain', 'dispatch', 'rejected');
    rejectedFilesBefore = existsSync(rejectedDir) ? readdirSync(rejectedDir) : [];

    const rejectResult = rejectGovernedTurn(root, config, validation, 'Schema mismatch');
    assert.ok(rejectResult.ok, `rejectGovernedTurn failed: ${rejectResult.error}`);
    assert.equal(rejectResult.escalated, false);
    assert.equal(rejectResult.state.current_turn.turn_id, assignDevResult.state.current_turn.turn_id);
    assert.equal(rejectResult.state.current_turn.attempt, 2);
    assert.equal(rejectResult.state.current_turn.status, 'retrying');
    assert.equal(rejectResult.state.current_turn.last_rejection.failed_stage, 'schema');
    assert.equal(rejectResult.state.current_turn.last_rejection.reason, 'Schema mismatch');
    assert.ok(!existsSync(join(root, STAGING_PATH)), 'Staging file should be cleared after rejection');

    const rejectedFilesAfter = existsSync(rejectedDir) ? readdirSync(rejectedDir) : [];
    const newRejectedFiles = rejectedFilesAfter.filter(file => !rejectedFilesBefore.includes(file));
    assert.equal(newRejectedFiles.length, 1, `Expected 1 rejected artifact, got ${newRejectedFiles.length}`);
    assert.match(newRejectedFiles[0], /attempt-1/);
    const rejectedSnapshot = readFileSync(join(rejectedDir, newRejectedFiles[0]), 'utf8');
    assert.match(rejectedSnapshot, /"bad": true/);

    const retryBundle = writeDispatchBundle(root, rejectResult.state, config);
    assert.ok(retryBundle.ok, `writeDispatchBundle(retry) failed: ${retryBundle.error}`);

    const devTurnId = assignDevResult.state.current_turn.turn_id;
    const assignment = readJson(root, `.agentxchain/dispatch/turns/${devTurnId}/ASSIGNMENT.json`);
    assert.equal(assignment.turn_id, devTurnId);
    assert.equal(assignment.attempt, 2);

    const retryPrompt = readFileSync(join(root, '.agentxchain', 'dispatch', 'turns', devTurnId, 'PROMPT.md'), 'utf8');
    assert.match(retryPrompt, /Previous Attempt Failed/);
    assert.match(retryPrompt, /Schema mismatch/);
    assert.match(retryPrompt, /Failed stage:\*\* schema/);
    assert.match(retryPrompt, /Missing required field: schema_version/);

    writeFileSync(join(root, 'index.js'), 'console.log("todo app");\n');
    execSync('git add -A', { cwd: root, stdio: 'ignore' });
    execSync('git -c user.name="test" -c user.email="test@test" commit -m "implement todo app"', { cwd: root, stdio: 'ignore' });

    stageTurnResult(root, readJson(root, STATE_PATH), {
      files_changed: ['index.js'],
      artifact: { type: 'commit', ref: 'mock-sha' },
      phase_transition_request: 'qa',
      proposed_next_role: 'qa',
      verification: {
        status: 'pass',
        commands: ['node index.js'],
        evidence_summary: 'Runs successfully.',
        machine_evidence: [{ command: 'node index.js', exit_code: 0 }],
      },
    });

    const acceptRetryResult = acceptGovernedTurn(root, config);
    assert.ok(acceptRetryResult.ok, `acceptGovernedTurn(retry) failed: ${acceptRetryResult.error}`);
    assert.equal(acceptRetryResult.state.phase, 'qa');
    assert.equal(acceptRetryResult.state.status, 'active');
    assert.equal(acceptRetryResult.state.current_turn, null);
    assert.equal(acceptRetryResult.state.phase_gate_status.implementation_complete, 'passed');

    const history = readJsonl(root, HISTORY_PATH);
    assert.equal(history.length, 2);
    assert.deepEqual(history.map(entry => entry.role), ['pm', 'dev']);
    assert.deepEqual(history.map(entry => entry.turn_id), [
      acceptPmResult.state.last_completed_turn_id,
      assignDevResult.state.current_turn.turn_id,
    ]);

    const ledger = readJsonl(root, LEDGER_PATH);
    assert.equal(ledger.length, 2);
    assert.deepEqual(ledger.map(entry => entry.turn_id), [
      acceptPmResult.state.last_completed_turn_id,
      assignDevResult.state.current_turn.turn_id,
    ]);

    const finalState = readJson(root, STATE_PATH);
    assert.equal(finalState.current_turn, null);
    assert.equal(finalState.phase, 'qa');
    assert.equal(finalState.status, 'active');
  });
});
