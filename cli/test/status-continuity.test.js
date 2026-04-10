import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync, execSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'os';
import { scaffoldGoverned } from '../src/commands/init.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(__dirname, '..', 'bin', 'agentxchain.js');

function runCli(cwd, args) {
  return spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 15_000,
    env: { ...process.env, NO_COLOR: '1' },
  });
}

function writeJson(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2));
}

function setupProject(stateOverrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'axc-status-continuity-'));
  scaffoldGoverned(dir, 'Status Continuity Fixture', 'status-continuity-fixture');
  const scaffoldState = JSON.parse(readFileSync(join(dir, '.agentxchain/state.json'), 'utf8'));
  const baseState = {
    ...scaffoldState,
    run_id: 'run_status123',
    project_id: 'status-continuity-fixture',
    status: 'active',
    phase: 'implementation',
    current_phase: 'implementation',
    accepted_integration_ref: 'git:abc123',
    current_turn: {
      turn_id: 'turn-002',
      assigned_role: 'dev',
      runtime_id: 'local-dev',
      status: 'running',
      attempt: 1,
    },
    turn_sequence: 2,
    last_completed_turn_id: 'turn-001',
    ...stateOverrides,
  };
  writeJson(join(dir, '.agentxchain/state.json'), baseState);
  return dir;
}

const dirs = [];

after(() => {
  for (const dir of dirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {}
  }
});

describe('governed status continuity surface', () => {
  it('AT-SSC-001: human-readable status shows checkpoint details, restart guidance, and recovery report path', () => {
    const dir = setupProject();
    dirs.push(dir);

    writeJson(join(dir, '.agentxchain/session.json'), {
      session_id: 'session_demo',
      run_id: 'run_status123',
      last_checkpoint_at: '2026-04-09T21:00:00Z',
      last_turn_id: 'turn-002',
      last_role: 'dev',
      checkpoint_reason: 'turn_accepted',
    });
    writeFileSync(join(dir, '.agentxchain/SESSION_RECOVERY.md'), '# Session Recovery Report\n');

    const result = runCli(dir, ['status']);
    assert.equal(result.status, 0, `status failed: ${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /Continuity:/);
    assert.match(result.stdout, /Session:\s+session_demo/);
    assert.match(result.stdout, /Checkpoint:\s+turn_accepted at 2026-04-09T21:00:00Z/);
    assert.match(result.stdout, /Last turn:\s+turn-002/);
    assert.match(result.stdout, /Last role:\s+dev/);
    assert.match(result.stdout, /Action:\s+agentxchain restart/);
    assert.match(result.stdout, /Report:\s+\.agentxchain\/SESSION_RECOVERY\.md/);
  });

  it('AT-SSC-002: status warns when session checkpoint run_id is stale', () => {
    const dir = setupProject();
    dirs.push(dir);

    writeJson(join(dir, '.agentxchain/session.json'), {
      session_id: 'session_stale',
      run_id: 'run_old999',
      last_checkpoint_at: '2026-04-09T21:05:00Z',
      checkpoint_reason: 'phase_approved',
    });

    const result = runCli(dir, ['status']);
    assert.equal(result.status, 0, `status failed: ${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /Warning:\s+session checkpoint tracks run_old999, but state\.json tracks run_status123; state\.json remains source of truth/);
  });

  it('AT-SSC-003: status --json exposes continuity metadata for automation surfaces', () => {
    const dir = setupProject({
      last_completed_turn_id: 'turn-003',
    });
    dirs.push(dir);

    writeJson(join(dir, '.agentxchain/session.json'), {
      session_id: 'session_json',
      run_id: 'run_status123',
      last_checkpoint_at: '2026-04-09T21:10:00Z',
      last_turn_id: 'turn-003',
      last_role: 'qa',
      checkpoint_reason: 'phase_approved',
    });

    const result = runCli(dir, ['status', '--json']);
    assert.equal(result.status, 0, `status --json failed: ${result.stdout}\n${result.stderr}`);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.continuity.checkpoint.session_id, 'session_json');
    assert.equal(payload.continuity.checkpoint.checkpoint_reason, 'phase_approved');
    assert.equal(payload.continuity.checkpoint.last_turn_id, 'turn-003');
    assert.equal(payload.continuity.stale_checkpoint, false);
    assert.equal(payload.continuity.restart_recommended, true);
    assert.equal(payload.continuity.recommended_command, 'agentxchain restart');
    assert.equal(payload.continuity.recommended_reason, 'restart_available');
    assert.equal(payload.continuity.recommended_detail, 'rebuild session context from disk');
    assert.equal(payload.continuity.drift_detected, null);
    assert.deepEqual(payload.continuity.drift_warnings, []);
    assert.equal(payload.continuity.recovery_report_path, null);
  });

  it('AT-CA-001: pending phase approval exposes approve-transition instead of restart', () => {
    const dir = setupProject({
      status: 'paused',
      active_turns: {},
      pending_phase_transition: {
        from: 'planning',
        to: 'implementation',
        gate: 'planning_signoff',
      },
    });
    dirs.push(dir);

    writeJson(join(dir, '.agentxchain/session.json'), {
      session_id: 'session_gate',
      run_id: 'run_status123',
      last_checkpoint_at: '2026-04-09T21:20:00Z',
      last_turn_id: 'turn-003',
      last_role: 'pm',
      checkpoint_reason: 'turn_accepted',
    });

    const result = runCli(dir, ['status', '--json']);
    assert.equal(result.status, 0, `status --json failed: ${result.stdout}\n${result.stderr}`);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.continuity.restart_recommended, false);
    assert.equal(payload.continuity.recommended_command, 'agentxchain approve-transition');
    assert.equal(payload.continuity.recommended_reason, 'pending_phase_transition');
    assert.equal(payload.continuity.recommended_detail, 'planning -> implementation (gate: planning_signoff)');
  });

  it('AT-CA-002: status surfaces checkpoint drift from baseline_ref', () => {
    const dir = setupProject();
    dirs.push(dir);

    execSync('git init', { cwd: dir, stdio: 'ignore' });
    execSync('git config user.email "test@example.com"', { cwd: dir, stdio: 'ignore' });
    execSync('git config user.name "Test User"', { cwd: dir, stdio: 'ignore' });
    execSync('git add .', { cwd: dir, stdio: 'ignore' });
    execSync('git commit -m "baseline"', { cwd: dir, stdio: 'ignore' });

    writeJson(join(dir, '.agentxchain/session.json'), {
      session_id: 'session_drift',
      run_id: 'run_status123',
      last_checkpoint_at: '2026-04-09T21:30:00Z',
      last_turn_id: 'turn-002',
      last_role: 'dev',
      checkpoint_reason: 'turn_assigned',
      baseline_ref: {
        git_head: '0000000000000000000000000000000000000000',
        git_branch: 'feature/drifted',
        workspace_dirty: false,
      },
    });

    writeFileSync(join(dir, 'notes.txt'), 'dirty workspace after checkpoint\n');

    const result = runCli(dir, ['status']);
    assert.equal(result.status, 0, `status failed: ${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /Drift:\s+Git HEAD has moved since checkpoint/);
    assert.match(result.stdout, /Branch changed since checkpoint: feature\/drifted -> /);
    assert.match(result.stdout, /Workspace was clean at checkpoint but is now dirty/);

    const jsonResult = runCli(dir, ['status', '--json']);
    assert.equal(jsonResult.status, 0, `status --json failed: ${jsonResult.stdout}\n${jsonResult.stderr}`);
    const payload = JSON.parse(jsonResult.stdout);
    assert.equal(payload.continuity.drift_detected, true);
    assert.equal(payload.continuity.drift_warnings.length, 3);
  });

  it('AT-RTSA-004: reserved run-level failed is surfaced as a non-restartable reserved state', () => {
    const dir = setupProject({
      status: 'failed',
      current_turn: null,
      active_turns: {},
    });
    dirs.push(dir);

    writeJson(join(dir, '.agentxchain/session.json'), {
      session_id: 'session_failed',
      run_id: 'run_status123',
      last_checkpoint_at: '2026-04-09T21:35:00Z',
      checkpoint_reason: 'turn_accepted',
    });

    const result = runCli(dir, ['status', '--json']);
    assert.equal(result.status, 0, `status --json failed: ${result.stdout}\n${result.stderr}`);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.continuity.restart_recommended, false);
    assert.equal(payload.continuity.recommended_command, null);
    assert.equal(payload.continuity.recommended_reason, 'reserved_terminal_state');
    assert.equal(payload.continuity.recommended_detail, 'run-level failed is reserved and not emitted by current governed writers');
  });

  it('AT-RTSA-005: restart fails closed on reserved run-level failed status', () => {
    const dir = setupProject({
      status: 'failed',
      current_turn: null,
      active_turns: {},
    });
    dirs.push(dir);

    const result = runCli(dir, ['restart']);
    assert.equal(result.status, 1, `restart unexpectedly succeeded: ${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /Run uses reserved status: failed\./);
    assert.match(result.stdout, /Current governed writers do not emit run-level failed\./);
  });
});
