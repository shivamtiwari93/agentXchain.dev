#!/usr/bin/env node

/**
 * Coordinator Event Aggregation WebSocket Proof
 *
 * Proves that the dashboard bridge-server pushes real-time coordinator_event
 * frames when child repo events.jsonl files change.
 *
 * Usage:
 *   node examples/live-governed-proof/run-coordinator-event-websocket-proof.mjs [--json]
 */

import { mkdirSync, writeFileSync, rmSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash, randomBytes } from 'node:crypto';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..', '..');
const jsonMode = process.argv.includes('--json');

function writeJson(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
}

function makeEvent(eventType, overrides = {}) {
  return {
    event_id: overrides.event_id || `evt_${randomBytes(8).toString('hex')}`,
    event_type: eventType,
    timestamp: overrides.timestamp || new Date().toISOString(),
    run_id: overrides.run_id || 'run_test',
    phase: overrides.phase || 'implementation',
    status: overrides.status || 'running',
    turn: overrides.turn || null,
    payload: overrides.payload || {},
  };
}

function writeEventsJsonl(repoRoot, events) {
  const eventsPath = join(repoRoot, '.agentxchain', 'events.jsonl');
  writeFileSync(eventsPath, events.map((event) => JSON.stringify(event)).join('\n') + '\n');
}

function appendEventJsonl(repoRoot, event) {
  const eventsPath = join(repoRoot, '.agentxchain', 'events.jsonl');
  appendFileSync(eventsPath, JSON.stringify(event) + '\n');
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
      if (res.headers['sec-websocket-accept'] !== expectedWebSocketAccept(key)) {
        reject(new Error('WebSocket handshake accept hash mismatch.'));
        return;
      }

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
        waitForMessage(predicate, timeoutMs = 7000) {
          const found = messages.find(predicate);
          if (found) return Promise.resolve(found);

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

function scaffoldWorkspace() {
  const root = join(tmpdir(), `axc-coord-ws-proof-${randomBytes(6).toString('hex')}`);
  mkdirSync(root, { recursive: true });
  mkdirSync(join(root, '.agentxchain', 'multirepo'), { recursive: true });

  for (const repoId of ['api', 'web']) {
    const repoDir = join(root, `repos/${repoId}`);
    mkdirSync(join(repoDir, '.agentxchain'), { recursive: true });

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

  writeJson(join(root, 'agentxchain-multi.json'), {
    schema_version: '0.1',
    project: { id: 'coord-test', name: 'Coordinator Event WebSocket Proof' },
    repos: {
      api: { path: 'repos/api', default_branch: 'main', required: true },
      web: { path: 'repos/web', default_branch: 'main', required: true },
    },
    workstreams: {
      'ws-main': {
        phase: 'implementation',
        repos: ['api', 'web'],
        entry_repo: 'api',
        depends_on: [],
        completion_barrier: 'all_repos_accepted',
      },
    },
    routing: {
      implementation: { entry_workstream: 'ws-main' },
    },
    gates: {},
  });

  writeJson(join(root, '.agentxchain/multirepo/state.json'), {
    schema_version: '0.1',
    super_run_id: 'srun_proof_ws_001',
    project_id: 'coord-test',
    status: 'active',
    phase: 'implementation',
    repo_runs: {
      api: { run_id: 'run_api_001', status: 'linked', phase: 'implementation' },
      web: { run_id: 'run_web_001', status: 'linked', phase: 'implementation' },
    },
    pending_gate: null,
    created_at: '2026-04-15T00:00:00Z',
    updated_at: '2026-04-15T00:00:00Z',
  });

  writeEventsJsonl(join(root, 'repos/api'), [
    makeEvent('run_started', { timestamp: '2026-04-15T10:00:00Z', run_id: 'run_api_001', event_id: 'evt_api_start' }),
  ]);
  writeEventsJsonl(join(root, 'repos/web'), [
    makeEvent('run_started', { timestamp: '2026-04-15T10:00:01Z', run_id: 'run_web_001', event_id: 'evt_web_start' }),
  ]);

  return root;
}

const checks = [];
function check(name, ok, detail = '') {
  checks.push({ name, ok, detail });
  if (!jsonMode) {
    console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function main() {
  const root = scaffoldWorkspace();
  const dashboardDir = join(root, 'dashboard');
  mkdirSync(dashboardDir, { recursive: true });
  writeFileSync(join(dashboardDir, 'index.html'), '<html></html>');

  const { createBridgeServer } = await import(
    join(repoRoot, 'cli/src/lib/dashboard/bridge-server.js')
  );

  const bridge = createBridgeServer({
    agentxchainDir: join(root, '.agentxchain'),
    dashboardDir,
    port: 0,
  });
  const { port } = await bridge.start();
  const client = await connectWebSocketClient(port);

  try {
    client.sendJson({ type: 'subscribe', event_types: ['coordinator_event'] });
    const subscribed = await client.waitForMessage((message) => (
      message.type === 'subscribed' &&
      Array.isArray(message.event_types) &&
      message.event_types.includes('coordinator_event')
    ));
    check('subscribe ack received', !!subscribed);

    const appended = makeEvent('turn_accepted', {
      timestamp: '2026-04-15T10:00:02Z',
      run_id: 'run_web_001',
      event_id: 'evt_web_accept',
    });
    appendEventJsonl(join(root, 'repos/web'), appended);

    const pushed = await client.waitForMessage((message) => (
      message.type === 'coordinator_event' &&
      message.repo_id === 'web' &&
      message.event?.event_id === 'evt_web_accept'
    ));

    check('coordinator_event pushed over WebSocket', !!pushed);
    check('repo_id preserved', pushed.repo_id === 'web', `repo_id=${pushed.repo_id}`);
    check('event payload preserved', pushed.event?.event_type === 'turn_accepted', `event_type=${pushed.event?.event_type}`);

    const coordinatorEvents = client.messages.filter((message) => message.type === 'coordinator_event');
    const repoIds = [...new Set(coordinatorEvents.map((message) => message.repo_id))];

    const output = {
      result: checks.every((entry) => entry.ok) ? 'pass' : 'fail',
      checks,
      errors: checks.filter((entry) => !entry.ok),
      artifacts: {
        coordinator_event_count: coordinatorEvents.length,
        repo_ids: repoIds,
      },
    };

    if (jsonMode) {
      process.stdout.write(JSON.stringify(output));
    }
  } finally {
    client.close();
    await bridge.stop();
    rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  const output = {
    result: 'fail',
    checks,
    errors: [...checks.filter((entry) => !entry.ok), { name: 'unhandled_error', ok: false, detail: error.message }],
    artifacts: {},
  };
  if (jsonMode) {
    process.stdout.write(JSON.stringify(output));
  } else {
    console.error(error);
  }
  process.exitCode = 1;
});
