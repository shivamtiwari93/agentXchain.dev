#!/usr/bin/env node

/**
 * Dashboard WebSocket event proof.
 *
 * Proves the live bridge-server WebSocket path, not just events.jsonl or the
 * CLI reader. A real governed run emits lifecycle events into events.jsonl,
 * the dashboard bridge watches that file, and connected clients receive
 * `{ type: "event" }` messages in-order. A filtered subscriber must only
 * receive the subscribed event types.
 */

import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { createBridgeServer } from '../../cli/src/lib/dashboard/bridge-server.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..', '..');
const cliRoot = join(repoRoot, 'cli');
const binPath = join(cliRoot, 'bin', 'agentxchain.js');
const cliPkg = JSON.parse(readFileSync(join(cliRoot, 'package.json'), 'utf8'));
const jsonMode = process.argv.includes('--json');

function writeJson(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function gitInit(root) {
  const opts = { cwd: root, stdio: 'ignore' };
  spawnSync('git', ['init'], opts);
  spawnSync('git', ['config', 'user.name', 'Dashboard Event Proof'], opts);
  spawnSync('git', ['config', 'user.email', 'dashboard-event-proof@example.invalid'], opts);
  spawnSync('git', ['add', '-A'], opts);
  spawnSync('git', ['commit', '--allow-empty', '-m', 'scaffold'], opts);
}

function writeMockAgent(root) {
  const mockPath = join(root, 'mock-agent.mjs');
  writeFileSync(mockPath, `#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';

const cwd = process.cwd();
const indexPath = join(cwd, '.agentxchain/dispatch/index.json');
if (!existsSync(indexPath)) {
  console.error('dashboard-ws-mock: no dispatch index');
  process.exit(1);
}

const index = JSON.parse(readFileSync(indexPath, 'utf8'));
const turnEntries = Object.values(index.active_turns || {});
if (turnEntries.length === 0) {
  console.error('dashboard-ws-mock: no active turns');
  process.exit(1);
}

const entry = turnEntries[0];
const absStaging = join(cwd, entry.staging_result_path);
mkdirSync(dirname(absStaging), { recursive: true });

writeFileSync(absStaging, JSON.stringify({
  schema_version: '1.0',
  run_id: index.run_id,
  turn_id: entry.turn_id,
  role: entry.role,
  runtime_id: entry.runtime_id,
  status: 'completed',
  summary: 'Dashboard WebSocket event proof turn',
  decisions: [{
    id: 'DEC-301',
    category: 'implementation',
    statement: 'Bridge WebSocket must stream governed lifecycle events.',
    rationale: 'Proof requires a real accepted turn.',
  }],
  objections: [],
  files_changed: ['src/mock.js'],
  artifacts_created: [],
  verification: {
    status: 'pass',
    commands: ['echo ok'],
    evidence_summary: 'dashboard websocket proof pass',
    machine_evidence: [{ command: 'echo ok', exit_code: 0 }],
  },
  artifact: { type: 'workspace', ref: null },
  proposed_next_role: 'human',
  phase_transition_request: null,
  run_completion_request: true,
  needs_human_reason: null,
  cost: { input_tokens: 0, output_tokens: 0, usd: 0 },
}, null, 2));
`);
  return mockPath;
}

function makeConfig(mockAgentPath) {
  return {
    schema_version: 4,
    protocol_mode: 'governed',
    project: {
      id: `dashboard-websocket-proof-${randomBytes(4).toString('hex')}`,
      name: 'Dashboard WebSocket Event Proof',
      description: 'Prove live bridge WebSocket lifecycle events.',
      default_branch: 'main',
    },
    roles: {
      dev: {
        title: 'Developer',
        mandate: 'Implement features.',
        write_authority: 'authoritative',
        runtime: 'local-dev',
        runtime_class: 'local_cli',
        runtime_id: 'local-dev',
      },
    },
    runtimes: {
      'local-dev': {
        type: 'local_cli',
        command: process.execPath,
        args: [mockAgentPath],
        prompt_transport: 'dispatch_bundle_only',
      },
    },
    routing: {
      delivery: {
        entry_role: 'dev',
        allowed_next_roles: ['dev', 'human'],
        exit_gate: 'delivery_signoff',
      },
    },
    phases: ['delivery'],
    gates: {
      delivery_signoff: {},
    },
    budget: {
      per_turn_max_usd: 1,
      per_run_max_usd: 5,
    },
    rules: {
      challenge_required: false,
      max_turn_retries: 2,
      max_deadlock_cycles: 2,
    },
    files: {
      talk: 'TALK.md',
      history: '.agentxchain/history.jsonl',
      state: '.agentxchain/state.json',
    },
    compat: {
      next_owner_source: 'state-json',
      lock_based_coordination: false,
      original_version: 4,
    },
  };
}

function scaffoldProject(root) {
  mkdirSync(join(root, '.agentxchain'), { recursive: true });
  mkdirSync(join(root, 'src'), { recursive: true });
  mkdirSync(join(root, 'dashboard'), { recursive: true });
  const mockAgentPath = writeMockAgent(root);
  writeJson(join(root, 'agentxchain.json'), makeConfig(mockAgentPath));
  writeJson(join(root, '.agentxchain', 'state.json'), {
    schema_version: '1.1',
    project_id: 'dashboard-websocket-proof',
    status: 'idle',
    phase: 'delivery',
    run_id: null,
    turn_sequence: 0,
    active_turns: {},
    next_role: null,
    pending_phase_transition: null,
    pending_run_completion: null,
    blocked_on: null,
    blocked_reason: null,
  });
  writeFileSync(join(root, '.agentxchain', 'history.jsonl'), '');
  writeFileSync(join(root, '.agentxchain', 'decision-ledger.jsonl'), '');
  writeFileSync(join(root, 'src', 'mock.js'), 'export const ok = true;\n');
  writeFileSync(join(root, 'TALK.md'), '# Dashboard WebSocket Event Proof\n');
  writeFileSync(join(root, 'dashboard', 'index.html'), '<html><body>Dashboard Proof</body></html>\n');
  gitInit(root);
}

function runCliAsync(cwd, args, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [binPath, ...args], {
      cwd,
      env: {
        ...process.env,
        NODE_NO_WARNINGS: '1',
        NO_COLOR: '1',
        ...env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('close', (code) => {
      resolve({
        status: code ?? 1,
        stdout,
        stderr,
      });
    });
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
      if (res.headers['sec-websocket-accept'] !== expectedWebSocketAccept(key)) {
        reject(new Error('WebSocket accept hash mismatch'));
        socket.destroy();
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
        waitForMessage(predicate, timeoutMs = 5000) {
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

function buildPayload({ result, errors, artifacts, traces }) {
  return {
    runner: 'dashboard-websocket-event-proof',
    cli_version: cliPkg.version,
    cli_path: binPath,
    result,
    artifacts,
    traces,
    errors,
  };
}

function printPayload(payload) {
  if (jsonMode) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }

  console.log(`Dashboard WebSocket Event Proof — agentxchain v${payload.cli_version}`);
  if (payload.result === 'pass') {
    console.log(`  Run ID:                ${payload.artifacts?.run_id || 'n/a'}`);
    console.log(`  All-event count:       ${payload.artifacts?.all_event_count ?? 0}`);
    console.log(`  Filtered event types:  ${payload.artifacts?.filtered_event_types?.join(', ') || 'n/a'}`);
    console.log(`  Invalidation count:    ${payload.artifacts?.invalidate_count ?? 0}`);
    console.log('  Result:                PASS — bridge streamed live lifecycle events');
    return;
  }

  console.log('  Result:                FAIL');
  for (const error of payload.errors) {
    console.log(`  Error:                 ${error}`);
  }
}

async function main() {
  const root = join(tmpdir(), `axc-dashboard-websocket-proof-${randomBytes(6).toString('hex')}`);
  const errors = [];
  const traces = [];
  let bridge;
  let allClient;
  let filteredClient;

  mkdirSync(root, { recursive: true });

  try {
    scaffoldProject(root);

    bridge = createBridgeServer({
      agentxchainDir: join(root, '.agentxchain'),
      dashboardDir: join(root, 'dashboard'),
      port: 0,
    });

    const { port } = await bridge.start();
    traces.push({ step: 'bridge_started', port });

    allClient = await connectWebSocketClient(port);
    filteredClient = await connectWebSocketClient(port);
    filteredClient.sendJson({ type: 'subscribe', event_types: ['run_completed'] });
    await filteredClient.waitForMessage((message) => (
      message.type === 'subscribed' &&
      Array.isArray(message.event_types) &&
      message.event_types.length === 1 &&
      message.event_types[0] === 'run_completed'
    ));
    traces.push({ step: 'ws_clients_ready' });

    const run = await runCliAsync(root, ['run', '--auto-approve']);
    traces.push({ step: 'run_finished', status: run.status });
    if (run.status !== 0) {
      errors.push(`run failed:\n${run.stdout}\n${run.stderr}`);
    }

    const state = readJson(join(root, '.agentxchain', 'state.json'));
    if (state.status !== 'completed') {
      errors.push(`run expected completed state, got ${state.status}`);
    }

    await allClient.waitForMessage((message) => (
      message.type === 'event' &&
      message.event?.event_type === 'run_completed' &&
      message.event?.run_id === state.run_id
    ), 5000);
    await filteredClient.waitForMessage((message) => (
      message.type === 'event' &&
      message.event?.event_type === 'run_completed' &&
      message.event?.run_id === state.run_id
    ), 5000);

    const allEvents = allClient.messages
      .filter((message) => message.type === 'event' && message.event?.run_id === state.run_id)
      .map((message) => message.event);
    const filteredEvents = filteredClient.messages
      .filter((message) => message.type === 'event' && message.event?.run_id === state.run_id)
      .map((message) => message.event);
    const invalidations = allClient.messages.filter((message) => (
      message.type === 'invalidate' && message.resource === '/api/events'
    ));

    if (!existsSync(join(root, '.agentxchain', 'events.jsonl'))) {
      errors.push('events.jsonl missing after run');
    }

    if (allEvents.length === 0) {
      errors.push('bridge did not push any event payloads to the unfiltered client');
    } else {
      if (allEvents[0].event_type !== 'run_started') {
        errors.push(`first WebSocket event should be run_started, got ${allEvents[0].event_type}`);
      }
      if (allEvents[allEvents.length - 1].event_type !== 'run_completed') {
        errors.push(`last WebSocket event should be run_completed, got ${allEvents[allEvents.length - 1].event_type}`);
      }

      const dispatchedIndex = allEvents.findIndex((event) => event.event_type === 'turn_dispatched');
      const acceptedIndex = allEvents.findIndex((event) => event.event_type === 'turn_accepted');
      if (dispatchedIndex === -1 || acceptedIndex === -1) {
        errors.push('expected turn_dispatched and turn_accepted in WebSocket event stream');
      } else if (dispatchedIndex > acceptedIndex) {
        errors.push('turn_accepted arrived before turn_dispatched in WebSocket event stream');
      }

      const runIds = new Set(allEvents.map((event) => event.run_id).filter(Boolean));
      if (runIds.size !== 1 || !runIds.has(state.run_id)) {
        errors.push(`unfiltered client saw unexpected run_ids: ${[...runIds].join(', ')}`);
      }
    }

    if (filteredEvents.length !== 1 || filteredEvents[0]?.event_type !== 'run_completed') {
      errors.push(`filtered client should receive exactly one run_completed event, got ${filteredEvents.map((event) => event.event_type).join(', ') || 'none'}`);
    }

    if (invalidations.length === 0) {
      errors.push('unfiltered client did not receive any /api/events invalidation messages');
    }

    const payload = buildPayload({
      result: errors.length === 0 ? 'pass' : 'fail',
      errors,
      traces,
      artifacts: {
        run_id: state.run_id,
        all_event_count: allEvents.length,
        all_event_types: allEvents.map((event) => event.event_type),
        filtered_event_types: filteredEvents.map((event) => event.event_type),
        invalidate_count: invalidations.length,
      },
    });
    printPayload(payload);
    process.exitCode = errors.length === 0 ? 0 : 1;
  } catch (error) {
    const payload = buildPayload({
      result: 'fail',
      errors: [...errors, error.message],
      traces,
      artifacts: null,
    });
    printPayload(payload);
    process.exitCode = 1;
  } finally {
    try { filteredClient?.close(); } catch {}
    try { allClient?.close(); } catch {}
    try { await bridge?.stop(); } catch {}
    rmSync(root, { recursive: true, force: true });
  }
}

await main();
