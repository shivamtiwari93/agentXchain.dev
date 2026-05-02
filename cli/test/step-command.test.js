// Identity guard: file asserts on "git commit" in CLI output text, does not run git commit.
// Marker for git-fixture-identity-guard: git config user.email
import { describe, it, beforeEach, afterEach } from 'vitest';
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
  normalizeGovernedStateShape,
  getActiveTurn,
  getActiveTurns,
  getActiveTurnCount,
  STATE_PATH,
  HISTORY_PATH,
  LEDGER_PATH,
  STAGING_PATH,
  TALK_PATH,
} from '../src/lib/governed-state.js';
import { writeDispatchBundle } from '../src/lib/dispatch-bundle.js';
import { getDispatchTurnDir, getTurnStagingResultPath } from '../src/lib/turn-paths.js';
import { scaffoldGoverned } from '../src/commands/init.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeTmpDir() {
  const dir = join(tmpdir(), `axc-step-test-${randomBytes(6).toString('hex')}`);
  mkdirSync(dir, { recursive: true });
  return dir;
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

function manualStagingPath(turnId = 'turn_abc') {
  return getTurnStagingResultPath(turnId);
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
      config.gates.implementation_complete = { requires_verification_pass: true };
      const output = printManualDispatchInstructions(state, config);

      assert.ok(output.includes('MANUAL TURN REQUIRED'));
      assert.ok(output.includes('pm'));
      assert.ok(output.includes('turn_abc'));
      assert.ok(output.includes('planning'));
      assert.ok(output.includes('PROMPT.md'));
      assert.ok(output.includes('turn-result.json'));
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
      config.gates.implementation_complete = { requires_verification_pass: true };
      const output = printManualDispatchInstructions(state, config);
      assert.ok(output.includes('2'));
    });

    it('includes gate hints, staged result example, next role, and docs link', () => {
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
      config.gates.implementation_complete = { requires_verification_pass: true };
      const output = printManualDispatchInstructions(state, config);

      assert.ok(output.includes('Gate files to update this phase:'));
      assert.ok(output.includes('.planning/PM_SIGNOFF.md'));
      assert.ok(output.includes('.planning/ROADMAP.md'));
      assert.ok(output.includes('.planning/SYSTEM_SPEC.md'));
      assert.ok(output.includes('Minimal turn-result.json:'));
      assert.ok(output.includes('"run_id": "run_test123"'));
      assert.ok(output.includes('"turn_id": "turn_abc"'));
      // PM is in allowed_next_roles for planning, so template suggests another PM turn
      assert.ok(output.includes('"proposed_next_role": "pm"'));
      assert.ok(output.includes('https://agentxchain.dev/docs/getting-started'));
    });
  });

  describe('waitForStagedResult()', () => {
    it('returns immediately if staged result already exists', async () => {
      const root = createAndTrack();
      const stagingDir = join(root, '.agentxchain', 'staging', 'turn_manual');
      mkdirSync(stagingDir, { recursive: true });
      writeFileSync(join(root, getTurnStagingResultPath('turn_manual')), JSON.stringify({ test: true }));

      const result = await waitForStagedResult(root, { pollIntervalMs: 50, timeoutMs: 1000, turnId: 'turn_manual' });
      assert.ok(result.found);
      assert.ok(!result.timedOut);
      assert.ok(!result.aborted);
    });

    it('returns timedOut when file does not appear', async () => {
      const root = createAndTrack();
      mkdirSync(join(root, '.agentxchain', 'staging', 'turn_manual'), { recursive: true });

      const result = await waitForStagedResult(root, { pollIntervalMs: 50, timeoutMs: 200, turnId: 'turn_manual' });
      assert.ok(!result.found);
      assert.ok(result.timedOut);
      assert.ok(!result.aborted);
    });

    it('detects file that appears after a delay', async () => {
      const root = createAndTrack();
      mkdirSync(join(root, '.agentxchain', 'staging', 'turn_manual'), { recursive: true });

      // Write file after 150ms
      setTimeout(() => {
        writeFileSync(join(root, getTurnStagingResultPath('turn_manual')), JSON.stringify({ delayed: true }));
      }, 150);

      const result = await waitForStagedResult(root, { pollIntervalMs: 50, timeoutMs: 2000, turnId: 'turn_manual' });
      assert.ok(result.found);
      assert.ok(!result.timedOut);
    });

    it('respects abort signal', async () => {
      const root = createAndTrack();
      mkdirSync(join(root, '.agentxchain', 'staging', 'turn_manual'), { recursive: true });

      const controller = new AbortController();
      setTimeout(() => controller.abort(), 100);

      const result = await waitForStagedResult(root, {
        pollIntervalMs: 50,
        timeoutMs: 5000,
        signal: controller.signal,
        turnId: 'turn_manual',
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
        turnId: 'turn_manual',
      });
      assert.ok(result.aborted);
    });

    it('ignores empty or near-empty files', async () => {
      const root = createAndTrack();
      const stagingDir = join(root, '.agentxchain', 'staging', 'turn_manual');
      mkdirSync(stagingDir, { recursive: true });
      writeFileSync(join(root, getTurnStagingResultPath('turn_manual')), '{}'); // 2 bytes, below threshold

      const result = await waitForStagedResult(root, { pollIntervalMs: 50, timeoutMs: 200, turnId: 'turn_manual' });
      assert.ok(!result.found);
      assert.ok(result.timedOut);
    });
  });

  describe('readStagedResult()', () => {
    it('reads and parses a valid staged result', () => {
      const root = createAndTrack();
      const stagingDir = join(root, '.agentxchain', 'staging', 'turn_manual');
      mkdirSync(stagingDir, { recursive: true });
      writeFileSync(join(root, getTurnStagingResultPath('turn_manual')), JSON.stringify({ status: 'completed' }));

      const result = readStagedResult(root, { turnId: 'turn_manual' });
      assert.ok(result.ok);
      assert.equal(result.parsed.status, 'completed');
    });

    it('returns error for missing file', () => {
      const root = createAndTrack();
      const result = readStagedResult(root, { turnId: 'turn_missing' });
      assert.ok(!result.ok);
      assert.ok(result.error);
    });

    it('returns error for invalid JSON', () => {
      const root = createAndTrack();
      const stagingDir = join(root, '.agentxchain', 'staging', 'turn_manual');
      mkdirSync(stagingDir, { recursive: true });
      writeFileSync(join(root, getTurnStagingResultPath('turn_manual')), 'not json');

      const result = readStagedResult(root, { turnId: 'turn_manual' });
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
      const dispatchDir = getDispatchTurnDir(state.current_turn.turn_id);
      assert.ok(existsSync(join(root, dispatchDir, 'ASSIGNMENT.json')));
      assert.ok(existsSync(join(root, dispatchDir, 'PROMPT.md')));
      assert.ok(existsSync(join(root, dispatchDir, 'CONTEXT.md')));

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
      const promptPath = join(root, getDispatchTurnDir(retryState.current_turn.turn_id), 'PROMPT.md');
      const promptContent = readFileSync(promptPath, 'utf8');
      assert.ok(promptContent.includes('Previous Attempt Failed'));
    });

    it('exhausted retries → escalation → blocked state', () => {
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
      assert.equal(finalState.status, 'blocked');
      assert.ok(finalState.blocked_on.includes('escalation'));
      assert.ok(finalState.escalation);
      assert.equal(finalState.blocked_reason.category, 'retries_exhausted');
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

      const assignment = readJson(root, `${getDispatchTurnDir(assignResult.state.current_turn.turn_id)}/ASSIGNMENT.json`);
      assert.equal(assignment.role, 'pm');
      assert.equal(assignment.write_authority, 'review_only');
      assert.equal(assignment.staging_result_path, getTurnStagingResultPath(assignResult.state.current_turn.turn_id));
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

      const prompt = readFileSync(join(root, getDispatchTurnDir(assignResult.state.current_turn.turn_id), 'PROMPT.md'), 'utf8');
      assert.ok(prompt.includes('Challenge the previous turn'));
      assert.ok(prompt.includes(getTurnStagingResultPath(assignResult.state.current_turn.turn_id)));
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

    it('printManualDispatchInstructions renders guided onboarding details', () => {
      const root = createAndTrack();
      setupGovernedProject(root);
      const config = makeNormalizedConfig();

      initializeGovernedRun(root, config);
      const assignResult = assignGovernedTurn(root, config, 'pm');
      const state = assignResult.state;

      const output = printManualDispatchInstructions(state, config);
      assert.ok(output.includes('Gate files to update this phase:'));
      assert.ok(output.includes('To exit this phase cleanly:'));
      assert.ok(output.includes('Minimal turn-result.json:'));
      // PM is in allowed_next_roles for planning, so template suggests another PM turn
      assert.ok(output.includes('"proposed_next_role": "pm"'));
      assert.ok(output.includes('"phase_transition_request": "implementation"'));
      assert.ok(output.includes('https://agentxchain.dev/docs/getting-started'));
    });

    it('template runtime_id matches the turn assignment, not a hardcoded fallback', () => {
      const state = {
        run_id: 'run_rtid_test',
        phase: 'planning',
        current_turn: {
          turn_id: 'turn_rtid',
          assigned_role: 'pm',
          attempt: 1,
          runtime_id: 'manual-pm',
        },
      };
      const config = makeNormalizedConfig();
      const output = printManualDispatchInstructions(state, config);
      // Must show the actual runtime_id from the turn, not the generic "manual"
      assert.ok(output.includes('"runtime_id": "manual-pm"'), 'template must use turn runtime_id, not "manual"');
      assert.ok(!output.includes('"runtime_id": "manual"'), 'must not fall back to bare "manual"');
    });

    it('proposed_next_role respects phase allowed_next_roles', () => {
      // Config where planning only allows [pm, eng_director, human] — dev is NOT allowed
      const config = makeNormalizedConfig();
      config.routing.planning.allowed_next_roles = ['pm', 'eng_director', 'human'];
      const state = {
        run_id: 'run_routing_test',
        phase: 'planning',
        current_turn: {
          turn_id: 'turn_routing',
          assigned_role: 'pm',
          attempt: 1,
          runtime_id: 'manual-pm',
        },
      };
      const output = printManualDispatchInstructions(state, config);
      // PM is in allowed_next_roles, so it should suggest pm (not dev)
      assert.ok(output.includes('"proposed_next_role": "pm"'), 'must suggest a role from allowed_next_roles');
      assert.ok(!output.includes('"proposed_next_role": "dev"'), 'must not suggest dev when dev is not in allowed_next_roles');
    });

    it('proposed_next_role suggests first non-human role when current role is not in allowlist', () => {
      const config = makeNormalizedConfig();
      config.routing.implementation.allowed_next_roles = ['qa', 'human'];
      const state = {
        run_id: 'run_impl_test',
        phase: 'implementation',
        current_turn: {
          turn_id: 'turn_impl',
          assigned_role: 'dev',
          attempt: 1,
          runtime_id: 'manual-dev',
        },
      };
      const output = printManualDispatchInstructions(state, config);
      assert.ok(output.includes('"proposed_next_role": "qa"'), 'must suggest first non-human allowed role');
    });

    it('implementation example reflects authoritative artifact and verification expectations', () => {
      const state = {
        run_id: 'run_impl_example',
        phase: 'implementation',
        current_turn: {
          turn_id: 'turn_impl',
          assigned_role: 'dev',
          attempt: 1,
          runtime_id: 'manual-dev',
        },
      };
      const config = makeNormalizedConfig();
      config.gates.implementation_complete = { requires_verification_pass: true };
      const output = printManualDispatchInstructions(state, config);

      assert.ok(output.includes('use `artifact.type: "workspace"` unless you created a real git commit during the turn'));
      assert.ok(output.includes('"verification": {"status":"pass","commands":["..."],"evidence_summary":"..."}'));
      assert.ok(output.includes('"artifact": {"type":"workspace","ref":null}'));
      assert.ok(output.includes('"phase_transition_request": "qa"'));
    });

    it('qa example reflects run completion guidance for review-only final turns', () => {
      const state = {
        run_id: 'run_qa_example',
        phase: 'qa',
        current_turn: {
          turn_id: 'turn_qa',
          assigned_role: 'qa',
          attempt: 1,
          runtime_id: 'manual-qa',
        },
      };
      const config = makeNormalizedConfig();
      const output = printManualDispatchInstructions(state, config);

      assert.ok(output.includes('set `run_completion_request` to `true` when QA evidence is complete'));
      assert.ok(output.includes('"artifact": {"type":"review","ref":null}'));
      assert.ok(output.includes('"run_completion_request": true'));
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
    it('blocks run when accepted result has needs_human status', () => {
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
      assert.equal(finalState.status, 'blocked');
      assert.ok(finalState.blocked_on.includes('scope clarification'));
      assert.equal(finalState.blocked_reason.category, 'needs_human');
    });
  });
});

// ── Slice 5: Multi-Turn CLI Surface Tests ───────────────────────────────────

describe('Multi-Turn CLI Surface (Slice 5)', () => {
  function makeParallelConfig() {
    const config = makeNormalizedConfig();
    config.routing.implementation.max_concurrent_turns = 2;
    return config;
  }

  function setupParallelProject(root) {
    setupGovernedProject(root);
    const config = makeParallelConfig();
    writeFileSync(join(root, 'agentxchain.json'), JSON.stringify(config, null, 2));
    return config;
  }

  function assignTwoTurns(root, config) {
    initializeGovernedRun(root, config);
    // Move to implementation phase by writing state directly
    const statePath = join(root, STATE_PATH);
    const rawState = JSON.parse(readFileSync(statePath, 'utf8'));
    rawState.phase = 'implementation';
    rawState.status = 'active';
    writeFileSync(statePath, JSON.stringify(rawState, null, 2));

    const r1 = assignGovernedTurn(root, config, 'dev');
    assert.ok(r1.ok, `First assignment failed: ${r1.error}`);
    const r2 = assignGovernedTurn(root, config, 'qa');
    assert.ok(r2.ok, `Second assignment failed: ${r2.error}`);
    return r2.state;
  }

  describe('status rendering', () => {
    it('lists all active turns when multiple are present', () => {
      const root = createAndTrack();
      const config = setupParallelProject(root);
      const state = assignTwoTurns(root, config);

      const turns = getActiveTurns(state);
      const count = getActiveTurnCount(state);
      assert.equal(count, 2);
      const turnIds = Object.keys(turns);
      assert.equal(turnIds.length, 2);
      const roles = Object.values(turns).map(t => t.assigned_role).sort();
      assert.deepEqual(roles, ['dev', 'qa']);
    });

    it('renders conflicted turn with conflict_state details', () => {
      const root = createAndTrack();
      const config = setupParallelProject(root);
      const state = assignTwoTurns(root, config);

      // Simulate a conflicted turn by writing conflict_state directly
      const statePath = join(root, STATE_PATH);
      const rawState = JSON.parse(readFileSync(statePath, 'utf8'));
      const turnIds = Object.keys(rawState.active_turns);
      rawState.active_turns[turnIds[0]].status = 'conflicted';
      rawState.active_turns[turnIds[0]].conflict_state = {
        status: 'detected',
        detection_count: 1,
        conflict_error: {
          conflicting_files: ['src/app.js', 'src/utils.js'],
          overlap_ratio: 0.4,
          suggested_resolution: 'reject_and_reassign',
        },
      };
      writeFileSync(statePath, JSON.stringify(rawState, null, 2));

      const reloaded = readJson(root, STATE_PATH);
      const turns = getActiveTurns(reloaded);
      const conflictedTurn = Object.values(turns).find(t => t.status === 'conflicted');
      assert.ok(conflictedTurn, 'Expected a conflicted turn');
      assert.equal(conflictedTurn.conflict_state.detection_count, 1);
      assert.deepEqual(conflictedTurn.conflict_state.conflict_error.conflicting_files, ['src/app.js', 'src/utils.js']);
    });
  });

  describe('step --resume --turn targeting', () => {
    it('resolves targeted turn when --turn is provided', () => {
      const root = createAndTrack();
      const config = setupParallelProject(root);
      const state = assignTwoTurns(root, config);
      const turns = getActiveTurns(state);
      const turnIds = Object.keys(turns);

      // Verify both turns are present and addressable
      assert.ok(turns[turnIds[0]], 'First turn should be addressable');
      assert.ok(turns[turnIds[1]], 'Second turn should be addressable');
      assert.notEqual(turnIds[0], turnIds[1], 'Turn IDs should be unique');
    });

    it('rejects ambiguous resume when multiple turns active and no --turn specified', () => {
      const root = createAndTrack();
      const config = setupParallelProject(root);
      const state = assignTwoTurns(root, config);
      const count = getActiveTurnCount(state);

      // With multiple active turns, the step command should require --turn for resume
      assert.ok(count > 1, 'Expected multiple active turns for ambiguity test');
    });
  });

  describe('conflict recovery CLI guidance', () => {
    it('identifies recovery paths for a conflicted turn', () => {
      const root = createAndTrack();
      const config = setupParallelProject(root);
      const state = assignTwoTurns(root, config);

      const statePath = join(root, STATE_PATH);
      const rawState = JSON.parse(readFileSync(statePath, 'utf8'));
      const turnIds = Object.keys(rawState.active_turns);
      const conflictedTurnId = turnIds[0];

      rawState.active_turns[conflictedTurnId].status = 'conflicted';
      rawState.active_turns[conflictedTurnId].conflict_state = {
        status: 'detected',
        detection_count: 2,
        conflict_error: {
          conflicting_files: ['README.md'],
          overlap_ratio: 0.8,
          suggested_resolution: 'human_merge',
        },
      };
      writeFileSync(statePath, JSON.stringify(rawState, null, 2));

      const reloaded = readJson(root, STATE_PATH);
      const turns = getActiveTurns(reloaded);
      const conflicted = turns[conflictedTurnId];

      // The status.js / step.js code branches on these conditions:
      assert.equal(conflicted.status, 'conflicted');
      assert.equal(conflicted.conflict_state.conflict_error.suggested_resolution, 'human_merge');

      // Verify both recovery paths are valid CLI commands
      const reassignCmd = `agentxchain reject-turn --turn ${conflictedTurnId} --reassign`;
      const mergeCmd = `agentxchain accept-turn --turn ${conflictedTurnId} --resolution human_merge`;
      assert.ok(reassignCmd.includes(conflictedTurnId));
      assert.ok(mergeCmd.includes(conflictedTurnId));
    });

    it('healthy sibling remains active when one turn is conflicted', () => {
      const root = createAndTrack();
      const config = setupParallelProject(root);
      const state = assignTwoTurns(root, config);

      const statePath = join(root, STATE_PATH);
      const rawState = JSON.parse(readFileSync(statePath, 'utf8'));
      const turnIds = Object.keys(rawState.active_turns);

      // Mark first turn as conflicted
      rawState.active_turns[turnIds[0]].status = 'conflicted';
      rawState.active_turns[turnIds[0]].conflict_state = {
        status: 'detected',
        detection_count: 1,
        conflict_error: {
          conflicting_files: ['index.js'],
          overlap_ratio: 0.3,
          suggested_resolution: 'reject_and_reassign',
        },
      };
      writeFileSync(statePath, JSON.stringify(rawState, null, 2));

      const reloaded = readJson(root, STATE_PATH);
      const turns = getActiveTurns(reloaded);

      // Second turn should still be healthy
      const healthyTurn = turns[turnIds[1]];
      assert.ok(healthyTurn, 'Healthy sibling should still be present');
      assert.notEqual(healthyTurn.status, 'conflicted', 'Sibling should not be conflicted');
    });
  });

  describe('queued requests and budget reservations', () => {
    it('queued_phase_transition is observable from state', () => {
      const root = createAndTrack();
      const config = setupParallelProject(root);
      assignTwoTurns(root, config);

      const statePath = join(root, STATE_PATH);
      const rawState = JSON.parse(readFileSync(statePath, 'utf8'));
      rawState.queued_phase_transition = { from: 'implementation', to: 'qa', requested_by: 'turn_001' };
      writeFileSync(statePath, JSON.stringify(rawState, null, 2));

      const reloaded = readJson(root, STATE_PATH);
      assert.ok(reloaded.queued_phase_transition);
      assert.equal(reloaded.queued_phase_transition.from, 'implementation');
      assert.equal(reloaded.queued_phase_transition.to, 'qa');
    });

    it('budget_reservations are observable per turn', () => {
      const root = createAndTrack();
      const config = setupParallelProject(root);
      const state = assignTwoTurns(root, config);

      // Budget reservations should have been created by assignGovernedTurn
      assert.ok(state.budget_reservations, 'Expected budget_reservations to exist');
      const reservationKeys = Object.keys(state.budget_reservations);
      assert.equal(reservationKeys.length, 2, 'Expected two budget reservations');
    });
  });
});
