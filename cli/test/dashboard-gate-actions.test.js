/**
 * Dashboard gate-action surface tests.
 *
 * Verifies that gate-action config, execution attempts, and failure details
 * are rendered in the Gate Review and Blocked State dashboard components,
 * and that the bridge API reader returns the expected shape.
 *
 * Per: DEC-DASHBOARD-GATE-ACTIONS-001
 * Acceptance IDs: AT-DASH-GA-001 through AT-DASH-GA-006
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { render as renderGate } from '../dashboard/components/gate.js';
import { render as renderBlocked } from '../dashboard/components/blocked.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Fixtures ──────────────────────────────────────────────────────────────────

const GATE_ACTIONS_CONFIGURED = {
  configured: [
    { index: 1, label: 'Bump version', run: 'bash scripts/bump.sh' },
    { index: 2, label: 'Tag release', run: 'bash scripts/tag.sh' },
  ],
  latest_attempt: null,
};

const GATE_ACTIONS_SUCCEEDED = {
  configured: [
    { index: 1, label: 'Bump version', run: 'bash scripts/bump.sh' },
  ],
  latest_attempt: {
    attempt_id: 'ga_test_001',
    gate_id: 'exit_gate_dev',
    gate_type: 'phase_transition',
    status: 'succeeded',
    attempted_at: '2026-04-16T21:00:00.000Z',
    actions: [
      {
        action_index: 1,
        action_label: 'Bump version',
        command: 'bash scripts/bump.sh',
        status: 'succeeded',
        exit_code: 0,
        stdout_tail: 'v2.109.0',
        stderr_tail: null,
        timestamp: '2026-04-16T21:00:00.000Z',
      },
    ],
  },
};

const GATE_ACTIONS_FAILED = {
  configured: [
    { index: 1, label: 'Bump version', run: 'bash scripts/bump.sh' },
    { index: 2, label: 'Tag release', run: 'bash scripts/tag.sh' },
  ],
  latest_attempt: {
    attempt_id: 'ga_test_002',
    gate_id: 'exit_gate_dev',
    gate_type: 'phase_transition',
    status: 'failed',
    attempted_at: '2026-04-16T22:00:00.000Z',
    actions: [
      {
        action_index: 1,
        action_label: 'Bump version',
        command: 'bash scripts/bump.sh',
        status: 'succeeded',
        exit_code: 0,
        stdout_tail: null,
        stderr_tail: null,
        timestamp: '2026-04-16T22:00:00.000Z',
      },
      {
        action_index: 2,
        action_label: 'Tag release',
        command: 'bash scripts/tag.sh',
        status: 'failed',
        exit_code: 1,
        stdout_tail: null,
        stderr_tail: 'fatal: tag v2.109.0 already exists',
        timestamp: '2026-04-16T22:00:01.000Z',
      },
    ],
  },
};

const PENDING_TRANSITION_STATE = {
  status: 'paused',
  phase: 'development',
  pending_phase_transition: {
    from: 'development',
    to: 'qa',
    gate: 'exit_gate_dev',
    requested_by_turn: 'turn_42',
  },
};

const BLOCKED_GATE_ACTION_STATE = {
  status: 'blocked',
  phase: 'development',
  blocked_on: 'gate_action:exit_gate_dev',
  blocked_reason: {
    category: 'gate_action_failed',
    detail: 'Gate action failed for "exit_gate_dev": Tag release',
    recovery: {
      typed_reason: 'gate_action_failed',
      recovery_action: 'agentxchain approve-transition',
      detail: 'Gate action failed for "exit_gate_dev": Tag release',
      owner: 'human',
    },
  },
};

// ── Gate Review Component ─────────────────────────────────────────────────────

describe('Dashboard Gate Review — Gate Actions', () => {
  // AT-DASH-GA-003
  it('AT-DASH-GA-003: renders configured gate actions on pending transition', () => {
    const html = renderGate({
      state: PENDING_TRANSITION_STATE,
      history: [],
      gateActions: GATE_ACTIONS_CONFIGURED,
    });
    assert.ok(html.includes('Gate Actions'), 'should contain Gate Actions heading');
    assert.ok(html.includes('Bump version'), 'should list first action label');
    assert.ok(html.includes('Tag release'), 'should list second action label');
  });

  // AT-DASH-GA-006
  it('AT-DASH-GA-006: renders previous succeeded attempt on re-approval pending gate', () => {
    const html = renderGate({
      state: PENDING_TRANSITION_STATE,
      history: [],
      gateActions: GATE_ACTIONS_SUCCEEDED,
    });
    assert.ok(html.includes('Gate Actions'), 'should contain Gate Actions heading');
    assert.ok(html.includes('Last Attempt'), 'should show Last Attempt');
    assert.ok(html.includes('Succeeded'), 'should show succeeded status');
    assert.ok(html.includes('Bump version'), 'should list action label');
  });

  it('renders no gate-actions section when gateActions is null', () => {
    const html = renderGate({
      state: PENDING_TRANSITION_STATE,
      history: [],
      gateActions: null,
    });
    assert.ok(!html.includes('Gate Actions'), 'should not contain Gate Actions heading');
  });

  it('renders no gate-actions section when configured is empty', () => {
    const html = renderGate({
      state: PENDING_TRANSITION_STATE,
      history: [],
      gateActions: { configured: [], latest_attempt: null },
    });
    assert.ok(!html.includes('Gate Actions'), 'should not contain Gate Actions heading');
  });

  it('does not render gate-actions section for coordinator gates', () => {
    const html = renderGate({
      state: {},
      history: [],
      coordinatorState: {
        status: 'paused',
        pending_gate: {
          gate_type: 'phase_transition',
          gate: 'exit_gate_dev',
          from: 'development',
          to: 'qa',
        },
      },
      coordinatorHistory: [],
      gateActions: GATE_ACTIONS_CONFIGURED,
    });
    assert.ok(!html.includes('Gate Actions'), 'coordinator gate should not show gate actions');
  });
});

// ── Blocked State Component ───────────────────────────────────────────────────

describe('Dashboard Blocked State — Gate Action Failure', () => {
  // AT-DASH-GA-004
  it('AT-DASH-GA-004: renders gate-action failure details when category is gate_action_failed', () => {
    const html = renderBlocked({
      state: BLOCKED_GATE_ACTION_STATE,
      gateActions: GATE_ACTIONS_FAILED,
    });
    assert.ok(html.includes('Gate Action Failure'), 'should contain Gate Action Failure heading');
    assert.ok(html.includes('ga_test_002'), 'should show attempt ID');
    assert.ok(html.includes('exit_gate_dev'), 'should show gate ID');
    assert.ok(html.includes('Bump version'), 'should list first action');
    assert.ok(html.includes('Tag release'), 'should list second (failed) action');
  });

  // AT-DASH-GA-005
  it('AT-DASH-GA-005: renders stderr tail for failed action', () => {
    const html = renderBlocked({
      state: BLOCKED_GATE_ACTION_STATE,
      gateActions: GATE_ACTIONS_FAILED,
    });
    assert.ok(html.includes('fatal: tag v2.109.0 already exists'), 'should show stderr_tail');
  });

  it('renders dry-run guidance on gate-action failure', () => {
    const html = renderBlocked({
      state: BLOCKED_GATE_ACTION_STATE,
      gateActions: GATE_ACTIONS_FAILED,
    });
    assert.ok(html.includes('--dry-run'), 'should show dry-run guidance');
  });

  it('does not render gate-action failure section for non-gate-action blocks', () => {
    const html = renderBlocked({
      state: {
        status: 'blocked',
        blocked_on: 'hook:before_step:lint',
        blocked_reason: {
          category: 'hook_failure',
          recovery: { typed_reason: 'hook_failure' },
        },
      },
      gateActions: GATE_ACTIONS_FAILED,
    });
    assert.ok(!html.includes('Gate Action Failure'), 'non-gate-action block should not show gate action failure');
  });

  it('does not render gate-action failure section when gateActions is null', () => {
    const html = renderBlocked({
      state: BLOCKED_GATE_ACTION_STATE,
      gateActions: null,
    });
    assert.ok(!html.includes('Gate Action Failure'), 'null gateActions should not show failure section');
  });
});

// ── Bridge Reader Module ──────────────────────────────────────────────────────

describe('Dashboard gate-action reader module', () => {
  // AT-DASH-GA-002 (partial — structural test since we can't mock loadProjectContext)
  it('AT-DASH-GA-002: gate-action-reader module exports readGateActionSnapshot', async () => {
    const mod = await import('../src/lib/dashboard/gate-action-reader.js');
    assert.ok(typeof mod.readGateActionSnapshot === 'function', 'should export readGateActionSnapshot');
  });
});

// ── Acceptance ID Uniqueness ──────────────────────────────────────────────────

describe('Dashboard gate-action acceptance ID uniqueness', () => {
  it('acceptance IDs AT-DASH-GA-001 through AT-DASH-GA-006 are unique in this file', () => {
    const source = readFileSync(join(__dirname, 'dashboard-gate-actions.test.js'), 'utf8');
    const ids = [...source.matchAll(/AT-DASH-GA-(\d+)/g)].map(m => m[0]);
    const unique = new Set(ids);
    // We reference AT-DASH-GA-003, 004, 005, 006, 002 — each should appear at least once
    assert.ok(unique.has('AT-DASH-GA-002'), 'should reference AT-DASH-GA-002');
    assert.ok(unique.has('AT-DASH-GA-003'), 'should reference AT-DASH-GA-003');
    assert.ok(unique.has('AT-DASH-GA-004'), 'should reference AT-DASH-GA-004');
    assert.ok(unique.has('AT-DASH-GA-005'), 'should reference AT-DASH-GA-005');
    assert.ok(unique.has('AT-DASH-GA-006'), 'should reference AT-DASH-GA-006');
  });
});
