import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { scaffoldGoverned } from '../src/commands/init.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(__dirname, '..', 'bin', 'agentxchain.js');
const dirs = [];

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

function setupProject() {
  const dir = mkdtempSync(join(tmpdir(), 'axc-status-gate-failure-'));
  scaffoldGoverned(dir, 'Status Gate Failure Fixture', 'status-gate-failure-fixture');
  const state = JSON.parse(readFileSync(join(dir, '.agentxchain', 'state.json'), 'utf8'));
  writeJson(join(dir, '.agentxchain', 'state.json'), {
    ...state,
    run_id: 'run_status_gate_failure',
    project_id: 'status-gate-failure-fixture',
    status: 'active',
    phase: 'planning',
    active_turns: {},
    turn_sequence: 2,
    last_gate_failure: {
      gate_type: 'phase_transition',
      gate_id: 'planning_signoff',
      phase: 'planning',
      from_phase: 'planning',
      to_phase: 'implementation',
      requested_by_turn: 'turn_abc123',
      failed_at: '2026-04-11T08:00:00.000Z',
      queued_request: true,
      reasons: [
        'Missing file: .planning/PM_SIGNOFF.md',
        'Verification status is "missing", requires "pass" or "attested_pass"',
      ],
      missing_files: ['.planning/PM_SIGNOFF.md'],
      missing_verification: true,
    },
    phase_gate_status: {
      planning_signoff: 'failed',
      implementation_complete: 'pending',
      qa_ship_verdict: 'pending',
    },
  });
  return dir;
}

after(() => {
  for (const dir of dirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {}
  }
});

describe('governed status gate-failure surface', () => {
  it('AT-GFV-004: status shows persisted queued-drain gate failure and recovery direction', () => {
    const dir = setupProject();
    dirs.push(dir);

    const result = runCli(dir, ['status']);
    assert.equal(result.status, 0, `status failed: ${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /Gate fail:\s+PHASE TRANSITION/);
    assert.match(result.stdout, /Gate:\s+planning_signoff/);
    assert.match(result.stdout, /Request:\s+planning -> implementation/);
    assert.match(result.stdout, /Source:\s+queued drain request/);
    assert.match(result.stdout, /Turn:\s+turn_abc123/);
    assert.match(result.stdout, /Missing file: \.planning\/PM_SIGNOFF\.md/);
    assert.match(result.stdout, /Verification status is "missing"/);
    assert.match(result.stdout, /Action:\s+agentxchain assign pm to keep working in planning/);
  });

  it('status --json preserves last_gate_failure for automation surfaces', () => {
    const dir = setupProject();
    dirs.push(dir);

    const result = runCli(dir, ['status', '--json']);
    assert.equal(result.status, 0, `status --json failed: ${result.stdout}\n${result.stderr}`);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.state.last_gate_failure.gate_type, 'phase_transition');
    assert.equal(payload.state.last_gate_failure.queued_request, true);
    assert.deepEqual(payload.state.last_gate_failure.missing_files, ['.planning/PM_SIGNOFF.md']);
  });
});
