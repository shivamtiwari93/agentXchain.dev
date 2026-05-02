import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildCoordinatorGateEvaluationPresentation } from '../src/lib/coordinator-gate-evaluation-presentation.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const BLOCKERS_SOURCE = readFileSync(join(REPO_ROOT, 'cli', 'dashboard', 'components', 'blockers.js'), 'utf8');

describe('coordinator gate evaluation presentation', () => {
  it('AT-CGEP-001: phase-transition evaluation presentation emits canonical detail labels', () => {
    const presentation = buildCoordinatorGateEvaluationPresentation({
      gateType: 'phase_transition',
      evaluation: {
        ready: false,
        gate_id: 'phase_transition:implementation->qa',
        current_phase: 'implementation',
        target_phase: 'qa',
        required_repos: ['api', 'web'],
        human_barriers: ['director_signoff'],
        blockers: [{ code: 'repo_not_ready', message: 'Repo "web" not in qa' }],
      },
      includeReady: true,
    });

    assert.equal(presentation.title, 'Phase Transition');
    assert.equal(presentation.statusLabel, 'not ready');
    assert.deepEqual(
      presentation.details.map((detail) => detail.label),
      ['Gate', 'Current Phase', 'Target Phase', 'Required Repos', 'Human Barriers', 'Ready', 'Blockers'],
    );
  });

  it('AT-CGEP-002: run-completion evaluation presentation emits canonical approval and blocker labels', () => {
    const presentation = buildCoordinatorGateEvaluationPresentation({
      gateType: 'run_completion',
      evaluation: {
        ready: true,
        gate_id: 'initiative_ship',
        required_repos: ['api', 'web'],
        human_barriers: ['PM_SIGNOFF.md'],
        requires_human_approval: true,
        blockers: [],
      },
    });

    assert.equal(presentation.title, 'Run Completion');
    assert.equal(presentation.statusLabel, 'ready');
    assert.deepEqual(
      presentation.details.map((detail) => detail.label),
      ['Gate', 'Required Repos', 'Human Barriers', 'Human Approval', 'Blockers'],
    );
    assert.equal(presentation.details.find((detail) => detail.label === 'Human Approval')?.value, 'Required');
  });

  it('AT-CGEP-003: Blockers view imports shared evaluation presentation and does not hardcode old labels', () => {
    assert.match(BLOCKERS_SOURCE, /buildCoordinatorGateEvaluationPresentation/);
    assert.doesNotMatch(BLOCKERS_SOURCE, /<dt>Current<\/dt><dd>/);
    assert.doesNotMatch(BLOCKERS_SOURCE, /<dt>Target<\/dt><dd>/);
    assert.doesNotMatch(BLOCKERS_SOURCE, /run_completion\.requires_human_approval/);
  });
});
