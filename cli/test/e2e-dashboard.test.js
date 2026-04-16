/**
 * Dashboard end-to-end acceptance tests.
 *
 * Proves the bridge -> API -> pure render pipeline against realistic
 * .agentxchain/ fixture data for the v2 dashboard baseline.
 */

import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createBridgeServer } from '../src/lib/dashboard/bridge-server.js';
import { render as renderBlocked } from '../dashboard/components/blocked.js';
import { render as renderGate } from '../dashboard/components/gate.js';
import { render as renderHooks } from '../dashboard/components/hooks.js';
import { filterEntries, render as renderLedger } from '../dashboard/components/ledger.js';
import { render as renderTimeline } from '../dashboard/components/timeline.js';
import { render as renderInitiative } from '../dashboard/components/initiative.js';
import { render as renderCrossRepo } from '../dashboard/components/cross-repo.js';

const DASHBOARD_DIR = fileURLToPath(new URL('../dashboard', import.meta.url));

function tmpRoot() {
  const dir = join(tmpdir(), `axc-e2e-dashboard-${randomBytes(6).toString('hex')}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeJson(filePath, data) {
  writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function writeJsonl(filePath, rows) {
  const content = rows.map((row) => JSON.stringify(row)).join('\n');
  writeFileSync(filePath, content ? `${content}\n` : '');
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

function decodeServerTextFrame(data) {
  if (!Buffer.isBuffer(data) || data.length < 2) return null;

  const opcode = data[0] & 0x0f;
  if (opcode !== 1) return null;

  let payloadLen = data[1] & 0x7f;
  let offset = 2;

  if (payloadLen === 126) {
    if (data.length < 4) return null;
    payloadLen = data.readUInt16BE(2);
    offset = 4;
  } else if (payloadLen === 127) {
    if (data.length < 10) return null;
    payloadLen = Number(data.readBigUInt64BE(2));
    offset = 10;
  }

  if (data.length < offset + payloadLen) return null;
  return data.slice(offset, offset + payloadLen).toString('utf8');
}

function httpRequest(port, path, { method = 'GET', headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(`http://127.0.0.1:${port}${path}`, { method, headers }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.setTimeout(5000, () => {
      req.destroy();
      reject(new Error(`timeout for ${method} ${path}`));
    });
    req.end(body);
  });
}

async function getJson(port, path) {
  const res = await httpRequest(port, path);
  assert.equal(res.status, 200, `expected 200 for ${path}`);
  return JSON.parse(res.body);
}

function baseState() {
  return {
    schema_version: '1.1',
    run_id: 'run_dashboard_e2e',
    status: 'running',
    phase: 'development',
    active_turns: {
      t4: {
        turn_id: 'turn_004',
        role: 'qa',
        status: 'assigned',
      },
    },
  };
}

function writeGovernedRepo(root, projectId, runId, status = 'active') {
  mkdirSync(root, { recursive: true });
  mkdirSync(join(root, '.agentxchain'), { recursive: true });

  writeJson(join(root, 'agentxchain.json'), {
    schema_version: '1.0',
    template: 'generic',
    project: { id: projectId, name: projectId, default_branch: 'main' },
    roles: {
      dev: {
        title: 'Developer',
        mandate: 'Implement safely.',
        write_authority: 'authoritative',
        runtime: 'local-dev',
      },
    },
    runtimes: {
      'local-dev': {
        type: 'local_cli',
        command: ['echo', '{prompt}'],
        prompt_transport: 'argv',
      },
    },
    routing: {
      implementation: {
        entry_role: 'dev',
        allowed_next_roles: ['dev', 'human'],
      },
      qa: {
        entry_role: 'dev',
        allowed_next_roles: ['dev', 'human'],
      },
    },
    gates: {},
  });

  writeJson(join(root, '.agentxchain', 'state.json'), {
    schema_version: '1.1',
    project_id: projectId,
    run_id: runId,
    status,
    phase: 'implementation',
    active_turns: {},
    turn_sequence: 0,
    accepted_count: 0,
    rejected_count: 0,
    blocked_on: null,
    blocked_reason: null,
    next_recommended_role: null,
  });
}

function blockedState() {
  return {
    ...baseState(),
    status: 'blocked',
    blocked_on: 'validator:turn-result',
    blocked_reason: {
      category: 'verification_error',
      turn_id: 'turn_004',
      recovery: {
        typed_reason: 'verification_error',
        owner: 'human',
        recovery_action: 'agentxchain step --resume',
        turn_retained: true,
        detail: 'Validation failed for turn_004',
      },
    },
  };
}

function gateState() {
  return {
    ...baseState(),
    status: 'paused',
    pending_phase_transition: {
      from: 'development',
      to: 'qa',
      gate: 'qa-readiness',
      requested_by_turn: 'turn_003',
      evidence: 'QA objections cleared except refresh-token coverage',
    },
  };
}

function fixtureData() {
  return {
    history: [
      {
        turn_id: 'turn_001',
        role: 'pm',
        summary: 'Defined auth middleware scope and requested development',
        observed_artifact: { files_changed: ['docs/spec.md'] },
        decisions: [{ id: 'DEC-001', statement: 'JWT required' }],
        objections: [{ id: 'OBJ-001', severity: 'medium', statement: 'Refresh flow unspecified' }],
        risks: [{ statement: 'Auth expiry edge cases' }],
        phase_transition_request: 'development',
      },
      {
        turn_id: 'turn_002',
        role: 'dev',
        summary: 'Implemented RS256 auth flow',
        observed_artifact: { files_changed: ['src/auth.ts', 'src/auth.test.ts'] },
        decisions: [{ id: 'DEC-002', statement: 'Use RS256 for key rotation' }],
        objections: [{ id: 'OBJ-002', severity: 'high', statement: 'QA needs refresh coverage' }],
        risks: [{ statement: 'Token revocation path deferred' }],
      },
      {
        turn_id: 'turn_003',
        role: 'dev',
        summary: 'Added refresh-token coverage and requested QA review',
        observed_artifact: { files_changed: ['src/refresh.ts', 'src/refresh.test.ts'] },
        decisions: [{ id: 'DEC-003', statement: 'Gate QA on refresh-token coverage' }],
        objections: [{ id: 'OBJ-003', severity: 'medium', statement: 'Manual token expiry testing still needed' }],
        risks: [{ statement: 'Refresh-token migration path deferred' }],
      },
    ],
    ledger: [
      { turn: 1, agent: 'pm', decision: 'JWT required for all private routes' },
      { turn: 2, agent: 'dev', decision: 'Use RS256 for key rotation' },
      { turn: 3, agent: 'qa', decision: 'Do not ship without refresh-token coverage' },
    ],
    audit: [
      { timestamp: '2026-04-02T12:00:00Z', hook_phase: 'before_validation', hook_name: 'lint', verdict: 'allow', orchestrator_action: 'continued', duration_ms: 120 },
      { timestamp: '2026-04-02T12:00:01Z', hook_phase: 'before_validation', hook_name: 'schema-check', verdict: 'allow', orchestrator_action: 'continued', duration_ms: 60 },
      { timestamp: '2026-04-02T12:00:02Z', hook_phase: 'after_validation', hook_name: 'policy', verdict: 'warn', orchestrator_action: 'warned', duration_ms: 25 },
      { timestamp: '2026-04-02T12:00:03Z', hook_phase: 'before_acceptance', hook_name: 'sast', verdict: 'allow', orchestrator_action: 'continued', duration_ms: 410 },
      { timestamp: '2026-04-02T12:00:04Z', hook_phase: 'before_gate', hook_name: 'release-guard', verdict: 'block', orchestrator_action: 'blocked', duration_ms: 95 },
    ],
    annotations: [
      { turn_id: 'turn_003', hook_name: 'policy', annotations: [{ key: 'schema', value: 'normalized to v1.1 contract' }] },
      { turn_id: 'turn_003', hook_name: 'sast', annotations: [{ key: 'sast', value: 'clean on modified files' }] },
    ],
  };
}

function writeFixture(agentxchainDir, state) {
  const data = fixtureData();
  writeJson(join(agentxchainDir, 'state.json'), state);
  writeJson(join(agentxchainDir, 'session.json'), {
    session_id: 'session_dashboard_e2e',
    run_id: state.run_id,
    checkpoint_reason: 'turn_accepted',
    last_checkpoint_at: '2026-04-09T22:00:00Z',
    last_turn_id: 'turn_003',
    last_role: 'dev',
  });
  writeFileSync(join(agentxchainDir, 'SESSION_RECOVERY.md'), '# Session Recovery Report\n');
  writeJsonl(join(agentxchainDir, 'history.jsonl'), data.history);
  writeJsonl(join(agentxchainDir, 'decision-ledger.jsonl'), data.ledger);
  writeJsonl(join(agentxchainDir, 'hook-audit.jsonl'), data.audit);
  writeJsonl(join(agentxchainDir, 'hook-annotations.jsonl'), data.annotations);
  return data;
}

function coordinatorFixture() {
  return {
    state: {
      super_run_id: 'srun_dashboard_e2e',
      status: 'paused',
      phase: 'implementation',
      pending_gate: {
        gate_type: 'phase_transition',
        gate: 'phase_transition:implementation->qa',
        from: 'implementation',
        to: 'qa',
        required_repos: ['api', 'web'],
      },
      repo_runs: {
        api: { run_id: 'run_api_dashboard', status: 'linked', phase: 'implementation' },
        web: { run_id: 'run_web_dashboard', status: 'initialized', phase: 'implementation' },
      },
    },
    history: [
      { type: 'run_initialized', timestamp: '2026-04-02T12:00:00Z', repo_runs: { api: {}, web: {} } },
      { type: 'turn_dispatched', timestamp: '2026-04-02T12:01:00Z', repo_id: 'api', workstream_id: 'backend', repo_turn_id: 'turn_api_001', role: 'dev', context_ref: 'ctx_api_001' },
      { type: 'acceptance_projection', timestamp: '2026-04-02T12:02:00Z', repo_id: 'api', workstream_id: 'backend', repo_turn_id: 'turn_api_001', summary: 'API integration accepted', files_changed: ['api/src/index.ts'], decisions: [{ statement: 'Promote shared schema' }] },
      { type: 'context_generated', timestamp: '2026-04-02T12:03:00Z', target_repo_id: 'web', workstream_id: 'frontend', upstream_repo_ids: ['api'] },
      { type: 'phase_transition_requested', timestamp: '2026-04-02T12:04:00Z', gate: 'phase_transition:implementation->qa', from: 'implementation', to: 'qa', required_repos: ['api', 'web'] },
    ],
    ledger: [
      { turn: 'coord-1', role: 'architect', decision: 'Freeze shared API schema', timestamp: '2026-04-02T12:00:30Z' },
      { turn: 'coord-2', role: 'pm', decision: 'Approve integration handoff', timestamp: '2026-04-02T12:03:30Z' },
    ],
    barriers: {
      backend_completion: {
        workstream_id: 'backend',
        type: 'all_repos_accepted',
        status: 'partially_satisfied',
        required_repos: ['api', 'web'],
        satisfied_repos: ['api'],
      },
    },
    barrierLedger: [
      { type: 'barrier_transition', barrier_id: 'backend_completion', previous_status: 'pending', new_status: 'partially_satisfied' },
    ],
    audit: [
      { hook_phase: 'before_gate', hook_name: 'release-guard', verdict: 'allow', orchestrator_action: 'continued', duration_ms: 33 },
    ],
  };
}

function coordinatorConfigFixture() {
  return {
    schema_version: '0.1',
    project: {
      id: 'dashboard-coordinator',
      name: 'Dashboard Coordinator',
    },
    repos: {
      api: { path: './repos/api', default_branch: 'main', required: true },
      web: { path: './repos/web', default_branch: 'main', required: true },
    },
    workstreams: {
      implementation_build: {
        phase: 'implementation',
        repos: ['api', 'web'],
        entry_repo: 'api',
        depends_on: [],
        completion_barrier: 'all_repos_accepted',
      },
      qa_release: {
        phase: 'qa',
        repos: ['api', 'web'],
        entry_repo: 'web',
        depends_on: ['implementation_build'],
        completion_barrier: 'all_repos_accepted',
      },
    },
    routing: {
      implementation: { entry_workstream: 'implementation_build' },
      qa: { entry_workstream: 'qa_release' },
    },
    gates: {
      initiative_ship: {
        requires_human_approval: true,
        requires_repos: ['api', 'web'],
      },
    },
  };
}

function writeCoordinatorFixture(agentxchainDir) {
  const multiDir = join(agentxchainDir, 'multirepo');
  const workspaceDir = join(agentxchainDir, '..');
  const data = coordinatorFixture();
  mkdirSync(multiDir, { recursive: true });
  writeGovernedRepo(join(workspaceDir, 'repos', 'api'), 'api', 'run_api_dashboard');
  writeGovernedRepo(join(workspaceDir, 'repos', 'web'), 'web', 'run_web_dashboard');
  writeJson(join(workspaceDir, 'agentxchain-multi.json'), coordinatorConfigFixture());
  writeJson(join(multiDir, 'state.json'), data.state);
  writeJsonl(join(multiDir, 'history.jsonl'), data.history);
  writeJsonl(join(multiDir, 'decision-ledger.jsonl'), data.ledger);
  writeJson(join(multiDir, 'barriers.json'), data.barriers);
  writeJsonl(join(multiDir, 'barrier-ledger.jsonl'), data.barrierLedger);
  writeJsonl(join(multiDir, 'hook-audit.jsonl'), data.audit);
  return data;
}

async function waitForInvalidation(port, mutateFile, timeoutMs = 1000) {
  return new Promise((resolve, reject) => {
    const key = randomBytes(16).toString('base64');
    const timeout = setTimeout(() => reject(new Error('No WebSocket invalidation within timeout')), timeoutMs);
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

      socket.on('data', (data) => {
        const payload = decodeServerTextFrame(data);
        if (!payload) return;
        const message = JSON.parse(payload);
        if (message.resource === '/api/state') {
          clearTimeout(timeout);
          socket.destroy();
          resolve(message);
        }
      });

      setTimeout(mutateFile, 100);
    });

    req.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    req.end();
  });
}

describe('Dashboard E2E acceptance', () => {
  let root;
  let agentxchainDir;
  let bridge;
  let port;

  before(async () => {
    root = tmpRoot();
    agentxchainDir = join(root, '.agentxchain');
    mkdirSync(agentxchainDir, { recursive: true });
    writeFixture(agentxchainDir, baseState());

    bridge = createBridgeServer({
      agentxchainDir,
      dashboardDir: DASHBOARD_DIR,
      port: 0,
    });

    ({ port } = await bridge.start());
  });

  after(async () => {
    await bridge.stop();
    rmSync(root, { recursive: true, force: true });
  });

  it('AT-DASH-001 timeline renders from governed state files', async () => {
    writeFixture(agentxchainDir, baseState());
    const state = await getJson(port, '/api/state');
    const continuity = await getJson(port, '/api/continuity');
    const history = await getJson(port, '/api/history');
    const html = renderTimeline({ state, continuity, history });

    assert.ok(html.includes('run_dashboard_e2e'));
    assert.ok(html.includes('3 turns completed'));
    assert.ok(html.includes('Continuity'));
    assert.ok(html.includes('session_dashboard_e2e'));
    assert.ok(html.includes('agentxchain restart'));
    assert.ok(html.includes('.agentxchain/SESSION_RECOVERY.md'));
    assert.ok(html.includes('turn_004'));
    assert.ok(html.includes('Defined auth middleware scope and requested development'));
    assert.ok(html.includes('Implemented RS256 auth flow'));
    assert.ok(html.includes('Added refresh-token coverage and requested QA review'));
  });

  it('AT-DASH-002 pushes live invalidation within one second', async () => {
    writeFixture(agentxchainDir, baseState());
    const message = await waitForInvalidation(port, () => {
      writeJson(join(agentxchainDir, 'state.json'), {
        ...baseState(),
        status: 'paused',
      });
    });

    assert.equal(message.type, 'invalidate');
    assert.equal(message.resource, '/api/state');
  });

  it('AT-DASH-003 surfaces the exact phase-transition CLI action', async () => {
    // Settle after AT-DASH-002's WebSocket test — the file watcher debounce timer
    // (100ms) may still be pending from the prior test's state.json mutation.
    // Without this, the debounce callback fires mid-request under full-suite load
    // and can delay HTTP responses enough to cause intermittent failures.
    await new Promise((r) => setTimeout(r, 150));
    writeFixture(agentxchainDir, gateState());
    const state = await getJson(port, '/api/state');
    const history = await getJson(port, '/api/history');
    const html = renderGate({ state, history });

    assert.ok(html.includes('Phase Transition Gate'));
    assert.ok(html.includes('qa-readiness'));
    assert.ok(html.includes('Implemented RS256 auth flow'));
    assert.ok(html.includes('Added refresh-token coverage and requested QA review'));
    assert.ok(html.includes('QA needs refresh coverage'));
    assert.ok(html.includes('Manual token expiry testing still needed'));
    assert.ok(html.includes('2 turns'));
    assert.ok(html.includes('data-dashboard-action="approve-gate"'));
    assert.ok(html.includes('agentxchain approve-transition'));
    assert.ok(!html.includes('Defined auth middleware scope and requested development'));
  });

  it('AT-DASH-004 renders blocked reason and recovery descriptor', async () => {
    writeFixture(agentxchainDir, blockedState());
    const state = await getJson(port, '/api/state');
    const audit = await getJson(port, '/api/hooks/audit');
    const html = renderBlocked({ state, audit });

    assert.ok(html.includes('Validation failed for turn_004'));
    assert.ok(html.includes('validator:turn-result'));
    assert.ok(html.includes('agentxchain step --resume'));
    assert.ok(html.includes('Recent Audit Context'));
    assert.ok(html.includes('before_validation'));
    assert.ok(html.includes('schema-check'));
  });

  it('AT-DASH-005 renders hook audit entries and annotations', async () => {
    writeFixture(agentxchainDir, baseState());
    const audit = await getJson(port, '/api/hooks/audit');
    const annotations = await getJson(port, '/api/hooks/annotations');
    const html = renderHooks({ audit, annotations });

    assert.ok(html.includes('5 hook executions'));
    assert.ok(html.includes('release-guard'));
    assert.ok(html.includes('sast: clean on modified files'));
  });

  it('AT-DASH-006 filters ledger entries by agent role', async () => {
    writeFixture(agentxchainDir, baseState());
    const ledger = await getJson(port, '/api/ledger');
    const filtered = filterEntries(ledger, { agent: 'qa' });
    const html = renderLedger({ ledger, filter: { agent: 'qa', query: '' } });

    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].agent, 'qa');
    assert.ok(html.includes('Do not ship without refresh-token coverage'));
    assert.ok(!html.includes('Use RS256 for key rotation'));
  });

  it('AT-DASH-007 binds the bridge server to localhost only', () => {
    const address = bridge.server.address();
    assert.equal(address.address, '127.0.0.1');
  });

  it('AT-DASH-ACT-001/AT-DASH-ACT-003: approves a pending repo gate through the authenticated bridge action', async () => {
    writeFixture(agentxchainDir, gateState());
    const sessionRes = await httpRequest(port, '/api/session');
    assert.equal(sessionRes.status, 200);
    const session = JSON.parse(sessionRes.body);
    assert.equal(typeof session.session_version, 'string');
    assert.equal(typeof session.mutation_token, 'string');
    assert.equal(session.capabilities?.approve_gate, true);

    const res = await httpRequest(port, '/api/actions/approve-gate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-AgentXchain-Token': session.mutation_token,
      },
      body: '{}',
    });

    assert.equal(res.status, 200);
    const payload = JSON.parse(res.body);
    assert.equal(payload.ok, true);
    assert.equal(payload.scope, 'repo');
    assert.equal(payload.gate_type, 'phase_transition');

    const state = await getJson(port, '/api/state');
    assert.equal(state.pending_phase_transition, null);
    assert.equal(state.phase, 'qa');
    assert.equal(state.status, 'active');
  });

  it('AT-DASH-ACT-002/AT-DASH-ACT-007: rejects action requests without the session token and keeps websocket read-only', async () => {
    const res = await httpRequest(port, '/api/actions/approve-gate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    assert.equal(res.status, 403);
    assert.match(res.body, /invalid_token/i);

    const wsMessage = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('No WebSocket rejection within timeout')), 1000);
      const key = randomBytes(16).toString('base64');
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

        socket.on('data', (data) => {
          const payload = decodeServerTextFrame(data);
          if (!payload) return;
          clearTimeout(timeout);
          socket.destroy();
          resolve(JSON.parse(payload));
        });

        socket.write(createMaskedTextFrame(JSON.stringify({ action: 'approve-transition' })));
      });

      req.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });

      req.end();
    });

    assert.equal(wsMessage.type, 'error');
    assert.match(wsMessage.error, /read-only/i);
    assert.match(wsMessage.error, /approve-gate/i);
  });

  it('AT-DASH-MR-001 renders coordinator initiative and cross-repo timeline from multirepo files', async () => {
    writeFixture(agentxchainDir, baseState());
    writeCoordinatorFixture(agentxchainDir);

    const coordinatorState = await getJson(port, '/api/coordinator/state');
    const coordinatorHistory = await getJson(port, '/api/coordinator/history');
    const coordinatorBarriers = await getJson(port, '/api/coordinator/barriers');
    const barrierLedger = await getJson(port, '/api/coordinator/barrier-ledger');
    const coordinatorBlockers = await getJson(port, '/api/coordinator/blockers');
    const coordinatorRepoStatusRows = await getJson(port, '/api/coordinator/repo-status');

    const initiativeHtml = renderInitiative({
      coordinatorState,
      coordinatorBarriers,
      barrierLedger,
      coordinatorBlockers,
      coordinatorRepoStatusRows,
    });
    const timelineHtml = renderCrossRepo({ coordinatorState, coordinatorHistory });
    const primaryCommand = coordinatorBlockers.next_actions?.[0]?.command;

    assert.ok(initiativeHtml.includes('srun_dashboard_e2e'));
    assert.equal(primaryCommand, 'agentxchain multi approve-gate');
    assert.ok(initiativeHtml.includes(primaryCommand));
    assert.ok(!initiativeHtml.includes('agentxchain multi resync'));
    assert.ok(initiativeHtml.includes('Approval Snapshot'));
    assert.ok(initiativeHtml.includes('Required Repos'));
    assert.ok(!initiativeHtml.includes('Pending Gate'));
    assert.ok(initiativeHtml.includes('Open Blockers view'));
    assert.ok(initiativeHtml.includes('coordinator'));
    assert.ok(initiativeHtml.includes('backend_completion'));
    assert.ok(timelineHtml.includes('Turn Dispatched'));
    assert.ok(timelineHtml.includes('Context Generated'));
  });

  it('AT-DASH-MR-002 renders coordinator gate and blocked panels from multirepo files', async () => {
    writeFixture(agentxchainDir, baseState());
    const fixture = writeCoordinatorFixture(agentxchainDir);
    fixture.state.status = 'blocked';
    fixture.state.blocked_reason = 'coordinator_hook_violation';
    writeJson(join(agentxchainDir, 'multirepo', 'state.json'), fixture.state);

    const coordinatorState = await getJson(port, '/api/coordinator/state');
    const coordinatorHistory = await getJson(port, '/api/coordinator/history');
    const coordinatorBarriers = await getJson(port, '/api/coordinator/barriers');
    const coordinatorAudit = await getJson(port, '/api/coordinator/hooks/audit');
    const coordinatorRepoStatusRows = await getJson(port, '/api/coordinator/repo-status');

    const gateHtml = renderGate({ state: null, coordinatorState, coordinatorHistory, coordinatorBarriers });
    const blockedHtml = renderBlocked({ state: null, coordinatorState, coordinatorAudit, coordinatorRepoStatusRows });

    assert.ok(gateHtml.includes('agentxchain multi approve-gate'));
    assert.ok(gateHtml.includes('API integration accepted'));
    assert.ok(blockedHtml.includes('coordinator_hook_violation'));
    assert.ok(blockedHtml.includes('Approval State'));
    assert.ok(blockedHtml.includes('Awaiting human approval'));
    assert.ok(blockedHtml.includes('Required Repos'));
    assert.ok(blockedHtml.includes('coordinator: linked'));
    assert.ok(blockedHtml.includes('release-guard'));
  });

  it('AT-DASH-MR-003 renders coordinator decisions in the shared Decisions view', async () => {
    writeCoordinatorFixture(agentxchainDir);

    const coordinatorState = await getJson(port, '/api/coordinator/state');
    const coordinatorLedger = await getJson(port, '/api/coordinator/ledger');

    const ledgerHtml = renderLedger({
      state: null,
      ledger: null,
      coordinatorState,
      coordinatorLedger,
      filter: { agent: 'all', query: '' },
    });

    assert.ok(ledgerHtml.includes('Coordinator Decision Ledger'));
    assert.ok(ledgerHtml.includes('Freeze shared API schema'));
    assert.ok(ledgerHtml.includes('Approve integration handoff'));
  });
});
