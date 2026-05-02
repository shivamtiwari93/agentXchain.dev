/**
 * Dashboard enterprise-app E2E — proves the dashboard artifact surface
 * exposes correct phase-template-backed ownership and artifact rendering
 * for all 5 enterprise-app phases.
 *
 * AT-DASH-ENT-001: Planning phase artifacts with pm entry_role ownership
 * AT-DASH-ENT-002: Architecture phase with explicit architect ownership override
 * AT-DASH-ENT-003: Implementation phase with dev entry_role ownership
 * AT-DASH-ENT-004: Security_review phase with explicit security_reviewer override
 * AT-DASH-ENT-005: QA phase artifacts with qa entry_role ownership
 * AT-DASH-ENT-006: Phase-template composition — explicit owned_by overrides template
 * AT-DASH-ENT-007: Render produces correct owner resolution badges per phase
 */

import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { readWorkflowKitArtifacts } from '../src/lib/dashboard/workflow-kit-artifacts.js';
import { render as renderArtifacts } from '../dashboard/components/artifacts.js';

// Full enterprise-app governed config with expanded phase-template artifacts
// Mirrors the real scaffold output from `agentxchain init --governed --template enterprise-app`
function makeEnterpriseConfig() {
  return {
    schema_version: '1.0',
    protocol_mode: 'governed',
    template: 'enterprise-app',
    project: {
      id: 'enterprise-dash-test',
      name: 'Enterprise Dashboard Test',
      default_branch: 'main',
    },
    roles: {
      pm: { title: 'PM', mandate: 'Plan', write_authority: 'review_only', runtime: 'manual-pm' },
      architect: { title: 'Architect', mandate: 'Design', write_authority: 'review_only', runtime: 'manual-architect' },
      dev: { title: 'Developer', mandate: 'Build', write_authority: 'authoritative', runtime: 'local-dev' },
      security_reviewer: { title: 'Security Reviewer', mandate: 'Review', write_authority: 'review_only', runtime: 'manual-security' },
      qa: { title: 'QA', mandate: 'Test', write_authority: 'review_only', runtime: 'api-qa' },
    },
    runtimes: {
      'manual-pm': { type: 'manual' },
      'manual-architect': { type: 'manual' },
      'local-dev': { type: 'local_cli', command: ['echo'], prompt_transport: 'stdin' },
      'manual-security': { type: 'manual' },
      'api-qa': { type: 'api_proxy', provider: 'anthropic', model: 'claude-sonnet-4-6', auth_env: 'ANTHROPIC_API_KEY' },
    },
    routing: {
      planning: { entry_role: 'pm', allowed_next_roles: ['pm', 'architect', 'human'], exit_gate: 'planning_signoff' },
      architecture: { entry_role: 'architect', allowed_next_roles: ['architect', 'dev', 'human'], exit_gate: 'architecture_review' },
      implementation: { entry_role: 'dev', allowed_next_roles: ['dev', 'qa', 'human'], exit_gate: 'implementation_complete' },
      security_review: { entry_role: 'security_reviewer', allowed_next_roles: ['dev', 'qa', 'human'], exit_gate: 'security_review_signoff' },
      qa: { entry_role: 'qa', allowed_next_roles: ['dev', 'qa', 'human'], exit_gate: 'qa_ship_verdict' },
    },
    gates: {
      planning_signoff: { requires_files: ['.planning/PM_SIGNOFF.md', '.planning/ROADMAP.md', '.planning/SYSTEM_SPEC.md'], requires_human_approval: true },
      architecture_review: { requires_files: ['.planning/ARCHITECTURE.md'] },
      implementation_complete: { requires_files: ['.planning/IMPLEMENTATION_NOTES.md'], requires_verification_pass: true },
      security_review_signoff: { requires_files: ['.planning/SECURITY_REVIEW.md'] },
      qa_ship_verdict: { requires_files: ['.planning/acceptance-matrix.md', '.planning/ship-verdict.md', '.planning/RELEASE_NOTES.md'], requires_human_approval: true },
    },
    workflow_kit: {
      phases: {
        planning: {
          artifacts: [
            { path: '.planning/PM_SIGNOFF.md', semantics: 'pm_signoff', required: true },
            { path: '.planning/SYSTEM_SPEC.md', semantics: 'system_spec', required: true },
            { path: '.planning/ROADMAP.md', semantics: null, required: true },
          ],
        },
        architecture: {
          artifacts: [
            { path: '.planning/ARCHITECTURE.md', semantics: 'section_check', semantics_config: { required_sections: ['## Context', '## Proposed Design', '## Trade-offs', '## Risks'] }, owned_by: 'architect', required: true },
          ],
        },
        implementation: {
          artifacts: [
            { path: '.planning/IMPLEMENTATION_NOTES.md', semantics: 'implementation_notes', required: true },
          ],
        },
        security_review: {
          artifacts: [
            { path: '.planning/SECURITY_REVIEW.md', semantics: 'section_check', semantics_config: { required_sections: ['## Threat Model', '## Findings', '## Verdict'] }, owned_by: 'security_reviewer', required: true },
          ],
        },
        qa: {
          artifacts: [
            { path: '.planning/acceptance-matrix.md', semantics: 'acceptance_matrix', required: true },
            { path: '.planning/ship-verdict.md', semantics: 'ship_verdict', required: true },
            { path: '.planning/RELEASE_NOTES.md', semantics: 'release_notes', required: true },
          ],
        },
      },
    },
    prompts: { pm: '# PM', architect: '# Architect', dev: '# Dev', security_reviewer: '# Security', qa: '# QA' },
    rules: { challenge_required: true, max_turn_retries: 2, max_deadlock_cycles: 2 },
  };
}

function makeWorkspace(phase, existingFiles = []) {
  const dir = mkdtempSync(join(tmpdir(), 'dash-ent-'));
  const config = makeEnterpriseConfig();
  writeFileSync(join(dir, 'agentxchain.json'), JSON.stringify(config, null, 2));
  mkdirSync(join(dir, '.agentxchain'), { recursive: true });
  writeFileSync(join(dir, '.agentxchain', 'state.json'), JSON.stringify({
    schema_version: '1.1',
    run_id: 'run_ent_dash',
    project_id: 'enterprise-dash-test',
    status: 'active',
    phase,
    active_turns: {},
    turn_sequence: 0,
    phase_gate_status: {},
    budget_reservations: {},
    budget_status: { spent_usd: 0, remaining_usd: 100 },
  }, null, 2));
  for (const f of existingFiles) {
    const full = join(dir, f);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, '# placeholder\n');
  }
  return dir;
}

// Expected artifacts per phase (sorted by path)
const EXPECTED = {
  planning: [
    { path: '.planning/PM_SIGNOFF.md', owned_by: 'pm', owner_resolution: 'entry_role', semantics: 'pm_signoff' },
    { path: '.planning/ROADMAP.md', owned_by: 'pm', owner_resolution: 'entry_role', semantics: null },
    { path: '.planning/SYSTEM_SPEC.md', owned_by: 'pm', owner_resolution: 'entry_role', semantics: 'system_spec' },
  ],
  architecture: [
    { path: '.planning/ARCHITECTURE.md', owned_by: 'architect', owner_resolution: 'explicit', semantics: 'section_check' },
  ],
  implementation: [
    { path: '.planning/IMPLEMENTATION_NOTES.md', owned_by: 'dev', owner_resolution: 'entry_role', semantics: 'implementation_notes' },
  ],
  security_review: [
    { path: '.planning/SECURITY_REVIEW.md', owned_by: 'security_reviewer', owner_resolution: 'explicit', semantics: 'section_check' },
  ],
  qa: [
    { path: '.planning/RELEASE_NOTES.md', owned_by: 'qa', owner_resolution: 'entry_role', semantics: 'release_notes' },
    { path: '.planning/acceptance-matrix.md', owned_by: 'qa', owner_resolution: 'entry_role', semantics: 'acceptance_matrix' },
    { path: '.planning/ship-verdict.md', owned_by: 'qa', owner_resolution: 'entry_role', semantics: 'ship_verdict' },
  ],
};

describe('Dashboard enterprise-app E2E', () => {
  // AT-DASH-ENT-001
  it('planning phase: 3 artifacts owned by pm via entry_role', () => {
    const dir = makeWorkspace('planning', ['.planning/SYSTEM_SPEC.md']);
    const result = readWorkflowKitArtifacts(dir);
    assert.equal(result.status, 200);
    assert.equal(result.body.phase, 'planning');
    assert.equal(result.body.artifacts.length, 3);
    for (const expected of EXPECTED.planning) {
      const actual = result.body.artifacts.find((a) => a.path === expected.path);
      assert.ok(actual, `missing artifact: ${expected.path}`);
      assert.equal(actual.owned_by, expected.owned_by);
      assert.equal(actual.owner_resolution, expected.owner_resolution);
      assert.equal(actual.semantics, expected.semantics);
      assert.equal(actual.required, true);
    }
    // One exists, two missing
    assert.equal(result.body.artifacts.find((a) => a.path === '.planning/SYSTEM_SPEC.md').exists, true);
    assert.equal(result.body.artifacts.find((a) => a.path === '.planning/PM_SIGNOFF.md').exists, false);
  });

  // AT-DASH-ENT-002
  it('architecture phase: 1 artifact with explicit architect ownership', () => {
    const dir = makeWorkspace('architecture', ['.planning/ARCHITECTURE.md']);
    const result = readWorkflowKitArtifacts(dir);
    assert.equal(result.status, 200);
    assert.equal(result.body.phase, 'architecture');
    assert.equal(result.body.artifacts.length, 1);
    const arch = result.body.artifacts[0];
    assert.equal(arch.path, '.planning/ARCHITECTURE.md');
    assert.equal(arch.owned_by, 'architect');
    assert.equal(arch.owner_resolution, 'explicit');
    assert.equal(arch.exists, true);
  });

  // AT-DASH-ENT-003
  it('implementation phase: 1 artifact owned by dev via entry_role', () => {
    const dir = makeWorkspace('implementation');
    const result = readWorkflowKitArtifacts(dir);
    assert.equal(result.status, 200);
    assert.equal(result.body.phase, 'implementation');
    assert.equal(result.body.artifacts.length, 1);
    const impl = result.body.artifacts[0];
    assert.equal(impl.owned_by, 'dev');
    assert.equal(impl.owner_resolution, 'entry_role');
    assert.equal(impl.exists, false);
  });

  // AT-DASH-ENT-004
  it('security_review phase: 1 artifact with explicit security_reviewer ownership', () => {
    const dir = makeWorkspace('security_review', ['.planning/SECURITY_REVIEW.md']);
    const result = readWorkflowKitArtifacts(dir);
    assert.equal(result.status, 200);
    assert.equal(result.body.phase, 'security_review');
    assert.equal(result.body.artifacts.length, 1);
    const sec = result.body.artifacts[0];
    assert.equal(sec.owned_by, 'security_reviewer');
    assert.equal(sec.owner_resolution, 'explicit');
    assert.equal(sec.exists, true);
  });

  // AT-DASH-ENT-005
  it('qa phase: 3 artifacts owned by qa via entry_role', () => {
    const dir = makeWorkspace('qa', ['.planning/acceptance-matrix.md', '.planning/ship-verdict.md']);
    const result = readWorkflowKitArtifacts(dir);
    assert.equal(result.status, 200);
    assert.equal(result.body.phase, 'qa');
    assert.equal(result.body.artifacts.length, 3);
    for (const expected of EXPECTED.qa) {
      const actual = result.body.artifacts.find((a) => a.path === expected.path);
      assert.ok(actual, `missing artifact: ${expected.path}`);
      assert.equal(actual.owned_by, 'qa');
      assert.equal(actual.owner_resolution, 'entry_role');
    }
    assert.equal(result.body.artifacts.find((a) => a.path === '.planning/RELEASE_NOTES.md').exists, false);
    assert.equal(result.body.artifacts.find((a) => a.path === '.planning/acceptance-matrix.md').exists, true);
  });

  // AT-DASH-ENT-006
  it('explicit owned_by overrides entry_role in architecture and security_review', () => {
    // Architecture: entry_role is architect, owned_by is architect (explicit, not entry_role)
    const archDir = makeWorkspace('architecture');
    const archResult = readWorkflowKitArtifacts(archDir);
    assert.equal(archResult.body.artifacts[0].owner_resolution, 'explicit');

    // Security: entry_role is security_reviewer, owned_by is security_reviewer (explicit)
    const secDir = makeWorkspace('security_review');
    const secResult = readWorkflowKitArtifacts(secDir);
    assert.equal(secResult.body.artifacts[0].owner_resolution, 'explicit');

    // Planning: no explicit owned_by, should be entry_role
    const planDir = makeWorkspace('planning');
    const planResult = readWorkflowKitArtifacts(planDir);
    for (const a of planResult.body.artifacts) {
      assert.equal(a.owner_resolution, 'entry_role', `${a.path} should be entry_role`);
    }
  });

  // AT-DASH-ENT-007
  it('render produces correct ownership badges for each phase', () => {
    for (const phase of Object.keys(EXPECTED)) {
      const dir = makeWorkspace(phase);
      const result = readWorkflowKitArtifacts(dir);
      const html = renderArtifacts({ workflowKitArtifacts: result.body });

      assert.ok(html.includes(phase), `render should show phase "${phase}"`);
      for (const expected of EXPECTED[phase]) {
        assert.ok(html.includes(expected.owned_by), `render for ${phase} should show owner "${expected.owned_by}"`);
        assert.ok(html.includes(expected.owner_resolution), `render for ${phase} should show resolution "${expected.owner_resolution}"`);
      }
    }
  });
});
