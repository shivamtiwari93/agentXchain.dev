import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
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

function makeProject({ schedules } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'axc-sdh-e2e-'));
  tempDirs.push(root);
  scaffoldGoverned(root, 'SDH E2E', `sdh-e2e-${Date.now()}`);

  const configPath = join(root, 'agentxchain.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  const mockRuntime = {
    type: 'local_cli',
    command: process.execPath,
    args: [MOCK_AGENT],
    prompt_transport: 'dispatch_bundle_only',
  };

  for (const runtimeId of Object.keys(config.runtimes || {})) {
    config.runtimes[runtimeId] = { ...mockRuntime };
  }
  for (const role of Object.values(config.roles || {})) {
    role.write_authority = 'authoritative';
  }

  config.schedules = schedules || {
    health_check: {
      every_minutes: 60,
      auto_approve: true,
      max_turns: 3,
      initial_role: 'pm',
    },
  };

  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
  return root;
}

function runCli(root, args, opts = {}) {
  const result = spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout: opts.timeout || 60000,
    env: { ...process.env, NO_COLOR: '1', NODE_NO_WARNINGS: '1' },
  });

  return {
    status: result.status ?? 1,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    combined: `${result.stdout || ''}${result.stderr || ''}`,
  };
}

afterEach(() => {
  for (const dir of tempDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {}
  }
  tempDirs.length = 0;
});

describe('AT-SDH-001: schedule daemon --max-cycles 1 creates daemon state file', () => {
  it('creates .agentxchain/schedule-daemon.json', () => {
    const root = makeProject();
    const r = runCli(root, ['schedule', 'daemon', '--max-cycles', '1', '--json']);
    assert.equal(r.status, 0, `daemon failed: ${r.combined}`);

    const daemonPath = join(root, '.agentxchain', 'schedule-daemon.json');
    assert.ok(existsSync(daemonPath), 'schedule-daemon.json must exist after daemon run');
  });
});

describe('AT-SDH-002: daemon state records pid, started_at, last_heartbeat_at, poll_seconds', () => {
  it('has required fields', () => {
    const root = makeProject();
    runCli(root, ['schedule', 'daemon', '--max-cycles', '1', '--poll-seconds', '5', '--json']);

    const state = JSON.parse(readFileSync(join(root, '.agentxchain', 'schedule-daemon.json'), 'utf8'));
    assert.equal(state.schema_version, '0.1');
    assert.equal(typeof state.pid, 'number');
    assert.ok(state.pid > 0, 'pid must be positive');
    assert.ok(state.started_at, 'started_at must exist');
    assert.ok(state.last_heartbeat_at, 'last_heartbeat_at must exist');
    assert.equal(state.poll_seconds, 5);
    assert.equal(state.last_cycle_result, 'ok');
  });
});

describe('AT-SDH-003: schedule status --json reports running after daemon cycle', () => {
  it('reports running status', () => {
    const root = makeProject();
    // Run daemon for 1 cycle first
    const daemon = runCli(root, ['schedule', 'daemon', '--max-cycles', '1', '--json']);
    assert.equal(daemon.status, 0, `daemon failed: ${daemon.combined}`);

    // Now check status
    const status = runCli(root, ['schedule', 'status', '--json']);
    assert.equal(status.status, 0, `status failed: ${status.combined}`);

    const parsed = JSON.parse(status.stdout.trim());
    assert.equal(parsed.ok, true);
    assert.equal(parsed.daemon.status, 'running');
    assert.equal(typeof parsed.daemon.pid, 'number');
    assert.ok(parsed.daemon.started_at);
    assert.ok(parsed.daemon.last_heartbeat_at);
    assert.equal(parsed.daemon.last_cycle_result, 'ok');
    assert.equal(typeof parsed.daemon.poll_seconds, 'number');
    assert.equal(typeof parsed.daemon.stale_after_seconds, 'number');
  });
});

describe('AT-SDH-004: schedule status --json reports never_started when no state file', () => {
  it('reports never_started status', () => {
    const root = makeProject();
    // Do not run daemon, just check status
    const status = runCli(root, ['schedule', 'status', '--json']);
    assert.equal(status.status, 0, `status failed: ${status.combined}`);

    const parsed = JSON.parse(status.stdout.trim());
    assert.equal(parsed.daemon.status, 'never_started');
  });
});

describe('AT-SDH-005: stale heartbeat reports stale, not running', () => {
  it('reports stale when heartbeat is old', () => {
    const root = makeProject();
    // Write a daemon state with an old heartbeat
    const daemonDir = join(root, '.agentxchain');
    mkdirSync(daemonDir, { recursive: true });
    const oldState = {
      schema_version: '0.1',
      pid: 99999,
      started_at: '2020-01-01T00:00:00.000Z',
      last_heartbeat_at: '2020-01-01T00:00:00.000Z',
      last_cycle_started_at: '2020-01-01T00:00:00.000Z',
      last_cycle_finished_at: '2020-01-01T00:00:01.000Z',
      last_cycle_result: 'ok',
      poll_seconds: 60,
      schedule_id: null,
      max_cycles: null,
      last_error: null,
    };
    writeFileSync(join(daemonDir, 'schedule-daemon.json'), JSON.stringify(oldState));

    const status = runCli(root, ['schedule', 'status', '--json']);
    assert.equal(status.status, 0, `status failed: ${status.combined}`);

    const parsed = JSON.parse(status.stdout.trim());
    assert.equal(parsed.daemon.status, 'stale');
  });
});

describe('AT-SDH-006: malformed state file is handled gracefully', () => {
  it('does not crash on malformed state', () => {
    const root = makeProject();
    const daemonDir = join(root, '.agentxchain');
    mkdirSync(daemonDir, { recursive: true });
    writeFileSync(join(daemonDir, 'schedule-daemon.json'), 'not valid json{{{');

    const status = runCli(root, ['schedule', 'status', '--json']);
    assert.equal(status.status, 0, `status crashed: ${status.combined}`);

    const parsed = JSON.parse(status.stdout.trim());
    assert.equal(parsed.daemon.status, 'not_running');
  });
});

describe('AT-SDH-007: schedule-daemon.json classified as orchestrator-owned state and in export/restore roots', () => {
  it('is in repo-observer ORCHESTRATOR_STATE_FILES', () => {
    const observerSrc = readFileSync(join(cliRoot, 'src', 'lib', 'repo-observer.js'), 'utf8');
    assert.match(observerSrc, /schedule-daemon\.json/);
  });

  it('is in export RUN_EXPORT_INCLUDED_ROOTS and RUN_RESTORE_ROOTS', () => {
    const exportSrc = readFileSync(join(cliRoot, 'src', 'lib', 'export.js'), 'utf8');
    const exportRootsMatch = exportSrc.match(/RUN_EXPORT_INCLUDED_ROOTS\s*=\s*\[([\s\S]*?)\];/);
    const restoreRootsMatch = exportSrc.match(/RUN_RESTORE_ROOTS\s*=\s*\[([\s\S]*?)\];/);
    assert.ok(exportRootsMatch, 'RUN_EXPORT_INCLUDED_ROOTS not found');
    assert.ok(restoreRootsMatch, 'RUN_RESTORE_ROOTS not found');
    assert.match(exportRootsMatch[1], /schedule-daemon\.json/);
    assert.match(restoreRootsMatch[1], /schedule-daemon\.json/);
  });
});

describe('schedule status human-readable output', () => {
  it('prints human-readable status without --json', () => {
    const root = makeProject();
    runCli(root, ['schedule', 'daemon', '--max-cycles', '1', '--json']);

    const status = runCli(root, ['schedule', 'status']);
    assert.equal(status.status, 0, `status failed: ${status.combined}`);
    assert.match(status.stdout, /Schedule Daemon Status/i);
    assert.match(status.stdout, /running/i);
  });
});
