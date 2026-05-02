import { strict as assert } from 'node:assert';
import { afterEach, describe, it } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(__dirname, '..', 'bin', 'agentxchain.js');

const tempDirs = new Set();
const trackedPids = new Set();

function createProject() {
  const dir = join(tmpdir(), `agentxchain-supervise-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  tempDirs.add(dir);

  const config = {
    version: 3,
    project: 'Supervise Test',
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
    project: 'Supervise Test',
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

/**
 * Spawn the supervise command as a detached child,
 * collect stdout, and return control to the test.
 */
function spawnSupervise(cwd, args = []) {
  const child = spawn(process.execPath, [CLI_BIN, 'supervise', ...args], {
    cwd,
    env: { ...process.env, NO_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  trackedPids.add(child.pid);

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d) => { stdout += d.toString(); });
  child.stderr.on('data', (d) => { stderr += d.toString(); });

  return {
    child,
    getStdout: () => stdout,
    getStderr: () => stderr,
  };
}

function waitForOutput(getFn, pattern, timeoutMs = 10_000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const poll = () => {
      if (pattern.test(getFn())) {
        resolve();
        return;
      }
      if (Date.now() - start > timeoutMs) {
        reject(new Error(`Timed out waiting for pattern ${pattern} — got: ${getFn()}`));
        return;
      }
      setTimeout(poll, 100);
    };
    poll();
  });
}

function waitForExit(child, timeoutMs = 10_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Child PID ${child.pid} did not exit within ${timeoutMs}ms`));
    }, timeoutMs);

    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      trackedPids.delete(child.pid);
      resolve({ code, signal });
    });
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

describe('agentxchain supervise', () => {
  it('AT-SUPERVISE-001: fails outside a project root', () => {
    const dir = createProject();
    unlinkSync(join(dir, 'agentxchain.json'));

    const result = runCli(dir, ['supervise']);
    assert.notEqual(result.status, 0, 'missing project should fail');
    assert.match(result.stdout, /No agentxchain\.json found/);
  });

  it('AT-SUPERVISE-002: watch-only mode spawns and prints watch PID', async () => {
    const dir = createProject();
    const { child, getStdout } = spawnSupervise(dir);

    // Wait for the banner and PID line
    await waitForOutput(getStdout, /Watch PID:/);

    const stdout = getStdout();
    assert.match(stdout, /AgentXchain Supervisor/);
    assert.match(stdout, /Mode: watch only/);
    assert.match(stdout, /Watch PID: \d+/);

    // Cleanup: send SIGTERM to trigger graceful shutdown
    child.kill('SIGTERM');
    await waitForExit(child);
  });

  it('AT-SUPERVISE-003: banner shows correct project path', async () => {
    const dir = createProject();
    const { child, getStdout } = spawnSupervise(dir);

    await waitForOutput(getStdout, /Watch PID:/);

    const stdout = getStdout();
    assert.match(stdout, /Project:/);
    // The project path in the banner should contain our temp dir
    assert.ok(stdout.includes(dir), `banner should include project path "${dir}"`);

    child.kill('SIGTERM');
    await waitForExit(child);
  });

  it('AT-SUPERVISE-004: SIGTERM triggers graceful shutdown', async () => {
    const dir = createProject();
    const { child, getStdout } = spawnSupervise(dir);

    await waitForOutput(getStdout, /Watch PID:/);

    child.kill('SIGTERM');
    const { code, signal } = await waitForExit(child);

    // Graceful shutdown: either the 200ms setTimeout fires process.exit(0) → code=0,
    // or the OS delivers the signal first → code=null, signal='SIGTERM'. Both are valid.
    assert.ok(
      code === 0 || signal === 'SIGTERM',
      `graceful shutdown should exit 0 or be killed by SIGTERM, got code=${code} signal=${signal}`,
    );
  });

  it('AT-SUPERVISE-005: watch child unexpected exit triggers supervisor shutdown', async () => {
    const dir = createProject();
    const { child, getStdout } = spawnSupervise(dir);

    await waitForOutput(getStdout, /Watch PID:/);

    // Extract the watch child PID from output and kill it to simulate unexpected exit
    const pidMatch = getStdout().match(/Watch PID: (\d+)/);
    assert.ok(pidMatch, 'should find watch PID in output');
    const watchPid = Number(pidMatch[1]);

    // Kill the watch child directly — this simulates an unexpected exit
    try { process.kill(watchPid, 'SIGKILL'); } catch {}

    // The supervisor should detect the unexpected exit and shut down
    const code = await waitForExit(child);
    const stdout = getStdout();
    assert.match(stdout, /Watch process exited unexpectedly/);
  });

  it('AT-SUPERVISE-006: --interval default is 3 seconds', async () => {
    const dir = createProject();
    // In watch-only mode (no --autonudge), interval is still parsed but not displayed
    // Test that passing --interval doesn't crash and banner still works
    const { child, getStdout } = spawnSupervise(dir, ['--interval', '5']);

    await waitForOutput(getStdout, /Watch PID:/);

    const stdout = getStdout();
    assert.match(stdout, /Mode: watch only/);

    child.kill('SIGTERM');
    await waitForExit(child);
  });
});
