import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import {
  getEffectiveGateArtifacts,
  hasRoleParticipationInPhase,
  getNextPhase,
  getInvalidPhaseTransitionReason,
  isFinalPhase,
  getPhaseOrder,
} from '../src/lib/gate-evaluator.js';

// ── getEffectiveGateArtifacts ───────────────────────────────────────────

describe('getEffectiveGateArtifacts', () => {
  it('AT-QDP-013: returns artifacts from requires_files with useLegacySemantics=true', () => {
    const gateDef = { requires_files: ['.planning/PM_SIGNOFF.md', '.planning/ROADMAP.md'] };
    const config = {};
    const artifacts = getEffectiveGateArtifacts(config, gateDef, 'planning');

    assert.equal(artifacts.length, 2);
    assert.equal(artifacts[0].path, '.planning/PM_SIGNOFF.md');
    assert.equal(artifacts[0].required, true);
    assert.equal(artifacts[0].useLegacySemantics, true);
    assert.equal(artifacts[1].path, '.planning/ROADMAP.md');
  });

  it('AT-QDP-014: merges workflow_kit artifacts with requires_files for same path', () => {
    const gateDef = { requires_files: ['.planning/IMPLEMENTATION_NOTES.md'] };
    const config = {
      workflow_kit: {
        phases: {
          implementation: {
            artifacts: [
              {
                path: '.planning/IMPLEMENTATION_NOTES.md',
                required: true,
                semantics: 'implementation_notes',
                owned_by: 'dev',
              },
            ],
          },
        },
      },
    };

    const artifacts = getEffectiveGateArtifacts(config, gateDef, 'implementation');
    assert.equal(artifacts.length, 1);

    const merged = artifacts[0];
    assert.equal(merged.path, '.planning/IMPLEMENTATION_NOTES.md');
    assert.equal(merged.required, true);
    assert.equal(merged.useLegacySemantics, true);
    assert.equal(merged.owned_by, 'dev');
  });

  it('AT-QDP-015: adds workflow_kit-only artifacts not in requires_files', () => {
    const gateDef = { requires_files: [] };
    const config = {
      workflow_kit: {
        phases: {
          qa: {
            artifacts: [
              {
                path: '.planning/acceptance-matrix.md',
                required: true,
                semantics: 'acceptance_matrix',
              },
            ],
          },
        },
      },
    };

    const artifacts = getEffectiveGateArtifacts(config, gateDef, 'qa');
    assert.equal(artifacts.length, 1);
    assert.equal(artifacts[0].path, '.planning/acceptance-matrix.md');
    assert.equal(artifacts[0].useLegacySemantics, false);
  });

  it('AT-QDP-016: returns empty array when gateDef and config have no artifacts', () => {
    const artifacts = getEffectiveGateArtifacts({}, {}, 'planning');
    assert.equal(artifacts.length, 0);
  });

  it('AT-QDP-017: skips workflow_kit artifacts without a path', () => {
    const config = {
      workflow_kit: {
        phases: {
          planning: {
            artifacts: [
              { semantics: 'pm_signoff' }, // no path
              { path: '.planning/ROADMAP.md', required: true },
            ],
          },
        },
      },
    };

    const artifacts = getEffectiveGateArtifacts(config, {}, 'planning');
    assert.equal(artifacts.length, 1);
    assert.equal(artifacts[0].path, '.planning/ROADMAP.md');
  });

  it('AT-QDP-018: deduplicates semantic checks when legacy semantic matches workflow_kit semantic', () => {
    const gateDef = { requires_files: ['.planning/PM_SIGNOFF.md'] };
    const config = {
      workflow_kit: {
        phases: {
          planning: {
            artifacts: [
              {
                path: '.planning/PM_SIGNOFF.md',
                semantics: 'pm_signoff', // same as legacy semantic for this path
              },
            ],
          },
        },
      },
    };

    const artifacts = getEffectiveGateArtifacts(config, gateDef, 'planning');
    assert.equal(artifacts.length, 1);
    // Should NOT add duplicate semantic check since legacy already covers pm_signoff
    assert.equal(artifacts[0].semanticChecks.length, 0);
  });
});

// ── hasRoleParticipationInPhase ─────────────────────────────────────────

describe('hasRoleParticipationInPhase', () => {
  it('AT-QDP-019: returns true when role participated in the phase', () => {
    const state = {
      history: [
        { phase: 'planning', role: 'pm', status: 'accepted' },
        { phase: 'implementation', role: 'dev', status: 'accepted' },
      ],
    };
    assert.equal(hasRoleParticipationInPhase(state, 'planning', 'pm'), true);
    assert.equal(hasRoleParticipationInPhase(state, 'implementation', 'dev'), true);
  });

  it('AT-QDP-020: returns false when role did not participate in the phase', () => {
    const state = {
      history: [
        { phase: 'planning', role: 'pm', status: 'accepted' },
      ],
    };
    assert.equal(hasRoleParticipationInPhase(state, 'planning', 'dev'), false);
    assert.equal(hasRoleParticipationInPhase(state, 'implementation', 'pm'), false);
  });

  it('AT-QDP-021: returns false when state has no history', () => {
    assert.equal(hasRoleParticipationInPhase({}, 'planning', 'pm'), false);
    assert.equal(hasRoleParticipationInPhase(null, 'planning', 'pm'), false);
    assert.equal(hasRoleParticipationInPhase({ history: null }, 'planning', 'pm'), false);
  });

  it('AT-QDP-022: returns false when history is empty array', () => {
    assert.equal(hasRoleParticipationInPhase({ history: [] }, 'planning', 'pm'), false);
  });
});

// ── getNextPhase ────────────────────────────────────────────────────────

describe('getNextPhase', () => {
  const routing = {
    planning: { exit_gate: 'planning_signoff' },
    implementation: { exit_gate: 'implementation_complete' },
    qa: { exit_gate: 'qa_ship_verdict' },
  };

  it('AT-QDP-023: returns implementation as next phase after planning', () => {
    assert.equal(getNextPhase('planning', routing), 'implementation');
  });

  it('AT-QDP-024: returns qa as next phase after implementation', () => {
    assert.equal(getNextPhase('implementation', routing), 'qa');
  });

  it('AT-QDP-025: returns null for the final phase (qa)', () => {
    assert.equal(getNextPhase('qa', routing), null);
  });

  it('AT-QDP-026: returns null for an unknown phase', () => {
    assert.equal(getNextPhase('nonexistent', routing), null);
  });

  it('AT-QDP-027: returns null when routing is empty or null', () => {
    assert.equal(getNextPhase('planning', {}), null);
    assert.equal(getNextPhase('planning', null), null);
  });
});

// ── getInvalidPhaseTransitionReason ─────────────────────────────────────

describe('getInvalidPhaseTransitionReason', () => {
  const routing = {
    planning: { exit_gate: 'planning_signoff' },
    implementation: { exit_gate: 'implementation_complete' },
    qa: { exit_gate: 'qa_ship_verdict' },
  };

  it('AT-QDP-028: returns null for valid planning → implementation transition', () => {
    assert.equal(getInvalidPhaseTransitionReason('planning', 'implementation', routing), null);
  });

  it('AT-QDP-029: returns null for valid implementation → qa transition', () => {
    assert.equal(getInvalidPhaseTransitionReason('implementation', 'qa', routing), null);
  });

  it('AT-QDP-030: returns reason when trying to skip from planning → qa', () => {
    const reason = getInvalidPhaseTransitionReason('planning', 'qa', routing);
    assert.ok(reason);
    assert.ok(reason.includes('implementation'));
    assert.ok(reason.includes('invalid'));
  });

  it('AT-QDP-031: returns reason when requesting transition from final phase', () => {
    const reason = getInvalidPhaseTransitionReason('qa', 'planning', routing);
    assert.ok(reason);
    assert.ok(reason.includes('final phase'));
    assert.ok(reason.includes('run_completion_request'));
  });
});

// ── isFinalPhase ────────────────────────────────────────────────────────

describe('isFinalPhase', () => {
  const routing = {
    planning: {},
    implementation: {},
    qa: {},
  };

  it('AT-QDP-032: returns true for the last declared phase', () => {
    assert.equal(isFinalPhase('qa', routing), true);
  });

  it('AT-QDP-033: returns false for non-final phases', () => {
    assert.equal(isFinalPhase('planning', routing), false);
    assert.equal(isFinalPhase('implementation', routing), false);
  });

  it('AT-QDP-034: returns false for unknown phase', () => {
    assert.equal(isFinalPhase('nonexistent', routing), false);
  });

  it('AT-QDP-035: returns false when routing is empty', () => {
    assert.equal(isFinalPhase('qa', {}), false);
    assert.equal(isFinalPhase('qa', null), false);
  });

  it('AT-QDP-036: returns true for single-phase routing', () => {
    assert.equal(isFinalPhase('only', { only: {} }), true);
  });
});
