/**
 * Dashboard view component tests — Slice 2
 *
 * Tests the pure render(data) functions for all five dashboard views.
 * Each component is a pure function: data in, HTML string out. No DOM required.
 *
 * See: V2_DASHBOARD_SPEC.md, DASHBOARD_IMPLEMENTATION_PLAN.md
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { render as renderTimeline } from '../dashboard/components/timeline.js';
import { filterEntries, render as renderLedger } from '../dashboard/components/ledger.js';
import { render as renderHooks } from '../dashboard/components/hooks.js';
import { render as renderBlocked } from '../dashboard/components/blocked.js';
import { render as renderGate, findPostGateTurns, aggregateEvidence } from '../dashboard/components/gate.js';
import { render as renderInitiative } from '../dashboard/components/initiative.js';
import { render as renderCrossRepo } from '../dashboard/components/cross-repo.js';

// ── Timeline View ──────────────────────────────────────────────────────────

describe('Timeline View', () => {
  it('renders no-run placeholder when state is null', () => {
    const html = renderTimeline({ state: null, history: [] });
    assert.ok(html.includes('No Run'));
    assert.ok(html.includes('agentxchain init --governed'));
  });

  it('renders run header with run_id, status, phase', () => {
    const html = renderTimeline({
      state: {
        run_id: 'run_abc123',
        status: 'running',
        phase: 'development',
        active_turns: {},
      },
      history: [],
    });
    assert.ok(html.includes('run_abc123'));
    assert.ok(html.includes('running'));
    assert.ok(html.includes('development'));
    assert.ok(html.includes('0 turns completed'));
  });

  it('renders active turns section', () => {
    const html = renderTimeline({
      state: {
        run_id: 'run_001',
        status: 'running',
        phase: 'development',
        active_turns: {
          t1: { turn_id: 'turn_001', assigned_role: 'dev', status: 'assigned' },
        },
      },
      history: [],
    });
    assert.ok(html.includes('Active Turns'));
    assert.ok(html.includes('turn_001'));
    assert.ok(html.includes('dev'));
  });

  it('renders turn history with summary, files, decisions, objections, risks', () => {
    const history = [{
      turn_id: 'turn_001',
      role: 'pm',
      summary: 'Defined auth scope',
      observed_artifact: { files_changed: ['src/auth.ts'] },
      decisions: [{ id: 'DEC-001', statement: 'Use JWT' }],
      objections: [{ id: 'OBJ-001', severity: 'high', statement: 'No rate limiting' }],
      risks: [{ statement: 'Token expiry edge case' }],
      normalized_verification: { evidence_summary: 'npm test passed' },
    }];
    const html = renderTimeline({
      state: { run_id: 'run_001', status: 'running', phase: 'development', active_turns: {} },
      history,
    });
    assert.ok(html.includes('Turn History'));
    assert.ok(html.includes('Defined auth scope'));
    assert.ok(html.includes('src/auth.ts'));
    assert.ok(html.includes('Use JWT'));
    assert.ok(html.includes('No rate limiting'));
    assert.ok(html.includes('Token expiry edge case'));
    assert.ok(html.includes('npm test passed'));
    assert.ok(html.includes('1 turn completed'));
  });

  it('renders multiple turns in reverse order (newest first)', () => {
    const history = [
      { turn_id: 'turn_001', role: 'pm', summary: 'First' },
      { turn_id: 'turn_002', role: 'dev', summary: 'Second' },
    ];
    const html = renderTimeline({
      state: { run_id: 'run_001', status: 'running', phase: 'development', active_turns: {} },
      history,
    });
    const firstIdx = html.indexOf('Second');
    const secondIdx = html.indexOf('First');
    assert.ok(firstIdx < secondIdx, 'Newest turn should appear first');
  });

  it('escapes HTML in user-provided content', () => {
    const html = renderTimeline({
      state: { run_id: 'run_<xss>', status: 'running', phase: 'dev', active_turns: {} },
      history: [{ turn_id: 't1', role: 'pm', summary: '<script>alert(1)</script>' }],
    });
    assert.ok(!html.includes('<script>'));
    assert.ok(html.includes('&lt;script&gt;'));
    assert.ok(html.includes('run_&lt;xss&gt;'));
  });

  it('renders continuity details and restart guidance when continuity exists', () => {
    const html = renderTimeline({
      state: { run_id: 'run_001', status: 'active', phase: 'implementation', active_turns: {} },
      continuity: {
        checkpoint: {
          session_id: 'session_001',
          run_id: 'run_001',
          checkpoint_reason: 'turn_accepted',
          last_checkpoint_at: '2026-04-09T22:00:00Z',
          last_turn_id: 'turn_003',
          last_role: 'dev',
        },
        stale_checkpoint: false,
        recovery_report_path: '.agentxchain/SESSION_RECOVERY.md',
        restart_recommended: true,
        recommended_command: 'agentxchain restart',
        recommended_reason: 'restart_available',
        recommended_detail: 'rebuild session context from disk',
        drift_detected: false,
        drift_warnings: [],
      },
      history: [],
    });

    assert.ok(html.includes('Continuity'));
    assert.ok(html.includes('session_001'));
    assert.ok(html.includes('turn_accepted at 2026-04-09T22:00:00Z'));
    assert.ok(html.includes('Action:'));
    assert.ok(html.includes('agentxchain restart'));
    assert.ok(html.includes('none detected since checkpoint'));
    assert.ok(html.includes('.agentxchain/SESSION_RECOVERY.md'));
  });

  it('renders stale continuity warning and omits restart when restart is untruthful', () => {
    const html = renderTimeline({
      state: { run_id: 'run_001', status: 'blocked', phase: 'implementation', active_turns: {} },
      continuity: {
        checkpoint: {
          session_id: 'session_001',
          run_id: 'run_old',
          checkpoint_reason: 'phase_approved',
          last_checkpoint_at: '2026-04-09T22:00:00Z',
          last_turn_id: 'turn_002',
          last_role: 'pm',
        },
        stale_checkpoint: true,
        recovery_report_path: null,
        restart_recommended: false,
        recommended_command: null,
        recommended_reason: 'blocked',
        recommended_detail: null,
        drift_detected: null,
        drift_warnings: [],
      },
      history: [],
    });

    assert.ok(html.includes('state.json remains source of truth'));
    assert.ok(!html.includes('agentxchain restart'));
  });

  it('renders exact approval action and checkpoint drift warnings', () => {
    const html = renderTimeline({
      state: { run_id: 'run_001', status: 'paused', phase: 'implementation', active_turns: {} },
      continuity: {
        checkpoint: {
          session_id: 'session_002',
          run_id: 'run_001',
          checkpoint_reason: 'turn_accepted',
          last_checkpoint_at: '2026-04-09T22:00:00Z',
          last_turn_id: 'turn_004',
          last_role: 'pm',
        },
        stale_checkpoint: false,
        recovery_report_path: null,
        restart_recommended: false,
        recommended_command: 'agentxchain approve-transition',
        recommended_reason: 'pending_phase_transition',
        recommended_detail: 'planning -> implementation (gate: planning_signoff)',
        drift_detected: true,
        drift_warnings: [
          'Git HEAD has moved since checkpoint: deadbeef -> cafebabe',
          'Workspace was clean at checkpoint but is now dirty',
        ],
      },
      history: [],
    });

    assert.ok(html.includes('agentxchain approve-transition'));
    assert.ok(html.includes('planning -&gt; implementation (gate: planning_signoff)'));
    assert.ok(html.includes('Git HEAD has moved since checkpoint'));
    assert.ok(html.includes('Workspace was clean at checkpoint but is now dirty'));
  });
});

// ── Ledger View ────────────────────────────────────────────────────────────

describe('Ledger View', () => {
  it('renders empty placeholder when no decisions', () => {
    const html = renderLedger({ ledger: [] });
    assert.ok(html.includes('No decisions recorded'));
  });

  it('renders null placeholder', () => {
    const html = renderLedger({ ledger: null });
    assert.ok(html.includes('No decisions recorded'));
  });

  it('renders decision table with turn, agent, decision', () => {
    const html = renderLedger({
      ledger: [
        { turn: 1, agent: 'pm', decision: 'Auth middleware with JWT' },
        { turn: 2, agent: 'dev', decision: 'Chose RS256 over HS256' },
      ],
    });
    assert.ok(html.includes('Decision Ledger'));
    assert.ok(html.includes('2 decisions'));
    assert.ok(html.includes('Auth middleware with JWT'));
    assert.ok(html.includes('RS256'));
    assert.ok(html.includes('<table'));
  });

  it('filters decisions by agent and query', () => {
    const ledger = [
      { turn: 1, agent: 'pm', decision: 'Auth middleware with JWT' },
      { turn: 2, agent: 'qa', decision: 'Reject until refresh tokens are tested' },
      { turn: 3, agent: 'dev', decision: 'Chose RS256 over HS256' },
    ];

    assert.deepEqual(
      filterEntries(ledger, { agent: 'qa' }).map((entry) => entry.turn),
      [2]
    );

    assert.deepEqual(
      filterEntries(ledger, { query: 'rs256' }).map((entry) => entry.turn),
      [3]
    );
  });

  it('renders filter controls and filtered rows', () => {
    const html = renderLedger({
      ledger: [
        { turn: 1, agent: 'pm', decision: 'Scope auth' },
        { turn: 2, agent: 'qa', decision: 'Need refresh coverage' },
      ],
      filter: { agent: 'qa', query: '' },
    });

    assert.ok(html.includes('data-view-control="ledger-agent"'));
    assert.ok(html.includes('Need refresh coverage'));
    assert.ok(!html.includes('Scope auth'));
    assert.ok(html.includes('1 of 2 decisions shown'));
  });

  it('escapes HTML in decisions', () => {
    const html = renderLedger({
      ledger: [{ turn: 1, agent: 'pm', decision: '<img src=x onerror=alert(1)>' }],
    });
    assert.ok(!html.includes('<img'));
    assert.ok(html.includes('&lt;img'));
  });

  it('escapes single quotes in filter values and decision text', () => {
    const html = renderLedger({
      ledger: [{ turn: 1, agent: "pm's", decision: "review user's auth flow" }],
      filter: { agent: "pm's", query: "user's" },
    });
    assert.ok(html.includes('pm&#39;s'));
    assert.ok(html.includes('user&#39;s'));
    assert.ok(!html.includes("value=\"pm's\""));
  });

  it('renders coordinator decisions when only coordinator context exists', () => {
    const html = renderLedger({
      coordinatorState: { super_run_id: 'srun_001' },
      coordinatorLedger: [
        { turn: 'coord-1', role: 'architect', decision: 'Freeze repo contract', timestamp: '2026-04-12T16:00:00Z' },
      ],
    });

    assert.ok(html.includes('Coordinator Decision Ledger'));
    assert.ok(html.includes('Freeze repo contract'));
    assert.ok(!html.includes('No decisions recorded yet.'));
  });

  it('renders both repo-local and coordinator sections when both ledgers exist', () => {
    const html = renderLedger({
      state: { run_id: 'run_001' },
      ledger: [{ turn: 1, agent: 'pm', decision: 'Approve scope' }],
      coordinatorState: { super_run_id: 'srun_001' },
      coordinatorLedger: [{ turn: 'coord-1', role: 'architect', decision: 'Sync repos' }],
    });

    assert.ok(html.includes('Repo Decision Ledger'));
    assert.ok(html.includes('Coordinator Decision Ledger'));
    assert.ok(html.includes('Approve scope'));
    assert.ok(html.includes('Sync repos'));
  });
});

// ── Hooks View ─────────────────────────────────────────────────────────────

describe('Hooks View', () => {
  it('renders empty placeholder when no audit or annotations', () => {
    const html = renderHooks({ audit: [], annotations: [] });
    assert.ok(html.includes('No hook activity'));
  });

  it('renders audit table with phase, hook, verdict, duration', () => {
    const html = renderHooks({
      audit: [
        { timestamp: '2026-04-02T12:00:00Z', hook_phase: 'before_validation', hook_name: 'lint', verdict: 'allow', orchestrator_action: 'continued', duration_ms: 120 },
        { timestamp: '2026-04-02T12:00:01Z', hook_phase: 'before_acceptance', hook_name: 'sast', verdict: 'block', orchestrator_action: 'blocked', duration_ms: 450 },
      ],
      annotations: [],
    });
    assert.ok(html.includes('Hook Audit Log'));
    assert.ok(html.includes('2 hook executions'));
    assert.ok(html.includes('before_validation'));
    assert.ok(html.includes('lint'));
    assert.ok(html.includes('120ms'));
    assert.ok(html.includes('block'));
  });

  it('renders annotations section', () => {
    const html = renderHooks({
      audit: [],
      annotations: [
        { turn_id: 'turn_001', hook_name: 'sast', annotations: [{ key: 'result', value: 'SAST clean' }] },
      ],
    });
    assert.ok(html.includes('Hook Annotations'));
    assert.ok(html.includes('1 annotation'));
    assert.ok(html.includes('SAST clean'));
  });

  it('renders both audit and annotations together', () => {
    const html = renderHooks({
      audit: [{ timestamp: '2026-04-02T12:00:00Z', hook_phase: 'before_validation', hook_name: 'lint', verdict: 'allow', orchestrator_action: 'continued', duration_ms: 50 }],
      annotations: [{ turn_id: 'turn_001', hook_name: 'coverage', annotations: [{ key: 'coverage', value: '92%' }] }],
    });
    assert.ok(html.includes('Hook Audit Log'));
    assert.ok(html.includes('Hook Annotations'));
  });

  it('renders coordinator audit section when coordinator data exists', () => {
    const html = renderHooks({
      audit: [],
      annotations: [],
      coordinatorAudit: [
        { timestamp: '2026-04-12T12:00:00Z', hook_phase: 'before_assignment', hook_name: 'gate-check', verdict: 'allow', orchestrator_action: 'continued', duration_ms: 80 },
      ],
      coordinatorAnnotations: [],
    });
    assert.ok(html.includes('Coordinator Hook Audit Log'));
    assert.ok(html.includes('before_assignment'));
    assert.ok(html.includes('gate-check'));
    assert.ok(html.includes('80ms'));
  });

  it('renders coordinator annotations section when coordinator annotations exist', () => {
    const html = renderHooks({
      audit: [],
      annotations: [],
      coordinatorAudit: [],
      coordinatorAnnotations: [
        { turn_id: 'coord_turn_001', hook_name: 'post-accept', annotations: [{ key: 'status', value: 'synced' }] },
      ],
    });
    assert.ok(html.includes('Coordinator Hook Annotations'));
    assert.ok(html.includes('synced'));
    assert.ok(html.includes('coord_turn_001'));
  });

  it('renders separate Repo and Coordinator section titles when both have data', () => {
    const html = renderHooks({
      audit: [
        { timestamp: '2026-04-12T12:00:00Z', hook_phase: 'before_validation', hook_name: 'lint', verdict: 'allow', orchestrator_action: 'continued', duration_ms: 50 },
      ],
      annotations: [
        { turn_id: 'turn_001', hook_name: 'sast', annotations: [{ key: 'result', value: 'clean' }] },
      ],
      coordinatorAudit: [
        { timestamp: '2026-04-12T12:00:01Z', hook_phase: 'before_gate', hook_name: 'gate-lint', verdict: 'allow', orchestrator_action: 'continued', duration_ms: 30 },
      ],
      coordinatorAnnotations: [
        { turn_id: 'coord_turn_001', hook_name: 'post-accept', annotations: [{ key: 'synced', value: 'true' }] },
      ],
    });
    assert.ok(html.includes('Repo Hook Audit Log'));
    assert.ok(html.includes('Coordinator Hook Audit Log'));
    assert.ok(html.includes('Repo Hook Annotations'));
    assert.ok(html.includes('Coordinator Hook Annotations'));
  });

  it('does not render coordinator sections when coordinator data is null', () => {
    const html = renderHooks({
      audit: [
        { timestamp: '2026-04-12T12:00:00Z', hook_phase: 'before_validation', hook_name: 'lint', verdict: 'allow', orchestrator_action: 'continued', duration_ms: 50 },
      ],
      annotations: [],
      coordinatorAudit: null,
      coordinatorAnnotations: null,
    });
    assert.ok(html.includes('Hook Audit Log'));
    assert.ok(!html.includes('Coordinator'));
    assert.ok(!html.includes('Repo Hook'));
  });

  it('filter bar includes phases from both repo and coordinator sources', () => {
    const html = renderHooks({
      audit: [
        { timestamp: '2026-04-12T12:00:00Z', hook_phase: 'before_validation', hook_name: 'lint', verdict: 'allow', orchestrator_action: 'continued', duration_ms: 50 },
      ],
      annotations: [],
      coordinatorAudit: [
        { timestamp: '2026-04-12T12:00:01Z', hook_phase: 'before_assignment', hook_name: 'gate-check', verdict: 'allow', orchestrator_action: 'continued', duration_ms: 30 },
      ],
      coordinatorAnnotations: [],
    });
    // Filter bar should include phases from both sources
    assert.ok(html.includes('before_validation'));
    assert.ok(html.includes('before_assignment'));
    assert.ok(html.includes('lint'));
    assert.ok(html.includes('gate-check'));
  });
});

describe('Initiative View', () => {
  it('renders placeholder when coordinator state is missing', () => {
    const html = renderInitiative({ coordinatorState: null });
    assert.ok(html.includes('No Initiative'));
    assert.ok(html.includes('agentxchain multi init'));
  });

  it('renders coordinator summary, repo runs, pending gate, and barriers', () => {
    const html = renderInitiative({
      coordinatorState: {
        super_run_id: 'srun_123',
        status: 'paused',
        phase: 'integration',
        pending_gate: {
          gate_type: 'phase_transition',
          gate: 'phase_transition:integration->release',
          required_repos: ['api', 'web'],
        },
        repo_runs: {
          api: { run_id: 'run_api', status: 'linked', phase: 'integration' },
          web: { run_id: 'run_web', status: 'initialized', phase: 'integration' },
        },
      },
      coordinatorBarriers: {
        backend_completion: {
          workstream_id: 'backend',
          type: 'all_repos_accepted',
          status: 'partially_satisfied',
          required_repos: ['api', 'web'],
          satisfied_repos: ['api'],
        },
      },
      barrierLedger: [
        { barrier_id: 'backend_completion', previous_status: 'pending', new_status: 'partially_satisfied' },
      ],
    });

    assert.ok(html.includes('srun_123'));
    assert.ok(html.includes('phase_transition:integration-&gt;release') || html.includes('phase_transition:integration->release'));
    assert.ok(html.includes('agentxchain multi approve-gate'));
    assert.ok(html.includes('run_api'));
    assert.ok(html.includes('backend_completion'));
    assert.ok(html.includes('partially_satisfied'));
  });

  it('renders structured coordinator blockers in initiative attention state', () => {
    const html = renderInitiative({
      coordinatorState: {
        super_run_id: 'srun_456',
        status: 'blocked',
        phase: 'integration',
        blocked_reason: 'Repo "api" run identity drifted from run_api_001 to run_api_999',
        repo_runs: {
          api: { run_id: 'run_api_999', status: 'linked', phase: 'integration' },
        },
      },
      coordinatorBlockers: {
        ok: true,
        mode: 'phase_transition',
        blocked_reason: 'Repo "api" run identity drifted from run_api_001 to run_api_999',
        next_actions: [
          {
            code: 'repo_run_id_mismatch',
            command: 'agentxchain multi resume',
            reason: 'Coordinator run identity drift detected: Repo "api" run identity drifted from run_api_001 to run_api_999. Resume after reconciling the affected child repos.',
          },
        ],
        active: {
          gate_type: 'phase_transition',
          gate_id: 'phase_transition:integration->release',
          current_phase: 'integration',
          target_phase: 'release',
          blockers: [
            {
              code: 'repo_run_id_mismatch',
              message: 'Repo "api" run identity drifted: coordinator expects "run_api_001" but repo has "run_api_999"',
              repo_id: 'api',
              expected_run_id: 'run_api_001',
              actual_run_id: 'run_api_999',
            },
          ],
        },
      },
    });

    assert.ok(html.includes('Blocker Snapshot'));
    assert.ok(html.includes('repo_run_id_mismatch'));
    assert.ok(html.includes('run_api_001'));
    assert.ok(html.includes('run_api_999'));
    assert.ok(html.includes('Open Blockers view'));
    assert.ok(html.includes('#blockers'));
    assert.ok(html.includes('Next Actions'));
    assert.ok(html.includes('agentxchain multi resume'));
  });
});

describe('Cross-Repo View', () => {
  it('renders placeholder when coordinator state is missing', () => {
    const html = renderCrossRepo({ coordinatorState: null });
    assert.ok(html.includes('No Cross-Repo Timeline'));
  });

  it('renders recognized events newest-first and keeps unknown event types', () => {
    const html = renderCrossRepo({
      coordinatorState: { super_run_id: 'srun_123' },
      coordinatorHistory: [
        { type: 'turn_dispatched', timestamp: '2026-04-02T12:00:00Z', repo_id: 'api', workstream_id: 'backend', repo_turn_id: 'turn_api_001' },
        { type: 'mystery_event', timestamp: '2026-04-02T12:05:00Z', repo_id: 'web' },
      ],
    });

    assert.ok(html.includes('Unknown Event') || html.includes('mystery_event'));
    assert.ok(html.includes('Turn Dispatched'));
    assert.ok(html.indexOf('Unknown Event') < html.indexOf('Turn Dispatched') || html.indexOf('mystery_event') < html.indexOf('Turn Dispatched'));
  });
});

// ── Blocked View ───────────────────────────────────────────────────────────

describe('Blocked View', () => {
  it('renders not-blocked placeholder when status is not blocked', () => {
    const html = renderBlocked({ state: { status: 'running' } });
    assert.ok(html.includes('not currently blocked'));
  });

  it('renders not-blocked placeholder when state is null', () => {
    const html = renderBlocked({ state: null });
    assert.ok(html.includes('not currently blocked'));
  });

  it('renders blocked banner with reason', () => {
    const html = renderBlocked({
      state: {
        status: 'blocked',
        blocked_on: 'hook:before_validation:lint',
        blocked_reason: {
          category: 'hook_block',
          blocked_at: '2026-04-02T12:00:00Z',
          turn_id: 'turn_003',
          recovery: {
            typed_reason: 'hook_block',
            owner: 'human',
            recovery_action: 'agentxchain accept-turn --turn turn_003',
            turn_retained: true,
            detail: 'Hook lint failed with exit code 1',
          },
        },
      },
    });
    assert.ok(html.includes('BLOCKED'));
    assert.ok(html.includes('hook_block'));
    assert.ok(html.includes('Hook lint failed with exit code 1'));
    assert.ok(html.includes('hook:before_validation:lint'));
    assert.ok(html.includes('turn_003'));
  });

  it('renders recovery command with copy affordance when present', () => {
    const html = renderBlocked({
      state: {
        status: 'blocked',
        blocked_reason: {
          category: 'pending_phase_transition',
          recovery: {
            recovery_action: 'agentxchain approve-transition',
          },
        },
      },
    });
    assert.ok(html.includes('Recovery'));
    assert.ok(html.includes('agentxchain approve-transition'));
    assert.ok(html.includes('data-copy="agentxchain approve-transition"'));
  });

  it('renders hook-specific audit context when the block came from a hook', () => {
    const html = renderBlocked({
      state: {
        status: 'blocked',
        blocked_on: 'hook:before_validation:lint',
        blocked_reason: {
          category: 'hook_block',
        },
      },
      audit: [
        { hook_phase: 'before_validation', hook_name: 'schema-check', verdict: 'allow', orchestrator_action: 'continued', duration_ms: 40 },
        { hook_phase: 'before_validation', hook_name: 'lint', verdict: 'block', orchestrator_action: 'blocked', duration_ms: 120 },
        { hook_phase: 'after_acceptance', hook_name: 'sast', verdict: 'warn', orchestrator_action: 'warned', duration_ms: 210 },
      ],
    });

    assert.ok(html.includes('Recent Audit Context'));
    assert.ok(html.includes('before_validation'));
    assert.ok(html.includes('lint'));
    assert.ok(html.includes('block -&gt; blocked (120ms)') || html.includes('block -&gt; blocked'));
    assert.ok(!html.includes('schema-check'));
    assert.ok(!html.includes('after_acceptance'));
  });

  it('renders recent validation audit context for validation-driven blocks', () => {
    const html = renderBlocked({
      state: {
        status: 'blocked',
        blocked_on: 'validator:turn-result',
        blocked_reason: {
          category: 'validation_failed',
        },
      },
      audit: [
        { hook_phase: 'before_assignment', hook_name: 'assignment-guard', verdict: 'allow', orchestrator_action: 'continued', duration_ms: 10 },
        { hook_phase: 'before_validation', hook_name: 'lint', verdict: 'allow', orchestrator_action: 'continued', duration_ms: 60 },
        { hook_phase: 'after_validation', hook_name: 'policy', verdict: 'warn', orchestrator_action: 'warned', duration_ms: 20 },
      ],
    });

    assert.ok(html.includes('Recent Audit Context'));
    assert.ok(html.includes('before_validation'));
    assert.ok(html.includes('after_validation'));
    assert.ok(!html.includes('assignment-guard'));
  });

  it('escapes HTML in blocked reason', () => {
    const html = renderBlocked({
      state: {
        status: 'blocked',
        blocked_reason: { category: '<b>xss</b>' },
      },
    });
    assert.ok(!html.includes('<b>xss</b>'));
    assert.ok(html.includes('&lt;b&gt;xss&lt;/b&gt;'));
  });

  it('renders coordinator blocked state when repo-local state is absent', () => {
    const html = renderBlocked({
      state: null,
      coordinatorState: {
        status: 'blocked',
        blocked_reason: 'coordinator_hook_violation',
        pending_gate: { gate: 'initiative_ship', gate_type: 'run_completion' },
        repo_runs: {
          api: { status: 'linked', phase: 'integration' },
        },
      },
      coordinatorAudit: [
        { hook_phase: 'before_gate', hook_name: 'release-guard', verdict: 'block', orchestrator_action: 'blocked', duration_ms: 42 },
      ],
    });

    assert.ok(html.includes('coordinator_hook_violation'));
    assert.ok(html.includes('agentxchain multi approve-gate'));
    assert.ok(html.includes('Repo Status'));
    assert.ok(html.includes('release-guard'));
  });

  it('AT-RBDAP-002: renders runtime guidance and ordered next actions when present', () => {
    const html = renderBlocked({
      state: {
        status: 'blocked',
        blocked_on: 'dispatch:awaiting_operator_followup',
        blocked_reason: {
          category: 'dispatch_error',
          recovery: {
            typed_reason: 'dispatch_error',
            owner: 'human',
            recovery_action: 'agentxchain step --resume',
            turn_retained: true,
            detail: 'Dispatch paused until required files are materialized.',
          },
        },
        runtime_guidance: [
          {
            code: 'proposal_apply_required',
            command: 'agentxchain proposal apply turn_dev_001',
            reason: 'Artifact ".planning/IMPLEMENTATION_NOTES.md" is owned by "dev" and stages required files behind proposal apply.',
          },
        ],
        next_actions: [
          {
            command: 'agentxchain proposal apply turn_dev_001',
            reason: 'Artifact ".planning/IMPLEMENTATION_NOTES.md" is owned by "dev" and stages required files behind proposal apply.',
          },
          {
            command: 'agentxchain step --resume',
            reason: 'After resolving the proposal_apply_required blocker, continue the run.',
          },
        ],
      },
    });

    assert.ok(html.includes('Runtime Guidance'));
    assert.ok(html.includes('proposal_apply_required'));
    assert.ok(html.includes('agentxchain proposal apply turn_dev_001'));
    assert.ok(html.includes('Next Actions'));
    assert.ok(html.includes('After resolving the proposal_apply_required blocker'));
  });
});

// ── Gate View ──────────────────────────────────────────────────────────────

describe('Gate View', () => {
  it('renders no-gate placeholder when no pending gates', () => {
    const html = renderGate({ state: { status: 'running' } });
    assert.ok(html.includes('No pending gates'));
  });

  it('renders paused hint when status is paused but no pending', () => {
    const html = renderGate({ state: { status: 'paused' } });
    assert.ok(html.includes('paused'));
    assert.ok(html.includes('agentxchain status'));
  });

  it('renders phase transition gate with approve button and CLI fallback', () => {
    const html = renderGate({
      state: {
        status: 'paused',
        phase: 'planning',
        pending_phase_transition: {
          from: 'planning',
          to: 'development',
          gate: 'plan-exit',
          requested_by_turn: 'turn_001',
        },
      },
      history: [
        {
          turn_id: 'turn_001',
          assigned_role: 'pm',
          summary: 'All planning criteria met',
          objections: [{ statement: 'One objection remains' }],
          risks: [{ statement: 'Scope risk' }],
        },
      ],
    });
    assert.ok(html.includes('Phase Transition Gate'));
    assert.ok(html.includes('planning'));
    assert.ok(html.includes('development'));
    assert.ok(html.includes('plan-exit'));
    assert.ok(html.includes('All planning criteria met'));
    assert.ok(html.includes('One objection remains'));
    assert.ok(html.includes('data-dashboard-action="approve-gate"'));
    assert.ok(html.includes('Approve Transition'));
    assert.ok(html.includes('agentxchain approve-transition'));
  });

  it('renders run completion gate with approve button and CLI fallback', () => {
    const html = renderGate({
      state: {
        status: 'paused',
        pending_run_completion: {
          gate: 'ship-approval',
          requested_by_turn: 'turn_002',
        },
      },
      history: [
        {
          turn_id: 'turn_002',
          assigned_role: 'qa',
          summary: 'All tests passing, QA approved',
          objections: [{ statement: 'Refresh token coverage unresolved' }],
        },
      ],
    });
    assert.ok(html.includes('Run Completion Gate'));
    assert.ok(html.includes('ship-approval'));
    assert.ok(html.includes('All tests passing'));
    assert.ok(html.includes('turn_002'));
    assert.ok(html.includes('Approve Completion'));
    assert.ok(html.includes('agentxchain approve-completion'));
  });

  it('renders both gates simultaneously', () => {
    const html = renderGate({
      state: {
        status: 'paused',
        phase: 'delivery',
        pending_phase_transition: { to: 'done' },
        pending_run_completion: { evidence: 'Ship it' },
      },
    });
    assert.ok(html.includes('Phase Transition Gate'));
    assert.ok(html.includes('Run Completion Gate'));
  });

  it('aggregates evidence from multiple post-gate turns', () => {
    const html = renderGate({
      state: {
        status: 'paused',
        phase: 'development',
        pending_phase_transition: {
          from: 'development',
          to: 'delivery',
          gate: 'dev-exit',
          requested_by_turn: 'turn_003',
        },
      },
      history: [
        {
          turn_id: 'turn_001',
          assigned_role: 'dev',
          summary: 'Implemented auth middleware',
          objections: [{ statement: 'No rate limiting' }],
          risks: [{ statement: 'Token refresh missing' }],
          observed_artifact: { files_changed: ['src/auth.ts'] },
        },
        {
          turn_id: 'turn_002',
          assigned_role: 'qa',
          summary: 'Wrote acceptance tests for auth',
          objections: [{ statement: 'Edge case in expiry' }],
          observed_artifact: { files_changed: ['test/auth.test.ts'] },
        },
        {
          turn_id: 'turn_003',
          assigned_role: 'dev',
          summary: 'Fixed rate limiting and refresh',
          risks: [{ statement: 'Performance impact untested' }],
          observed_artifact: { files_changed: ['src/auth.ts', 'src/rate-limit.ts'] },
        },
      ],
    });
    assert.ok(html.includes('Implemented auth middleware'));
    assert.ok(html.includes('Wrote acceptance tests'));
    assert.ok(html.includes('Fixed rate limiting'));
    assert.ok(html.includes('No rate limiting'));
    assert.ok(html.includes('Edge case in expiry'));
    assert.ok(html.includes('Token refresh missing'));
    assert.ok(html.includes('Performance impact untested'));
    assert.ok(html.includes('src/auth.ts'));
    assert.ok(html.includes('test/auth.test.ts'));
    assert.ok(html.includes('src/rate-limit.ts'));
    assert.ok(html.includes('3 turns'));
  });

  it('includes data-copy attribute for clipboard affordance', () => {
    const html = renderGate({
      state: {
        status: 'paused',
        pending_phase_transition: { to: 'development', requested_by_turn: 'turn_001' },
      },
      history: [{ turn_id: 'turn_001', summary: 'Done' }],
    });
    assert.ok(html.includes('data-copy="agentxchain approve-transition"'));
  });

  it('renders coordinator pending gate evidence with multi approve command', () => {
    const html = renderGate({
      state: null,
      coordinatorState: {
        status: 'paused',
        phase: 'integration',
        pending_gate: {
          gate_type: 'phase_transition',
          gate: 'phase_transition:integration->release',
          from: 'integration',
          to: 'release',
          required_repos: ['api', 'web'],
        },
      },
      coordinatorHistory: [
        { type: 'acceptance_projection', repo_id: 'api', repo_turn_id: 'turn_api_001', summary: 'API integration accepted', files_changed: ['api/src/index.ts'], decisions: [{ statement: 'Promote shared schema' }] },
        { type: 'phase_transition_requested', gate: 'phase_transition:integration->release' },
      ],
      coordinatorBarriers: {
        backend_completion: { status: 'partially_satisfied' },
      },
    });

    assert.ok(html.includes('Phase Transition Gate'));
    assert.ok(html.includes('API integration accepted'));
    assert.ok(html.includes('Promote shared schema'));
    assert.ok(html.includes('backend_completion'));
    assert.ok(html.includes('Approve Coordinator Gate'));
    assert.ok(html.includes('agentxchain multi approve-gate'));
  });
});

// ── Gate View — findPostGateTurns ─────────────────────────────────────────

describe('findPostGateTurns', () => {
  it('returns all turns when no requestedByTurn', () => {
    const history = [{ turn_id: 't1' }, { turn_id: 't2' }];
    assert.deepEqual(findPostGateTurns(history, null).map(t => t.turn_id), ['t1', 't2']);
  });

  it('returns empty array for empty history', () => {
    assert.deepEqual(findPostGateTurns([], 't1'), []);
  });

  it('returns turns from start to requested turn when no prior gate', () => {
    const history = [
      { turn_id: 't1', summary: 'A' },
      { turn_id: 't2', summary: 'B' },
      { turn_id: 't3', summary: 'C' },
    ];
    const result = findPostGateTurns(history, 't3');
    assert.deepEqual(result.map(t => t.turn_id), ['t1', 't2', 't3']);
  });

  it('returns turns from after last phase transition request to requested turn', () => {
    const history = [
      { turn_id: 't1', summary: 'Planning' },
      { turn_id: 't2', summary: 'Transition', phase_transition_request: 'development' },
      { turn_id: 't3', summary: 'Dev 1' },
      { turn_id: 't4', summary: 'Dev 2' },
    ];
    const result = findPostGateTurns(history, 't4');
    assert.deepEqual(result.map(t => t.turn_id), ['t3', 't4']);
  });

  it('accepts the legacy phase_transition marker as a compatibility fallback', () => {
    const history = [
      { turn_id: 't1', summary: 'Planning' },
      { turn_id: 't2', summary: 'Transition', phase_transition: true },
      { turn_id: 't3', summary: 'Dev 1' },
      { turn_id: 't4', summary: 'Dev 2' },
    ];
    const result = findPostGateTurns(history, 't4');
    assert.deepEqual(result.map(t => t.turn_id), ['t3', 't4']);
  });

  it('falls back to all turns when requestedByTurn is not found', () => {
    const history = [{ turn_id: 't1' }, { turn_id: 't2' }];
    assert.deepEqual(findPostGateTurns(history, 'missing').map(t => t.turn_id), ['t1', 't2']);
  });
});

// ── Gate View — aggregateEvidence ──────────────────────────────────────────

describe('aggregateEvidence', () => {
  it('aggregates summaries, objections, risks, decisions, and files', () => {
    const turns = [
      {
        turn_id: 't1',
        assigned_role: 'dev',
        summary: 'Built it',
        objections: [{ statement: 'Obj 1' }],
        risks: [{ statement: 'Risk 1' }],
        decisions: [{ id: 'D1', statement: 'Dec 1' }],
        observed_artifact: { files_changed: ['a.ts', 'b.ts'] },
      },
      {
        turn_id: 't2',
        assigned_role: 'qa',
        summary: 'Tested it',
        objections: [{ statement: 'Obj 2' }],
        observed_artifact: { files_changed: ['b.ts', 'c.ts'] },
      },
    ];
    const ev = aggregateEvidence(turns);
    assert.equal(ev.summaries.length, 2);
    assert.equal(ev.objections.length, 2);
    assert.equal(ev.risks.length, 1);
    assert.equal(ev.decisions.length, 1);
    assert.deepEqual(ev.files, ['a.ts', 'b.ts', 'c.ts']);
  });

  it('handles empty turns array', () => {
    const ev = aggregateEvidence([]);
    assert.equal(ev.summaries.length, 0);
    assert.equal(ev.objections.length, 0);
    assert.equal(ev.files.length, 0);
  });
});
