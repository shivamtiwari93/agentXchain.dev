import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { validateSchedulesConfig } from '../src/lib/normalized-config.js';
import { selectContinuousScheduleEntry } from '../src/commands/schedule.js';
import {
  advanceContinuousRunOnce,
  readContinuousSession,
  writeContinuousSession,
  findNextQueuedIntent,
} from '../src/lib/continuous-run.js';

const cliRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const tempDirs = [];

function makeTmpDir() {
  const dir = mkdtempSync(join(tmpdir(), 'axc-sched-cont-'));
  tempDirs.push(dir);
  return dir;
}

function writeConfig(dir, overrides = {}) {
  const config = {
    schema_version: '1.0',
    protocol_mode: 'governed',
    template: 'generic',
    project: { name: 'sched-cont-test', id: `sct-${Date.now()}`, default_branch: 'main' },
    roles: {
      pm: { title: 'PM', mandate: 'Plan.', write_authority: 'authoritative', runtime: 'manual-pm' },
      dev: { title: 'Developer', mandate: 'Implement.', write_authority: 'authoritative', runtime: 'manual-dev' },
    },
    runtimes: {
      'manual-pm': { type: 'manual' },
      'manual-dev': { type: 'manual' },
    },
    routing: {
      planning: { entry_role: 'pm', allowed_next_roles: ['pm', 'dev'], exit_gate: 'planning_signoff' },
      implementation: { entry_role: 'dev', allowed_next_roles: ['dev'], exit_gate: 'done' },
    },
    gates: { planning_signoff: {}, done: {} },
    rules: { challenge_required: false, max_turn_retries: 1 },
    files: { state: '.agentxchain/state.json', history: '.agentxchain/history.jsonl', talk: 'TALK.md' },
    ...overrides,
  };
  writeFileSync(join(dir, 'agentxchain.json'), JSON.stringify(config, null, 2));
  return config;
}

function writeState(dir, overrides = {}) {
  const state = {
    schema_version: '1.0',
    run_id: null,
    project_id: `sct-${Date.now()}`,
    status: 'idle',
    phase: 'planning',
    accepted_integration_ref: null,
    active_turns: {},
    turn_sequence: 0,
    last_completed_turn_id: null,
    blocked_on: null,
    blocked_reason: null,
    escalation: null,
    phase_gate_status: {},
    ...overrides,
  };
  mkdirSync(join(dir, '.agentxchain'), { recursive: true });
  writeFileSync(join(dir, '.agentxchain', 'state.json'), JSON.stringify(state, null, 2));
  mkdirSync(join(dir, '.agentxchain', 'dispatch', 'turns'), { recursive: true });
  mkdirSync(join(dir, '.agentxchain', 'staging'), { recursive: true });
  writeFileSync(join(dir, '.agentxchain', 'history.jsonl'), '');
  writeFileSync(join(dir, '.agentxchain', 'decision-ledger.jsonl'), '');
  return state;
}

function writeVision(dir, content) {
  mkdirSync(join(dir, '.planning'), { recursive: true });
  writeFileSync(join(dir, '.planning', 'VISION.md'), content);
}

function writeScheduleState(dir, schedules) {
  mkdirSync(join(dir, '.agentxchain'), { recursive: true });
  writeFileSync(join(dir, '.agentxchain', 'schedule-state.json'), JSON.stringify({
    schema_version: '0.1',
    schedules,
  }, null, 2));
}

function writeIntent(dir, { intentId, status, charter }) {
  const eventId = `evt_${Date.now()}_0001`;
  const now = new Date().toISOString();

  // Write the parent event (required by startIntent)
  const eventsDir = join(dir, '.agentxchain', 'intake', 'events');
  mkdirSync(eventsDir, { recursive: true });
  writeFileSync(join(eventsDir, `${eventId}.json`), JSON.stringify({
    schema_version: '1.0',
    event_id: eventId,
    source: 'manual',
    category: 'manual',
    signal: { description: charter },
    evidence: [],
    created_at: now,
    intent_id: intentId,
  }, null, 2));

  // Write the intent
  const intentsDir = join(dir, '.agentxchain', 'intake', 'intents');
  mkdirSync(intentsDir, { recursive: true });
  writeFileSync(join(intentsDir, `${intentId}.json`), JSON.stringify({
    schema_version: '1.0',
    intent_id: intentId,
    event_id: eventId,
    status,
    priority: 'p2',
    template: 'generic',
    charter,
    acceptance_contract: [charter],
    created_at: now,
    updated_at: now,
    history: [],
  }, null, 2));
}

afterEach(() => {
  for (const dir of tempDirs) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  tempDirs.length = 0;
});

describe('Schedule Continuous Config Validation', () => {
  it('AT-SCHED-CONT-001: accepts a valid continuous block', () => {
    const result = validateSchedulesConfig({
      vision_autopilot: {
        every_minutes: 60,
        auto_approve: true,
        max_turns: 10,
        initial_role: 'pm',
        continuous: {
          enabled: true,
          vision_path: '.planning/VISION.md',
          max_runs: 100,
          max_idle_cycles: 8,
          triage_approval: 'auto',
        },
      },
    }, { pm: {}, dev: {} });
    assert.ok(result.ok, `Expected valid, got errors: ${result.errors.join(', ')}`);
  });

  it('AT-SCHED-CONT-001: rejects continuous without vision_path when enabled', () => {
    const result = validateSchedulesConfig({
      bad: {
        every_minutes: 60,
        continuous: {
          enabled: true,
        },
      },
    }, {});
    assert.ok(!result.ok);
    assert.ok(result.errors.some(e => e.includes('vision_path is required')));
  });

  it('AT-SCHED-CONT-001: rejects invalid triage_approval', () => {
    const result = validateSchedulesConfig({
      bad: {
        every_minutes: 60,
        continuous: {
          enabled: true,
          vision_path: '.planning/VISION.md',
          triage_approval: 'yolo',
        },
      },
    }, {});
    assert.ok(!result.ok);
    assert.ok(result.errors.some(e => e.includes('triage_approval must be "auto" or "human"')));
  });

  it('AT-SCHED-CONT-001: rejects invalid max_runs', () => {
    const result = validateSchedulesConfig({
      bad: {
        every_minutes: 60,
        continuous: {
          enabled: true,
          vision_path: '.planning/VISION.md',
          max_runs: 0,
        },
      },
    }, {});
    assert.ok(!result.ok);
    assert.ok(result.errors.some(e => e.includes('max_runs must be an integer >= 1')));
  });

  it('AT-SCHED-CONT-001: accepts continuous with enabled:false (no vision_path required)', () => {
    const result = validateSchedulesConfig({
      opt_out: {
        every_minutes: 60,
        continuous: {
          enabled: false,
        },
      },
    }, {});
    assert.ok(result.ok);
  });
});

describe('advanceContinuousRunOnce — schedule-compatible primitive', () => {
  it('AT-SCHED-CONT-007: advances a session through one governed run via the shared primitive', async () => {
    const root = makeTmpDir();
    writeConfig(root);
    writeState(root);
    writeVision(root, '# Vision\n\n## Goals\n\n- Build the dashboard\n');

    const session = {
      session_id: 'cont-test-001',
      started_at: new Date().toISOString(),
      vision_path: '.planning/VISION.md',
      runs_completed: 0,
      max_runs: 5,
      idle_cycles: 0,
      max_idle_cycles: 3,
      current_run_id: null,
      current_vision_objective: null,
      status: 'running',
      owner_type: 'schedule',
      owner_id: 'vision_autopilot',
    };
    writeContinuousSession(root, session);

    const contOpts = {
      visionPath: '.planning/VISION.md',
      maxRuns: 5,
      maxIdleCycles: 3,
      triageApproval: 'auto',
    };

    let runCalled = false;
    const mockExecute = async () => {
      runCalled = true;
      return { exitCode: 0, result: { stop_reason: 'completed', state: { run_id: 'run_mock_001' } } };
    };

    const logs = [];
    const step = await advanceContinuousRunOnce(
      { root, config: JSON.parse(readFileSync(join(root, 'agentxchain.json'), 'utf8')) },
      session,
      contOpts,
      mockExecute,
      (msg) => logs.push(msg),
    );

    assert.ok(step.ok, `Step should succeed: ${JSON.stringify(step)}`);
    assert.equal(step.status, 'running');
    assert.ok(runCalled, 'governed run should have been called');
    assert.equal(session.runs_completed, 1);
    assert.ok(step.intent_id, 'should have an intent_id');

    // Session should be persisted with owner metadata
    const persisted = readContinuousSession(root);
    assert.equal(persisted.owner_type, 'schedule');
    assert.equal(persisted.owner_id, 'vision_autopilot');
    assert.equal(persisted.runs_completed, 1);
  });

  it('AT-SCHED-CONT-002: session records owner_type and owner_id', async () => {
    const root = makeTmpDir();
    writeConfig(root);
    writeState(root);
    writeVision(root, '# Vision\n\n## Targets\n\n- Ship feature X\n');

    const session = {
      session_id: 'cont-owned-001',
      started_at: new Date().toISOString(),
      vision_path: '.planning/VISION.md',
      runs_completed: 0,
      max_runs: 3,
      idle_cycles: 0,
      max_idle_cycles: 3,
      current_run_id: null,
      current_vision_objective: null,
      status: 'running',
      owner_type: 'schedule',
      owner_id: 'nightly',
    };
    writeContinuousSession(root, session);

    const persisted = readContinuousSession(root);
    assert.equal(persisted.owner_type, 'schedule');
    assert.equal(persisted.owner_id, 'nightly');
    assert.equal(persisted.session_id, 'cont-owned-001');
  });

  it('AT-SCHED-CONT-003: advances same session on subsequent calls', async () => {
    const root = makeTmpDir();
    writeConfig(root);
    writeState(root);
    writeVision(root, '# Vision\n\n## Goals\n\n- Build the API\n- Build the CLI\n- Ship the docs\n- Write tests\n');

    const session = {
      session_id: 'cont-multi-001',
      started_at: new Date().toISOString(),
      vision_path: '.planning/VISION.md',
      runs_completed: 0,
      max_runs: 5,
      idle_cycles: 0,
      max_idle_cycles: 3,
      current_run_id: null,
      current_vision_objective: null,
      status: 'running',
      owner_type: 'schedule',
      owner_id: 'vision_autopilot',
    };

    const contOpts = {
      visionPath: '.planning/VISION.md',
      maxRuns: 5,
      maxIdleCycles: 3,
      triageApproval: 'auto',
    };

    // Mock executor that marks the run as completed (preserving run_id for resolveIntent)
    const mockExecute = async () => {
      // Read current state to get the run_id that startIntent assigned
      const currentState = JSON.parse(readFileSync(join(root, '.agentxchain', 'state.json'), 'utf8'));
      const runId = currentState.run_id || `run_${session.runs_completed + 1}`;
      // Mark as completed (resolveIntent reads state.status to determine outcome)
      writeState(root, { status: 'completed', phase: 'planning', run_id: runId });
      return {
        exitCode: 0,
        result: { stop_reason: 'completed', state: { run_id: runId } },
      };
    };

    const context = { root, config: JSON.parse(readFileSync(join(root, 'agentxchain.json'), 'utf8')) };
    const noop = () => {};

    // First advance — derives from vision
    const step1 = await advanceContinuousRunOnce(context, session, contOpts, mockExecute, noop);
    assert.ok(step1.ok, `Step 1 failed: ${JSON.stringify(step1)}`);
    assert.equal(session.runs_completed, 1);

    // Write a second queued intent for the second advance so we don't depend
    // on vision dedup behavior (already tested separately)
    writeIntent(root, { intentId: 'intent-second-run', status: 'approved', charter: 'Build the CLI module' });

    // Second advance — same session continues
    const step2 = await advanceContinuousRunOnce(context, session, contOpts, mockExecute, noop);
    assert.ok(step2.ok, `Step 2 failed: ${JSON.stringify(step2)}`);
    assert.equal(session.runs_completed, 2);
    assert.equal(session.session_id, 'cont-multi-001', 'session ID must not change');
  });

  it('AT-SCHED-CONT-004: blocked run pauses session for later unblock resume', async () => {
    const root = makeTmpDir();
    writeConfig(root);
    writeState(root);
    writeVision(root, '# Vision\n\n## Goals\n\n- Set up OAuth\n');

    const session = {
      session_id: 'cont-blocked-001',
      started_at: new Date().toISOString(),
      vision_path: '.planning/VISION.md',
      runs_completed: 0,
      max_runs: 5,
      idle_cycles: 0,
      max_idle_cycles: 3,
      current_run_id: null,
      current_vision_objective: null,
      status: 'running',
      owner_type: 'schedule',
      owner_id: 'vision_autopilot',
    };

    const contOpts = {
      visionPath: '.planning/VISION.md',
      maxRuns: 5,
      maxIdleCycles: 3,
      triageApproval: 'auto',
    };

    const mockExecute = async () => ({
      exitCode: 1,
      result: { stop_reason: 'blocked', state: { run_id: 'run_blocked_001' } },
    });

    const step = await advanceContinuousRunOnce(
      { root, config: JSON.parse(readFileSync(join(root, 'agentxchain.json'), 'utf8')) },
      session,
      contOpts,
      mockExecute,
      () => {},
    );

    assert.ok(step.ok);
    assert.equal(step.status, 'blocked');
    assert.equal(step.action, 'run_blocked');
    assert.equal(session.status, 'paused');

    // After unblock, the session can be resumed by calling advanceContinuousRunOnce again
    // (daemon keeps polling, sees paused session, and on next poll after unblock, advances)
  });

  it('AT-SCHED-CONT-005: priority preemption is surfaced for daemon to consume', async () => {
    const root = makeTmpDir();
    writeConfig(root);
    writeState(root);

    // Write an approved intent (simulating injected p0 work)
    writeIntent(root, { intentId: 'injected-p0-001', status: 'approved', charter: 'Fix the sidebar ordering' });

    // No vision needed — queued intent takes precedence
    writeVision(root, '# Vision\n\n## Goals\n\n- Build something\n');

    const session = {
      session_id: 'cont-preempt-001',
      started_at: new Date().toISOString(),
      vision_path: '.planning/VISION.md',
      runs_completed: 1,
      max_runs: 10,
      idle_cycles: 0,
      max_idle_cycles: 3,
      current_run_id: null,
      current_vision_objective: null,
      status: 'running',
      owner_type: 'schedule',
      owner_id: 'vision_autopilot',
    };

    const contOpts = {
      visionPath: '.planning/VISION.md',
      maxRuns: 10,
      maxIdleCycles: 3,
      triageApproval: 'auto',
    };

    const mockExecute = async () => ({
      exitCode: 0,
      result: { stop_reason: 'priority_preempted', state: { run_id: 'run_preempt_001' } },
    });

    const step = await advanceContinuousRunOnce(
      { root, config: JSON.parse(readFileSync(join(root, 'agentxchain.json'), 'utf8')) },
      session,
      contOpts,
      mockExecute,
      () => {},
    );

    assert.ok(step.ok);
    assert.equal(step.action, 'consumed_injected_priority');
    assert.equal(step.status, 'running');
    assert.equal(session.runs_completed, 1, 'preemption must not count as a completed run');

    const intent = JSON.parse(readFileSync(join(root, '.agentxchain', 'intake', 'intents', 'injected-p0-001.json'), 'utf8'));
    assert.equal(intent.status, 'executing', 'preempted intent must remain executing');
    // Session is NOT terminal — daemon should consume injected work on next poll
  });

  it('AT-CONT-FAIL-005: paused session stays blocked when governed state is still blocked (still_blocked guard)', async () => {
    const root = makeTmpDir();
    writeConfig(root);
    writeState(root, {
      run_id: 'run_blocked_001',
      status: 'blocked',
      blocked_on: 'dispatch:turn_001',
      blocked_reason: {
        category: 'retries_exhausted',
        blocked_at: new Date().toISOString(),
        turn_id: 'turn_001',
        recovery: {
          typed_reason: 'retries_exhausted',
          owner: 'operator',
          recovery_action: 'fix the adapter then rerun agentxchain step',
          turn_retained: false,
          detail: 'adapter retries exhausted',
        },
      },
    });
    writeVision(root, '# Vision\n\n## Goals\n\n- Recover from failure\n');

    const session = {
      session_id: 'cont-guard-001',
      started_at: new Date().toISOString(),
      vision_path: '.planning/VISION.md',
      runs_completed: 0,
      max_runs: 5,
      idle_cycles: 0,
      max_idle_cycles: 3,
      current_run_id: 'run_blocked_001',
      current_vision_objective: 'Recover from failure',
      status: 'paused',
      owner_type: 'schedule',
      owner_id: 'vision_autopilot',
      cumulative_spent_usd: 0,
    };
    writeContinuousSession(root, session);

    const contOpts = {
      visionPath: '.planning/VISION.md',
      maxRuns: 5,
      maxIdleCycles: 3,
      triageApproval: 'auto',
    };

    const mockExecute = async () => { throw new Error('should not be called while still blocked'); };

    const step = await advanceContinuousRunOnce(
      { root, config: JSON.parse(readFileSync(join(root, 'agentxchain.json'), 'utf8')) },
      session,
      contOpts,
      mockExecute,
      () => {},
    );

    assert.ok(step.ok);
    assert.equal(step.status, 'blocked');
    assert.equal(step.action, 'still_blocked');
    assert.equal(step.run_id, 'run_blocked_001');
    assert.equal(session.status, 'paused', 'session must remain paused');
    assert.equal(session.runs_completed, 0, 'still_blocked must not increment runs');
  });

  it('AT-CONT-FAIL-006: paused session resumes when governed state is unblocked', async () => {
    const root = makeTmpDir();
    writeConfig(root);
    // State is active (after unblock) — not blocked
    writeState(root, { status: 'active', phase: 'planning' });
    writeVision(root, '# Vision\n\n## Goals\n\n- Resume after unblock\n');

    const session = {
      session_id: 'cont-resume-001',
      started_at: new Date().toISOString(),
      vision_path: '.planning/VISION.md',
      runs_completed: 0,
      max_runs: 5,
      idle_cycles: 0,
      max_idle_cycles: 3,
      current_run_id: 'run_resumed_001',
      current_vision_objective: 'Resume after unblock',
      status: 'paused',
      owner_type: 'schedule',
      owner_id: 'vision_autopilot',
      cumulative_spent_usd: 0.10,
    };
    writeContinuousSession(root, session);

    const contOpts = {
      visionPath: '.planning/VISION.md',
      maxRuns: 5,
      maxIdleCycles: 3,
      triageApproval: 'auto',
    };

    const mockExecute = async () => ({
      exitCode: 0,
      result: {
        stop_reason: 'completed',
        state: { run_id: 'run_resumed_001', budget_status: { spent_usd: 0.05 } },
      },
    });

    const logs = [];
    const step = await advanceContinuousRunOnce(
      { root, config: JSON.parse(readFileSync(join(root, 'agentxchain.json'), 'utf8')) },
      session,
      contOpts,
      mockExecute,
      (msg) => logs.push(msg),
    );

    assert.ok(step.ok, `resume step should succeed: ${JSON.stringify(step)}`);
    assert.equal(step.status, 'running');
    assert.equal(step.action, 'resumed_after_unblock');
    assert.equal(session.status, 'running');
    assert.equal(session.runs_completed, 1, 'resumed run completion must increment count');
    assert.ok(Math.abs(session.cumulative_spent_usd - 0.15) < 1e-9, `expected 0.15 spent, got ${session.cumulative_spent_usd}`);
    assert.ok(logs.some((m) => m.includes('Blocked run resolved')), 'should log resume message');
  });

  it('AT-CONT-FAIL-001: non-blocked governed failures fail the session without resolving the intent', async () => {
    const root = makeTmpDir();
    writeConfig(root);
    writeState(root);
    writeVision(root, '# Vision\n\n## Goals\n\n- Build resilient continuous recovery\n');

    const session = {
      session_id: 'cont-fail-001',
      started_at: new Date().toISOString(),
      vision_path: '.planning/VISION.md',
      runs_completed: 0,
      max_runs: 5,
      idle_cycles: 0,
      max_idle_cycles: 3,
      current_run_id: null,
      current_vision_objective: null,
      status: 'running',
    };

    const contOpts = {
      visionPath: '.planning/VISION.md',
      maxRuns: 5,
      maxIdleCycles: 3,
      triageApproval: 'auto',
    };

    const mockExecute = async () => {
      const currentState = JSON.parse(readFileSync(join(root, '.agentxchain', 'state.json'), 'utf8'));
      return {
        exitCode: 1,
        result: {
          stop_reason: 'dispatch_error',
          state: {
            run_id: currentState.run_id,
            status: currentState.status,
            budget_status: { spent_usd: 0.25 },
          },
        },
      };
    };

    const step = await advanceContinuousRunOnce(
      { root, config: JSON.parse(readFileSync(join(root, 'agentxchain.json'), 'utf8')) },
      session,
      contOpts,
      mockExecute,
      () => {},
    );

    assert.equal(step.ok, false);
    assert.equal(step.status, 'failed');
    assert.equal(step.action, 'run_failed');
    assert.equal(step.stop_reason, 'dispatch_error');
    assert.equal(session.status, 'failed');
    assert.equal(session.runs_completed, 0, 'failed run must not increment completed-run count');
    assert.equal(session.cumulative_spent_usd, 0.25, 'visible spend from failed run still counts toward session budget');

    const queued = findNextQueuedIntent(root);
    assert.equal(queued.ok, false, 'failed run must not re-queue the executing intent as planned work');

    const intentFile = join(root, '.agentxchain', 'intake', 'intents', `${step.intent_id}.json`);
    const intent = JSON.parse(readFileSync(intentFile, 'utf8'));
    assert.equal(intent.status, 'executing', 'failed run must leave intake intent unresolved');
  });

  it('AT-CONT-FAIL-004: blocked governed outcomes pause the session even when stop_reason is reject_exhausted', async () => {
    const root = makeTmpDir();
    writeConfig(root);
    writeState(root);
    writeVision(root, '# Vision\n\n## Goals\n\n- Recover from adapter failures\n');

    const session = {
      session_id: 'cont-blocked-reject-001',
      started_at: new Date().toISOString(),
      vision_path: '.planning/VISION.md',
      runs_completed: 0,
      max_runs: 5,
      idle_cycles: 0,
      max_idle_cycles: 3,
      current_run_id: null,
      current_vision_objective: null,
      status: 'running',
    };

    const contOpts = {
      visionPath: '.planning/VISION.md',
      maxRuns: 5,
      maxIdleCycles: 3,
      triageApproval: 'auto',
    };

    const mockExecute = async () => {
      const currentState = JSON.parse(readFileSync(join(root, '.agentxchain', 'state.json'), 'utf8'));
      writeState(root, {
        run_id: currentState.run_id,
        status: 'blocked',
        phase: currentState.phase,
        blocked_on: `dispatch:${Object.keys(currentState.active_turns || {})[0] || 'turn_001'}`,
        blocked_reason: {
          category: 'dispatch_error',
          recovery: { recovery_action: 'fix the adapter, then rerun agentxchain unblock <id>' },
        },
      });
      return {
        exitCode: 1,
        result: {
          stop_reason: 'reject_exhausted',
          state: {
            run_id: currentState.run_id,
            status: 'blocked',
          },
        },
      };
    };

    const step = await advanceContinuousRunOnce(
      { root, config: JSON.parse(readFileSync(join(root, 'agentxchain.json'), 'utf8')) },
      session,
      contOpts,
      mockExecute,
      () => {},
    );

    assert.equal(step.ok, true);
    assert.equal(step.status, 'blocked');
    assert.equal(step.action, 'run_blocked');
    assert.equal(session.status, 'paused');
    assert.equal(session.runs_completed, 0, 'blocked run must not increment completed-run count');

    const intent = JSON.parse(readFileSync(join(root, '.agentxchain', 'intake', 'intents', `${step.intent_id}.json`), 'utf8'));
    assert.equal(intent.status, 'blocked');
    assert.equal(intent.run_blocked_reason, 'dispatch_error');
    assert.ok(intent.run_blocked_recovery);
  });

  it('AT-SCHED-CONT-006: status JSON includes owner_type and owner_id', () => {
    const root = makeTmpDir();
    mkdirSync(join(root, '.agentxchain'), { recursive: true });

    const session = {
      session_id: 'cont-status-001',
      started_at: new Date().toISOString(),
      vision_path: '.planning/VISION.md',
      runs_completed: 3,
      max_runs: 100,
      idle_cycles: 0,
      max_idle_cycles: 5,
      current_run_id: 'run_latest',
      current_vision_objective: 'Goals: Build the API',
      status: 'running',
      owner_type: 'schedule',
      owner_id: 'vision_autopilot',
    };
    writeContinuousSession(root, session);

    const persisted = readContinuousSession(root);
    assert.equal(persisted.owner_type, 'schedule');
    assert.equal(persisted.owner_id, 'vision_autopilot');
    assert.equal(persisted.runs_completed, 3);
    assert.equal(persisted.current_vision_objective, 'Goals: Build the API');
  });

  it('max_runs terminal: session completes when runs_completed >= maxRuns', async () => {
    const root = makeTmpDir();
    writeConfig(root);
    writeState(root);
    writeVision(root, '# Vision\n\n## Goals\n\n- Build\n');

    const session = {
      session_id: 'cont-maxruns-001',
      started_at: new Date().toISOString(),
      vision_path: '.planning/VISION.md',
      runs_completed: 5,
      max_runs: 5,
      idle_cycles: 0,
      max_idle_cycles: 3,
      current_run_id: null,
      current_vision_objective: null,
      status: 'running',
    };

    const step = await advanceContinuousRunOnce(
      { root, config: JSON.parse(readFileSync(join(root, 'agentxchain.json'), 'utf8')) },
      session,
      { visionPath: '.planning/VISION.md', maxRuns: 5, maxIdleCycles: 3, triageApproval: 'auto' },
      async () => { throw new Error('should not be called'); },
      () => {},
    );

    assert.ok(step.ok);
    assert.equal(step.status, 'completed');
    assert.equal(step.action, 'max_runs_reached');
    assert.equal(session.status, 'completed');
  });

  it('vision missing: session fails with clear error', async () => {
    const root = makeTmpDir();
    writeConfig(root);
    writeState(root);
    // No VISION.md written

    const session = {
      session_id: 'cont-novision-001',
      started_at: new Date().toISOString(),
      vision_path: '.planning/VISION.md',
      runs_completed: 0,
      max_runs: 5,
      idle_cycles: 0,
      max_idle_cycles: 3,
      current_run_id: null,
      current_vision_objective: null,
      status: 'running',
    };

    const step = await advanceContinuousRunOnce(
      { root, config: JSON.parse(readFileSync(join(root, 'agentxchain.json'), 'utf8')) },
      session,
      { visionPath: '.planning/VISION.md', maxRuns: 5, maxIdleCycles: 3, triageApproval: 'auto' },
      async () => { throw new Error('should not be called'); },
      () => {},
    );

    assert.ok(!step.ok);
    assert.equal(step.status, 'failed');
    assert.equal(step.action, 'vision_missing');
    assert.ok(step.stop_reason.includes('VISION.md not found'));
  });

  it('idle exit: session completes after max idle cycles', async () => {
    const root = makeTmpDir();
    writeConfig(root);
    writeState(root);
    writeVision(root, '# Vision\n\n## Goals\n\n- Build\n');

    const session = {
      session_id: 'cont-idle-001',
      started_at: new Date().toISOString(),
      vision_path: '.planning/VISION.md',
      runs_completed: 2,
      max_runs: 10,
      idle_cycles: 3,
      max_idle_cycles: 3,
      current_run_id: null,
      current_vision_objective: null,
      status: 'running',
    };

    const step = await advanceContinuousRunOnce(
      { root, config: JSON.parse(readFileSync(join(root, 'agentxchain.json'), 'utf8')) },
      session,
      { visionPath: '.planning/VISION.md', maxRuns: 10, maxIdleCycles: 3, triageApproval: 'auto' },
      async () => { throw new Error('should not be called'); },
      () => {},
    );

    assert.ok(step.ok);
    assert.equal(step.status, 'idle_exit');
    assert.equal(session.status, 'completed');
  });
});

describe('continuous schedule selection', () => {
  it('AT-SCHED-CONT-008: selects a due continuous schedule instead of the first configured non-due entry', () => {
    const root = makeTmpDir();
    const now = new Date().toISOString();
    const config = writeConfig(root, {
      schedules: {
        alpha: {
          every_minutes: 60,
          auto_approve: true,
          max_turns: 5,
          initial_role: 'pm',
          continuous: {
            enabled: true,
            vision_path: '.planning/VISION.md',
            max_runs: 5,
            max_idle_cycles: 3,
            triage_approval: 'auto',
          },
        },
        beta: {
          every_minutes: 60,
          auto_approve: true,
          max_turns: 5,
          initial_role: 'pm',
          continuous: {
            enabled: true,
            vision_path: '.planning/VISION.md',
            max_runs: 5,
            max_idle_cycles: 3,
            triage_approval: 'auto',
          },
        },
      },
    });

    writeState(root);
    writeVision(root, '# Vision\n\n## Goals\n\n- Ship beta\n');
    writeScheduleState(root, {
      alpha: {
        last_started_at: now,
        last_finished_at: now,
        last_run_id: 'run_alpha',
        last_status: 'continuous_running',
        last_skip_at: null,
        last_skip_reason: null,
      },
    });

    const selected = selectContinuousScheduleEntry(root, config, { at: now });
    assert.ok(selected);
    assert.equal(selected.id, 'beta');
    assert.equal(selected.due, true);
  });

  it('AT-SCHED-CONT-009: keeps advancing the active schedule-owned session even when another entry is due', () => {
    const root = makeTmpDir();
    const config = writeConfig(root, {
      schedules: {
        alpha: {
          every_minutes: 60,
          auto_approve: true,
          max_turns: 5,
          initial_role: 'pm',
          continuous: {
            enabled: true,
            vision_path: '.planning/VISION.md',
            max_runs: 5,
            max_idle_cycles: 3,
            triage_approval: 'auto',
          },
        },
        beta: {
          every_minutes: 60,
          auto_approve: true,
          max_turns: 5,
          initial_role: 'pm',
          continuous: {
            enabled: true,
            vision_path: '.planning/VISION.md',
            max_runs: 5,
            max_idle_cycles: 3,
            triage_approval: 'auto',
          },
        },
      },
    });

    writeState(root);
    writeVision(root, '# Vision\n\n## Goals\n\n- Keep alpha running\n');
    writeContinuousSession(root, {
      session_id: 'cont-alpha-001',
      started_at: new Date().toISOString(),
      vision_path: '.planning/VISION.md',
      runs_completed: 1,
      max_runs: 5,
      idle_cycles: 0,
      max_idle_cycles: 3,
      current_run_id: 'run_alpha_001',
      current_vision_objective: 'Keep alpha running',
      status: 'running',
      owner_type: 'schedule',
      owner_id: 'alpha',
    });

    const selected = selectContinuousScheduleEntry(root, config, { at: new Date().toISOString() });
    assert.ok(selected);
    assert.equal(selected.id, 'alpha');
  });
});

describe('BUG-60 scheduler status mapping', () => {
  it('builds schedule-owned continuous options through the shared resolver', () => {
    const source = readFileSync(join(cliRoot, 'src', 'commands', 'schedule.js'), 'utf8');
    assert.match(source, /resolveContinuousOptions\(\{\s*continuous:\s*true\s*\}/s);
    assert.match(source, /\.\.\.contConfig/);
    assert.match(source, /captureVisionHeadingsSnapshot/);
    assert.match(source, /computeVisionContentSha/);
    assert.doesNotMatch(source, /const contOpts = \{\s*visionPath:/);
  });

  it('maps perpetual idle-expansion terminal states distinctly', () => {
    const source = readFileSync(join(cliRoot, 'src', 'commands', 'schedule.js'), 'utf8');
    assert.match(source, /vision_exhausted:\s*'continuous_vision_exhausted'/);
    assert.match(source, /vision_expansion_exhausted:\s*'continuous_vision_expansion_exhausted'/);
    assert.match(source, /'vision_exhausted'/);
    assert.match(source, /'vision_expansion_exhausted'/);
  });
});
