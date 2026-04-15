/**
 * Acceptance tests for workflow-kit remote accountability.
 * Per WORKFLOW_KIT_REMOTE_ACCOUNTABILITY_SPEC.md (AT-WKRA-001 through AT-WKRA-009).
 *
 * Resolves the contract gap: review_only non-writing runtimes that own
 * workflow-kit artifacts must receive attestation-scoped prompt guidance,
 * not production-scoped guidance.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';

import { writeDispatchBundle } from '../src/lib/dispatch-bundle.js';
import {
  initializeGovernedRun,
  assignGovernedTurn,
  normalizeGovernedStateShape,
  getActiveTurn,
  STATE_PATH,
} from '../src/lib/governed-state.js';
import { scaffoldGoverned } from '../src/commands/init.js';
import { validateWorkflowKitConfig } from '../src/lib/normalized-config.js';

function makeTmpDir() {
  const dir = join(tmpdir(), `axc-wkra-test-${randomBytes(6).toString('hex')}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function readState(root) {
  const parsed = JSON.parse(readFileSync(join(root, STATE_PATH), 'utf8'));
  const normalized = normalizeGovernedStateShape(parsed).state;
  Object.defineProperty(normalized, 'current_turn', {
    configurable: true,
    enumerable: false,
    get() { return getActiveTurn(normalized); },
  });
  return normalized;
}

function makeConfig(workflowKitOverride) {
  return {
    schema_version: 4,
    protocol_mode: 'governed',
    project: { id: 'test-wkra', name: 'Test WKRA', default_branch: 'main' },
    roles: {
      pm: { title: 'PM', mandate: 'Protect user value.', write_authority: 'review_only', runtime_class: 'manual', runtime_id: 'manual-pm' },
      dev: { title: 'Developer', mandate: 'Build.', write_authority: 'authoritative', runtime_class: 'manual', runtime_id: 'manual-dev' },
      architect: { title: 'Architect', mandate: 'Design.', write_authority: 'review_only', runtime_class: 'manual', runtime_id: 'manual-architect' },
      qa: { title: 'QA', mandate: 'Challenge.', write_authority: 'review_only', runtime_class: 'manual', runtime_id: 'manual-qa' },
      proposer: { title: 'Proposer', mandate: 'Propose.', write_authority: 'proposed', runtime_class: 'manual', runtime_id: 'manual-proposer' },
    },
    runtimes: {
      'manual-pm': { type: 'manual' },
      'manual-dev': { type: 'manual' },
      'manual-architect': { type: 'manual' },
      'manual-qa': { type: 'manual' },
      'manual-proposer': { type: 'manual' },
    },
    routing: {
      planning: { entry_role: 'pm', allowed_next_roles: ['pm', 'dev', 'architect'], exit_gate: 'planning_signoff' },
      implementation: { entry_role: 'dev', allowed_next_roles: ['dev', 'qa', 'proposer'], exit_gate: 'impl_complete' },
      qa: { entry_role: 'qa', allowed_next_roles: ['qa'], exit_gate: 'qa_verdict' },
    },
    gates: {
      planning_signoff: { requires_files: ['.planning/PM_SIGNOFF.md'] },
      impl_complete: { requires_verification_pass: true },
      qa_verdict: { requires_files: ['.planning/ship-verdict.md'] },
    },
    budget: { per_turn_max_usd: 2.0, per_run_max_usd: 50.0 },
    rules: { challenge_required: true, max_turn_retries: 2, max_deadlock_cycles: 2 },
    prompts: {},
    files: { talk: 'TALK.md', history: '.agentxchain/history.jsonl', state: '.agentxchain/state.json' },
    compat: { next_owner_source: 'state-json', lock_based_coordination: false, original_version: 4 },
    workflow_kit: workflowKitOverride,
  };
}

function getPromptMd(root, state) {
  const turnDir = join(root, '.agentxchain/dispatch/turns', state.current_turn.turn_id);
  return readFileSync(join(turnDir, 'PROMPT.md'), 'utf8');
}

// ── Config Validation Tests ──────────────────────────────────────────────────

describe('workflow-kit remote accountability — config validation', () => {
  const roles = {
    pm: { title: 'PM', mandate: 'Protect.', write_authority: 'review_only' },
    dev: { title: 'Dev', mandate: 'Build.', write_authority: 'authoritative' },
    architect: { title: 'Arch', mandate: 'Design.', write_authority: 'review_only' },
    proposer: { title: 'Proposer', mandate: 'Propose.', write_authority: 'proposed' },
  };
  const routing = {
    planning: { entry_role: 'pm', allowed_next_roles: ['pm', 'architect'] },
    implementation: { entry_role: 'dev', allowed_next_roles: ['dev'] },
  };

  it('AT-WKRA-001: warning when review_only role owns required artifact and no authoritative/proposed role in phase', () => {
    // planning phase has only pm (review_only) and architect (review_only) — no writer
    const wk = {
      phases: {
        planning: {
          artifacts: [
            { path: '.planning/SPEC.md', required: true, owned_by: 'architect' },
          ],
        },
      },
    };
    const result = validateWorkflowKitConfig(wk, routing, roles);
    assert.ok(result.ok, 'should not be a hard error');
    assert.ok(
      result.warnings.some(w => w.includes('architect') && w.includes('planning') && w.includes('reachable workflow ownership path')),
      `expected warning about unreachable ownership with no writer in phase, got: ${JSON.stringify(result.warnings)}`,
    );
  });

  it('AT-WKRA-002: no warning when review_only role owns artifact but authoritative role exists in phase', () => {
    // implementation phase has dev (authoritative) — there is a writer
    const wk = {
      phases: {
        implementation: {
          artifacts: [
            { path: '.planning/REVIEW.md', required: true, owned_by: 'pm' },
          ],
        },
      },
    };
    // pm is review_only but dev (authoritative) is in implementation via routing
    const routingWithPm = {
      ...routing,
      implementation: { entry_role: 'dev', allowed_next_roles: ['dev', 'pm'] },
    };
    const result = validateWorkflowKitConfig(wk, routingWithPm, roles);
    assert.ok(result.ok, 'should validate without error');
    assert.ok(
      !result.warnings.some(w => w.includes('review_only')),
      `should have no review_only ownership warning, got: ${JSON.stringify(result.warnings)}`,
    );
  });

  it('AT-WKRA-003: no warning when authoritative role owns artifact', () => {
    const wk = {
      phases: {
        implementation: {
          artifacts: [
            { path: 'src/main.ts', required: true, owned_by: 'dev' },
          ],
        },
      },
    };
    const result = validateWorkflowKitConfig(wk, routing, roles);
    assert.ok(result.ok, 'should validate without error');
    assert.ok(
      !result.warnings.some(w => w.includes('review_only')),
      `should have no review_only ownership warning, got: ${JSON.stringify(result.warnings)}`,
    );
  });
});

// ── Prompt Guidance Tests ────────────────────────────────────────────────────

describe('workflow-kit remote accountability — prompt guidance', () => {
  let root;

  beforeEach(() => {
    root = makeTmpDir();
    scaffoldGoverned(root, 'test-wkra');
  });

  afterEach(() => {
    try { rmSync(root, { recursive: true, force: true }); } catch {}
  });

  it('AT-WKRA-004: authoritative owner sees "producing" language', () => {
    const config = makeConfig({
      phases: {
        implementation: {
          artifacts: [
            { path: 'src/main.ts', semantics: null, required: true, owned_by: 'dev' },
          ],
        },
      },
    });

    initializeGovernedRun(root, config);
    const rawState = JSON.parse(readFileSync(join(root, STATE_PATH), 'utf8'));
    rawState.phase = 'implementation';
    writeFileSync(join(root, STATE_PATH), JSON.stringify(rawState, null, 2));
    assignGovernedTurn(root, config, 'dev');
    const state = readState(root);
    writeDispatchBundle(root, state, config);
    const prompt = getPromptMd(root, state);

    assert.match(prompt, /## Workflow-Kit Responsibilities/);
    assert.match(prompt, /accountable for producing/i, 'authoritative owner should see "producing" language');
    assert.doesNotMatch(prompt, /reviewing and attesting/i, 'authoritative owner should NOT see attestation language');
  });

  it('AT-WKRA-005: review_only owner sees "reviewing and attesting" language', () => {
    const config = makeConfig({
      phases: {
        planning: {
          artifacts: [
            { path: '.planning/ARCHITECTURE.md', semantics: 'section_check', owned_by: 'architect', required: true, semantics_config: { required_sections: ['Overview'] } },
          ],
        },
      },
    });

    initializeGovernedRun(root, config);
    assignGovernedTurn(root, config, 'architect');
    const state = readState(root);
    writeDispatchBundle(root, state, config);
    const prompt = getPromptMd(root, state);

    assert.match(prompt, /## Workflow-Kit Responsibilities/);
    assert.match(prompt, /reviewing and attesting/i, 'review_only owner should see attestation language');
    assert.match(prompt, /cannot write repo files directly/i, 'review_only owner should see write constraint');
    assert.doesNotMatch(prompt, /accountable for producing/i, 'review_only owner should NOT see "producing" language');
  });

  it('AT-WKRA-006: proposed owner sees "producing" language', () => {
    const config = makeConfig({
      phases: {
        implementation: {
          artifacts: [
            { path: '.planning/PROPOSAL.md', semantics: null, required: true, owned_by: 'proposer' },
          ],
        },
      },
    });

    initializeGovernedRun(root, config);
    const rawState = JSON.parse(readFileSync(join(root, STATE_PATH), 'utf8'));
    rawState.phase = 'implementation';
    writeFileSync(join(root, STATE_PATH), JSON.stringify(rawState, null, 2));
    assignGovernedTurn(root, config, 'proposer');
    const state = readState(root);
    writeDispatchBundle(root, state, config);
    const prompt = getPromptMd(root, state);

    assert.match(prompt, /## Workflow-Kit Responsibilities/);
    assert.match(prompt, /accountable for producing/i, 'proposed owner should see "producing" language');
  });
});

// ── Gate Behavior Tests (verify existing behavior not broken) ────────────────

describe('workflow-kit remote accountability — gate behavior', () => {
  let root;

  beforeEach(() => {
    root = makeTmpDir();
    scaffoldGoverned(root, 'test-wkra');
  });

  afterEach(() => {
    try { rmSync(root, { recursive: true, force: true }); } catch {}
  });

  it('AT-WKRA-007: gate passes when file exists and review_only owner participated', async () => {
    const { evaluatePhaseExit } = await import('../src/lib/gate-evaluator.js');
    const config = makeConfig({
      phases: {
        planning: {
          artifacts: [
            { path: '.planning/SPEC.md', required: true, owned_by: 'architect' },
          ],
        },
      },
    });

    writeFileSync(join(root, '.planning/PM_SIGNOFF.md'), 'Approved: YES\n');
    writeFileSync(join(root, '.planning/SPEC.md'), '# Spec\nContent here.\n');

    const state = {
      run_id: 'test-run',
      phase: 'planning',
      history: [
        { turn_id: 't1', role: 'architect', phase: 'planning', status: 'accepted' },
      ],
    };

    const result = evaluatePhaseExit({
      root,
      state,
      config,
      acceptedTurn: { phase_transition_request: 'implementation' },
    });
    const charterFailures = (result.reasons || []).filter(f => f.includes('requires participation'));
    assert.equal(charterFailures.length, 0, `expected no charter failures, got: ${JSON.stringify(charterFailures)}`);
  });

  it('AT-WKRA-008: gate fails when file is missing regardless of owner write_authority', async () => {
    const { evaluatePhaseExit } = await import('../src/lib/gate-evaluator.js');
    const config = makeConfig({
      phases: {
        planning: {
          artifacts: [
            { path: '.planning/SPEC.md', required: true, owned_by: 'architect' },
          ],
        },
      },
    });

    // PM_SIGNOFF exists but SPEC.md does not
    writeFileSync(join(root, '.planning/PM_SIGNOFF.md'), 'Approved: YES\n');

    const state = {
      run_id: 'test-run',
      phase: 'planning',
      history: [
        { turn_id: 't1', role: 'architect', phase: 'planning', status: 'accepted' },
      ],
    };

    const result = evaluatePhaseExit({
      root,
      state,
      config,
      acceptedTurn: { phase_transition_request: 'implementation' },
    });
    assert.equal(result.passed, false, 'gate should fail');
    const missingFailures = (result.reasons || []).filter(f => f.toLowerCase().includes('missing'));
    assert.ok(missingFailures.length > 0, `expected gate failure for missing required file, got: ${JSON.stringify(result.reasons)}`);
  });

  it('AT-WKRA-009: gate fails when review_only owner did not participate', async () => {
    const { evaluatePhaseExit } = await import('../src/lib/gate-evaluator.js');
    const config = makeConfig({
      phases: {
        planning: {
          artifacts: [
            { path: '.planning/SPEC.md', required: true, owned_by: 'architect' },
          ],
        },
      },
    });

    writeFileSync(join(root, '.planning/PM_SIGNOFF.md'), 'Approved: YES\n');
    writeFileSync(join(root, '.planning/SPEC.md'), '# Spec\nContent here.\n');

    // architect never participated — only pm did
    const state = {
      run_id: 'test-run',
      phase: 'planning',
      history: [
        { turn_id: 't1', role: 'pm', phase: 'planning', status: 'accepted' },
      ],
    };

    const result = evaluatePhaseExit({
      root,
      state,
      config,
      acceptedTurn: { phase_transition_request: 'implementation' },
    });
    const charterFailures = (result.reasons || []).filter(f => f.includes('requires participation'));
    assert.ok(charterFailures.length > 0, `expected charter enforcement failure, got: ${JSON.stringify(result.reasons)}`);
  });
});
