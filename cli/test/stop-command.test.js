import { strict as assert } from 'node:assert';
import { afterEach, describe, it } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(__dirname, '..', 'bin', 'agentxchain.js');
const DASHBOARD_PID_FILE = '.agentxchain-dashboard.pid';
const DASHBOARD_SESSION_FILE = '.agentxchain-dashboard.json';

const tempDirs = new Set();
const trackedPids = new Set();

function createProject() {
  const dir = join(tmpdir(), `agentxchain-stop-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  tempDirs.add(dir);

  const config = {
    version: 3,
    project: 'Stop Test',
    agents: {
      pm: { name: 'PM', mandate: 'Plan work' },
      dev: { name: 'Dev', mandate: 'Build work' },
    },
    talk_file: 'TALK.md',
    state_file: 'state.md',
    history_file: 'history.jsonl',
  };

  writeFileSync(join(dir, 'agentxchain.json'), JSON.stringify(config, null, 2));
  writeFileSync(join(dir, 'lock.json'), JSON.stringify({
    holder: null,
    last_released_by: null,
    turn_number: 0,
    claimed_at: null,
  }, null, 2));
  writeFileSync(join(dir, 'state.json'), JSON.stringify({
    phase: 'build',
    blocked: false,
    blocked_on: null,
    project: 'Stop Test',
  }, null, 2));
  writeFileSync(join(dir, 'state.md'), '# state\n');
  writeFileSync(join(dir, 'history.jsonl'), '');
  writeFileSync(join(dir, 'TALK.md'), '## Turn 1\n- Next owner: pm\n');

  return dir;
}

function runCli(cwd, args) {
  return spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 15_000,
    env: { ...process.env, NO_COLOR: '1' },
  });
}

function spawnSleeper() {
  const child = spawn(
    process.execPath,
    ['-e', 'process.on("SIGTERM",()=>process.exit(0)); setInterval(() => {}, 1000);'],
    {
      stdio: 'ignore',
      detached: false,
    },
  );
  trackedPids.add(child.pid);
  child.unref();
  return child.pid;
}

function waitForExit(pid, timeoutMs = 5000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      try {
        process.kill(pid, 0);
      } catch (err) {
        if (err.code === 'ESRCH') {
          trackedPids.delete(pid);
          resolve();
          return;
        }
        reject(err);
        return;
      }

      if (Date.now() - start > timeoutMs) {
        reject(new Error(`PID ${pid} did not exit within ${timeoutMs}ms`));
        return;
      }

      setTimeout(poll, 50);
    };

    poll();
  });
}

afterEach(() => {
  for (const pid of [...trackedPids]) {
    try { process.kill(pid, 'SIGKILL'); } catch {}
    trackedPids.delete(pid);
  }

  for (const dir of [...tempDirs]) {
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
    tempDirs.delete(dir);
  }
});

describe('agentxchain stop', () => {
  it('AT-STOP-001: stops a live watch PID with SIGTERM', async () => {
    const dir = createProject();
    const pid = spawnSleeper();
    writeFileSync(join(dir, '.agentxchain-watch.pid'), String(pid));

    const result = runCli(dir, ['stop']);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /Stopped watch process/);

    await waitForExit(pid);
  });

  it('AT-STOP-002: removes a stale watch PID file and reports no active session', () => {
    const dir = createProject();
    const pidPath = join(dir, '.agentxchain-watch.pid');
    writeFileSync(pidPath, '999999');

    const result = runCli(dir, ['stop']);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /Removed stale watch PID file/);
    assert.match(result.stdout, /No active session found/);
    assert.equal(existsSync(pidPath), false, 'stale PID file should be removed');
  });

  it('AT-STOP-003: stops claude-code agent PIDs and removes the session file', async () => {
    const dir = createProject();
    const pmPid = spawnSleeper();
    const devPid = spawnSleeper();
    const sessionPath = join(dir, '.agentxchain-session.json');

    writeFileSync(sessionPath, JSON.stringify({
      ide: 'claude-code',
      launched: [
        { id: 'pm', pid: pmPid },
        { id: 'dev', pid: devPid },
      ],
    }, null, 2));

    const result = runCli(dir, ['stop']);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /Stopping 2 agents \(claude-code\)/);
    assert.match(result.stdout, /Sent SIGTERM to pm/);
    assert.match(result.stdout, /Sent SIGTERM to dev/);
    assert.match(result.stdout, /Session file removed/);
    assert.equal(existsSync(sessionPath), false, 'session file should be removed');

    await Promise.all([waitForExit(pmPid), waitForExit(devPid)]);
  });

  it('AT-STOP-004: keeps manual-close guidance for cursor sessions and removes the session file', () => {
    const dir = createProject();
    const sessionPath = join(dir, '.agentxchain-session.json');
    writeFileSync(sessionPath, JSON.stringify({
      ide: 'cursor',
      launched: [{ id: 'pm' }],
    }, null, 2));

    const result = runCli(dir, ['stop']);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /Stopping 1 agents \(cursor\)/);
    assert.match(result.stdout, /close the chat sessions manually/i);
    assert.equal(existsSync(sessionPath), false, 'session file should be removed');
  });

  it('AT-STOP-005: fails outside a project root', () => {
    const dir = createProject();
    unlinkSync(join(dir, 'agentxchain.json'));

    const result = runCli(dir, ['stop']);
    assert.notEqual(result.status, 0, 'missing project root should fail');
    assert.match(result.stdout, /No agentxchain\.json found/);
  });

  it('AT-DASH-DAEMON-005: stops a live dashboard PID with SIGTERM and removes session files', async () => {
    const dir = createProject();
    const pid = spawnSleeper();
    writeFileSync(join(dir, DASHBOARD_PID_FILE), String(pid));
    writeFileSync(join(dir, DASHBOARD_SESSION_FILE), JSON.stringify({
      pid,
      port: 3847,
      url: 'http://localhost:3847',
      started_at: '2026-04-14T15:00:00.000Z',
    }, null, 2));

    const result = runCli(dir, ['stop']);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /Stopped dashboard process/);

    await waitForExit(pid);
    assert.equal(existsSync(join(dir, DASHBOARD_PID_FILE)), false, 'dashboard PID file should be removed');
    assert.equal(existsSync(join(dir, DASHBOARD_SESSION_FILE)), false, 'dashboard session file should be removed');
  });

  it('AT-DASH-DAEMON-006: removes stale dashboard session files and reports the cleanup', () => {
    const dir = createProject();
    writeFileSync(join(dir, DASHBOARD_PID_FILE), '999999');
    writeFileSync(join(dir, DASHBOARD_SESSION_FILE), JSON.stringify({
      pid: 999999,
      port: 3847,
      url: 'http://localhost:3847',
      started_at: '2026-04-14T15:00:00.000Z',
    }, null, 2));

    const result = runCli(dir, ['stop']);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /Removed stale dashboard session files/);
    assert.equal(existsSync(join(dir, DASHBOARD_PID_FILE)), false, 'stale dashboard PID file should be removed');
    assert.equal(existsSync(join(dir, DASHBOARD_SESSION_FILE)), false, 'stale dashboard session file should be removed');
  });
});
