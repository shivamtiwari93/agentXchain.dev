import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
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
    assert.match(result.stdout, /Restart:\s+agentxchain restart/);
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
    assert.equal(payload.continuity.recovery_report_path, null);
  });
});
