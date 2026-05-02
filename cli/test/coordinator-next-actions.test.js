import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { deriveCoordinatorNextActions } from '../src/lib/coordinator-next-actions.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const NEXT_ACTIONS_SOURCE = readFileSync(join(REPO_ROOT, 'cli', 'src', 'lib', 'coordinator-next-actions.js'), 'utf8');
const NEXT_ACTIONS_SPEC = readFileSync(join(REPO_ROOT, '.planning', 'COORDINATOR_NEXT_ACTION_REPO_STATUS_SPEC.md'), 'utf8');

describe('deriveCoordinatorNextActions', () => {
  it('AT-COORD-ACT-001: returns no next actions once the coordinator is completed even with drift', () => {
    const nextActions = deriveCoordinatorNextActions({
      status: 'completed',
      blockedReason: 'repo_run_id_mismatch',
      pendingGate: null,
      repos: [
        {
          ok: true,
          repo_id: 'api',
          run_id: 'run_api_actual',
          status: 'completed',
        },
      ],
      coordinatorRepoRuns: {
        api: {
          run_id: 'run_api_expected',
          status: 'linked',
        },
      },
    });

    assert.deepEqual(nextActions, []);
  });

  it('AT-CNARS-001: returns no next actions once the coordinator is completed even when shared repo-status rows show drift', () => {
    const nextActions = deriveCoordinatorNextActions({
      status: 'completed',
      blockedReason: null,
      pendingGate: null,
      repos: [
        {
          ok: true,
          repo_id: 'api',
          run_id: 'run_api_actual',
          status: 'completed',
          phase: 'release',
        },
      ],
      coordinatorRepoRuns: {
        api: {
          run_id: 'run_api_expected',
          status: 'linked',
          phase: 'implementation',
        },
      },
    });

    assert.deepEqual(nextActions, []);
  });

  it('AT-CNARS-002: does not emit resync when coordinator linkage normalizes to the same readable child repo status', () => {
    const nextActions = deriveCoordinatorNextActions({
      status: 'active',
      blockedReason: null,
      pendingGate: null,
      repos: [
        {
          ok: true,
          repo_id: 'api',
          run_id: 'run_api_001',
          status: 'active',
          phase: 'implementation',
        },
      ],
      coordinatorRepoRuns: {
        api: {
          run_id: 'run_api_001',
          status: 'linked',
          phase: 'implementation',
        },
      },
    });

    assert.equal(nextActions[0]?.command, 'agentxchain multi step');
    assert.equal(nextActions.some((action) => action.command === 'agentxchain multi resync'), false);
  });

  it('AT-CNARS-003: emits resync when readable child repo authority disagrees with coordinator linkage state', () => {
    const nextActions = deriveCoordinatorNextActions({
      status: 'active',
      blockedReason: null,
      pendingGate: null,
      repos: [
        {
          ok: true,
          repo_id: 'api',
          run_id: 'run_api_001',
          status: 'completed',
          phase: 'release',
        },
      ],
      coordinatorRepoRuns: {
        api: {
          run_id: 'run_api_001',
          status: 'linked',
          phase: 'implementation',
        },
      },
    });

    assert.equal(nextActions[0]?.command, 'agentxchain multi resync');
    assert.match(nextActions[0]?.reason || '', /api/);
  });

  it('AT-CNARS-004: emits resume when readable child repo run identity disagrees with coordinator expectation', () => {
    const nextActions = deriveCoordinatorNextActions({
      status: 'blocked',
      blockedReason: 'run identity drift detected',
      pendingGate: null,
      repos: [
        {
          ok: true,
          repo_id: 'api',
          run_id: 'run_api_actual',
          status: 'active',
          phase: 'implementation',
        },
      ],
      coordinatorRepoRuns: {
        api: {
          run_id: 'run_api_expected',
          status: 'linked',
          phase: 'implementation',
        },
      },
    });

    assert.equal(nextActions[0]?.command, 'agentxchain multi resume');
    assert.match(nextActions[1]?.reason || '', /run_api_expected/);
    assert.match(nextActions[1]?.reason || '', /run_api_actual/);
  });
});

describe('Coordinator next-action repo-status contract', () => {
  it('AT-CNARS-005: routes next-action drift detection through the shared repo-status entry builder', () => {
    assert.match(NEXT_ACTIONS_SPEC, /Coordinator Next Action Repo Status Spec/);
    assert.match(NEXT_ACTIONS_SPEC, /AT-CNARS-003/);
    assert.match(NEXT_ACTIONS_SOURCE, /buildCoordinatorRepoStatusEntries/);
    assert.doesNotMatch(NEXT_ACTIONS_SOURCE, /function normalizeCoordinatorRepoStatus/);
  });
});
