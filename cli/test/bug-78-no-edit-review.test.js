import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { validateStagedTurnResult, normalizeTurnResult, STAGING_PATH } from '../src/lib/turn-result-validator.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

const TMP_ROOT = join(import.meta.dirname, '.tmp-bug-78-test');

function makeConfig() {
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
  };
}

function makeNoEditTurnResult(overrides = {}) {
  return {
    schema_version: '1.0',
    run_id: 'run_01H',
    turn_id: 'turn-0004',
    role: 'dev',
    runtime_id: 'local-dev',
    status: 'completed',
    summary: 'Reviewed planning artifacts, no code changes needed.',
    decisions: [],
    objections: [],
    files_changed: [],
    artifacts_created: [],
    verification: {
      status: 'pass',
      commands: ['echo ok'],
      evidence_summary: 'Review-only turn.',
      machine_evidence: [{ command: 'echo ok', exit_code: 0 }],
    },
    artifact: {
      type: 'workspace',
      ref: 'git:abc123',
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

// ── BUG-78: No-edit review turn normalization ─────────────────────────────────

describe('BUG-78: no-edit review turn normalization', () => {
  // AT-WK-001: Completed turn with workspace+empty files_changed auto-normalizes to review
  it('AT-WK-001: completed workspace + empty files_changed normalizes to review', () => {
    const tr = makeNoEditTurnResult();
    const ctx = { phase: 'implementation', assignedRole: 'dev', writeAuthority: 'authoritative' };
    const { normalized, normalizationEvents } = normalizeTurnResult(tr, makeConfig(), ctx);

    assert.equal(normalized.artifact.type, 'review');
    const event = normalizationEvents.find(e => e.field === 'artifact.type');
    assert.ok(event, 'normalization event should be recorded');
    assert.equal(event.original_value, 'workspace');
    assert.equal(event.normalized_value, 'review');
    assert.equal(event.rationale, 'empty_files_changed_no_repo_mutation_declared');
  });

  // AT-WK-002: Completed turn with workspace+non-empty files_changed is NOT normalized
  it('AT-WK-002: completed workspace + non-empty files_changed is NOT normalized', () => {
    const tr = makeNoEditTurnResult({
      files_changed: ['src/feature.ts'],
    });
    const ctx = { phase: 'implementation', assignedRole: 'dev', writeAuthority: 'authoritative' };
    const { normalized, normalizationEvents } = normalizeTurnResult(tr, makeConfig(), ctx);

    assert.equal(normalized.artifact.type, 'workspace');
    const event = normalizationEvents.find(e => e.field === 'artifact.type' && e.rationale === 'empty_files_changed_no_repo_mutation_declared');
    assert.equal(event, undefined, 'no workspace→review normalization event should exist');
  });

  // AT-WK-003: Failed turn with workspace+empty files_changed is NOT normalized (status guard)
  it('AT-WK-003: failed workspace + empty files_changed is NOT normalized', () => {
    const tr = makeNoEditTurnResult({ status: 'failed' });
    const ctx = { phase: 'implementation', assignedRole: 'dev', writeAuthority: 'authoritative' };
    const { normalized, normalizationEvents } = normalizeTurnResult(tr, makeConfig(), ctx);

    // Rule 0a should NOT fire for failed status — artifact stays workspace
    assert.equal(normalized.artifact.type, 'workspace');
    const event = normalizationEvents.find(e => e.field === 'artifact.type' && e.rationale === 'empty_files_changed_no_repo_mutation_declared');
    assert.equal(event, undefined, 'no workspace→review normalization event should exist for failed turns');
  });

  // AT-WK-004: Blocked turn with workspace+empty files_changed is NOT normalized (status guard)
  it('AT-WK-004: blocked workspace + empty files_changed is NOT normalized', () => {
    const tr = makeNoEditTurnResult({ status: 'blocked' });
    const ctx = { phase: 'implementation', assignedRole: 'dev', writeAuthority: 'authoritative' };
    const { normalized, normalizationEvents } = normalizeTurnResult(tr, makeConfig(), ctx);

    assert.equal(normalized.artifact.type, 'workspace');
    const event = normalizationEvents.find(e => e.field === 'artifact.type' && e.rationale === 'empty_files_changed_no_repo_mutation_declared');
    assert.equal(event, undefined, 'no workspace→review normalization event should exist for blocked turns');
  });

  // AT-WK-005: Completed turn with workspace+empty files_changed but checkpointable produced_files is NOT normalized
  it('AT-WK-005: completed workspace + empty files + checkpointable produced_files is NOT normalized', () => {
    const tr = makeNoEditTurnResult({
      verification: {
        status: 'pass',
        commands: ['echo ok'],
        evidence_summary: 'Has artifacts.',
        machine_evidence: [{ command: 'echo ok', exit_code: 0 }],
        produced_files: [{ path: 'coverage/report.html', disposition: 'artifact' }],
      },
    });
    const ctx = { phase: 'implementation', assignedRole: 'dev', writeAuthority: 'authoritative' };
    const { normalized, normalizationEvents } = normalizeTurnResult(tr, makeConfig(), ctx);

    assert.equal(normalized.artifact.type, 'workspace');
    const event = normalizationEvents.find(e => e.field === 'artifact.type' && e.rationale === 'empty_files_changed_no_repo_mutation_declared');
    assert.equal(event, undefined, 'no workspace→review normalization event should exist when produced_files has artifacts');
  });

  // AT-WK-007: Completed no-edit authoritative turn in implementation phase —
  // Rule 0a normalizes workspace→review (BUG-78 fix), but implementation-phase guard
  // independently rejects because no product code changes in files_changed.
  // This documents that normalization and the implementation guard are separate constraints.
  it('AT-WK-007: implementation-phase guard rejects completed no-edit authoritative turn even after normalization', () => {
    rmSync(TMP_ROOT, { recursive: true, force: true });
    mkdirSync(join(TMP_ROOT, '.agentxchain', 'staging'), { recursive: true });

    const tr = makeNoEditTurnResult({
      role: 'dev',
      runtime_id: 'local-dev',
      proposed_next_role: 'qa',
    });
    writeFileSync(
      join(TMP_ROOT, STAGING_PATH),
      JSON.stringify(tr, null, 2),
      'utf8',
    );

    const state = makeState({
      phase: 'implementation',
      current_turn: {
        turn_id: 'turn-0004',
        assigned_role: 'dev',
        status: 'running',
        attempt: 1,
        runtime_id: 'local-dev',
      },
    });
    const config = makeConfig();
    const result = validateStagedTurnResult(TMP_ROOT, state, config);

    assert.equal(result.ok, false, 'Should fail: implementation guard rejects no-product-code completion');
    assert.ok(
      result.errors.some(e => e.includes('without product code changes')),
      `Expected implementation-phase guard error, got: ${JSON.stringify(result.errors)}`
    );

    rmSync(TMP_ROOT, { recursive: true, force: true });
  });

  // AT-WK-006: Full validation pipeline: completed no-edit turn passes Stage C after normalization
  // Uses qa role in qa phase — the realistic BUG-78 scenario (review-only role doing no-edit analysis)
  it('AT-WK-006: full pipeline — completed no-edit QA turn passes Stage C after normalization', () => {
    rmSync(TMP_ROOT, { recursive: true, force: true });
    mkdirSync(join(TMP_ROOT, '.agentxchain', 'staging'), { recursive: true });

    const tr = makeNoEditTurnResult({
      role: 'qa',
      runtime_id: 'api-qa',
      proposed_next_role: 'dev',
      objections: [{ id: 'OBJ-001', severity: 'low', statement: 'Minor style issue.' }],
    });
    writeFileSync(
      join(TMP_ROOT, STAGING_PATH),
      JSON.stringify(tr, null, 2),
      'utf8',
    );

    const state = makeState({
      phase: 'qa',
      current_turn: {
        turn_id: 'turn-0004',
        assigned_role: 'qa',
        status: 'running',
        attempt: 1,
        runtime_id: 'api-qa',
      },
      phase_gate_status: {
        planning_signoff: 'passed',
        implementation_complete: 'passed',
        qa_ship_verdict: 'pending',
      },
    });
    const config = makeConfig();
    const result = validateStagedTurnResult(TMP_ROOT, state, config);

    // The turn should pass all validation stages (normalization corrects workspace→review before Stage C)
    assert.equal(result.ok, true, `Expected validation to pass, got errors: ${JSON.stringify(result.errors)}`);

    rmSync(TMP_ROOT, { recursive: true, force: true });
  });
});
