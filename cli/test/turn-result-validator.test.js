import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { validateStagedTurnResult, normalizeTurnResult, STAGING_PATH } from '../src/lib/turn-result-validator.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

const TMP_ROOT = join(import.meta.dirname, '.tmp-turn-result-test');

function setup() {
  rmSync(TMP_ROOT, { recursive: true, force: true });
  mkdirSync(join(TMP_ROOT, '.agentxchain', 'staging'), { recursive: true });
}

function teardown() {
  rmSync(TMP_ROOT, { recursive: true, force: true });
}

function writeStagedResult(data) {
  writeFileSync(
    join(TMP_ROOT, STAGING_PATH),
    typeof data === 'string' ? data : JSON.stringify(data, null, 2),
    'utf8'
  );
}

function makeValidTurnResult(overrides = {}) {
  return {
    schema_version: '1.0',
    run_id: 'run_01H',
    turn_id: 'turn-0004',
    role: 'dev',
    runtime_id: 'local-dev',
    status: 'completed',
    summary: 'Implemented feature X with tests.',
    decisions: [
      {
        id: 'DEC-001',
        category: 'implementation',
        statement: 'Used polling instead of websockets.',
        rationale: 'Lower complexity for v1.',
      },
    ],
    objections: [],
    files_changed: ['src/feature.ts', 'tests/feature.test.ts'],
    artifacts_created: [],
    verification: {
      status: 'pass',
      commands: ['npm test'],
      evidence_summary: 'All tests passed.',
      machine_evidence: [{ command: 'npm test', exit_code: 0 }],
    },
    artifact: {
      type: 'workspace',
      ref: 'git:abc123',
      diff_summary: '2 files changed, 50 insertions',
    },
    proposed_next_role: 'qa',
    phase_transition_request: null,
    needs_human_reason: null,
    cost: { input_tokens: 5000, output_tokens: 1200, usd: 0.42 },
    ...overrides,
  };
}

function makeState(overrides = {}) {
  return {
    schema_version: '1.0',
    run_id: 'run_01H',
    project_id: 'test-project',
    status: 'active',
    phase: 'implementation',
    current_turn: {
      turn_id: 'turn-0004',
      assigned_role: 'dev',
      status: 'running',
      attempt: 1,
      runtime_id: 'local-dev',
    },
    phase_gate_status: {
      planning_signoff: 'passed',
      implementation_complete: 'pending',
    },
    budget_status: { spent_usd: 5.0, remaining_usd: 45.0 },
    ...overrides,
  };
}

function makeConfig(overrides = {}) {
  return {
    schema_version: 4,
    protocol_mode: 'governed',
    project: { id: 'test-project', name: 'Test', default_branch: 'main' },
    roles: {
      pm: { title: 'PM', mandate: 'Scope', write_authority: 'review_only', runtime_class: 'manual', runtime_id: 'manual-pm' },
      dev: { title: 'Dev', mandate: 'Build', write_authority: 'authoritative', runtime_class: 'local_cli', runtime_id: 'local-dev' },
      qa: { title: 'QA', mandate: 'Test', write_authority: 'review_only', runtime_class: 'api_proxy', runtime_id: 'api-qa' },
    },
    runtimes: {
      'manual-pm': { type: 'manual' },
      'local-dev': { type: 'local_cli' },
      'api-qa': { type: 'api_proxy' },
    },
    routing: {
      planning: { entry_role: 'pm', allowed_next_roles: ['pm', 'human'], exit_gate: 'planning_signoff' },
      implementation: { entry_role: 'dev', allowed_next_roles: ['dev', 'qa', 'human'], exit_gate: 'implementation_complete' },
      qa: { entry_role: 'qa', allowed_next_roles: ['dev', 'qa', 'human'], exit_gate: 'qa_ship_verdict' },
    },
    gates: {
      planning_signoff: { requires_files: ['.planning/PM_SIGNOFF.md'], requires_human_approval: true },
      implementation_complete: { requires_verification_pass: true },
      qa_ship_verdict: { requires_files: ['.planning/acceptance-matrix.md'], requires_human_approval: true },
    },
    budget: { per_turn_max_usd: 2.0, per_run_max_usd: 50.0, on_exceed: 'pause_and_escalate' },
    rules: { challenge_required: true, max_turn_retries: 2, max_deadlock_cycles: 2 },
    files: { talk: 'TALK.md', history: '.agentxchain/history.jsonl', state: '.agentxchain/state.json' },
    compat: { next_owner_source: 'state-json', lock_based_coordination: false, original_version: 4 },
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('turn-result-validator', () => {
  beforeEach(setup);
  afterEach(teardown);

  // ─── Happy path ────────────────────────────────────────────────────────

  describe('valid turn result', () => {
    it('passes all 5 stages for a well-formed dev turn result', () => {
      writeStagedResult(makeValidTurnResult());
      const res = validateStagedTurnResult(TMP_ROOT, makeState(), makeConfig());
      assert.equal(res.ok, true);
      assert.equal(res.stage, null);
      assert.equal(res.error_class, null);
      assert.equal(res.errors.length, 0);
      assert.ok(res.turnResult, 'should return parsed turn result');
      assert.equal(res.turnResult.role, 'dev');
    });

    it('passes for a review_only role with valid objections', () => {
      const tr = makeValidTurnResult({
        role: 'qa',
        runtime_id: 'api-qa',
        files_changed: [],
        artifact: { type: 'review', ref: null },
        artifacts_created: ['.planning/qa-review.md'],
        objections: [
          { id: 'OBJ-001', severity: 'medium', statement: 'Missing edge case test for empty input.', status: 'raised' },
        ],
        proposed_next_role: 'dev',
      });
      const state = makeState({
        phase: 'qa',
        current_turn: { turn_id: 'turn-0004', assigned_role: 'qa', status: 'running', attempt: 1, runtime_id: 'api-qa' },
      });
      writeStagedResult(tr);
      const res = validateStagedTurnResult(TMP_ROOT, state, makeConfig());
      assert.equal(res.ok, true);
    });
  });

  // ─── Stage A: Schema Validation ────────────────────────────────────────

  describe('Stage A: schema validation', () => {
    it('rejects missing staged file', () => {
      rmSync(join(TMP_ROOT, STAGING_PATH), { force: true });
      const res = validateStagedTurnResult(TMP_ROOT, makeState(), makeConfig());
      assert.equal(res.ok, false);
      assert.equal(res.stage, 'schema');
      assert.equal(res.error_class, 'schema_error');
    });

    it('rejects invalid JSON', () => {
      writeStagedResult('{ not valid json }}}');
      const res = validateStagedTurnResult(TMP_ROOT, makeState(), makeConfig());
      assert.equal(res.ok, false);
      assert.equal(res.error_class, 'schema_error');
    });

    it('rejects missing required fields', () => {
      writeStagedResult({ schema_version: '1.0' });
      const res = validateStagedTurnResult(TMP_ROOT, makeState(), makeConfig());
      assert.equal(res.ok, false);
      assert.equal(res.error_class, 'schema_error');
      assert.ok(res.errors.some(e => e.includes('Missing required field')));
    });

    it('rejects wrong schema_version', () => {
      writeStagedResult(makeValidTurnResult({ schema_version: '2.0' }));
      const res = validateStagedTurnResult(TMP_ROOT, makeState(), makeConfig());
      assert.equal(res.ok, false);
      assert.equal(res.error_class, 'schema_error');
      assert.ok(res.errors.some(e => e.includes('schema_version')));
    });

    it('rejects invalid status enum', () => {
      writeStagedResult(makeValidTurnResult({ status: 'done' }));
      const res = validateStagedTurnResult(TMP_ROOT, makeState(), makeConfig());
      assert.equal(res.ok, false);
      assert.equal(res.error_class, 'schema_error');
      assert.ok(res.errors.some(e => e.includes('status must be one of')));
    });

    it('rejects malformed decisions', () => {
      writeStagedResult(makeValidTurnResult({
        decisions: [{ id: 'BAD', category: 'nope', statement: '', rationale: '' }],
      }));
      const res = validateStagedTurnResult(TMP_ROOT, makeState(), makeConfig());
      assert.equal(res.ok, false);
      assert.equal(res.error_class, 'schema_error');
      assert.ok(res.errors.some(e => e.includes('decisions[0].id')));
    });

    it('rejects malformed objections', () => {
      writeStagedResult(makeValidTurnResult({
        objections: [{ id: 'OBJ-X', severity: 'extreme', statement: '' }],
      }));
      const res = validateStagedTurnResult(TMP_ROOT, makeState(), makeConfig());
      assert.equal(res.ok, false);
      assert.equal(res.error_class, 'schema_error');
    });

    it('rejects invalid artifact type', () => {
      writeStagedResult(makeValidTurnResult({
        artifact: { type: 'magic', ref: null },
      }));
      const res = validateStagedTurnResult(TMP_ROOT, makeState(), makeConfig());
      assert.equal(res.ok, false);
      assert.equal(res.error_class, 'schema_error');
      assert.ok(res.errors.some(e => e.includes('artifact.type')));
    });

    it('rejects invalid verification status', () => {
      writeStagedResult(makeValidTurnResult({
        verification: { status: 'maybe' },
      }));
      const res = validateStagedTurnResult(TMP_ROOT, makeState(), makeConfig());
      assert.equal(res.ok, false);
      assert.equal(res.error_class, 'schema_error');
    });
  });

  // ─── Stage B: Assignment Validation ────────────────────────────────────

  describe('Stage B: assignment validation', () => {
    it('rejects run_id mismatch', () => {
      writeStagedResult(makeValidTurnResult({ run_id: 'run_WRONG' }));
      const res = validateStagedTurnResult(TMP_ROOT, makeState(), makeConfig());
      assert.equal(res.ok, false);
      assert.equal(res.stage, 'assignment');
      assert.equal(res.error_class, 'assignment_error');
      assert.ok(res.errors.some(e => e.includes('run_id mismatch')));
    });

    it('rejects turn_id mismatch', () => {
      writeStagedResult(makeValidTurnResult({ turn_id: 'turn-9999' }));
      const res = validateStagedTurnResult(TMP_ROOT, makeState(), makeConfig());
      assert.equal(res.ok, false);
      assert.equal(res.error_class, 'assignment_error');
      assert.ok(res.errors.some(e => e.includes('turn_id mismatch')));
    });

    it('rejects role mismatch', () => {
      writeStagedResult(makeValidTurnResult({ role: 'qa' }));
      const res = validateStagedTurnResult(TMP_ROOT, makeState(), makeConfig());
      assert.equal(res.ok, false);
      assert.equal(res.error_class, 'assignment_error');
      assert.ok(res.errors.some(e => e.includes('role mismatch')));
    });

    it('rejects runtime_id mismatch', () => {
      writeStagedResult(makeValidTurnResult({ runtime_id: 'api-qa' }));
      const res = validateStagedTurnResult(TMP_ROOT, makeState(), makeConfig());
      assert.equal(res.ok, false);
      assert.equal(res.error_class, 'assignment_error');
      assert.ok(res.errors.some(e => e.includes('runtime_id mismatch')));
    });

    it('rejects when state has no current_turn', () => {
      writeStagedResult(makeValidTurnResult());
      const state = makeState();
      delete state.current_turn;
      const res = validateStagedTurnResult(TMP_ROOT, state, makeConfig());
      assert.equal(res.ok, false);
      assert.equal(res.error_class, 'assignment_error');
    });
  });

  // ─── Stage C: Artifact Validation ──────────────────────────────────────

  describe('Stage C: artifact validation', () => {
    it('rejects review_only role claiming product file changes', () => {
      const tr = makeValidTurnResult({
        role: 'qa',
        runtime_id: 'api-qa',
        files_changed: ['src/app.ts'],
        artifact: { type: 'review', ref: null },
        objections: [{ id: 'OBJ-001', severity: 'low', statement: 'No issues found.', status: 'raised' }],
      });
      const state = makeState({
        phase: 'qa',
        current_turn: { turn_id: 'turn-0004', assigned_role: 'qa', status: 'running', attempt: 1, runtime_id: 'api-qa' },
      });
      writeStagedResult(tr);
      const res = validateStagedTurnResult(TMP_ROOT, state, makeConfig());
      assert.equal(res.ok, false);
      assert.equal(res.stage, 'artifact');
      assert.equal(res.error_class, 'artifact_error');
      assert.ok(res.errors.some(e => e.includes('review_only write authority') && e.includes('product file')));
    });

    it('allows review_only role to create .planning/ files', () => {
      const tr = makeValidTurnResult({
        role: 'qa',
        runtime_id: 'api-qa',
        files_changed: ['.planning/qa-review.md'],
        artifact: { type: 'review', ref: null },
        objections: [{ id: 'OBJ-001', severity: 'low', statement: 'Looks good.', status: 'raised' }],
      });
      const state = makeState({
        phase: 'qa',
        current_turn: { turn_id: 'turn-0004', assigned_role: 'qa', status: 'running', attempt: 1, runtime_id: 'api-qa' },
      });
      writeStagedResult(tr);
      const res = validateStagedTurnResult(TMP_ROOT, state, makeConfig());
      assert.equal(res.ok, true);
    });

    it('rejects review_only role with non-review artifact type', () => {
      const tr = makeValidTurnResult({
        role: 'qa',
        runtime_id: 'api-qa',
        files_changed: [],
        artifact: { type: 'workspace', ref: 'git:abc' },
        objections: [{ id: 'OBJ-001', severity: 'low', statement: 'Fine.', status: 'raised' }],
      });
      const state = makeState({
        phase: 'qa',
        current_turn: { turn_id: 'turn-0004', assigned_role: 'qa', status: 'running', attempt: 1, runtime_id: 'api-qa' },
      });
      writeStagedResult(tr);
      const res = validateStagedTurnResult(TMP_ROOT, state, makeConfig());
      assert.equal(res.ok, false);
      assert.equal(res.error_class, 'artifact_error');
    });

    it('rejects modification of reserved paths', () => {
      writeStagedResult(makeValidTurnResult({
        files_changed: ['src/app.ts', '.agentxchain/state.json'],
      }));
      const res = validateStagedTurnResult(TMP_ROOT, makeState(), makeConfig());
      assert.equal(res.ok, false);
      assert.equal(res.error_class, 'artifact_error');
      assert.ok(res.errors.some(e => e.includes('reserved path')));
    });

    it('warns when authoritative role completes with no files_changed', () => {
      writeStagedResult(makeValidTurnResult({ files_changed: [] }));
      const res = validateStagedTurnResult(TMP_ROOT, makeState(), makeConfig());
      assert.equal(res.ok, true);
      assert.ok(res.warnings.some(w => w.includes('no files_changed')));
    });
  });

  // ─── Stage D: Verification Validation ──────────────────────────────────

  describe('Stage D: verification validation', () => {
    it('warns when pass status has no evidence', () => {
      writeStagedResult(makeValidTurnResult({
        verification: { status: 'pass' },
      }));
      const res = validateStagedTurnResult(TMP_ROOT, makeState(), makeConfig());
      assert.equal(res.ok, true);
      assert.ok(res.warnings.some(w => w.includes('no evidence')));
    });

    it('rejects pass status with non-zero exit codes in machine_evidence', () => {
      writeStagedResult(makeValidTurnResult({
        verification: {
          status: 'pass',
          commands: ['npm test'],
          machine_evidence: [{ command: 'npm test', exit_code: 1 }],
        },
      }));
      const res = validateStagedTurnResult(TMP_ROOT, makeState(), makeConfig());
      assert.equal(res.ok, false);
      assert.equal(res.stage, 'verification');
      assert.equal(res.error_class, 'verification_error');
      assert.ok(res.errors.some(e => e.includes('non-zero exit')));
      assert.ok(res.errors.some(e => e.includes('Wrap expected-failure checks')));
    });

    it('accepts skipped verification without evidence', () => {
      writeStagedResult(makeValidTurnResult({
        verification: { status: 'skipped' },
      }));
      const res = validateStagedTurnResult(TMP_ROOT, makeState(), makeConfig());
      assert.equal(res.ok, true);
    });
  });

  // ─── Stage E: Protocol Compliance ──────────────────────────────────────

  describe('Stage E: protocol compliance', () => {
    it('rejects review_only role with empty objections (challenge requirement)', () => {
      const tr = makeValidTurnResult({
        role: 'qa',
        runtime_id: 'api-qa',
        files_changed: [],
        artifact: { type: 'review', ref: null },
        objections: [],
        proposed_next_role: 'dev',
      });
      const state = makeState({
        phase: 'qa',
        current_turn: { turn_id: 'turn-0004', assigned_role: 'qa', status: 'running', attempt: 1, runtime_id: 'api-qa' },
      });
      writeStagedResult(tr);
      const res = validateStagedTurnResult(TMP_ROOT, state, makeConfig());
      assert.equal(res.ok, false);
      assert.equal(res.stage, 'protocol');
      assert.equal(res.error_class, 'protocol_error');
      assert.ok(res.errors.some(e => e.includes('challenge requirement')));
    });

    it('allows authoritative role with empty objections on first turn', () => {
      writeStagedResult(makeValidTurnResult({ objections: [] }));
      const res = validateStagedTurnResult(TMP_ROOT, makeState(), makeConfig());
      assert.equal(res.ok, true);
    });

    it('rejects proposed_next_role not in routing allowlist', () => {
      writeStagedResult(makeValidTurnResult({ proposed_next_role: 'pm' }));
      const res = validateStagedTurnResult(TMP_ROOT, makeState(), makeConfig());
      assert.equal(res.ok, false);
      assert.equal(res.stage, 'protocol');
      assert.equal(res.error_class, 'protocol_error');
      assert.ok(res.errors.some(e => e.includes('not in the allowed_next_roles')));
    });

    it('allows proposed_next_role = human even if not in allowlist', () => {
      writeStagedResult(makeValidTurnResult({ proposed_next_role: 'human' }));
      const res = validateStagedTurnResult(TMP_ROOT, makeState(), makeConfig());
      assert.equal(res.ok, true);
    });

    it('rejects invalid phase_transition_request', () => {
      writeStagedResult(makeValidTurnResult({ phase_transition_request: 'release' }));
      const res = validateStagedTurnResult(TMP_ROOT, makeState(), makeConfig());
      assert.equal(res.ok, false);
      assert.equal(res.error_class, 'protocol_error');
      assert.ok(res.errors.some(e => e.includes('phase_transition_request')));
    });

    it('allows valid phase_transition_request', () => {
      writeStagedResult(makeValidTurnResult({ phase_transition_request: 'qa' }));
      const res = validateStagedTurnResult(TMP_ROOT, makeState(), makeConfig());
      assert.equal(res.ok, true);
    });

    it('allows run_completion_request = true for a valid final-phase turn result', () => {
      const tr = makeValidTurnResult({
        role: 'qa',
        runtime_id: 'api-qa',
        files_changed: [],
        artifact: { type: 'review', ref: null },
        objections: [{ id: 'OBJ-001', severity: 'low', statement: 'Ship readiness depends on human approval.', status: 'raised' }],
        proposed_next_role: 'human',
        phase_transition_request: null,
        run_completion_request: true,
      });
      const state = makeState({
        phase: 'qa',
        current_turn: { turn_id: 'turn-0004', assigned_role: 'qa', status: 'running', attempt: 1, runtime_id: 'api-qa' },
      });
      writeStagedResult(tr);
      const res = validateStagedTurnResult(TMP_ROOT, state, makeConfig());
      assert.equal(res.ok, true);
    });

    it('rejects run_completion_request when combined with phase_transition_request', () => {
      const tr = makeValidTurnResult({
        role: 'qa',
        runtime_id: 'api-qa',
        files_changed: [],
        artifact: { type: 'review', ref: null },
        objections: [{ id: 'OBJ-001', severity: 'medium', statement: 'Cannot both advance phase and finish the run.', status: 'raised' }],
        proposed_next_role: 'human',
        phase_transition_request: 'qa',
        run_completion_request: true,
      });
      const state = makeState({
        phase: 'qa',
        current_turn: { turn_id: 'turn-0004', assigned_role: 'qa', status: 'running', attempt: 1, runtime_id: 'api-qa' },
      });
      writeStagedResult(tr);
      const res = validateStagedTurnResult(TMP_ROOT, state, makeConfig());
      assert.equal(res.ok, false);
      assert.equal(res.stage, 'protocol');
      assert.equal(res.error_class, 'protocol_error');
      assert.ok(res.errors.some(e => e.includes('mutually exclusive')));
    });

    it('skips challenge requirement when config disables it', () => {
      const tr = makeValidTurnResult({
        role: 'qa',
        runtime_id: 'api-qa',
        files_changed: [],
        artifact: { type: 'review', ref: null },
        objections: [],
        proposed_next_role: 'dev',
      });
      const state = makeState({
        phase: 'qa',
        current_turn: { turn_id: 'turn-0004', assigned_role: 'qa', status: 'running', attempt: 1, runtime_id: 'api-qa' },
      });
      const config = makeConfig({ rules: { challenge_required: false, max_turn_retries: 2 } });
      writeStagedResult(tr);
      const res = validateStagedTurnResult(TMP_ROOT, state, config);
      assert.equal(res.ok, true);
    });

    it('warns when needs_human status has no reason', () => {
      writeStagedResult(makeValidTurnResult({
        status: 'needs_human',
        needs_human_reason: null,
      }));
      const res = validateStagedTurnResult(TMP_ROOT, makeState(), makeConfig());
      assert.equal(res.ok, true);
      assert.ok(res.warnings.some(w => w.includes('needs_human_reason')));
    });
  });

  // ─── Pipeline short-circuit ────────────────────────────────────────────

  describe('pipeline short-circuit behavior', () => {
    it('schema errors prevent assignment validation from running', () => {
      // This has schema errors (missing fields) AND would have assignment errors
      writeStagedResult({ schema_version: '1.0' });
      const res = validateStagedTurnResult(TMP_ROOT, makeState(), makeConfig());
      assert.equal(res.stage, 'schema');
      // Should not see assignment errors
      assert.ok(!res.errors.some(e => e.includes('mismatch')));
    });
  });

  // ─── Normalization ──────────────────────────────────────────────────────

  describe('normalizeTurnResult', () => {
    it('AT-NORM-001: coerces artifacts_created objects with path property to strings', () => {
      const tr = makeValidTurnResult({
        artifacts_created: [
          { path: '.planning/acceptance-matrix.md', description: 'Acceptance matrix' },
          { path: '.planning/ship-verdict.md', description: 'Ship verdict' },
        ],
      });
      const { normalized, corrections } = normalizeTurnResult(tr, makeConfig());
      assert.deepStrictEqual(normalized.artifacts_created, [
        '.planning/acceptance-matrix.md',
        '.planning/ship-verdict.md',
      ]);
      assert.equal(corrections.length, 2);
      assert.ok(corrections[0].includes('coerced object to string'));
    });

    it('AT-NORM-002: preserves strings and coerces objects in mixed arrays', () => {
      const tr = makeValidTurnResult({
        artifacts_created: [
          '.planning/foo.md',
          { path: '.planning/bar.md', description: 'Bar' },
        ],
      });
      const { normalized, corrections } = normalizeTurnResult(tr, makeConfig());
      assert.deepStrictEqual(normalized.artifacts_created, [
        '.planning/foo.md',
        '.planning/bar.md',
      ]);
      assert.equal(corrections.length, 1);
    });

    it('AT-NORM-003: corrects terminal exit gate to run_completion_request', () => {
      const tr = makeValidTurnResult({
        role: 'qa',
        phase_transition_request: 'qa_ship_verdict',
        run_completion_request: null,
      });
      const { normalized, corrections } = normalizeTurnResult(tr, makeConfig());
      assert.equal(normalized.phase_transition_request, null);
      assert.equal(normalized.run_completion_request, true);
      assert.equal(corrections.length, 1);
      assert.ok(corrections[0].includes('run_completion_request'));
    });

    it('AT-NORM-004: corrects non-terminal exit gate to next phase name', () => {
      const tr = makeValidTurnResult({
        phase_transition_request: 'planning_signoff',
        run_completion_request: null,
      });
      const { normalized, corrections } = normalizeTurnResult(tr, makeConfig());
      assert.equal(normalized.phase_transition_request, 'implementation');
      assert.equal(normalized.run_completion_request, null);
      assert.equal(corrections.length, 1);
      assert.ok(corrections[0].includes('planning_signoff'));
      assert.ok(corrections[0].includes('implementation'));
    });

    it('AT-NORM-005: returns unchanged result when already valid', () => {
      const tr = makeValidTurnResult();
      const { normalized, corrections } = normalizeTurnResult(tr, makeConfig());
      assert.deepStrictEqual(normalized.artifacts_created, tr.artifacts_created);
      assert.equal(normalized.phase_transition_request, null);
      assert.equal(corrections.length, 0);
    });

    it('AT-NORM-006: does not normalize when both phase_transition and run_completion are set', () => {
      const tr = makeValidTurnResult({
        phase_transition_request: 'qa_ship_verdict',
        run_completion_request: true,
      });
      const { normalized, corrections } = normalizeTurnResult(tr, makeConfig());
      // Should NOT touch either field — let mutual-exclusivity validator catch it
      assert.equal(normalized.phase_transition_request, 'qa_ship_verdict');
      assert.equal(normalized.run_completion_request, true);
      assert.equal(corrections.length, 0);
    });

    it('coerces objects with name property when path is absent', () => {
      const tr = makeValidTurnResult({
        artifacts_created: [{ name: '.agentxchain/reviews/r1.md' }],
      });
      const { normalized, corrections } = normalizeTurnResult(tr, makeConfig());
      assert.deepStrictEqual(normalized.artifacts_created, ['.agentxchain/reviews/r1.md']);
      assert.equal(corrections.length, 1);
    });

    it('handles non-object turn result gracefully', () => {
      const { normalized, corrections } = normalizeTurnResult(null, makeConfig());
      assert.equal(normalized, null);
      assert.equal(corrections.length, 0);
    });

    it('corrects implementation_complete gate to qa phase', () => {
      const tr = makeValidTurnResult({
        phase_transition_request: 'implementation_complete',
        run_completion_request: null,
      });
      const { normalized, corrections } = normalizeTurnResult(tr, makeConfig());
      assert.equal(normalized.phase_transition_request, 'qa');
      assert.equal(corrections.length, 1);
    });

    it('AT-STATUS-001: infers completed when status is missing but phase_transition_request is present', () => {
      const tr = makeValidTurnResult({ status: undefined, phase_transition_request: 'qa' });
      delete tr.status;
      const { normalized, corrections } = normalizeTurnResult(tr, makeConfig());
      assert.equal(normalized.status, 'completed');
      assert.ok(corrections.some((c) => c.includes('phase_transition_request "qa"')));
    });

    it('AT-STATUS-002: infers completed when status is missing but run_completion_request is true', () => {
      const tr = makeValidTurnResult({ status: undefined, run_completion_request: true });
      delete tr.status;
      const { normalized, corrections } = normalizeTurnResult(tr, makeConfig());
      assert.equal(normalized.status, 'completed');
      assert.ok(corrections.some((c) => c.includes('run_completion_request: true')));
    });

    it('AT-STATUS-003: infers needs_human when status is missing but needs_human_reason is present', () => {
      const tr = makeValidTurnResult({ status: undefined, needs_human_reason: 'Need operator approval.' });
      delete tr.status;
      const { normalized, corrections } = normalizeTurnResult(tr, makeConfig());
      assert.equal(normalized.status, 'needs_human');
      assert.ok(corrections.some((c) => c.includes('needs_human_reason')));
    });

    it('AT-STATUS-004: leaves ambiguous missing status unchanged', () => {
      const tr = makeValidTurnResult({ status: undefined });
      delete tr.status;
      const { normalized, corrections } = normalizeTurnResult(tr, makeConfig());
      assert.ok(!('status' in normalized));
      assert.equal(corrections.length, 0);
    });
  });

  // ─── Normalization integration with validator pipeline ──────────────────

  describe('normalization integration', () => {
    beforeEach(setup);
    afterEach(teardown);

    it('artifacts_created objects pass validation after normalization', () => {
      const tr = makeValidTurnResult({
        artifacts_created: [
          { path: '.planning/acceptance-matrix.md', description: 'Matrix' },
        ],
      });
      writeStagedResult(tr);
      const res = validateStagedTurnResult(TMP_ROOT, makeState(), makeConfig());
      assert.equal(res.ok, true, `Expected ok but got errors: ${res.errors.join(', ')}`);
      assert.ok(res.warnings.some((w) => w.includes('[normalized]')));
    });

    it('terminal gate name passes validation via normalization to run_completion_request', () => {
      const qaState = makeState({
        phase: 'qa',
        current_turn: {
          turn_id: 'turn-0004',
          assigned_role: 'qa',
          status: 'running',
          attempt: 1,
          runtime_id: 'api-qa',
        },
      });
      const tr = makeValidTurnResult({
        role: 'qa',
        runtime_id: 'api-qa',
        phase_transition_request: 'qa_ship_verdict',
        run_completion_request: null,
        artifact: { type: 'review', ref: null },
        files_changed: [],
        verification: {
          status: 'skipped',
          commands: [],
          evidence_summary: 'Review turn.',
          machine_evidence: [],
        },
        objections: [
          { id: 'OBJ-001', severity: 'low', against_turn_id: 'turn-0003', statement: 'Observation.', status: 'raised' },
        ],
      });
      writeStagedResult(tr);
      const res = validateStagedTurnResult(TMP_ROOT, qaState, makeConfig());
      assert.equal(res.ok, true, `Expected ok but got errors: ${res.errors.join(', ')}`);
      assert.ok(res.warnings.some((w) => w.includes('run_completion_request')));
    });

    it('AT-STATUS-005: validator accepts missing status after normalization from phase_transition_request', () => {
      const qaReviewState = makeState({
        current_turn: {
          turn_id: 'turn-0004',
          assigned_role: 'qa',
          status: 'running',
          attempt: 1,
          runtime_id: 'api-qa',
        },
      });
      const tr = makeValidTurnResult({
        role: 'qa',
        runtime_id: 'api-qa',
        status: undefined,
        phase_transition_request: 'qa',
        verification: {
          status: 'skipped',
          commands: [],
          evidence_summary: 'Review turn.',
          machine_evidence: [],
        },
        artifact: { type: 'review', ref: null },
        files_changed: [],
        objections: [
          { id: 'OBJ-001', severity: 'low', against_turn_id: 'turn-0003', statement: 'Observation.', status: 'raised' },
        ],
      });
      delete tr.status;
      writeStagedResult(tr);
      const res = validateStagedTurnResult(TMP_ROOT, qaReviewState, makeConfig());
      assert.equal(res.ok, true, `Expected ok but got errors: ${res.errors.join(', ')}`);
      assert.equal(res.turnResult.status, 'completed');
      assert.ok(res.warnings.some((w) => w.includes('status: inferred "completed"')));
    });
  });
});
