/**
 * Dashboard event stream tests.
 *
 * Tests the /api/events HTTP endpoint, WebSocket event-data push,
 * and subscribe filtering for the dashboard bridge server.
 *
 * See: EVENT_STREAM_SPEC.md
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, appendFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';
import http from 'http';
import net from 'net';

import { createBridgeServer } from '../src/lib/dashboard/bridge-server.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

function tmpDir() {
  const dir = join(tmpdir(), `axc-event-stream-test-${randomBytes(6).toString('hex')}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function httpGet(port, path) {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://127.0.0.1:${port}${path}`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    req.setTimeout(5000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function writeJson(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
}

function makeEvent(eventType, overrides = {}) {
  return {
    event_id: `evt_${randomBytes(8).toString('hex')}`,
    event_type: eventType,
    timestamp: overrides.timestamp || new Date().toISOString(),
    run_id: overrides.run_id || 'run_test_001',
    phase: overrides.phase || 'delivery',
    status: overrides.status || 'running',
    turn: overrides.turn || null,
    payload: overrides.payload || {},
  };
}

function writeEventsJsonl(root, events) {
  const eventsPath = join(root, '.agentxchain', 'events.jsonl');
  writeFileSync(eventsPath, events.map(e => JSON.stringify(e)).join('\n') + '\n');
}

function appendEventJsonl(root, event) {
  const eventsPath = join(root, '.agentxchain', 'events.jsonl');
  appendFileSync(eventsPath, JSON.stringify(event) + '\n');
}

function writeGovernedRepo(root) {
  mkdirSync(root, { recursive: true });
  mkdirSync(join(root, '.agentxchain'), { recursive: true });

  writeJson(join(root, 'agentxchain.json'), {
    schema_version: '1.0',
    project: { id: 'event-stream-test', name: 'test', default_branch: 'main' },
    roles: { dev: { title: 'Dev', mandate: 'Build.', write_authority: 'authoritative', runtime: 'local' } },
    runtimes: { local: { type: 'local_cli', command: ['echo'], prompt_transport: 'argv' } },
    routing: { delivery: { entry_role: 'dev', allowed_next_roles: ['dev'] } },
    gates: {},
  });

  writeJson(join(root, '.agentxchain/state.json'), {
    schema_version: '1.1',
    project_id: 'event-stream-test',
    run_id: null,
    status: 'idle',
    phase: 'delivery',
    active_turns: {},
    turn_sequence: 0,
  });

  writeFileSync(join(root, '.agentxchain/history.jsonl'), '');
  writeFileSync(join(root, '.agentxchain/decision-ledger.jsonl'), '');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('dashboard event stream — /api/events', () => {
  let root, bridge, port;

  before(async () => {
    root = tmpDir();
    writeGovernedRepo(root);

    // Write sample events
    const events = [
      makeEvent('run_started', { timestamp: '2026-04-15T00:00:00Z' }),
      makeEvent('turn_dispatched', { timestamp: '2026-04-15T00:00:01Z', turn: { turn_id: 't1', role_id: 'dev' } }),
      makeEvent('turn_accepted', { timestamp: '2026-04-15T00:00:02Z', turn: { turn_id: 't1', role_id: 'dev' } }),
      makeEvent('phase_entered', { timestamp: '2026-04-15T00:00:03Z', payload: { from: 'delivery', to: 'qa' } }),
      makeEvent('run_completed', { timestamp: '2026-04-15T00:00:04Z' }),
    ];
    writeEventsJsonl(root, events);

    const dashboardDir = join(root, 'dashboard');
    mkdirSync(dashboardDir, { recursive: true });
    writeFileSync(join(dashboardDir, 'index.html'), '<html></html>');

    bridge = createBridgeServer({
      agentxchainDir: join(root, '.agentxchain'),
      dashboardDir,
      port: 0,
    });
    const result = await bridge.start();
    port = result.port;
  });

  after(async () => {
    if (bridge) await bridge.stop();
    rmSync(root, { recursive: true, force: true });
  });

  it('GET /api/events returns all events', async () => {
    const res = await httpGet(port, '/api/events?limit=0');
    assert.equal(res.status, 200);
    const events = JSON.parse(res.body);
    assert.ok(Array.isArray(events));
    assert.equal(events.length, 5);
    assert.equal(events[0].event_type, 'run_started');
    assert.equal(events[4].event_type, 'run_completed');
  });

  it('GET /api/events respects limit', async () => {
    const res = await httpGet(port, '/api/events?limit=2');
    assert.equal(res.status, 200);
    const events = JSON.parse(res.body);
    assert.equal(events.length, 2);
    // Last 2 events
    assert.equal(events[0].event_type, 'phase_entered');
    assert.equal(events[1].event_type, 'run_completed');
  });

  it('GET /api/events filters by type', async () => {
    const res = await httpGet(port, '/api/events?type=run_started,run_completed&limit=0');
    assert.equal(res.status, 200);
    const events = JSON.parse(res.body);
    assert.equal(events.length, 2);
    assert.equal(events[0].event_type, 'run_started');
    assert.equal(events[1].event_type, 'run_completed');
  });

  it('GET /api/events filters by since', async () => {
    const res = await httpGet(port, '/api/events?since=2026-04-15T00:00:02Z&limit=0');
    assert.equal(res.status, 200);
    const events = JSON.parse(res.body);
    // Only events after 00:00:02 — phase_entered and run_completed
    assert.equal(events.length, 2);
    assert.equal(events[0].event_type, 'phase_entered');
  });

  it('GET /api/events filters by run_id', async () => {
    const res = await httpGet(port, '/api/events?run_id=run_test_001&limit=0');
    assert.equal(res.status, 200);
    const events = JSON.parse(res.body);
    assert.equal(events.length, 5);

    const res2 = await httpGet(port, '/api/events?run_id=nonexistent&limit=0');
    const events2 = JSON.parse(res2.body);
    assert.equal(events2.length, 0);
  });

  it('GET /api/events returns empty array when no events file', async () => {
    const root2 = tmpDir();
    writeGovernedRepo(root2);
    // No events.jsonl written

    const dashboardDir2 = join(root2, 'dashboard');
    mkdirSync(dashboardDir2, { recursive: true });
    writeFileSync(join(dashboardDir2, 'index.html'), '<html></html>');

    const bridge2 = createBridgeServer({
      agentxchainDir: join(root2, '.agentxchain'),
      dashboardDir: dashboardDir2,
      port: 0,
    });
    const result2 = await bridge2.start();
    try {
      const res = await httpGet(result2.port, '/api/events');
      assert.equal(res.status, 200);
      const events = JSON.parse(res.body);
      assert.ok(Array.isArray(events));
      assert.equal(events.length, 0);
    } finally {
      await bridge2.stop();
      rmSync(root2, { recursive: true, force: true });
    }
  });
});

describe('dashboard event stream — state-reader resource mapping', () => {
  it('events.jsonl is in RESOURCE_MAP', async () => {
    const { RESOURCE_MAP, FILE_TO_RESOURCE, resourceForRelativePath } = await import('../src/lib/dashboard/state-reader.js');
    assert.equal(RESOURCE_MAP['/api/events'], 'events.jsonl');
    assert.equal(resourceForRelativePath('events.jsonl'), '/api/events');
  });
});

describe('dashboard event stream — event-stream proof', () => {
  it('proof script runs and passes', { timeout: 120000 }, async () => {
    const { spawnSync } = await import('child_process');
    const { fileURLToPath } = await import('url');
    const { dirname } = await import('path');

    const __dirname = dirname(fileURLToPath(import.meta.url));
    const proofPath = join(__dirname, '..', '..', 'examples', 'governed-todo-app', 'run-event-stream-proof.mjs');

    const result = spawnSync(process.execPath, [proofPath, '--json'], {
      encoding: 'utf8',
      timeout: 90000,
      env: {
        ...process.env,
        NODE_NO_WARNINGS: '1',
        NO_COLOR: '1',
      },
    });

    let proof;
    try {
      proof = JSON.parse(result.stdout);
    } catch {
      assert.fail(`Proof script did not produce valid JSON. stdout: ${result.stdout?.slice(0, 500)}, stderr: ${result.stderr?.slice(0, 500)}`);
    }

    assert.equal(proof.result, 'pass', `Proof failed: ${JSON.stringify(proof.errors)}`);
    assert.ok(proof.artifacts?.total_events > 0, 'Should have events');
    assert.ok(proof.artifacts?.event_types?.includes('run_started'), 'Should have run_started');
    assert.ok(proof.artifacts?.event_types?.includes('run_completed'), 'Should have run_completed');
  });
});
