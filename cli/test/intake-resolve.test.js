import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, it, beforeEach, afterEach } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(__dirname, '..', 'bin', 'agentxchain.js');

/**
 * Create a governed project with roles, routing, and idle state.
 */
function createGovernedProject() {
  const dir = mkdtempSync(join(tmpdir(), 'axc-intake-s5-'));

  const config = {
    schema_version: '1.0',
    project: {
      id: 'test-intake-s5',
      name: 'Test Intake S5',
      default_branch: 'main',
    },
    protocol_mode: 'governed',
    roles: {
      pm: {
        title: 'Product Manager',
        mandate: 'Protect user value.',
        write_authority: 'review_only',
        runtime: 'manual-pm',
      },
      dev: {
        title: 'Developer',
        mandate: 'Implement approved work.',
        write_authority: 'authoritative',
        runtime: 'local-dev',
      },
    },
    runtimes: {
      'manual-pm': { type: 'manual' },
      'local-dev': { type: 'local_cli', command: ['echo', 'test'], cwd: '.' },
    },
    routing: {
      planning: {
        entry_role: 'pm',
        allowed_next_roles: ['pm', 'dev'],
        max_concurrent_turns: 1,
      },
    },
    rules: {
      challenge_required: true,
      max_turn_retries: 2,
      max_deadlock_cycles: 2,
    },
  };

  const state = {
    schema_version: '1.0',
    run_id: null,
    project_id: 'test-intake-s5',
    status: 'idle',
    phase: 'planning',
    accepted_integration_ref: null,
    active_turns: {},
    turn_sequence: 0,
    last_completed_turn_id: null,
    blocked_on: null,
    blocked_reason: null,
    escalation: null,
    phase_gate_status: {
      planning_signoff: 'pending',
    },
  };

  writeFileSync(join(dir, 'agentxchain.json'), JSON.stringify(config, null, 2));
  mkdirSync(join(dir, '.agentxchain', 'dispatch', 'turns'), { recursive: true });
  mkdirSync(join(dir, '.agentxchain', 'staging'), { recursive: true });
  writeFileSync(join(dir, '.agentxchain', 'state.json'), JSON.stringify(state, null, 2));
  writeFileSync(join(dir, '.agentxchain', 'history.jsonl'), '');
  writeFileSync(join(dir, '.agentxchain', 'decision-ledger.jsonl'), '');
  mkdirSync(join(dir, '.planning'), { recursive: true });

  return dir;
}

function runCli(args, cwd) {
  return spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 15000,
  });
}

/** Full pipeline: record → triage → approve → plan → start → return intent ID and run_id */
function pipelineThroughStart(dir) {
  const recordResult = runCli([
    'intake', 'record',
    '--source', 'manual',
    '--signal', `{"desc":"s5 test ${Date.now()}"}`,
    '--evidence', '{"type":"text","value":"test evidence"}',
    '--json',
  ], dir);
  assert.equal(recordResult.status, 0, `record failed: ${recordResult.stderr}`);
  const intentId = JSON.parse(recordResult.stdout).intent.intent_id;

  const triageResult = runCli([
    'intake', 'triage',
    '--intent', intentId,
    '--priority', 'p1',
    '--template', 'generic',
    '--charter', 'S5 resolve test',
    '--acceptance', 'intent resolves correctly',
    '--json',
  ], dir);
  assert.equal(triageResult.status, 0, `triage failed: ${triageResult.stderr}`);

  const approveResult = runCli([
    'intake', 'approve',
    '--intent', intentId,
    '--json',
  ], dir);
  assert.equal(approveResult.status, 0, `approve failed: ${approveResult.stderr}`);

  const planResult = runCli([
    'intake', 'plan',
    '--intent', intentId,
    '--json',
  ], dir);
  assert.equal(planResult.status, 0, `plan failed: ${planResult.stderr}`);

  const startResult = runCli([
    'intake', 'start',
    '--intent', intentId,
    '--json',
  ], dir);
  assert.equal(startResult.status, 0, `start failed: ${startResult.stderr}\n${startResult.stdout}`);

  const startOut = JSON.parse(startResult.stdout);
  return { intentId, runId: startOut.run_id, turnId: startOut.turn_id };
}

/** Mutate governed state to simulate a run outcome */
function setRunStatus(dir, overrides) {
  const statePath = join(dir, '.agentxchain', 'state.json');
  const state = JSON.parse(readFileSync(statePath, 'utf8'));
  Object.assign(state, overrides);
  writeFileSync(statePath, JSON.stringify(state, null, 2));
}

describe('intake resolve', () => {
  let dir;
  beforeEach(() => { dir = createGovernedProject(); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  // AT-V3S5-001: blocked run transitions intent to blocked
  it('transitions an executing intent to blocked when run is blocked', () => {
    const { intentId, runId } = pipelineThroughStart(dir);

    // Simulate blocked run
    setRunStatus(dir, {
      status: 'blocked',
      active_turns: {},
      blocked_on: 'escalation:retries-exhausted:dev',
      blocked_reason: {
        category: 'retries_exhausted',
        blocked_at: new Date().toISOString(),
        turn_id: 'turn_test',
        recovery: {
          typed_reason: 'retries_exhausted',
          owner: 'human',
          recovery_action: 'Resolve the escalation, then run agentxchain step --resume',
          turn_retained: true,
          detail: null,
        },
      },
    });

    const result = runCli(['intake', 'resolve', '--intent', intentId, '--json'], dir);
    assert.equal(result.status, 0, `resolve failed: ${result.stderr}\n${result.stdout}`);

    const out = JSON.parse(result.stdout);
    assert.equal(out.ok, true);
    assert.equal(out.previous_status, 'executing');
    assert.equal(out.new_status, 'blocked');
    assert.equal(out.run_outcome, 'blocked');
    assert.equal(out.no_change, false);
    assert.equal(out.intent.status, 'blocked');
    assert.equal(out.intent.run_blocked_on, 'escalation:retries-exhausted:dev');
    assert.equal(out.intent.run_blocked_reason, 'retries_exhausted');
    assert.ok(out.intent.run_blocked_recovery);
  });

  // AT-V3S5-002: completed run transitions intent to completed
  it('transitions an executing intent to completed when run is completed', () => {
    const { intentId, runId } = pipelineThroughStart(dir);

    const completedAt = new Date().toISOString();
    setRunStatus(dir, {
      status: 'completed',
      active_turns: {},
      completed_at: completedAt,
      last_completed_turn_id: 'turn_final',
    });

    const result = runCli(['intake', 'resolve', '--intent', intentId, '--json'], dir);
    assert.equal(result.status, 0, `resolve failed: ${result.stderr}\n${result.stdout}`);

    const out = JSON.parse(result.stdout);
    assert.equal(out.ok, true);
    assert.equal(out.previous_status, 'executing');
    assert.equal(out.new_status, 'completed');
    assert.equal(out.run_outcome, 'completed');
    assert.equal(out.no_change, false);
    assert.equal(out.intent.status, 'completed');
    assert.equal(out.intent.run_completed_at, completedAt);
    assert.equal(out.intent.run_final_turn, 'turn_final');
  });

  // AT-V3S5-003: reserved run-level 'failed' is rejected (DEC-RUN-STATUS-001)
  it('rejects resolve when governed run has reserved status "failed"', () => {
    const { intentId } = pipelineThroughStart(dir);

    setRunStatus(dir, {
      status: 'failed',
      active_turns: {},
      blocked_on: 'fatal:unrecoverable',
      blocked_reason: {
        category: 'unrecoverable',
        blocked_at: new Date().toISOString(),
        turn_id: null,
        recovery: {
          typed_reason: 'unrecoverable',
          owner: 'human',
          recovery_action: 'Manual intervention required',
          turn_retained: false,
          detail: null,
        },
      },
    });

    const result = runCli(['intake', 'resolve', '--intent', intentId, '--json'], dir);
    assert.equal(result.status, 1, `should fail: ${result.stdout}`);

    const out = JSON.parse(result.stdout);
    assert.equal(out.ok, false);
    assert.ok(out.error.includes('reserved status'));
    assert.ok(out.error.includes('DEC-RUN-STATUS-001'));
  });

  // AT-V3S5-004: active run returns no-change
  it('returns no-change when run is still active', () => {
    const { intentId } = pipelineThroughStart(dir);
    // Run is already active after start — no state mutation needed

    const result = runCli(['intake', 'resolve', '--intent', intentId, '--json'], dir);
    assert.equal(result.status, 0, `resolve failed: ${result.stderr}\n${result.stdout}`);

    const out = JSON.parse(result.stdout);
    assert.equal(out.ok, true);
    assert.equal(out.no_change, true);
    assert.equal(out.new_status, 'executing');
    assert.equal(out.run_outcome, 'active');
    assert.equal(out.intent.status, 'executing');
  });

  // AT-V3S5-005: paused run returns no-change
  it('returns no-change when run is paused', () => {
    const { intentId } = pipelineThroughStart(dir);

    setRunStatus(dir, {
      status: 'paused',
      active_turns: {},
      pending_phase_transition: { from: 'planning', to: 'implementation', gate: 'planning_signoff', requested_by_turn: 'turn_1' },
    });

    const result = runCli(['intake', 'resolve', '--intent', intentId, '--json'], dir);
    assert.equal(result.status, 0, `resolve failed: ${result.stderr}\n${result.stdout}`);

    const out = JSON.parse(result.stdout);
    assert.equal(out.ok, true);
    assert.equal(out.no_change, true);
    assert.equal(out.run_outcome, 'paused');
    assert.equal(out.intent.status, 'executing');
  });

  // AT-V3S5-006: run ID mismatch rejection
  it('rejects when governed run_id does not match intent target_run', () => {
    const { intentId } = pipelineThroughStart(dir);

    // Overwrite run_id to simulate mismatch
    setRunStatus(dir, { run_id: 'run_DIFFERENT' });

    const result = runCli(['intake', 'resolve', '--intent', intentId, '--json'], dir);
    assert.equal(result.status, 1, `should fail: ${result.stdout}`);

    const out = JSON.parse(result.stdout);
    assert.equal(out.ok, false);
    assert.ok(out.error.includes('run_id mismatch'));
  });

  // AT-V3S5-007: missing governed state rejection
  it('rejects when governed state.json does not exist', () => {
    const { intentId } = pipelineThroughStart(dir);

    // Remove state file
    rmSync(join(dir, '.agentxchain', 'state.json'));

    const result = runCli(['intake', 'resolve', '--intent', intentId, '--json'], dir);
    assert.equal(result.status, 1, `should fail: ${result.stdout}`);

    const out = JSON.parse(result.stdout);
    assert.equal(out.ok, false);
    assert.ok(out.error.includes('governed state not found'));
  });

  // AT-V3S5-008: non-executing intent rejection
  it('rejects resolve on a planned intent', () => {
    // Pipeline through plan only (not start)
    const recordResult = runCli([
      'intake', 'record',
      '--source', 'manual',
      '--signal', `{"desc":"s5 wrong state ${Date.now()}"}`,
      '--evidence', '{"type":"text","value":"ev"}',
      '--json',
    ], dir);
    const intentId = JSON.parse(recordResult.stdout).intent.intent_id;

    runCli(['intake', 'triage', '--intent', intentId, '--priority', 'p1', '--template', 'generic', '--charter', 'test', '--acceptance', 'test', '--json'], dir);
    runCli(['intake', 'approve', '--intent', intentId, '--json'], dir);
    runCli(['intake', 'plan', '--intent', intentId, '--json'], dir);

    const result = runCli(['intake', 'resolve', '--intent', intentId, '--json'], dir);
    assert.equal(result.status, 1, `should fail: ${result.stdout}`);

    const out = JSON.parse(result.stdout);
    assert.equal(out.ok, false);
    assert.ok(out.error.includes('must be executing or blocked'));
  });

  it('allows a blocked intent to resolve to completed after the same run recovers', () => {
    const { intentId } = pipelineThroughStart(dir);

    setRunStatus(dir, {
      status: 'blocked',
      active_turns: {},
      blocked_on: 'human:needs-review',
      blocked_reason: {
        category: 'needs_human',
        blocked_at: new Date().toISOString(),
        turn_id: null,
        recovery: {
          typed_reason: 'needs_human',
          owner: 'human',
          recovery_action: 'Review and unblock',
          turn_retained: false,
          detail: null,
        },
      },
    });

    const blockedResult = runCli(['intake', 'resolve', '--intent', intentId, '--json'], dir);
    assert.equal(blockedResult.status, 0, `initial blocked resolve failed: ${blockedResult.stderr}\n${blockedResult.stdout}`);
    const blockedOut = JSON.parse(blockedResult.stdout);
    assert.equal(blockedOut.new_status, 'blocked');

    const completedAt = new Date().toISOString();
    setRunStatus(dir, {
      status: 'completed',
      completed_at: completedAt,
      last_completed_turn_id: 'turn_after_recovery',
      blocked_on: null,
      blocked_reason: null,
    });

    const completedResult = runCli(['intake', 'resolve', '--intent', intentId, '--json'], dir);
    assert.equal(completedResult.status, 0, `recovery resolve failed: ${completedResult.stderr}\n${completedResult.stdout}`);
    const completedOut = JSON.parse(completedResult.stdout);
    assert.equal(completedOut.previous_status, 'blocked');
    assert.equal(completedOut.new_status, 'completed');
    assert.equal(completedOut.intent.status, 'completed');
    assert.equal(completedOut.intent.run_completed_at, completedAt);
  });

  // AT-V3S5-009: missing target_run rejection
  it('rejects resolve when intent has null target_run', () => {
    const { intentId } = pipelineThroughStart(dir);

    // Manually null out target_run on intent
    const intentPath = join(dir, '.agentxchain', 'intake', 'intents', `${intentId}.json`);
    const intent = JSON.parse(readFileSync(intentPath, 'utf8'));
    intent.target_run = null;
    writeFileSync(intentPath, JSON.stringify(intent, null, 2));

    const result = runCli(['intake', 'resolve', '--intent', intentId, '--json'], dir);
    assert.equal(result.status, 1, `should fail: ${result.stdout}`);

    const out = JSON.parse(result.stdout);
    assert.equal(out.ok, false);
    assert.ok(out.error.includes('target_run is null'));
  });

  // AT-V3S5-010: history entry records run linkage
  it('records run_id and run_status in history entry after blocked transition', () => {
    const { intentId, runId } = pipelineThroughStart(dir);

    setRunStatus(dir, {
      status: 'blocked',
      active_turns: {},
      blocked_on: 'human:needs-review',
      blocked_reason: {
        category: 'needs_human',
        blocked_at: new Date().toISOString(),
        turn_id: null,
        recovery: {
          typed_reason: 'needs_human',
          owner: 'human',
          recovery_action: 'Review and unblock',
          turn_retained: false,
          detail: null,
        },
      },
    });

    const result = runCli(['intake', 'resolve', '--intent', intentId, '--json'], dir);
    assert.equal(result.status, 0);

    const out = JSON.parse(result.stdout);
    const lastHistory = out.intent.history[out.intent.history.length - 1];
    assert.equal(lastHistory.from, 'executing');
    assert.equal(lastHistory.to, 'blocked');
    assert.equal(lastHistory.run_id, runId);
    assert.equal(lastHistory.run_status, 'blocked');
    assert.ok(lastHistory.at);
    assert.ok(lastHistory.reason.includes('blocked'));
  });

  // AT-V3S5-011: blocked intent can be re-approved
  it('allows re-approval of a blocked intent via intake approve', () => {
    const { intentId } = pipelineThroughStart(dir);

    // Block the run
    setRunStatus(dir, {
      status: 'blocked',
      active_turns: {},
      blocked_on: 'human:needs-fix',
      blocked_reason: {
        category: 'needs_human',
        blocked_at: new Date().toISOString(),
        turn_id: null,
        recovery: {
          typed_reason: 'needs_human',
          owner: 'human',
          recovery_action: 'Fix it',
          turn_retained: false,
          detail: null,
        },
      },
    });

    // Resolve to blocked
    const resolveResult = runCli(['intake', 'resolve', '--intent', intentId, '--json'], dir);
    assert.equal(resolveResult.status, 0);
    assert.equal(JSON.parse(resolveResult.stdout).new_status, 'blocked');

    // Re-approve the blocked intent
    const approveResult = runCli(['intake', 'approve', '--intent', intentId, '--approver', 'operator', '--json'], dir);
    assert.equal(approveResult.status, 0, `approve failed: ${approveResult.stderr}\n${approveResult.stdout}`);

    const out = JSON.parse(approveResult.stdout);
    assert.equal(out.ok, true);
    assert.equal(out.intent.status, 'approved');

    // Verify history shows blocked → approved
    const lastHistory = out.intent.history[out.intent.history.length - 1];
    assert.equal(lastHistory.from, 'blocked');
    assert.equal(lastHistory.to, 'approved');
  });

  // AT-V3S5-012: completed intent creates observation directory
  it('creates the observation directory scaffold on completed transition', () => {
    const { intentId } = pipelineThroughStart(dir);

    setRunStatus(dir, {
      status: 'completed',
      active_turns: {},
      completed_at: new Date().toISOString(),
      last_completed_turn_id: 'turn_done',
    });

    const result = runCli(['intake', 'resolve', '--intent', intentId, '--json'], dir);
    assert.equal(result.status, 0);

    const obsDir = join(dir, '.agentxchain', 'intake', 'observations', intentId);
    assert.ok(existsSync(obsDir), 'observation directory should exist');
  });

  // AT-V3S5-013: JSON output shape
  it('returns correct JSON output shape with all required fields', () => {
    const { intentId } = pipelineThroughStart(dir);

    setRunStatus(dir, {
      status: 'completed',
      active_turns: {},
      completed_at: new Date().toISOString(),
      last_completed_turn_id: 'turn_final',
    });

    const result = runCli(['intake', 'resolve', '--intent', intentId, '--json'], dir);
    assert.equal(result.status, 0);

    const out = JSON.parse(result.stdout);
    assert.ok('intent' in out);
    assert.ok('previous_status' in out);
    assert.ok('new_status' in out);
    assert.ok('run_outcome' in out);
    assert.ok('no_change' in out);
    assert.equal(typeof out.intent.intent_id, 'string');
    assert.equal(out.previous_status, 'executing');
    assert.equal(out.new_status, 'completed');
    assert.equal(out.run_outcome, 'completed');
    assert.equal(out.no_change, false);
  });

  // AT-V3S5-014: idle run rejection
  it('rejects when governed run is idle', () => {
    const { intentId } = pipelineThroughStart(dir);

    // Reset state to idle
    setRunStatus(dir, {
      status: 'idle',
      active_turns: {},
      run_id: JSON.parse(readFileSync(join(dir, '.agentxchain', 'state.json'), 'utf8')).run_id,
    });

    const result = runCli(['intake', 'resolve', '--intent', intentId, '--json'], dir);
    assert.equal(result.status, 1, `should fail: ${result.stdout}`);

    const out = JSON.parse(result.stdout);
    assert.equal(out.ok, false);
    assert.ok(out.error.includes('idle'));
  });

  // Edge: non-existent intent
  it('rejects with exit 2 for non-existent intent', () => {
    const result = runCli(['intake', 'resolve', '--intent', 'intent_nonexistent', '--json'], dir);
    assert.equal(result.status, 2, `should exit 2: ${result.stdout}`);

    const out = JSON.parse(result.stdout);
    assert.equal(out.ok, false);
    assert.ok(out.error.includes('not found'));
  });
});
