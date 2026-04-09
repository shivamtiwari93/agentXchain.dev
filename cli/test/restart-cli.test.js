import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import { join, dirname, resolve } from 'path';
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

function setupProject(stateOverrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'axc-restart-'));
  scaffoldGoverned(dir, 'Restart Fixture', 'restart-fixture');

  const baseState = {
    schema_version: '1.1',
    run_id: 'run_test123',
    project_id: 'restart-fixture',
    status: 'paused',
    phase: 'implementation',
    current_phase: 'implementation',
    active_turns: {},
    turn_count: 2,
    ...stateOverrides,
  };

  writeFileSync(join(dir, '.agentxchain/state.json'), JSON.stringify(baseState, null, 2));
  return dir;
}

const dirs = [];

after(() => {
  for (const d of dirs) {
    try { rmSync(d, { recursive: true, force: true }); } catch {}
  }
});

describe('agentxchain restart', () => {
  it('AT-SCR-001: succeeds on a paused run with valid checkpoint and assigns next turn', () => {
    const dir = setupProject();
    dirs.push(dir);

    // Write a checkpoint
    writeFileSync(join(dir, '.agentxchain/session.json'), JSON.stringify({
      session_id: 'session_old',
      run_id: 'run_test123',
      last_checkpoint_at: '2026-04-09T01:00:00Z',
      last_turn_id: 'turn-002',
      last_phase: 'implementation',
      last_role: 'dev',
      checkpoint_reason: 'turn_accepted',
    }, null, 2));

    const result = runCli(dir, ['restart']);
    assert.equal(result.status, 0, `Expected success, got: ${result.stdout}\n${result.stderr}`);
    assert.ok(
      result.stdout.includes('Restarted run') || result.stdout.includes('Reconnected to run'),
      `Expected restart output, got: ${result.stdout}`
    );
  });

  it('AT-SCR-002: fails with exit 1 on a completed run', () => {
    const dir = setupProject({ status: 'completed', completed_at: '2026-04-09T00:00:00Z' });
    dirs.push(dir);

    const result = runCli(dir, ['restart']);
    assert.notEqual(result.status, 0, 'should fail on completed run');
    assert.ok(result.stdout.includes('terminal state'), `Expected terminal state, got: ${result.stdout}`);
  });

  it('AT-SCR-003: fails with exit 1 when no governed run (no state.json)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'axc-restart-nostate-'));
    scaffoldGoverned(dir, 'No State', 'no-state');
    // Remove the scaffolded state.json to simulate "no governed run"
    rmSync(join(dir, '.agentxchain/state.json'), { force: true });
    dirs.push(dir);

    const result = runCli(dir, ['restart']);
    assert.notEqual(result.status, 0, 'should fail when no state');
    assert.ok(result.stdout.includes('No governed run'), `Expected no-run error, got: ${result.stdout}`);
  });

  it('AT-SCR-005: writes SESSION_RECOVERY.md with run identity and phase', () => {
    const dir = setupProject();
    dirs.push(dir);

    // Write history for the report
    writeFileSync(join(dir, '.agentxchain/history.jsonl'), [
      JSON.stringify({ turn_id: 'turn-001', role: 'dev', phase: 'planning', status: 'accepted' }),
      JSON.stringify({ turn_id: 'turn-002', role: 'dev', phase: 'implementation', status: 'accepted' }),
    ].join('\n') + '\n');

    const result = runCli(dir, ['restart']);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);

    const recoveryPath = join(dir, '.agentxchain/SESSION_RECOVERY.md');
    assert.ok(existsSync(recoveryPath), 'SESSION_RECOVERY.md should exist');
    const content = readFileSync(recoveryPath, 'utf8');
    assert.ok(content.includes('run_test123'), 'should contain run_id');
    assert.ok(content.includes('implementation'), 'should contain phase');
    assert.ok(content.includes('Turn History'), 'should contain turn history');
  });

  it('AT-SCR-008: proceeds when session.json run_id mismatches state.json (stale checkpoint)', () => {
    const dir = setupProject();
    dirs.push(dir);

    writeFileSync(join(dir, '.agentxchain/session.json'), JSON.stringify({
      session_id: 'session_stale',
      run_id: 'run_DIFFERENT',
      checkpoint_reason: 'turn_accepted',
    }, null, 2));

    const result = runCli(dir, ['restart']);
    // Should warn but still succeed
    assert.equal(result.status, 0, `Expected restart to succeed with stale checkpoint, got: ${result.stdout}\n${result.stderr}`);
  });

  it('fails on blocked run', () => {
    const dir = setupProject({
      status: 'blocked',
      blocked_reason: 'hook_tamper_detected',
    });
    dirs.push(dir);

    const result = runCli(dir, ['restart']);
    assert.notEqual(result.status, 0, 'should fail on blocked run');
    assert.ok(result.stdout.includes('blocked'), `Expected blocked, got: ${result.stdout}`);
  });
});
