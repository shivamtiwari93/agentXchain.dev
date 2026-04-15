import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import http from 'node:http';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_PATH = join(__dirname, '..', 'bin', 'agentxchain.js');

function makeExportFile(dir, overrides = {}) {
  const exportData = {
    schema_version: '0.3',
    summary: {
      run_id: 'run_test123',
      protocol_version: 6,
      project_name: 'test-replay',
      status: 'completed',
      roles: { dev: { mandate: 'write code' } },
      workflow: { phases: ['implement'] },
      ...(overrides.summary || {}),
    },
    files: {
      'agentxchain.json': JSON.stringify({
        protocol_version: 6,
        protocol_mode: 'governed',
        version: 4,
        project: { name: 'test-replay' },
        roles: { dev: { mandate: 'write code' } },
        runtimes: {},
        workflow: { phases: ['implement'] },
      }),
      '.agentxchain/state.json': JSON.stringify({
        run_id: 'run_test123',
        status: 'completed',
        phase: 'implement',
        current_turn: 1,
      }),
      '.agentxchain/history.jsonl': '{"turn_id":"turn_001","role":"dev","phase":"implement","accepted_at":"2026-04-15T00:00:00Z"}\n',
      '.agentxchain/events.jsonl': '{"event_id":"evt_001","event_type":"run_started","timestamp":"2026-04-15T00:00:00Z","run_id":"run_test123"}\n{"event_id":"evt_002","event_type":"run_completed","timestamp":"2026-04-15T00:01:00Z","run_id":"run_test123"}\n',
      '.agentxchain/decision-ledger.jsonl': '{"decision_id":"DEC-001","summary":"test decision"}\n',
      ...(overrides.files || {}),
    },
    ...(overrides.root || {}),
  };
  const path = join(dir, 'export.json');
  writeFileSync(path, JSON.stringify(exportData, null, 2));
  return path;
}

function makeTempDir() {
  const dir = join(tmpdir(), `replay-export-test-${randomBytes(4).toString('hex')}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function httpGet(port, path) {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://127.0.0.1:${port}${path}`, (res) => {
      let body = '';
      res.on('data', (d) => { body += d; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.setTimeout(3000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function httpPost(port, path, data) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const req = http.request(`http://127.0.0.1:${port}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let resBody = '';
      res.on('data', (d) => { resBody += d; });
      res.on('end', () => resolve({ status: res.statusCode, body: resBody }));
    });
    req.on('error', reject);
    req.setTimeout(3000, () => { req.destroy(); reject(new Error('timeout')); });
    req.write(body);
    req.end();
  });
}

function runCli(args) {
  try {
    return execFileSync(process.execPath, [CLI_PATH, ...args], {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 10000,
    });
  } catch (err) {
    return (err.stdout || '') + (err.stderr || '');
  }
}

function startReplayServer(exportPath, port) {
  return spawn(process.execPath, [CLI_PATH, 'replay', 'export', exportPath, '--port', String(port), '--json', '--no-open'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 20000,
  });
}

async function waitForServer(port, maxWait = 5000) {
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    try {
      await httpGet(port, '/api/session');
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  return false;
}

describe('replay export', () => {
  it('AT-REPLAY-EXPORT-005: missing export file exits with code 2', () => {
    const result = runCli(['replay', 'export', '/nonexistent/export.json']);
    assert.ok(result.includes('Export file not found'), `Expected "Export file not found" in: ${result}`);
  });

  it('AT-REPLAY-EXPORT-006: invalid JSON exits with code 2', () => {
    const dir = makeTempDir();
    try {
      const path = join(dir, 'bad.json');
      writeFileSync(path, 'not valid json {{{');
      const result = runCli(['replay', 'export', path]);
      assert.ok(result.includes('Failed to parse export file'), `Expected parse error in: ${result}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('missing files object exits with code 2', () => {
    const dir = makeTempDir();
    try {
      const path = join(dir, 'no-files.json');
      writeFileSync(path, JSON.stringify({ schema_version: '0.3', summary: {} }));
      const result = runCli(['replay', 'export', path]);
      assert.ok(result.includes('missing "files" object'), `Expected schema error in: ${result}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('AT-REPLAY-EXPORT-001: starts server and serves /api/state', async () => {
    const dir = makeTempDir();
    const port = 13900 + Math.floor(Math.random() * 100);
    let child;
    try {
      const exportPath = makeExportFile(dir);
      child = startReplayServer(exportPath, port);
      const ready = await waitForServer(port);
      assert.ok(ready, 'Server should start');

      const stateRes = await httpGet(port, '/api/state');
      const state = JSON.parse(stateRes.body);
      assert.equal(state.run_id, 'run_test123');
      assert.equal(state.status, 'completed');

      const sessionRes = await httpGet(port, '/api/session');
      const session = JSON.parse(sessionRes.body);
      assert.equal(session.replay_mode, true);
      assert.equal(session.capabilities.approve_gate, false);
    } finally {
      if (child) { child.kill('SIGTERM'); await new Promise((r) => setTimeout(r, 300)); }
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('AT-REPLAY-EXPORT-002: serves history and events from exported snapshot', async () => {
    const dir = makeTempDir();
    const port = 14000 + Math.floor(Math.random() * 100);
    let child;
    try {
      const exportPath = makeExportFile(dir);
      child = startReplayServer(exportPath, port);
      const ready = await waitForServer(port);
      assert.ok(ready, 'Server should start');

      const historyRes = await httpGet(port, '/api/history');
      assert.ok(historyRes.body.includes('turn_001'), 'History should contain turn_001');

      const eventsRes = await httpGet(port, '/api/events');
      const events = JSON.parse(eventsRes.body);
      assert.ok(Array.isArray(events), 'Events should be an array');
      assert.ok(events.length >= 2, 'Should have at least 2 events');
    } finally {
      if (child) { child.kill('SIGTERM'); await new Promise((r) => setTimeout(r, 300)); }
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('AT-REPLAY-EXPORT-003: gate approval returns 403 in replay mode', async () => {
    const dir = makeTempDir();
    const port = 14100 + Math.floor(Math.random() * 100);
    let child;
    try {
      const exportPath = makeExportFile(dir);
      child = startReplayServer(exportPath, port);
      const ready = await waitForServer(port);
      assert.ok(ready, 'Server should start');

      const gateRes = await httpPost(port, '/api/actions/approve-gate', { gate_id: 'test' });
      const gate = JSON.parse(gateRes.body);
      assert.equal(gate.code, 'replay_mode');
      assert.ok(gate.error.includes('Replay mode'), `Expected replay mode error in: ${gate.error}`);
    } finally {
      if (child) { child.kill('SIGTERM'); await new Promise((r) => setTimeout(r, 300)); }
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('AT-REPLAY-EXPORT-004: --json outputs structured session info', async () => {
    const dir = makeTempDir();
    const port = 14200 + Math.floor(Math.random() * 100);
    let child;
    try {
      const exportPath = makeExportFile(dir);
      child = startReplayServer(exportPath, port);

      let stdout = '';
      child.stdout.on('data', (d) => { stdout += d.toString(); });

      const ready = await waitForServer(port);
      assert.ok(ready, 'Server should start');

      // Give time for JSON to be fully written to stdout
      await new Promise((r) => setTimeout(r, 500));

      const sessionInfo = JSON.parse(stdout.trim());
      assert.equal(sessionInfo.run_id, 'run_test123');
      assert.equal(sessionInfo.export_schema_version, '0.3');
      assert.ok(sessionInfo.files_restored > 0, 'Should have restored files');
      assert.ok(sessionInfo.url.includes('localhost'), 'Should have URL');
    } finally {
      if (child) { child.kill('SIGTERM'); await new Promise((r) => setTimeout(r, 300)); }
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
