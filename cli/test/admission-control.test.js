/**
 * Admission Control — acceptance tests for pre-run dead-end detection.
 *
 * Tests:
 *   AT-ADM-001  All review_only roles in gated phase → error
 *   AT-ADM-002  owned_by role not in phase routing → error
 *   AT-ADM-003  requires_human_approval but no manual runtime → warning
 *   AT-ADM-004  Mixed authorities (authoritative present) → passes
 *   AT-ADM-005  Manual runtime present → no ADM-003 warning
 *   AT-ADM-006  auto_approve policy override → no ADM-003 warning
 *   AT-ADM-007  No gates → clean pass
 *   AT-ADM-008  workflow_kit artifacts trigger ADM-001
 *   AT-ADM-009  runLoop refuses to start when admission control fails
 *   AT-ADM-010  owned_by role routed but non-writing → ADM-004 error
 *   AT-ADM-011  manual owned_by role remains valid even if review_only
 *   AT-ADM-012  mcp tool_defined review_only does not false-fail ADM-001
 */

import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { runAdmissionControl } from '../src/lib/admission-control.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeConfig(overrides = {}) {
  return {
    roles: {
      pm: { title: 'PM', mandate: 'plan', write_authority: 'authoritative', runtime: 'rt_cli' },
      qa: { title: 'QA', mandate: 'test', write_authority: 'review_only', runtime: 'rt_api' },
    },
    runtimes: {
      rt_cli: { type: 'local_cli', command: 'echo' },
      rt_api: { type: 'api_proxy', provider: 'openai' },
    },
    routing: {
      planning: {
        entry_role: 'pm',
        allowed_next_roles: ['qa'],
        exit_gate: 'planning_gate',
      },
    },
    gates: {
      planning_gate: {
        requires_files: ['.planning/PROJECT.md'],
        requires_human_approval: false,
      },
    },
    ...overrides,
  };
}

// ── AT-ADM-001: All review_only → error ──────────────────────────────────────

describe('AT-ADM-001: No file producer for gated phase', () => {
  it('rejects when all routed roles are review_only', () => {
    const config = makeConfig({
      roles: {
        reviewer: { title: 'Reviewer', mandate: 'review', write_authority: 'review_only', runtime: 'rt_api' },
        auditor: { title: 'Auditor', mandate: 'audit', write_authority: 'review_only', runtime: 'rt_cli' },
      },
      routing: {
        planning: {
          entry_role: 'reviewer',
          allowed_next_roles: ['auditor'],
          exit_gate: 'planning_gate',
        },
      },
    });

    const result = runAdmissionControl(config, config);
    assert.equal(result.ok, false, 'should fail');
    assert.ok(result.errors.length > 0, 'should have errors');
    assert.ok(result.errors[0].includes('ADM-001'), 'error should be ADM-001');
    assert.ok(result.errors[0].includes('review_only'), 'should mention review_only');
  });

  it('rejects even with local_cli review_only (not just remote)', () => {
    const config = makeConfig({
      roles: {
        local_reviewer: { title: 'Local', mandate: 'review', write_authority: 'review_only', runtime: 'rt_cli' },
      },
      routing: {
        planning: {
          entry_role: 'local_reviewer',
          allowed_next_roles: [],
          exit_gate: 'planning_gate',
        },
      },
    });

    const result = runAdmissionControl(config, config);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.includes('ADM-001')));
  });
});

// ── AT-ADM-002: owned_by role unreachable ────────────────────────────────────

describe('AT-ADM-002: Authoritative writer unreachable for owned artifacts', () => {
  it('rejects when owned_by role is not in phase routing', () => {
    const config = makeConfig({
      roles: {
        pm: { title: 'PM', mandate: 'plan', write_authority: 'authoritative', runtime: 'rt_cli' },
        architect: { title: 'Architect', mandate: 'design', write_authority: 'authoritative', runtime: 'rt_cli' },
      },
      workflow_kit: {
        phases: {
          planning: {
            template: 'planning',
            artifacts: [
              { path: '.planning/SPEC.md', required: true, owned_by: 'architect' },
            ],
          },
        },
      },
      routing: {
        planning: {
          entry_role: 'pm',
          allowed_next_roles: [],  // architect NOT included
          exit_gate: 'planning_gate',
        },
      },
    });

    const result = runAdmissionControl(config, config);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.includes('ADM-002')));
    assert.ok(result.errors.some(e => e.includes('architect')));
  });

  it('passes when owned_by role is in allowed_next_roles', () => {
    const config = makeConfig({
      roles: {
        pm: { title: 'PM', mandate: 'plan', write_authority: 'authoritative', runtime: 'rt_cli' },
        architect: { title: 'Architect', mandate: 'design', write_authority: 'authoritative', runtime: 'rt_cli' },
      },
      workflow_kit: {
        phases: {
          planning: {
            template: 'planning',
            artifacts: [
              { path: '.planning/SPEC.md', required: true, owned_by: 'architect' },
            ],
          },
        },
      },
      routing: {
        planning: {
          entry_role: 'pm',
          allowed_next_roles: ['architect'],
          exit_gate: 'planning_gate',
        },
      },
    });

    const result = runAdmissionControl(config, config);
    assert.ok(!result.errors.some(e => e.includes('ADM-002')));
  });
});

// ── AT-ADM-003: Impossible human approval topology ───────────────────────────

describe('AT-ADM-003: Impossible human approval topology', () => {
  it('warns when gate requires human approval but no manual runtime exists', () => {
    const config = makeConfig({
      gates: {
        planning_gate: {
          requires_files: ['.planning/PROJECT.md'],
          requires_human_approval: true,
        },
      },
    });

    const result = runAdmissionControl(config, config);
    assert.equal(result.ok, true, 'should pass (warning, not error)');
    assert.ok(result.warnings.some(w => w.includes('ADM-003')));
    assert.ok(result.warnings.some(w => w.includes('manual')));
  });

  it('warns when approval_policy defaults to require_human with no manual runtime', () => {
    const config = makeConfig({
      gates: {
        planning_gate: {
          requires_files: ['.planning/PROJECT.md'],
          requires_human_approval: false,
        },
      },
      approval_policy: {
        phase_transitions: {
          default: 'require_human',
        },
      },
    });

    const result = runAdmissionControl(config, config);
    assert.equal(result.ok, true);
    assert.ok(result.warnings.some(w => w.includes('ADM-003')));
  });
});

// ── AT-ADM-004: Mixed authorities → passes ───────────────────────────────────

describe('AT-ADM-004: Mixed write authorities', () => {
  it('passes when at least one authoritative role is in the phase', () => {
    const config = makeConfig(); // default has pm:authoritative
    const result = runAdmissionControl(config, config);
    assert.equal(result.ok, true);
    assert.equal(result.errors.length, 0);
  });

  it('passes with proposed authority (can still produce files)', () => {
    const config = makeConfig({
      roles: {
        drafter: { title: 'Drafter', mandate: 'draft', write_authority: 'proposed', runtime: 'rt_cli' },
      },
      routing: {
        planning: {
          entry_role: 'drafter',
          allowed_next_roles: [],
          exit_gate: 'planning_gate',
        },
      },
    });

    const result = runAdmissionControl(config, config);
    assert.equal(result.ok, true);
    assert.ok(!result.errors.some(e => e.includes('ADM-001')));
  });
});

// ── AT-ADM-005: Manual runtime present → no ADM-003 ─────────────────────────

describe('AT-ADM-005: Manual runtime suppresses ADM-003', () => {
  it('does not warn when a manual runtime exists', () => {
    const config = makeConfig({
      runtimes: {
        rt_cli: { type: 'local_cli', command: 'echo' },
        rt_manual: { type: 'manual' },
      },
      gates: {
        planning_gate: {
          requires_files: ['.planning/PROJECT.md'],
          requires_human_approval: true,
        },
      },
    });

    const result = runAdmissionControl(config, config);
    assert.ok(!result.warnings.some(w => w.includes('ADM-003')));
  });
});

// ── AT-ADM-006: auto_approve policy override → no ADM-003 ───────────────────

describe('AT-ADM-006: auto_approve policy override', () => {
  it('does not warn when approval_policy auto-approves the transition', () => {
    const config = makeConfig({
      gates: {
        planning_gate: {
          requires_files: ['.planning/PROJECT.md'],
          requires_human_approval: true,
        },
      },
      approval_policy: {
        phase_transitions: {
          default: 'auto_approve',
        },
      },
    });

    const result = runAdmissionControl(config, config);
    assert.ok(!result.warnings.some(w => w.includes('ADM-003')));
  });

  it('does not warn when specific rule auto-approves', () => {
    const config = makeConfig({
      gates: {
        planning_gate: {
          requires_files: ['.planning/PROJECT.md'],
          requires_human_approval: true,
        },
      },
      approval_policy: {
        phase_transitions: {
          default: 'require_human',
          rules: [
            { action: 'auto_approve', from_phase: 'planning' },
          ],
        },
      },
    });

    const result = runAdmissionControl(config, config);
    // The gate itself requires_human_approval, but the policy overrides it
    // ADM-003 should not fire for the policy-overridden transition
    const planningWarnings = result.warnings.filter(
      w => w.includes('ADM-003') && w.includes('"planning"'));
    assert.equal(planningWarnings.length, 0, 'planning phase should be auto-approved');
  });
});

// ── AT-ADM-007: No gates → clean pass ────────────────────────────────────────

describe('AT-ADM-007: Config with no gates', () => {
  it('passes cleanly when no gates are defined', () => {
    const config = makeConfig({
      gates: {},
      routing: {
        planning: {
          entry_role: 'pm',
          allowed_next_roles: ['qa'],
          exit_gate: null,
        },
      },
    });

    const result = runAdmissionControl(config, config);
    assert.equal(result.ok, true);
    assert.equal(result.errors.length, 0);
    assert.equal(result.warnings.length, 0);
  });

  it('passes when gates is undefined', () => {
    const config = makeConfig({ gates: undefined });
    delete config.gates;
    const result = runAdmissionControl(config, config);
    assert.equal(result.ok, true);
  });
});

// ── AT-ADM-008: workflow_kit artifacts trigger ADM-001 ───────────────────────

describe('AT-ADM-008: workflow_kit artifacts trigger ADM-001', () => {
  it('catches review_only dead-end even when files come from workflow_kit not gate', () => {
    const config = makeConfig({
      roles: {
        reviewer: { title: 'Reviewer', mandate: 'review', write_authority: 'review_only', runtime: 'rt_api' },
      },
      routing: {
        planning: {
          entry_role: 'reviewer',
          allowed_next_roles: [],
          exit_gate: 'planning_gate',
        },
      },
      gates: {
        planning_gate: {
          requires_files: [],   // no files in gate itself
          requires_human_approval: false,
        },
      },
      workflow_kit: {
        phases: {
          planning: {
            template: 'planning',
            artifacts: [
              { path: '.planning/SPEC.md', required: true },
            ],
          },
        },
      },
    });

    const result = runAdmissionControl(config, config);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.includes('ADM-001')));
    assert.ok(result.errors.some(e => e.includes('SPEC.md')));
  });
});

// ── AT-ADM-010: owned_by role routed but non-writing → ADM-004 ──────────────

describe('AT-ADM-010: Owned artifact owner cannot write', () => {
  it('rejects when the routed owned_by role is review_only on a non-manual runtime', () => {
    const config = makeConfig({
      roles: {
        pm: { title: 'PM', mandate: 'plan', write_authority: 'authoritative', runtime: 'rt_cli' },
        architect: { title: 'Architect', mandate: 'design', write_authority: 'review_only', runtime: 'rt_api' },
      },
      workflow_kit: {
        phases: {
          planning: {
            template: 'planning',
            artifacts: [
              { path: '.planning/SPEC.md', required: true, owned_by: 'architect' },
            ],
          },
        },
      },
      routing: {
        planning: {
          entry_role: 'pm',
          allowed_next_roles: ['architect'],
          exit_gate: 'planning_gate',
        },
      },
    });

    const result = runAdmissionControl(config, config);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.includes('ADM-004')));
    assert.ok(result.errors.some(e => e.includes('architect')));
    assert.ok(result.errors.some(e => e.includes('review_only')));
  });
});

// ── AT-ADM-011: manual owned_by role remains valid ──────────────────────────

describe('AT-ADM-011: Manual owned_by role remains valid', () => {
  it('does not reject when the routed owner is review_only on a manual runtime', () => {
    const config = makeConfig({
      roles: {
        pm: { title: 'PM', mandate: 'plan', write_authority: 'authoritative', runtime: 'rt_cli' },
        architect: { title: 'Architect', mandate: 'design', write_authority: 'review_only', runtime: 'rt_manual' },
      },
      runtimes: {
        rt_cli: { type: 'local_cli', command: 'echo' },
        rt_manual: { type: 'manual' },
      },
      workflow_kit: {
        phases: {
          planning: {
            template: 'planning',
            artifacts: [
              { path: '.planning/SPEC.md', required: true, owned_by: 'architect' },
            ],
          },
        },
      },
      routing: {
        planning: {
          entry_role: 'pm',
          allowed_next_roles: ['architect'],
          exit_gate: 'planning_gate',
        },
      },
    });

    const result = runAdmissionControl(config, config);
    assert.equal(result.ok, true);
    assert.ok(!result.errors.some(e => e.includes('ADM-004')));
  });
});

// ── AT-ADM-012: mcp tool_defined review_only remains non-failing ───────────

describe('AT-ADM-012: MCP tool_defined review_only does not false-fail', () => {
  it('does not reject a gated phase backed only by mcp review_only roles', () => {
    const config = makeConfig({
      roles: {
        reviewer: { title: 'Reviewer', mandate: 'review', write_authority: 'review_only', runtime: 'rt_mcp' },
      },
      runtimes: {
        rt_mcp: { type: 'mcp', command: ['node', '-e', 'process.exit(0)'] },
      },
      routing: {
        planning: {
          entry_role: 'reviewer',
          allowed_next_roles: [],
          exit_gate: 'planning_gate',
        },
      },
    });

    const result = runAdmissionControl(config, config);
    assert.equal(result.ok, true, JSON.stringify(result, null, 2));
    assert.ok(!result.errors.some((e) => e.includes('ADM-001')));
  });
});

// ── AT-ADM-009: runLoop integration ──────────────────────────────────────────

describe('AT-ADM-009: runLoop refuses to start on admission failure', () => {
  it('returns admission_rejected without executing turns', async () => {
    // Dynamic import to avoid pulling in run-loop deps at top level
    const { runLoop } = await import('../src/lib/run-loop.js');

    // Config where admission control will fail (all review_only + gated phase)
    const deadEndConfig = {
      roles: {
        reviewer: { title: 'Reviewer', mandate: 'review', write_authority: 'review_only', runtime: 'rt_api' },
      },
      runtimes: {
        rt_api: { type: 'api_proxy', provider: 'openai' },
      },
      routing: {
        planning: {
          entry_role: 'reviewer',
          allowed_next_roles: [],
          exit_gate: 'planning_gate',
        },
      },
      gates: {
        planning_gate: {
          requires_files: ['.planning/SPEC.md'],
          requires_human_approval: false,
        },
      },
      files: {
        state: '.agentxchain/state.json',
        history: '.agentxchain/history.jsonl',
      },
    };

    const callbacks = {
      selectRole: () => null,
      dispatch: () => ({ accept: false }),
      approveGate: () => ({ action: 'auto_approve' }),
    };

    // runLoop should reject immediately without touching filesystem
    const result = await runLoop('/nonexistent/path', deadEndConfig, callbacks);
    assert.equal(result.ok, false);
    assert.equal(result.stop_reason, 'admission_rejected');
    assert.equal(result.turns_executed, 0);
    assert.ok(result.errors.some(e => e.includes('ADM-001')));
  });
});
