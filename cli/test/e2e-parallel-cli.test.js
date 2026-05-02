/**
 * E2E Parallel CLI Test — Governed v1.1
 *
 * Validates the operator-facing parallel-turn workflow through real CLI
 * subprocesses rather than direct library calls.
 *
 * See: .planning/E2E_PARALLEL_CLI_SPEC.md
 *
 * Path A only: multi-turn status → ambiguous resume rejection →
 * targeted acceptance → conflict persistence → reject-and-reassign →
 * rebased retry acceptance.
 */

import { describe, it, beforeAll, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  cpSync,
  existsSync,
} from 'fs';
import { dirname, join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';
import { execSync, spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

import {
  initializeGovernedRun,
  assignGovernedTurn,
  normalizeGovernedStateShape,
  getActiveTurn,
  STATE_PATH,
  HISTORY_PATH,
  LEDGER_PATH,
} from '../src/lib/governed-state.js';
import { writeDispatchBundle } from '../src/lib/dispatch-bundle.js';
import { loadNormalizedConfig } from '../src/lib/normalized-config.js';
import {
  getDispatchAssignmentPath,
  getDispatchPromptPath,
  getDispatchTurnDir,
  getTurnStagingResultPath,
  getTurnStagingDir,
} from '../src/lib/turn-paths.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(__dirname, '..', 'bin', 'agentxchain.js');
const EXAMPLE_DIR = join(__dirname, '..', '..', 'examples', 'governed-todo-app');

// ── Helpers ──────────────────────────────────────────────────────────────────

function runCli(cwd, args) {
  const result = spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 15000,
  });
  return {
    exit_code: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    combined: (result.stdout || '') + (result.stderr || ''),
  };
}

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
  return content.split('\n').map((line) => JSON.parse(line));
}

function makeRawConfig() {
  return {
    schema_version: '1.0',
    project: {
      id: 'parallel-cli-test',
      name: 'Parallel CLI Test',
      default_branch: 'main',
    },
    roles: {
      dev_a: {
        title: 'Developer A',
        mandate: 'Implement assigned work.',
        write_authority: 'authoritative',
        runtime: 'manual-a',
      },
      dev_b: {
        title: 'Developer B',
        mandate: 'Implement assigned work.',
        write_authority: 'authoritative',
        runtime: 'manual-b',
      },
    },
    runtimes: {
      'manual-a': { type: 'manual' },
      'manual-b': { type: 'manual' },
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
    decisions: [
      {
        id: 'DEC-001',
        category: 'implementation',
        statement: `Completed ${turn.assigned_role}.`,
        rationale: 'Required for test coverage.',
      },
    ],
    objections: [
      {
        id: 'OBJ-001',
        severity: 'low',
        statement: 'Minor concern noted.',
        status: 'raised',
      },
    ],
    files_changed: [],
    artifacts_created: [],
    verification: {
      status: 'pass',
      commands: ['echo ok'],
      evidence_summary: 'Synthetic pass for integration test.',
      machine_evidence: [{ command: 'echo ok', exit_code: 0 }],
    },
    artifact: { type: 'review', ref: null },
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

// ── Test Suite ───────────────────────────────────────────────────────────────

describe('E2E parallel CLI (Path A)', () => {
  let root;
  let config;
  let firstTurnId;
  let secondTurnId;
  let firstTurn;
  let secondTurn;

  beforeAll(() => {
    // Set up governed repo with git
    root = join(
      tmpdir(),
      `axc-e2e-parallel-cli-${randomBytes(6).toString('hex')}`,
    );
    cpSync(EXAMPLE_DIR, root, { recursive: true });

    // Write the raw config (CLI reads this via loadProjectContext)
    const rawConfig = makeRawConfig();
    writeFileSync(
      join(root, 'agentxchain.json'),
      JSON.stringify(rawConfig, null, 2),
    );

    execSync('git init', { cwd: root, stdio: 'ignore' });
    execSync('git add -A', { cwd: root, stdio: 'ignore' });
    execSync(
      'git -c user.name="test" -c user.email="test@test" commit -m "initial"',
      { cwd: root, stdio: 'ignore' },
    );

    // Normalize the raw config for library calls
    const normalized = loadNormalizedConfig(rawConfig);
    assert.ok(normalized.ok, `loadNormalizedConfig failed: ${normalized.errors}`);
    config = normalized.normalized;

    // Seed a shared file for conflict testing
    mkdirSync(join(root, '.planning'), { recursive: true });
    writeFileSync(join(root, '.planning', 'shared.md'), '# base\n');
    execSync('git add -A', { cwd: root, stdio: 'ignore' });
    execSync(
      'git -c user.name="test" -c user.email="test@test" commit -m "seed shared baseline"',
      { cwd: root, stdio: 'ignore' },
    );

    // Initialize governed run and assign two concurrent turns using library
    // (CLI `step` would try to dispatch via adapter, so we use the library
    // for setup and exercise CLI for observation + acceptance + rejection)
    const initResult = initializeGovernedRun(root, config);
    assert.ok(initResult.ok, `initializeGovernedRun failed: ${initResult.error}`);

    const firstAssign = assignGovernedTurn(root, config, 'dev_a');
    assert.ok(firstAssign.ok, `assignGovernedTurn(dev_a) failed: ${firstAssign.error}`);

    const secondAssign = assignGovernedTurn(root, config, 'dev_b');
    assert.ok(secondAssign.ok, `assignGovernedTurn(dev_b) failed: ${secondAssign.error}`);

    // Identify turns
    const turnIds = Object.keys(secondAssign.state.active_turns);
    firstTurnId = turnIds.find(
      (id) => secondAssign.state.active_turns[id].assigned_role === 'dev_a',
    );
    secondTurnId = turnIds.find(
      (id) => secondAssign.state.active_turns[id].assigned_role === 'dev_b',
    );
    firstTurn = secondAssign.state.active_turns[firstTurnId];
    secondTurn = secondAssign.state.active_turns[secondTurnId];

    // Write dispatch bundles
    const b1 = writeDispatchBundle(root, secondAssign.state, config, {
      turnId: firstTurnId,
    });
    assert.ok(b1.ok, `writeDispatchBundle(first) failed: ${b1.error}`);
    const b2 = writeDispatchBundle(root, secondAssign.state, config, {
      turnId: secondTurnId,
    });
    assert.ok(b2.ok, `writeDispatchBundle(second) failed: ${b2.error}`);
  });

  afterAll(() => {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {}
  });

  // ── Scenario A: Multi-Turn Targeting Guardrails ────────────────────────────

  it('A1: status --json exposes both active turns', () => {
    const result = runCli(root, ['status', '--json']);
    assert.equal(result.exit_code, 0, result.combined);

    const payload = JSON.parse(result.stdout);
    const activeTurns = payload.state.active_turns;
    assert.ok(activeTurns[firstTurnId], 'first turn should be in active_turns');
    assert.ok(activeTurns[secondTurnId], 'second turn should be in active_turns');
    assert.equal(activeTurns[firstTurnId].assigned_role, 'dev_a');
    assert.equal(activeTurns[secondTurnId].assigned_role, 'dev_b');
  });

  it('A2: human-readable status lists both active turns', () => {
    const result = runCli(root, ['status']);
    assert.equal(result.exit_code, 0, result.combined);

    // Both turn IDs should appear in output
    assert.match(result.stdout, new RegExp(firstTurnId));
    assert.match(result.stdout, new RegExp(secondTurnId));
    // Both roles should appear
    assert.match(result.stdout, /dev_a/);
    assert.match(result.stdout, /dev_b/);
    // Active turn count
    assert.match(result.stdout, /2 active/);
  });

  it('A3: step --resume without --turn fails when multiple turns active', () => {
    const result = runCli(root, ['step', '--resume']);
    assert.equal(result.exit_code, 1, 'should fail with ambiguity error');
    assert.match(
      result.combined,
      /Multiple active turns|--turn/,
      'should mention multiple turns or --turn flag',
    );

    // State must not have been mutated
    const state = readJson(root, STATE_PATH);
    assert.equal(Object.keys(state.active_turns).length, 2);
    assert.equal(state.active_turns[firstTurnId].status, 'assigned');
    assert.equal(state.active_turns[secondTurnId].status, 'assigned');
  });

  // ── Scenario B: Targeted Acceptance ────────────────────────────────────────

  it('B1: accept-turn --turn <first_id> accepts only the targeted turn', () => {
    // Modify the shared file (accepted content from dev_a)
    writeFileSync(join(root, '.planning', 'shared.md'), '# accepted from dev_a\n');

    // Stage a valid result for the first turn
    const state = readJson(root, STATE_PATH);
    stageTurnResult(root, state, state.active_turns[firstTurnId], {
      files_changed: ['.planning/shared.md'],
      artifact: { type: 'workspace', ref: null },
    });

    const result = runCli(root, ['accept-turn', '--turn', firstTurnId]);
    assert.equal(result.exit_code, 0, result.combined);
    assert.match(result.stdout, /Turn Accepted/);

    // Verify state
    const updatedState = readJson(root, STATE_PATH);

    // Exactly one history entry added
    const history = readJsonl(root, HISTORY_PATH);
    assert.equal(history.length, 1);
    assert.equal(history[0].turn_id, firstTurnId);
    assert.equal(history[0].role, 'dev_a');

    // Sibling turn remains active
    assert.ok(
      updatedState.active_turns[secondTurnId],
      'sibling turn should remain active',
    );
    assert.equal(updatedState.active_turns[secondTurnId].status, 'assigned');

    // Accepted turn removed from active_turns
    assert.equal(
      updatedState.active_turns[firstTurnId],
      undefined,
      'accepted turn should be removed from active_turns',
    );

    // Turn-scoped artifacts for accepted turn cleaned up
    assert.equal(
      existsSync(join(root, getTurnStagingResultPath(firstTurnId))),
      false,
      'accepted turn staging should be cleaned up',
    );

    // Sibling dispatch artifacts remain intact
    assert.ok(
      existsSync(join(root, getDispatchAssignmentPath(secondTurnId))),
      'sibling dispatch artifacts should remain',
    );
  });

  // ── Scenario C: Conflict Persistence Via CLI ───────────────────────────────

  it('C1: accept-turn on conflicting sibling persists conflict state', () => {
    const state = readJson(root, STATE_PATH);

    // Stage a result for the second turn that overlaps with the accepted file
    stageTurnResult(root, state, state.active_turns[secondTurnId], {
      files_changed: ['.planning/shared.md', 'TALK.md'],
      artifact: { type: 'workspace', ref: null },
    });

    const result = runCli(root, ['accept-turn', '--turn', secondTurnId]);
    assert.equal(result.exit_code, 1, 'conflict should cause non-zero exit');
    assert.match(result.combined, /Conflict/i, 'should mention conflict');

    // Verify conflict state
    const updatedState = readJson(root, STATE_PATH);
    const conflicted = updatedState.active_turns[secondTurnId];
    assert.equal(conflicted.status, 'conflicted');
    assert.ok(conflicted.conflict_state);
    assert.equal(conflicted.conflict_state.detection_count, 1);

    // Decision ledger records conflict_detected
    const ledger = readJsonl(root, LEDGER_PATH);
    assert.ok(
      ledger.some((e) => e.decision === 'conflict_detected'),
      'ledger should record conflict_detected',
    );
  });

  it('C2: status renders conflict banner after conflict', () => {
    const result = runCli(root, ['status']);
    assert.equal(result.exit_code, 0, result.combined);

    // Should render the conflicted turn
    assert.match(result.stdout, /conflicted/i);
    // Should mention file count or conflict
    assert.match(result.stdout, /file/i);
    // Should suggest both recovery commands
    assert.match(result.stdout, /reject-turn/);
    assert.match(result.stdout, /reassign/);
    assert.match(result.stdout, /accept-turn/);
    assert.match(result.stdout, /human_merge/);
  });

  // ── Scenario D: Reject And Reassign Via CLI ────────────────────────────────

  it('D1: reject-turn --turn <id> --reassign preserves turn_id and increments attempt', () => {
    const stateBefore = readJson(root, STATE_PATH);
    const conflicted = stateBefore.active_turns[secondTurnId];
    const originalAttempt = conflicted.attempt;
    const originalAssignedSequence = conflicted.assigned_sequence;

    const result = runCli(root, [
      'reject-turn',
      '--turn',
      secondTurnId,
      '--reason',
      'rebase on accepted sibling',
      '--reassign',
    ]);
    assert.equal(result.exit_code, 0, result.combined);
    assert.match(result.stdout, /Turn Rejected/);

    // Verify state
    const updatedState = readJson(root, STATE_PATH);
    const retrying = updatedState.active_turns[secondTurnId];

    // Same turn_id preserved
    assert.ok(retrying, 'turn_id should be preserved in active_turns');

    // Attempt incremented
    assert.equal(retrying.attempt, originalAttempt + 1);

    // Conflict state cleared
    assert.equal(retrying.conflict_state, null);

    // assigned_sequence refreshed
    assert.ok(
      retrying.assigned_sequence > originalAssignedSequence,
      'assigned_sequence should be refreshed',
    );

    // Decision ledger records conflict_rejected
    const ledger = readJsonl(root, LEDGER_PATH);
    assert.ok(
      ledger.some((e) => e.decision === 'conflict_rejected'),
      'ledger should record conflict_rejected',
    );
  });

  it('D2: redispatched bundle contains conflict context', () => {
    // The reject-turn --reassign command should have rewritten the dispatch bundle
    const assignment = readJson(root, getDispatchAssignmentPath(secondTurnId));
    assert.equal(assignment.turn_id, secondTurnId);
    assert.equal(assignment.attempt, 2);
    assert.ok(
      assignment.conflict_context,
      'ASSIGNMENT.json should contain conflict_context',
    );
    assert.ok(
      assignment.conflict_context.conflicting_files?.length > 0,
      'conflict_context should list conflicting files',
    );

    const prompt = readFileSync(
      join(root, getDispatchPromptPath(secondTurnId)),
      'utf8',
    );
    assert.match(prompt, /File Conflict/);
    assert.match(prompt, /Retry Required/);
  });

  // ── Scenario E: Successful Rebased Retry ───────────────────────────────────

  it('E1: rebased retry accepted through accept-turn drains the run cleanly', () => {
    const state = readJson(root, STATE_PATH);
    const retrying = state.active_turns[secondTurnId];

    // Stage a new result that avoids the conflicting file
    const retryOnlyFile = '.planning/retry-followup.md';
    writeFileSync(join(root, retryOnlyFile), '# retry content\n');

    stageTurnResult(root, state, retrying, {
      files_changed: [retryOnlyFile],
      artifact: { type: 'workspace', ref: null },
      summary: 'Retry accepted after rebasing on sibling work.',
    });

    const result = runCli(root, ['accept-turn', '--turn', secondTurnId]);
    assert.equal(result.exit_code, 0, result.combined);
    assert.match(result.stdout, /Turn Accepted/);

    // Verify run drained cleanly
    const finalState = readJson(root, STATE_PATH);
    assert.equal(
      Object.keys(finalState.active_turns).length,
      0,
      'active_turns should be empty',
    );

    // History has exactly two accepted entries
    const history = readJsonl(root, HISTORY_PATH);
    assert.equal(history.length, 2);
    assert.equal(history[0].turn_id, firstTurnId);
    assert.equal(history[1].turn_id, secondTurnId);

    // Deterministic accepted_sequence ordering
    assert.ok(
      history[1].accepted_sequence > history[0].accepted_sequence,
      'accepted_sequence should be monotonically increasing',
    );

    // No stale staging or dispatch artifacts for either turn
    assert.equal(
      existsSync(join(root, getTurnStagingResultPath(firstTurnId))),
      false,
      'first turn staging should be cleaned up',
    );
    assert.equal(
      existsSync(join(root, getTurnStagingResultPath(secondTurnId))),
      false,
      'second turn staging should be cleaned up',
    );
    assert.equal(
      existsSync(join(root, getDispatchTurnDir(firstTurnId))),
      false,
      'first turn dispatch should be cleaned up',
    );
    assert.equal(
      existsSync(join(root, getDispatchTurnDir(secondTurnId))),
      false,
      'second turn dispatch should be cleaned up',
    );

    // Shared file preserves accepted content (not overwritten by retry)
    assert.equal(
      readFileSync(join(root, '.planning', 'shared.md'), 'utf8'),
      '# accepted from dev_a\n',
    );
  });
});
