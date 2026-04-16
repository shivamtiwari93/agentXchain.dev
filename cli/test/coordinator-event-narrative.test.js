import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { summarizeCoordinatorEvent } from '../src/lib/coordinator-event-narrative.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('coordinator event narrative helper', () => {
  it('AT-COORD-EVENT-NAR-001: renders stable summaries for the recognized coordinator event set', () => {
    assert.equal(
      summarizeCoordinatorEvent({
        type: 'run_initialized',
        repo_runs: { api: {}, web: {} },
      }),
      'Coordinator run initialized with 2 repos',
    );
    assert.equal(
      summarizeCoordinatorEvent({
        type: 'turn_dispatched',
        repo_id: 'api',
        role: 'dev',
        workstream_id: 'backend',
      }),
      'Dispatched turn to api (dev) in workstream backend',
    );
    assert.equal(
      summarizeCoordinatorEvent({
        type: 'acceptance_projection',
        repo_id: 'api',
        repo_turn_id: 'turn_api_001',
        summary: 'API integration accepted',
      }),
      'Projected acceptance from api (turn turn_api_001) — API integration accepted',
    );
    assert.equal(
      summarizeCoordinatorEvent({
        type: 'context_generated',
        target_repo_id: 'web',
        upstream_repo_ids: ['api'],
      }),
      'Generated cross-repo context for web from 1 upstream repo',
    );
    assert.equal(
      summarizeCoordinatorEvent({
        type: 'phase_transition_requested',
        from: 'implementation',
        to: 'qa',
      }),
      'Requested phase transition: implementation → qa',
    );
    assert.equal(
      summarizeCoordinatorEvent({
        type: 'phase_transition_approved',
        from: 'implementation',
        to: 'qa',
      }),
      'Phase transition approved: implementation → qa',
    );
    assert.equal(
      summarizeCoordinatorEvent({
        type: 'run_completion_requested',
        gate: 'initiative_ship',
      }),
      'Requested run completion (gate: initiative_ship)',
    );
    assert.equal(
      summarizeCoordinatorEvent({
        type: 'run_completed',
      }),
      'Coordinator run completed',
    );
    assert.equal(
      summarizeCoordinatorEvent({
        type: 'state_resynced',
        resynced_repos: ['api'],
        barrier_changes: [{ barrier_id: 'sync_completion' }],
      }),
      'Resynced state for 1 repo, 1 barrier change',
    );
    assert.equal(
      summarizeCoordinatorEvent({
        type: 'blocked_resolved',
        from: 'blocked',
        to: 'active',
      }),
      'Blocked state resolved: blocked → active',
    );
  });

  it('AT-COORD-EVENT-NAR-002: preserves unknown coordinator event types with timestamp fallback', () => {
    assert.equal(
      summarizeCoordinatorEvent({
        type: 'mystery_event',
        timestamp: '2026-04-15T21:05:00Z',
      }),
      'mystery_event event at 2026-04-15T21:05:00Z',
    );
  });

  it('spec file exists and is current', () => {
    const specPath = join(__dirname, '..', '..', '.planning', 'COORDINATOR_EVENT_NARRATIVE_SHARED_SPEC.md');
    const spec = readFileSync(specPath, 'utf8');

    assert.match(spec, /Coordinator Event Narrative Shared Spec/);
    assert.match(spec, /AT-COORD-EVENT-NAR-001/);
    assert.match(spec, /AT-COORD-EVENT-NAR-004/);
    assert.match(spec, /summarizeCoordinatorEvent/);
    assert.match(spec, /cross-repo\.js/);
    assert.match(spec, /report\.js/);
  });
});
