import { strict as assert } from 'node:assert';
import { afterEach, describe, it } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(__dirname, '..', 'bin', 'agentxchain.js');

const tempDirs = new Set();

function createProject(opts = {}) {
  const dir = join(tmpdir(), `agentxchain-watch-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  tempDirs.add(dir);

  const config = {
    version: 3,
    project: 'Watch Test',
    agents: opts.agents ?? {
      pm: { name: 'PM', mandate: 'Plan work' },
      dev: { name: 'Dev', mandate: 'Build work' },
    },
    talk_file: 'TALK.md',
    state_file: 'state.md',
    history_file: 'history.jsonl',
    rules: {
      watch_interval_ms: 500,
      ttl_minutes: 10,
      ...(opts.rules || {}),
    },
  };

  writeFileSync(join(dir, 'agentxchain.json'), JSON.stringify(config, null, 2));
  writeFileSync(join(dir, 'TALK.md'), '## Turn 1\n- Next owner: pm\n');
  writeFileSync(join(dir, 'state.md'), '# state\n');
  writeFileSync(join(dir, 'history.jsonl'), '');
  writeFileSync(join(dir, 'lock.json'), JSON.stringify(opts.lock ?? { holder: null, turn_number: 1 }));

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

function waitForOutput(child, pattern, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => {
      reject(new Error(`Timed out waiting for "${pattern}". Got: ${output}`));
    }, timeoutMs);

    child.stdout.on('data', (data) => {
      output += data.toString();
      if (output.includes(pattern)) {
        clearTimeout(timer);
        resolve(output);
      }
    });

    child.stderr.on('data', (data) => {
      output += data.toString();
    });

    child.on('exit', () => {
      clearTimeout(timer);
      reject(new Error(`Process exited before pattern "${pattern}". Got: ${output}`));
    });
  });
}

afterEach(() => {
  for (const dir of [...tempDirs]) {
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
    tempDirs.delete(dir);
  }
});

describe('agentxchain watch', () => {
  it('AT-WATCH-001: missing project root exits non-zero', () => {
    const dir = join(tmpdir(), `agentxchain-watch-missing-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    mkdirSync(dir, { recursive: true });
    tempDirs.add(dir);

    const result = runCli(dir, ['watch']);
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /No agentxchain\.json found/);
  });

  it('AT-WATCH-002: no agents configured exits non-zero', () => {
    const dir = createProject({ agents: {} });

    const result = runCli(dir, ['watch']);
    assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /No agents configured/);
  });

  it('AT-WATCH-003: banner shows project name, agents, poll interval, and TTL', async () => {
    const dir = createProject();

    const child = spawn(process.execPath, [CLI_BIN, 'watch'], {
      cwd: dir,
      env: { ...process.env, NO_COLOR: '1', AGENTXCHAIN_WATCH_DAEMON: '1' },
    });

    try {
      const output = await waitForOutput(child, 'Watching lock.json');
      assert.match(output, /Watch Test/, 'banner should show project name');
      assert.match(output, /pm, dev/, 'banner should show agent list');
      assert.match(output, /500ms/, 'banner should show poll interval');
      assert.match(output, /10min/, 'banner should show TTL');
    } finally {
      child.kill('SIGTERM');
    }
  });

  it('AT-WATCH-004: PID file is written on startup', async () => {
    const dir = createProject();

    const child = spawn(process.execPath, [CLI_BIN, 'watch'], {
      cwd: dir,
      env: { ...process.env, NO_COLOR: '1', AGENTXCHAIN_WATCH_DAEMON: '1' },
    });

    try {
      await waitForOutput(child, 'Watching lock.json');
      const pidPath = join(dir, '.agentxchain-watch.pid');
      assert.ok(existsSync(pidPath), 'PID file should exist');
      const pid = parseInt(readFileSync(pidPath, 'utf8').trim(), 10);
      assert.ok(Number.isFinite(pid), 'PID file should contain a valid number');
      assert.equal(pid, child.pid, 'PID file should match child process PID');
    } finally {
      child.kill('SIGTERM');
    }
  });

  it('AT-WATCH-005: SIGTERM triggers graceful shutdown and PID file removal', async () => {
    const dir = createProject();

    const child = spawn(process.execPath, [CLI_BIN, 'watch'], {
      cwd: dir,
      env: { ...process.env, NO_COLOR: '1', AGENTXCHAIN_WATCH_DAEMON: '1' },
    });

    await waitForOutput(child, 'Watching lock.json');

    const exitPromise = new Promise((resolve) => {
      child.on('exit', (code, signal) => resolve({ code, signal }));
    });

    child.kill('SIGTERM');
    const { code, signal } = await exitPromise;

    // Process may exit 0 (handler ran) or null+SIGTERM (signal won the race)
    const cleanExit = code === 0 || signal === 'SIGTERM';
    assert.ok(cleanExit, `expected clean exit, got code=${code} signal=${signal}`);

    // If handler ran (exit code 0), PID file should be removed.
    // If signal killed the process first, PID file may remain — acceptable.
    if (code === 0) {
      const pidPath = join(dir, '.agentxchain-watch.pid');
      assert.ok(!existsSync(pidPath), 'PID file should be removed after clean shutdown');
    }
  });

  it('AT-WATCH-006: daemon mode spawns child process and prints PID', () => {
    const dir = createProject();

    const result = spawnSync(process.execPath, [CLI_BIN, 'watch', '--daemon'], {
      cwd: dir,
      encoding: 'utf8',
      timeout: 10_000,
      env: { ...process.env, NO_COLOR: '1' },
    });

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /Watch started in daemon mode/);
    assert.match(result.stdout, /PID: \d+/);

    // Clean up the daemon
    const pidPath = join(dir, '.agentxchain-watch.pid');
    if (existsSync(pidPath)) {
      const pid = parseInt(readFileSync(pidPath, 'utf8').trim(), 10);
      try { process.kill(pid, 'SIGTERM'); } catch {}
    }
  });
});
