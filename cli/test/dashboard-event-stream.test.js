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
import { createHash, randomBytes } from 'crypto';
import http from 'http';

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
    runtimes: { local: { type: 'local_cli', command: ['echo', '{prompt}'], prompt_transport: 'argv' } },
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

function writeCoordinatorWorkspace(root) {
  mkdirSync(root, { recursive: true });
  mkdirSync(join(root, '.agentxchain', 'multirepo'), { recursive: true });

  writeJson(join(root, 'agentxchain-multi.json'), {
    schema_version: '0.1',
    project: { id: 'coord-live-test', name: 'Coordinator Live Test' },
    repos: {
      api: { path: './repos/api' },
      web: { path: './repos/web' },
    },
    workstreams: {
      sync: {
        phase: 'implementation',
        repos: ['api', 'web'],
        entry_repo: 'api',
        depends_on: [],
        completion_barrier: 'all_repos_accepted',
      },
    },
    routing: {
      implementation: { entry_workstream: 'sync' },
    },
    gates: {},
  });

  writeJson(join(root, '.agentxchain', 'multirepo', 'state.json'), {
    schema_version: '0.1',
    super_run_id: 'srun_live_001',
    project_id: 'coord-live-test',
    status: 'active',
    phase: 'implementation',
    repo_runs: {
      api: { run_id: 'run_api_001', status: 'linked', phase: 'implementation' },
      web: { run_id: 'run_web_001', status: 'linked', phase: 'implementation' },
    },
    pending_gate: null,
  });

  for (const repoId of ['api', 'web']) {
    const repoRoot = join(root, 'repos', repoId);
    writeGovernedRepo(repoRoot);
    writeJson(join(repoRoot, 'agentxchain.json'), {
      schema_version: '1.0',
      project: { id: `${repoId}-live-test`, name: repoId, default_branch: 'main' },
      roles: { dev: { title: 'Dev', mandate: 'Build.', write_authority: 'authoritative', runtime: 'local' } },
      runtimes: { local: { type: 'local_cli', command: ['echo', '{prompt}'], prompt_transport: 'argv' } },
      routing: { implementation: { entry_role: 'dev', allowed_next_roles: ['dev'] } },
      gates: {},
    });
    writeJson(join(repoRoot, '.agentxchain', 'state.json'), {
      schema_version: '1.1',
      project_id: `${repoId}-live-test`,
      run_id: `run_${repoId}_001`,
      status: 'active',
      phase: 'implementation',
      active_turns: {},
      turn_sequence: 0,
    });
    writeFileSync(join(repoRoot, '.agentxchain', 'events.jsonl'), '');
  }
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
    assert.equal(FILE_TO_RESOURCE['repo-decisions.jsonl'], '/api/repo-decisions-summary');
    assert.equal(resourceForRelativePath('repo-decisions.jsonl'), '/api/repo-decisions-summary');
  });
});

describe('dashboard event stream — WebSocket push', () => {
  let root, bridge, port;

  before(async () => {
    root = tmpDir();
    writeGovernedRepo(root);

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

  it('pushes actual event payloads when events.jsonl changes', async () => {
    const client = await connectWebSocketClient(port);
    try {
      const expected = makeEvent('turn_accepted', {
        turn: { turn_id: 'turn_ws_001', role_id: 'dev' },
      });

      appendEventJsonl(root, expected);

      const [eventMessage, invalidateMessage] = await Promise.all([
        client.waitForMessage((message) => (
          message.type === 'event' &&
          message.event?.event_id === expected.event_id
        )),
        client.waitForMessage((message) => (
          message.type === 'invalidate' &&
          message.resource === '/api/events'
        )),
      ]);

      assert.equal(eventMessage.event.event_type, 'turn_accepted');
      assert.equal(eventMessage.event.turn.turn_id, 'turn_ws_001');
      assert.equal(invalidateMessage.resource, '/api/events');
    } finally {
      client.close();
    }
  });

  it('applies subscribe filtering to pushed event payloads', async () => {
    const client = await connectWebSocketClient(port);
    try {
      client.sendJson({ type: 'subscribe', event_types: ['run_completed'] });
      const subscribed = await client.waitForMessage((message) => message.type === 'subscribed');
      assert.deepEqual(subscribed.event_types, ['run_completed']);

      const filteredRunId = `run_filter_${randomBytes(3).toString('hex')}`;
      appendEventJsonl(root, makeEvent('run_started', { run_id: filteredRunId }));
      appendEventJsonl(root, makeEvent('run_completed', { run_id: filteredRunId }));

      const completed = await client.waitForMessage((message) => (
        message.type === 'event' &&
        message.event?.run_id === filteredRunId &&
        message.event?.event_type === 'run_completed'
      ));
      assert.equal(completed.event.event_type, 'run_completed');

      await sleep(200);
      const filteredEvents = client.messages.filter((message) => (
        message.type === 'event' &&
        message.event?.run_id === filteredRunId
      ));
      assert.deepEqual(
        filteredEvents.map((message) => message.event.event_type),
        ['run_completed'],
      );
    } finally {
      client.close();
    }
  });
});

describe('dashboard event stream — coordinator WebSocket push', () => {
  let root, bridge, port;

  before(async () => {
    root = tmpDir();
    writeCoordinatorWorkspace(root);

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

  it('AT-DLO-005: pushes coordinator_event messages when child repo events change', async () => {
    const client = await connectWebSocketClient(port);
    try {
      const expected = makeEvent('turn_accepted', {
        timestamp: '2026-04-15T16:10:05Z',
        turn: { turn_id: 'turn_api_002', role_id: 'dev' },
      });

      appendEventJsonl(join(root, 'repos', 'api'), expected);

      const coordinatorMessage = await client.waitForMessage((message) => (
        message.type === 'coordinator_event' &&
        message.repo_id === 'api' &&
        message.event?.event_id === expected.event_id
      ), 7000);

      assert.equal(coordinatorMessage.event.event_type, 'turn_accepted');
      assert.equal(coordinatorMessage.repo_id, 'api');
      assert.equal(coordinatorMessage.event.turn.turn_id, 'turn_api_002');
    } finally {
      client.close();
    }
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

  it('WebSocket proof script runs and passes', { timeout: 120000 }, async () => {
    const { spawnSync } = await import('child_process');
    const { fileURLToPath } = await import('url');
    const { dirname } = await import('path');

    const __dirname = dirname(fileURLToPath(import.meta.url));
    const proofPath = join(__dirname, '..', '..', 'examples', 'governed-todo-app', 'run-dashboard-websocket-event-proof.mjs');

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
      assert.fail(`WebSocket proof script did not produce valid JSON. stdout: ${result.stdout?.slice(0, 500)}, stderr: ${result.stderr?.slice(0, 500)}`);
    }

    assert.equal(proof.result, 'pass', `WebSocket proof failed: ${JSON.stringify(proof.errors)}`);
    assert.ok(proof.artifacts?.all_event_count > 0, 'Should have WebSocket event messages');
    assert.deepEqual(proof.artifacts?.filtered_event_types, ['run_completed']);
  });
});
