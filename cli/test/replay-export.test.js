import { describe, it } from 'vitest';
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

function encodeExportFile(raw, format, data) {
  return {
    format,
    bytes: Buffer.byteLength(raw),
    sha256: `test-${format}-${Buffer.byteLength(raw)}`,
    content_base64: Buffer.from(raw, 'utf8').toString('base64'),
    data,
  };
}

function jsonFile(value) {
  const raw = JSON.stringify(value, null, 2);
  return encodeExportFile(raw, 'json', value);
}

function jsonlFile(lines) {
  const raw = `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`;
  return encodeExportFile(raw, 'jsonl', lines);
}

function writeExportFile(dir, exportData, name = 'export.json') {
  const path = join(dir, name);
  writeFileSync(path, JSON.stringify(exportData, null, 2));
  return path;
}

function makeRunExportFile(dir, overrides = {}) {
  const exportData = {
    schema_version: '0.3',
    export_kind: 'agentxchain_run_export',
    summary: {
      run_id: 'run_test123',
      protocol_version: 'v7',
      project_name: 'test-replay',
      status: 'completed',
      roles: { dev: { mandate: 'write code' } },
      workflow: { phases: ['implement'] },
      ...(overrides.summary || {}),
    },
    files: {
      'agentxchain.json': jsonFile({
        protocol_mode: 'governed',
        schema_version: '1.0',
        project: { id: 'test-replay', name: 'test-replay' },
        roles: { dev: { title: 'Developer', mandate: 'write code', write_authority: 'authoritative', runtime: 'dev-local' } },
        runtimes: { 'dev-local': { type: 'manual' } },
        routing: { implement: { entry_role: 'dev', allowed_next_roles: ['dev', 'human'] } },
        gates: {},
        prompts: {},
        rules: { challenge_required: true, max_turn_retries: 2, max_deadlock_cycles: 2 },
      }),
      '.agentxchain/state.json': jsonFile({
        schema_version: '1.1',
        run_id: 'run_test123',
        status: 'completed',
        phase: 'implement',
        active_turns: {},
        turn_sequence: 1,
      }),
      '.agentxchain/history.jsonl': jsonlFile([
        { turn_id: 'turn_001', role: 'dev', phase: 'implement', accepted_at: '2026-04-15T00:00:00Z', status: 'completed' },
      ]),
      '.agentxchain/events.jsonl': jsonlFile([
        { event_id: 'evt_001', event_type: 'run_started', timestamp: '2026-04-15T00:00:00Z', run_id: 'run_test123' },
        { event_id: 'evt_002', event_type: 'run_completed', timestamp: '2026-04-15T00:01:00Z', run_id: 'run_test123' },
      ]),
      '.agentxchain/decision-ledger.jsonl': jsonlFile([
        { decision_id: 'DEC-001', summary: 'test decision' },
      ]),
      ...(overrides.files || {}),
    },
    ...(overrides.root || {}),
  };
  return writeExportFile(dir, exportData);
}

function makeCoordinatorExportFile(dir, overrides = {}) {
  const coordinatorFiles = {
    'agentxchain-multi.json': jsonFile({
      schema_version: '0.1',
      project: { id: 'coord-test', name: 'Coordinator Test' },
      repos: {
        web: { path: './repos/web' },
        api: { path: './repos/api' },
      },
      workstreams: {
        core_sync: {
          phase: 'implementation',
          repos: ['web', 'api'],
          entry_repo: 'web',
          depends_on: [],
          completion_barrier: 'all_repos_accepted',
        },
      },
    }),
    '.agentxchain/multirepo/state.json': jsonFile({
      schema_version: '1.1',
      super_run_id: 'srun_test_001',
      status: 'active',
      phase: 'implementation',
      repo_runs: {
        web: { run_id: 'run_web_001', status: 'completed', phase: 'implementation', initialized_by_coordinator: true },
        api: { run_id: 'run_api_001', status: 'completed', phase: 'implementation', initialized_by_coordinator: true },
      },
    }),
    '.agentxchain/multirepo/history.jsonl': jsonlFile([
      { type: 'run_initialized', super_run_id: 'srun_test_001', ts: '2026-04-15T00:00:00Z' },
      { type: 'turn_dispatched', repo_id: 'web', turn_id: 'turn_web_001', ts: '2026-04-15T00:01:00Z' },
    ]),
    '.agentxchain/multirepo/barriers.json': jsonFile({
      'barrier-001': {
        workstream_id: 'core_sync',
        type: 'all_repos_accepted',
        status: 'pending',
        required_repos: ['web', 'api'],
        satisfied_repos: ['web'],
        created_at: '2026-04-15T00:00:00Z',
      },
    }),
    '.agentxchain/multirepo/decision-ledger.jsonl': jsonlFile([
      { id: 'DEC-COORD-001', statement: 'Coordinator ready.' },
    ]),
    '.agentxchain/multirepo/barrier-ledger.jsonl': jsonlFile([
      { barrier_id: 'barrier-001', from: null, to: 'pending', ts: '2026-04-15T00:00:00Z' },
    ]),
  };

  const webExport = {
    export_kind: 'agentxchain_run_export',
    files: {
      'agentxchain.json': jsonFile({
        protocol_mode: 'governed',
        schema_version: '1.0',
        project: { id: 'web-app', name: 'Web App' },
        roles: { dev: { title: 'Developer', mandate: 'ship UI', write_authority: 'authoritative', runtime: 'web-local' } },
        runtimes: { 'web-local': { type: 'manual' } },
        routing: { implementation: { entry_role: 'dev', allowed_next_roles: ['dev', 'human'] } },
        gates: {},
        prompts: {},
        rules: { challenge_required: true, max_turn_retries: 2, max_deadlock_cycles: 2 },
      }),
      '.agentxchain/state.json': jsonFile({
        schema_version: '1.1',
        run_id: 'run_web_001',
        status: 'completed',
        phase: 'implementation',
        active_turns: {},
        turn_sequence: 1,
      }),
      '.agentxchain/events.jsonl': jsonlFile([
        { event_id: 'evt_web_001', event_type: 'run_started', timestamp: '2026-04-15T00:00:00Z', run_id: 'run_web_001' },
        { event_id: 'evt_web_002', event_type: 'turn_accepted', timestamp: '2026-04-15T00:01:00Z', run_id: 'run_web_001', turn: { turn_id: 'turn_web_001' } },
      ]),
      '.agentxchain/history.jsonl': jsonlFile([
        { turn_id: 'turn_web_001', role: 'dev', phase: 'implementation', accepted_at: '2026-04-15T00:01:00Z', status: 'completed' },
      ]),
    },
  };

  const apiExport = {
    export_kind: 'agentxchain_run_export',
    files: {
      'agentxchain.json': jsonFile({
        protocol_mode: 'governed',
        schema_version: '1.0',
        project: { id: 'api-app', name: 'API App' },
        roles: { dev: { title: 'Developer', mandate: 'ship API', write_authority: 'authoritative', runtime: 'api-local' } },
        runtimes: { 'api-local': { type: 'manual' } },
        routing: { implementation: { entry_role: 'dev', allowed_next_roles: ['dev', 'human'] } },
        gates: {},
        prompts: {},
        rules: { challenge_required: true, max_turn_retries: 2, max_deadlock_cycles: 2 },
      }),
      '.agentxchain/state.json': jsonFile({
        schema_version: '1.1',
        run_id: 'run_api_001',
        status: 'completed',
        phase: 'implementation',
        active_turns: {},
        turn_sequence: 1,
      }),
      '.agentxchain/events.jsonl': jsonlFile([
        { event_id: 'evt_api_001', event_type: 'run_started', timestamp: '2026-04-15T00:00:30Z', run_id: 'run_api_001' },
        { event_id: 'evt_api_002', event_type: 'run_completed', timestamp: '2026-04-15T00:02:00Z', run_id: 'run_api_001' },
      ]),
      '.agentxchain/history.jsonl': jsonlFile([
        { turn_id: 'turn_api_001', role: 'dev', phase: 'implementation', accepted_at: '2026-04-15T00:02:00Z', status: 'completed' },
      ]),
    },
  };

  const exportData = {
    schema_version: '0.3',
    export_kind: 'agentxchain_coordinator_export',
    summary: {
      super_run_id: 'srun_test_001',
      status: 'active',
      phase: 'implementation',
      aggregated_events: {
        total_events: 4,
        repos_with_events: ['api', 'web'],
      },
      ...(overrides.summary || {}),
    },
    files: {
      ...coordinatorFiles,
      ...(overrides.files || {}),
    },
    repos: {
      web: { ok: true, path: './repos/web', export: webExport },
      api: { ok: true, path: './repos/api', export: apiExport },
      ...(overrides.repos || {}),
    },
    ...(overrides.root || {}),
  };

  return writeExportFile(dir, exportData, 'coordinator-export.json');
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
      const exportPath = makeRunExportFile(dir);
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
      const exportPath = makeRunExportFile(dir);
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
      const exportPath = makeRunExportFile(dir);
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
      const exportPath = makeRunExportFile(dir);
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

  it('AT-REPLAY-REAL-001: restores real export file-entry objects using content_base64', async () => {
    const dir = makeTempDir();
    const port = 14300 + Math.floor(Math.random() * 100);
    let child;
    try {
      const exportPath = makeRunExportFile(dir);
      child = startReplayServer(exportPath, port);
      const ready = await waitForServer(port);
      assert.ok(ready, 'Server should start');

      const stateRes = await httpGet(port, '/api/state');
      const state = JSON.parse(stateRes.body);
      assert.equal(state.schema_version, '1.1');
      assert.equal(state.turn_sequence, 1);

      const eventsRes = await httpGet(port, '/api/events');
      const events = JSON.parse(eventsRes.body);
      assert.equal(events.length, 2);
      assert.equal(events[1].event_type, 'run_completed');
    } finally {
      if (child) { child.kill('SIGTERM'); await new Promise((r) => setTimeout(r, 300)); }
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('AT-REPLAY-REAL-002: rejects object-shaped file entries without content_base64', () => {
    const dir = makeTempDir();
    try {
      const exportPath = makeRunExportFile(dir, {
        files: {
          '.agentxchain/state.json': {
            format: 'json',
            bytes: 12,
            sha256: 'broken-test-entry',
            data: { run_id: 'run_broken' },
          },
        },
      });
      const result = runCli(['replay', 'export', exportPath, '--no-open']);
      assert.match(result, /content_base64/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('AT-REPLAY-REAL-003/004: restores coordinator exports and serves coordinator state plus aggregated child events', async () => {
    const dir = makeTempDir();
    const port = 14400 + Math.floor(Math.random() * 100);
    let child;
    try {
      const exportPath = makeCoordinatorExportFile(dir);
      child = startReplayServer(exportPath, port);
      const ready = await waitForServer(port);
      assert.ok(ready, 'Server should start');

      const stateRes = await httpGet(port, '/api/coordinator/state');
      const state = JSON.parse(stateRes.body);
      assert.equal(state.super_run_id, 'srun_test_001');
      assert.equal(state.repo_runs.web.run_id, 'run_web_001');

      const eventsRes = await httpGet(port, '/api/coordinator/events?limit=0');
      const events = JSON.parse(eventsRes.body);
      assert.equal(events.length, 4);
      assert.deepEqual([...new Set(events.map((event) => event.repo_id))], ['web', 'api']);
      assert.equal(events[0].repo_id, 'web');
      assert.equal(events[3].repo_id, 'api');
    } finally {
      if (child) { child.kill('SIGTERM'); await new Promise((r) => setTimeout(r, 300)); }
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('AT-REPLAY-REAL-005: failed child repo exports do not block coordinator replay', async () => {
    const dir = makeTempDir();
    const port = 14500 + Math.floor(Math.random() * 100);
    let child;
    try {
      const exportPath = makeCoordinatorExportFile(dir, {
        repos: {
          api: { ok: false, path: './repos/api', error: 'repo export failed' },
        },
        summary: {
          aggregated_events: {
            total_events: 2,
            repos_with_events: ['web'],
          },
        },
      });
      child = startReplayServer(exportPath, port);
      const ready = await waitForServer(port);
      assert.ok(ready, 'Server should start');

      const eventsRes = await httpGet(port, '/api/coordinator/events?limit=0');
      const events = JSON.parse(eventsRes.body);
      assert.equal(events.length, 2);
      assert.ok(events.every((event) => event.repo_id === 'web'));
    } finally {
      if (child) { child.kill('SIGTERM'); await new Promise((r) => setTimeout(r, 300)); }
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('AT-REPLAY-REAL-006: restores empty content_base64 files without error', async () => {
    const dir = makeTempDir();
    const port = 14600 + Math.floor(Math.random() * 100);
    let child;
    try {
      const exportPath = makeRunExportFile(dir, {
        files: {
          '.agentxchain/empty.jsonl': {
            format: 'jsonl',
            bytes: 0,
            sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
            content_base64: '',
            data: [],
          },
        },
      });
      child = startReplayServer(exportPath, port);
      const ready = await waitForServer(port);
      assert.ok(ready, 'Server should start even with empty content_base64 files');

      const stateRes = await httpGet(port, '/api/state');
      const state = JSON.parse(stateRes.body);
      assert.equal(state.run_id, 'run_test123');
    } finally {
      if (child) { child.kill('SIGTERM'); await new Promise((r) => setTimeout(r, 300)); }
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('AT-REPLAY-ROUNDTRIP-001: governed run export → replay → dashboard round-trip', { timeout: 60000 }, async () => {
    const result = execFileSync(process.execPath, [
      join(__dirname, '..', '..', 'examples', 'governed-todo-app', 'run-replay-roundtrip-proof.mjs'),
      '--json',
    ], {
      encoding: 'utf8',
      timeout: 55000,
      env: { ...process.env, NODE_NO_WARNINGS: '1', NO_COLOR: '1' },
    });
    const proof = JSON.parse(result.trim());
    assert.equal(proof.result, 'pass', `Governed replay roundtrip failed: ${JSON.stringify(proof.errors)}`);
    assert.ok(proof.artifacts.checks_passed >= 10, `Expected >= 10 checks, got ${proof.artifacts.checks_passed}`);
  });

  it('AT-REPLAY-ROUNDTRIP-002: coordinator export → replay → dashboard round-trip', { timeout: 90000 }, async () => {
    const result = execFileSync(process.execPath, [
      join(__dirname, '..', '..', 'examples', 'live-governed-proof', 'run-coordinator-replay-roundtrip-proof.mjs'),
      '--json',
    ], {
      encoding: 'utf8',
      timeout: 85000,
      env: { ...process.env, NODE_NO_WARNINGS: '1', NO_COLOR: '1' },
    });
    const proof = JSON.parse(result.trim());
    assert.equal(proof.result, 'pass', `Coordinator replay roundtrip failed: ${JSON.stringify(proof.errors)}`);
    assert.ok(proof.artifacts.checks_passed >= 15, `Expected >= 15 checks, got ${proof.artifacts.checks_passed}`);
  });
});
