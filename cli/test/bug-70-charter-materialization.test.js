/**
 * BUG-70: Idle-expansion new_intake_intent proposals must be materialized
 * into planning artifacts before implementation dispatch.
 *
 * When a PM idle-expansion turn produces `idle_expansion_result` with
 * `kind: "new_intake_intent"`, the orchestrator must suppress the
 * phase_transition_request and store `charter_materialization_pending`
 * on the state. Implementation dispatch is blocked until a subsequent
 * non-idle-expansion PM turn materializes the charter.
 *
 * Spec: .planning/BUG_70_IDLE_EXPANSION_CHARTER_MATERIALIZATION_SPEC.md
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

import {
  initializeGovernedRun,
  assignGovernedTurn,
  acceptGovernedTurn,
  getActiveTurn,
} from '../src/lib/governed-state.js';
import { readRunEvents } from '../src/lib/run-events.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

const tempDirs = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

function makeTmpDir() {
  const dir = join(tmpdir(), `axc-bug70-${randomBytes(6).toString('hex')}`);
  mkdirSync(dir, { recursive: true });
  tempDirs.push(dir);
  return dir;
}

function makeConfig(overrides = {}) {
  return {
    schema_version: 4,
    protocol_mode: 'governed',
    project: { id: 'bug70-test', name: 'BUG-70 Test', default_branch: 'main' },
    roles: {
      pm: { title: 'PM', mandate: 'Plan', write_authority: 'authoritative', runtime_class: 'local_cli', runtime_id: 'local-pm' },
      dev: { title: 'Developer', mandate: 'Build', write_authority: 'authoritative', runtime_class: 'local_cli', runtime_id: 'local-dev' },
    },
    runtimes: { 'local-pm': { type: 'local_cli' }, 'local-dev': { type: 'local_cli' } },
    routing: {
      planning: { entry_role: 'pm', allowed_next_roles: ['pm', 'dev'], exit_gate: 'planning_signoff' },
      implementation: { entry_role: 'dev', allowed_next_roles: ['dev'], exit_gate: 'implementation_complete' },
    },
    gates: {
      planning_signoff: {},
      implementation_complete: {},
    },
    budget: { per_turn_max_usd: 2.0, per_run_max_usd: 50.0 },
    rules: { challenge_required: false, max_turn_retries: 2, max_deadlock_cycles: 2 },
    files: { talk: 'TALK.md', history: '.agentxchain/history.jsonl', state: '.agentxchain/state.json' },
    compat: { next_owner_source: 'state-json', lock_based_coordination: false, original_version: 4 },
    ...overrides,
  };
}

function makeAutoApproveConfig(overrides = {}) {
  return makeConfig({
    approval_policy: {
      phase_transitions: { default: 'auto_approve' },
      run_completion: { action: 'auto_approve' },
    },
    ...overrides,
  });
}

function scaffoldProject(dir, config) {
  mkdirSync(join(dir, '.agentxchain', 'dispatch', 'turns'), { recursive: true });
  mkdirSync(join(dir, '.agentxchain', 'staging'), { recursive: true });
  mkdirSync(join(dir, '.agentxchain', 'intake', 'events'), { recursive: true });
  mkdirSync(join(dir, '.agentxchain', 'intake', 'intents'), { recursive: true });
  mkdirSync(join(dir, '.planning'), { recursive: true });
  writeFileSync(join(dir, 'agentxchain.json'), JSON.stringify(config, null, 2));
  writeFileSync(join(dir, '.agentxchain', 'history.jsonl'), '');
  writeFileSync(join(dir, '.agentxchain', 'decision-ledger.jsonl'), '');
  writeFileSync(join(dir, '.agentxchain', 'run-history.jsonl'), '');
}

function makeTurnResult(state, overrides = {}) {
  const turn = getActiveTurn(state);
  return {
    schema_version: '1.0',
    run_id: state.run_id,
    turn_id: turn.turn_id,
    role: turn.assigned_role,
    runtime_id: turn.runtime_id,
    status: 'completed',
    summary: 'Test turn.',
    decisions: [],
    objections: [],
    files_changed: [],
    artifacts_created: [],
    proposed_next_role: 'pm',
    verification: { status: 'pass', commands: ['echo ok'], exit_code: 0, evidence_summary: 'OK', machine_evidence: [{ command: 'echo ok', exit_code: 0 }] },
    artifact: { type: 'review', ref: null },
    cost: { input_tokens: 100, output_tokens: 50, usd: 0.01 },
    ...overrides,
  };
}

function readState(dir) {
  return JSON.parse(readFileSync(join(dir, '.agentxchain', 'state.json'), 'utf8'));
}

function readEvents(dir) {
  const p = join(dir, '.agentxchain', 'events.jsonl');
  if (!existsSync(p)) return [];
  return readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
}

function stageTurnResult(dir, state, turnResult) {
  const turn = getActiveTurn(state);
  const stagingDir = join(dir, '.agentxchain', 'staging', turn.turn_id);
  mkdirSync(stagingDir, { recursive: true });
  writeFileSync(join(stagingDir, 'turn-result.json'), JSON.stringify(turnResult, null, 2));
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('BUG-70: charter materialization guard', () => {

  it('AT-BUG70-001: idle-expansion new_intake_intent suppresses phase_transition_request', () => {
    const dir = makeTmpDir();
    const config = makeAutoApproveConfig();
    scaffoldProject(dir, config);

    // Initialize run and assign PM turn
    const initResult = initializeGovernedRun(dir, config);
    assert.ok(initResult.ok, `init failed: ${initResult.error}`);
    const assignResult = assignGovernedTurn(dir, config, 'pm');
    assert.ok(assignResult.ok, `assign failed: ${assignResult.error}`);

    const state = readState(dir);
    const turnResult = makeTurnResult(state, {
      phase_transition_request: 'implementation',
      idle_expansion_result: {
        kind: 'new_intake_intent',
        expansion_iteration: 1,
        new_intake_intent: {
          title: 'M28: User Authentication Module',
          charter: 'Implement M28: user authentication module',
          acceptance_contract: ['Tests pass', 'Auth endpoint responds 200'],
          priority: 'p1',
          template: 'generic',
        },
        vision_traceability: [
          { vision_heading: 'Core Features', goal: 'user auth', kind: 'advances' },
        ],
      },
    });

    stageTurnResult(dir, state, turnResult);
    const acceptResult = acceptGovernedTurn(dir, config);
    assert.ok(acceptResult.ok, `accept failed: ${acceptResult.error}`);

    // Phase must NOT have advanced to implementation
    const postState = readState(dir);
    assert.strictEqual(postState.phase, 'planning',
      'Phase must stay in planning when idle-expansion new_intake_intent suppresses transition');
    assert.strictEqual(postState.queued_phase_transition, null,
      'queued_phase_transition must be null after suppression');

    // charter_materialization_pending must be set
    assert.ok(postState.charter_materialization_pending,
      'charter_materialization_pending must be set on state');
    assert.strictEqual(postState.charter_materialization_pending.charter,
      'Implement M28: user authentication module');
    assert.strictEqual(postState.charter_materialization_pending.suppressed_transition,
      'implementation');
    assert.ok(Array.isArray(postState.charter_materialization_pending.acceptance_contract));
    assert.strictEqual(postState.charter_materialization_pending.acceptance_contract.length, 2);
  });

  it('AT-BUG71-001: idle-expansion new_intake_intent needs_human is converted to charter materialization', () => {
    const dir = makeTmpDir();
    const config = makeAutoApproveConfig();
    scaffoldProject(dir, config);

    const initResult = initializeGovernedRun(dir, config);
    assert.ok(initResult.ok, `init failed: ${initResult.error}`);
    const assignResult = assignGovernedTurn(dir, config, 'pm');
    assert.ok(assignResult.ok, `assign failed: ${assignResult.error}`);

    const state = readState(dir);
    const turnResult = makeTurnResult(state, {
      status: 'needs_human',
      needs_human_reason: 'Accepting M28 is a human scope decision.',
      proposed_next_role: 'human',
      phase_transition_request: null,
      idle_expansion_result: {
        kind: 'new_intake_intent',
        expansion_iteration: 1,
        new_intake_intent: {
          title: 'M28: Sensitivity Class Inference',
          charter: 'Materialize M28 sensitivity classification into planning artifacts',
          acceptance_contract: ['SYSTEM_SPEC covers M28', 'ROADMAP includes M28'],
          priority: 'p1',
          template: 'generic',
        },
        vision_traceability: [
          { vision_heading: 'Data and schema understanding', goal: 'classify sensitivity', kind: 'advances' },
        ],
      },
    });

    stageTurnResult(dir, state, turnResult);
    const acceptResult = acceptGovernedTurn(dir, config);
    assert.ok(acceptResult.ok, `accept failed: ${acceptResult.error}`);

    const postState = readState(dir);
    assert.strictEqual(postState.status, 'active',
      'idle-expansion intake proposal must not block on a human-only scope decision under full-auto');
    assert.strictEqual(postState.blocked_on, null,
      'blocked_on must stay null when needs_human is suppressed for idle-expansion materialization');
    assert.strictEqual(postState.phase, 'planning',
      'phase must remain planning until the charter is materialized');
    assert.strictEqual(postState.next_recommended_role, 'pm',
      'next recommended role must stay PM so the charter can be materialized');
    assert.ok(postState.charter_materialization_pending,
      'charter_materialization_pending must be set from the new intake intent');
    assert.strictEqual(postState.charter_materialization_pending.suppressed_transition, 'implementation');

    const events = readEvents(dir);
    const materializationEvent = events.find(e => e.event_type === 'charter_materialization_required');
    assert.ok(materializationEvent, 'must emit charter_materialization_required');
    assert.strictEqual(materializationEvent.payload.suppressed_needs_human, true);
    assert.doesNotMatch(materializationEvent.payload.reason, /human/i);
  });

  it('AT-BUG72-001: idle-expansion new_intake_intent phase request bypasses pre-materialization gate semantic coverage', () => {
    const dir = makeTmpDir();
    const config = makeAutoApproveConfig({
      gates: {
        planning_signoff: {
          requires_files: [
            '.planning/PM_SIGNOFF.md',
            '.planning/ROADMAP.md',
            '.planning/SYSTEM_SPEC.md',
            '.planning/command-surface.md',
          ],
        },
        implementation_complete: {},
      },
    });
    scaffoldProject(dir, config);

    const initResult = initializeGovernedRun(dir, config);
    assert.ok(initResult.ok, `init failed: ${initResult.error}`);
    const assignResult = assignGovernedTurn(dir, config, 'pm');
    assert.ok(assignResult.ok, `assign failed: ${assignResult.error}`);

    const state = readState(dir);
    writeFileSync(join(dir, '.planning', 'IDLE_EXPANSION_NOTE.md'), 'Proposed M28 intake.\n');
    const turnResult = makeTurnResult(state, {
      phase_transition_request: 'implementation',
      files_changed: ['.planning/IDLE_EXPANSION_NOTE.md'],
      artifact: { type: 'workspace', ref: 'git:dirty' },
      idle_expansion_result: {
        kind: 'new_intake_intent',
        expansion_iteration: 1,
        new_intake_intent: {
          title: 'M28: Sensitivity Class Inference',
          charter: 'Materialize M28 sensitivity classification into planning artifacts',
          acceptance_contract: ['SYSTEM_SPEC covers M28', 'ROADMAP includes M28'],
          priority: 'p1',
          template: 'generic',
        },
        vision_traceability: [
          { vision_heading: 'Data and schema understanding', goal: 'classify sensitivity', kind: 'advances' },
        ],
      },
    });

    stageTurnResult(dir, state, turnResult);
    const acceptResult = acceptGovernedTurn(dir, config);
    assert.ok(acceptResult.ok, `accept failed: ${acceptResult.error}`);

    const postState = readState(dir);
    assert.strictEqual(postState.status, 'active');
    assert.strictEqual(postState.phase, 'planning');
    assert.strictEqual(postState.blocked_on, null);
    assert.strictEqual(postState.next_recommended_role, 'pm',
      'materialization must route back to the proposing planning role, not the proposed implementation role');
    assert.strictEqual(postState.active_turns && Object.keys(postState.active_turns).length, 0);
    assert.ok(postState.charter_materialization_pending,
      'gate semantic coverage must not reject before materialization pending is stored');
    assert.strictEqual(postState.charter_materialization_pending.suppressed_transition, 'implementation');

    const events = readEvents(dir);
    assert.ok(events.some(e => e.event_type === 'charter_materialization_required'));
  });

  it('AT-BUG73-001: idle-expansion materialization ignores proposed dev next role until PM materializes charter', () => {
    const dir = makeTmpDir();
    const config = makeAutoApproveConfig();
    scaffoldProject(dir, config);

    const initResult = initializeGovernedRun(dir, config);
    assert.ok(initResult.ok, `init failed: ${initResult.error}`);
    const assignResult = assignGovernedTurn(dir, config, 'pm');
    assert.ok(assignResult.ok, `assign failed: ${assignResult.error}`);

    const state = readState(dir);
    const turnResult = makeTurnResult(state, {
      proposed_next_role: 'dev',
      phase_transition_request: 'implementation',
      idle_expansion_result: {
        kind: 'new_intake_intent',
        expansion_iteration: 1,
        new_intake_intent: {
          title: 'M28: Sensitivity Class Inference',
          charter: 'Materialize M28 sensitivity classification into planning artifacts',
          acceptance_contract: ['SYSTEM_SPEC covers M28', 'ROADMAP includes M28'],
          priority: 'p1',
          template: 'generic',
        },
        vision_traceability: [
          { vision_heading: 'Data and schema understanding', goal: 'classify sensitivity', kind: 'advances' },
        ],
      },
    });

    stageTurnResult(dir, state, turnResult);
    const acceptResult = acceptGovernedTurn(dir, config);
    assert.ok(acceptResult.ok, `accept failed: ${acceptResult.error}`);

    const postState = readState(dir);
    assert.strictEqual(postState.phase, 'planning');
    assert.ok(postState.charter_materialization_pending);
    assert.strictEqual(postState.next_recommended_role, 'pm',
      'the PM who proposed the idle-expansion intake must receive the materialization turn');
  });

  it('AT-BUG70-002: suppression emits charter_materialization_required event with descriptive message', () => {
    const dir = makeTmpDir();
    const config = makeAutoApproveConfig();
    scaffoldProject(dir, config);

    const initResult = initializeGovernedRun(dir, config);
    assert.ok(initResult.ok);
    const assignResult = assignGovernedTurn(dir, config, 'pm');
    assert.ok(assignResult.ok);

    const state = readState(dir);
    const turnResult = makeTurnResult(state, {
      phase_transition_request: 'implementation',
      idle_expansion_result: {
        kind: 'new_intake_intent',
        expansion_iteration: 1,
        new_intake_intent: {
          title: 'Logging Middleware',
          charter: 'Add logging middleware',
          acceptance_contract: ['Logs are written'],
          priority: 'p2',
          template: 'generic',
        },
        vision_traceability: [
          { vision_heading: 'Core Features', goal: 'logging', kind: 'advances' },
        ],
      },
    });

    stageTurnResult(dir, state, turnResult);
    acceptGovernedTurn(dir, config);

    const events = readEvents(dir);
    const materializationEvent = events.find(e => e.event_type === 'charter_materialization_required');
    assert.ok(materializationEvent, 'Must emit charter_materialization_required event');
    assert.strictEqual(materializationEvent.payload.suppressed_transition, 'implementation');
    assert.match(materializationEvent.payload.reason, /materialized.*planning.*artifact/i,
      'Event reason must name the missing materialization step');
    assert.strictEqual(materializationEvent.payload.new_intake_charter, 'Add logging middleware');

    // Must NOT ask for generic human approval
    assert.doesNotMatch(materializationEvent.payload.reason, /human/i,
      'Event reason must not ask for human approval under full-auto policy');
  });

  it('AT-BUG70-003: non-idle-expansion PM turn clears materialization and allows phase advance', () => {
    const dir = makeTmpDir();
    const config = makeAutoApproveConfig();
    scaffoldProject(dir, config);

    // Step 1: idle-expansion PM turn — transition suppressed
    const initResult = initializeGovernedRun(dir, config);
    assert.ok(initResult.ok);
    const assign1 = assignGovernedTurn(dir, config, 'pm');
    assert.ok(assign1.ok);

    const state1 = readState(dir);
    const turnResult1 = makeTurnResult(state1, {
      phase_transition_request: 'implementation',
      idle_expansion_result: {
        kind: 'new_intake_intent',
        expansion_iteration: 1,
        new_intake_intent: {
          title: 'Feature X',
          charter: 'Build feature X',
          acceptance_contract: ['Feature X works'],
          priority: 'p1',
          template: 'generic',
        },
        vision_traceability: [
          { vision_heading: 'Core Features', goal: 'feature X', kind: 'advances' },
        ],
      },
    });
    stageTurnResult(dir, state1, turnResult1);
    const accept1 = acceptGovernedTurn(dir, config);
    assert.ok(accept1.ok);

    const midState = readState(dir);
    assert.strictEqual(midState.phase, 'planning', 'Phase stays in planning after idle-expansion');
    assert.ok(midState.charter_materialization_pending, 'materialization pending is set');

    // Step 2: regular PM turn — materializes charter and requests transition
    const assign2 = assignGovernedTurn(dir, config, 'pm');
    assert.ok(assign2.ok, `second assign failed: ${assign2.error}`);

    const state2 = readState(dir);
    const turnResult2 = makeTurnResult(state2, {
      phase_transition_request: 'implementation',
      summary: 'Materialized charter for Feature X into SYSTEM_SPEC and PM_SIGNOFF.',
      files_changed: ['.planning/SYSTEM_SPEC.md', '.planning/PM_SIGNOFF.md', '.planning/ROADMAP.md'],
    });
    stageTurnResult(dir, state2, turnResult2);
    const accept2 = acceptGovernedTurn(dir, config);
    assert.ok(accept2.ok, `second accept failed: ${accept2.error}`);

    const finalState = readState(dir);
    // Charter materialization pending must be cleared
    assert.strictEqual(finalState.charter_materialization_pending, null,
      'charter_materialization_pending must be cleared after non-idle-expansion PM turn');
    // Phase must have advanced to implementation
    assert.strictEqual(finalState.phase, 'implementation',
      'Phase must advance to implementation after charter is materialized');
  });

  it('AT-BUG70-REGRESSION: normal phase transition still works without idle-expansion', () => {
    const dir = makeTmpDir();
    const config = makeAutoApproveConfig();
    scaffoldProject(dir, config);

    const initResult = initializeGovernedRun(dir, config);
    assert.ok(initResult.ok);
    const assignResult = assignGovernedTurn(dir, config, 'pm');
    assert.ok(assignResult.ok);

    const state = readState(dir);
    const turnResult = makeTurnResult(state, {
      phase_transition_request: 'implementation',
      summary: 'Planning complete, ready for implementation.',
      files_changed: ['.planning/SYSTEM_SPEC.md'],
    });

    stageTurnResult(dir, state, turnResult);
    const acceptResult = acceptGovernedTurn(dir, config);
    assert.ok(acceptResult.ok, `accept failed: ${acceptResult.error}`);

    const postState = readState(dir);
    // Normal transition must work
    assert.strictEqual(postState.phase, 'implementation',
      'Normal PM phase transition (no idle expansion) must still advance');
    assert.strictEqual(postState.charter_materialization_pending, undefined,
      'charter_materialization_pending must not be set for normal transitions');
  });

  it('AT-BUG70-004: idle-expansion vision_exhausted kind does NOT suppress transition', () => {
    const dir = makeTmpDir();
    const config = makeAutoApproveConfig();
    scaffoldProject(dir, config);

    const initResult = initializeGovernedRun(dir, config);
    assert.ok(initResult.ok);
    const assignResult = assignGovernedTurn(dir, config, 'pm');
    assert.ok(assignResult.ok);

    const state = readState(dir);
    const turnResult = makeTurnResult(state, {
      phase_transition_request: 'implementation',
      idle_expansion_result: {
        kind: 'vision_exhausted',
        expansion_iteration: 1,
        vision_exhausted: {
          classification: [
            { vision_heading: 'Core Features', status: 'complete', reason: 'All features shipped.' },
          ],
        },
        vision_traceability: [],
      },
    });

    stageTurnResult(dir, state, turnResult);
    const acceptResult = acceptGovernedTurn(dir, config);
    assert.ok(acceptResult.ok, `accept failed: ${acceptResult.error}`);

    const postState = readState(dir);
    // vision_exhausted should NOT suppress transition
    assert.strictEqual(postState.phase, 'implementation',
      'vision_exhausted kind must not suppress phase transition');
  });
});
