import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, unlinkSync, existsSync } from 'node:fs';
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

function setupProject() {
  const dir = mkdtempSync(join(tmpdir(), 'axc-status-gate-detail-'));
  scaffoldGoverned(dir, 'Gate Detail Fixture', 'gate-detail-fixture');
  return dir;
}

after(() => {
  for (const dir of dirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {}
  }
});

describe('status — gate detail surface', () => {
  it('AT-SGD-001: status shows required files for the active phase gate', () => {
    const dir = setupProject();
    dirs.push(dir);

    const result = runCli(dir, ['status']);
    assert.equal(result.status, 0, `status failed: ${result.stdout}\n${result.stderr}`);
    // planning_signoff is the active phase gate; it should show file names
    assert.match(result.stdout, /planning_signoff: pending/);
    assert.match(result.stdout, /Files:.*PM_SIGNOFF\.md/);
    assert.match(result.stdout, /Files:.*ROADMAP\.md/);
    assert.match(result.stdout, /Files:.*SYSTEM_SPEC\.md/);
  });

  it('AT-SGD-002: status shows human approval requirement for gates that need it', () => {
    const dir = setupProject();
    dirs.push(dir);

    const result = runCli(dir, ['status']);
    assert.equal(result.status, 0, `status failed: ${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /Needs:.*human approval/);
  });

  it('AT-SGD-003: non-active phase gates do not expand details', () => {
    const dir = setupProject();
    dirs.push(dir);

    const result = runCli(dir, ['status']);
    assert.equal(result.status, 0, `status failed: ${result.stdout}\n${result.stderr}`);
    // implementation_complete and qa_ship_verdict should NOT have Files: lines
    const lines = result.stdout.split('\n');
    let foundImplGate = false;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('implementation_complete: pending')) {
        foundImplGate = true;
        // The next line should NOT contain "Files:"
        if (i + 1 < lines.length) {
          assert.doesNotMatch(lines[i + 1], /Files:/, 'non-active gate should not expand file details');
        }
      }
    }
    assert.ok(foundImplGate, 'implementation_complete gate should appear in output');
  });

  it('AT-SGD-004: passed gates do not expand details', () => {
    const dir = setupProject();
    dirs.push(dir);

    // Manually mark planning_signoff as passed
    const statePath = join(dir, '.agentxchain', 'state.json');
    const state = JSON.parse(readFileSync(statePath, 'utf8'));
    state.phase_gate_status.planning_signoff = 'passed';
    writeFileSync(statePath, JSON.stringify(state, null, 2));

    const result = runCli(dir, ['status']);
    assert.equal(result.status, 0, `status failed: ${result.stdout}\n${result.stderr}`);
    // planning_signoff is passed, so no Files: detail should follow
    const lines = result.stdout.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('planning_signoff: passed')) {
        if (i + 1 < lines.length) {
          assert.doesNotMatch(lines[i + 1], /Files:/, 'passed gate should not expand file details');
        }
      }
    }
  });

  it('AT-SGD-005: verification pass requirement shown for implementation gate', () => {
    const dir = setupProject();
    dirs.push(dir);

    // Move state to implementation phase
    const statePath = join(dir, '.agentxchain', 'state.json');
    const state = JSON.parse(readFileSync(statePath, 'utf8'));
    state.phase = 'implementation';
    state.phase_gate_status.planning_signoff = 'passed';
    writeFileSync(statePath, JSON.stringify(state, null, 2));

    const result = runCli(dir, ['status']);
    assert.equal(result.status, 0, `status failed: ${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /implementation_complete: pending/);
    assert.match(result.stdout, /Needs:.*verification pass/);
  });
});
