import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

import { render as renderDelegations } from '../dashboard/components/delegations.js';
import { render as renderTimeline } from '../dashboard/components/timeline.js';

function makeState(overrides = {}) {
  return {
    run_id: 'run_del_dashboard',
    status: 'active',
    phase: 'delivery',
    active_turns: {},
    delegation_queue: [],
    pending_delegation_review: null,
    ...overrides,
  };
}

describe('Dashboard delegations view', () => {
  it('AT-DASH-DEL-004: renders active queue state and pending review state', () => {
    const html = renderDelegations({
      state: makeState({
        delegation_queue: [
          {
            delegation_id: 'del-001',
            parent_turn_id: 'turn_parent',
            parent_role: 'director',
            to_role: 'dev',
            charter: 'Build auth',
            acceptance_contract: ['Auth works'],
            status: 'completed',
            child_turn_id: 'turn_dev',
          },
          {
            delegation_id: 'del-002',
            parent_turn_id: 'turn_parent',
            parent_role: 'director',
            to_role: 'qa',
            charter: 'Review auth',
            acceptance_contract: ['Review complete'],
            status: 'pending',
            child_turn_id: null,
          },
        ],
        pending_delegation_review: {
          parent_turn_id: 'turn_parent',
          parent_role: 'director',
          delegation_results: [
            { delegation_id: 'del-001', status: 'completed' },
            { delegation_id: 'del-002', status: 'failed' },
          ],
        },
      }),
      history: [],
    });

    assert.ok(html.includes('Live Delegation State'));
    assert.ok(html.includes('delegation_queue'));
    assert.ok(html.includes('director → dev'));
    assert.ok(html.includes('review pending'));
    assert.ok(html.includes('1 completed, 1 failed'));
  });

  it('AT-DASH-DEL-005: reconstructs a completed delegation chain from accepted history', () => {
    const history = [
      {
        turn_id: 'turn_parent',
        role: 'director',
        summary: 'Delegated work to dev and qa.',
        accepted_at: '2026-04-14T07:39:48.869Z',
        delegations_issued: [
          {
            id: 'del-001',
            to_role: 'dev',
            charter: 'Build auth',
            acceptance_contract: ['Auth works'],
          },
          {
            id: 'del-002',
            to_role: 'qa',
            charter: 'Review auth',
            acceptance_contract: ['Review complete'],
          },
        ],
      },
      {
        turn_id: 'turn_dev',
        role: 'dev',
        status: 'completed',
        summary: 'Implemented delegated auth work.',
        files_changed: ['src/auth.ts'],
        delegation_context: {
          delegation_id: 'del-001',
          parent_turn_id: 'turn_parent',
          parent_role: 'director',
          charter: 'Build auth',
          acceptance_contract: ['Auth works'],
        },
      },
      {
        turn_id: 'turn_qa',
        role: 'qa',
        status: 'failed',
        summary: 'Rejected delegated auth review.',
        files_changed: ['qa/report.md'],
        delegation_context: {
          delegation_id: 'del-002',
          parent_turn_id: 'turn_parent',
          parent_role: 'director',
          charter: 'Review auth',
          acceptance_contract: ['Review complete'],
        },
      },
      {
        turn_id: 'turn_review',
        role: 'director',
        summary: 'Reviewed mixed delegation results.',
        delegation_review: {
          parent_turn_id: 'turn_parent',
          results: [
            {
              delegation_id: 'del-001',
              child_turn_id: 'turn_dev',
              to_role: 'dev',
              summary: 'Implemented delegated auth work.',
              status: 'completed',
              files_changed: ['src/auth.ts'],
            },
            {
              delegation_id: 'del-002',
              child_turn_id: 'turn_qa',
              to_role: 'qa',
              summary: 'Rejected delegated auth review.',
              status: 'failed',
              files_changed: ['qa/report.md'],
            },
          ],
        },
      },
    ];

    const html = renderDelegations({
      state: makeState({ status: 'completed' }),
      history,
    });

    assert.ok(html.includes('Delegation Chains'));
    assert.ok(html.includes('turn_parent'));
    assert.ok(html.includes('del-001'));
    assert.ok(html.includes('del-002'));
    assert.ok(html.includes('Build auth'));
    assert.ok(html.includes('Review auth'));
    assert.ok(html.includes('turn_review'));
    assert.ok(html.includes('1 completed, 1 failed'));
  });

  it('AT-DASH-DEL-006: timeline renders delegation-issued, delegated-turn, and review cues', () => {
    const html = renderTimeline({
      state: makeState({
        active_turns: {
          turn_live_review: {
            turn_id: 'turn_live_review',
            assigned_role: 'director',
            status: 'assigned',
            delegation_review: {
              parent_turn_id: 'turn_parent',
              results: [{ delegation_id: 'del-001' }, { delegation_id: 'del-002' }],
            },
          },
        },
      }),
      history: [
        {
          turn_id: 'turn_parent',
          role: 'director',
          summary: 'Delegated work.',
          delegations_issued: [{ id: 'del-001', to_role: 'dev' }],
        },
        {
          turn_id: 'turn_dev',
          role: 'dev',
          summary: 'Executed delegated work.',
          delegation_context: {
            delegation_id: 'del-001',
            parent_role: 'director',
            charter: 'Build auth',
          },
        },
        {
          turn_id: 'turn_review',
          role: 'director',
          summary: 'Reviewed delegated results.',
          delegation_review: {
            parent_turn_id: 'turn_parent',
            results: [{ delegation_id: 'del-001' }],
          },
        },
      ],
      annotations: [],
      audit: [],
      continuity: null,
      connectors: null,
      coordinatorAudit: null,
      coordinatorAnnotations: null,
    });

    assert.ok(html.includes('Delegated:'));
    assert.ok(html.includes('del-001 → dev'));
    assert.ok(html.includes('Delegation:'));
    assert.ok(html.includes('from director'));
    assert.ok(html.includes('Build auth'));
    assert.ok(html.includes('Delegation Review:'));
    assert.ok(html.includes('turn_parent'));
    assert.ok(html.includes('with 2 results'));
  });
});
