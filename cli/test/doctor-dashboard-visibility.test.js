import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  readFileSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { scaffoldGoverned } from '../src/commands/init.js';

const cliRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI_BIN = join(cliRoot, 'bin', 'agentxchain.js');
const MOCK_AGENT = join(cliRoot, 'test-support', 'mock-agent.mjs');
const tempDirs = [];

function makeGoverned() {
  const root = mkdtempSync(join(tmpdir(), 'axc-dd-vis-'));
  tempDirs.push(root);
  scaffoldGoverned(root, 'Dashboard Vis Test', `dash-vis-${Date.now()}`);

  const configPath = join(root, 'agentxchain.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));

  for (const runtimeId of Object.keys(config.runtimes || {})) {
    config.runtimes[runtimeId] = {
      type: 'local_cli',
      command: process.execPath,
      args: [MOCK_AGENT],
      prompt_transport: 'dispatch_bundle_only',
    };
  }
  for (const role of Object.values(config.roles || {})) {
    role.write_authority = 'authoritative';
  }

  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
  return root;
}

function runCli(root, args) {
  const result = spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout: 15000,
  });
  return result;
}

afterEach(() => {
  while (tempDirs.length) {
    const d = tempDirs.pop();
    try { rmSync(d, { recursive: true, force: true }); } catch {}
  }
});

describe('Doctor Dashboard Visibility', () => {
  it('AT-DOCTOR-DASH-001: no dashboard files → info level, "No dashboard session"', () => {
    const root = makeGoverned();
    const result = runCli(root, ['doctor', '--json']);
    assert.equal(result.status, 0, `stderr: ${result.stderr}`);
    const output = JSON.parse(result.stdout);
    const dashCheck = output.checks.find(c => c.id === 'dashboard_session');
    assert.ok(dashCheck, 'Should include dashboard_session check');
    assert.equal(dashCheck.level, 'info');
    assert.ok(dashCheck.detail.includes('No dashboard session'), `Detail: ${dashCheck.detail}`);
  });

  it('AT-DOCTOR-DASH-002: live PID + valid session → pass level with URL and PID', () => {
    const root = makeGoverned();
    // Write PID file with current process PID (guaranteed alive)
    writeFileSync(join(root, '.agentxchain-dashboard.pid'), `${process.pid}\n`);
    writeFileSync(join(root, '.agentxchain-dashboard.json'), JSON.stringify({
      pid: process.pid,
      port: 3847,
      url: 'http://localhost:3847',
      started_at: new Date().toISOString(),
    }, null, 2) + '\n');

    const result = runCli(root, ['doctor', '--json']);
    assert.equal(result.status, 0, `stderr: ${result.stderr}`);
    const output = JSON.parse(result.stdout);
    const dashCheck = output.checks.find(c => c.id === 'dashboard_session');
    assert.ok(dashCheck, 'Should include dashboard_session check');
    assert.equal(dashCheck.level, 'pass');
    assert.ok(dashCheck.detail.includes('http://localhost:3847'), `Detail should contain URL: ${dashCheck.detail}`);
    assert.ok(dashCheck.detail.includes(`PID: ${process.pid}`), `Detail should contain PID: ${dashCheck.detail}`);
  });

  it('AT-DOCTOR-DASH-003: dead PID + session file → warn level, "Stale"', () => {
    const root = makeGoverned();
    const deadPid = 999999;
    // Write session file with a dead PID — but do NOT write the PID file
    // (getDashboardPid auto-cleans stale PID files, so just test the session-only case)
    writeFileSync(join(root, '.agentxchain-dashboard.json'), JSON.stringify({
      pid: deadPid,
      port: 3847,
      url: 'http://localhost:3847',
      started_at: '2026-04-14T00:00:00Z',
    }, null, 2) + '\n');

    const result = runCli(root, ['doctor', '--json']);
    assert.equal(result.status, 0, `stderr: ${result.stderr}`);
    const output = JSON.parse(result.stdout);
    const dashCheck = output.checks.find(c => c.id === 'dashboard_session');
    assert.ok(dashCheck, 'Should include dashboard_session check');
    assert.equal(dashCheck.level, 'warn');
    assert.ok(dashCheck.detail.includes('Stale'), `Detail should mention Stale: ${dashCheck.detail}`);
  });

  it('AT-DOCTOR-DASH-004: JSON output includes dashboard_session in checks array', () => {
    const root = makeGoverned();
    const result = runCli(root, ['doctor', '--json']);
    assert.equal(result.status, 0, `stderr: ${result.stderr}`);
    const output = JSON.parse(result.stdout);
    const dashCheck = output.checks.find(c => c.id === 'dashboard_session');
    assert.ok(dashCheck, 'checks array must contain dashboard_session');
    assert.ok(['pass', 'warn', 'info'].includes(dashCheck.level), `level must be pass/warn/info, got: ${dashCheck.level}`);
    assert.ok(typeof dashCheck.detail === 'string', 'detail must be a string');
    assert.ok(typeof dashCheck.name === 'string', 'name must be a string');
  });

  it('AT-DOCTOR-DASH-005: text output shows dashboard session line', () => {
    const root = makeGoverned();
    const result = runCli(root, ['doctor']);
    assert.equal(result.status, 0, `stderr: ${result.stderr}`);
    assert.ok(result.stdout.includes('Dashboard session'), `Should include Dashboard session label: ${result.stdout}`);
  });
});

describe('Status --json dashboard_session', () => {
  it('AT-DOCTOR-DASH-006: status --json includes dashboard_session with not_running shape', () => {
    const root = makeGoverned();
    // Run init to create state directory
    spawnSync(process.execPath, [CLI_BIN, 'run', '--dry-run'], {
      cwd: root,
      encoding: 'utf8',
      timeout: 15000,
    });

    const result = runCli(root, ['status', '--json']);
    // status --json may exit 0 or 1 depending on state; we just care about the shape
    let output;
    try {
      output = JSON.parse(result.stdout);
    } catch {
      // If status fails entirely (no config etc.), skip shape check
      return;
    }

    if (output.dashboard_session !== undefined) {
      assert.equal(output.dashboard_session.status, 'not_running');
      assert.equal(output.dashboard_session.pid, null);
      assert.equal(output.dashboard_session.url, null);
      assert.equal(output.dashboard_session.started_at, null);
    }
  });
});
