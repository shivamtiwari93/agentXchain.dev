import { strict as assert } from 'node:assert';
import { afterEach, describe, it } from 'node:test';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(__dirname, '..', 'bin', 'agentxchain.js');
const tempDirs = new Set();

function createProject() {
  const dir = join(tmpdir(), `agentxchain-watch-dir-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  tempDirs.add(dir);
  writeFileSync(join(dir, 'agentxchain.json'), JSON.stringify({
    schema_version: 4,
    protocol_mode: 'governed',
    project: { id: 'watch-dir-test', name: 'Watch Dir Test' },
    roles: [
      { id: 'pm', title: 'PM', mandate: 'Plan work' },
      { id: 'dev', title: 'Dev', mandate: 'Build work' },
      { id: 'qa', title: 'QA', mandate: 'Verify work' },
    ],
  }, null, 2));
  return dir;
}

function githubPrOpened(number = 42) {
  return {
    action: 'opened',
    repository: { full_name: 'acme/widgets' },
    pull_request: {
      number,
      title: `Governed review ${number}`,
      html_url: `https://github.com/acme/widgets/pull/${number}`,
      head: { ref: `feature/review-${number}`, sha: `abc${number}` },
      base: { ref: 'main' },
      draft: false,
    },
  };
}

function writeJson(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2));
}

function listJson(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((name) => name.endsWith('.json')).sort();
}

function readWatchResults(projectDir) {
  const resultsDir = join(projectDir, '.agentxchain', 'watch-results');
  return listJson(resultsDir).map((name) => JSON.parse(readFileSync(join(resultsDir, name), 'utf8')));
}

function startEventDirWatcher(projectDir, eventDir) {
  return spawn(process.execPath, [CLI_BIN, 'watch', '--event-dir', eventDir, '--poll-seconds', '0.1'], {
    cwd: projectDir,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

async function waitForCondition(predicate, label, timeoutMs = 6000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode) return;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  child.kill('SIGTERM');
  await Promise.race([
    exited,
    new Promise((resolve) => setTimeout(resolve, 1000)),
  ]);
}

afterEach(() => {
  for (const dir of [...tempDirs]) {
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
    tempDirs.delete(dir);
  }
});

describe('watch event directory daemon — Slice 6', () => {
  it('AT-WATCH-DIR-001: processes startup backlog files and moves them to processed', async () => {
    const dir = createProject();
    const eventDir = join(dir, 'watch-events');
    mkdirSync(eventDir, { recursive: true });
    writeJson(join(eventDir, '001-pr.json'), githubPrOpened(42));

    const child = startEventDirWatcher(dir, eventDir);
    try {
      await waitForCondition(() => listJson(join(eventDir, 'processed')).length === 1, 'processed backlog file');
      const results = readWatchResults(dir);
      assert.equal(results.length, 1);
      assert.equal(results[0].payload.category, 'github_pull_request_opened');
      assert.equal(results[0].payload.ref, 'feature/review-42');
      assert.equal(listJson(eventDir).length, 0, 'hot directory should no longer contain processed JSON');
    } finally {
      await stopChild(child);
    }
  });

  it('AT-WATCH-DIR-002: processes files created after startup on the next poll', async () => {
    const dir = createProject();
    const eventDir = join(dir, 'watch-events');
    mkdirSync(eventDir, { recursive: true });

    const child = startEventDirWatcher(dir, eventDir);
    try {
      await waitForCondition(() => existsSync(join(dir, '.agentxchain-watch.pid')), 'watch pid file');
      writeJson(join(eventDir, 'late-pr.json'), githubPrOpened(43));

      await waitForCondition(() => listJson(join(eventDir, 'processed')).length === 1, 'processed late file');
      const results = readWatchResults(dir);
      assert.equal(results.length, 1);
      assert.equal(results[0].payload.ref, 'feature/review-43');
    } finally {
      await stopChild(child);
    }
  });

  it('AT-WATCH-DIR-003: moves invalid event files to failed without stopping the daemon', async () => {
    const dir = createProject();
    const eventDir = join(dir, 'watch-events');
    mkdirSync(eventDir, { recursive: true });
    writeFileSync(join(eventDir, 'bad.json'), '{ not valid json');
    writeJson(join(eventDir, 'good.json'), githubPrOpened(44));

    const child = startEventDirWatcher(dir, eventDir);
    try {
      await waitForCondition(() => listJson(join(eventDir, 'failed')).length === 1, 'failed invalid file');
      await waitForCondition(() => listJson(join(eventDir, 'processed')).length === 1, 'processed valid file');
      assert.equal(readWatchResults(dir).length, 1, 'valid file should still write a result');
    } finally {
      await stopChild(child);
    }
  });

  it('AT-WATCH-DIR-004: daemon mode starts a background event-dir watcher and writes the watch PID file', () => {
    const dir = createProject();
    const eventDir = join(dir, 'watch-events');

    const result = spawnSync(process.execPath, [CLI_BIN, 'watch', '--daemon', '--event-dir', eventDir, '--poll-seconds', '0.5'], {
      cwd: dir,
      encoding: 'utf8',
      timeout: 10_000,
      env: { ...process.env, NO_COLOR: '1' },
    });

    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /Watch started in daemon mode/);
    const pidPath = join(dir, '.agentxchain-watch.pid');
    assert.ok(existsSync(pidPath), 'daemon parent should write the watch PID file');
    const pid = Number(readFileSync(pidPath, 'utf8').trim());
    assert.ok(Number.isFinite(pid), 'PID file should contain a numeric child PID');
    try { process.kill(pid, 'SIGTERM'); } catch {}
  });

  it('AT-WATCH-DIR-005: ignores files already archived under processed and failed', async () => {
    const dir = createProject();
    const eventDir = join(dir, 'watch-events');
    mkdirSync(join(eventDir, 'processed'), { recursive: true });
    mkdirSync(join(eventDir, 'failed'), { recursive: true });
    writeJson(join(eventDir, 'processed', 'old-good.json'), githubPrOpened(45));
    writeJson(join(eventDir, 'failed', 'old-bad.json'), githubPrOpened(46));

    const child = startEventDirWatcher(dir, eventDir);
    try {
      await waitForCondition(() => existsSync(join(dir, '.agentxchain-watch.pid')), 'watch pid file');
      await new Promise((resolve) => setTimeout(resolve, 350));
      assert.equal(readWatchResults(dir).length, 0, 'archived files must not be reprocessed');
      assert.equal(listJson(join(eventDir, 'processed')).length, 1);
      assert.equal(listJson(join(eventDir, 'failed')).length, 1);
    } finally {
      await stopChild(child);
    }
  });
});
