import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';

import {
  printManualDispatchInstructions,
  waitForStagedResult,
  readStagedResult,
} from '../src/lib/adapters/manual-adapter.js';
import {
  initializeGovernedRun,
  assignGovernedTurn,
  acceptGovernedTurn,
  rejectGovernedTurn,
  STATE_PATH,
  HISTORY_PATH,
  LEDGER_PATH,
  STAGING_PATH,
  TALK_PATH,
} from '../src/lib/governed-state.js';
import { writeDispatchBundle } from '../src/lib/dispatch-bundle.js';
import { scaffoldGoverned } from '../src/commands/init.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeTmpDir() {
  const dir = join(tmpdir(), `axc-step-test-${randomBytes(6).toString('hex')}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function readJson(root, relPath) {
  return JSON.parse(readFileSync(join(root, relPath), 'utf8'));
}

function readJsonl(root, relPath) {
  const content = readFileSync(join(root, relPath), 'utf8').trim();
  if (!content) return [];
  return content.split('\n').map(line => JSON.parse(line));
}

function makeNormalizedConfig() {
  return {
    schema_version: 4,
    protocol_mode: 'governed',
    project: { id: 'test-project', name: 'Test Project', default_branch: 'main' },
    roles: {
      pm: { title: 'Product Manager', mandate: 'Protect user value.', write_authority: 'review_only', runtime_class: 'manual', runtime_id: 'manual-pm' },
      dev: { title: 'Developer', mandate: 'Implement approved work safely.', write_authority: 'authoritative', runtime_class: 'manual', runtime_id: 'manual-dev' },
      qa: { title: 'QA', mandate: 'Challenge correctness.', write_authority: 'review_only', runtime_class: 'manual', runtime_id: 'manual-qa' },
    },
    runtimes: {
      'manual-pm': { type: 'manual' },
      'manual-dev': { type: 'manual' },
      'manual-qa': { type: 'manual' },
    },
    routing: {
      planning: { entry_role: 'pm', allowed_next_roles: ['pm', 'dev', 'human'], exit_gate: 'planning_signoff' },
      implementation: { entry_role: 'dev', allowed_next_roles: ['dev', 'qa', 'human'], exit_gate: 'implementation_complete' },
      qa: { entry_role: 'qa', allowed_next_roles: ['dev', 'qa', 'human'], exit_gate: 'qa_ship_verdict' },
    },
    gates: {},
    budget: { per_turn_max_usd: 2.0, per_run_max_usd: 50.0 },
    retention: { talk_strategy: 'append_only', history_strategy: 'jsonl_append_only' },
    rules: { challenge_required: true, max_turn_retries: 2 },
    files: { talk: 'TALK.md', history: '.agentxchain/history.jsonl', state: '.agentxchain/state.json' },
    compat: { next_owner_source: 'state-json', lock_based_coordination: false, original_version: 4 },
  };
}

function setupGovernedProject(root) {
  scaffoldGoverned(root, 'Test Project', 'test-project');
}

function makeValidTurnResult(state) {
  const turn = state.current_turn;
  return {
    schema_version: '1.0',
    run_id: state.run_id,
    turn_id: turn.turn_id,
    role: turn.assigned_role,
    runtime_id: turn.runtime_id,
    status: 'completed',
    summary: 'Did the work.',
    decisions: [],
    objections: [
      {
        id: 'OBJ-001',
        severity: 'low',
        statement: 'No issues found.',
        status: 'raised',
      },
    ],
    files_changed: [],
    artifacts_created: [],
    verification: { status: 'skipped' },
    artifact: { type: 'review', ref: null },
    proposed_next_role: 'dev',
    phase_transition_request: null,
    needs_human_reason: null,
    cost: { input_tokens: 100, output_tokens: 50, usd: 0.01 },
  };
}

function writeStagedResult(root, turnResult) {
  const stagingDir = join(root, '.agentxchain', 'staging');
  mkdirSync(stagingDir, { recursive: true });
  writeFileSync(join(root, STAGING_PATH), JSON.stringify(turnResult, null, 2));
}

let tmpDirs = [];
function createAndTrack() {
  const dir = makeTmpDir();
  tmpDirs.push(dir);
  return dir;
}

// ── Cleanup ─────────────────────────────────────────────────────────────────

afterEach(() => {
  for (const dir of tmpDirs) {
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }
  tmpDirs = [];
});

// ── Manual Adapter Tests ────────────────────────────────────────────────────

describe('Manual Adapter', () => {
  describe('printManualDispatchInstructions()', () => {
    it('renders operator instructions with turn metadata', () => {
      const state = {
        run_id: 'run_test123',
        phase: 'planning',
        current_turn: {
          turn_id: 'turn_abc',
          assigned_role: 'pm',
          attempt: 1,
          runtime_id: 'manual-pm',
        },
      };
      const config = makeNormalizedConfig();
      const output = printManualDispatchInstructions(state, config);

      assert.ok(output.includes('MANUAL TURN REQUIRED'));
      assert.ok(output.includes('pm'));
      assert.ok(output.includes('turn_abc'));
      assert.ok(output.includes('planning'));
      assert.ok(output.includes('PROMPT.md'));
      assert.ok(output.includes('staging/turn-result.json'));
    });

    it('shows attempt number for retries', () => {
      const state = {
        run_id: 'run_test123',
        phase: 'planning',
        current_turn: {
          turn_id: 'turn_abc',
          assigned_role: 'pm',
          attempt: 2,
          runtime_id: 'manual-pm',
        },
      };
      const config = makeNormalizedConfig();
      const output = printManualDispatchInstructions(state, config);
      assert.ok(output.includes('2'));
    });
  });

  describe('waitForStagedResult()', () => {
    it('returns immediately if staged result already exists', async () => {
      const root = createAndTrack();
      const stagingDir = join(root, '.agentxchain', 'staging');
      mkdirSync(stagingDir, { recursive: true });
      writeFileSync(join(root, STAGING_PATH), JSON.stringify({ test: true }));

      const result = await waitForStagedResult(root, { pollIntervalMs: 50, timeoutMs: 1000 });
      assert.ok(result.found);
      assert.ok(!result.timedOut);
      assert.ok(!result.aborted);
    });

    it('returns timedOut when file does not appear', async () => {
      const root = createAndTrack();
      mkdirSync(join(root, '.agentxchain', 'staging'), { recursive: true });

      const result = await waitForStagedResult(root, { pollIntervalMs: 50, timeoutMs: 200 });
      assert.ok(!result.found);
      assert.ok(result.timedOut);
      assert.ok(!result.aborted);
    });

    it('detects file that appears after a delay', async () => {
      const root = createAndTrack();
      mkdirSync(join(root, '.agentxchain', 'staging'), { recursive: true });

      // Write file after 150ms
      setTimeout(() => {
        writeFileSync(join(root, STAGING_PATH), JSON.stringify({ delayed: true }));
      }, 150);

      const result = await waitForStagedResult(root, { pollIntervalMs: 50, timeoutMs: 2000 });
      assert.ok(result.found);
      assert.ok(!result.timedOut);
    });

    it('respects abort signal', async () => {
      const root = createAndTrack();
      mkdirSync(join(root, '.agentxchain', 'staging'), { recursive: true });

      const controller = new AbortController();
      setTimeout(() => controller.abort(), 100);

      const result = await waitForStagedResult(root, {
        pollIntervalMs: 50,
        timeoutMs: 5000,
        signal: controller.signal,
      });
      assert.ok(!result.found);
      assert.ok(!result.timedOut);
      assert.ok(result.aborted);
    });

    it('returns aborted immediately if signal is already aborted', async () => {
      const root = createAndTrack();
      const controller = new AbortController();
      controller.abort();

      const result = await waitForStagedResult(root, {
        pollIntervalMs: 50,
        timeoutMs: 5000,
        signal: controller.signal,
      });
      assert.ok(result.aborted);
    });

    it('ignores empty or near-empty files', async () => {
      const root = createAndTrack();
      const stagingDir = join(root, '.agentxchain', 'staging');
      mkdirSync(stagingDir, { recursive: true });
      writeFileSync(join(root, STAGING_PATH), '{}'); // 2 bytes, below threshold

      const result = await waitForStagedResult(root, { pollIntervalMs: 50, timeoutMs: 200 });
      assert.ok(!result.found);
      assert.ok(result.timedOut);
    });
  });

  describe('readStagedResult()', () => {
    it('reads and parses a valid staged result', () => {
      const root = createAndTrack();
      const stagingDir = join(root, '.agentxchain', 'staging');
      mkdirSync(stagingDir, { recursive: true });
      writeFileSync(join(root, STAGING_PATH), JSON.stringify({ status: 'completed' }));

      const result = readStagedResult(root);
      assert.ok(result.ok);
      assert.equal(result.parsed.status, 'completed');
    });

    it('returns error for missing file', () => {
      const root = createAndTrack();
      const result = readStagedResult(root);
      assert.ok(!result.ok);
      assert.ok(result.error);
    });

    it('returns error for invalid JSON', () => {
      const root = createAndTrack();
      const stagingDir = join(root, '.agentxchain', 'staging');
      mkdirSync(stagingDir, { recursive: true });
      writeFileSync(join(root, STAGING_PATH), 'not json');

      const result = readStagedResult(root);
      assert.ok(!result.ok);
      assert.ok(result.error);
    });
  });
});

// ── Integrated Step Flow Tests ──────────────────────────────────────────────

describe('Step Flow Integration', () => {
  describe('full manual turn lifecycle', () => {
    it('idle → init → assign → dispatch → staged result → accept', () => {
      const root = createAndTrack();
      setupGovernedProject(root);
      const config = makeNormalizedConfig();

      // 1. Initialize run
      const initResult = initializeGovernedRun(root, config);
      assert.ok(initResult.ok);
      let state = initResult.state;

      // 2. Assign turn
      const assignResult = assignGovernedTurn(root, config, 'pm');
      assert.ok(assignResult.ok);
      state = assignResult.state;

      // 3. Write dispatch bundle
      const bundleResult = writeDispatchBundle(root, state, config);
      assert.ok(bundleResult.ok);

      // Verify dispatch artifacts exist
      assert.ok(existsSync(join(root, '.agentxchain/dispatch/current/ASSIGNMENT.json')));
      assert.ok(existsSync(join(root, '.agentxchain/dispatch/current/PROMPT.md')));
      assert.ok(existsSync(join(root, '.agentxchain/dispatch/current/CONTEXT.md')));

      // 4. Simulate agent writing staged result
      const turnResult = makeValidTurnResult(state);
      writeStagedResult(root, turnResult);

      // 5. Accept the turn
      const acceptResult = acceptGovernedTurn(root, config);
      assert.ok(acceptResult.ok, `Accept failed: ${acceptResult.error}`);

      // Verify state was updated
      const finalState = readJson(root, STATE_PATH);
      assert.equal(finalState.current_turn, null);
      assert.equal(finalState.last_completed_turn_id, state.current_turn.turn_id);

      // Verify history was appended
      const history = readJsonl(root, HISTORY_PATH);
      assert.ok(history.length >= 1);
      assert.equal(history[history.length - 1].turn_id, state.current_turn.turn_id);

      // Verify staging was cleared
      assert.ok(!existsSync(join(root, STAGING_PATH)));
    });

    it('idle → init → assign → bad result → reject → retry dispatch', () => {
      const root = createAndTrack();
      setupGovernedProject(root);
      const config = makeNormalizedConfig();

      // Init + assign
      initializeGovernedRun(root, config);
      let state = readJson(root, STATE_PATH);
      const assignResult = assignGovernedTurn(root, config, 'pm');
      state = assignResult.state;

      writeDispatchBundle(root, state, config);

      // Write a bad staged result (missing required fields)
      writeStagedResult(root, { bad: true });

      // Reject
      const rejectResult = rejectGovernedTurn(root, config, {
        errors: ['Schema validation failed'],
        failed_stage: 'schema',
      });
      assert.ok(rejectResult.ok);
      assert.ok(!rejectResult.escalated);

      // Verify state has attempt incremented
      const retryState = readJson(root, STATE_PATH);
      assert.equal(retryState.current_turn.attempt, 2);
      assert.equal(retryState.current_turn.status, 'retrying');

      // Re-dispatch
      const retryBundle = writeDispatchBundle(root, retryState, config);
      assert.ok(retryBundle.ok);

      // Verify PROMPT.md includes retry context
      const promptPath = join(root, '.agentxchain/dispatch/current/PROMPT.md');
      const promptContent = readFileSync(promptPath, 'utf8');
      assert.ok(promptContent.includes('Previous Attempt Failed'));
    });

    it('exhausted retries → escalation → paused state', () => {
      const root = createAndTrack();
      setupGovernedProject(root);
      const config = makeNormalizedConfig();

      initializeGovernedRun(root, config);
      assignGovernedTurn(root, config, 'pm');
      let state = readJson(root, STATE_PATH);

      // Reject attempt 1
      writeStagedResult(root, { bad: true });
      rejectGovernedTurn(root, config, { errors: ['bad'], failed_stage: 'schema' });

      // Reject attempt 2 — should escalate
      writeStagedResult(root, { bad: true });
      const result = rejectGovernedTurn(root, config, { errors: ['still bad'], failed_stage: 'schema' });
      assert.ok(result.escalated);

      const finalState = readJson(root, STATE_PATH);
      assert.equal(finalState.status, 'paused');
      assert.ok(finalState.blocked_on.includes('escalation'));
      assert.ok(finalState.escalation);
    });
  });

  describe('dispatch bundle content for manual adapter', () => {
    it('ASSIGNMENT.json contains correct metadata', () => {
      const root = createAndTrack();
      setupGovernedProject(root);
      const config = makeNormalizedConfig();

      initializeGovernedRun(root, config);
      const assignResult = assignGovernedTurn(root, config, 'pm');
      writeDispatchBundle(root, assignResult.state, config);

      const assignment = readJson(root, '.agentxchain/dispatch/current/ASSIGNMENT.json');
      assert.equal(assignment.role, 'pm');
      assert.equal(assignment.write_authority, 'review_only');
      assert.equal(assignment.staging_result_path, '.agentxchain/staging/turn-result.json');
      assert.ok(Array.isArray(assignment.reserved_paths));
      assert.ok(assignment.reserved_paths.includes('.agentxchain/state.json'));
    });

    it('PROMPT.md includes protocol rules and output instructions', () => {
      const root = createAndTrack();
      setupGovernedProject(root);
      const config = makeNormalizedConfig();

      initializeGovernedRun(root, config);
      const assignResult = assignGovernedTurn(root, config, 'dev');
      writeDispatchBundle(root, assignResult.state, config);

      const prompt = readFileSync(join(root, '.agentxchain/dispatch/current/PROMPT.md'), 'utf8');
      assert.ok(prompt.includes('Challenge the previous turn'));
      assert.ok(prompt.includes('staging/turn-result.json'));
      assert.ok(prompt.includes('authoritative'));
    });
  });

  describe('manual dispatch instructions', () => {
    it('printManualDispatchInstructions renders box with correct paths', () => {
      const root = createAndTrack();
      setupGovernedProject(root);
      const config = makeNormalizedConfig();

      initializeGovernedRun(root, config);
      const assignResult = assignGovernedTurn(root, config, 'pm');
      const state = assignResult.state;

      const output = printManualDispatchInstructions(state, config);
      assert.ok(output.includes('MANUAL TURN REQUIRED'));
      assert.ok(output.includes(state.current_turn.turn_id));
      assert.ok(output.includes('PROMPT.md'));
    });
  });

  describe('accepted turn with cost tracking', () => {
    it('budget updates correctly after acceptance', () => {
      const root = createAndTrack();
      setupGovernedProject(root);
      const config = makeNormalizedConfig();

      initializeGovernedRun(root, config);
      const assignResult = assignGovernedTurn(root, config, 'pm');
      const state = assignResult.state;

      const turnResult = makeValidTurnResult(state);
      turnResult.cost = { input_tokens: 5000, output_tokens: 1000, usd: 0.50 };
      writeStagedResult(root, turnResult);

      const acceptResult = acceptGovernedTurn(root, config);
      assert.ok(acceptResult.ok);

      const finalState = readJson(root, STATE_PATH);
      assert.equal(finalState.budget_status.spent_usd, 0.50);
    });
  });

  describe('needs_human status handling', () => {
    it('pauses run when accepted result has needs_human status', () => {
      const root = createAndTrack();
      setupGovernedProject(root);
      const config = makeNormalizedConfig();

      initializeGovernedRun(root, config);
      const assignResult = assignGovernedTurn(root, config, 'pm');
      const state = assignResult.state;

      const turnResult = makeValidTurnResult(state);
      turnResult.status = 'needs_human';
      turnResult.needs_human_reason = 'scope clarification needed';
      writeStagedResult(root, turnResult);

      const acceptResult = acceptGovernedTurn(root, config);
      assert.ok(acceptResult.ok);

      const finalState = readJson(root, STATE_PATH);
      assert.equal(finalState.status, 'paused');
      assert.ok(finalState.blocked_on.includes('scope clarification'));
    });
  });
});
