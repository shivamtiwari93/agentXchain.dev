/**
 * Acceptance tests for workflow-kit runtime context rendering.
 * Per WORKFLOW_KIT_RUNTIME_CONTEXT_SPEC.md (AT-WKR-001 through AT-WKR-007).
 */

import { describe, it, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';

import {
  writeDispatchBundle,
} from '../src/lib/dispatch-bundle.js';
import {
  initializeGovernedRun,
  assignGovernedTurn,
  normalizeGovernedStateShape,
  getActiveTurn,
  STATE_PATH,
} from '../src/lib/governed-state.js';
import { scaffoldGoverned } from '../src/commands/init.js';
import { parseContextSections, SECTION_DEFINITIONS } from '../src/lib/context-section-parser.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeTmpDir() {
  const dir = join(tmpdir(), `axc-wkr-test-${randomBytes(6).toString('hex')}`);
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
  const config = {
    schema_version: 4,
    protocol_mode: 'governed',
    project: { id: 'test-wkr', name: 'Test WKR', default_branch: 'main' },
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
      planning: { entry_role: 'pm', allowed_next_roles: ['pm', 'dev'], exit_gate: 'planning_signoff' },
      implementation: { entry_role: 'dev', allowed_next_roles: ['dev', 'qa'], exit_gate: 'impl_complete' },
      qa: { entry_role: 'qa', allowed_next_roles: ['dev', 'qa'], exit_gate: 'qa_verdict' },
    },
    gates: {
      planning_signoff: { requires_files: ['.planning/PM_SIGNOFF.md'], requires_human_approval: true },
      impl_complete: { requires_verification_pass: true },
      qa_verdict: { requires_files: ['.planning/ship-verdict.md'] },
    },
    budget: { per_turn_max_usd: 2.0, per_run_max_usd: 50.0 },
    rules: { challenge_required: true, max_turn_retries: 2, max_deadlock_cycles: 2 },
    prompts: {},
    files: { talk: 'TALK.md', history: '.agentxchain/history.jsonl', state: '.agentxchain/state.json' },
    compat: { next_owner_source: 'state-json', lock_based_coordination: false, original_version: 4 },
  };
  if (workflowKitOverride !== undefined) {
    config.workflow_kit = workflowKitOverride;
  }
  return config;
}

function getContextMd(root, state) {
  const turnDir = join(root, '.agentxchain/dispatch/turns', state.current_turn.turn_id);
  return readFileSync(join(turnDir, 'CONTEXT.md'), 'utf8');
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('workflow-kit runtime context', () => {
  let root;

  beforeEach(() => {
    root = makeTmpDir();
    scaffoldGoverned(root, 'test-wkr');
  });

  afterEach(() => {
    try { rmSync(root, { recursive: true, force: true }); } catch {}
  });

  // AT-WKR-001: Default workflow-kit produces a Workflow Artifacts section
  it('renders Workflow Artifacts section for default planning phase artifacts', () => {
    const config = makeConfig({
      phases: {
        planning: {
          artifacts: [
            { path: '.planning/PM_SIGNOFF.md', semantics: 'pm_signoff', required: true },
            { path: '.planning/SYSTEM_SPEC.md', semantics: 'system_spec', required: true },
            { path: '.planning/ROADMAP.md', semantics: null, required: true },
          ],
        },
      },
    });
    initializeGovernedRun(root, config);
    assignGovernedTurn(root, config, 'pm');
    const state = readState(root);
    writeDispatchBundle(root, state, config);
    const ctx = getContextMd(root, state);

    assert.ok(ctx.includes('## Workflow Artifacts'), 'should contain Workflow Artifacts header');
    assert.ok(ctx.includes('PM_SIGNOFF.md'), 'should list PM_SIGNOFF.md');
    assert.ok(ctx.includes('SYSTEM_SPEC.md'), 'should list SYSTEM_SPEC.md');
    assert.ok(ctx.includes('ROADMAP.md'), 'should list ROADMAP.md');
    assert.ok(ctx.includes('Current phase **planning**'), 'should name the current phase');
  });

  // AT-WKR-002: Correct Required/Semantics/Status columns
  it('shows correct columns for each artifact row', () => {
    // Create one artifact that exists, one that does not
    writeFileSync(join(root, '.planning/PM_SIGNOFF.md'), 'Approved: NO\n');
    const config = makeConfig({
      phases: {
        planning: {
          artifacts: [
            { path: '.planning/PM_SIGNOFF.md', semantics: 'pm_signoff', required: true },
            { path: '.planning/MISSING_FILE.md', semantics: null, required: false },
          ],
        },
      },
    });
    initializeGovernedRun(root, config);
    assignGovernedTurn(root, config, 'pm');
    const state = readState(root);
    writeDispatchBundle(root, state, config);
    const ctx = getContextMd(root, state);

    // PM_SIGNOFF row: required=yes, semantics=pm_signoff, status=exists
    assert.ok(ctx.includes('| `.planning/PM_SIGNOFF.md` | yes | `pm_signoff` |'), 'PM_SIGNOFF row columns');
    assert.ok(ctx.includes('exists |'), 'PM_SIGNOFF should exist');

    // MISSING_FILE row: required=no, semantics=—, status=MISSING
    assert.ok(ctx.includes('| `.planning/MISSING_FILE.md` | no | — |'), 'MISSING_FILE row columns');
    assert.ok(ctx.includes('MISSING |'), 'MISSING_FILE should be MISSING');
  });

  // AT-WKR-003: owned_by renders in Owner column
  it('shows owned_by role in Owner column', () => {
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
    const ctx = getContextMd(root, state);

    assert.ok(ctx.includes('| architect |'), 'should show architect as owner');
  });

  // AT-WKR-004: Zero artifacts = no section
  it('omits Workflow Artifacts section when phase has zero artifacts', () => {
    const config = makeConfig({
      phases: {
        planning: { artifacts: [] },
      },
    });
    initializeGovernedRun(root, config);
    assignGovernedTurn(root, config, 'pm');
    const state = readState(root);
    writeDispatchBundle(root, state, config);
    const ctx = getContextMd(root, state);

    assert.ok(!ctx.includes('## Workflow Artifacts'), 'should not contain Workflow Artifacts header');
  });

  // AT-WKR-005: review_only roles see previews
  it('renders file previews for review_only roles', () => {
    writeFileSync(join(root, '.planning/PM_SIGNOFF.md'), 'Approved: YES\n');
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
    // pm is review_only
    assignGovernedTurn(root, config, 'pm');
    const state = readState(root);
    writeDispatchBundle(root, state, config);
    const ctx = getContextMd(root, state);

    // Should have the preview sub-heading
    assert.ok(ctx.includes('### `.planning/PM_SIGNOFF.md`'), 'should have preview heading');
    assert.ok(ctx.includes('Approved: YES'), 'should include file content in preview');
    // Semantic annotation
    assert.ok(ctx.includes('**Semantic: Approved: YES**'), 'should have semantic annotation');
  });

  // AT-WKR-005b: authoritative roles do NOT see previews
  it('does not render file previews for authoritative roles', () => {
    writeFileSync(join(root, '.planning/IMPLEMENTATION_NOTES.md'), '# Notes\n');
    const config = makeConfig({
      phases: {
        implementation: {
          artifacts: [
            { path: '.planning/IMPLEMENTATION_NOTES.md', semantics: 'implementation_notes', required: true },
          ],
        },
      },
    });
    // Move to implementation phase by setting routing entry
    config.routing.implementation.entry_role = 'dev';
    initializeGovernedRun(root, config);
    // Manually set phase to implementation
    const stateFile = join(root, STATE_PATH);
    const rawState = JSON.parse(readFileSync(stateFile, 'utf8'));
    rawState.phase = 'implementation';
    writeFileSync(stateFile, JSON.stringify(rawState, null, 2));

    assignGovernedTurn(root, config, 'dev');
    const state = readState(root);
    writeDispatchBundle(root, state, config);
    const ctx = getContextMd(root, state);

    // Table should be present
    assert.ok(ctx.includes('## Workflow Artifacts'), 'should have Workflow Artifacts section');
    // But no preview sub-headings (dev is authoritative)
    assert.ok(!ctx.includes('### `.planning/IMPLEMENTATION_NOTES.md`'), 'should NOT have preview heading for authoritative role');
  });

  // AT-WKR-006: context-section-parser recognizes workflow_artifacts
  it('context-section-parser recognizes workflow_artifacts section', () => {
    const sectionDef = SECTION_DEFINITIONS.find(s => s.id === 'workflow_artifacts');
    assert.ok(sectionDef, 'workflow_artifacts should be in SECTION_DEFINITIONS');
    assert.equal(sectionDef.header, 'Workflow Artifacts');
    assert.equal(sectionDef.required, false, 'should be compressible (not required)');
  });

  // AT-WKR-006b: parser can round-trip the section
  it('parseContextSections extracts workflow_artifacts section', () => {
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
    const ctx = getContextMd(root, state);

    const sections = parseContextSections(ctx);
    const wkSection = sections.find(s => s.id === 'workflow_artifacts');
    assert.ok(wkSection, 'parser should extract workflow_artifacts section');
    assert.ok(wkSection.content.includes('PM_SIGNOFF.md'), 'section should contain artifact reference');
  });

  // AT-WKR-007: Section ordering — Workflow Artifacts between Escalation and Gate Required Files
  it('Workflow Artifacts appears after Escalation section position and before Gate Required Files', () => {
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
    const ctx = getContextMd(root, state);

    const wkIdx = ctx.indexOf('## Workflow Artifacts');
    const gateIdx = ctx.indexOf('## Gate Required Files');
    const currentStateIdx = ctx.indexOf('## Current State');

    assert.ok(wkIdx > -1, 'Workflow Artifacts must be present');
    assert.ok(wkIdx > currentStateIdx, 'Workflow Artifacts must come after Current State');
    // Gate Required Files may or may not be present, but if it is, it comes after
    if (gateIdx > -1) {
      assert.ok(wkIdx < gateIdx, 'Workflow Artifacts must come before Gate Required Files');
    }
  });

  // AT-WKR-007b: Section ordering in SECTION_DEFINITIONS
  it('SECTION_DEFINITIONS has workflow_artifacts between escalation and gate_required_files', () => {
    const ids = SECTION_DEFINITIONS.map(s => s.id);
    const escalationIdx = ids.indexOf('escalation');
    const wkIdx = ids.indexOf('workflow_artifacts');
    const gateIdx = ids.indexOf('gate_required_files');

    assert.ok(wkIdx > escalationIdx, 'workflow_artifacts after escalation in definitions');
    assert.ok(wkIdx < gateIdx, 'workflow_artifacts before gate_required_files in definitions');
  });

  // No workflow_kit in config at all — section omitted
  it('omits Workflow Artifacts when config has no workflow_kit', () => {
    const config = makeConfig(undefined);
    // Explicitly delete to be sure
    delete config.workflow_kit;
    initializeGovernedRun(root, config);
    assignGovernedTurn(root, config, 'pm');
    const state = readState(root);
    writeDispatchBundle(root, state, config);
    const ctx = getContextMd(root, state);

    assert.ok(!ctx.includes('## Workflow Artifacts'), 'no workflow_kit → no section');
  });

  // Phase not in workflow_kit.phases — section omitted
  it('omits Workflow Artifacts when current phase has no workflow_kit entry', () => {
    const config = makeConfig({
      phases: {
        implementation: {
          artifacts: [
            { path: '.planning/IMPLEMENTATION_NOTES.md', semantics: 'implementation_notes', required: true },
          ],
        },
        // planning has no entry
      },
    });
    initializeGovernedRun(root, config);
    assignGovernedTurn(root, config, 'pm');
    const state = readState(root);
    writeDispatchBundle(root, state, config);
    const ctx = getContextMd(root, state);

    // We're in planning phase which has no workflow_kit entry
    assert.ok(!ctx.includes('## Workflow Artifacts'), 'phase not in workflow_kit → no section');
  });
});
