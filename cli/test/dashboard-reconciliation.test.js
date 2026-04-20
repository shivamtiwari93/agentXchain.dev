/**
 * Dashboard reconciliation ordering tests.
 *
 * Proves that dashboard state-reader and gate-action surfaces derive
 * recovery / next_actions from reconciled state (post-approval-repair,
 * post-stale-turn-watchdog), not from raw state.json.
 *
 * Per: DEC-STATUS-POST-RECONCILE-002
 * Acceptance IDs: AT-DASH-RECONCILE-001 through AT-DASH-RECONCILE-003
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { readResource } from '../src/lib/dashboard/state-reader.js';
import { approvePendingDashboardGate } from '../src/lib/dashboard/actions.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

function writeJson(filePath, data) {
  writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n');
}

function createGovernedFixture(stateOverrides = {}, configOverrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'axc-dash-reconcile-'));
  const axcDir = join(dir, '.agentxchain');
  mkdirSync(axcDir, { recursive: true });

  const config = {
    schema_version: '1.0',
    project: { id: 'reconcile-test', name: 'Reconcile Test', default_branch: 'main' },
    protocol_mode: 'governed',
    roles: {
      dev: {
        title: 'Developer',
        mandate: 'Implement safely.',
        write_authority: 'authoritative',
        runtime: 'local-dev',
      },
      qa: {
        title: 'QA',
        mandate: 'Challenge correctness.',
        write_authority: 'review_only',
        runtime: 'api-qa',
      },
    },
    runtimes: {
      'local-dev': { type: 'local_cli', command: ['echo', '{prompt}'], prompt_transport: 'argv' },
      'api-qa': { type: 'api_proxy', provider: 'anthropic', model: 'claude-sonnet-4-6', auth_env: 'ANTHROPIC_API_KEY' },
    },
    routing: {
      implementation: { entry_role: 'dev', allowed_next_roles: ['dev', 'qa', 'human'], exit_gate: 'implementation_complete' },
      qa: { entry_role: 'qa', allowed_next_roles: ['dev', 'qa', 'human'], exit_gate: 'qa_ship_verdict' },
    },
    gates: {
      implementation_complete: { requires_verification_pass: true },
      qa_ship_verdict: { requires_human_approval: true },
    },
    ...configOverrides,
  };

  const state = {
    schema_version: '1.1',
    project_id: 'reconcile-test',
    run_id: 'run_reconcile_01',
    status: 'active',
    phase: 'implementation',
    active_turns: {},
    turn_sequence: 0,
    accepted_count: 0,
    rejected_count: 0,
    blocked_on: null,
    blocked_reason: null,
    next_recommended_role: null,
    ...stateOverrides,
  };

  writeJson(join(dir, 'agentxchain.json'), config);
  writeJson(join(axcDir, 'state.json'), state);

  return { dir, axcDir, config, state };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('Dashboard reconciliation ordering', () => {

  it('AT-DASH-RECONCILE-001: /api/state surfaces reconciled approval-pause as pending gate, not raw orphaned blocked_on', () => {
    // Seed: state has orphaned blocked_on pointing at qa_ship_verdict
    // but no explicit pending_run_completion or pending_phase_transition.
    // After approval-pause reconciliation, this should become a
    // pending_run_completion (qa is the final phase).
    const { axcDir } = createGovernedFixture({
      status: 'blocked',
      phase: 'qa',
      blocked_on: 'human_approval:qa_ship_verdict',
      blocked_reason: { detail: 'Waiting for QA ship verdict' },
      phase_gate_status: {
        implementation_complete: 'passed',
        qa_ship_verdict: 'pending',
      },
    });

    const result = readResource(axcDir, '/api/state');
    assert.ok(result, 'readResource should return data');
    assert.equal(result.format, 'json');

    const data = result.data;

    // Reconciliation should have repaired the orphaned approval to
    // status: "paused" with pending_run_completion (qa is final phase).
    assert.equal(data.status, 'paused',
      'Approval repair should normalize status from "blocked" to "paused"');
    assert.ok(data.pending_run_completion,
      'Approval repair should synthesize pending_run_completion for final-phase qa_ship_verdict');
    assert.equal(data.pending_run_completion.gate, 'qa_ship_verdict');

    // next_actions should reflect the reconciled state, not the raw blocked_on.
    assert.ok(Array.isArray(data.next_actions), 'next_actions should be an array');
    const approveAction = data.next_actions.find(a =>
      a.command && a.command.includes('approve-completion'));
    assert.ok(approveAction,
      'next_actions should recommend approve-completion for the reconciled pending_run_completion');
  });

  it('AT-DASH-RECONCILE-002: /api/state surfaces stale-turn watchdog results in next_actions', () => {
    // Seed: a turn that has been "running" for well over the threshold
    // (dispatched >15 minutes ago with no output).
    const staleTurnId = 'turn_stale_001';
    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000).toISOString();

    const { axcDir, dir } = createGovernedFixture({
      status: 'active',
      phase: 'implementation',
      active_turns: {
        [staleTurnId]: {
          turn_id: staleTurnId,
          assigned_role: 'dev',
          runtime_id: 'local-dev',
          status: 'running',
          started_at: fifteenMinutesAgo,
          dispatched_at: fifteenMinutesAgo,
          turn_number: 1,
          attempt: 1,
          assigned_sequence: 1,
        },
      },
      turn_sequence: 1,
    });

    // No staging result, no events — the turn is truly stale.
    mkdirSync(join(dir, '.agentxchain', 'staging', staleTurnId), { recursive: true });

    const result = readResource(axcDir, '/api/state');
    assert.ok(result, 'readResource should return data');
    const data = result.data;

    // After stale-turn reconciliation, the turn should be marked as stalled.
    const turn = data.active_turns?.[staleTurnId];
    assert.ok(turn, 'Turn should still exist in active_turns');
    assert.equal(turn.status, 'stalled',
      'Stale turn should be reconciled to "stalled" status by the watchdog');
    assert.ok(turn.recovery_command,
      'Stalled turn should have a recovery_command');
    assert.ok(turn.recovery_command.includes('reissue-turn'),
      'Recovery command should recommend reissue-turn');
  });

  it('AT-DASH-RECONCILE-003: dashboard gate approval routes on reconciled state, not raw state', () => {
    // Seed: orphaned blocked_on with no explicit pending gate fields.
    // The raw state has no pending_phase_transition or pending_run_completion,
    // so without reconciliation the dashboard would return "no pending gate".
    // After reconciliation, the approval-pause repair should surface the gate.
    const { axcDir, dir } = createGovernedFixture({
      status: 'blocked',
      phase: 'qa',
      blocked_on: 'human_approval:qa_ship_verdict',
      blocked_reason: { detail: 'Waiting for QA ship verdict' },
      phase_gate_status: {
        implementation_complete: 'passed',
        qa_ship_verdict: 'pending',
      },
    });

    // Verify the raw state on disk does NOT have pending_run_completion
    const rawState = JSON.parse(readFileSync(join(axcDir, 'state.json'), 'utf8'));
    assert.equal(rawState.pending_run_completion, undefined,
      'Pre-condition: raw state should not have pending_run_completion');

    // Now read via the reconciled dashboard path — this triggers
    // loadProjectState which writes reconciled state to disk
    const result = readResource(axcDir, '/api/state');
    assert.ok(result.data.pending_run_completion,
      'Dashboard should show reconciled pending_run_completion');

    // After readResource, the reconciled state should be persisted on disk
    const reconciledDisk = JSON.parse(readFileSync(join(axcDir, 'state.json'), 'utf8'));
    assert.ok(reconciledDisk.pending_run_completion,
      'Reconciled state should be persisted to disk so gate approval routes correctly');
    assert.equal(reconciledDisk.pending_run_completion.gate, 'qa_ship_verdict');
  });

  it('AT-DASH-RECONCILE-004: dashboard approval bridge completes repaired final-phase approval', () => {
    const { axcDir } = createGovernedFixture({
      status: 'blocked',
      phase: 'qa',
      blocked_on: 'human_approval:qa_ship_verdict',
      blocked_reason: {
        detail: 'Waiting for QA ship verdict',
        turn_id: 'turn_qa_legacy',
      },
      phase_gate_status: {
        implementation_complete: 'passed',
        qa_ship_verdict: 'pending',
      },
    });

    const result = approvePendingDashboardGate(axcDir);
    assert.equal(result.status, 200, 'dashboard approval should succeed on repaired final-phase approval');
    assert.equal(result.body.ok, true);
    assert.equal(result.body.scope, 'repo');
    assert.equal(result.body.gate_type, 'run_completion');
    assert.equal(result.body.status, 'completed');

    const diskState = JSON.parse(readFileSync(join(axcDir, 'state.json'), 'utf8'));
    assert.equal(diskState.status, 'completed', 'disk state should complete after dashboard approval');
    assert.equal(diskState.pending_run_completion, null, 'pending completion should be cleared after approval');
    assert.equal(diskState.phase_gate_status?.qa_ship_verdict, 'passed', 'final gate should be marked passed');
  });

  it('AT-DASH-RECONCILE-005: dashboard approval bridge advances repaired non-final approval as phase transition', () => {
    const { axcDir } = createGovernedFixture({
      status: 'blocked',
      phase: 'implementation',
      blocked_on: 'human_approval:implementation_complete',
      blocked_reason: {
        detail: 'Waiting for implementation signoff',
        turn_id: 'turn_impl_legacy',
      },
      phase_gate_status: {
        implementation_complete: 'pending',
      },
    }, {
      gates: {
        implementation_complete: { requires_human_approval: true },
        qa_ship_verdict: { requires_human_approval: true },
      },
    });

    const result = approvePendingDashboardGate(axcDir);
    assert.equal(result.status, 200, 'dashboard approval should succeed on repaired non-final approval');
    assert.equal(result.body.ok, true);
    assert.equal(result.body.scope, 'repo');
    assert.equal(result.body.gate_type, 'phase_transition');
    assert.equal(result.body.status, 'active');
    assert.equal(result.body.phase, 'qa');

    const diskState = JSON.parse(readFileSync(join(axcDir, 'state.json'), 'utf8'));
    assert.equal(diskState.status, 'active', 'disk state should return to active after approval');
    assert.equal(diskState.phase, 'qa', 'phase should advance after repaired phase-transition approval');
    assert.equal(diskState.pending_phase_transition, null, 'pending transition should be cleared after approval');
    assert.equal(diskState.phase_gate_status?.implementation_complete, 'passed', 'phase gate should be marked passed');
  });
});
