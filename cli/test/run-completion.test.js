import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';

import { evaluateRunCompletion, isFinalPhase, getPhaseOrder } from '../src/lib/gate-evaluator.js';
import {
  initializeGovernedRun,
  assignGovernedTurn,
  acceptGovernedTurn,
  approvePhaseTransition,
  approveRunCompletion,
  STATE_PATH,
  STAGING_PATH,
} from '../src/lib/governed-state.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeTmpDir() {
  const dir = join(tmpdir(), `axc-completion-test-${randomBytes(6).toString('hex')}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function readJson(root, relPath) {
  return JSON.parse(readFileSync(join(root, relPath), 'utf8'));
}

function writeJson(root, relPath, data) {
  const filePath = join(root, relPath);
  mkdirSync(join(filePath, '..'), { recursive: true });
  writeFileSync(filePath, JSON.stringify(data, null, 2));
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
        requires_files: ['.planning/PM_SIGNOFF.md', '.planning/ROADMAP.md'],
        requires_human_approval: true,
      },
      implementation_complete: {
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

function makeState(root, overrides = {}) {
  const state = {
    schema_version: '1.0',
    run_id: 'run_test123',
    project_id: 'test-project',
    status: 'active',
    phase: 'qa',
    accepted_integration_ref: null,
    current_turn: null,
    last_completed_turn_id: null,
    blocked_on: null,
    escalation: null,
    phase_gate_status: {},
    budget_status: { spent_usd: 0, remaining_usd: 50.0 },
    ...overrides,
  };
  writeJson(root, STATE_PATH, state);
  return state;
}

function makeTurnResult(overrides = {}) {
  return {
    schema_version: '1.0',
    run_id: 'run_test123',
    turn_id: 'turn_test456',
    role: 'qa',
    runtime_id: 'api-qa',
    status: 'completed',
    summary: 'QA pass — all acceptance criteria met.',
    decisions: [],
    objections: [{ id: 'OBJ-001', severity: 'low', statement: 'No substantive objections.' }],
    files_changed: [],
    artifacts_created: [],
    verification: { status: 'pass', evidence_summary: 'Manual review complete.' },
    artifact: { type: 'review', ref: null },
    proposed_next_role: 'human',
    phase_transition_request: null,
    run_completion_request: null,
    cost: { input_tokens: 100, output_tokens: 50, usd: 0.10 },
    ...overrides,
  };
}

function makePassingAcceptanceMatrix() {
  return '# Acceptance Matrix\n\n| Req # | Requirement | Acceptance criteria | Test status | Last tested | Status |\n|-------|-------------|-------------------|-------------|-------------|--------|\n| 1 | Example requirement | Example acceptance criterion | pass | 2026-04-06 | pass |\n';
}

function stageTurnResult(root, turnResult) {
  writeJson(root, STAGING_PATH, turnResult);
}

// ── Pure evaluateRunCompletion tests ────────────────────────────────────────

describe('evaluateRunCompletion — pure function', () => {
  let root;

  beforeEach(() => {
    root = makeTmpDir();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('returns no_request when run_completion_request is falsy', () => {
    const result = evaluateRunCompletion({
      state: { phase: 'qa' },
      config: makeConfig(),
      acceptedTurn: makeTurnResult({ run_completion_request: null }),
      root,
    });
    assert.equal(result.action, 'no_request');
  });

  it('returns no_request when run_completion_request is false', () => {
    const result = evaluateRunCompletion({
      state: { phase: 'qa' },
      config: makeConfig(),
      acceptedTurn: makeTurnResult({ run_completion_request: false }),
      root,
    });
    assert.equal(result.action, 'no_request');
  });

  it('returns not_final_phase when current phase is not the last', () => {
    const result = evaluateRunCompletion({
      state: { phase: 'implementation' },
      config: makeConfig(),
      acceptedTurn: makeTurnResult({ run_completion_request: true }),
      root,
    });
    assert.equal(result.action, 'not_final_phase');
    assert.ok(result.reasons[0].includes('implementation'));
    assert.ok(result.reasons[0].includes('qa'));
  });

  it('returns gate_failed when required files are missing', () => {
    const result = evaluateRunCompletion({
      state: { phase: 'qa' },
      config: makeConfig(),
      acceptedTurn: makeTurnResult({ run_completion_request: true }),
      root,
    });
    assert.equal(result.action, 'gate_failed');
    assert.equal(result.passed, false);
    assert.ok(result.missing_files.length > 0);
  });

  it('AT-PROP-COMPLETION-001: returns gate_failed when required files exist only in proposal directory', () => {
    // Files exist under .agentxchain/proposed/<turn_id>/ but NOT in the workspace.
    // Run-completion gates must check the workspace, not the proposal directory.
    const turnId = 'turn_proposed_001';
    const proposalDir = join(root, '.agentxchain', 'proposed', turnId);
    mkdirSync(join(proposalDir, '.planning'), { recursive: true });
    writeFileSync(join(proposalDir, '.planning/acceptance-matrix.md'), makePassingAcceptanceMatrix());
    writeFileSync(join(proposalDir, '.planning/ship-verdict.md'), '## Verdict: YES\n');
    writeFileSync(join(proposalDir, '.planning/RELEASE_NOTES.md'), '# Release Notes\n\n## User Impact\n\nFeature delivered.\n\n## Verification Summary\n\nAll tests pass.\n');

    const result = evaluateRunCompletion({
      state: { phase: 'qa' },
      config: makeConfig(),
      acceptedTurn: makeTurnResult({ run_completion_request: true }),
      root,
    });
    assert.equal(result.action, 'gate_failed', 'Proposal-only files must NOT satisfy run-completion gates');
    assert.equal(result.passed, false);
    assert.ok(result.missing_files.length > 0, 'Gate must report files as missing even though they exist in proposal dir');
    assert.ok(result.missing_files.includes('.planning/acceptance-matrix.md'));
    assert.ok(result.missing_files.includes('.planning/ship-verdict.md'));
    assert.ok(result.missing_files.includes('.planning/RELEASE_NOTES.md'));
  });

  it('AT-PROP-COMPLETION-002: returns awaiting_human_approval after proposal apply copies files to workspace', () => {
    // Simulate proposal apply: files now exist in the workspace
    mkdirSync(join(root, '.planning'), { recursive: true });
    writeFileSync(join(root, '.planning/acceptance-matrix.md'), makePassingAcceptanceMatrix());
    writeFileSync(join(root, '.planning/ship-verdict.md'), '## Verdict: YES\n');
    writeFileSync(join(root, '.planning/RELEASE_NOTES.md'), '# Release Notes\n\n## User Impact\n\nFeature delivered.\n\n## Verification Summary\n\nAll tests pass.\n');

    // Also keep the proposal directory to prove it doesn't interfere
    const proposalDir = join(root, '.agentxchain', 'proposed', 'turn_proposed_001');
    mkdirSync(join(proposalDir, '.planning'), { recursive: true });
    writeFileSync(join(proposalDir, '.planning/acceptance-matrix.md'), makePassingAcceptanceMatrix());

    const result = evaluateRunCompletion({
      state: { phase: 'qa' },
      config: makeConfig(),
      acceptedTurn: makeTurnResult({ run_completion_request: true }),
      root,
    });
    assert.equal(result.action, 'awaiting_human_approval', 'Gate must pass once files are in workspace');
    assert.equal(result.passed, true);
    assert.equal(result.missing_files.length, 0);
  });

  it('returns gate_failed when verification required but not passed', () => {
    const config = makeConfig({
      gates: {
        ...makeConfig().gates,
        qa_ship_verdict: {
          requires_verification_pass: true,
        },
      },
    });
    const result = evaluateRunCompletion({
      state: { phase: 'qa' },
      config,
      acceptedTurn: makeTurnResult({ run_completion_request: true, verification: { status: 'fail' } }),
      root,
    });
    assert.equal(result.action, 'gate_failed');
    assert.equal(result.missing_verification, true);
  });

  it('returns awaiting_human_approval when gate passes + requires_human_approval', () => {
    // Create required files
    mkdirSync(join(root, '.planning'), { recursive: true });
    writeFileSync(join(root, '.planning/acceptance-matrix.md'), makePassingAcceptanceMatrix());
    writeFileSync(join(root, '.planning/ship-verdict.md'), '## Verdict: YES\n');
    writeFileSync(join(root, '.planning/RELEASE_NOTES.md'), '# Release Notes\n\n## User Impact\n\nFeature delivered.\n\n## Verification Summary\n\nAll tests pass.\n');

    const result = evaluateRunCompletion({
      state: { phase: 'qa' },
      config: makeConfig(),
      acceptedTurn: makeTurnResult({ run_completion_request: true }),
      root,
    });
    assert.equal(result.action, 'awaiting_human_approval');
    assert.equal(result.passed, true);
    assert.equal(result.blocked_by_human_approval, true);
    assert.equal(result.gate_id, 'qa_ship_verdict');
  });

  it('AT-WFG-003: returns gate_failed when ship verdict is not affirmative', () => {
    mkdirSync(join(root, '.planning'), { recursive: true });
    writeFileSync(join(root, '.planning/acceptance-matrix.md'), makePassingAcceptanceMatrix());
    writeFileSync(join(root, '.planning/ship-verdict.md'), '## Verdict: PENDING\n');
    writeFileSync(join(root, '.planning/RELEASE_NOTES.md'), '# Release Notes\n\n## User Impact\n\nFeature delivered.\n\n## Verification Summary\n\nAll tests pass.\n');

    const result = evaluateRunCompletion({
      state: { phase: 'qa' },
      config: makeConfig(),
      acceptedTurn: makeTurnResult({ run_completion_request: true }),
      root,
    });

    assert.equal(result.action, 'gate_failed');
    assert.equal(result.passed, false);
    assert.ok(result.reasons.some((reason) => reason.includes('Ship verdict is not affirmative')));
  });

  it('AT-QA-GATE-004: returns gate_failed when acceptance matrix contains a pending row', () => {
    mkdirSync(join(root, '.planning'), { recursive: true });
    writeFileSync(
      join(root, '.planning/acceptance-matrix.md'),
      '# Acceptance Matrix\n\n| Req # | Requirement | Acceptance criteria | Test status | Last tested | Status |\n|-------|-------------|-------------------|-------------|-------------|--------|\n| 1 | Example requirement | Example acceptance criterion | pass | 2026-04-06 | Pending |\n'
    );
    writeFileSync(join(root, '.planning/ship-verdict.md'), '## Verdict: YES\n');
    writeFileSync(join(root, '.planning/RELEASE_NOTES.md'), '# Release Notes\n\n## User Impact\n\nFeature delivered.\n\n## Verification Summary\n\nAll tests pass.\n');

    const result = evaluateRunCompletion({
      state: { phase: 'qa' },
      config: makeConfig(),
      acceptedTurn: makeTurnResult({ run_completion_request: true }),
      root,
    });

    assert.equal(result.action, 'gate_failed');
    assert.ok(result.reasons.some((reason) => reason.includes('1=Pending')));
  });

  it('returns complete when gate passes without human approval', () => {
    const config = makeConfig({
      gates: {
        ...makeConfig().gates,
        qa_ship_verdict: {
          requires_verification_pass: true,
          // no requires_human_approval
        },
      },
    });
    const result = evaluateRunCompletion({
      state: { phase: 'qa' },
      config,
      acceptedTurn: makeTurnResult({ run_completion_request: true, verification: { status: 'pass' } }),
      root,
    });
    assert.equal(result.action, 'complete');
    assert.equal(result.passed, true);
  });

  it('returns complete with attested_pass verification', () => {
    const config = makeConfig({
      gates: {
        ...makeConfig().gates,
        qa_ship_verdict: {
          requires_verification_pass: true,
        },
      },
    });
    const result = evaluateRunCompletion({
      state: { phase: 'qa' },
      config,
      acceptedTurn: makeTurnResult({ run_completion_request: true, verification: { status: 'attested_pass' } }),
      root,
    });
    assert.equal(result.action, 'complete');
  });

  it('returns complete when no exit gate defined for final phase', () => {
    const config = makeConfig();
    delete config.routing.qa.exit_gate;
    const result = evaluateRunCompletion({
      state: { phase: 'qa' },
      config,
      acceptedTurn: makeTurnResult({ run_completion_request: true }),
      root,
    });
    assert.equal(result.action, 'complete');
    assert.equal(result.passed, true);
  });

  it('returns complete when gate referenced but not defined', () => {
    const config = makeConfig();
    delete config.gates.qa_ship_verdict;
    const result = evaluateRunCompletion({
      state: { phase: 'qa' },
      config,
      acceptedTurn: makeTurnResult({ run_completion_request: true }),
      root,
    });
    assert.equal(result.action, 'complete');
    assert.equal(result.passed, true);
  });
});

// ── isFinalPhase helper tests ───────────────────────────────────────────────

describe('isFinalPhase', () => {
  it('returns true for the last phase in routing', () => {
    const routing = { planning: {}, implementation: {}, qa: {} };
    assert.equal(isFinalPhase('qa', routing), true);
  });

  it('returns false for non-final phases', () => {
    const routing = { planning: {}, implementation: {}, qa: {} };
    assert.equal(isFinalPhase('planning', routing), false);
    assert.equal(isFinalPhase('implementation', routing), false);
  });

  it('returns false for empty routing', () => {
    assert.equal(isFinalPhase('qa', {}), false);
    assert.equal(isFinalPhase('qa', null), false);
  });
});

// ── Integration: acceptGovernedTurn with run_completion_request ──────────────

describe('acceptGovernedTurn — run completion', () => {
  let root;
  const config = makeConfig();

  beforeEach(() => {
    root = makeTmpDir();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('auto-completes run when final gate passes without human approval', () => {
    // Config with no human approval on qa gate
    const cfg = makeConfig({
      gates: {
        ...makeConfig().gates,
        qa_ship_verdict: {
          requires_verification_pass: true,
          // no requires_human_approval
        },
      },
    });

    // Set up state in qa phase with an assigned turn
    const state = makeState(root, {
      phase: 'qa',
      current_turn: {
        turn_id: 'turn_test456',
        assigned_role: 'qa',
        status: 'running',
        attempt: 1,
        started_at: new Date().toISOString(),
        deadline_at: new Date(Date.now() + 20 * 60000).toISOString(),
        runtime_id: 'api-qa',
      },
    });

    // Stage a turn result with run_completion_request
    stageTurnResult(root, makeTurnResult({
      run_completion_request: true,
      verification: { status: 'pass', evidence_summary: 'All tests pass.' },
    }));

    const result = acceptGovernedTurn(root, cfg);
    assert.equal(result.ok, true);
    assert.equal(result.state.status, 'completed');
    assert.ok(result.state.completed_at);
    assert.equal(result.completionResult.action, 'complete');
    assert.equal(result.state.current_turn, null);
  });

  it('pauses for human approval when final gate requires it', () => {
    const state = makeState(root, {
      phase: 'qa',
      current_turn: {
        turn_id: 'turn_test456',
        assigned_role: 'qa',
        status: 'running',
        attempt: 1,
        started_at: new Date().toISOString(),
        deadline_at: new Date(Date.now() + 20 * 60000).toISOString(),
        runtime_id: 'api-qa',
      },
    });

    // Create required files for qa_ship_verdict gate
    mkdirSync(join(root, '.planning'), { recursive: true });
    writeFileSync(join(root, '.planning/acceptance-matrix.md'), makePassingAcceptanceMatrix());
    writeFileSync(join(root, '.planning/ship-verdict.md'), '## Verdict: YES\n');
    writeFileSync(join(root, '.planning/RELEASE_NOTES.md'), '# Release Notes\n\n## User Impact\n\nFeature delivered.\n\n## Verification Summary\n\nAll tests pass.\n');

    stageTurnResult(root, makeTurnResult({
      run_completion_request: true,
    }));

    const result = acceptGovernedTurn(root, config);
    assert.equal(result.ok, true);
    assert.equal(result.state.status, 'paused');
    assert.ok(result.state.pending_run_completion);
    assert.equal(result.state.pending_run_completion.gate, 'qa_ship_verdict');
    assert.ok(result.state.blocked_on.startsWith('human_approval:'));
    assert.equal(result.completionResult.action, 'awaiting_human_approval');
  });

  it('AT-PROP-COMPLETION-004: pauses for human approval on single-phase proposed api_proxy completion turns', () => {
    const proposedConfig = makeConfig({
      roles: {
        dev: {
          title: 'Developer',
          mandate: 'Implement',
          write_authority: 'proposed',
          runtime_class: 'api_proxy',
          runtime_id: 'api-dev',
        },
      },
      runtimes: {
        'api-dev': {
          type: 'api_proxy',
          provider: 'anthropic',
          model: 'claude-sonnet-4-6',
          auth_env: 'ANTHROPIC_API_KEY',
        },
      },
      routing: {
        implementation: {
          entry_role: 'dev',
          allowed_next_roles: ['dev', 'human'],
          exit_gate: 'implementation_complete',
        },
      },
      gates: {
        implementation_complete: {
          requires_files: ['.planning/IMPLEMENTATION_NOTES.md'],
          requires_human_approval: true,
        },
      },
    });

    makeState(root, {
      phase: 'implementation',
      current_turn: {
        turn_id: 'turn_test456',
        assigned_role: 'dev',
        status: 'running',
        attempt: 1,
        started_at: new Date().toISOString(),
        deadline_at: new Date(Date.now() + 20 * 60000).toISOString(),
        runtime_id: 'api-dev',
      },
    });

    mkdirSync(join(root, '.planning'), { recursive: true });
    writeFileSync(
      join(root, '.planning', 'IMPLEMENTATION_NOTES.md'),
      '# Implementation Notes\n\n## Changes\n\nImplemented the proposed-authority completion fixture.\n\n## Verification\n\nValidated the gate-ready workspace artifact.\n'
    );

    stageTurnResult(root, makeTurnResult({
      role: 'dev',
      runtime_id: 'api-dev',
      artifact: { type: 'review', ref: null },
      proposed_next_role: 'dev',
      files_changed: [],
      proposed_changes: [],
      run_completion_request: true,
    }));

    const result = acceptGovernedTurn(root, proposedConfig);
    assert.equal(result.ok, true);
    assert.equal(result.state.status, 'paused');
    assert.ok(result.state.pending_run_completion);
    assert.equal(result.state.pending_run_completion.gate, 'implementation_complete');
    assert.ok(result.state.blocked_on.startsWith('human_approval:'));
    assert.equal(result.completionResult.action, 'awaiting_human_approval');
  });

  it('accepts turn but does not complete when gate fails', () => {
    const state = makeState(root, {
      phase: 'qa',
      current_turn: {
        turn_id: 'turn_test456',
        assigned_role: 'qa',
        status: 'running',
        attempt: 1,
        started_at: new Date().toISOString(),
        deadline_at: new Date(Date.now() + 20 * 60000).toISOString(),
        runtime_id: 'api-qa',
      },
    });

    // Don't create required files — gate will fail
    stageTurnResult(root, makeTurnResult({
      run_completion_request: true,
    }));

    const result = acceptGovernedTurn(root, config);
    assert.equal(result.ok, true);
    assert.equal(result.state.status, 'active');
    assert.equal(result.state.pending_run_completion, undefined);
    assert.equal(result.completionResult.action, 'gate_failed');
  });

  it('accepts turn but does not complete when not in final phase', () => {
    const state = makeState(root, {
      phase: 'implementation',
      current_turn: {
        turn_id: 'turn_test456',
        assigned_role: 'dev',
        status: 'running',
        attempt: 1,
        started_at: new Date().toISOString(),
        deadline_at: new Date(Date.now() + 20 * 60000).toISOString(),
        runtime_id: 'local-dev',
      },
    });

    stageTurnResult(root, makeTurnResult({
      role: 'dev',
      runtime_id: 'local-dev',
      run_completion_request: true,
      files_changed: ['src/foo.js'],
      artifact: { type: 'workspace', ref: 'git:abc123' },
    }));

    const result = acceptGovernedTurn(root, config);
    assert.equal(result.ok, true);
    assert.equal(result.state.status, 'active');
    assert.equal(result.completionResult.action, 'not_final_phase');
  });

  it('skips completion evaluation when turn status is needs_human', () => {
    const state = makeState(root, {
      phase: 'qa',
      current_turn: {
        turn_id: 'turn_test456',
        assigned_role: 'qa',
        status: 'running',
        attempt: 1,
        started_at: new Date().toISOString(),
        deadline_at: new Date(Date.now() + 20 * 60000).toISOString(),
        runtime_id: 'api-qa',
      },
    });

    stageTurnResult(root, makeTurnResult({
      status: 'needs_human',
      needs_human_reason: 'Blocking issue found',
      run_completion_request: true,
    }));

    const result = acceptGovernedTurn(root, config);
    assert.equal(result.ok, true);
    assert.equal(result.state.status, 'blocked');
    assert.equal(result.completionResult, null);
    assert.equal(result.state.blocked_reason.category, 'needs_human');
  });

  it('run_completion_request takes precedence over phase_transition_request=null', () => {
    const cfg = makeConfig({
      gates: {
        ...makeConfig().gates,
        qa_ship_verdict: {
          requires_verification_pass: true,
        },
      },
    });

    const state = makeState(root, {
      phase: 'qa',
      current_turn: {
        turn_id: 'turn_test456',
        assigned_role: 'qa',
        status: 'running',
        attempt: 1,
        started_at: new Date().toISOString(),
        deadline_at: new Date(Date.now() + 20 * 60000).toISOString(),
        runtime_id: 'api-qa',
      },
    });

    stageTurnResult(root, makeTurnResult({
      run_completion_request: true,
      phase_transition_request: null,
      verification: { status: 'pass', evidence_summary: 'OK' },
    }));

    const result = acceptGovernedTurn(root, cfg);
    assert.equal(result.ok, true);
    assert.equal(result.state.status, 'completed');
    assert.equal(result.gateResult, null);  // phase gate was not evaluated
  });
});

// ── approveRunCompletion tests ──────────────────────────────────────────────

describe('approveRunCompletion', () => {
  let root;

  beforeEach(() => {
    root = makeTmpDir();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('completes the run from pending_run_completion state', () => {
    writeJson(root, STATE_PATH, {
      schema_version: '1.0',
      run_id: 'run_test123',
      status: 'paused',
      phase: 'qa',
      blocked_on: 'human_approval:qa_ship_verdict',
      pending_run_completion: {
        gate: 'qa_ship_verdict',
        requested_by_turn: 'turn_test456',
        requested_at: '2026-03-31T14:00:00Z',
      },
      phase_gate_status: { planning_signoff: 'passed', implementation_complete: 'passed' },
      budget_status: { spent_usd: 10.0, remaining_usd: 40.0 },
    });

    const result = approveRunCompletion(root);
    assert.equal(result.ok, true);
    assert.equal(result.state.status, 'completed');
    assert.ok(result.state.completed_at);
    assert.equal(result.state.blocked_on, null);
    assert.equal(result.state.pending_run_completion, null);
    assert.equal(result.state.phase_gate_status.qa_ship_verdict, 'passed');
    assert.equal(result.completion.gate, 'qa_ship_verdict');

    // Verify persisted to disk
    const persisted = readJson(root, STATE_PATH);
    assert.equal(persisted.status, 'completed');
    assert.ok(persisted.completed_at);
  });

  it('fails when no pending_run_completion', () => {
    writeJson(root, STATE_PATH, {
      schema_version: '1.0',
      run_id: 'run_test123',
      status: 'paused',
      phase: 'qa',
      blocked_on: null,
    });

    const result = approveRunCompletion(root);
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('No pending run completion'));
  });

  it('fails when not paused', () => {
    writeJson(root, STATE_PATH, {
      schema_version: '1.0',
      run_id: 'run_test123',
      status: 'active',
      phase: 'qa',
      pending_run_completion: { gate: 'qa_ship_verdict', requested_by_turn: 'turn_test456' },
    });

    const result = approveRunCompletion(root);
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('expected "paused" or "blocked"'));
  });

  it('completes the run from blocked state when pending completion is retained', () => {
    writeJson(root, STATE_PATH, {
      schema_version: '1.0',
      run_id: 'run_test123',
      status: 'blocked',
      phase: 'qa',
      blocked_on: 'hook:before_gate:final-audit',
      blocked_reason: {
        category: 'hook_block',
        blocked_at: '2026-04-02T13:00:00Z',
        turn_id: 'turn_test456',
        recovery: {
          typed_reason: 'pending_run_completion',
          owner: 'human',
          recovery_action: 'agentxchain approve-completion',
          turn_retained: false,
          detail: 'qa_ship_verdict',
        },
      },
      pending_run_completion: {
        gate: 'qa_ship_verdict',
        requested_by_turn: 'turn_test456',
        requested_at: '2026-03-31T14:00:00Z',
      },
      phase_gate_status: { planning_signoff: 'passed', implementation_complete: 'passed' },
      budget_status: { spent_usd: 10.0, remaining_usd: 40.0 },
    });

    const result = approveRunCompletion(root);
    assert.equal(result.ok, true);
    assert.equal(result.state.status, 'completed');
    assert.ok(result.state.completed_at);
    assert.equal(result.state.blocked_on, null);
    assert.equal(result.state.blocked_reason, null);
    assert.equal(result.state.pending_run_completion, null);
    assert.equal(result.state.phase_gate_status.qa_ship_verdict, 'passed');
  });

  it('fails when no state file', () => {
    const result = approveRunCompletion(root);
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('No governed state.json'));
  });
});

// ── initializeGovernedRun blocks on completed ───────────────────────────────

describe('initializeGovernedRun — completed run guard', () => {
  let root;

  beforeEach(() => {
    root = makeTmpDir();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('rejects initialization of a completed run', () => {
    writeJson(root, STATE_PATH, {
      schema_version: '1.0',
      run_id: 'run_test123',
      status: 'completed',
      phase: 'qa',
      completed_at: '2026-03-31T14:00:00Z',
    });

    const result = initializeGovernedRun(root, makeConfig());
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('already completed'));
  });
});

// ── Full lifecycle: planning → implementation → qa → completed ──────────────

describe('Full lifecycle to run completion', () => {
  let root;
  const config = makeConfig({
    gates: {
      planning_signoff: {
        requires_files: ['.planning/PM_SIGNOFF.md'],
        requires_human_approval: true,
      },
      implementation_complete: {
        requires_verification_pass: true,
      },
      qa_ship_verdict: {
        requires_files: ['.planning/ship-verdict.md'],
        // No human approval — auto-complete
      },
    },
  });

  beforeEach(() => {
    root = makeTmpDir();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('completes a 3-phase run: planning → implementation → qa → completed', () => {
    // Initialize state
    writeJson(root, STATE_PATH, {
      schema_version: '1.0',
      run_id: null,
      project_id: 'test-project',
      status: 'idle',
      phase: 'planning',
      accepted_integration_ref: null,
      current_turn: null,
      last_completed_turn_id: null,
      blocked_on: null,
      escalation: null,
      phase_gate_status: {},
      budget_status: { spent_usd: 0, remaining_usd: 50.0 },
    });

    // Phase 1: Planning
    const initResult = initializeGovernedRun(root, config);
    assert.equal(initResult.ok, true);
    const runId = initResult.state.run_id;

    const assignPm = assignGovernedTurn(root, config, 'pm');
    assert.equal(assignPm.ok, true);
    const pmTurnId = assignPm.state.current_turn.turn_id;

    mkdirSync(join(root, '.planning'), { recursive: true });
    writeFileSync(join(root, '.planning/PM_SIGNOFF.md'), 'Approved: YES\n');

    stageTurnResult(root, {
      schema_version: '1.0',
      run_id: runId,
      turn_id: pmTurnId,
      role: 'pm',
      runtime_id: 'manual-pm',
      status: 'completed',
      summary: 'Planning signoff.',
      decisions: [],
      objections: [{ id: 'OBJ-001', severity: 'low', statement: 'Looks good.' }],
      files_changed: [],
      artifacts_created: ['.planning/PM_SIGNOFF.md'],
      verification: { status: 'skipped' },
      artifact: { type: 'review', ref: null },
      proposed_next_role: 'dev',
      phase_transition_request: 'implementation',
      cost: { usd: 0 },
    });

    const acceptPm = acceptGovernedTurn(root, config);
    assert.equal(acceptPm.ok, true);
    // Human-gated → paused
    assert.equal(acceptPm.state.status, 'paused');
    assert.ok(acceptPm.state.pending_phase_transition);

    const approveResult = approvePhaseTransition(root);
    assert.equal(approveResult.ok, true);
    assert.equal(approveResult.state.phase, 'implementation');
    assert.equal(approveResult.state.status, 'active');

    // Phase 2: Implementation
    const assignDev = assignGovernedTurn(root, config, 'dev');
    assert.equal(assignDev.ok, true);
    const devTurnId = assignDev.state.current_turn.turn_id;

    stageTurnResult(root, {
      schema_version: '1.0',
      run_id: runId,
      turn_id: devTurnId,
      role: 'dev',
      runtime_id: 'local-dev',
      status: 'completed',
      summary: 'Implementation done.',
      decisions: [{ id: 'DEC-001', category: 'implementation', statement: 'Used polling.', rationale: 'Simpler.' }],
      objections: [],
      files_changed: ['src/main.js'],
      artifacts_created: [],
      verification: { status: 'pass', evidence_summary: 'Tests pass.', commands: ['npm test'] },
      artifact: { type: 'workspace', ref: 'git:abc' },
      proposed_next_role: 'qa',
      phase_transition_request: 'qa',
      cost: { usd: 1.50 },
    });

    const acceptDev = acceptGovernedTurn(root, config);
    assert.equal(acceptDev.ok, true);
    // Auto-advance (no human approval on implementation_complete)
    assert.equal(acceptDev.state.phase, 'qa');
    assert.equal(acceptDev.state.status, 'active');

    // Phase 3: QA → run completion
    const assignQa = assignGovernedTurn(root, config, 'qa');
    assert.equal(assignQa.ok, true);
    const qaTurnId = assignQa.state.current_turn.turn_id;

    writeFileSync(join(root, '.planning/ship-verdict.md'), '## Verdict: YES\n');
    writeFileSync(join(root, '.planning/RELEASE_NOTES.md'), '# Release Notes\n\n## User Impact\n\nFeature delivered.\n\n## Verification Summary\n\nAll tests pass.\n');

    stageTurnResult(root, {
      schema_version: '1.0',
      run_id: runId,
      turn_id: qaTurnId,
      role: 'qa',
      runtime_id: 'api-qa',
      status: 'completed',
      summary: 'All acceptance criteria met.',
      decisions: [],
      objections: [{ id: 'OBJ-002', severity: 'low', statement: 'Ship it.' }],
      files_changed: [],
      artifacts_created: ['.planning/ship-verdict.md'],
      verification: { status: 'pass', evidence_summary: 'All good.' },
      artifact: { type: 'review', ref: null },
      proposed_next_role: 'human',
      run_completion_request: true,
      cost: { usd: 0.50 },
    });

    const acceptQa = acceptGovernedTurn(root, config);
    assert.equal(acceptQa.ok, true);
    assert.equal(acceptQa.state.status, 'completed');
    assert.ok(acceptQa.state.completed_at);

    // Verify budget tracking across phases
    assert.equal(acceptQa.state.budget_status.spent_usd, 2.0);

    // Verify no more turns can be assigned
    const cantAssign = assignGovernedTurn(root, config, 'dev');
    assert.equal(cantAssign.ok, false);

    // Verify no re-init
    const cantInit = initializeGovernedRun(root, config);
    assert.equal(cantInit.ok, false);
    assert.ok(cantInit.error.includes('completed'));
  });
});
