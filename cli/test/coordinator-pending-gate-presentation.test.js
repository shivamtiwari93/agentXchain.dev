import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  getCoordinatorPendingGateDetails,
  getCoordinatorPendingGateSnapshot,
} from '../src/lib/coordinator-pending-gate-presentation.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const blockerPresentationSource = readFileSync(join(__dirname, '..', 'src', 'lib', 'coordinator-blocker-presentation.js'), 'utf8');
const gateSource = readFileSync(join(__dirname, '..', 'dashboard', 'components', 'gate.js'), 'utf8');
const initiativeSource = readFileSync(join(__dirname, '..', 'dashboard', 'components', 'initiative.js'), 'utf8');
const blockersSource = readFileSync(join(__dirname, '..', 'dashboard', 'components', 'blockers.js'), 'utf8');

describe('coordinator pending gate presentation helper', () => {
  it('AT-CPGP-001: normalizes pending gate state and blocker snapshots into canonical detail rows', () => {
    assert.deepEqual(
      getCoordinatorPendingGateSnapshot({
        pendingGate: {
          gate_type: 'phase_transition',
          gate: 'phase_transition:integration->release',
          from: 'integration',
          to: 'release',
          required_repos: ['api', 'web'],
        },
      }),
      {
        gate_type: 'phase_transition',
        gate_id: 'phase_transition:integration->release',
        current_phase: 'integration',
        target_phase: 'release',
        required_repos: ['api', 'web'],
        human_barriers: [],
        approval_state: 'Awaiting human approval',
      },
    );

    assert.deepEqual(
      getCoordinatorPendingGateDetails({
        active: {
          gate_type: 'run_completion',
          gate_id: 'initiative_ship',
          required_repos: ['api', 'web'],
          human_barriers: ['PM_SIGNOFF.md'],
          pending: true,
        },
      }),
      [
        { label: 'Type', value: 'run_completion', mono: false },
        { label: 'Gate', value: 'initiative_ship', mono: true },
        { label: 'Required Repos', value: 'api, web', mono: false },
        { label: 'Approval State', value: 'Awaiting human approval', mono: false },
        { label: 'Human Barriers', value: 'PM_SIGNOFF.md', mono: false },
      ],
    );
  });

  it('AT-CPGP-002: coordinator renderers consume the shared helper instead of reading pending-gate identity fields inline', () => {
    assert.match(gateSource, /getCoordinatorPendingGateDetails/);
    assert.match(blockersSource, /getCoordinatorPendingGateDetails/);
    assert.match(blockerPresentationSource, /getCoordinatorPendingGateDetails/);

    assert.match(gateSource, /getCoordinatorPendingGateDetails\(\{ pendingGate: pendingTransition/);
    assert.doesNotMatch(gateSource, /isCoordinator && Array\.isArray\(pendingTransition\.required_repos\)/);
    assert.doesNotMatch(initiativeSource, /getCoordinatorPendingGateDetails/);
    assert.doesNotMatch(initiativeSource, /pendingGate\.(gate_type|gate|from|to|required_repos)/);
    assert.match(blockersSource, /active\.pending === true[\s\S]*getCoordinatorPendingGateDetails/);
    assert.doesNotMatch(blockersSource, /Pending Approval/);
  });
});
