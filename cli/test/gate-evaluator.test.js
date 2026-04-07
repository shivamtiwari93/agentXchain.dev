import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';
import { gitInit, gitCommitAll } from '../test-support/git-test-helpers.js';

import { evaluatePhaseExit, getPhaseOrder } from '../src/lib/gate-evaluator.js';
import {
  initializeGovernedRun,
  assignGovernedTurn,
  acceptGovernedTurn,
  approvePhaseTransition,
  STATE_PATH,
} from '../src/lib/governed-state.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeTmpDir() {
  const dir = join(tmpdir(), `axc-gate-test-${randomBytes(6).toString('hex')}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function readJson(root, relPath) {
  return JSON.parse(readFileSync(join(root, relPath), 'utf8'));
}

function makeConfig(overrides = {}) {
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
    gates: {
      planning_signoff: {
        requires_files: ['.planning/PM_SIGNOFF.md', '.planning/ROADMAP.md', '.planning/SYSTEM_SPEC.md'],
        requires_human_approval: true,
      },
      implementation_complete: {
        requires_files: ['.planning/IMPLEMENTATION_NOTES.md'],
        requires_verification_pass: true,
      },
      qa_ship_verdict: {
        requires_files: ['.planning/acceptance-matrix.md', '.planning/ship-verdict.md', '.planning/RELEASE_NOTES.md'],
        requires_human_approval: true,
      },
    },
    budget: { per_turn_max_usd: 2.0, per_run_max_usd: 50.0 },
    rules: { challenge_required: true, max_turn_retries: 2, max_deadlock_cycles: 2 },
    files: { talk: 'TALK.md', history: '.agentxchain/history.jsonl', state: '.agentxchain/state.json' },
    compat: { next_owner_source: 'state-json', lock_based_coordination: false, original_version: 4 },
    ...overrides,
  };
}

function makeState(overrides = {}) {
  return {
    run_id: 'run_test123',
    project_id: 'test-project',
    status: 'active',
    phase: 'planning',
    current_turn: null,
    blocked_on: null,
    ...overrides,
  };
}

function makeTurnResult(overrides = {}) {
  return {
    schema_version: '1.0',
    run_id: 'run_test123',
    turn_id: 'turn_test456',
    role: 'pm',
    runtime_id: 'manual-pm',
    status: 'completed',
    summary: 'Planning complete.',
    decisions: [],
    objections: [{ id: 'OBJ-001', severity: 'low', statement: 'No issues found.' }],
    files_changed: [],
    artifacts_created: [],
    verification: { status: 'pass' },
    artifact: { type: 'review', ref: null },
    proposed_next_role: 'dev',
    phase_transition_request: null,
    cost: { input_tokens: 100, output_tokens: 50, usd: 0.01 },
    ...overrides,
  };
}

function makePassingAcceptanceMatrix() {
  return '# Acceptance Matrix\n\n| Req # | Requirement | Acceptance criteria | Test status | Last tested | Status |\n|-------|-------------|-------------------|-------------|-------------|--------|\n| 1 | Example requirement | Example acceptance criterion | pass | 2026-04-06 | pass |\n';
}

// ── Pure evaluatePhaseExit tests ─────────────────────────────────────────────

describe('evaluatePhaseExit — pure function', () => {
  let root;

  beforeEach(() => {
    root = makeTmpDir();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('Rule 1: returns no_request when phase_transition_request is null', () => {
    const result = evaluatePhaseExit({
      state: makeState(),
      config: makeConfig(),
      acceptedTurn: makeTurnResult({ phase_transition_request: null }),
      root,
    });
    assert.equal(result.action, 'no_request');
    assert.equal(result.passed, false);
    assert.equal(result.next_phase, null);
    assert.equal(result.transition_request, null);
  });

  it('Rule 1: returns no_request when phase_transition_request is absent', () => {
    const turn = makeTurnResult();
    delete turn.phase_transition_request;
    const result = evaluatePhaseExit({
      state: makeState(),
      config: makeConfig(),
      acceptedTurn: turn,
      root,
    });
    assert.equal(result.action, 'no_request');
  });

  it('Rule 2: returns unknown_phase for unrecognized target phase', () => {
    const result = evaluatePhaseExit({
      state: makeState(),
      config: makeConfig(),
      acceptedTurn: makeTurnResult({ phase_transition_request: 'nonexistent' }),
      root,
    });
    assert.equal(result.action, 'unknown_phase');
    assert.equal(result.passed, false);
    assert.ok(result.reasons[0].includes('nonexistent'));
  });

  it('Rule 3: gate_failed when required files are missing', () => {
    const result = evaluatePhaseExit({
      state: makeState({ phase: 'planning' }),
      config: makeConfig(),
      acceptedTurn: makeTurnResult({ phase_transition_request: 'implementation' }),
      root,
    });
    assert.equal(result.action, 'gate_failed');
    assert.equal(result.passed, false);
    assert.equal(result.gate_id, 'planning_signoff');
    assert.equal(result.missing_files.length, 3);
    assert.ok(result.missing_files.includes('.planning/PM_SIGNOFF.md'));
    assert.ok(result.missing_files.includes('.planning/ROADMAP.md'));
    assert.ok(result.missing_files.includes('.planning/SYSTEM_SPEC.md'));
  });

  it('Rule 3: gate_failed when some files exist but not all', () => {
    // Create one of the required files
    mkdirSync(join(root, '.planning'), { recursive: true });
    writeFileSync(join(root, '.planning', 'PM_SIGNOFF.md'), 'Approved: YES\n');

    const result = evaluatePhaseExit({
      state: makeState({ phase: 'planning' }),
      config: makeConfig(),
      acceptedTurn: makeTurnResult({ phase_transition_request: 'implementation' }),
      root,
    });
    assert.equal(result.action, 'gate_failed');
    assert.equal(result.missing_files.length, 2);
    assert.ok(result.missing_files.includes('.planning/ROADMAP.md'));
    assert.ok(result.missing_files.includes('.planning/SYSTEM_SPEC.md'));
  });

  it('Rule 3: gate_failed when verification required but not passed', () => {
    // Create valid implementation notes so the only failure is verification
    mkdirSync(join(root, '.planning'), { recursive: true });
    writeFileSync(join(root, '.planning', 'IMPLEMENTATION_NOTES.md'), '# Notes\n\n## Changes\n\nBuilt the feature.\n\n## Verification\n\nRun npm test.\n');

    const result = evaluatePhaseExit({
      state: makeState({ phase: 'implementation' }),
      config: makeConfig(),
      acceptedTurn: makeTurnResult({
        phase_transition_request: 'qa',
        verification: { status: 'fail' },
      }),
      root,
    });
    assert.equal(result.action, 'gate_failed');
    assert.equal(result.missing_verification, true);
    assert.ok(result.reasons[0].includes('fail'));
  });

  it('Rule 4: advance when gate passes without human approval', () => {
    // Create required implementation notes file
    mkdirSync(join(root, '.planning'), { recursive: true });
    writeFileSync(join(root, '.planning', 'IMPLEMENTATION_NOTES.md'), '# Notes\n\n## Changes\n\nBuilt the feature.\n\n## Verification\n\nRun npm test.\n');

    const result = evaluatePhaseExit({
      state: makeState({ phase: 'implementation' }),
      config: makeConfig(),
      acceptedTurn: makeTurnResult({
        phase_transition_request: 'qa',
        verification: { status: 'pass' },
      }),
      root,
    });
    assert.equal(result.action, 'advance');
    assert.equal(result.passed, true);
    assert.equal(result.next_phase, 'qa');
    assert.equal(result.gate_id, 'implementation_complete');
  });

  it('Rule 4: advance when verification is attested_pass', () => {
    // Create required implementation notes file
    mkdirSync(join(root, '.planning'), { recursive: true });
    writeFileSync(join(root, '.planning', 'IMPLEMENTATION_NOTES.md'), '# Notes\n\n## Changes\n\nBuilt the feature.\n\n## Verification\n\nRun npm test.\n');

    const result = evaluatePhaseExit({
      state: makeState({ phase: 'implementation' }),
      config: makeConfig(),
      acceptedTurn: makeTurnResult({
        phase_transition_request: 'qa',
        verification: { status: 'attested_pass' },
      }),
      root,
    });
    assert.equal(result.action, 'advance');
    assert.equal(result.passed, true);
  });

  it('Rule 5: awaiting_human_approval when gate passes but requires approval', () => {
    // Create required files for planning_signoff
    mkdirSync(join(root, '.planning'), { recursive: true });
    writeFileSync(join(root, '.planning', 'PM_SIGNOFF.md'), 'Approved: YES\n');
    writeFileSync(join(root, '.planning', 'ROADMAP.md'), 'Roadmap content.');
    writeFileSync(join(root, '.planning', 'SYSTEM_SPEC.md'), '# System Spec\n\n## Purpose\n\nSpec.\n\n## Interface\n\nSpec.\n\n## Acceptance Tests\n\n- [ ] Spec.\n');

    const result = evaluatePhaseExit({
      state: makeState({ phase: 'planning' }),
      config: makeConfig(),
      acceptedTurn: makeTurnResult({ phase_transition_request: 'implementation' }),
      root,
    });
    assert.equal(result.action, 'awaiting_human_approval');
    assert.equal(result.passed, true);
    assert.equal(result.blocked_by_human_approval, true);
    assert.equal(result.next_phase, 'implementation');
    assert.equal(result.gate_id, 'planning_signoff');
  });

  it('AT-WFG-001: gate_failed when PM_SIGNOFF exists but is not Approved: YES', () => {
    mkdirSync(join(root, '.planning'), { recursive: true });
    writeFileSync(join(root, '.planning', 'PM_SIGNOFF.md'), 'Approved: NO\n');
    writeFileSync(join(root, '.planning', 'ROADMAP.md'), 'Roadmap content.\n');
    writeFileSync(join(root, '.planning', 'SYSTEM_SPEC.md'), '# System Spec\n\n## Purpose\n\nSpec.\n\n## Interface\n\nSpec.\n\n## Acceptance Tests\n\n- [ ] Spec.\n');

    const result = evaluatePhaseExit({
      state: makeState({ phase: 'planning' }),
      config: makeConfig(),
      acceptedTurn: makeTurnResult({ phase_transition_request: 'implementation' }),
      root,
    });

    assert.equal(result.action, 'gate_failed');
    assert.equal(result.passed, false);
    assert.ok(result.reasons.some((reason) => reason.includes('PM signoff is not approved')));
  });

  it('AT-PLANNING-SPEC-004: gate_failed when SYSTEM_SPEC omits acceptance tests', () => {
    mkdirSync(join(root, '.planning'), { recursive: true });
    writeFileSync(join(root, '.planning', 'PM_SIGNOFF.md'), 'Approved: YES\n');
    writeFileSync(join(root, '.planning', 'ROADMAP.md'), 'Roadmap content.\n');
    writeFileSync(join(root, '.planning', 'SYSTEM_SPEC.md'), '# System Spec\n\n## Purpose\n\nSpec.\n\n## Interface\n\nSpec.\n');

    const result = evaluatePhaseExit({
      state: makeState({ phase: 'planning' }),
      config: makeConfig(),
      acceptedTurn: makeTurnResult({ phase_transition_request: 'implementation' }),
      root,
    });

    assert.equal(result.action, 'gate_failed');
    assert.ok(result.reasons.some((reason) => reason.includes('## Acceptance Tests')));
  });

  it('AT-QA-GATE-001: gate_failed when acceptance matrix is still the scaffold placeholder', () => {
    mkdirSync(join(root, '.planning'), { recursive: true });
    writeFileSync(
      join(root, '.planning', 'acceptance-matrix.md'),
      '# Acceptance Matrix\n\n| Req # | Requirement | Acceptance criteria | Test status | Last tested | Status |\n|-------|-------------|-------------------|-------------|-------------|--------|\n| (QA fills this from ROADMAP.md) | | | | | |\n'
    );
    writeFileSync(join(root, '.planning', 'ship-verdict.md'), '## Verdict: YES\n');
    writeFileSync(join(root, '.planning', 'RELEASE_NOTES.md'), '# Release Notes\n\n## User Impact\n\nFeature delivered.\n\n## Verification Summary\n\nAll tests pass.\n');

    const result = evaluatePhaseExit({
      state: makeState({ phase: 'qa' }),
      config: makeConfig(),
      acceptedTurn: makeTurnResult({ role: 'qa', phase_transition_request: 'qa' }),
      root,
    });

    assert.equal(result.action, 'gate_failed');
    assert.ok(result.reasons.some((reason) => reason.includes('no real requirement verdict rows')));
  });

  it('AT-QA-GATE-002: gate_failed when any acceptance row is not passing', () => {
    mkdirSync(join(root, '.planning'), { recursive: true });
    writeFileSync(
      join(root, '.planning', 'acceptance-matrix.md'),
      '# Acceptance Matrix\n\n| Req # | Requirement | Acceptance criteria | Test status | Last tested | Status |\n|-------|-------------|-------------------|-------------|-------------|--------|\n| 1 | Example requirement | Example acceptance criterion | pass | 2026-04-06 | Pending |\n'
    );
    writeFileSync(join(root, '.planning', 'ship-verdict.md'), '## Verdict: YES\n');
    writeFileSync(join(root, '.planning', 'RELEASE_NOTES.md'), '# Release Notes\n\n## User Impact\n\nFeature delivered.\n\n## Verification Summary\n\nAll tests pass.\n');

    const result = evaluatePhaseExit({
      state: makeState({ phase: 'qa' }),
      config: makeConfig(),
      acceptedTurn: makeTurnResult({ role: 'qa', phase_transition_request: 'qa' }),
      root,
    });

    assert.equal(result.action, 'gate_failed');
    assert.ok(result.reasons.some((reason) => reason.includes('1=Pending')));
  });

  it('AT-QA-GATE-003: awaiting_human_approval when every acceptance row is passing', () => {
    mkdirSync(join(root, '.planning'), { recursive: true });
    writeFileSync(join(root, '.planning', 'acceptance-matrix.md'), makePassingAcceptanceMatrix());
    writeFileSync(join(root, '.planning', 'ship-verdict.md'), '## Verdict: YES\n');
    writeFileSync(join(root, '.planning', 'RELEASE_NOTES.md'), '# Release Notes\n\n## User Impact\n\nFeature delivered.\n\n## Verification Summary\n\nAll tests pass.\n');

    const result = evaluatePhaseExit({
      state: makeState({ phase: 'qa' }),
      config: makeConfig(),
      acceptedTurn: makeTurnResult({ role: 'qa', phase_transition_request: 'qa' }),
      root,
    });

    assert.equal(result.action, 'awaiting_human_approval');
    assert.equal(result.passed, true);
    assert.equal(result.gate_id, 'qa_ship_verdict');
  });

  it('auto-advances when current phase has no exit gate defined', () => {
    const config = makeConfig({
      routing: {
        planning: { entry_role: 'pm', allowed_next_roles: ['pm', 'dev'] },
        implementation: { entry_role: 'dev', allowed_next_roles: ['dev', 'qa'] },
      },
    });

    const result = evaluatePhaseExit({
      state: makeState({ phase: 'planning' }),
      config,
      acceptedTurn: makeTurnResult({ phase_transition_request: 'implementation' }),
      root,
    });
    assert.equal(result.action, 'advance');
    assert.equal(result.next_phase, 'implementation');
  });

  it('auto-advances when gate is referenced but not defined in config', () => {
    const config = makeConfig({
      gates: {}, // Empty gates — planning_signoff is referenced but not defined
    });

    const result = evaluatePhaseExit({
      state: makeState({ phase: 'planning' }),
      config,
      acceptedTurn: makeTurnResult({ phase_transition_request: 'implementation' }),
      root,
    });
    assert.equal(result.action, 'advance');
    assert.equal(result.gate_id, 'planning_signoff');
    assert.ok(result.reasons[0].includes('not defined'));
  });

  it('returns gate_id even on failure', () => {
    const result = evaluatePhaseExit({
      state: makeState({ phase: 'planning' }),
      config: makeConfig(),
      acceptedTurn: makeTurnResult({ phase_transition_request: 'implementation' }),
      root,
    });
    assert.equal(result.gate_id, 'planning_signoff');
  });

  it('handles empty routing gracefully', () => {
    const config = makeConfig({ routing: {} });
    const result = evaluatePhaseExit({
      state: makeState({ phase: 'planning' }),
      config,
      acceptedTurn: makeTurnResult({ phase_transition_request: 'implementation' }),
      root,
    });
    assert.equal(result.action, 'unknown_phase');
  });
});

// ── getPhaseOrder tests ──────────────────────────────────────────────────────

describe('getPhaseOrder', () => {
  it('returns phase names in declaration order', () => {
    const routing = {
      planning: {},
      implementation: {},
      qa: {},
    };
    assert.deepEqual(getPhaseOrder(routing), ['planning', 'implementation', 'qa']);
  });

  it('returns empty array for null/undefined routing', () => {
    assert.deepEqual(getPhaseOrder(null), []);
    assert.deepEqual(getPhaseOrder(undefined), []);
  });
});

// ── Integration: acceptGovernedTurn + gate evaluation ────────────────────────

describe('acceptGovernedTurn — gate integration', () => {
  let root;

  beforeEach(() => {
    root = makeTmpDir();
    // Scaffold minimal governed project
    mkdirSync(join(root, '.agentxchain', 'staging'), { recursive: true });
    mkdirSync(join(root, '.agentxchain', 'dispatch', 'current'), { recursive: true });
    mkdirSync(join(root, '.planning'), { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function setupRun(config, phase = 'planning', roleId = 'pm') {
    const state = {
      schema_version: '1.0',
      run_id: 'run_test',
      project_id: config.project.id,
      status: 'active',
      phase,
      current_turn: null,
      blocked_on: null,
      budget_status: { spent_usd: 0, remaining_usd: 50 },
    };
    writeFileSync(join(root, STATE_PATH), JSON.stringify(state));

    // Assign a turn
    const assignResult = assignGovernedTurn(root, config, roleId);
    assert.ok(assignResult.ok, `Assign failed: ${assignResult.error}`);
    return assignResult.state;
  }

  function stageTurnResult(state, overrides = {}) {
    const turnResult = {
      schema_version: '1.0',
      run_id: state.run_id,
      turn_id: state.current_turn.turn_id,
      role: state.current_turn.assigned_role,
      runtime_id: state.current_turn.runtime_id,
      status: 'completed',
      summary: 'Did the work.',
      decisions: [],
      objections: [{ id: 'OBJ-001', severity: 'low', statement: 'No issues.' }],
      files_changed: [],
      artifacts_created: [],
      verification: { status: 'pass' },
      artifact: { type: 'review', ref: null },
      proposed_next_role: 'dev',
      phase_transition_request: null,
      cost: { input_tokens: 100, output_tokens: 50, usd: 0.01 },
      ...overrides,
    };
    writeFileSync(
      join(root, '.agentxchain', 'staging', 'turn-result.json'),
      JSON.stringify(turnResult)
    );
    return turnResult;
  }

  it('returns gateResult: null when turn has no phase_transition_request', () => {
    const config = makeConfig();
    const state = setupRun(config, 'planning', 'pm');
    stageTurnResult(state);

    const result = acceptGovernedTurn(root, config);
    assert.ok(result.ok);
    assert.ok(result.gateResult);
    assert.equal(result.gateResult.action, 'no_request');
    // Phase should NOT change
    assert.equal(result.state.phase, 'planning');
  });

  it('stays in current phase when gate fails (missing files)', () => {
    const config = makeConfig();
    const state = setupRun(config, 'planning', 'pm');
    stageTurnResult(state, { phase_transition_request: 'implementation' });

    const result = acceptGovernedTurn(root, config);
    assert.ok(result.ok);
    assert.equal(result.gateResult.action, 'gate_failed');
    assert.equal(result.state.phase, 'planning');
    assert.equal(result.state.status, 'active');
    // Turn is accepted even though gate failed
    assert.equal(result.state.current_turn, null);
  });

  it('pauses with pending_phase_transition when gate requires human approval', () => {
    const config = makeConfig();
    // Create required files
    writeFileSync(join(root, '.planning', 'PM_SIGNOFF.md'), 'Approved: YES\n');
    writeFileSync(join(root, '.planning', 'ROADMAP.md'), 'Roadmap.');
    writeFileSync(join(root, '.planning', 'SYSTEM_SPEC.md'), '# System Spec\n\n## Purpose\n\nSpec.\n\n## Interface\n\nSpec.\n\n## Acceptance Tests\n\n- [ ] Spec.\n');

    const state = setupRun(config, 'planning', 'pm');
    stageTurnResult(state, { phase_transition_request: 'implementation' });

    const result = acceptGovernedTurn(root, config);
    assert.ok(result.ok);
    assert.equal(result.gateResult.action, 'awaiting_human_approval');
    assert.equal(result.state.status, 'paused');
    assert.equal(result.state.blocked_on, 'human_approval:planning_signoff');
    assert.equal(result.state.phase, 'planning'); // NOT advanced yet
    assert.ok(result.state.pending_phase_transition);
    assert.equal(result.state.pending_phase_transition.from, 'planning');
    assert.equal(result.state.pending_phase_transition.to, 'implementation');
    assert.equal(result.state.pending_phase_transition.gate, 'planning_signoff');
  });

  it('auto-advances phase when gate passes without human approval', () => {
    const config = makeConfig();
    const state = setupRun(config, 'implementation', 'dev');

    // Create required implementation notes file for implementation_complete gate
    mkdirSync(join(root, '.planning'), { recursive: true });
    writeFileSync(join(root, '.planning', 'IMPLEMENTATION_NOTES.md'), '# Notes\n\n## Changes\n\nBuilt the feature.\n\n## Verification\n\nRun npm test.\n');

    stageTurnResult(state, {
      role: 'dev',
      runtime_id: 'local-dev',
      phase_transition_request: 'qa',
      verification: { status: 'pass' },
      artifact: { type: 'workspace', ref: 'git:abc123' },
      proposed_next_role: 'qa',
    });

    const result = acceptGovernedTurn(root, config);
    assert.ok(result.ok);
    assert.equal(result.gateResult.action, 'advance');
    assert.equal(result.state.phase, 'qa'); // Advanced!
    assert.equal(result.state.status, 'active');
    assert.ok(result.state.phase_gate_status);
    assert.equal(result.state.phase_gate_status['implementation_complete'], 'passed');
  });

  it('does not evaluate gate when turn status is needs_human', () => {
    const config = makeConfig();
    const state = setupRun(config, 'planning', 'pm');
    stageTurnResult(state, {
      status: 'needs_human',
      needs_human_reason: 'Need clarification',
      phase_transition_request: 'implementation',
    });

    const result = acceptGovernedTurn(root, config);
    assert.ok(result.ok);
    assert.equal(result.gateResult, null); // Not evaluated
    assert.equal(result.state.status, 'blocked');
    assert.equal(result.state.phase, 'planning'); // Not advanced
    assert.equal(result.state.blocked_reason.category, 'needs_human');
  });

  it('accepts turn but stays in phase on unknown target phase', () => {
    const config = makeConfig();
    const state = setupRun(config, 'planning', 'pm');
    // Note: protocol validator would catch this, but test the gate evaluator path
    // We need to bypass protocol validation by using a valid-looking request
    // that passes validation but fails gate evaluation
    stageTurnResult(state, {
      phase_transition_request: 'implementation',
      // Files don't exist, so gate will fail
    });

    const result = acceptGovernedTurn(root, config);
    assert.ok(result.ok);
    // Gate failed because files are missing
    assert.equal(result.gateResult.action, 'gate_failed');
    assert.equal(result.state.phase, 'planning');
  });
});

// ── approvePhaseTransition tests ─────────────────────────────────────────────

describe('approvePhaseTransition', () => {
  let root;

  beforeEach(() => {
    root = makeTmpDir();
    mkdirSync(join(root, '.agentxchain'), { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('advances phase from pending transition', () => {
    const state = {
      run_id: 'run_test',
      project_id: 'test-project',
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
    writeFileSync(join(root, STATE_PATH), JSON.stringify(state));

    const result = approvePhaseTransition(root);
    assert.ok(result.ok);
    assert.equal(result.state.phase, 'implementation');
    assert.equal(result.state.status, 'active');
    assert.equal(result.state.blocked_on, null);
    assert.equal(result.state.pending_phase_transition, null);
    assert.equal(result.state.phase_gate_status['planning_signoff'], 'passed');
    assert.deepEqual(result.transition, state.pending_phase_transition);
  });

  it('fails when no pending transition exists', () => {
    const state = {
      run_id: 'run_test',
      status: 'paused',
      phase: 'planning',
      blocked_on: 'something',
    };
    writeFileSync(join(root, STATE_PATH), JSON.stringify(state));

    const result = approvePhaseTransition(root);
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('No pending phase transition'));
  });

  it('fails when state is not paused', () => {
    const state = {
      run_id: 'run_test',
      status: 'active',
      phase: 'planning',
      pending_phase_transition: {
        from: 'planning',
        to: 'implementation',
        gate: 'planning_signoff',
        requested_by_turn: 'turn_abc',
      },
    };
    writeFileSync(join(root, STATE_PATH), JSON.stringify(state));

    const result = approvePhaseTransition(root);
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('expected "paused" or "blocked"'));
  });

  it('advances phase from blocked state when pending transition is retained', () => {
    const state = {
      run_id: 'run_test',
      project_id: 'test',
      status: 'blocked',
      phase: 'planning',
      blocked_on: 'hook:before_gate:compliance-gate',
      blocked_reason: {
        category: 'hook_block',
        blocked_at: '2026-04-02T13:00:00Z',
        turn_id: 'turn_abc',
        recovery: {
          typed_reason: 'pending_phase_transition',
          owner: 'human',
          recovery_action: 'agentxchain approve-transition',
          turn_retained: false,
          detail: 'planning_signoff',
        },
      },
      pending_phase_transition: {
        from: 'planning',
        to: 'implementation',
        gate: 'planning_signoff',
        requested_by_turn: 'turn_abc',
      },
    };
    writeFileSync(join(root, STATE_PATH), JSON.stringify(state));

    const result = approvePhaseTransition(root);
    assert.ok(result.ok);
    assert.equal(result.state.phase, 'implementation');
    assert.equal(result.state.status, 'active');
    assert.equal(result.state.blocked_on, null);
    assert.equal(result.state.blocked_reason, null);
    assert.equal(result.state.pending_phase_transition, null);
  });

  it('fails when no state file exists', () => {
    const result = approvePhaseTransition(root);
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('No governed state.json'));
  });

  it('persists phase_gate_status to disk', () => {
    const state = {
      run_id: 'run_test',
      project_id: 'test',
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
      phase_gate_status: {},
    };
    writeFileSync(join(root, STATE_PATH), JSON.stringify(state));

    approvePhaseTransition(root);

    const saved = readJson(root, STATE_PATH);
    assert.equal(saved.phase, 'implementation');
    assert.equal(saved.status, 'active');
    assert.equal(saved.phase_gate_status['planning_signoff'], 'passed');
    assert.equal(saved.pending_phase_transition, null);
  });
});

// ── Full lifecycle: planning → approve → implementation → qa ──────────────────

describe('full phase lifecycle', () => {
  let root;

  beforeEach(() => {
    root = makeTmpDir();
    mkdirSync(join(root, '.agentxchain', 'staging'), { recursive: true });
    mkdirSync(join(root, '.agentxchain', 'dispatch', 'current'), { recursive: true });
    mkdirSync(join(root, '.planning'), { recursive: true });
    // Initialize git repo so repo-observer can detect file changes
    gitInit(root);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('planning → (human approval) → implementation → qa: full three-phase run', () => {
    const config = makeConfig();

    // ── Phase 1: Planning ──
    const initState = {
      schema_version: '1.0',
      run_id: 'run_lifecycle',
      project_id: 'test-project',
      status: 'active',
      phase: 'planning',
      current_turn: null,
      blocked_on: null,
      budget_status: { spent_usd: 0, remaining_usd: 50 },
    };
    writeFileSync(join(root, STATE_PATH), JSON.stringify(initState));

    // Assign PM turn
    let assign = assignGovernedTurn(root, config, 'pm');
    assert.ok(assign.ok);

    // Create required planning artifacts
    writeFileSync(join(root, '.planning', 'PM_SIGNOFF.md'), 'Approved: YES\n');
    writeFileSync(join(root, '.planning', 'ROADMAP.md'), 'Roadmap v1.');
    writeFileSync(join(root, '.planning', 'SYSTEM_SPEC.md'), '# System Spec\n\n## Purpose\n\nSpec.\n\n## Interface\n\nSpec.\n\n## Acceptance Tests\n\n- [ ] Spec.\n');

    // Stage PM turn result requesting transition to implementation
    writeFileSync(
      join(root, '.agentxchain', 'staging', 'turn-result.json'),
      JSON.stringify({
        schema_version: '1.0',
        run_id: assign.state.run_id,
        turn_id: assign.state.current_turn.turn_id,
        role: 'pm',
        runtime_id: 'manual-pm',
        status: 'completed',
        summary: 'Planning phase complete. Roadmap and signoff delivered.',
        decisions: [{ id: 'DEC-001', category: 'scope', statement: 'Scope frozen.', rationale: 'Agreed on v1 scope.' }],
        objections: [{ id: 'OBJ-001', severity: 'low', statement: 'No objections.' }],
        files_changed: ['.planning/PM_SIGNOFF.md', '.planning/ROADMAP.md', '.planning/SYSTEM_SPEC.md'],
        artifacts_created: ['.planning/PM_SIGNOFF.md', '.planning/ROADMAP.md', '.planning/SYSTEM_SPEC.md'],
        verification: { status: 'pass', evidence_summary: 'Files created.' },
        artifact: { type: 'review', ref: null },
        proposed_next_role: 'dev',
        phase_transition_request: 'implementation',
        cost: { input_tokens: 200, output_tokens: 100, usd: 0.02 },
      })
    );

    // Accept → should pause for human approval
    let accept = acceptGovernedTurn(root, config);
    assert.ok(accept.ok, `Accept failed: ${accept.error}`);
    assert.equal(accept.gateResult.action, 'awaiting_human_approval');
    assert.equal(accept.state.status, 'paused');
    assert.equal(accept.state.phase, 'planning'); // Not yet advanced
    assert.ok(accept.state.pending_phase_transition);

    // Human approves transition
    let approve = approvePhaseTransition(root);
    assert.ok(approve.ok);
    assert.equal(approve.state.phase, 'implementation');
    assert.equal(approve.state.status, 'active');

    // Commit planning artifacts so dev turn gets a clean baseline
    gitCommitAll(root);

    // ── Phase 2: Implementation ──
    assign = assignGovernedTurn(root, config, 'dev');
    assert.ok(assign.ok, `Dev assign failed: ${assign.error}`);

    // Create required implementation notes file
    writeFileSync(join(root, '.planning', 'IMPLEMENTATION_NOTES.md'), '# Notes\n\n## Changes\n\nBuilt app.ts.\n\n## Verification\n\nRun npm test.\n');

    // Stage dev turn result requesting transition to qa
    writeFileSync(
      join(root, '.agentxchain', 'staging', 'turn-result.json'),
      JSON.stringify({
        schema_version: '1.0',
        run_id: assign.state.run_id,
        turn_id: assign.state.current_turn.turn_id,
        role: 'dev',
        runtime_id: 'local-dev',
        status: 'completed',
        summary: 'Implementation complete. All tests pass.',
        decisions: [{ id: 'DEC-002', category: 'implementation', statement: 'Used approach B.', rationale: 'Faster.' }],
        objections: [],
        files_changed: ['src/app.ts', '.planning/IMPLEMENTATION_NOTES.md'],
        artifacts_created: [],
        verification: { status: 'pass', commands: ['npm test'], machine_evidence: [{ command: 'npm test', exit_code: 0 }] },
        artifact: { type: 'workspace', ref: 'git:def456' },
        proposed_next_role: 'qa',
        phase_transition_request: 'qa',
        cost: { input_tokens: 500, output_tokens: 300, usd: 0.10 },
      })
    );

    // Accept → should auto-advance (no human approval needed for implementation_complete)
    accept = acceptGovernedTurn(root, config);
    assert.ok(accept.ok, `Accept failed: ${accept.error}`);
    assert.equal(accept.gateResult.action, 'advance');
    assert.equal(accept.state.phase, 'qa'); // Auto-advanced!
    assert.equal(accept.state.status, 'active');
    assert.equal(accept.state.phase_gate_status['implementation_complete'], 'passed');

    // Budget tracked across phases
    assert.ok(accept.state.budget_status.spent_usd > 0);
  });
});
