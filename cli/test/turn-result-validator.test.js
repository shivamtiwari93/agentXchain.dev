import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { validateStagedTurnResult, normalizeTurnResult, STAGING_PATH } from '../src/lib/turn-result-validator.js';
import { summarizeIdleExpansionResult } from '../src/lib/idle-expansion-result-validator.js';

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

function writeIdleExpansionSidecar(data, dir = join(TMP_ROOT, '.agentxchain', 'staging')) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'idle-expansion-result.json'),
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

function makeIdleExpansionState(overrides = {}) {
  return makeState({
    phase: 'planning',
    current_turn: {
      turn_id: 'turn-0004',
      assigned_role: 'pm',
      status: 'running',
      attempt: 1,
      runtime_id: 'manual-pm',
      intake_context: {
        intent_id: 'intent_idle_001',
        event_id: 'evt_idle_001',
        source: 'vision_idle_expansion',
      },
      idle_expansion_context: {
        expansion_iteration: 2,
        vision_headings_snapshot: ['Human Role', 'Operating Modes'],
      },
    },
    ...overrides,
  });
}

function makeIdleExpansionTurnResult(overrides = {}) {
  return makeValidTurnResult({
    role: 'pm',
    runtime_id: 'manual-pm',
    files_changed: [],
    artifact: { type: 'review', ref: null },
    objections: [{ id: 'OBJ-001', severity: 'low', statement: 'Scope remains within the human-owned vision.', status: 'raised' }],
    proposed_next_role: 'human',
    idle_expansion_result: {
      kind: 'new_intake_intent',
      expansion_iteration: 2,
      vision_traceability: [
        { vision_heading: 'Human Role', goal: 'mechanical next-objective selection moves upstream into policy', kind: 'advances' },
      ],
      new_intake_intent: {
        title: 'Harden policy-backed next-objective selection',
        charter: 'Ship a governed increment that improves policy-backed next-objective selection.',
        acceptance_contract: ['A repeatable test proves the next objective is policy-backed.'],
        priority: 'p1',
        template: 'generic',
      },
    },
    ...overrides,
  });
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

    it('accepts valid idle_expansion_result for a vision_idle_expansion turn', () => {
      writeStagedResult(makeIdleExpansionTurnResult());
      const res = validateStagedTurnResult(TMP_ROOT, makeIdleExpansionState(), makeConfig());
      assert.equal(res.ok, true);
      assert.equal(res.turnResult.idle_expansion_result.kind, 'new_intake_intent');
    });

    it('BUG-64: accepts idle_expansion_result from sibling sidecar for a vision_idle_expansion turn', () => {
      const tr = makeIdleExpansionTurnResult();
      delete tr.idle_expansion_result;
      writeStagedResult(tr);
      writeIdleExpansionSidecar(makeIdleExpansionTurnResult().idle_expansion_result);

      const res = validateStagedTurnResult(TMP_ROOT, makeIdleExpansionState(), makeConfig());

      assert.equal(res.ok, true);
      assert.equal(res.turnResult.idle_expansion_result.kind, 'new_intake_intent');
      assert.equal(res.turnResult.idle_expansion_result.expansion_iteration, 2);
      assert.ok(res.warnings.some((w) => w.includes('Loaded idle_expansion_result from .agentxchain/staging/idle-expansion-result.json')));
    });

    it('BUG-64: normalizes dogfood sidecar shape into canonical idle_expansion_result', () => {
      const turnDir = join(TMP_ROOT, '.agentxchain', 'staging', 'turn-0004');
      const tr = makeIdleExpansionTurnResult();
      delete tr.idle_expansion_result;
      mkdirSync(turnDir, { recursive: true });
      writeFileSync(join(turnDir, 'turn-result.json'), JSON.stringify(tr, null, 2), 'utf8');
      writeIdleExpansionSidecar({
        schema_version: '1.0',
        kind: 'new_intake_intent',
        vision_exhausted: false,
        proposed_intent: {
          title: 'Harden policy-backed next-objective selection',
          charter: 'Ship a governed increment that improves policy-backed next-objective selection.',
          acceptance_contract: ['A repeatable test proves the next objective is policy-backed.'],
          priority: 'p1',
          template: 'generic',
          vision_traceability: ['Human Role'],
        },
      }, turnDir);

      const res = validateStagedTurnResult(TMP_ROOT, makeIdleExpansionState(), makeConfig(), {
        stagingPath: '.agentxchain/staging/turn-0004/turn-result.json',
      });

      assert.equal(res.ok, true);
      assert.equal(res.turnResult.idle_expansion_result.kind, 'new_intake_intent');
      assert.equal(res.turnResult.idle_expansion_result.expansion_iteration, 2);
      assert.equal(res.turnResult.idle_expansion_result.new_intake_intent.title, 'Harden policy-backed next-objective selection');
      assert.equal('vision_exhausted' in res.turnResult.idle_expansion_result, false);
      assert.deepEqual(res.turnResult.idle_expansion_result.vision_traceability, [
        { vision_heading: 'Human Role' },
      ]);
    });

    it('normalizes false vision_exhausted sentinel on top-level new_intake_intent results', () => {
      const tr = makeIdleExpansionTurnResult();
      tr.idle_expansion_result.vision_exhausted = false;
      writeStagedResult(tr);

      const res = validateStagedTurnResult(TMP_ROOT, makeIdleExpansionState(), makeConfig());

      assert.equal(res.ok, true);
      assert.equal('vision_exhausted' in res.turnResult.idle_expansion_result, false);
      assert.ok(res.warnings.some((w) => w.includes('removed false sentinel')));
    });

    it('requires idle_expansion_result for a vision_idle_expansion turn', () => {
      const tr = makeIdleExpansionTurnResult();
      delete tr.idle_expansion_result;
      writeStagedResult(tr);
      const res = validateStagedTurnResult(TMP_ROOT, makeIdleExpansionState(), makeConfig());
      assert.equal(res.ok, false);
      assert.equal(res.stage, 'schema');
      assert.equal(res.error_class, 'schema_error');
      assert.ok(res.errors.some((e) => e.includes('idle_expansion_result is required')));
    });

    it('rejects idle_expansion_result with a mismatched expansion_iteration', () => {
      writeStagedResult(makeIdleExpansionTurnResult({
        idle_expansion_result: {
          ...makeIdleExpansionTurnResult().idle_expansion_result,
          expansion_iteration: 3,
        },
      }));
      const res = validateStagedTurnResult(TMP_ROOT, makeIdleExpansionState(), makeConfig());
      assert.equal(res.ok, false);
      assert.ok(res.errors.some((e) => e.includes('expansion_iteration mismatch')));
    });

    it('rejects new_intake_intent without VISION.md traceability', () => {
      writeStagedResult(makeIdleExpansionTurnResult({
        idle_expansion_result: {
          ...makeIdleExpansionTurnResult().idle_expansion_result,
          vision_traceability: [],
        },
      }));
      const res = validateStagedTurnResult(TMP_ROOT, makeIdleExpansionState(), makeConfig());
      assert.equal(res.ok, false);
      assert.ok(res.errors.some((e) => e.includes('must cite at least one VISION.md heading')));
    });

    it('rejects traceability headings outside the session VISION.md snapshot', () => {
      writeStagedResult(makeIdleExpansionTurnResult({
        idle_expansion_result: {
          ...makeIdleExpansionTurnResult().idle_expansion_result,
          vision_traceability: [
            { vision_heading: 'Invented Scope', goal: 'Do unrelated work', kind: 'advances' },
          ],
        },
      }));
      const res = validateStagedTurnResult(TMP_ROOT, makeIdleExpansionState(), makeConfig());
      assert.equal(res.ok, false);
      assert.ok(res.errors.some((e) => e.includes('not present in the session VISION.md heading snapshot')));
    });

    it('accepts valid vision_exhausted idle_expansion_result', () => {
      writeStagedResult(makeIdleExpansionTurnResult({
        idle_expansion_result: {
          kind: 'vision_exhausted',
          expansion_iteration: 2,
          vision_traceability: [],
          vision_exhausted: {
            classification: [
              { vision_heading: 'Human Role', status: 'complete', reason: 'The current source set has no justified next increment.' },
              { vision_heading: 'Operating Modes', status: 'deferred', reason: 'Remaining work is intentionally deferred.' },
            ],
          },
        },
      }));
      const res = validateStagedTurnResult(TMP_ROOT, makeIdleExpansionState(), makeConfig());
      assert.equal(res.ok, true);
    });

    it('rejects vision_exhausted results that do not classify every VISION.md snapshot heading', () => {
      writeStagedResult(makeIdleExpansionTurnResult({
        idle_expansion_result: {
          kind: 'vision_exhausted',
          expansion_iteration: 2,
          vision_traceability: [],
          vision_exhausted: {
            classification: [
              { vision_heading: 'Human Role', status: 'complete', reason: 'No further work.' },
            ],
          },
        },
      }));
      const res = validateStagedTurnResult(TMP_ROOT, makeIdleExpansionState(), makeConfig());
      assert.equal(res.ok, false);
      assert.ok(res.errors.some((e) => e.includes('must classify VISION.md heading "Operating Modes"')));
    });

    it('validates optional idle_expansion_result when present on a non-idle turn', () => {
      writeStagedResult(makeValidTurnResult({
        idle_expansion_result: {
          kind: 'side_quest',
          expansion_iteration: 1,
          vision_traceability: [],
        },
      }));
      const res = validateStagedTurnResult(TMP_ROOT, makeState(), makeConfig());
      assert.equal(res.ok, false);
      assert.ok(res.errors.some((e) => e.includes('idle_expansion_result.kind')));
    });
  });

  describe('idle expansion history summary helper', () => {
    it('summarizes new intake intents without retaining raw charter text', () => {
      const summary = summarizeIdleExpansionResult(makeIdleExpansionTurnResult());
      assert.deepEqual(summary, {
        kind: 'new_intake_intent',
        expansion_iteration: 2,
        new_intent_title: 'Harden policy-backed next-objective selection',
        priority: 'p1',
        template: 'generic',
      });
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

    it('rejects blank verification command declarations', () => {
      writeStagedResult(makeValidTurnResult({
        verification: {
          status: 'pass',
          commands: ['   '],
          machine_evidence: [{ command: '', exit_code: 0 }],
        },
      }));
      const res = validateStagedTurnResult(TMP_ROOT, makeState(), makeConfig());
      assert.equal(res.ok, false);
      assert.equal(res.stage, 'verification');
      assert.equal(res.error_class, 'verification_error');
      assert.ok(res.errors.some((e) => e.includes('verification.commands[0]') && e.includes('non-empty string')));
      assert.ok(res.errors.some((e) => e.includes('verification.machine_evidence[0].command') && e.includes('non-empty string')));
    });

    it('rejects duplicate verification.produced_files paths', () => {
      writeStagedResult(makeValidTurnResult({
        verification: {
          status: 'pass',
          machine_evidence: [{ command: 'npm test', exit_code: 0 }],
          produced_files: [
            { path: 'tests/fixtures/out.json', disposition: 'artifact' },
            { path: 'tests/fixtures/out.json', disposition: 'ignore' },
          ],
        },
      }));
      const res = validateStagedTurnResult(TMP_ROOT, makeState(), makeConfig());
      assert.equal(res.ok, false);
      assert.equal(res.stage, 'verification');
      assert.equal(res.error_class, 'verification_error');
      assert.ok(res.errors.some((e) => e.includes('duplicates "tests/fixtures/out.json"')));
    });

    it('rejects ignore produced_files that also appear in files_changed', () => {
      writeStagedResult(makeValidTurnResult({
        files_changed: ['tests/fixtures/out.json'],
        verification: {
          status: 'pass',
          machine_evidence: [{ command: 'npm test', exit_code: 0 }],
          produced_files: [
            { path: 'tests/fixtures/out.json', disposition: 'ignore' },
          ],
        },
      }));
      const res = validateStagedTurnResult(TMP_ROOT, makeState(), makeConfig());
      assert.equal(res.ok, false);
      assert.equal(res.stage, 'verification');
      assert.equal(res.error_class, 'verification_error');
      assert.ok(res.errors.some((e) => e.includes('also listed in files_changed')));
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

    it('rejects proposed_next_role not in routing allowlist when the turn is not a completed forward-progress turn', () => {
      writeStagedResult(makeValidTurnResult({ status: 'needs_human', proposed_next_role: 'pm' }));
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

    it('rejects invalid phase_transition_request when the turn is not a completed forward-progress turn', () => {
      writeStagedResult(makeValidTurnResult({ status: 'needs_human', phase_transition_request: 'release' }));
      const res = validateStagedTurnResult(TMP_ROOT, makeState(), makeConfig());
      assert.equal(res.ok, false);
      assert.equal(res.error_class, 'protocol_error');
      assert.ok(res.errors.some(e => e.includes('phase_transition_request')));
    });

    it('AT-CP-004: rejects phase_transition_request that skips a declared custom phase', () => {
      const config = makeConfig();
      config.roles.architect = {
        title: 'Architect',
        mandate: 'Design the system.',
        write_authority: 'review_only',
        runtime_class: 'manual',
        runtime_id: 'manual-architect',
      };
      config.runtimes['manual-architect'] = { type: 'manual' };
      config.routing = {
        planning: { entry_role: 'pm', allowed_next_roles: ['pm', 'architect', 'human'], exit_gate: 'planning_signoff' },
        design: { entry_role: 'architect', allowed_next_roles: ['architect', 'dev', 'human'], exit_gate: 'design_review' },
        implementation: { entry_role: 'dev', allowed_next_roles: ['dev', 'qa', 'human'], exit_gate: 'implementation_complete' },
        qa: { entry_role: 'qa', allowed_next_roles: ['dev', 'qa', 'human'], exit_gate: 'qa_ship_verdict' },
      };
      config.gates.design_review = { requires_files: ['.planning/DESIGN_REVIEW.md'] };

      const state = makeState({
        phase: 'planning',
        current_turn: {
          turn_id: 'turn-0004',
          assigned_role: 'pm',
          status: 'running',
          attempt: 1,
          runtime_id: 'manual-pm',
        },
      });
      const tr = makeValidTurnResult({
        role: 'pm',
        runtime_id: 'manual-pm',
        files_changed: [],
        artifact: { type: 'review', ref: null },
        objections: [{ id: 'OBJ-001', severity: 'low', statement: 'Scope is acceptable.', status: 'raised' }],
        proposed_next_role: 'human',
        phase_transition_request: 'implementation',
      });

      writeStagedResult(tr);
      const res = validateStagedTurnResult(TMP_ROOT, state, config);
      assert.equal(res.ok, false);
      assert.equal(res.stage, 'protocol');
      assert.equal(res.error_class, 'protocol_error');
      assert.ok(res.errors.some(e => e.includes('next phase is "design"')));
    });

    it('allows valid phase_transition_request', () => {
      writeStagedResult(makeValidTurnResult({ phase_transition_request: 'qa' }));
      const res = validateStagedTurnResult(TMP_ROOT, makeState(), makeConfig());
      assert.equal(res.ok, true);
    });

    it('AT-CP-008: rejects phase_transition_request in the final phase', () => {
      const tr = makeValidTurnResult({
        role: 'qa',
        runtime_id: 'api-qa',
        status: 'needs_human',
        files_changed: [],
        artifact: { type: 'review', ref: null },
        objections: [{ id: 'OBJ-001', severity: 'medium', statement: 'Final phase must use run completion.', status: 'raised' }],
        proposed_next_role: 'human',
        phase_transition_request: 'planning',
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
      assert.ok(res.errors.some(e => e.includes('use run_completion_request instead')));
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
      assert.ok(corrections.some((c) => c.includes('run_completion_request')));
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

    // ── Terminal completion signaling (Rule 3) ────────────────────────────

    it('AT-TCS-002: normalizes review_only terminal needs_human with affirmative reason to run_completion_request', () => {
      const tr = makeValidTurnResult({
        status: 'needs_human',
        needs_human_reason: 'All checks pass. Human should approve the release for shipping.',
        run_completion_request: null,
      });
      const ctx = { writeAuthority: 'review_only', phase: 'qa' };
      const { normalized, corrections } = normalizeTurnResult(tr, makeConfig(), ctx);
      assert.equal(normalized.status, 'completed');
      assert.equal(normalized.run_completion_request, true);
      assert.equal(normalized.needs_human_reason, undefined);
      assert.ok(corrections.some((c) => c.includes('run_completion_request')));
    });

    it('AT-TCS-003: does NOT normalize when reason contains blocker keywords', () => {
      const tr = makeValidTurnResult({
        status: 'needs_human',
        needs_human_reason: 'Critical security vulnerability found in auth module. Cannot ship.',
        run_completion_request: null,
      });
      const ctx = { writeAuthority: 'review_only', phase: 'qa' };
      const { normalized, corrections } = normalizeTurnResult(tr, makeConfig(), ctx);
      assert.equal(normalized.status, 'needs_human');
      assert.equal(normalized.run_completion_request, null);
      assert.equal(normalized.needs_human_reason, tr.needs_human_reason);
      assert.equal(corrections.length, 0);
    });

    it('AT-TCS-004: does NOT normalize for non-review_only roles', () => {
      const tr = makeValidTurnResult({
        status: 'needs_human',
        needs_human_reason: 'Human should approve release.',
        run_completion_request: null,
      });
      const ctx = { writeAuthority: 'authoritative', phase: 'qa' };
      const { normalized, corrections } = normalizeTurnResult(tr, makeConfig(), ctx);
      assert.equal(normalized.status, 'needs_human');
      assert.equal(corrections.length, 0);
    });

    it('AT-TCS-005: normalizes review_only needs_human to phase_transition on non-terminal phases with affirmative reason', () => {
      const tr = makeValidTurnResult({
        status: 'needs_human',
        needs_human_reason: 'Ready to ship, human should approve.',
        run_completion_request: null,
      });
      const ctx = { writeAuthority: 'review_only', phase: 'implementation' };
      const { normalized, corrections } = normalizeTurnResult(tr, makeConfig(), ctx);
      assert.equal(normalized.status, 'completed');
      assert.equal(normalized.phase_transition_request, 'qa');
      assert.ok(corrections.length > 0, 'should have corrections');
      assert.ok(corrections[0].includes('phase_transition_request'));
    });

    it('AT-TCS-005b: does NOT normalize review_only needs_human on non-terminal phase with blocker reason', () => {
      const tr = makeValidTurnResult({
        status: 'needs_human',
        needs_human_reason: 'Critical security vulnerability found, cannot proceed.',
        run_completion_request: null,
      });
      const ctx = { writeAuthority: 'review_only', phase: 'implementation' };
      const { normalized, corrections } = normalizeTurnResult(tr, makeConfig(), ctx);
      assert.equal(normalized.status, 'needs_human');
      assert.equal(corrections.length, 0);
    });

    it('AT-TCS-006: does NOT normalize when run_completion_request is explicitly false', () => {
      const tr = makeValidTurnResult({
        status: 'needs_human',
        needs_human_reason: 'Human should approve and ship.',
        run_completion_request: false,
      });
      const ctx = { writeAuthority: 'review_only', phase: 'qa' };
      const { normalized, corrections } = normalizeTurnResult(tr, makeConfig(), ctx);
      assert.equal(normalized.status, 'needs_human');
      assert.equal(corrections.length, 0);
    });

    it('AT-TCS-007: does NOT normalize when reason is ambiguous (no affirmative signals)', () => {
      const tr = makeValidTurnResult({
        status: 'needs_human',
        needs_human_reason: 'Requires manual verification of the deployment.',
        run_completion_request: null,
      });
      const ctx = { writeAuthority: 'review_only', phase: 'qa' };
      const { normalized, corrections } = normalizeTurnResult(tr, makeConfig(), ctx);
      assert.equal(normalized.status, 'needs_human');
      assert.equal(corrections.length, 0);
    });

    it('AT-NORM-007: infers next phase for completed non-terminal turn with no lifecycle signal', () => {
      const tr = makeValidTurnResult({
        status: 'completed',
        phase_transition_request: null,
        run_completion_request: null,
      });
      const ctx = { phase: 'planning', assignedRole: 'pm', writeAuthority: 'review_only' };
      const { normalized, corrections } = normalizeTurnResult(tr, makeConfig(), ctx);
      assert.equal(normalized.phase_transition_request, 'implementation');
      assert.equal(normalized.run_completion_request, null);
      assert.ok(corrections.some((c) => c.includes('inferred next phase "implementation"')));
    });

    it('AT-NORM-008: infers run completion for completed terminal turn with no lifecycle signal', () => {
      const tr = makeValidTurnResult({
        role: 'qa',
        runtime_id: 'api-qa',
        status: 'completed',
        phase_transition_request: null,
        run_completion_request: null,
        proposed_next_role: 'qa',
      });
      const ctx = { phase: 'qa', assignedRole: 'qa', writeAuthority: 'review_only' };
      const { normalized, corrections } = normalizeTurnResult(tr, makeConfig(), ctx);
      assert.equal(normalized.phase_transition_request, null);
      assert.equal(normalized.run_completion_request, true);
      assert.equal(normalized.proposed_next_role, 'human');
      assert.ok(corrections.some((c) => c.includes('completed terminal phase "qa"')));
      assert.ok(corrections.some((c) => c.includes('corrected to "human"')));
    });

    it('AT-NORM-009: corrects self or backward phase transition to the next forward phase', () => {
      const tr = makeValidTurnResult({
        status: 'completed',
        phase_transition_request: 'planning',
        run_completion_request: null,
      });
      const ctx = { phase: 'planning', assignedRole: 'pm', writeAuthority: 'review_only' };
      const { normalized, corrections } = normalizeTurnResult(tr, makeConfig(), ctx);
      assert.equal(normalized.phase_transition_request, 'implementation');
      assert.equal(normalized.run_completion_request, null);
      assert.ok(corrections.some((c) => c.includes('corrected "planning" to forward phase "implementation"')));
    });

    it('AT-NORM-010: corrects routing-illegal proposed_next_role to an allowed fallback', () => {
      const tr = makeValidTurnResult({
        status: 'completed',
        proposed_next_role: 'hallucinated-role',
      });
      const ctx = { phase: 'planning', assignedRole: 'pm', writeAuthority: 'review_only' };
      const { normalized, corrections } = normalizeTurnResult(tr, makeConfig(), ctx);
      assert.equal(normalized.proposed_next_role, 'human');
      assert.ok(corrections.some((c) => c.includes('hallucinated-role')));
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

    it('AT-TCS-008: terminal review_only needs_human passes full validator pipeline via normalization', () => {
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
        status: 'needs_human',
        needs_human_reason: 'No blockers found. Human should approve and ship the release.',
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
          { id: 'OBJ-001', severity: 'low', against_turn_id: 'turn-0003', statement: 'Minor observation.', status: 'raised' },
        ],
      });
      writeStagedResult(tr);
      const res = validateStagedTurnResult(TMP_ROOT, qaState, makeConfig());
      assert.equal(res.ok, true, `Expected ok but got errors: ${res.errors?.join(', ')}`);
      assert.equal(res.turnResult.status, 'completed');
      assert.equal(res.turnResult.run_completion_request, true);
      assert.ok(res.warnings.some((w) => w.includes('review_only terminal')));
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

  // ── AT-DPT-003: Reject unfilled template placeholders ──────────────────────

  describe('template placeholder rejection', () => {
    beforeEach(setup);
    afterEach(teardown);

    it('rejects summary containing an angle-bracket placeholder (AT-DPT-003)', () => {
      const tr = makeValidTurnResult({ summary: '<one-line summary of what you accomplished>' });
      writeStagedResult(tr);
      const res = validateStagedTurnResult(TMP_ROOT, makeState(), makeConfig());
      assert.equal(res.ok, false);
      assert.ok(res.errors.some((e) => e.includes('summary') && e.includes('placeholder')));
    });

    it('rejects proposed_next_role containing an angle-bracket placeholder (AT-DPT-003)', () => {
      const tr = makeValidTurnResult({ proposed_next_role: '<role_id that should act next>' });
      writeStagedResult(tr);
      const res = validateStagedTurnResult(TMP_ROOT, makeState(), makeConfig());
      assert.equal(res.ok, false);
      assert.ok(res.errors.some((e) => e.includes('proposed_next_role') && e.includes('placeholder')));
    });

    it('rejects decision placeholders in statement and rationale (AT-TRPV-001)', () => {
      const tr = makeValidTurnResult({
        decisions: [
          {
            id: 'DEC-001',
            category: 'implementation',
            statement: '<what was decided and why it matters>',
            rationale: '<reasoning behind this decision>',
          },
        ],
      });
      writeStagedResult(tr);
      const res = validateStagedTurnResult(TMP_ROOT, makeState(), makeConfig());
      assert.equal(res.ok, false);
      assert.ok(res.errors.some((e) => e.includes('decisions[0].statement') && e.includes('placeholder')));
      assert.ok(res.errors.some((e) => e.includes('decisions[0].rationale') && e.includes('placeholder')));
    });

    it('rejects objection placeholders in against_turn_id and statement (AT-TRPV-002)', () => {
      const tr = makeValidTurnResult({
        role: 'qa',
        runtime_id: 'api-qa',
        files_changed: [],
        artifact: { type: 'review', ref: null },
        objections: [
          {
            id: 'OBJ-001',
            severity: 'medium',
            against_turn_id: '<turn_id of the turn you are reviewing>',
            statement: '<specific objection to the previous turn — required for review_only roles>',
            status: 'raised',
          },
        ],
      });
      const state = makeState({
        phase: 'qa',
        current_turn: { turn_id: 'turn-0004', assigned_role: 'qa', status: 'running', attempt: 1, runtime_id: 'api-qa' },
      });
      writeStagedResult(tr);
      const res = validateStagedTurnResult(TMP_ROOT, state, makeConfig());
      assert.equal(res.ok, false);
      assert.ok(res.errors.some((e) => e.includes('objections[0].against_turn_id') && e.includes('placeholder')));
      assert.ok(res.errors.some((e) => e.includes('objections[0].statement') && e.includes('placeholder')));
    });

    it('rejects file and verification placeholders (AT-TRPV-003)', () => {
      const tr = makeValidTurnResult({
        files_changed: ['<path/to/modified/file>'],
        verification: {
          status: 'pass',
          commands: ['<command you ran to verify>'],
          evidence_summary: '<what you verified and how>',
          machine_evidence: [{ command: '<exact command that was run>', exit_code: 0 }],
        },
      });
      writeStagedResult(tr);
      const res = validateStagedTurnResult(TMP_ROOT, makeState(), makeConfig());
      assert.equal(res.ok, false);
      assert.ok(res.errors.some((e) => e.includes('files_changed[0]') && e.includes('placeholder')));
      assert.ok(res.errors.some((e) => e.includes('verification.commands[0]') && e.includes('placeholder')));
      assert.ok(res.errors.some((e) => e.includes('verification.evidence_summary') && e.includes('placeholder')));
      assert.ok(res.errors.some((e) => e.includes('verification.machine_evidence[0].command') && e.includes('placeholder')));
    });

    it('accepts real values that happen to contain angle brackets in the middle (AT-TRPV-004)', () => {
      const tr = makeValidTurnResult({ summary: 'Fixed <Config> parsing bug in loader' });
      tr.decisions[0].statement = 'Retained <Config> parser compatibility for v1.';
      tr.decisions[0].rationale = 'Avoided breaking <legacy> consumers.';
      tr.files_changed = ['docs/<draft>-notes.md'];
      tr.verification = {
        status: 'pass',
        commands: ['echo "checked <dev> path"'],
        evidence_summary: 'Verified <Config> handling without copying the scaffold.',
        machine_evidence: [{ command: 'printf "<ok>\\n"', exit_code: 0 }],
      };
      writeStagedResult(tr);
      const res = validateStagedTurnResult(TMP_ROOT, makeState(), makeConfig());
      assert.equal(res.ok, true, `Expected ok but got: ${res.errors.join(', ')}`);
    });
  });

  // ─── Authoritative + review artifact type mismatch (AT-AUTH-REV) ──────────

  describe('authoritative review artifact type mismatch', () => {
    it('rejects authoritative role using artifact.type "review" with product files_changed (AT-AUTH-REV-001)', () => {
      const tr = makeValidTurnResult({
        artifact: { type: 'review', ref: null },
        files_changed: ['src/feature.ts', 'tests/feature.test.ts'],
      });
      writeStagedResult(tr);
      const res = validateStagedTurnResult(TMP_ROOT, makeState(), makeConfig());
      assert.equal(res.ok, false);
      assert.ok(
        res.errors.some(e => e.includes('authoritative write authority') && e.includes('artifact type is "review"') && e.includes('src/feature.ts')),
        `Expected authoritative+review mismatch error but got: ${res.errors.join('; ')}`
      );
    });

    it('allows authoritative role using artifact.type "review" with only review-path files (AT-AUTH-REV-002)', () => {
      const tr = makeValidTurnResult({
        artifact: { type: 'review', ref: null },
        files_changed: ['.planning/PM_SIGNOFF.md', '.agentxchain/reviews/turn_abc-review.md'],
        verification: { status: 'skipped' },
      });
      writeStagedResult(tr);
      const res = validateStagedTurnResult(TMP_ROOT, makeState(), makeConfig());
      // Should not error on the authoritative+review check (review-only paths are exempt)
      const mismatchErrors = res.errors.filter(e => e.includes('authoritative write authority') && e.includes('artifact type is "review"'));
      assert.equal(mismatchErrors.length, 0, `Unexpected mismatch error: ${mismatchErrors.join('; ')}`);
    });

    it('allows authoritative role using artifact.type "review" with empty files_changed (AT-AUTH-REV-003)', () => {
      const tr = makeValidTurnResult({
        artifact: { type: 'review', ref: null },
        files_changed: [],
        verification: { status: 'skipped' },
      });
      writeStagedResult(tr);
      const res = validateStagedTurnResult(TMP_ROOT, makeState(), makeConfig());
      const mismatchErrors = res.errors.filter(e => e.includes('authoritative write authority') && e.includes('artifact type is "review"'));
      assert.equal(mismatchErrors.length, 0, `Unexpected mismatch error: ${mismatchErrors.join('; ')}`);
    });

    it('rejects authoritative role using artifact.type "review" with mixed review-path and product files (AT-AUTH-REV-004)', () => {
      const tr = makeValidTurnResult({
        artifact: { type: 'review', ref: null },
        files_changed: ['.planning/notes.md', 'src/main.ts'],
      });
      writeStagedResult(tr);
      const res = validateStagedTurnResult(TMP_ROOT, makeState(), makeConfig());
      assert.equal(res.ok, false);
      assert.ok(
        res.errors.some(e => e.includes('authoritative write authority') && e.includes('src/main.ts')),
        `Expected mismatch error mentioning product file but got: ${res.errors.join('; ')}`
      );
    });
  });

  // ─── BUG-82: authoritative role routing-illegal proposed_next_role normalization ─
  describe('BUG-82: authoritative role routing-illegal proposed_next_role normalization', () => {
    it('auto-normalizes authoritative dev proposing "qa" in planning phase to a routing-legal role (BUG-82-001)', () => {
      // Scenario: BUG-81 gate auto-strip keeps session in planning phase.
      // Dev is dispatched in planning, does work, proposes "qa" as next role.
      // "qa" is not in planning's allowed_next_roles: ['pm', 'human'].
      const tr = makeValidTurnResult({
        proposed_next_role: 'qa',
      });
      const state = makeState({
        phase: 'planning',
        current_turn: {
          turn_id: 'turn-0004',
          assigned_role: 'dev',
          status: 'running',
          attempt: 1,
          runtime_id: 'local-dev',
        },
      });
      writeStagedResult(tr);
      const res = validateStagedTurnResult(TMP_ROOT, state, makeConfig());
      assert.equal(res.ok, true, `Expected ok but got errors: ${res.errors.join(', ')}`);
      // The normalized proposed_next_role should be a planning-legal role (pm, not dev since dev is assigned)
      assert.equal(res.turnResult.proposed_next_role, 'pm');
      assert.ok(
        res.warnings.some(w => w.includes('[normalized]') && w.includes('proposed_next_role') && w.includes('qa') && w.includes('pm')),
        `Expected normalization warning but got: ${res.warnings.join('; ')}`
      );
    });

    it('does not normalize when proposed_next_role is already routing-legal (BUG-82-002)', () => {
      // Dev in implementation phase proposes "qa" — this is legal, no normalization
      const tr = makeValidTurnResult({
        proposed_next_role: 'qa',
      });
      writeStagedResult(tr);
      const res = validateStagedTurnResult(TMP_ROOT, makeState(), makeConfig());
      assert.equal(res.ok, true);
      assert.equal(res.turnResult.proposed_next_role, 'qa');
      const normWarnings = res.warnings.filter(w => w.includes('[normalized]') && w.includes('proposed_next_role'));
      assert.equal(normWarnings.length, 0, `Unexpected normalization: ${normWarnings.join('; ')}`);
    });

    it('does not normalize "human" even if not in allowed_next_roles (BUG-82-003)', () => {
      // "human" is always a valid escape hatch
      const tr = makeValidTurnResult({
        proposed_next_role: 'human',
      });
      const state = makeState({
        phase: 'planning',
        current_turn: {
          turn_id: 'turn-0004',
          assigned_role: 'dev',
          status: 'running',
          attempt: 1,
          runtime_id: 'local-dev',
        },
      });
      writeStagedResult(tr);
      const res = validateStagedTurnResult(TMP_ROOT, state, makeConfig());
      assert.equal(res.ok, true);
      assert.equal(res.turnResult.proposed_next_role, 'human');
    });
  });
});
