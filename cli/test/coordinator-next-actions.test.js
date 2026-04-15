import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { deriveCoordinatorNextActions } from '../src/lib/coordinator-next-actions.js';

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
});
