import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync, chmodSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';
import { execSync } from 'child_process';

import {
  initializeGovernedRun,
  assignGovernedTurn,
  acceptGovernedTurn,
  rejectGovernedTurn,
  markRunBlocked,
  approvePhaseTransition,
  approveRunCompletion,
  normalizeGovernedStateShape,
  getActiveTurn,
  getActiveTurns,
  getActiveTurnCount,
  acquireAcceptanceLock,
  releaseAcceptanceLock,
  replayPreparedJournals,
  STATE_PATH,
  HISTORY_PATH,
  LEDGER_PATH,
  STAGING_PATH,
  TALK_PATH
} from '../src/lib/governed-state.js';
import { getTurnStagingResultPath } from '../src/lib/turn-paths.js';
import { HOOK_AUDIT_PATH, HOOK_ANNOTATIONS_PATH } from '../src/lib/hook-runner.js';
import { scaffoldGoverned } from '../src/commands/init.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeTmpDir() {
  const dir = join(tmpdir(), `axc-test-${randomBytes(6).toString('hex')}`);
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
      pm: { title: 'Product Manager', mandate: 'Test', write_authority: 'review_only', runtime_class: 'manual', runtime_id: 'manual-pm' },
      dev: { title: 'Developer', mandate: 'Test', write_authority: 'authoritative', runtime_class: 'local_cli', runtime_id: 'local-dev' },
      qa: { title: 'QA', mandate: 'Test', write_authority: 'review_only', runtime_class: 'api_proxy', runtime_id: 'api-qa' },
    },
    runtimes: {
      'manual-pm': { type: 'manual' },
      'local-dev': { type: 'local_cli' },
      'api-qa': { type: 'api_proxy' },
    },
    routing: {
      planning: { entry_role: 'pm', allowed_next_roles: ['pm', 'dev', 'human'], exit_gate: 'planning_signoff' },
      implementation: { entry_role: 'dev', allowed_next_roles: ['dev', 'qa', 'human'], exit_gate: 'implementation_complete' },
      qa: { entry_role: 'qa', allowed_next_roles: ['dev', 'qa', 'human'], exit_gate: 'qa_ship_verdict' },
    },
    gates: {},
    budget: { per_turn_max_usd: 2.0, per_run_max_usd: 50.0 },
    rules: { challenge_required: true, max_turn_retries: 2, max_deadlock_cycles: 2 },
    files: { talk: 'TALK.md', history: '.agentxchain/history.jsonl', state: '.agentxchain/state.json' },
    compat: { next_owner_source: 'state-json', lock_based_coordination: false, original_version: 4 },
  };
}

function makeTurnResult(state, turn = state.current_turn) {
  return {
    schema_version: '1.0',
    run_id: state.run_id,
    turn_id: turn.turn_id,
    role: turn.assigned_role,
    runtime_id: turn.runtime_id,
    status: 'completed',
    summary: 'Did the work.',
    decisions: [{
      id: 'DEC-001',
      category: 'implementation',
      statement: 'Used approach A.',
      rationale: 'Simpler.'
    }],
    objections: [{
      id: 'OBJ-001',
      severity: 'low',
      statement: 'No major concerns.',
      status: 'raised'
    }],
    files_changed: [],
    artifacts_created: [],
    verification: {
      status: 'pass',
      commands: ['echo ok'],
      evidence_summary: 'All good.',
      machine_evidence: [{ command: 'echo ok', exit_code: 0 }]
    },
    artifact: { type: 'review', ref: null },
    proposed_next_role: 'dev',
    phase_transition_request: null,
    needs_human_reason: null,
    cost: { input_tokens: 100, output_tokens: 50, usd: 0.01 }
  };
}

function writeHookScript(root, name, script) {
  const hookDir = join(root, 'hooks');
  mkdirSync(hookDir, { recursive: true });
  const hookPath = join(hookDir, name);
  writeFileSync(hookPath, script, { mode: 0o755 });
  chmodSync(hookPath, 0o755);
  return hookPath;
}

// ── Tests: init --governed scaffolding ───────────────────────────────────────

describe('scaffoldGoverned', () => {
  let dir;
  beforeEach(() => { dir = makeTmpDir(); });
  afterEach(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });

  it('creates all required governed files', () => {
    scaffoldGoverned(dir, 'Test Project', 'test-project');

    assert.ok(existsSync(join(dir, 'agentxchain.json')));
    assert.ok(existsSync(join(dir, '.agentxchain', 'state.json')));
    assert.ok(existsSync(join(dir, '.agentxchain', 'history.jsonl')));
    assert.ok(existsSync(join(dir, '.agentxchain', 'decision-ledger.jsonl')));
    assert.ok(existsSync(join(dir, '.agentxchain', 'prompts', 'pm.md')));
    assert.ok(existsSync(join(dir, '.agentxchain', 'prompts', 'dev.md')));
    assert.ok(existsSync(join(dir, '.agentxchain', 'prompts', 'qa.md')));
    assert.ok(existsSync(join(dir, '.agentxchain', 'prompts', 'eng_director.md')));
    assert.ok(existsSync(join(dir, '.planning', 'PM_SIGNOFF.md')));
    assert.ok(existsSync(join(dir, '.planning', 'ROADMAP.md')));
    assert.ok(existsSync(join(dir, '.planning', 'acceptance-matrix.md')));
    assert.ok(existsSync(join(dir, '.planning', 'ship-verdict.md')));
    assert.ok(existsSync(join(dir, '.planning', 'RELEASE_NOTES.md')));
    assert.ok(existsSync(join(dir, 'TALK.md')));
  });

  it('scaffolds PM signoff as intentionally blocked until human approval', () => {
    scaffoldGoverned(dir, 'Test Project', 'test-project');
    const signoff = readFileSync(join(dir, '.planning', 'PM_SIGNOFF.md'), 'utf8');
    assert.match(signoff, /Approved: NO/);
    assert.match(signoff, /starts blocked on purpose/i);
    assert.match(signoff, /Approved: YES/);
    assert.match(signoff, /only after a human reviews the planning artifacts/i);
  });

  it('creates v4 governed config', () => {
    scaffoldGoverned(dir, 'Test Project', 'test-project');
    const config = readJson(dir, 'agentxchain.json');
    assert.equal(config.schema_version, '1.0');
    assert.equal(config.template, 'generic');
    assert.equal(config.project.id, 'test-project');
    assert.ok(config.roles.pm);
    assert.ok(config.roles.dev);
    assert.ok(config.roles.qa);
    assert.ok(config.roles.eng_director);
    assert.ok(config.runtimes['manual-pm']);
    assert.ok(config.runtimes['local-dev']);
    assert.ok(config.routing.planning);
    assert.ok(config.gates.planning_signoff);
  });

  it('creates idle state with no active turn', () => {
    scaffoldGoverned(dir, 'Test Project', 'test-project');
    const state = readJson(dir, '.agentxchain/state.json');
    assert.equal(state.status, 'idle');
    assert.equal(state.phase, 'planning');
    assert.equal(state.run_id, null);
    assert.deepEqual(state.active_turns, {});
    assert.equal(state.turn_sequence, 0);
    assert.equal(state.current_turn, null);
  });

  it('does not create legacy files (lock.json, root state.json)', () => {
    scaffoldGoverned(dir, 'Test Project', 'test-project');
    assert.ok(!existsSync(join(dir, 'lock.json')));
    assert.ok(!existsSync(join(dir, 'state.json'))); // state is under .agentxchain/
    assert.ok(!existsSync(join(dir, 'state.md')));
    assert.ok(!existsSync(join(dir, 'history.jsonl'))); // history is under .agentxchain/
  });

  it('creates staging and dispatch directories', () => {
    scaffoldGoverned(dir, 'Test Project', 'test-project');
    assert.ok(existsSync(join(dir, '.agentxchain', 'staging')));
    assert.ok(existsSync(join(dir, '.agentxchain', 'dispatch')));
    assert.ok(existsSync(join(dir, '.agentxchain', 'reviews')));
  });

  it('prompt templates include role-specific behavioral instructions', () => {
    scaffoldGoverned(dir, 'Test Project', 'test-project');
    const devPrompt = readFileSync(join(dir, '.agentxchain', 'prompts', 'dev.md'), 'utf8');
    assert.ok(devPrompt.includes('Developer'));
    assert.ok(devPrompt.includes('Implement'));
    assert.ok(devPrompt.includes('Verification Is Mandatory'));
    assert.ok(devPrompt.includes('Expected-failure checks must be wrapped'));

    const qaPrompt = readFileSync(join(dir, '.agentxchain', 'prompts', 'qa.md'), 'utf8');
    assert.ok(qaPrompt.includes('QA'));
    assert.ok(qaPrompt.includes('run_completion_request'));
    assert.ok(qaPrompt.includes('ship-verdict'));

    const pmPrompt = readFileSync(join(dir, '.agentxchain', 'prompts', 'pm.md'), 'utf8');
    assert.ok(pmPrompt.includes('Product Manager'));
    assert.ok(pmPrompt.includes('ROADMAP'));
    assert.ok(pmPrompt.includes('phase_transition_request'));
  });
});

// ── Tests: initializeGovernedRun ─────────────────────────────────────────────

describe('initializeGovernedRun', () => {
  let dir, config;
  beforeEach(() => {
    dir = makeTmpDir();
    config = makeNormalizedConfig();
    scaffoldGoverned(dir, 'Test Project', 'test-project');
  });
  afterEach(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });

  it('creates a run from idle state', () => {
    const result = initializeGovernedRun(dir, config);
    assert.ok(result.ok);
    assert.ok(result.state.run_id.startsWith('run_'));
    assert.equal(result.state.status, 'active');
  });

  it('rejects when status is active', () => {
    initializeGovernedRun(dir, config);
    const result = initializeGovernedRun(dir, config);
    assert.ok(!result.ok);
    assert.ok(result.error.includes('active'));
  });

  it('allows initialization from paused state', () => {
    // Simulate a paused state (e.g., post-migration)
    const state = readJson(dir, '.agentxchain/state.json');
    state.status = 'paused';
    writeFileSync(join(dir, '.agentxchain', 'state.json'), JSON.stringify(state, null, 2) + '\n');

    const result = initializeGovernedRun(dir, config);
    assert.ok(result.ok);
    assert.equal(result.state.status, 'active');
  });

  it('sets budget from config', () => {
    const result = initializeGovernedRun(dir, config);
    assert.equal(result.state.budget_status.remaining_usd, 50.0);
    assert.equal(result.state.budget_status.spent_usd, 0);
  });

  it('migrates legacy v1.0 current_turn into active_turns on read', () => {
    const legacyState = {
      schema_version: '1.0',
      run_id: 'run_legacy',
      project_id: 'test-project',
      status: 'active',
      phase: 'planning',
      current_turn: {
        turn_id: 'turn_legacy',
        assigned_role: 'pm',
        status: 'running',
        attempt: 1,
        runtime_id: 'manual-pm',
      },
    };

    const normalized = normalizeGovernedStateShape(legacyState);
    assert.equal(normalized.state.schema_version, '1.1');
    assert.equal(normalized.state.turn_sequence, 1);
    assert.deepEqual(Object.keys(normalized.state.active_turns), ['turn_legacy']);
    assert.equal(normalized.state.active_turns.turn_legacy.assigned_sequence, 1);
  });
});

// ── Tests: assignGovernedTurn ────────────────────────────────────────────────

describe('assignGovernedTurn', () => {
  let dir, config;
  beforeEach(() => {
    dir = makeTmpDir();
    config = makeNormalizedConfig();
    scaffoldGoverned(dir, 'Test Project', 'test-project');
    initializeGovernedRun(dir, config);
  });
  afterEach(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });

  it('assigns a turn to a valid role', () => {
    const result = assignGovernedTurn(dir, config, 'pm');
    assert.ok(result.ok);
    assert.ok(result.turn);
    assert.ok(result.state.current_turn);
    assert.equal(result.turn.turn_id, result.state.current_turn.turn_id);
    assert.equal(result.state.current_turn.assigned_role, 'pm');
    assert.equal(result.turn.assigned_role, 'pm');
    assert.ok(result.state.current_turn.turn_id.startsWith('turn_'));
    assert.equal(result.state.current_turn.attempt, 1);
  });

  it('rejects assignment when a turn is already active', () => {
    assignGovernedTurn(dir, config, 'pm');
    const result = assignGovernedTurn(dir, config, 'dev');
    assert.ok(!result.ok);
    assert.ok(result.error.includes('already assigned'));
  });

  it('rejects unknown role', () => {
    const result = assignGovernedTurn(dir, config, 'nonexistent');
    assert.ok(!result.ok);
    assert.ok(result.error.includes('Unknown role'));
    assert.equal(Object.prototype.hasOwnProperty.call(result, 'turn'), false);
  });

  it('falls back to raw governed role.runtime when runtime_id is absent', () => {
    const rawishConfig = structuredClone(config);
    rawishConfig.roles.pm = {
      title: 'Product Manager',
      mandate: 'Test',
      write_authority: 'review_only',
      runtime: 'manual-pm'
    };

    const result = assignGovernedTurn(dir, rawishConfig, 'pm');
    assert.ok(result.ok);
    assert.equal(result.state.current_turn.runtime_id, 'manual-pm');
  });

  it('rejects when run is not active', () => {
    const state = readJson(dir, '.agentxchain/state.json');
    state.status = 'paused';
    writeFileSync(join(dir, '.agentxchain', 'state.json'), JSON.stringify(state, null, 2) + '\n');

    const result = assignGovernedTurn(dir, config, 'pm');
    assert.ok(!result.ok);
  });

  it('halts assignment when a before_assignment hook returns block without mutating run state', () => {
    writeHookScript(dir, 'block-assignment.sh', '#!/bin/sh\necho \'{"verdict":"block","message":"Compliance approval required before assigning pm"}\'');
    config.hooks = {
      before_assignment: [{
        name: 'assignment-gate',
        type: 'process',
        command: ['./hooks/block-assignment.sh'],
        timeout_ms: 5000,
        mode: 'blocking',
      }],
    };

    const result = assignGovernedTurn(dir, config, 'pm');
    assert.ok(!result.ok);
    assert.equal(result.error_code, 'hook_blocked');
    assert.match(result.error, /Compliance approval required/);
    assert.equal(result.state.status, 'active');
    assert.equal(result.state.current_turn, null);
    assert.deepEqual(result.state.active_turns, {});

    const state = readJson(dir, '.agentxchain/state.json');
    assert.equal(state.status, 'active');
    assert.equal(state.current_turn, null);

    const audit = readJsonl(dir, HOOK_AUDIT_PATH);
    assert.equal(audit.length, 1);
    assert.equal(audit[0].hook_phase, 'before_assignment');
    assert.equal(audit[0].hook_name, 'assignment-gate');
    assert.equal(audit[0].verdict, 'block');
  });

  it('fails closed when a before_assignment hook tampers with protected state', () => {
    writeHookScript(dir, 'tamper-assignment.sh', `#!/bin/sh
echo '{"status":"tampered"}' > "${dir}/.agentxchain/state.json"
echo '{"verdict":"allow"}'`);
    config.hooks = {
      before_assignment: [{
        name: 'tamper-gate',
        type: 'process',
        command: ['./hooks/tamper-assignment.sh'],
        timeout_ms: 5000,
        mode: 'blocking',
      }],
    };

    const result = assignGovernedTurn(dir, config, 'pm');
    assert.ok(!result.ok);
    assert.equal(result.error_code, 'hook_state_tamper');
    assert.equal(result.state.status, 'blocked');
    assert.equal(result.state.blocked_reason?.recovery?.typed_reason, 'hook_tamper');

    const audit = readJsonl(dir, HOOK_AUDIT_PATH);
    assert.equal(audit.length, 1);
    assert.equal(audit[0].hook_phase, 'before_assignment');
    assert.equal(audit[0].orchestrator_action, 'aborted_tamper');
  });
});

// ── Tests: parallel assignment (Slice 1) ────────────────────────────────────

describe('assignGovernedTurn — parallel', () => {
  let dir, config;
  beforeEach(() => {
    dir = makeTmpDir();
    config = makeNormalizedConfig();
    // Set max_concurrent_turns = 2 for the planning phase
    config.routing.planning.max_concurrent_turns = 2;
    scaffoldGoverned(dir, 'Test Project', 'test-project');
    initializeGovernedRun(dir, config);
  });
  afterEach(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });

  // AT-P-04: Two different roles can be assigned concurrently
  it('assigns two turns to different roles concurrently', () => {
    const r1 = assignGovernedTurn(dir, config, 'pm');
    assert.ok(r1.ok, `First assignment failed: ${r1.error}`);
    assert.equal(getActiveTurnCount(r1.state), 1);

    const r2 = assignGovernedTurn(dir, config, 'qa');
    assert.ok(r2.ok, `Second assignment failed: ${r2.error}`);
    assert.equal(getActiveTurnCount(r2.state), 2);

    const turns = getActiveTurns(r2.state);
    const roles = Object.values(turns).map(t => t.assigned_role).sort();
    assert.deepEqual(roles, ['pm', 'qa']);
  });

  // AT-P-05: Third assignment blocked by max_concurrent_turns = 2
  it('rejects assignment at capacity', () => {
    assignGovernedTurn(dir, config, 'pm');
    assignGovernedTurn(dir, config, 'qa');
    const r3 = assignGovernedTurn(dir, config, 'dev');
    assert.ok(!r3.ok);
    assert.ok(r3.error.includes('capacity'));
  });

  // AT-P-06: Same role cannot hold two active turns (DEC-PARALLEL-006)
  it('rejects duplicate-role assignment', () => {
    assignGovernedTurn(dir, config, 'pm');
    const r2 = assignGovernedTurn(dir, config, 'pm');
    assert.ok(!r2.ok);
    assert.ok(r2.error.includes('already has an active turn'));
  });

  // AT-P-07: turn_sequence increments for each assignment
  it('increments turn_sequence for each concurrent assignment', () => {
    const r1 = assignGovernedTurn(dir, config, 'pm');
    const seq1 = r1.state.turn_sequence;
    const r2 = assignGovernedTurn(dir, config, 'qa');
    const seq2 = r2.state.turn_sequence;
    assert.equal(seq2, seq1 + 1);

    // Each turn records its own assigned_sequence
    const turns = Object.values(getActiveTurns(r2.state));
    const sequences = turns.map(t => t.assigned_sequence).sort();
    assert.deepEqual(sequences, [seq1, seq2]);
  });

  // AT-P-08: concurrent_with is recorded
  it('records concurrent_with siblings on assignment', () => {
    const r1 = assignGovernedTurn(dir, config, 'pm');
    const turn1Id = Object.keys(getActiveTurns(r1.state))[0];
    const turn1 = getActiveTurns(r1.state)[turn1Id];
    assert.deepEqual(turn1.concurrent_with, []);

    const r2 = assignGovernedTurn(dir, config, 'qa');
    const turns2 = getActiveTurns(r2.state);
    const newTurn = Object.values(turns2).find(t => t.assigned_role === 'qa');
    assert.deepEqual(newTurn.concurrent_with, [turn1Id]);
  });

  // AT-P-22a: No assignment while blocked (DEC-PARALLEL-007)
  it('rejects assignment when run is blocked', () => {
    const state = readJson(dir, '.agentxchain/state.json');
    state.status = 'blocked';
    state.blocked_reason = {
      category: 'escalation',
      recovery: { typed_reason: 'test', owner: 'human', recovery_action: 'test' },
      blocked_at: new Date().toISOString(),
      turn_id: null,
    };
    writeFileSync(join(dir, '.agentxchain', 'state.json'), JSON.stringify(state, null, 2) + '\n');

    const result = assignGovernedTurn(dir, config, 'pm');
    assert.ok(!result.ok);
    assert.ok(result.error.includes('blocked'));
  });

  // AT-P-27c: Budget reservation creation
  it('creates budget reservation on assignment', () => {
    const r1 = assignGovernedTurn(dir, config, 'pm');
    assert.ok(r1.ok);
    const turnId = Object.keys(getActiveTurns(r1.state))[0];
    assert.ok(r1.state.budget_reservations[turnId]);
    assert.equal(r1.state.budget_reservations[turnId].reserved_usd, config.budget.per_turn_max_usd);
    assert.equal(r1.state.budget_reservations[turnId].role_id, 'pm');
  });

  // Budget reservation failure: not enough remaining budget
  it('rejects assignment when budget reservation would exceed remaining', () => {
    // Set remaining_usd to barely enough for 1 turn
    const state = readJson(dir, '.agentxchain/state.json');
    state.budget_status = { spent_usd: 49.0, remaining_usd: 1.0 };
    writeFileSync(join(dir, '.agentxchain', 'state.json'), JSON.stringify(state, null, 2) + '\n');

    // per_turn_max_usd is 2.0, remaining is 1.0 — should fail
    const result = assignGovernedTurn(dir, config, 'pm');
    assert.ok(!result.ok);
    assert.ok(result.error.includes('budget'));
  });

  // Budget reservation stacking: two turns reserve from the same pool
  it('stacks budget reservations for concurrent turns', () => {
    // Set remaining to exactly enough for 2 turns (per_turn_max = 2.0)
    const state = readJson(dir, '.agentxchain/state.json');
    state.budget_status = { spent_usd: 46.0, remaining_usd: 4.0 };
    writeFileSync(join(dir, '.agentxchain', 'state.json'), JSON.stringify(state, null, 2) + '\n');

    const r1 = assignGovernedTurn(dir, config, 'pm');
    assert.ok(r1.ok, `First assignment failed: ${r1.error}`);

    const r2 = assignGovernedTurn(dir, config, 'qa');
    assert.ok(r2.ok, `Second assignment failed: ${r2.error}`);
  });

  // Budget reservation stacking: third would exceed
  it('rejects third assignment when stacked reservations exhaust budget', () => {
    config.routing.planning.max_concurrent_turns = 3;
    // remaining = 4.0, per_turn = 2.0, so 2 turns can fit but not 3
    const state = readJson(dir, '.agentxchain/state.json');
    state.budget_status = { spent_usd: 46.0, remaining_usd: 4.0 };
    writeFileSync(join(dir, '.agentxchain', 'state.json'), JSON.stringify(state, null, 2) + '\n');

    const r1 = assignGovernedTurn(dir, config, 'pm');
    assert.ok(r1.ok);
    const r2 = assignGovernedTurn(dir, config, 'qa');
    assert.ok(r2.ok);
    const r3 = assignGovernedTurn(dir, config, 'dev');
    assert.ok(!r3.ok);
    assert.ok(r3.error.includes('budget'));
  });

  // Single-turn backward compat: max_concurrent_turns = 1 uses old error message
  it('preserves backward-compatible error when max_concurrent_turns = 1', () => {
    config.routing.planning.max_concurrent_turns = 1;
    assignGovernedTurn(dir, config, 'pm');
    const r2 = assignGovernedTurn(dir, config, 'qa');
    assert.ok(!r2.ok);
    assert.ok(r2.error.includes('already assigned'));
  });
});

// ── Tests: acceptGovernedTurn ────────────────────────────────────────────────

describe('acceptGovernedTurn', () => {
  let dir, config;
  beforeEach(() => {
    dir = makeTmpDir();
    config = makeNormalizedConfig();
    scaffoldGoverned(dir, 'Test Project', 'test-project');
    initializeGovernedRun(dir, config);
  });
  afterEach(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });

  it('accepts a valid turn result and updates all state files', () => {
    const assignResult = assignGovernedTurn(dir, config, 'qa');
    const state = assignResult.state;

    // Write a valid staged turn result
    const turnResult = makeTurnResult(state);
    mkdirSync(join(dir, '.agentxchain', 'staging'), { recursive: true });
    writeFileSync(join(dir, STAGING_PATH), JSON.stringify(turnResult, null, 2));

    const result = acceptGovernedTurn(dir, config);
    assert.ok(result.ok, `Accept failed: ${result.error}`);

    // State updated
    assert.equal(result.state.current_turn, null);
    assert.equal(result.state.last_completed_turn_id, state.current_turn.turn_id);

    // History appended
    const history = readJsonl(dir, HISTORY_PATH);
    assert.equal(history.length, 1);
    assert.equal(history[0].turn_id, state.current_turn.turn_id);
    assert.ok(history[0].accepted_at);

    // Decision ledger appended
    const ledger = readJsonl(dir, LEDGER_PATH);
    assert.equal(ledger.length, 1);
    assert.equal(ledger[0].id, 'DEC-001');

    // TALK.md updated
    const talk = readFileSync(join(dir, 'TALK.md'), 'utf8');
    assert.ok(talk.includes('Did the work.'));

    // Staging file cleared
    assert.ok(!existsSync(join(dir, STAGING_PATH)));
  });

  it('materializes a derived review artifact for api_proxy review turns', () => {
    execSync('git init', { cwd: dir, stdio: 'ignore' });
    execSync('git config user.email "test@example.com"', { cwd: dir, stdio: 'ignore' });
    execSync('git config user.name "Test User"', { cwd: dir, stdio: 'ignore' });
    execSync('git add .', { cwd: dir, stdio: 'ignore' });
    execSync('git commit -m "baseline"', { cwd: dir, stdio: 'ignore' });

    const assignResult = assignGovernedTurn(dir, config, 'qa');
    const state = assignResult.state;
    const turnResult = makeTurnResult(state);
    turnResult.summary = 'QA review completed through api_proxy.';
    writeFileSync(join(dir, STAGING_PATH), JSON.stringify(turnResult, null, 2));

    const result = acceptGovernedTurn(dir, config);
    assert.ok(result.ok, `Accept failed: ${result.error}`);

    const reviewPath = `.agentxchain/reviews/${state.current_turn.turn_id}-qa-review.md`;
    assert.ok(existsSync(join(dir, reviewPath)), 'derived review artifact must exist');
    const reviewMd = readFileSync(join(dir, reviewPath), 'utf8');
    assert.match(reviewMd, /QA review completed through api_proxy/);
    assert.match(reviewMd, /## Objections/);

    const history = readJsonl(dir, HISTORY_PATH);
    assert.equal(history[0].artifact.ref, reviewPath);
    assert.ok(!history[0].files_changed.includes(reviewPath));
    assert.ok(!history[0].artifacts_created.includes(reviewPath));
  });

  it('allows an authoritative follow-up turn without committing a derived review artifact first', () => {
    execSync('git init', { cwd: dir, stdio: 'ignore' });
    execSync('git config user.email "test@example.com"', { cwd: dir, stdio: 'ignore' });
    execSync('git config user.name "Test User"', { cwd: dir, stdio: 'ignore' });
    execSync('git add .', { cwd: dir, stdio: 'ignore' });
    execSync('git commit -m "baseline"', { cwd: dir, stdio: 'ignore' });

    const qaAssign = assignGovernedTurn(dir, config, 'qa');
    const qaState = qaAssign.state;
    const qaResult = makeTurnResult(qaState);
    qaResult.summary = 'QA review completed through api_proxy.';
    qaResult.proposed_next_role = 'human';
    writeFileSync(join(dir, STAGING_PATH), JSON.stringify(qaResult, null, 2));

    const accepted = acceptGovernedTurn(dir, config);
    assert.ok(accepted.ok, `Accept failed: ${accepted.error}`);

    const reviewPath = `.agentxchain/reviews/${qaState.current_turn.turn_id}-qa-review.md`;
    assert.ok(existsSync(join(dir, reviewPath)), 'derived review artifact must exist');

    const nextAssign = assignGovernedTurn(dir, config, 'dev');
    assert.ok(nextAssign.ok, `assignGovernedTurn should ignore derived review evidence dirt: ${nextAssign.error}`);
    assert.equal(nextAssign.state.current_turn.assigned_role, 'dev');
  });

  it('rejects api_proxy review turns that still claim phantom planning files', () => {
    execSync('git init', { cwd: dir, stdio: 'ignore' });
    execSync('git config user.email "test@example.com"', { cwd: dir, stdio: 'ignore' });
    execSync('git config user.name "Test User"', { cwd: dir, stdio: 'ignore' });
    execSync('git add .', { cwd: dir, stdio: 'ignore' });
    execSync('git commit -m "baseline"', { cwd: dir, stdio: 'ignore' });

    const assignResult = assignGovernedTurn(dir, config, 'qa');
    const state = assignResult.state;
    const turnResult = makeTurnResult(state);
    turnResult.files_changed = ['.planning/ship-verdict.md'];
    turnResult.artifacts_created = ['.planning/ship-verdict.md'];
    writeFileSync(join(dir, STAGING_PATH), JSON.stringify(turnResult, null, 2));

    const result = acceptGovernedTurn(dir, config);
    assert.ok(!result.ok);
    assert.match(result.error, /artifact mismatch/i);
    assert.match(result.validation.errors[0], /ship-verdict\.md/);
  });

  it('tracks budget after acceptance', () => {
    const assignResult = assignGovernedTurn(dir, config, 'qa');
    const turnResult = makeTurnResult(assignResult.state);
    turnResult.cost.usd = 1.50;
    writeFileSync(join(dir, STAGING_PATH), JSON.stringify(turnResult, null, 2));

    const result = acceptGovernedTurn(dir, config);
    assert.ok(result.ok);
    assert.equal(result.state.budget_status.spent_usd, 1.50);
    assert.equal(result.state.budget_status.remaining_usd, 48.50);
  });

  it('blocks run when turn status is needs_human', () => {
    const assignResult = assignGovernedTurn(dir, config, 'qa');
    const turnResult = makeTurnResult(assignResult.state);
    turnResult.status = 'needs_human';
    turnResult.needs_human_reason = 'Manual QA required';
    writeFileSync(join(dir, STAGING_PATH), JSON.stringify(turnResult, null, 2));

    const result = acceptGovernedTurn(dir, config);
    assert.ok(result.ok);
    assert.equal(result.state.status, 'blocked');
    assert.ok(result.state.blocked_on.includes('Manual QA required'));
    assert.equal(result.state.blocked_reason.category, 'needs_human');
  });

  it('rejects when no turn is active', () => {
    const result = acceptGovernedTurn(dir, config);
    assert.ok(!result.ok);
    assert.ok(result.error.includes('No active turn'));
  });

  it('rejects when staging file is missing', () => {
    assignGovernedTurn(dir, config, 'qa');
    const result = acceptGovernedTurn(dir, config);
    assert.ok(!result.ok);
    assert.ok(result.error.includes('Validation failed') || result.error.includes('not found'));
  });

  it('rejects when turn result has mismatched run_id', () => {
    const assignResult = assignGovernedTurn(dir, config, 'qa');
    const turnResult = makeTurnResult(assignResult.state);
    turnResult.run_id = 'run_wrong';
    writeFileSync(join(dir, STAGING_PATH), JSON.stringify(turnResult, null, 2));

    const result = acceptGovernedTurn(dir, config);
    assert.ok(!result.ok);
    assert.ok(result.error.includes('assignment'));
  });

  it('accepts only the targeted turn when multiple active turns exist', () => {
    config.routing.planning.max_concurrent_turns = 2;

    const firstAssign = assignGovernedTurn(dir, config, 'pm');
    const secondAssign = assignGovernedTurn(dir, config, 'qa');
    const firstTurnId = firstAssign.state.current_turn.turn_id;
    const targetTurnId = Object.keys(secondAssign.state.active_turns).find(id => id !== firstTurnId);
    const targetTurn = secondAssign.state.active_turns[targetTurnId];

    mkdirSync(join(dir, '.agentxchain', 'staging', targetTurnId), { recursive: true });
    writeFileSync(
      join(dir, getTurnStagingResultPath(targetTurnId)),
      JSON.stringify(makeTurnResult(secondAssign.state, targetTurn), null, 2),
    );

    const result = acceptGovernedTurn(dir, config, { turnId: targetTurnId });
    assert.ok(result.ok, `Accept failed: ${result.error}`);
    assert.equal(Object.keys(result.state.active_turns).length, 1);
    assert.ok(result.state.active_turns[firstTurnId]);
    assert.equal(result.state.last_completed_turn_id, targetTurnId);

    const history = readJsonl(dir, HISTORY_PATH);
    assert.equal(history.length, 1);
    assert.equal(history[0].turn_id, targetTurnId);
    assert.equal(history[0].assigned_sequence, targetTurn.assigned_sequence);
    assert.ok(history[0].accepted_sequence > history[0].assigned_sequence);
    assert.ok(Array.isArray(history[0].concurrent_with));
  });

  it('persists conflict_state and skips history write on acceptance conflict', () => {
    config.routing.planning.max_concurrent_turns = 2;
    config.roles.qa.write_authority = 'authoritative';
    execSync('git init', { cwd: dir, stdio: 'ignore' });
    execSync('git config user.email "test@example.com"', { cwd: dir, stdio: 'ignore' });
    execSync('git config user.name "Test User"', { cwd: dir, stdio: 'ignore' });
    writeFileSync(join(dir, '.planning', 'shared-conflict.md'), '# base\n');
    execSync('git add .', { cwd: dir, stdio: 'ignore' });
    execSync('git commit -m "baseline"', { cwd: dir, stdio: 'ignore' });

    const firstAssign = assignGovernedTurn(dir, config, 'dev');
    const secondAssign = assignGovernedTurn(dir, config, 'qa');
    const firstTurn = firstAssign.state.current_turn;
    const secondTurnId = Object.keys(secondAssign.state.active_turns).find(id => id !== firstTurn.turn_id);
    const secondTurn = secondAssign.state.active_turns[secondTurnId];
    const sharedFile = '.planning/shared-conflict.md';

    writeFileSync(join(dir, sharedFile), '# shared\nupdated\n');

    mkdirSync(join(dir, '.agentxchain', 'staging', firstTurn.turn_id), { recursive: true });
    const firstResult = makeTurnResult(secondAssign.state, firstTurn);
    firstResult.files_changed = [sharedFile];
    writeFileSync(join(dir, getTurnStagingResultPath(firstTurn.turn_id)), JSON.stringify(firstResult, null, 2));
    assert.ok(acceptGovernedTurn(dir, config, { turnId: firstTurn.turn_id }).ok);

    mkdirSync(join(dir, '.agentxchain', 'staging', secondTurnId), { recursive: true });
    const secondResult = makeTurnResult(secondAssign.state, secondTurn);
    secondResult.files_changed = [sharedFile, 'TALK.md'];
    writeFileSync(join(dir, getTurnStagingResultPath(secondTurnId)), JSON.stringify(secondResult, null, 2));

    const result = acceptGovernedTurn(dir, config, { turnId: secondTurnId });
    assert.equal(result.ok, false);
    assert.equal(result.error_code, 'conflict');
    assert.equal(result.state.active_turns[secondTurnId].status, 'conflicted');
    assert.equal(result.state.active_turns[secondTurnId].conflict_state.detection_count, 1);
    assert.deepEqual(result.state.active_turns[secondTurnId].conflict_state.conflict_error.conflicting_files, [sharedFile]);

    const history = readJsonl(dir, HISTORY_PATH);
    assert.equal(history.length, 1);

    const ledger = readJsonl(dir, LEDGER_PATH);
    assert.equal(ledger[ledger.length - 1].decision, 'conflict_detected');
    assert.ok(existsSync(join(dir, getTurnStagingResultPath(secondTurnId))));
  });

  it('rejects a conflicted turn for retry with persisted conflict context', () => {
    config.routing.planning.max_concurrent_turns = 2;
    config.roles.qa.write_authority = 'authoritative';
    execSync('git init', { cwd: dir, stdio: 'ignore' });
    execSync('git config user.email "test@example.com"', { cwd: dir, stdio: 'ignore' });
    execSync('git config user.name "Test User"', { cwd: dir, stdio: 'ignore' });
    writeFileSync(join(dir, '.planning', 'shared-conflict.md'), '# base\n');
    execSync('git add .', { cwd: dir, stdio: 'ignore' });
    execSync('git commit -m "baseline"', { cwd: dir, stdio: 'ignore' });

    const firstAssign = assignGovernedTurn(dir, config, 'dev');
    const secondAssign = assignGovernedTurn(dir, config, 'qa');
    const firstTurn = firstAssign.state.current_turn;
    const secondTurnId = Object.keys(secondAssign.state.active_turns).find(id => id !== firstTurn.turn_id);
    const secondTurn = secondAssign.state.active_turns[secondTurnId];
    const sharedFile = '.planning/shared-conflict.md';

    writeFileSync(join(dir, sharedFile), '# shared\nupdated\n');

    mkdirSync(join(dir, '.agentxchain', 'staging', firstTurn.turn_id), { recursive: true });
    const firstResult = makeTurnResult(secondAssign.state, firstTurn);
    firstResult.files_changed = [sharedFile];
    firstResult.artifact = { type: 'workspace', ref: null };
    writeFileSync(join(dir, getTurnStagingResultPath(firstTurn.turn_id)), JSON.stringify(firstResult, null, 2));
    assert.ok(acceptGovernedTurn(dir, config, { turnId: firstTurn.turn_id }).ok);

    mkdirSync(join(dir, '.agentxchain', 'staging', secondTurnId), { recursive: true });
    const secondResult = makeTurnResult(secondAssign.state, secondTurn);
    secondResult.files_changed = [sharedFile, 'TALK.md'];
    secondResult.artifact = { type: 'workspace', ref: null };
    writeFileSync(join(dir, getTurnStagingResultPath(secondTurnId)), JSON.stringify(secondResult, null, 2));

    const conflictResult = acceptGovernedTurn(dir, config, { turnId: secondTurnId });
    assert.equal(conflictResult.ok, false);
    assert.equal(conflictResult.error_code, 'conflict');

    const rejectResult = rejectGovernedTurn(
      dir,
      config,
      { errors: ['File conflict detected'], failed_stage: 'conflict' },
      { turnId: secondTurnId, reassign: true },
    );
    assert.ok(rejectResult.ok);
    assert.equal(rejectResult.escalated, false);
    assert.equal(rejectResult.turn.attempt, 2);
    assert.equal(rejectResult.turn.status, 'retrying');
    assert.equal(rejectResult.turn.conflict_state, null);
    assert.deepEqual(rejectResult.turn.conflict_context.conflicting_files, [sharedFile]);

    const ledger = readJsonl(dir, LEDGER_PATH);
    assert.equal(ledger[ledger.length - 1].decision, 'conflict_rejected');
    assert.ok(!existsSync(join(dir, getTurnStagingResultPath(secondTurnId))));
  });

  it('accepts a human_merge resolution after the operator restages non-conflicting output', () => {
    config.routing.planning.max_concurrent_turns = 2;
    config.roles.qa.write_authority = 'authoritative';
    execSync('git init', { cwd: dir, stdio: 'ignore' });
    execSync('git config user.email "test@example.com"', { cwd: dir, stdio: 'ignore' });
    execSync('git config user.name "Test User"', { cwd: dir, stdio: 'ignore' });
    writeFileSync(join(dir, '.planning', 'shared-conflict.md'), '# base\n');
    execSync('git add .', { cwd: dir, stdio: 'ignore' });
    execSync('git commit -m "baseline"', { cwd: dir, stdio: 'ignore' });

    const firstAssign = assignGovernedTurn(dir, config, 'dev');
    const secondAssign = assignGovernedTurn(dir, config, 'qa');
    const firstTurn = firstAssign.state.current_turn;
    const secondTurnId = Object.keys(secondAssign.state.active_turns).find(id => id !== firstTurn.turn_id);
    const secondTurn = secondAssign.state.active_turns[secondTurnId];
    const sharedFile = '.planning/shared-conflict.md';

    writeFileSync(join(dir, sharedFile), '# shared\nupdated\n');

    mkdirSync(join(dir, '.agentxchain', 'staging', firstTurn.turn_id), { recursive: true });
    const firstResult = makeTurnResult(secondAssign.state, firstTurn);
    firstResult.files_changed = [sharedFile];
    firstResult.artifact = { type: 'workspace', ref: null };
    writeFileSync(join(dir, getTurnStagingResultPath(firstTurn.turn_id)), JSON.stringify(firstResult, null, 2));
    assert.ok(acceptGovernedTurn(dir, config, { turnId: firstTurn.turn_id }).ok);

    mkdirSync(join(dir, '.agentxchain', 'staging', secondTurnId), { recursive: true });
    const secondResult = makeTurnResult(secondAssign.state, secondTurn);
    secondResult.files_changed = [sharedFile, 'TALK.md'];
    secondResult.artifact = { type: 'workspace', ref: null };
    writeFileSync(join(dir, getTurnStagingResultPath(secondTurnId)), JSON.stringify(secondResult, null, 2));

    const conflictResult = acceptGovernedTurn(dir, config, { turnId: secondTurnId });
    assert.equal(conflictResult.ok, false);
    assert.equal(conflictResult.error_code, 'conflict');

    writeFileSync(join(dir, sharedFile), '# base\n');
    const mergedResult = makeTurnResult(conflictResult.state, conflictResult.state.active_turns[secondTurnId]);
    mergedResult.files_changed = ['TALK.md'];
    mergedResult.artifact = { type: 'workspace', ref: null };
    writeFileSync(join(dir, getTurnStagingResultPath(secondTurnId)), JSON.stringify(mergedResult, null, 2));

    const accepted = acceptGovernedTurn(dir, config, { turnId: secondTurnId, resolutionMode: 'human_merge' });
    assert.ok(accepted.ok, accepted.error);
    assert.equal(accepted.state.last_completed_turn_id, secondTurnId);
    assert.equal(Object.keys(accepted.state.active_turns).length, 0);

    const ledger = readJsonl(dir, LEDGER_PATH);
    assert.ok(ledger.some(entry => entry.decision === 'conflict_resolution_selected'));
  });

  it('blocks the run on the third conflict detection for the same retained turn', () => {
    config.routing.planning.max_concurrent_turns = 2;
    config.roles.qa.write_authority = 'authoritative';
    execSync('git init', { cwd: dir, stdio: 'ignore' });
    execSync('git config user.email "test@example.com"', { cwd: dir, stdio: 'ignore' });
    execSync('git config user.name "Test User"', { cwd: dir, stdio: 'ignore' });
    writeFileSync(join(dir, '.planning', 'shared-conflict.md'), '# base\n');
    execSync('git add .', { cwd: dir, stdio: 'ignore' });
    execSync('git commit -m "baseline"', { cwd: dir, stdio: 'ignore' });

    const firstAssign = assignGovernedTurn(dir, config, 'dev');
    const secondAssign = assignGovernedTurn(dir, config, 'qa');
    const firstTurn = firstAssign.state.current_turn;
    const secondTurnId = Object.keys(secondAssign.state.active_turns).find(id => id !== firstTurn.turn_id);
    const secondTurn = secondAssign.state.active_turns[secondTurnId];
    const sharedFile = '.planning/shared-conflict.md';

    writeFileSync(join(dir, sharedFile), '# shared\nupdated\n');

    mkdirSync(join(dir, '.agentxchain', 'staging', firstTurn.turn_id), { recursive: true });
    const firstResult = makeTurnResult(secondAssign.state, firstTurn);
    firstResult.files_changed = [sharedFile];
    firstResult.artifact = { type: 'workspace', ref: null };
    writeFileSync(join(dir, getTurnStagingResultPath(firstTurn.turn_id)), JSON.stringify(firstResult, null, 2));
    assert.ok(acceptGovernedTurn(dir, config, { turnId: firstTurn.turn_id }).ok);

    mkdirSync(join(dir, '.agentxchain', 'staging', secondTurnId), { recursive: true });
    const secondResult = makeTurnResult(secondAssign.state, secondTurn);
    secondResult.files_changed = [sharedFile, 'TALK.md'];
    secondResult.artifact = { type: 'workspace', ref: null };
    writeFileSync(join(dir, getTurnStagingResultPath(secondTurnId)), JSON.stringify(secondResult, null, 2));

    const firstConflict = acceptGovernedTurn(dir, config, { turnId: secondTurnId });
    assert.equal(firstConflict.ok, false);
    assert.equal(firstConflict.state.active_turns[secondTurnId].conflict_state.detection_count, 1);

    const secondConflict = acceptGovernedTurn(dir, config, { turnId: secondTurnId });
    assert.equal(secondConflict.ok, false);
    assert.equal(secondConflict.state.active_turns[secondTurnId].conflict_state.detection_count, 2);

    const thirdConflict = acceptGovernedTurn(dir, config, { turnId: secondTurnId });
    assert.equal(thirdConflict.ok, false);
    assert.equal(thirdConflict.state.active_turns[secondTurnId].conflict_state.detection_count, 3);
    assert.equal(thirdConflict.state.status, 'blocked');
    assert.equal(thirdConflict.state.blocked_reason.recovery.typed_reason, 'conflict_loop');
    assert.equal(
      thirdConflict.state.blocked_reason.recovery.recovery_action,
      `Serialize the conflicting work, then run agentxchain reject-turn --turn ${secondTurnId} --reassign`,
    );
  });

  it('queues phase transition requests until the final sibling drains', () => {
    config.routing.planning.max_concurrent_turns = 2;

    const firstAssign = assignGovernedTurn(dir, config, 'pm');
    const secondAssign = assignGovernedTurn(dir, config, 'qa');
    const firstTurn = firstAssign.state.current_turn;
    const secondTurnId = Object.keys(secondAssign.state.active_turns).find(id => id !== firstTurn.turn_id);
    const secondTurn = secondAssign.state.active_turns[secondTurnId];

    mkdirSync(join(dir, '.agentxchain', 'staging', firstTurn.turn_id), { recursive: true });
    const firstResult = makeTurnResult(secondAssign.state, firstTurn);
    firstResult.phase_transition_request = 'implementation';
    writeFileSync(join(dir, getTurnStagingResultPath(firstTurn.turn_id)), JSON.stringify(firstResult, null, 2));

    const queued = acceptGovernedTurn(dir, config, { turnId: firstTurn.turn_id });
    assert.ok(queued.ok, queued.error);
    assert.equal(queued.state.phase, 'planning');
    assert.equal(queued.state.queued_phase_transition?.to, 'implementation');

    mkdirSync(join(dir, '.agentxchain', 'staging', secondTurnId), { recursive: true });
    writeFileSync(
      join(dir, getTurnStagingResultPath(secondTurnId)),
      JSON.stringify(makeTurnResult(queued.state, secondTurn), null, 2),
    );

    const drained = acceptGovernedTurn(dir, config, { turnId: secondTurnId });
    assert.ok(drained.ok, drained.error);
    assert.equal(drained.state.phase, 'implementation');
    assert.equal(drained.state.queued_phase_transition, null);
  });

  it('AT-GFV-001/006: queued phase transition gate failure persists context and clears after later success', () => {
    config.routing.planning.max_concurrent_turns = 2;
    config.gates.planning_signoff = {
      requires_files: ['.planning/PM_SIGNOFF.md'],
      requires_human_approval: false,
    };

    const firstAssign = assignGovernedTurn(dir, config, 'pm');
    const secondAssign = assignGovernedTurn(dir, config, 'dev');
    const firstTurn = firstAssign.state.current_turn;
    const secondTurnId = Object.keys(secondAssign.state.active_turns).find(id => id !== firstTurn.turn_id);
    const secondTurn = secondAssign.state.active_turns[secondTurnId];

    mkdirSync(join(dir, '.agentxchain', 'staging', firstTurn.turn_id), { recursive: true });
    const firstResult = makeTurnResult(secondAssign.state, firstTurn);
    firstResult.phase_transition_request = 'implementation';
    writeFileSync(join(dir, getTurnStagingResultPath(firstTurn.turn_id)), JSON.stringify(firstResult, null, 2));

    const queued = acceptGovernedTurn(dir, config, { turnId: firstTurn.turn_id });
    assert.ok(queued.ok, queued.error);
    assert.equal(queued.state.queued_phase_transition?.to, 'implementation');

    mkdirSync(join(dir, '.agentxchain', 'staging', secondTurnId), { recursive: true });
    writeFileSync(
      join(dir, getTurnStagingResultPath(secondTurnId)),
      JSON.stringify(makeTurnResult(queued.state, secondTurn), null, 2),
    );

    const failedDrain = acceptGovernedTurn(dir, config, { turnId: secondTurnId });
    assert.ok(failedDrain.ok, failedDrain.error);
    assert.equal(failedDrain.state.phase, 'planning');
    assert.equal(failedDrain.state.queued_phase_transition, null);
    assert.equal(failedDrain.state.phase_gate_status.planning_signoff, 'failed');
    assert.equal(failedDrain.state.last_gate_failure?.gate_type, 'phase_transition');
    assert.equal(failedDrain.state.last_gate_failure?.queued_request, true);
    assert.equal(failedDrain.state.last_gate_failure?.requested_by_turn, firstTurn.turn_id);
    assert.equal(failedDrain.state.last_gate_failure?.to_phase, 'implementation');
    assert.match(failedDrain.state.last_gate_failure?.reasons?.[0] || '', /PM_SIGNOFF\.md/);

    const gateFailureLedger = readJsonl(dir, LEDGER_PATH).filter((entry) => entry.type === 'gate_failure');
    assert.equal(gateFailureLedger.length, 1);
    assert.equal(gateFailureLedger[0].gate_type, 'phase_transition');
    assert.equal(gateFailureLedger[0].queued_request, true);

    writeFileSync(join(dir, '.planning', 'PM_SIGNOFF.md'), 'Approved: YES\n');

    const retryAssign = assignGovernedTurn(dir, config, 'pm');
    const retryTurn = retryAssign.state.current_turn;
    mkdirSync(join(dir, '.agentxchain', 'staging', retryTurn.turn_id), { recursive: true });
    const retryResult = makeTurnResult(retryAssign.state, retryTurn);
    retryResult.phase_transition_request = 'implementation';
    writeFileSync(join(dir, getTurnStagingResultPath(retryTurn.turn_id)), JSON.stringify(retryResult, null, 2));

    const recovered = acceptGovernedTurn(dir, config, { turnId: retryTurn.turn_id });
    assert.ok(recovered.ok, recovered.error);
    assert.equal(recovered.state.phase, 'implementation');
    assert.equal(recovered.state.last_gate_failure, null);
    assert.equal(recovered.state.phase_gate_status.planning_signoff, 'passed');
  });

  it('AT-GFV-002/003: queued run completion gate failure persists context and marks the gate failed', () => {
    config.routing.qa.max_concurrent_turns = 2;
    config.gates.qa_ship_verdict = {
      requires_files: ['.planning/ship-verdict.md'],
      requires_human_approval: false,
    };

    const seededState = {
      ...readJson(dir, STATE_PATH),
      phase: 'qa',
      status: 'active',
      run_id: 'run_gate_failure',
    };
    writeFileSync(join(dir, STATE_PATH), JSON.stringify(seededState, null, 2));

    const firstAssign = assignGovernedTurn(dir, config, 'qa');
    const secondAssign = assignGovernedTurn(dir, config, 'dev');
    const firstTurn = firstAssign.state.current_turn;
    const secondTurnId = Object.keys(secondAssign.state.active_turns).find(id => id !== firstTurn.turn_id);
    const secondTurn = secondAssign.state.active_turns[secondTurnId];

    mkdirSync(join(dir, '.agentxchain', 'staging', firstTurn.turn_id), { recursive: true });
    const firstResult = makeTurnResult(secondAssign.state, firstTurn);
    firstResult.run_completion_request = true;
    writeFileSync(join(dir, getTurnStagingResultPath(firstTurn.turn_id)), JSON.stringify(firstResult, null, 2));

    const queued = acceptGovernedTurn(dir, config, { turnId: firstTurn.turn_id });
    assert.ok(queued.ok, queued.error);
    assert.ok(queued.state.queued_run_completion);

    mkdirSync(join(dir, '.agentxchain', 'staging', secondTurnId), { recursive: true });
    writeFileSync(
      join(dir, getTurnStagingResultPath(secondTurnId)),
      JSON.stringify(makeTurnResult(queued.state, secondTurn), null, 2),
    );

    const failedDrain = acceptGovernedTurn(dir, config, { turnId: secondTurnId });
    assert.ok(failedDrain.ok, failedDrain.error);
    assert.equal(failedDrain.state.status, 'active');
    assert.equal(failedDrain.state.queued_run_completion, null);
    assert.equal(failedDrain.state.phase_gate_status.qa_ship_verdict, 'failed');
    assert.equal(failedDrain.state.last_gate_failure?.gate_type, 'run_completion');
    assert.equal(failedDrain.state.last_gate_failure?.queued_request, true);
    assert.equal(failedDrain.state.last_gate_failure?.requested_by_turn, firstTurn.turn_id);
    assert.match(failedDrain.state.last_gate_failure?.reasons?.[0] || '', /ship-verdict\.md/);

    const gateFailureLedger = readJsonl(dir, LEDGER_PATH).filter((entry) => entry.type === 'gate_failure');
    assert.equal(gateFailureLedger.length, 1);
    assert.equal(gateFailureLedger[0].gate_type, 'run_completion');
    assert.equal(gateFailureLedger[0].phase, 'qa');
  });
});

// ── Tests: rejectGovernedTurn ────────────────────────────────────────────────

describe('rejectGovernedTurn', () => {
  let dir, config;
  beforeEach(() => {
    dir = makeTmpDir();
    config = makeNormalizedConfig();
    scaffoldGoverned(dir, 'Test Project', 'test-project');
    initializeGovernedRun(dir, config);
  });
  afterEach(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });

  it('increments attempt on first rejection (retry allowed)', () => {
    assignGovernedTurn(dir, config, 'dev');

    // Write a bad staging file
    writeFileSync(join(dir, STAGING_PATH), '{"bad": true}');

    const validationResult = { errors: ['Missing fields'], failed_stage: 'schema' };
    const result = rejectGovernedTurn(dir, config, validationResult, 'Bad result');

    assert.ok(result.ok);
    assert.equal(result.escalated, false);
    assert.equal(result.state.current_turn.attempt, 2);
    assert.equal(result.state.current_turn.status, 'retrying');
    // Staging file cleared
    assert.ok(!existsSync(join(dir, STAGING_PATH)));
  });

  it('blocks after max retries are exhausted', () => {
    assignGovernedTurn(dir, config, 'dev');

    // First rejection
    writeFileSync(join(dir, STAGING_PATH), '{"bad": true}');
    rejectGovernedTurn(dir, config, { errors: ['err'], failed_stage: 'schema' });

    // Second rejection (attempt 2, max is 2)
    writeFileSync(join(dir, STAGING_PATH), '{"bad": true}');
    const result = rejectGovernedTurn(dir, config, { errors: ['err'], failed_stage: 'schema' });

    assert.ok(result.ok);
    assert.equal(result.escalated, true);
    assert.equal(result.state.status, 'blocked');
    assert.ok(result.state.blocked_on.includes('escalation'));
    assert.ok(result.state.escalation);
    assert.ok(result.state.escalation.reason.includes('Retries exhausted'));
    assert.equal(result.state.blocked_reason.category, 'retries_exhausted');
  });

  it('preserves rejected artifact', () => {
    assignGovernedTurn(dir, config, 'dev');
    writeFileSync(join(dir, STAGING_PATH), '{"bad": true}');

    rejectGovernedTurn(dir, config, { errors: ['err'], failed_stage: 'schema' });

    // Check rejected artifact was saved
    const rejectedDir = join(dir, '.agentxchain', 'dispatch', 'rejected');
    assert.ok(existsSync(rejectedDir));

    const files = readdirSync(rejectedDir);
    assert.equal(files.length, 1);
    assert.ok(files[0].includes('attempt-1'));
  });

  it('does NOT append to history or ledger', () => {
    assignGovernedTurn(dir, config, 'dev');
    writeFileSync(join(dir, STAGING_PATH), '{"bad": true}');

    rejectGovernedTurn(dir, config, { errors: ['err'], failed_stage: 'schema' });

    const historyContent = readFileSync(join(dir, HISTORY_PATH), 'utf8');
    assert.equal(historyContent.trim(), '');

    const ledgerContent = readFileSync(join(dir, LEDGER_PATH), 'utf8');
    assert.equal(ledgerContent.trim(), '');
  });

  it('rejects when no turn is active', () => {
    const result = rejectGovernedTurn(dir, config, { errors: ['err'] });
    assert.ok(!result.ok);
    assert.ok(result.error.includes('No active turn'));
  });
});

// ── Tests: migrate ───────────────────────────────────────────────────────────

describe('migrate (integration)', () => {
  let dir;
  beforeEach(() => {
    dir = makeTmpDir();
  });
  afterEach(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });

  it('migrate module loads without error', async () => {
    const mod = await import('../src/commands/migrate.js');
    assert.ok(typeof mod.migrateCommand === 'function');
  });
});

// ── Tests: full accept/reject cycle ──────────────────────────────────────────

describe('full governed cycle', () => {
  let dir, config;
  beforeEach(() => {
    dir = makeTmpDir();
    config = makeNormalizedConfig();
    scaffoldGoverned(dir, 'Test Project', 'test-project');
  });
  afterEach(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });

  it('init → run → assign → accept → assign second turn', () => {
    // Initialize run
    const initResult = initializeGovernedRun(dir, config);
    assert.ok(initResult.ok);

    // Assign first turn (QA review)
    const assign1 = assignGovernedTurn(dir, config, 'qa');
    assert.ok(assign1.ok);

    // Write valid turn result
    const turnResult = makeTurnResult(assign1.state);
    writeFileSync(join(dir, STAGING_PATH), JSON.stringify(turnResult, null, 2));

    // Accept
    const accept1 = acceptGovernedTurn(dir, config);
    assert.ok(accept1.ok, `Accept failed: ${accept1.error}`);
    assert.equal(accept1.state.current_turn, null);

    // Assign second turn
    const assign2 = assignGovernedTurn(dir, config, 'dev');
    assert.ok(assign2.ok);
    assert.equal(assign2.state.current_turn.assigned_role, 'dev');

    // Verify history has one entry
    const history = readJsonl(dir, HISTORY_PATH);
    assert.equal(history.length, 1);
  });

  it('init → run → assign → reject → retry → accept', () => {
    initializeGovernedRun(dir, config);
    const assign = assignGovernedTurn(dir, config, 'qa');
    assert.ok(assign.ok);

    // First attempt: bad result, rejected
    writeFileSync(join(dir, STAGING_PATH), '{"bad": true}');
    const reject1 = rejectGovernedTurn(dir, config, { errors: ['bad'], failed_stage: 'schema' });
    assert.ok(reject1.ok);
    assert.equal(reject1.escalated, false);
    assert.equal(reject1.state.current_turn.attempt, 2);

    // Retry: good result
    const turnResult = makeTurnResult(reject1.state);
    writeFileSync(join(dir, STAGING_PATH), JSON.stringify(turnResult, null, 2));

    const accept = acceptGovernedTurn(dir, config);
    assert.ok(accept.ok, `Accept on retry failed: ${accept.error}`);

    // Only one history entry (the accepted one)
    const history = readJsonl(dir, HISTORY_PATH);
    assert.equal(history.length, 1);
  });
});

// ── Tests: Acceptance Lock ──────────────────────────────────────────────────

describe('acceptance lock', () => {
  let dir;
  beforeEach(() => { dir = makeTmpDir(); });
  afterEach(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });

  it('acquires and releases a lock', () => {
    const result = acquireAcceptanceLock(dir);
    assert.ok(result.ok);
    assert.ok(existsSync(join(dir, '.agentxchain', 'locks', 'accept-turn.lock')));

    releaseAcceptanceLock(dir);
    assert.ok(!existsSync(join(dir, '.agentxchain', 'locks', 'accept-turn.lock')));
  });

  it('blocks when lock is held by same living PID', () => {
    const first = acquireAcceptanceLock(dir);
    assert.ok(first.ok);

    const second = acquireAcceptanceLock(dir);
    assert.ok(!second.ok);
    assert.equal(second.error_code, 'lock_timeout');

    releaseAcceptanceLock(dir);
  });

  it('reclaims stale lock from dead PID', () => {
    // Write a lock with a PID that does not exist
    const lockPath = join(dir, '.agentxchain', 'locks', 'accept-turn.lock');
    mkdirSync(join(dir, '.agentxchain', 'locks'), { recursive: true });
    writeFileSync(lockPath, JSON.stringify({
      owner_pid: 999999999,
      acquired_at: new Date(Date.now() - 60_000).toISOString(),
    }));

    const result = acquireAcceptanceLock(dir);
    assert.ok(result.ok, 'Should reclaim stale lock');

    const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
    assert.equal(lock.owner_pid, process.pid);

    releaseAcceptanceLock(dir);
  });

  it('reclaims lock from living PID after 30s timeout', () => {
    // Write a lock with current PID but acquired 31s ago
    const lockPath = join(dir, '.agentxchain', 'locks', 'accept-turn.lock');
    mkdirSync(join(dir, '.agentxchain', 'locks'), { recursive: true });
    writeFileSync(lockPath, JSON.stringify({
      owner_pid: process.pid,
      acquired_at: new Date(Date.now() - 31_000).toISOString(),
    }));

    const result = acquireAcceptanceLock(dir);
    assert.ok(result.ok, 'Should reclaim lock after timeout');

    releaseAcceptanceLock(dir);
  });

  it('reclaims corrupt lock file', () => {
    const lockPath = join(dir, '.agentxchain', 'locks', 'accept-turn.lock');
    mkdirSync(join(dir, '.agentxchain', 'locks'), { recursive: true });
    writeFileSync(lockPath, 'NOT VALID JSON');

    const result = acquireAcceptanceLock(dir);
    assert.ok(result.ok, 'Should reclaim corrupt lock');

    releaseAcceptanceLock(dir);
  });
});

// ── Tests: Transaction Journal & Crash Recovery ─────────────────────────────

describe('acceptance transaction journal', { concurrency: false }, () => {
  let dir, config;
  beforeEach(() => {
    dir = makeTmpDir();
    config = makeNormalizedConfig();
    scaffoldGoverned(dir, 'Test Project', 'test-project');
    initializeGovernedRun(dir, config);
  });
  afterEach(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });

  it('acceptance creates and cleans up journal on success', () => {
    const assign = assignGovernedTurn(dir, config, 'pm');
    assert.ok(assign.ok);

    const turn = assign.state.current_turn;
    const turnResult = makeTurnResult(assign.state, turn);
    writeFileSync(join(dir, STAGING_PATH), JSON.stringify(turnResult, null, 2));

    const result = acceptGovernedTurn(dir, config);
    assert.ok(result.ok, `Accept failed: ${result.error}`);

    // Journal should be cleaned up after successful acceptance
    const journalDir = join(dir, '.agentxchain', 'transactions', 'accept');
    if (existsSync(journalDir)) {
      const files = readdirSync(journalDir).filter(f => f.endsWith('.json'));
      assert.equal(files.length, 0, 'Journal should be deleted after successful commit');
    }
  });

  it('replays prepared journal when state commit was incomplete', () => {
    const assign = assignGovernedTurn(dir, config, 'pm');
    assert.ok(assign.ok);

    const turn = assign.state.current_turn;
    const turnResult = makeTurnResult(assign.state, turn);

    // Simulate a prepared journal from a crashed acceptance
    const journalDir = join(dir, '.agentxchain', 'transactions', 'accept');
    mkdirSync(journalDir, { recursive: true });

    const state = readJson(dir, STATE_PATH);
    const acceptedSequence = (state.turn_sequence || 0) + 1;
    const historyEntry = {
      turn_id: turn.turn_id,
      run_id: state.run_id,
      role: turn.assigned_role,
      status: 'completed',
      summary: 'Did the work.',
      decisions: [],
      files_changed: [],
      observed_artifact: { files_changed: [] },
      accepted_sequence: acceptedSequence,
      assigned_sequence: turn.assigned_sequence || 1,
      concurrent_with: [],
      cost: {},
      accepted_at: new Date().toISOString(),
    };

    const remainingTurns = { ...getActiveTurns(state) };
    delete remainingTurns[turn.turn_id];
    const nextState = {
      ...state,
      turn_sequence: acceptedSequence,
      last_completed_turn_id: turn.turn_id,
      active_turns: remainingTurns,
    };
    // Remove the non-enumerable current_turn alias for serialization
    delete nextState.current_turn;

    const journal = {
      transaction_id: 'txn_test_crash_recovery',
      kind: 'accept_turn',
      run_id: state.run_id,
      turn_id: turn.turn_id,
      phase: state.phase,
      status: 'prepared',
      prepared_at: new Date().toISOString(),
      accepted_sequence: acceptedSequence,
      history_entry: historyEntry,
      ledger_entries: [],
      next_state: nextState,
    };
    writeFileSync(join(journalDir, `${journal.transaction_id}.json`), JSON.stringify(journal, null, 2));

    // Replay should recover the acceptance
    const replayed = replayPreparedJournals(dir);
    assert.equal(replayed.length, 1);
    assert.equal(replayed[0].transaction_id, 'txn_test_crash_recovery');
    assert.equal(replayed[0].action, 'full_replay');

    // Verify state was committed
    const postState = readJson(dir, STATE_PATH);
    assert.equal(postState.turn_sequence, acceptedSequence);
    assert.equal(postState.last_completed_turn_id, turn.turn_id);
    assert.ok(!getActiveTurns(postState)[turn.turn_id], 'Turn should be removed from active_turns');

    // Verify history was appended
    const history = readJsonl(dir, HISTORY_PATH);
    assert.ok(history.some(e => e.turn_id === turn.turn_id));

    // Journal should be cleaned up
    const files = readdirSync(journalDir).filter(f => f.endsWith('.json'));
    assert.equal(files.length, 0);
  });

  it('finishes cleanup-only when state already committed but artifacts remain', () => {
    const assign = assignGovernedTurn(dir, config, 'pm');
    assert.ok(assign.ok);

    const turn = assign.state.current_turn;
    const state = readJson(dir, STATE_PATH);
    const acceptedSequence = (state.turn_sequence || 0) + 1;

    // Manually commit the state as if acceptance wrote state but crashed before cleanup
    const remainingTurns = { ...getActiveTurns(state) };
    delete remainingTurns[turn.turn_id];
    const committedState = {
      ...state,
      turn_sequence: acceptedSequence,
      last_completed_turn_id: turn.turn_id,
      active_turns: remainingTurns,
    };
    delete committedState.current_turn;
    writeFileSync(join(dir, STATE_PATH), JSON.stringify(committedState, null, 2));

    // Write a prepared journal that matches the already-committed state
    const journalDir = join(dir, '.agentxchain', 'transactions', 'accept');
    mkdirSync(journalDir, { recursive: true });
    const journal = {
      transaction_id: 'txn_test_cleanup_only',
      kind: 'accept_turn',
      run_id: state.run_id,
      turn_id: turn.turn_id,
      phase: state.phase,
      status: 'prepared',
      prepared_at: new Date().toISOString(),
      accepted_sequence: acceptedSequence,
      history_entry: {},
      ledger_entries: [],
      next_state: committedState,
    };
    writeFileSync(join(journalDir, `${journal.transaction_id}.json`), JSON.stringify(journal, null, 2));

    const replayed = replayPreparedJournals(dir);
    assert.equal(replayed.length, 1);
    assert.equal(replayed[0].action, 'cleanup_only');
  });

  it('acceptance lock is released even on validation failure', () => {
    const assign = assignGovernedTurn(dir, config, 'pm');
    assert.ok(assign.ok);

    // Do NOT stage a turn result — validation will fail
    const result = acceptGovernedTurn(dir, config);
    assert.ok(!result.ok, 'Should fail validation');

    // Lock should be released
    const lockPath = join(dir, '.agentxchain', 'locks', 'accept-turn.lock');
    assert.ok(!existsSync(lockPath), 'Lock should be released after validation failure');
  });

  it('accepting healthy sibling succeeds while run is blocked', () => {
    // Use a config with max_concurrent_turns = 2
    const parallelConfig = {
      ...config,
      routing: {
        ...config.routing,
        planning: { ...config.routing.planning, max_concurrent_turns: 2 },
      },
    };

    const assign1 = assignGovernedTurn(dir, parallelConfig, 'pm');
    assert.ok(assign1.ok);
    const assign2 = assignGovernedTurn(dir, parallelConfig, 'dev');
    assert.ok(assign2.ok);

    // Block the run (simulate accepted needs_human from turn 1)
    const turn1 = assign1.state.current_turn;
    const turnResult1 = makeTurnResult(assign1.state, turn1);
    turnResult1.status = 'needs_human';
    turnResult1.needs_human_reason = 'test';
    writeFileSync(join(dir, STAGING_PATH), JSON.stringify(turnResult1, null, 2));

    const accept1 = acceptGovernedTurn(dir, config, { turnId: turn1.turn_id });
    assert.ok(accept1.ok, `Accept1 failed: ${accept1.error}`);
    assert.equal(accept1.state.status, 'blocked');

    // Now accept the healthy sibling (turn 2)
    const stateAfter = readJson(dir, STATE_PATH);
    const turn2 = getActiveTurns(stateAfter);
    const turn2Id = Object.keys(turn2)[0];
    assert.ok(turn2Id, 'Turn 2 should still be active');

    const turnResult2 = makeTurnResult(stateAfter, turn2[turn2Id]);
    writeFileSync(join(dir, STAGING_PATH), JSON.stringify(turnResult2, null, 2));

    const accept2 = acceptGovernedTurn(dir, config, { turnId: turn2Id });
    assert.ok(accept2.ok, `Accept2 failed: ${accept2.error}`);
  });

  it('runs after_acceptance hooks after the acceptance transaction commits', () => {
    config.hooks = {
      after_acceptance: [{
        name: 'commit-visible',
        type: 'process',
        command: ['./hooks/commit-visible.sh'],
        timeout_ms: 5000,
        mode: 'advisory',
      }],
    };
    writeHookScript(dir, 'commit-visible.sh', `#!/bin/sh
HISTORY_COUNT=$(wc -l < "$AGENTXCHAIN_PROJECT_ROOT/.agentxchain/history.jsonl" | tr -d ' ')
STATE_TURN=$(node -e "const fs=require('fs');const state=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));console.log(state.last_completed_turn_id || '')" "$AGENTXCHAIN_PROJECT_ROOT/.agentxchain/state.json")
if [ "$HISTORY_COUNT" = "1" ] && [ -n "$STATE_TURN" ]; then
  echo '{"verdict":"allow","annotations":[{"key":"history_entries","value":"1"}]}'
else
  echo '{"verdict":"warn","message":"acceptance not yet committed"}'
fi`);

    const assign = assignGovernedTurn(dir, config, 'pm');
    assert.ok(assign.ok);

    const turn = assign.state.current_turn;
    const turnResult = makeTurnResult(assign.state, turn);
    writeFileSync(join(dir, STAGING_PATH), JSON.stringify(turnResult, null, 2));

    const result = acceptGovernedTurn(dir, config);
    assert.ok(result.ok, `Accept failed: ${result.error}`);
    assert.ok(result.hookResults?.ok);
    assert.equal(result.hookResults.results[0].verdict, 'allow');

    const audit = readJsonl(dir, HOOK_AUDIT_PATH);
    assert.equal(audit.length, 1);
    assert.equal(audit[0].hook_name, 'commit-visible');
    assert.equal(audit[0].orchestrator_action, 'continued');

    const annotations = readJsonl(dir, HOOK_ANNOTATIONS_PATH);
    assert.equal(annotations.length, 1);
    assert.equal(annotations[0].turn_id, turn.turn_id);
    assert.equal(annotations[0].annotations[0].key, 'history_entries');

    const history = readJsonl(dir, HISTORY_PATH);
    assert.equal(history.length, 1);
    assert.equal(history[0].turn_id, turn.turn_id);
  });

  it('blocks acceptance before validation when a before_validation hook returns block', () => {
    config.hooks = {
      before_validation: [{
        name: 'pre-validate-gate',
        type: 'process',
        command: ['./hooks/pre-validate-gate.sh'],
        timeout_ms: 5000,
        mode: 'blocking',
      }],
    };
    writeHookScript(dir, 'pre-validate-gate.sh', '#!/bin/sh\necho \'{"verdict":"block","message":"manual review required before validation"}\'');

    const assign = assignGovernedTurn(dir, config, 'pm');
    assert.ok(assign.ok);

    const turn = assign.state.current_turn;
    const turnResult = makeTurnResult(assign.state, turn);
    writeFileSync(join(dir, STAGING_PATH), JSON.stringify(turnResult, null, 2));

    const result = acceptGovernedTurn(dir, config);
    assert.ok(!result.ok);
    assert.equal(result.error_code, 'hook_blocked');
    assert.equal(result.state.status, 'blocked');
    assert.equal(result.state.blocked_reason?.recovery?.typed_reason, 'hook_block');
    assert.ok(getActiveTurns(result.state)[turn.turn_id], 'Turn should remain active after before_validation block');
    assert.equal(readJsonl(dir, HISTORY_PATH).length, 0);

    const audit = readJsonl(dir, HOOK_AUDIT_PATH);
    assert.equal(audit.length, 1);
    assert.equal(audit[0].hook_phase, 'before_validation');
    assert.equal(audit[0].hook_name, 'pre-validate-gate');
    assert.equal(audit[0].orchestrator_action, 'blocked');
  });

  it('blocks acceptance after validation when an after_validation hook returns block', () => {
    config.hooks = {
      after_validation: [{
        name: 'post-validate-gate',
        type: 'process',
        command: ['./hooks/post-validate-gate.sh'],
        timeout_ms: 5000,
        mode: 'blocking',
      }],
    };
    writeHookScript(dir, 'post-validate-gate.sh', '#!/bin/sh\necho \'{"verdict":"block","message":"manual release review required after validation"}\'');

    const assign = assignGovernedTurn(dir, config, 'pm');
    assert.ok(assign.ok);

    const turn = assign.state.current_turn;
    const turnResult = makeTurnResult(assign.state, turn);
    writeFileSync(join(dir, STAGING_PATH), JSON.stringify(turnResult, null, 2));

    const result = acceptGovernedTurn(dir, config);
    assert.ok(!result.ok);
    assert.equal(result.error_code, 'hook_blocked');
    assert.equal(result.state.status, 'blocked');
    assert.equal(result.state.blocked_reason?.recovery?.typed_reason, 'hook_block');
    assert.ok(getActiveTurns(result.state)[turn.turn_id], 'Turn should remain active after after_validation block');
    assert.equal(readJsonl(dir, HISTORY_PATH).length, 0);

    const audit = readJsonl(dir, HOOK_AUDIT_PATH);
    assert.equal(audit.length, 1);
    assert.equal(audit[0].hook_phase, 'after_validation');
    assert.equal(audit[0].hook_name, 'post-validate-gate');
    assert.equal(audit[0].orchestrator_action, 'blocked');
  });

  it('blocks acceptance before commit when a before_acceptance hook returns block', () => {
    config.hooks = {
      before_acceptance: [{
        name: 'compliance-gate',
        type: 'process',
        command: ['./hooks/compliance-gate.sh'],
        timeout_ms: 5000,
        mode: 'blocking',
      }],
    };
    writeHookScript(dir, 'compliance-gate.sh', '#!/bin/sh\necho \'{"verdict":"block","message":"manual compliance review required"}\'');

    const assign = assignGovernedTurn(dir, config, 'pm');
    assert.ok(assign.ok);

    const turn = assign.state.current_turn;
    const turnResult = makeTurnResult(assign.state, turn);
    writeFileSync(join(dir, STAGING_PATH), JSON.stringify(turnResult, null, 2));

    const result = acceptGovernedTurn(dir, config);
    assert.ok(!result.ok);
    assert.equal(result.error_code, 'hook_blocked');
    assert.equal(result.state.status, 'blocked');
    assert.equal(result.state.blocked_reason?.recovery?.typed_reason, 'hook_block');
    assert.ok(getActiveTurns(result.state)[turn.turn_id], 'Turn should remain active after pre-accept block');
    assert.equal(readJsonl(dir, HISTORY_PATH).length, 0);
    assert.equal(readJsonl(dir, LEDGER_PATH).length, 0);

    const audit = readJsonl(dir, HOOK_AUDIT_PATH);
    assert.equal(audit.length, 1);
    assert.equal(audit[0].hook_name, 'compliance-gate');
    assert.equal(audit[0].orchestrator_action, 'blocked');
  });

  it('fails closed after commit when an after_acceptance hook tampers with protected state', () => {
    config.hooks = {
      after_acceptance: [{
        name: 'state-tamper',
        type: 'process',
        command: ['./hooks/state-tamper.sh'],
        timeout_ms: 5000,
        mode: 'advisory',
      }],
    };
    writeHookScript(dir, 'state-tamper.sh', `#!/bin/sh
echo '{"status":"corrupted"}' > "$AGENTXCHAIN_PROJECT_ROOT/.agentxchain/state.json"
echo '{"verdict":"allow"}'`);

    const assign = assignGovernedTurn(dir, config, 'pm');
    assert.ok(assign.ok);

    const turn = assign.state.current_turn;
    const turnResult = makeTurnResult(assign.state, turn);
    writeFileSync(join(dir, STAGING_PATH), JSON.stringify(turnResult, null, 2));

    const result = acceptGovernedTurn(dir, config);
    assert.ok(!result.ok);
    assert.equal(result.error_code, 'hook_state_tamper');
    assert.ok(result.accepted, 'Accepted history entry should still be returned after post-commit tamper');
    assert.equal(result.state.status, 'blocked');
    assert.equal(result.state.blocked_reason?.recovery?.typed_reason, 'hook_tamper');

    const history = readJsonl(dir, HISTORY_PATH);
    assert.equal(history.length, 1);
    assert.equal(history[0].turn_id, turn.turn_id);

    const audit = readJsonl(dir, HOOK_AUDIT_PATH);
    assert.equal(audit.length, 1);
    assert.equal(audit[0].orchestrator_action, 'aborted_tamper');
  });
});

// ── Tests: before_gate hooks on phase transition and run completion ─────────

describe('before_gate hooks', { concurrency: false }, () => {
  let dir;
  let config;

  beforeEach(() => {
    dir = makeTmpDir();
    mkdirSync(join(dir, '.agentxchain'), { recursive: true });
    execSync('git init', { cwd: dir, stdio: 'ignore' });
    execSync('git add -A', { cwd: dir, stdio: 'ignore' });
    execSync('git -c user.name="Test User" -c user.email="test@example.com" commit --allow-empty -m "init"', {
      cwd: dir,
      stdio: 'ignore',
    });
    config = makeNormalizedConfig();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('blocking before_gate hook stops phase transition and blocks run', () => {
    writeHookScript(dir, 'block-gate.sh', '#!/bin/sh\necho \'{"verdict":"block","message":"Compliance check failed"}\'');
    config.hooks = {
      before_gate: [{
        name: 'compliance-gate',
        type: 'process',
        command: ['./hooks/block-gate.sh'],
        timeout_ms: 5000,
        mode: 'blocking',
      }],
    };

    const state = {
      run_id: 'run_gate_test',
      project_id: 'test',
      schema_version: '1.0',
      status: 'paused',
      phase: 'planning',
      current_turn: null,
      blocked_on: 'human_approval:planning_signoff',
      pending_phase_transition: {
        from: 'planning',
        to: 'implementation',
        gate: 'planning_signoff',
        requested_by_turn: 'turn_abc',
      },
    };
    writeFileSync(join(dir, STATE_PATH), JSON.stringify(state));
    writeFileSync(join(dir, HISTORY_PATH), '');

    const result = approvePhaseTransition(dir, config);
    assert.equal(result.ok, false);
    assert.equal(result.error_code, 'hook_blocked');
    assert.ok(result.error.includes('Compliance check failed'));
    assert.equal(result.state.status, 'blocked');
    assert.ok(result.state.blocked_on.includes('before_gate'));
    assert.equal(result.state.blocked_reason?.recovery?.typed_reason, 'pending_phase_transition');
    assert.equal(result.state.blocked_reason?.recovery?.recovery_action, 'agentxchain approve-transition');

    // Transition should NOT have happened
    const diskState = JSON.parse(readFileSync(join(dir, STATE_PATH), 'utf8'));
    assert.equal(diskState.phase, 'planning');
    assert.notEqual(diskState.pending_phase_transition, null);

    const audit = readJsonl(dir, HOOK_AUDIT_PATH);
    assert.equal(audit.length, 1);
    assert.equal(audit[0].hook_phase, 'before_gate');
    assert.equal(audit[0].verdict, 'block');
  });

  it('advisory before_gate hook cannot block phase transition', () => {
    writeHookScript(dir, 'advisory-gate.sh', '#!/bin/sh\necho \'{"verdict":"block","message":"This should be downgraded"}\'');
    config.hooks = {
      before_gate: [{
        name: 'advisory-gate',
        type: 'process',
        command: ['./hooks/advisory-gate.sh'],
        timeout_ms: 5000,
        mode: 'advisory',
      }],
    };

    const state = {
      run_id: 'run_gate_test2',
      project_id: 'test',
      schema_version: '1.0',
      status: 'paused',
      phase: 'planning',
      current_turn: null,
      blocked_on: 'human_approval:planning_signoff',
      pending_phase_transition: {
        from: 'planning',
        to: 'implementation',
        gate: 'planning_signoff',
        requested_by_turn: 'turn_abc',
      },
    };
    writeFileSync(join(dir, STATE_PATH), JSON.stringify(state));
    writeFileSync(join(dir, HISTORY_PATH), '');

    const result = approvePhaseTransition(dir, config);
    assert.ok(result.ok, 'Advisory block should be downgraded, allowing transition');
    assert.equal(result.state.phase, 'implementation');

    const audit = readJsonl(dir, HOOK_AUDIT_PATH);
    assert.equal(audit.length, 1);
    assert.equal(audit[0].orchestrator_action, 'downgraded_block_to_warn');
  });

  it('blocking before_gate hook stops run completion and blocks run', () => {
    writeHookScript(dir, 'block-completion.sh', '#!/bin/sh\necho \'{"verdict":"block","message":"Final audit check failed"}\'');
    config.hooks = {
      before_gate: [{
        name: 'final-audit',
        type: 'process',
        command: ['./hooks/block-completion.sh'],
        timeout_ms: 5000,
        mode: 'blocking',
      }],
    };

    const state = {
      run_id: 'run_completion_test',
      project_id: 'test',
      schema_version: '1.0',
      status: 'paused',
      phase: 'qa',
      current_turn: null,
      blocked_on: 'human_approval:ship_gate',
      pending_run_completion: {
        gate: 'ship_gate',
        requested_by_turn: 'turn_xyz',
      },
    };
    writeFileSync(join(dir, STATE_PATH), JSON.stringify(state));
    writeFileSync(join(dir, HISTORY_PATH), '');

    const result = approveRunCompletion(dir, config);
    assert.equal(result.ok, false);
    assert.equal(result.error_code, 'hook_blocked');
    assert.ok(result.error.includes('Final audit check failed'));
    assert.equal(result.state.status, 'blocked');
    assert.equal(result.state.blocked_reason?.recovery?.typed_reason, 'pending_run_completion');
    assert.equal(result.state.blocked_reason?.recovery?.recovery_action, 'agentxchain approve-completion');

    // Run should NOT be completed
    const diskState = JSON.parse(readFileSync(join(dir, STATE_PATH), 'utf8'));
    assert.notEqual(diskState.status, 'completed');
    assert.notEqual(diskState.pending_run_completion, null);
  });

  it('tamper during before_gate fails closed and blocks run', () => {
    writeHookScript(dir, 'tamper-gate.sh', `#!/bin/sh
echo '{"status":"tampered"}' > "${dir}/.agentxchain/state.json"
echo '{"verdict":"allow"}'`);
    config.hooks = {
      before_gate: [{
        name: 'tamper-gate',
        type: 'process',
        command: ['./hooks/tamper-gate.sh'],
        timeout_ms: 5000,
        mode: 'blocking',
      }],
    };

    const state = {
      run_id: 'run_tamper_test',
      project_id: 'test',
      schema_version: '1.0',
      status: 'paused',
      phase: 'planning',
      current_turn: null,
      blocked_on: 'human_approval:planning_signoff',
      pending_phase_transition: {
        from: 'planning',
        to: 'implementation',
        gate: 'planning_signoff',
        requested_by_turn: 'turn_abc',
      },
    };
    writeFileSync(join(dir, STATE_PATH), JSON.stringify(state));
    writeFileSync(join(dir, HISTORY_PATH), '');

    const result = approvePhaseTransition(dir, config);
    assert.equal(result.ok, false);
    assert.equal(result.error_code, 'hook_state_tamper');
    assert.equal(result.state.status, 'blocked');
    assert.ok(result.state.blocked_reason?.recovery?.typed_reason === 'hook_tamper');

    const audit = readJsonl(dir, HOOK_AUDIT_PATH);
    assert.equal(audit[0].orchestrator_action, 'aborted_tamper');
  });

  it('before_gate hook receives correct gate_type payload for phase transition', () => {
    writeHookScript(dir, 'inspect-gate.sh', '#!/bin/sh\ncat > /tmp/axc-gate-payload.json\necho \'{"verdict":"allow"}\'');
    config.hooks = {
      before_gate: [{
        name: 'inspect-gate',
        type: 'process',
        command: ['./hooks/inspect-gate.sh'],
        timeout_ms: 5000,
        mode: 'advisory',
      }],
    };

    const state = {
      run_id: 'run_payload_test',
      project_id: 'test',
      schema_version: '1.0',
      status: 'paused',
      phase: 'planning',
      current_turn: null,
      blocked_on: 'human_approval:planning_signoff',
      pending_phase_transition: {
        from: 'planning',
        to: 'implementation',
        gate: 'planning_signoff',
        requested_by_turn: 'turn_abc',
      },
    };
    writeFileSync(join(dir, STATE_PATH), JSON.stringify(state));
    writeFileSync(join(dir, HISTORY_PATH), '');

    const result = approvePhaseTransition(dir, config);
    assert.ok(result.ok);

    // Verify payload was passed
    const payload = JSON.parse(readFileSync('/tmp/axc-gate-payload.json', 'utf8'));
    assert.equal(payload.payload.gate_type, 'phase_transition');
    assert.equal(payload.payload.current_phase, 'planning');
    assert.equal(payload.payload.target_phase, 'implementation');
    assert.equal(payload.hook_phase, 'before_gate');
  });

  it('gate approval succeeds without config (backward compatibility)', () => {
    const state = {
      run_id: 'run_compat_test',
      project_id: 'test',
      schema_version: '1.0',
      status: 'paused',
      phase: 'planning',
      current_turn: null,
      blocked_on: 'human_approval:planning_signoff',
      pending_phase_transition: {
        from: 'planning',
        to: 'implementation',
        gate: 'planning_signoff',
        requested_by_turn: 'turn_abc',
      },
    };
    writeFileSync(join(dir, STATE_PATH), JSON.stringify(state));

    // Call without config — should still work (no hooks run)
    const result = approvePhaseTransition(dir);
    assert.ok(result.ok);
    assert.equal(result.state.phase, 'implementation');
  });
});

// ── Tests: on_escalation hooks ──────────────────────────────────────────────

describe('on_escalation hooks', () => {
  let dir;
  let config;

  beforeEach(() => {
    dir = makeTmpDir();
    config = makeNormalizedConfig();
    // Use 2 max retries so we can exhaust them easily
    config.retry = { max_attempts: 2 };
    scaffoldGoverned(dir, config);
    initializeGovernedRun(dir, config);
  });
  afterEach(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });

  it('fires on_escalation advisory hook on retry exhaustion', () => {
    writeHookScript(dir, 'notify-escalation.sh', `#!/bin/sh
read stdin_payload
echo "$stdin_payload" > "${dir}/escalation-payload.json"
echo '{"verdict":"allow","message":"Escalation notified"}'`);
    config.hooks = {
      on_escalation: [{
        name: 'notify-escalation',
        command: [join(dir, 'hooks/notify-escalation.sh')],
        mode: 'advisory',
        timeout_ms: 5000,
      }],
    };

    assignGovernedTurn(dir, config, 'dev');

    // First rejection — retry allowed
    writeFileSync(join(dir, STAGING_PATH), '{"bad": true}');
    rejectGovernedTurn(dir, config, { errors: ['missing fields'], failed_stage: 'schema' });

    // Second rejection — retries exhausted → escalation
    writeFileSync(join(dir, STAGING_PATH), '{"bad": true}');
    const result = rejectGovernedTurn(dir, config, { errors: ['still bad'], failed_stage: 'schema' });

    assert.ok(result.ok);
    assert.equal(result.escalated, true);
    assert.equal(result.state.status, 'blocked');

    // Verify on_escalation hook was called
    assert.ok(existsSync(join(dir, 'escalation-payload.json')), 'on_escalation hook should have been called');
    const envelope = JSON.parse(readFileSync(join(dir, 'escalation-payload.json'), 'utf8'));
    assert.equal(envelope.hook_phase, 'on_escalation');
    assert.equal(envelope.payload.blocked_reason, 'retries_exhausted');
    assert.equal(envelope.payload.failed_role, 'dev');
    assert.ok(envelope.payload.failed_turn_id);
    assert.equal(envelope.payload.attempt_count, 2);

    // Verify audit trail
    const audit = readJsonl(dir, HOOK_AUDIT_PATH);
    const escalationAudit = audit.filter(e => e.hook_phase === 'on_escalation');
    assert.ok(escalationAudit.length > 0, 'on_escalation should have an audit entry');
  });

  it('fires on_escalation advisory hook on markRunBlocked with hooksConfig', () => {
    writeHookScript(dir, 'notify-blocked.sh', `#!/bin/sh
read stdin_payload
echo "$stdin_payload" > "${dir}/blocked-payload.json"
echo '{"verdict":"allow","message":"Blocked state notified"}'`);

    const hooksConfig = {
      on_escalation: [{
        name: 'notify-blocked',
        command: [join(dir, 'hooks/notify-blocked.sh')],
        mode: 'advisory',
        timeout_ms: 5000,
      }],
    };

    assignGovernedTurn(dir, config, 'dev');
    const state = JSON.parse(readFileSync(join(dir, STATE_PATH), 'utf8'));
    const turnId = getActiveTurn(state)?.turn_id;

    const blocked = markRunBlocked(dir, {
      blockedOn: 'dispatch:api_proxy_failure',
      category: 'dispatch_error',
      recovery: {
        typed_reason: 'dispatch_error',
        owner: 'human',
        recovery_action: 'Resolve the dispatch issue',
        turn_retained: true,
        detail: 'API proxy failed',
      },
      turnId,
      hooksConfig,
    });

    assert.ok(blocked.ok);
    assert.equal(blocked.state.status, 'blocked');

    // Verify on_escalation hook was called
    assert.ok(existsSync(join(dir, 'blocked-payload.json')), 'on_escalation hook should have been called');
    const envelope = JSON.parse(readFileSync(join(dir, 'blocked-payload.json'), 'utf8'));
    assert.equal(envelope.hook_phase, 'on_escalation');
    assert.equal(envelope.payload.blocked_reason, 'dispatch_error');
    assert.equal(envelope.payload.failed_turn_id, turnId);
  });

  it('does not fire on_escalation when hooksConfig is absent from markRunBlocked', () => {
    assignGovernedTurn(dir, config, 'dev');
    const state = JSON.parse(readFileSync(join(dir, STATE_PATH), 'utf8'));
    const turnId = getActiveTurn(state)?.turn_id;

    const blocked = markRunBlocked(dir, {
      blockedOn: 'dispatch:timeout',
      category: 'dispatch_error',
      recovery: {
        typed_reason: 'dispatch_error',
        owner: 'human',
        recovery_action: 'Fix timeout',
        turn_retained: true,
        detail: 'Timed out',
      },
      turnId,
    });

    assert.ok(blocked.ok);
    assert.equal(blocked.state.status, 'blocked');

    // No hook-audit should exist for on_escalation
    if (existsSync(join(dir, HOOK_AUDIT_PATH))) {
      const audit = readJsonl(dir, HOOK_AUDIT_PATH);
      const escalationAudit = audit.filter(e => e.hook_phase === 'on_escalation');
      assert.equal(escalationAudit.length, 0, 'on_escalation should not fire without hooksConfig');
    }
  });

  it('on_escalation cannot block — advisory verdict is always swallowed', () => {
    writeHookScript(dir, 'block-escalation.sh', `#!/bin/sh
echo '{"verdict":"block","message":"Trying to block escalation"}'`);
    config.hooks = {
      on_escalation: [{
        name: 'block-escalation',
        command: [join(dir, 'hooks/block-escalation.sh')],
        mode: 'advisory',
        timeout_ms: 5000,
      }],
    };

    assignGovernedTurn(dir, config, 'dev');

    // Exhaust retries
    writeFileSync(join(dir, STAGING_PATH), '{"bad": true}');
    rejectGovernedTurn(dir, config, { errors: ['err'], failed_stage: 'schema' });
    writeFileSync(join(dir, STAGING_PATH), '{"bad": true}');
    const result = rejectGovernedTurn(dir, config, { errors: ['err'], failed_stage: 'schema' });

    // The escalation should still succeed — hook block verdict is downgraded
    assert.ok(result.ok);
    assert.equal(result.escalated, true);
    assert.equal(result.state.status, 'blocked');

    // Audit should show the block was downgraded to warn
    const audit = readJsonl(dir, HOOK_AUDIT_PATH);
    const escalationAudit = audit.filter(e => e.hook_phase === 'on_escalation');
    assert.ok(escalationAudit.length > 0);
  });

  it('on_escalation tamper does not prevent blocked state from being returned', () => {
    writeHookScript(dir, 'tamper-escalation.sh', `#!/bin/sh
echo '{"status":"tampered"}' > "${dir}/.agentxchain/state.json"
echo '{"verdict":"allow"}'`);
    config.hooks = {
      on_escalation: [{
        name: 'tamper-escalation',
        command: [join(dir, 'hooks/tamper-escalation.sh')],
        mode: 'advisory',
        timeout_ms: 5000,
      }],
    };

    assignGovernedTurn(dir, config, 'dev');

    writeFileSync(join(dir, STAGING_PATH), '{"bad": true}');
    rejectGovernedTurn(dir, config, { errors: ['err'], failed_stage: 'schema' });
    writeFileSync(join(dir, STAGING_PATH), '{"bad": true}');
    const result = rejectGovernedTurn(dir, config, { errors: ['err'], failed_stage: 'schema' });

    // The escalation must still succeed — on_escalation is advisory
    // and _fireOnEscalationHooks swallows errors
    assert.ok(result.ok);
    assert.equal(result.escalated, true);
  });
});
