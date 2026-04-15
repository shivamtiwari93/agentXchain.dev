/**
 * Coordinator event aggregation tests.
 *
 * Tests the /api/coordinator/events HTTP endpoint and the
 * readAggregatedCoordinatorEvents() function that merges lifecycle
 * events from child repos into a single time-ordered stream.
 *
 * See: COORDINATOR_EVENT_AGGREGATION_SPEC.md
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, appendFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createHash, randomBytes } from 'crypto';
import http from 'http';

import { readAggregatedCoordinatorEvents } from '../src/lib/dashboard/coordinator-event-aggregation.js';
import { createBridgeServer } from '../src/lib/dashboard/bridge-server.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

function tmpDir() {
  const dir = join(tmpdir(), `axc-coord-evt-agg-${randomBytes(6).toString('hex')}`);
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

function expectedWebSocketAccept(key) {
  return createHash('sha1')
    .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64');
}

function createMaskedTextFrame(text) {
  const payload = Buffer.from(text, 'utf8');
  const mask = randomBytes(4);
  const len = payload.length;
  let header;

  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x81;
    header[1] = 0x80 | len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 0x80 | 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }

  const maskedPayload = Buffer.from(payload);
  for (let i = 0; i < maskedPayload.length; i += 1) {
    maskedPayload[i] ^= mask[i % 4];
  }

  return Buffer.concat([header, mask, maskedPayload]);
}

function parseServerFrames(buffer) {
  const frames = [];
  let offset = 0;

  while (offset + 2 <= buffer.length) {
    const opcode = buffer[offset] & 0x0f;
    let payloadLen = buffer[offset + 1] & 0x7f;
    let frameOffset = offset + 2;

    if (payloadLen === 126) {
      if (offset + 4 > buffer.length) break;
      payloadLen = buffer.readUInt16BE(offset + 2);
      frameOffset = offset + 4;
    } else if (payloadLen === 127) {
      if (offset + 10 > buffer.length) break;
      payloadLen = Number(buffer.readBigUInt64BE(offset + 2));
      frameOffset = offset + 10;
    }

    if (frameOffset + payloadLen > buffer.length) break;
    frames.push({
      opcode,
      payload: buffer.slice(frameOffset, frameOffset + payloadLen),
    });
    offset = frameOffset + payloadLen;
  }

  return {
    frames,
    rest: buffer.slice(offset),
  };
}

async function connectWebSocketClient(port) {
  return new Promise((resolve, reject) => {
    const key = randomBytes(16).toString('base64');
    const messages = [];
    const waiters = [];
    let buffer = Buffer.alloc(0);

    const maybeResolveWaiters = () => {
      for (let i = waiters.length - 1; i >= 0; i -= 1) {
        const waiter = waiters[i];
        const found = messages.find(waiter.predicate);
        if (!found) continue;
        clearTimeout(waiter.timeout);
        waiters.splice(i, 1);
        waiter.resolve(found);
      }
    };

    const req = http.request({
      host: '127.0.0.1',
      port,
      path: '/ws',
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Version': '13',
        'Sec-WebSocket-Key': key,
      },
    });

    req.on('upgrade', (res, socket) => {
      assert.equal(res.headers['sec-websocket-accept'], expectedWebSocketAccept(key));

      socket.on('data', (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        const parsed = parseServerFrames(buffer);
        buffer = parsed.rest;

        for (const frame of parsed.frames) {
          if (frame.opcode !== 0x01) continue;
          try {
            messages.push(JSON.parse(frame.payload.toString('utf8')));
            maybeResolveWaiters();
          } catch {}
        }
      });

      socket.on('error', () => {});

      resolve({
        messages,
        sendJson(message) {
          socket.write(createMaskedTextFrame(JSON.stringify(message)));
        },
        waitForMessage(predicate, timeoutMs = 5000) {
          const found = messages.find(predicate);
          if (found) {
            return Promise.resolve(found);
          }

          return new Promise((resolveWaiter, rejectWaiter) => {
            const timeout = setTimeout(() => {
              const index = waiters.findIndex((entry) => entry.resolve === resolveWaiter);
              if (index >= 0) waiters.splice(index, 1);
              rejectWaiter(new Error(`No matching WebSocket message within ${timeoutMs}ms`));
            }, timeoutMs);

            waiters.push({
              predicate,
              resolve: resolveWaiter,
              timeout,
            });
          });
        },
        close() {
          try { socket.destroy(); } catch {}
        },
      });
    });

    req.on('error', reject);
    req.end();
  });
}

function writeJson(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
}

function makeEvent(eventType, overrides = {}) {
  return {
    event_id: overrides.event_id || `evt_${randomBytes(8).toString('hex')}`,
    event_type: eventType,
    timestamp: overrides.timestamp || new Date().toISOString(),
    run_id: overrides.run_id || 'run_test_001',
    phase: overrides.phase || 'delivery',
    status: overrides.status || 'running',
    turn: overrides.turn || null,
    payload: overrides.payload || {},
  };
}

function writeEventsJsonl(repoRoot, events) {
  const eventsPath = join(repoRoot, '.agentxchain', 'events.jsonl');
  writeFileSync(eventsPath, events.map(e => JSON.stringify(e)).join('\n') + '\n');
}

function appendEventJsonl(repoRoot, event) {
  const eventsPath = join(repoRoot, '.agentxchain', 'events.jsonl');
  appendFileSync(eventsPath, JSON.stringify(event) + '\n');
}

/**
 * Scaffold a coordinator workspace with N child repos, each with
 * their own agentxchain.json and state.
 */
function scaffoldCoordinatorWorkspace(root, repoIds) {
  mkdirSync(root, { recursive: true });
  mkdirSync(join(root, '.agentxchain', 'multirepo'), { recursive: true });

  const repos = {};
  const workstreams = {};

  for (const repoId of repoIds) {
    const repoDir = join(root, `repos/${repoId}`);
    mkdirSync(join(repoDir, '.agentxchain'), { recursive: true });

    repos[repoId] = { path: `repos/${repoId}`, default_branch: 'main', required: true };

    // Write a minimal agentxchain.json for each child repo
    writeJson(join(repoDir, 'agentxchain.json'), {
      schema_version: '1.0',
      template: 'generic',
      project: { id: `${repoId}-proj`, name: repoId, default_branch: 'main' },
      roles: {
        dev: { title: 'Developer', mandate: 'Build.', write_authority: 'authoritative', runtime: 'local-dev' },
      },
      runtimes: {
        'local-dev': { type: 'local_cli', command: ['echo', '{prompt}'], prompt_transport: 'argv' },
      },
      routing: {
        implementation: { entry_role: 'dev', allowed_next_roles: ['dev'] },
      },
      gates: {},
    });

    writeJson(join(repoDir, '.agentxchain/state.json'), {
      schema_version: '1.1',
      run_id: `run_${repoId}_001`,
      status: 'active',
      phase: 'implementation',
      active_turns: {},
      accepted_count: 0,
      rejected_count: 0,
      blocked_on: null,
      blocked_reason: null,
    });

    writeFileSync(join(repoDir, '.agentxchain/history.jsonl'), '');
    writeFileSync(join(repoDir, '.agentxchain/decision-ledger.jsonl'), '');
  }

  workstreams['ws-main'] = {
    phase: 'implementation',
    repos: repoIds,
    entry_repo: repoIds[0],
    depends_on: [],
    completion_barrier: 'all_repos_accepted',
  };

  // Write coordinator config
  writeJson(join(root, 'agentxchain-multi.json'), {
    schema_version: '0.1',
    project: { id: 'coord-test', name: 'Coordinator Test' },
    repos,
    workstreams,
    routing: {
      implementation: { entry_workstream: 'ws-main' },
    },
    gates: {},
  });

  // Write coordinator state
  const repoRuns = {};
  for (const repoId of repoIds) {
    repoRuns[repoId] = { run_id: `run_${repoId}_001`, status: 'linked', phase: 'delivery' };
  }

  writeJson(join(root, '.agentxchain/multirepo/state.json'), {
    schema_version: '0.1',
    super_run_id: 'srun_test_001',
    project_id: 'coord-test',
    status: 'active',
    phase: 'delivery',
    repo_runs: repoRuns,
    pending_gate: null,
    created_at: '2026-04-15T00:00:00Z',
    updated_at: '2026-04-15T00:00:00Z',
  });

  return root;
}

// ── Unit Tests: readAggregatedCoordinatorEvents ─────────────────────────────

describe('coordinator event aggregation — unit', () => {
  let root;

  before(() => {
    root = tmpDir();
    scaffoldCoordinatorWorkspace(root, ['api', 'web']);

    // Write events for api repo
    writeEventsJsonl(join(root, 'repos/api'), [
      makeEvent('run_started', { timestamp: '2026-04-15T00:00:00Z', run_id: 'run_api_001', event_id: 'evt_api_1' }),
      makeEvent('turn_dispatched', { timestamp: '2026-04-15T00:00:02Z', run_id: 'run_api_001', event_id: 'evt_api_2' }),
      makeEvent('turn_accepted', { timestamp: '2026-04-15T00:00:04Z', run_id: 'run_api_001', event_id: 'evt_api_3' }),
    ]);

    // Write events for web repo
    writeEventsJsonl(join(root, 'repos/web'), [
      makeEvent('run_started', { timestamp: '2026-04-15T00:00:01Z', run_id: 'run_web_001', event_id: 'evt_web_1' }),
      makeEvent('turn_dispatched', { timestamp: '2026-04-15T00:00:03Z', run_id: 'run_web_001', event_id: 'evt_web_2' }),
      makeEvent('run_completed', { timestamp: '2026-04-15T00:00:05Z', run_id: 'run_web_001', event_id: 'evt_web_3' }),
    ]);
  });

  after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('merges events from multiple repos sorted by timestamp', () => {
    const result = readAggregatedCoordinatorEvents(root, { limit: 0 });
    assert.ok(result.ok);
    assert.equal(result.events.length, 6);

    // Verify interleaved order by timestamp
    assert.equal(result.events[0].event_id, 'evt_api_1'); // 00:00:00
    assert.equal(result.events[1].event_id, 'evt_web_1'); // 00:00:01
    assert.equal(result.events[2].event_id, 'evt_api_2'); // 00:00:02
    assert.equal(result.events[3].event_id, 'evt_web_2'); // 00:00:03
    assert.equal(result.events[4].event_id, 'evt_api_3'); // 00:00:04
    assert.equal(result.events[5].event_id, 'evt_web_3'); // 00:00:05
  });

  it('tags each event with repo_id', () => {
    const result = readAggregatedCoordinatorEvents(root, { limit: 0 });
    assert.ok(result.ok);
    assert.equal(result.events[0].repo_id, 'api');
    assert.equal(result.events[1].repo_id, 'web');
    assert.equal(result.events[2].repo_id, 'api');
    assert.equal(result.events[3].repo_id, 'web');
  });

  it('filters by repo_id', () => {
    const result = readAggregatedCoordinatorEvents(root, { repo_id: 'api', limit: 0 });
    assert.ok(result.ok);
    assert.equal(result.events.length, 3);
    assert.ok(result.events.every(e => e.repo_id === 'api'));
  });

  it('filters by type', () => {
    const result = readAggregatedCoordinatorEvents(root, { type: 'run_started', limit: 0 });
    assert.ok(result.ok);
    assert.equal(result.events.length, 2);
    assert.ok(result.events.every(e => e.event_type === 'run_started'));
  });

  it('filters by since', () => {
    const result = readAggregatedCoordinatorEvents(root, { since: '2026-04-15T00:00:03Z', limit: 0 });
    assert.ok(result.ok);
    assert.equal(result.events.length, 2); // events after 00:00:03
    assert.equal(result.events[0].event_id, 'evt_api_3');
    assert.equal(result.events[1].event_id, 'evt_web_3');
  });

  it('respects limit (from end)', () => {
    const result = readAggregatedCoordinatorEvents(root, { limit: 2 });
    assert.ok(result.ok);
    assert.equal(result.events.length, 2);
    assert.equal(result.events[0].event_id, 'evt_api_3');
    assert.equal(result.events[1].event_id, 'evt_web_3');
  });

  it('returns error when no coordinator config', () => {
    const emptyDir = tmpDir();
    const result = readAggregatedCoordinatorEvents(emptyDir);
    assert.equal(result.ok, false);
    assert.ok(result.error);
    rmSync(emptyDir, { recursive: true, force: true });
  });

  it('skips repos with missing events.jsonl', () => {
    // Remove web events
    const webEventsPath = join(root, 'repos/web/.agentxchain/events.jsonl');
    rmSync(webEventsPath, { force: true });

    const result = readAggregatedCoordinatorEvents(root, { limit: 0 });
    assert.ok(result.ok);
    assert.equal(result.events.length, 3); // Only api events
    assert.ok(result.events.every(e => e.repo_id === 'api'));

    // Restore for other tests
    writeEventsJsonl(join(root, 'repos/web'), [
      makeEvent('run_started', { timestamp: '2026-04-15T00:00:01Z', run_id: 'run_web_001', event_id: 'evt_web_1' }),
      makeEvent('turn_dispatched', { timestamp: '2026-04-15T00:00:03Z', run_id: 'run_web_001', event_id: 'evt_web_2' }),
      makeEvent('run_completed', { timestamp: '2026-04-15T00:00:05Z', run_id: 'run_web_001', event_id: 'evt_web_3' }),
    ]);
  });
});

// ── HTTP Integration Tests ─────────────────────────────────────────────────

describe('coordinator event aggregation — /api/coordinator/events', () => {
  let root, bridge, port;

  before(async () => {
    root = tmpDir();
    scaffoldCoordinatorWorkspace(root, ['api', 'web']);

    writeEventsJsonl(join(root, 'repos/api'), [
      makeEvent('run_started', { timestamp: '2026-04-15T00:00:00Z', run_id: 'run_api_001', event_id: 'evt_api_1' }),
      makeEvent('turn_accepted', { timestamp: '2026-04-15T00:00:02Z', run_id: 'run_api_001', event_id: 'evt_api_2' }),
    ]);

    writeEventsJsonl(join(root, 'repos/web'), [
      makeEvent('run_started', { timestamp: '2026-04-15T00:00:01Z', run_id: 'run_web_001', event_id: 'evt_web_1' }),
      makeEvent('run_completed', { timestamp: '2026-04-15T00:00:03Z', run_id: 'run_web_001', event_id: 'evt_web_2' }),
    ]);

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

  it('returns merged events from 2 child repos', async () => {
    const res = await httpGet(port, '/api/coordinator/events?limit=0');
    assert.equal(res.status, 200);
    const events = JSON.parse(res.body);
    assert.equal(events.length, 4);
    assert.equal(events[0].repo_id, 'api');
    assert.equal(events[1].repo_id, 'web');
    assert.equal(events[2].repo_id, 'api');
    assert.equal(events[3].repo_id, 'web');
  });

  it('events are sorted by timestamp ascending', async () => {
    const res = await httpGet(port, '/api/coordinator/events?limit=0');
    const events = JSON.parse(res.body);
    for (let i = 1; i < events.length; i++) {
      assert.ok(
        new Date(events[i].timestamp).getTime() >= new Date(events[i - 1].timestamp).getTime(),
        `Event ${i} timestamp is before event ${i - 1}`
      );
    }
  });

  it('filters by repo_id', async () => {
    const res = await httpGet(port, '/api/coordinator/events?repo_id=web&limit=0');
    assert.equal(res.status, 200);
    const events = JSON.parse(res.body);
    assert.equal(events.length, 2);
    assert.ok(events.every(e => e.repo_id === 'web'));
  });

  it('filters by type', async () => {
    const res = await httpGet(port, '/api/coordinator/events?type=run_started&limit=0');
    assert.equal(res.status, 200);
    const events = JSON.parse(res.body);
    assert.equal(events.length, 2);
    assert.ok(events.every(e => e.event_type === 'run_started'));
  });

  it('filters by since', async () => {
    const res = await httpGet(port, '/api/coordinator/events?since=2026-04-15T00:00:01Z&limit=0');
    assert.equal(res.status, 200);
    const events = JSON.parse(res.body);
    assert.equal(events.length, 2);
    assert.equal(events[0].event_id, 'evt_api_2');
    assert.equal(events[1].event_id, 'evt_web_2');
  });

  it('respects limit', async () => {
    const res = await httpGet(port, '/api/coordinator/events?limit=2');
    assert.equal(res.status, 200);
    const events = JSON.parse(res.body);
    assert.equal(events.length, 2);
  });

  it('returns 404 when no coordinator config', async () => {
    const root2 = tmpDir();
    mkdirSync(join(root2, '.agentxchain'), { recursive: true });
    writeJson(join(root2, '.agentxchain/state.json'), { schema_version: '1.1', project_id: 'test', run_id: null, status: 'idle', phase: 'delivery', active_turns: {}, turn_sequence: 0 });
    writeJson(join(root2, 'agentxchain.json'), {
      schema_version: '1.0',
      project: { id: 'test', name: 'test', default_branch: 'main' },
      roles: { dev: { title: 'Dev', mandate: 'Build.', write_authority: 'authoritative', runtime: 'local' } },
      runtimes: { local: { type: 'local_cli', command: ['echo'], prompt_transport: 'argv' } },
      routing: { delivery: { entry_role: 'dev', allowed_next_roles: ['dev'] } },
      gates: {},
    });

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
      const res = await httpGet(result2.port, '/api/coordinator/events');
      assert.equal(res.status, 404);
    } finally {
      await bridge2.stop();
      rmSync(root2, { recursive: true, force: true });
    }
  });

  it('returns 500 when coordinator config exists but is invalid', async () => {
    const root2 = tmpDir();
    mkdirSync(join(root2, '.agentxchain'), { recursive: true });
    writeFileSync(join(root2, 'agentxchain-multi.json'), '{invalid json\n');

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
      const res = await httpGet(result2.port, '/api/coordinator/events');
      assert.equal(res.status, 500);
      const data = JSON.parse(res.body);
      assert.match(data.error, /config_invalid:/);
    } finally {
      await bridge2.stop();
      rmSync(root2, { recursive: true, force: true });
    }
  });
});

describe('coordinator event aggregation — WebSocket', () => {
  let root, bridge, port, client;

  before(async () => {
    root = tmpDir();
    scaffoldCoordinatorWorkspace(root, ['api', 'web']);

    writeEventsJsonl(join(root, 'repos/api'), [
      makeEvent('run_started', { timestamp: '2026-04-15T00:00:00Z', run_id: 'run_api_001', event_id: 'evt_api_1' }),
    ]);

    writeEventsJsonl(join(root, 'repos/web'), [
      makeEvent('run_started', { timestamp: '2026-04-15T00:00:01Z', run_id: 'run_web_001', event_id: 'evt_web_1' }),
    ]);

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
    client = await connectWebSocketClient(port);
  });

  after(async () => {
    client?.close();
    if (bridge) await bridge.stop();
    rmSync(root, { recursive: true, force: true });
  });

  it('pushes coordinator_event frames when child repo events change', async () => {
    client.sendJson({ type: 'subscribe', event_types: ['coordinator_event'] });
    await client.waitForMessage((message) => (
      message.type === 'subscribed' &&
      Array.isArray(message.event_types) &&
      message.event_types.includes('coordinator_event')
    ));

    const appended = makeEvent('turn_accepted', {
      timestamp: '2026-04-15T00:00:02Z',
      run_id: 'run_web_001',
      event_id: 'evt_web_2',
    });
    appendEventJsonl(join(root, 'repos/web'), appended);

    const pushed = await client.waitForMessage((message) => (
      message.type === 'coordinator_event' &&
      message.repo_id === 'web' &&
      message.event?.event_id === 'evt_web_2'
    ), 7000);

    assert.equal(pushed.event.event_type, 'turn_accepted');
    assert.equal(pushed.event.repo_id, 'web');
  });

  it('does not push coordinator_event frames to clients subscribed only to local event types', async () => {
    const filteredClient = await connectWebSocketClient(port);

    try {
      filteredClient.sendJson({ type: 'subscribe', event_types: ['run_completed'] });
      await filteredClient.waitForMessage((message) => (
        message.type === 'subscribed' &&
        Array.isArray(message.event_types) &&
        message.event_types.includes('run_completed')
      ));

      const appended = makeEvent('run_completed', {
        timestamp: '2026-04-15T00:00:03Z',
        run_id: 'run_api_001',
        event_id: 'evt_api_2',
      });
      appendEventJsonl(join(root, 'repos/api'), appended);

      await new Promise((resolve) => setTimeout(resolve, 1200));
      const coordinatorMessages = filteredClient.messages.filter((message) => message.type === 'coordinator_event');
      assert.equal(coordinatorMessages.length, 0);
    } finally {
      filteredClient.close();
    }
  });
});

describe('coordinator event aggregation — proof', () => {
  it('WebSocket proof script runs and passes', { timeout: 120000 }, async () => {
    const { spawnSync } = await import('child_process');
    const { fileURLToPath } = await import('url');
    const { dirname } = await import('path');

    const __dirname = dirname(fileURLToPath(import.meta.url));
    const proofPath = join(__dirname, '..', '..', 'examples', 'live-governed-proof', 'run-coordinator-event-websocket-proof.mjs');

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
      assert.fail(`Coordinator WebSocket proof did not produce valid JSON. stdout: ${result.stdout?.slice(0, 500)}, stderr: ${result.stderr?.slice(0, 500)}`);
    }

    assert.equal(proof.result, 'pass', `Coordinator WebSocket proof failed: ${JSON.stringify(proof.errors)}`);
    assert.equal(proof.artifacts?.coordinator_event_count, 1);
    assert.deepEqual(proof.artifacts?.repo_ids, ['web']);
  });
});
