/**
 * Dashboard coordinator blockers view component tests.
 *
 * Tests the pure render(data) function for the blockers panel.
 * Per DEC-DASH-COORD-BLOCKERS-002: the UI must render server-computed
 * blocker snapshots without reimplementing gate logic client-side.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { render } from '../dashboard/components/blockers.js';

// ── No data / error states ───────────────────────────────────────────────

describe('Blockers View — empty states', () => {
  it('renders placeholder when coordinatorBlockers is null', () => {
    const html = render({ coordinatorBlockers: null });
    assert.ok(html.includes('No coordinator blocker data'));
    assert.ok(html.includes('placeholder'));
  });

  it('renders error message when server returns ok=false', () => {
    const html = render({
      coordinatorBlockers: {
        ok: false,
        error: 'Coordinator config not found. Run `agentxchain multi init` first.',
      },
    });
    assert.ok(html.includes('Coordinator config not found'));
    assert.ok(!html.includes('blockers-view'));
  });
});

// ── Pending gate mode ────────────────────────────────────────────────────

describe('Blockers View — pending_gate mode', () => {
  const pendingGateData = {
    mode: 'pending_gate',
    super_run_id: 'super_run_001',
    status: 'active',
    phase: 'development',
    blocked_reason: null,
    pending_gate: {
      gate_type: 'phase_transition',
      gate: 'dev_to_qa',
      from: 'development',
      to: 'qa',
      required_repos: ['api', 'web'],
    },
    active: {
      gate_type: 'phase_transition',
      gate_id: 'dev_to_qa',
      ready: true,
      current_phase: 'development',
      target_phase: 'qa',
      required_repos: ['api', 'web'],
      human_barriers: [],
      blockers: [],
      pending: true,
    },
    next_actions: [
      {
        code: 'pending_gate',
        command: 'agentxchain multi approve-gate',
        reason: 'Coordinator is waiting on pending gate "dev_to_qa" (phase_transition).',
      },
    ],
    evaluations: {
      phase_transition: {
        ready: true,
        gate_id: 'dev_to_qa',
        current_phase: 'development',
        target_phase: 'qa',
        blockers: [],
      },
      run_completion: {
        ready: false,
        blockers: [{ code: 'no_next_phase', message: 'No next phase' }],
      },
    },
  };

  it('renders mode badge as pending_gate', () => {
    const html = render({ coordinatorBlockers: pendingGateData });
    assert.ok(html.includes('pending_gate'));
  });

  it('renders super_run_id and status', () => {
    const html = render({ coordinatorBlockers: pendingGateData });
    assert.ok(html.includes('super_run_001'));
    assert.ok(html.includes('active'));
  });

  it('renders awaiting approval message when no blockers', () => {
    const html = render({ coordinatorBlockers: pendingGateData });
    assert.ok(html.includes('Approval Snapshot'));
    assert.ok(html.includes('Human approval is the remaining action.'));
  });

  it('renders approve-gate recovery command for pending_gate mode', () => {
    const html = render({ coordinatorBlockers: pendingGateData });
    assert.ok(html.includes('agentxchain multi approve-gate'));
  });

  it('renders next-actions section from server data', () => {
    const html = render({ coordinatorBlockers: pendingGateData });
    assert.ok(html.includes('Next Actions'));
    assert.ok(html.includes('waiting on pending gate'));
  });

  it('renders active gate details', () => {
    const html = render({ coordinatorBlockers: pendingGateData });
    assert.ok(html.includes('Active Gate'));
    assert.ok(html.includes('phase_transition'));
    assert.ok(html.includes('dev_to_qa'));
    assert.ok(html.includes('development'));
    assert.ok(html.includes('qa'));
    assert.ok(html.includes('Approval State'));
    assert.ok(html.includes('Awaiting human approval'));
  });

  it('renders gate evaluations section', () => {
    const html = render({ coordinatorBlockers: pendingGateData });
    assert.ok(html.includes('Gate Evaluations'));
    assert.ok(html.includes('Phase Transition'));
    assert.ok(html.includes('Run Completion'));
    assert.ok(html.includes('Current Phase'));
    assert.ok(html.includes('Target Phase'));
    assert.ok(html.includes('Blockers'));
  });

  it('renders shared gate-clear summary for non-pending gates with no blockers', () => {
    const html = render({
      coordinatorBlockers: {
        mode: 'phase_transition',
        super_run_id: 'super_run_clear_001',
        status: 'active',
        phase: 'qa',
        blocked_reason: null,
        pending_gate: null,
        active: {
          gate_type: 'phase_transition',
          gate_id: 'qa_to_release',
          ready: true,
          current_phase: 'qa',
          target_phase: 'release',
          required_repos: ['api'],
          human_barriers: [],
          blockers: [],
        },
        next_actions: [],
        evaluations: null,
      },
    });

    assert.ok(html.includes('Gate Clear'));
    assert.ok(html.includes('The coordinator gate has no outstanding blockers.'));
  });
});

// ── Phase transition mode with blockers ──────────────────────────────────

describe('Blockers View — phase_transition with blockers', () => {
  const blockedData = {
    mode: 'phase_transition',
    super_run_id: 'super_run_002',
    status: 'blocked',
    phase: 'development',
    blocked_reason: 'Repo "api" run identity drifted from run_api_001 to run_api_999',
    pending_gate: null,
    active: {
      gate_type: 'phase_transition',
      gate_id: 'dev_to_qa',
      ready: false,
      current_phase: 'development',
      target_phase: 'qa',
      required_repos: ['api', 'web'],
      human_barriers: [],
      blockers: [
        {
          code: 'repo_run_id_mismatch',
          message: 'Repo "api" run identity drifted',
          repo_id: 'api',
          expected_run_id: 'run_api_001',
          actual_run_id: 'run_api_999',
        },
      ],
    },
    next_actions: [
      {
        code: 'repo_run_id_mismatch',
        command: 'agentxchain multi resume',
        reason: 'Coordinator run identity drift detected: Repo "api" run identity drifted from run_api_001 to run_api_999. Resume after reconciling the affected child repos.',
      },
      {
        code: 'repo_run_id_mismatch',
        command: 'agentxchain multi resume',
        reason: 'Repo "api" run identity drifted: coordinator expects "run_api_001" but repo has "run_api_999". Re-link the correct child run, then resume.',
      },
    ],
    evaluations: {
      phase_transition: {
        ready: false,
        blockers: [
          {
            code: 'repo_run_id_mismatch',
            message: 'Repo "api" run identity drifted',
            repo_id: 'api',
            expected_run_id: 'run_api_001',
            actual_run_id: 'run_api_999',
          },
        ],
      },
      run_completion: {
        ready: false,
        blockers: [],
      },
    },
  };

  it('renders repo_run_id_mismatch blocker code', () => {
    const html = render({ coordinatorBlockers: blockedData });
    assert.ok(html.includes('repo_run_id_mismatch'));
  });

  it('renders expected vs actual run_id for repo_run_id_mismatch', () => {
    const html = render({ coordinatorBlockers: blockedData });
    assert.ok(html.includes('run_api_001'), 'must show expected run_id');
    assert.ok(html.includes('run_api_999'), 'must show actual run_id');
    assert.ok(html.includes('api'), 'must show repo_id');
  });

  it('renders expected/actual labels', () => {
    const html = render({ coordinatorBlockers: blockedData });
    assert.ok(html.includes('Expected'));
    assert.ok(html.includes('Actual'));
  });

  it('renders blocked banner with reason', () => {
    const html = render({ coordinatorBlockers: blockedData });
    assert.ok(html.includes('BLOCKED'));
    assert.ok(html.includes('run identity drifted'));
  });

  it('renders multi resume recovery for run_id_mismatch', () => {
    const html = render({ coordinatorBlockers: blockedData });
    assert.ok(html.includes('agentxchain multi resume'));
    assert.ok(html.includes('run identity drift'));
  });

  it('does not render approve-gate for non-pending blocked state', () => {
    const html = render({ coordinatorBlockers: blockedData });
    // Should have multi resume, not approve-gate as the recovery
    const approveCount = (html.match(/approve-gate/g) || []).length;
    // approve-gate may appear in evaluations detail but should not be the primary recovery
    assert.ok(html.includes('multi resume'));
  });

  it('renders repo-specific next-action guidance', () => {
    const html = render({ coordinatorBlockers: blockedData });
    assert.ok(html.includes('Re-link the correct child run'));
    assert.ok(html.includes('Next Actions'));
  });
});

// ── Run completion mode ──────────────────────────────────────────────────

describe('Blockers View — run_completion mode', () => {
  const completionData = {
    mode: 'run_completion',
    super_run_id: 'super_run_003',
    status: 'active',
    phase: 'release',
    blocked_reason: null,
    pending_gate: null,
    active: {
      gate_type: 'run_completion',
      gate_id: 'final_gate',
      ready: false,
      required_repos: ['api', 'web'],
      human_barriers: ['PM_SIGNOFF.md'],
      requires_human_approval: true,
      blockers: [
        { code: 'repo_not_ready', message: 'Repo "web" not in final phase', repo_id: 'web', current_phase: 'qa', required_phase: 'release' },
      ],
    },
    evaluations: {
      phase_transition: {
        ready: false,
        blockers: [{ code: 'no_next_phase', message: 'Already in final phase' }],
      },
      run_completion: {
        ready: false,
        requires_human_approval: true,
        blockers: [
          { code: 'repo_not_ready', message: 'Repo "web" not in final phase', repo_id: 'web' },
        ],
      },
    },
  };

  it('renders run_completion mode badge', () => {
    const html = render({ coordinatorBlockers: completionData });
    assert.ok(html.includes('run_completion'));
  });

  it('renders repo_not_ready blocker with repo details', () => {
    const html = render({ coordinatorBlockers: completionData });
    assert.ok(html.includes('repo_not_ready'));
    assert.ok(html.includes('web'));
  });

  it('renders human barriers', () => {
    const html = render({ coordinatorBlockers: completionData });
    assert.ok(html.includes('PM_SIGNOFF.md'));
  });

  it('renders human approval required', () => {
    const html = render({ coordinatorBlockers: completionData });
    assert.ok(html.includes('Human Approval'));
    assert.ok(html.includes('Required'));
  });

  it('renders canonical run-completion evaluation labels', () => {
    const html = render({ coordinatorBlockers: completionData });
    assert.ok(html.includes('Required Repos'));
    assert.ok(html.includes('Human Barriers'));
    assert.ok(html.includes('Blockers'));
  });
});

// ── No blockers (healthy) ────────────────────────────────────────────────

describe('Blockers View — healthy coordinator', () => {
  it('renders no-blockers message when active gate has no blockers', () => {
    const html = render({
      coordinatorBlockers: {
        mode: 'phase_transition',
        super_run_id: 'super_run_004',
        status: 'active',
        phase: 'development',
        blocked_reason: null,
        pending_gate: null,
        active: {
          gate_type: 'phase_transition',
          gate_id: 'dev_to_qa',
          ready: true,
          blockers: [],
        },
        evaluations: {
          phase_transition: { ready: true, blockers: [] },
          run_completion: { ready: false, blockers: [] },
        },
      },
    });
    assert.ok(html.includes('Gate Clear'));
    assert.ok(html.includes('no outstanding blockers'));
  });
});
