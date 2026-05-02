/**
 * Acceptance tests for workflow-kit prompt guidance.
 * Per WORKFLOW_KIT_PROMPT_GUIDANCE_SPEC.md (AT-WKP-001 through AT-WKP-005).
 */

import { describe, it, beforeEach, afterEach } from 'vitest';
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

function makeTmpDir() {
  const dir = join(tmpdir(), `axc-wkp-test-${randomBytes(6).toString('hex')}`);
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
    project: { id: 'test-wkp', name: 'Test WKP', default_branch: 'main' },
    roles: {
      pm: { title: 'PM', mandate: 'Protect user value.', write_authority: 'review_only', runtime_class: 'manual', runtime_id: 'manual-pm' },
      dev: { title: 'Developer', mandate: 'Build.', write_authority: 'authoritative', runtime_class: 'manual', runtime_id: 'manual-dev' },
      architect: { title: 'Architect', mandate: 'Design.', write_authority: 'review_only', runtime_class: 'manual', runtime_id: 'manual-architect' },
      qa: { title: 'QA', mandate: 'Challenge.', write_authority: 'review_only', runtime_class: 'manual', runtime_id: 'manual-qa' },
    },
    runtimes: {
      'manual-pm': { type: 'manual' },
      'manual-dev': { type: 'manual' },
      'manual-architect': { type: 'manual' },
      'manual-qa': { type: 'manual' },
    },
    routing: {
      planning: { entry_role: 'pm', allowed_next_roles: ['pm', 'dev', 'architect'], exit_gate: 'planning_signoff' },
      implementation: { entry_role: 'dev', allowed_next_roles: ['dev', 'qa'], exit_gate: 'impl_complete' },
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

describe('workflow-kit prompt guidance', () => {
  let root;

  beforeEach(() => {
    root = makeTmpDir();
    scaffoldGoverned(root, 'test-wkp');
  });

  afterEach(() => {
    try { rmSync(root, { recursive: true, force: true }); } catch {}
  });

  it('AT-WKP-001: entry role sees unowned workflow-kit artifacts for the current phase', () => {
    writeFileSync(join(root, '.planning/PM_SIGNOFF.md'), 'Approved: NO\n');
    const config = makeConfig({
      phases: {
        planning: {
          artifacts: [
            { path: '.planning/PM_SIGNOFF.md', semantics: 'pm_signoff', required: true },
          ],
        },
      },
    });

    initializeGovernedRun(root, config);
    assignGovernedTurn(root, config, 'pm');
    const state = readState(root);
    writeDispatchBundle(root, state, config);
    const prompt = getPromptMd(root, state);

    assert.match(prompt, /## Workflow-Kit Responsibilities/);
    assert.match(prompt, /You are accountable for reviewing and attesting to these workflow-kit artifacts in phase `planning`:/);
    assert.match(prompt, /`\.planning\/PM_SIGNOFF\.md`/);
  });

  it('AT-WKP-002: explicit owned_by artifact is shown for the owning role even when not the phase entry role', () => {
    const config = makeConfig({
      phases: {
        planning: {
          artifacts: [
            { path: '.planning/ARCHITECTURE.md', semantics: 'section_check', owned_by: 'architect', required: true },
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
    assert.match(prompt, /`\.planning\/ARCHITECTURE\.md`/);
  });

  it('AT-WKP-003: non-owning role does not get workflow responsibilities for another role', () => {
    const config = makeConfig({
      phases: {
        planning: {
          artifacts: [
            { path: '.planning/ARCHITECTURE.md', semantics: 'section_check', owned_by: 'architect', required: true },
          ],
        },
      },
    });

    initializeGovernedRun(root, config);
    assignGovernedTurn(root, config, 'pm');
    const state = readState(root);
    writeDispatchBundle(root, state, config);
    const prompt = getPromptMd(root, state);

    assert.doesNotMatch(prompt, /## Workflow-Kit Responsibilities/);
    assert.doesNotMatch(prompt, /ARCHITECTURE\.md/);
  });

  it('AT-WKP-004: responsibility lines show required or optional, semantics, and existence status truthfully', () => {
    const config = makeConfig({
      phases: {
        implementation: {
          artifacts: [
            { path: '.planning/IMPLEMENTATION_NOTES.md', semantics: 'implementation_notes', required: true },
            { path: '.planning/OPTIONAL-NOTES.md', semantics: null, required: false },
          ],
        },
      },
    });

    writeFileSync(join(root, '.planning/IMPLEMENTATION_NOTES.md'), '# Notes\n');
    const rawState = JSON.parse(readFileSync(join(root, STATE_PATH), 'utf8'));
    rawState.phase = 'implementation';
    writeFileSync(join(root, STATE_PATH), JSON.stringify(rawState, null, 2));

    initializeGovernedRun(root, config);
    const resetState = JSON.parse(readFileSync(join(root, STATE_PATH), 'utf8'));
    resetState.phase = 'implementation';
    writeFileSync(join(root, STATE_PATH), JSON.stringify(resetState, null, 2));

    assignGovernedTurn(root, config, 'dev');
    const state = readState(root);
    writeDispatchBundle(root, state, config);
    const prompt = getPromptMd(root, state);

    assert.match(prompt, /`\.planning\/IMPLEMENTATION_NOTES\.md` — required; semantics: `implementation_notes`; status: exists/);
    assert.match(prompt, /`\.planning\/OPTIONAL-NOTES\.md` — optional; semantics: —; status: MISSING/);
  });

  it('AT-WKP-005: section is positioned after write-authority guidance and before the phase exit gate', () => {
    const config = makeConfig({
      phases: {
        implementation: {
          artifacts: [
            { path: '.planning/IMPLEMENTATION_NOTES.md', semantics: 'implementation_notes', required: true },
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

    const authorityIdx = prompt.indexOf('### Write Authority: authoritative');
    const workflowIdx = prompt.indexOf('## Workflow-Kit Responsibilities');
    const gateIdx = prompt.indexOf('## Phase Exit Gate');

    assert.ok(authorityIdx > -1, 'write authority guidance must exist');
    assert.ok(workflowIdx > authorityIdx, 'workflow responsibilities must come after write authority guidance');
    assert.ok(gateIdx > workflowIdx, 'phase exit gate must come after workflow responsibilities');
  });
});
