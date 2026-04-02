/**
 * E2E Parallel Lifecycle Test — Governed v1.1
 *
 * Validates: initialize → assign two concurrent turns → accept first →
 * conflict second → reject_and_reassign → accept rebased retry
 *
 * See: .planning/E2E_PARALLEL_LIFECYCLE_SPEC.md
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, rmSync, cpSync, existsSync } from 'fs';
import { dirname, join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

import {
  initializeGovernedRun,
  assignGovernedTurn,
  acceptGovernedTurn,
  rejectGovernedTurn,
  normalizeGovernedStateShape,
  getActiveTurn,
  STATE_PATH,
  HISTORY_PATH,
  LEDGER_PATH,
} from '../src/lib/governed-state.js';
import { writeDispatchBundle } from '../src/lib/dispatch-bundle.js';
import {
  getDispatchAssignmentPath,
  getDispatchPromptPath,
  getTurnStagingResultPath,
} from '../src/lib/turn-paths.js';

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
      dev_a: {
        title: 'Developer A',
        mandate: 'Implement assigned work.',
        write_authority: 'authoritative',
        runtime_class: 'local_cli',
        runtime_id: 'local-dev-a',
      },
      dev_b: {
        title: 'Developer B',
        mandate: 'Implement assigned work.',
        write_authority: 'authoritative',
        runtime_class: 'local_cli',
        runtime_id: 'local-dev-b',
      },
    },
    runtimes: {
      'local-dev-a': { type: 'local_cli' },
      'local-dev-b': { type: 'local_cli' },
    },
    routing: {
      planning: {
        entry_role: 'dev_a',
        allowed_next_roles: ['dev_a', 'dev_b', 'human'],
        exit_gate: null,
        max_concurrent_turns: 2,
      },
    },
    gates: {},
    budget: { per_turn_max_usd: 2.0, per_run_max_usd: 50.0 },
    rules: { challenge_required: true, max_turn_retries: 2, max_deadlock_cycles: 2 },
    files: { talk: 'TALK.md', history: '.agentxchain/history.jsonl', state: '.agentxchain/state.json' },
    compat: { next_owner_source: 'state-json', lock_based_coordination: false, original_version: 4 },
  };
}

function stageTurnResult(root, state, turn, overrides = {}) {
  const base = {
    schema_version: '1.0',
    run_id: state.run_id,
    turn_id: turn.turn_id,
    role: turn.assigned_role,
    runtime_id: turn.runtime_id,
    status: 'completed',
    summary: `Turn completed by ${turn.assigned_role}.`,
    decisions: [{
      id: 'DEC-001',
      category: 'implementation',
      statement: `Completed ${turn.assigned_role}.`,
      rationale: 'Required for test coverage.',
    }],
    objections: [{
      id: 'OBJ-001',
      severity: 'low',
      statement: 'Minor concern noted.',
      status: 'raised',
    }],
    files_changed: [],
    artifacts_created: [],
    verification: {
      status: 'pass',
      commands: ['echo ok'],
      evidence_summary: 'Synthetic pass for integration test.',
      machine_evidence: [{ command: 'echo ok', exit_code: 0 }],
    },
    artifact: { type: 'workspace', ref: null },
    proposed_next_role: 'human',
    phase_transition_request: null,
    run_completion_request: null,
    needs_human_reason: null,
    cost: { input_tokens: 100, output_tokens: 50, usd: 0.01 },
  };

  const result = { ...base, ...overrides };
  const stagingPath = join(root, getTurnStagingResultPath(turn.turn_id));
  mkdirSync(dirname(stagingPath), { recursive: true });
  writeFileSync(stagingPath, JSON.stringify(result, null, 2));
  return result;
}

describe('E2E parallel lifecycle', () => {
  let root;
  let config;

  before(() => {
    root = join(tmpdir(), `axc-e2e-parallel-${randomBytes(6).toString('hex')}`);
    cpSync(EXAMPLE_DIR, root, { recursive: true });

    execSync('git init', { cwd: root, stdio: 'ignore' });
    execSync('git add -A', { cwd: root, stdio: 'ignore' });
    execSync('git -c user.name="test" -c user.email="test@test" commit -m "initial"', { cwd: root, stdio: 'ignore' });

    config = makeConfig();
  });

  after(() => {
    try { rmSync(root, { recursive: true, force: true }); } catch {}
  });

  it('accepts a rebased retry after parallel conflict rejection', () => {
    const sharedFile = '.planning/shared-conflict.md';
    const retryOnlyFile = '.planning/retry-followup.md';

    writeFileSync(join(root, sharedFile), '# base\n');
    execSync('git add -A', { cwd: root, stdio: 'ignore' });
    execSync('git -c user.name="test" -c user.email="test@test" commit -m "seed shared baseline"', { cwd: root, stdio: 'ignore' });

    const initResult = initializeGovernedRun(root, config);
    assert.ok(initResult.ok, `initializeGovernedRun failed: ${initResult.error}`);

    const firstAssign = assignGovernedTurn(root, config, 'dev_a');
    assert.ok(firstAssign.ok, `assignGovernedTurn(dev_a) failed: ${firstAssign.error}`);

    const secondAssign = assignGovernedTurn(root, config, 'dev_b');
    assert.ok(secondAssign.ok, `assignGovernedTurn(dev_b) failed: ${secondAssign.error}`);

    const firstTurn = firstAssign.state.current_turn;
    const secondTurnId = Object.keys(secondAssign.state.active_turns).find(id => id !== firstTurn.turn_id);
    const secondTurn = secondAssign.state.active_turns[secondTurnId];
    const originalSecondAssignedSequence = secondTurn.assigned_sequence;
    const originalSecondBaselineCapturedAt = secondTurn.baseline?.captured_at;

    const firstBundle = writeDispatchBundle(root, secondAssign.state, config, { turnId: firstTurn.turn_id });
    const secondBundle = writeDispatchBundle(root, secondAssign.state, config, { turnId: secondTurnId });
    assert.ok(firstBundle.ok, `writeDispatchBundle(first) failed: ${firstBundle.error}`);
    assert.ok(secondBundle.ok, `writeDispatchBundle(second) failed: ${secondBundle.error}`);
    assert.ok(existsSync(join(root, getDispatchAssignmentPath(firstTurn.turn_id))));
    assert.ok(existsSync(join(root, getDispatchAssignmentPath(secondTurnId))));

    writeFileSync(join(root, sharedFile), '# accepted from dev_a\n');
    stageTurnResult(root, secondAssign.state, firstTurn, {
      files_changed: [sharedFile],
    });

    const acceptFirst = acceptGovernedTurn(root, config, { turnId: firstTurn.turn_id });
    assert.ok(acceptFirst.ok, `acceptGovernedTurn(first) failed: ${acceptFirst.error}`);
    assert.equal(Object.keys(acceptFirst.state.active_turns).length, 1);

    stageTurnResult(root, acceptFirst.state, secondTurn, {
      files_changed: [sharedFile, 'TALK.md'],
    });

    const conflictResult = acceptGovernedTurn(root, config, { turnId: secondTurnId });
    assert.equal(conflictResult.ok, false);
    assert.equal(conflictResult.error_code, 'conflict');
    assert.equal(conflictResult.state.active_turns[secondTurnId].status, 'conflicted');
    assert.equal(conflictResult.state.active_turns[secondTurnId].conflict_state.detection_count, 1);

    const rejectResult = rejectGovernedTurn(
      root,
      config,
      { errors: ['File conflict detected'], failed_stage: 'conflict' },
      { turnId: secondTurnId, reassign: true, reason: 'Rebase on accepted sibling work' },
    );
    assert.ok(rejectResult.ok, `rejectGovernedTurn failed: ${rejectResult.error}`);
    assert.equal(rejectResult.escalated, false);
    assert.equal(rejectResult.turn.turn_id, secondTurnId);
    assert.equal(rejectResult.turn.attempt, 2);
    assert.equal(rejectResult.turn.status, 'retrying');
    assert.equal(rejectResult.turn.conflict_state, null);
    assert.deepEqual(rejectResult.turn.conflict_context.conflicting_files, [sharedFile]);
    assert.equal(rejectResult.turn.concurrent_with.length, 0);
    assert.equal(rejectResult.turn.baseline.clean, false);
    assert.notEqual(rejectResult.turn.baseline?.captured_at, originalSecondBaselineCapturedAt);
    assert.ok(
      rejectResult.turn.assigned_sequence > originalSecondAssignedSequence,
      'Expected conflict reassign to refresh assigned_sequence',
    );

    const retryBundle = writeDispatchBundle(root, rejectResult.state, config, { turnId: secondTurnId });
    assert.ok(retryBundle.ok, `writeDispatchBundle(retry) failed: ${retryBundle.error}`);

    const retryAssignment = readJson(root, getDispatchAssignmentPath(secondTurnId));
    const retryPrompt = readFileSync(join(root, getDispatchPromptPath(secondTurnId)), 'utf8');
    assert.equal(retryAssignment.turn_id, secondTurnId);
    assert.equal(retryAssignment.attempt, 2);
    assert.deepEqual(retryAssignment.conflict_context.conflicting_files, [sharedFile]);
    assert.match(retryPrompt, /File Conflict/);
    assert.match(retryPrompt, /Retry Required/);

    writeFileSync(join(root, retryOnlyFile), '# retry content\n');
    stageTurnResult(root, readJson(root, STATE_PATH), rejectResult.turn, {
      files_changed: [retryOnlyFile],
      summary: 'Retry accepted after rebasing on sibling work.',
    });

    const acceptRetry = acceptGovernedTurn(root, config, { turnId: secondTurnId });
    assert.ok(acceptRetry.ok, `acceptGovernedTurn(retry) failed: ${acceptRetry.error}`);
    assert.equal(Object.keys(acceptRetry.state.active_turns).length, 0);
    assert.equal(acceptRetry.state.last_completed_turn_id, secondTurnId);

    const history = readJsonl(root, HISTORY_PATH);
    assert.equal(history.length, 2);
    assert.deepEqual(history.map(entry => entry.turn_id), [firstTurn.turn_id, secondTurnId]);
    assert.ok(history[1].assigned_sequence > originalSecondAssignedSequence);
    assert.ok(history[1].accepted_sequence > history[0].accepted_sequence);

    const ledger = readJsonl(root, LEDGER_PATH);
    assert.ok(ledger.some(entry => entry.decision === 'conflict_detected'));
    assert.ok(ledger.some(entry => entry.decision === 'conflict_rejected'));

    assert.equal(readFileSync(join(root, sharedFile), 'utf8'), '# accepted from dev_a\n');
    assert.equal(readFileSync(join(root, retryOnlyFile), 'utf8'), '# retry content\n');
  });
});
