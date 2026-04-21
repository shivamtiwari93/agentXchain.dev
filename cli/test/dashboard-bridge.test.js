/**
 * Dashboard bridge server tests — Slice 1
 *
 * Tests the HTTP bridge server's local bridge contract: read endpoints,
 * authenticated approve-gate HTTP mutation, read-only WebSocket invalidation,
 * and localhost-only security constraints.
 *
 * See: DASHBOARD_GATE_ACTIONS_SPEC.md, AT-DASH-ACT-001 through AT-DASH-ACT-007.
 */

import { describe, it, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, chmodSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createHash, randomBytes } from 'crypto';
import http from 'http';

import { createBridgeServer } from '../src/lib/dashboard/bridge-server.js';
import { loadProjectContext } from '../src/lib/config.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

function tmpDir() {
  const dir = join(tmpdir(), `axc-dash-test-${randomBytes(6).toString('hex')}`);
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

function httpRequest(port, path, { method = 'GET', headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(`http://127.0.0.1:${port}${path}`, { method, headers }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    });
    req.on('error', reject);
    req.setTimeout(5000, () => { req.destroy(); reject(new Error('timeout')); });
    req.end(body);
  });
}

function writeJson(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
}

function writeGovernedRepo(root, projectId) {
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

  writeJson(join(root, '.agentxchain/state.json'), {
    schema_version: '1.1',
    project_id: projectId,
    run_id: null,
    status: 'idle',
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

function readNotificationAudit(root) {
  const filePath = join(root, '.agentxchain', 'notification-audit.jsonl');
  if (!existsSync(filePath)) return [];
  return readFileSync(filePath, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function createDashboardPollFixture({ governed = true, withState = true, pendingApproval = false } = {}) {
  const root = tmpDir();
  const axcDir = join(root, '.agentxchain');
  const dashDir = join(root, 'dashboard');
  mkdirSync(axcDir, { recursive: true });
  mkdirSync(dashDir, { recursive: true });
  writeFileSync(join(dashDir, 'index.html'), '<html><body>Dashboard</body></html>');

  if (governed) {
    writeJson(join(root, 'agentxchain.json'), {
      schema_version: '1.0',
      protocol_mode: 'governed',
      template: 'generic',
      project: {
        id: 'dashboard-poll',
        name: 'Dashboard Poll',
        default_branch: 'main',
      },
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
      notifications: pendingApproval ? {
        webhooks: [
          {
            name: 'ops_webhook',
            url: 'http://127.0.0.1:9/webhook',
            events: ['approval_sla_reminder'],
            timeout_ms: 250,
          },
        ],
        approval_sla: {
          reminder_after_seconds: [300],
        },
      } : undefined,
    });
  }

  if (governed && withState) {
    writeJson(join(axcDir, 'state.json'), pendingApproval ? {
      schema_version: '1.0',
      project_id: 'dashboard-poll',
      run_id: 'run_dashboard_poll',
      status: 'paused',
      phase: 'implementation',
      current_turn: null,
      last_completed_turn_id: 'turn_001',
      blocked_on: null,
      blocked_reason: null,
      pending_phase_transition: {
        from: 'implementation',
        to: 'qa',
        gate: 'require_approval',
        requested_by_turn: 'turn_001',
        requested_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
      },
      pending_run_completion: null,
    } : {
      schema_version: '1.1',
      project_id: 'dashboard-poll',
      run_id: 'run_dashboard_poll',
      status: 'idle',
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

  return { root, axcDir, dashDir };
}

function buildCoordinatorConfig() {
  return {
    schema_version: '0.1',
    project: { id: 'test-project', name: 'Test Project' },
    repos: {
      web: { path: './repos/web', default_branch: 'main', required: true },
      api: { path: './repos/api', default_branch: 'main', required: true },
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

function buildCoordinatorConfigWithBlockingGateHook() {
  const config = buildCoordinatorConfig();
  config.hooks = {
    before_gate: [
      {
        name: 'release-guard',
        type: 'process',
        command: ['./hooks/block-gate.sh'],
        timeout_ms: 5000,
        mode: 'blocking',
      },
    ],
  };
  return config;
}

function createTestFixture() {
  const root = tmpDir();
  const axcDir = join(root, '.agentxchain');
  const multiDir = join(axcDir, 'multirepo');
  const reportsDir = join(axcDir, 'reports');
  const dashDir = join(root, 'dashboard');
  const reposDir = join(root, 'repos');
  mkdirSync(axcDir, { recursive: true });
  mkdirSync(multiDir, { recursive: true });
  mkdirSync(reportsDir, { recursive: true });
  mkdirSync(dashDir, { recursive: true });
  mkdirSync(reposDir, { recursive: true });

  writeJson(join(root, 'agentxchain.json'), {
    schema_version: '1.0',
    template: 'generic',
    project: { id: 'dashboard-root', name: 'Dashboard Root', default_branch: 'main' },
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
  writeJson(join(root, 'agentxchain-multi.json'), buildCoordinatorConfig());

  writeGovernedRepo(join(reposDir, 'api'), 'api');
  writeGovernedRepo(join(reposDir, 'web'), 'web');

  // State file
  writeJson(join(axcDir, 'state.json'), {
    schema_version: '1.1',
    run_id: 'run_test_001',
    status: 'running',
    phase: 'development',
    turns: [{ turn_id: 'turn_001', role: 'pm', status: 'accepted' }],
  });
  writeJson(join(axcDir, 'session.json'), {
    session_id: 'session_test_001',
    run_id: 'run_test_001',
    checkpoint_reason: 'turn_accepted',
    last_checkpoint_at: '2026-04-09T22:00:00Z',
    last_turn_id: 'turn_001',
    last_role: 'pm',
  });
  writeFileSync(join(axcDir, 'SESSION_RECOVERY.md'), '# Session Recovery Report\n');

  // History
  writeFileSync(join(axcDir, 'history.jsonl'),
    JSON.stringify({ turn_id: 'turn_001', role: 'pm', summary: 'Defined scope' }) + '\n'
  );

  // Decision ledger
  writeFileSync(join(axcDir, 'decision-ledger.jsonl'),
    JSON.stringify({ turn: 1, agent: 'pm', decision: 'Auth middleware with JWT' }) + '\n' +
    JSON.stringify({ turn: 2, agent: 'dev', decision: 'Chose RS256 over HS256' }) + '\n'
  );

  // Hook audit
  writeFileSync(join(axcDir, 'hook-audit.jsonl'),
    JSON.stringify({ phase: 'before_validation', hook: 'lint', verdict: 'allow', duration_ms: 120 }) + '\n'
  );

  // Hook annotations
  writeFileSync(join(axcDir, 'hook-annotations.jsonl'),
    JSON.stringify({ phase: 'after_acceptance', annotation: 'SAST clean' }) + '\n'
  );

  writeJson(join(multiDir, 'state.json'), {
    super_run_id: 'srun_test_001',
    status: 'paused',
    phase: 'integration',
    pending_gate: {
      gate_type: 'phase_transition',
      gate: 'phase_transition:integration->release',
      from: 'integration',
      to: 'release',
      required_repos: ['api', 'web'],
    },
    repo_runs: {
      api: { run_id: 'run_api_001', status: 'linked', phase: 'integration' },
        web: { run_id: 'run_web_001', status: 'initialized', phase: 'integration' },
      },
  });
  writeFileSync(join(multiDir, 'history.jsonl'),
    JSON.stringify({ type: 'turn_dispatched', repo_id: 'api', workstream_id: 'backend', repo_turn_id: 'turn_api_001' }) + '\n' +
    JSON.stringify({ type: 'acceptance_projection', repo_id: 'api', workstream_id: 'backend', summary: 'API accepted', repo_turn_id: 'turn_api_001' }) + '\n'
  );
  writeFileSync(join(multiDir, 'decision-ledger.jsonl'),
    JSON.stringify({ turn: 'coord_001', role: 'architect', decision: 'Freeze integration boundary', timestamp: '2026-04-12T12:00:00Z' }) + '\n' +
    JSON.stringify({ turn: 'coord_002', role: 'pm', decision: 'Escalate gate approval', timestamp: '2026-04-12T12:05:00Z' }) + '\n'
  );
  writeJson(join(multiDir, 'barriers.json'), {
    backend_completion: {
      workstream_id: 'backend',
      type: 'all_repos_accepted',
      status: 'partially_satisfied',
      required_repos: ['api', 'web'],
      satisfied_repos: ['api'],
    },
  });
  writeFileSync(join(multiDir, 'barrier-ledger.jsonl'),
    JSON.stringify({ type: 'barrier_transition', barrier_id: 'backend_completion', previous_status: 'pending', new_status: 'partially_satisfied' }) + '\n'
  );
  writeFileSync(join(multiDir, 'hook-audit.jsonl'),
    JSON.stringify({ phase: 'before_gate', hook: 'release-guard', verdict: 'allow', duration_ms: 42 }) + '\n'
  );

  // Dashboard HTML
  writeFileSync(join(dashDir, 'index.html'), '<html><body>Dashboard</body></html>');
  writeFileSync(join(dashDir, 'app.js'), 'console.log("dashboard")');

  writeJson(join(reportsDir, 'chain-old.json'), {
    chain_id: 'chain_old',
    started_at: '2026-04-15T20:00:00.000Z',
    completed_at: '2026-04-15T20:05:00.000Z',
    terminal_reason: 'completed',
    total_turns: 3,
    total_duration_ms: 300000,
    runs: [
      {
        run_id: 'run_old_001',
        status: 'completed',
        provenance_trigger: 'manual',
        turns: 3,
        duration_ms: 300000,
        parent_run_id: null,
        inherited_context_summary: null,
      },
    ],
  });
  writeJson(join(reportsDir, 'chain-new.json'), {
    chain_id: 'chain_new',
    started_at: '2026-04-16T20:00:00.000Z',
    completed_at: '2026-04-16T20:09:00.000Z',
    terminal_reason: 'chain_limit_reached',
    total_turns: 9,
    total_duration_ms: 540000,
    runs: [
      {
        run_id: 'run_new_001',
        status: 'completed',
        provenance_trigger: 'manual',
        turns: 3,
        duration_ms: 120000,
        parent_run_id: null,
        inherited_context_summary: null,
      },
      {
        run_id: 'run_new_002',
        status: 'completed',
        provenance_trigger: 'continue',
        turns: 3,
        duration_ms: 180000,
        parent_run_id: 'run_new_001',
        inherited_context_summary: {
          parent_roles_used: ['pm', 'dev'],
          parent_phases_completed_count: 2,
          recent_decisions_count: 4,
          recent_accepted_turns_count: 3,
        },
      },
    ],
  });

  return { root, axcDir, multiDir, dashDir, reposDir };
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

function createServerTextFrame(text) {
  const payload = Buffer.from(text, 'utf8');
  const len = payload.length;
  let header;

  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x81;
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }

  return Buffer.concat([header, payload]);
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

// ── Tests ───────────────────────────────────────────────────────────────────

describe('Dashboard Bridge Server', () => {
  let fixture;
  let bridge;
  let port;

  before(async () => {
    fixture = createTestFixture();
    bridge = createBridgeServer({
      agentxchainDir: fixture.axcDir,
      dashboardDir: fixture.dashDir,
      port: 0, // random available port
    });
    const result = await bridge.start();
    port = result.port;
  });

  after(async () => {
    await bridge.stop();
    rmSync(fixture.root, { recursive: true, force: true });
  });

  // ── API endpoints ──

  describe('API endpoints', () => {
    it('GET /api/state returns state.json content', async () => {
      const res = await httpGet(port, '/api/state');
      assert.equal(res.status, 200);
      const data = JSON.parse(res.body);
      assert.equal(data.run_id, 'run_test_001');
      assert.equal(data.phase, 'development');
    });

    it('GET /api/history returns history.jsonl as array', async () => {
      const res = await httpGet(port, '/api/history');
      assert.equal(res.status, 200);
      const data = JSON.parse(res.body);
      assert.ok(Array.isArray(data));
      assert.equal(data.length, 1);
      assert.equal(data[0].turn_id, 'turn_001');
    });

    it('AT-DASH-CHAIN-001: GET /api/chain-reports returns latest plus newest-first reports', async () => {
      const res = await httpGet(port, '/api/chain-reports');
      assert.equal(res.status, 200);
      const data = JSON.parse(res.body);
      assert.equal(data.latest.chain_id, 'chain_new');
      assert.equal(data.reports.length, 2);
      assert.equal(data.reports[0].chain_id, 'chain_new');
      assert.equal(data.reports[1].chain_id, 'chain_old');
      assert.equal(data.latest.runs[1].parent_run_id, 'run_new_001');
      assert.equal(data.latest.runs[1].inherited_context_summary.recent_decisions_count, 4);
    });

    it('GET /api/continuity returns computed continuity status', async () => {
      const res = await httpGet(port, '/api/continuity');
      assert.equal(res.status, 200);
      const data = JSON.parse(res.body);
      assert.equal(data.checkpoint.session_id, 'session_test_001');
      assert.equal(data.checkpoint.checkpoint_reason, 'turn_accepted');
      assert.equal(data.stale_checkpoint, false);
      assert.equal(data.recovery_report_path, '.agentxchain/SESSION_RECOVERY.md');
      assert.equal(data.restart_recommended, true);
      assert.equal(data.recommended_command, 'agentxchain restart');
      assert.equal(data.recommended_reason, 'restart_available');
      assert.equal(data.recommended_detail, 'rebuild session context from disk');
      assert.equal(data.drift_detected, null);
      assert.deepEqual(data.drift_warnings, []);
      assert.ok(!('session_id' in data), 'continuity endpoint must not expose raw checkpoint fields at the top level');
    });

    it('GET /api/ledger returns decision-ledger.jsonl as array', async () => {
      const res = await httpGet(port, '/api/ledger');
      assert.equal(res.status, 200);
      const data = JSON.parse(res.body);
      assert.ok(Array.isArray(data));
      assert.equal(data.length, 2);
      assert.equal(data[1].agent, 'dev');
    });

    it('GET /api/hooks/audit returns hook-audit.jsonl as array', async () => {
      const res = await httpGet(port, '/api/hooks/audit');
      assert.equal(res.status, 200);
      const data = JSON.parse(res.body);
      assert.ok(Array.isArray(data));
      assert.equal(data.length, 1);
      assert.equal(data[0].verdict, 'allow');
    });

    it('GET /api/hooks/annotations returns hook-annotations.jsonl as array', async () => {
      const res = await httpGet(port, '/api/hooks/annotations');
      assert.equal(res.status, 200);
      const data = JSON.parse(res.body);
      assert.ok(Array.isArray(data));
      assert.equal(data.length, 1);
    });

    it('GET /api/coordinator/state returns multirepo state.json content', async () => {
      const res = await httpGet(port, '/api/coordinator/state');
      assert.equal(res.status, 200);
      const data = JSON.parse(res.body);
      assert.equal(data.super_run_id, 'srun_test_001');
      assert.equal(data.pending_gate.gate_type, 'phase_transition');
    });

    it('AT-RBDAP-001: GET /api/state derives runtime guidance and next actions for blocked governed runs', async () => {
      const localFixture = createTestFixture();
      let localBridge;
      try {
        writeJson(join(localFixture.root, 'agentxchain.json'), {
          schema_version: 4,
          protocol_mode: 'governed',
          template: 'generic',
          project: { id: 'dashboard-runtime-guidance', name: 'Dashboard Runtime Guidance', default_branch: 'main' },
          roles: {
            dev: {
              title: 'Developer',
              mandate: 'Build safely.',
              write_authority: 'proposed',
              runtime: 'remote-dev',
            },
          },
          runtimes: {
            'remote-dev': {
              type: 'api_proxy',
              provider: 'anthropic',
              model: 'claude-haiku-4-5-20251001',
              auth_env: 'ANTHROPIC_API_KEY',
            },
          },
          routing: {
            implementation: {
              entry_role: 'dev',
              allowed_next_roles: ['dev', 'human'],
              exit_gate: 'implementation_complete',
            },
            qa: {
              entry_role: 'dev',
              allowed_next_roles: ['dev', 'human'],
            },
          },
          gates: {
            implementation_complete: {
              requires_files: ['.planning/IMPLEMENTATION_NOTES.md'],
            },
          },
        });

        writeJson(join(localFixture.axcDir, 'state.json'), {
          schema_version: '1.1',
          run_id: 'run_runtime_guidance_001',
          status: 'blocked',
          phase: 'implementation',
          active_turns: {},
          turn_sequence: 1,
          last_completed_turn_id: 'turn_dev_001',
          blocked_on: 'dispatch:awaiting_operator_followup',
          blocked_reason: {
            category: 'dispatch_error',
            turn_id: 'turn_dev_001',
            recovery: {
              typed_reason: 'dispatch_error',
              owner: 'human',
              recovery_action: 'agentxchain step --resume',
              turn_retained: true,
              detail: 'Dispatch paused until required files are materialized.',
            },
          },
          last_gate_failure: {
            gate_type: 'phase_transition',
            gate_id: 'implementation_complete',
            phase: 'implementation',
            requested_by_turn: 'turn_dev_001',
            missing_files: ['.planning/IMPLEMENTATION_NOTES.md'],
          },
        });

        localBridge = createBridgeServer({
          agentxchainDir: localFixture.axcDir,
          dashboardDir: localFixture.dashDir,
          port: 0,
        });
        const started = await localBridge.start();
        const res = await httpGet(started.port, '/api/state');
        assert.equal(res.status, 200);
        const data = JSON.parse(res.body);
        assert.equal(data.runtime_guidance[0].code, 'proposal_apply_required');
        assert.equal(data.runtime_guidance[0].command, 'agentxchain proposal apply turn_dev_001');
        assert.equal(data.next_actions[0].command, 'agentxchain proposal apply turn_dev_001');
        assert.equal(data.next_actions[1].command, 'agentxchain step --resume');
      } finally {
        if (localBridge) {
          await localBridge.stop();
        }
        rmSync(localFixture.root, { recursive: true, force: true });
      }
    });

    it('AT-PROGRESS-009: GET /api/state includes active-turn dispatch progress', async () => {
      const localFixture = createTestFixture();
      let localBridge;
      try {
        writeJson(join(localFixture.root, 'agentxchain.json'), {
          schema_version: 4,
          protocol_mode: 'governed',
          template: 'generic',
          project: { id: 'dashboard-progress', name: 'Dashboard Progress', default_branch: 'main' },
          roles: {
            dev: {
              title: 'Developer',
              mandate: 'Build safely.',
              write_authority: 'authoritative',
              runtime: 'local-dev',
            },
          },
          runtimes: {
            'local-dev': {
              type: 'local_cli',
              command: 'echo ok',
            },
          },
          routing: {
            implementation: {
              entry_role: 'dev',
              allowed_next_roles: ['dev', 'human'],
            },
          },
        });

        writeJson(join(localFixture.axcDir, 'state.json'), {
          schema_version: '1.1',
          run_id: 'run_progress_001',
          status: 'active',
          phase: 'implementation',
          active_turns: {
            turn_progress_001: {
              turn_id: 'turn_progress_001',
              assigned_role: 'dev',
              runtime_id: 'local-dev',
              status: 'running',
              attempt: 1,
              started_at: '2026-04-17T23:00:00.000Z',
            },
          },
          turn_sequence: 1,
        });

        writeJson(join(localFixture.axcDir, 'dispatch-progress-turn_progress_001.json'), {
          turn_id: 'turn_progress_001',
          runtime_id: 'local-dev',
          adapter_type: 'local_cli',
          started_at: '2026-04-17T23:00:00.000Z',
          last_activity_at: '2026-04-17T23:00:05.000Z',
          activity_type: 'output',
          activity_summary: 'Producing output (12 lines)',
          output_lines: 12,
          stderr_lines: 0,
          silent_since: null,
          pid: 12345,
        });

        localBridge = createBridgeServer({
          agentxchainDir: localFixture.axcDir,
          dashboardDir: localFixture.dashDir,
          port: 0,
        });
        const started = await localBridge.start();
        const res = await httpGet(started.port, '/api/state');
        assert.equal(res.status, 200);
        const data = JSON.parse(res.body);
        assert.equal(data.dispatch_progress.turn_progress_001.output_lines, 12);
        assert.equal(data.dispatch_progress.turn_progress_001.activity_type, 'output');
      } finally {
        if (localBridge) {
          await localBridge.stop();
        }
        rmSync(localFixture.root, { recursive: true, force: true });
      }
    });

    it('GET /api/coordinator/ledger returns multirepo decision-ledger.jsonl as array', async () => {
      const res = await httpGet(port, '/api/coordinator/ledger');
      assert.equal(res.status, 200);
      const data = JSON.parse(res.body);
      assert.ok(Array.isArray(data));
      assert.equal(data.length, 2);
      assert.equal(data[0].decision, 'Freeze integration boundary');
      assert.equal(data[1].role, 'pm');
    });

    it('GET /api/coordinator/barriers returns barrier snapshot', async () => {
      const res = await httpGet(port, '/api/coordinator/barriers');
      assert.equal(res.status, 200);
      const data = JSON.parse(res.body);
      assert.equal(data.backend_completion.status, 'partially_satisfied');
    });

    it('GET /api/coordinator/barrier-ledger returns barrier transition audit', async () => {
      const res = await httpGet(port, '/api/coordinator/barrier-ledger');
      assert.equal(res.status, 200);
      const data = JSON.parse(res.body);
      assert.ok(Array.isArray(data));
      assert.equal(data[0].barrier_id, 'backend_completion');
    });

    it('AT-CDRS-001: GET /api/coordinator/repo-status returns authority-first rows with coordinator linkage as metadata', async () => {
      writeJson(join(fixture.reposDir, 'api', '.agentxchain', 'state.json'), {
        schema_version: '1.1',
        project_id: 'api',
        run_id: 'run_api_live',
        status: 'completed',
        phase: 'release',
        active_turns: {},
        turn_sequence: 3,
        accepted_count: 3,
        rejected_count: 0,
        blocked_on: null,
        blocked_reason: null,
        next_recommended_role: null,
      });
      writeJson(join(fixture.reposDir, 'web', '.agentxchain', 'state.json'), {
        schema_version: '1.1',
        project_id: 'web',
        run_id: 'run_web_live',
        status: 'active',
        phase: 'implementation',
        active_turns: {},
        turn_sequence: 1,
        accepted_count: 1,
        rejected_count: 0,
        blocked_on: null,
        blocked_reason: null,
        next_recommended_role: null,
      });
      writeJson(join(fixture.multiDir, 'state.json'), {
        super_run_id: 'srun_test_001',
        status: 'active',
        phase: 'implementation',
        pending_gate: null,
        repo_runs: {
          api: { run_id: 'run_api_expected', status: 'linked', phase: 'implementation' },
          web: { run_id: 'run_web_live', status: 'initialized', phase: 'implementation' },
        },
      });

      const res = await httpGet(port, '/api/coordinator/repo-status');
      assert.equal(res.status, 200);
      const data = JSON.parse(res.body);
      assert.ok(Array.isArray(data));
      const byRepo = Object.fromEntries(data.map((entry) => [entry.repo_id, entry]));
      assert.deepEqual(byRepo.api, {
        repo_id: 'api',
        run_id: 'run_api_live',
        status: 'completed',
        phase: 'release',
        details: [
          { label: 'coordinator', value: 'linked' },
          { label: 'expected run', value: 'run_api_expected', mono: true },
        ],
      });
      assert.deepEqual(byRepo.web, {
        repo_id: 'web',
        run_id: 'run_web_live',
        status: 'active',
        phase: 'implementation',
        details: [
          { label: 'coordinator', value: 'initialized' },
        ],
      });
    });

    it('AT-CDTRS-001: GET /api/coordinator/timeouts keeps authority-first repo status and expected-run metadata on timeout snapshots', async () => {
      writeJson(join(fixture.reposDir, 'api', '.agentxchain', 'state.json'), {
        schema_version: '1.1',
        project_id: 'api',
        run_id: 'run_api_live',
        status: 'completed',
        phase: 'release',
        active_turns: {},
        turn_sequence: 3,
        accepted_count: 3,
        rejected_count: 0,
        blocked_on: null,
        blocked_reason: null,
        next_recommended_role: null,
      });
      writeJson(join(fixture.multiDir, 'state.json'), {
        super_run_id: 'srun_test_001',
        status: 'active',
        phase: 'implementation',
        pending_gate: null,
        repo_runs: {
          api: { run_id: 'run_api_expected', status: 'linked', phase: 'implementation' },
          web: { run_id: 'run_web_live', status: 'initialized', phase: 'implementation' },
        },
      });

      const res = await httpGet(port, '/api/coordinator/timeouts');
      assert.equal(res.status, 200);
      const data = JSON.parse(res.body);
      const apiRepo = data.repos.find((entry) => entry.repo_id === 'api');
      assert.deepEqual(apiRepo.details, [
        { label: 'coordinator', value: 'linked' },
        { label: 'expected run', value: 'run_api_expected', mono: true },
      ]);
      assert.equal(apiRepo.run_id, 'run_api_live');
      assert.equal(apiRepo.status, 'completed');
      assert.equal(apiRepo.phase, 'release');
    });

    it('GET /api/coordinator/blockers returns structured repo_run_id_mismatch diagnostics', async () => {
      writeJson(join(fixture.reposDir, 'api', '.agentxchain', 'state.json'), {
        schema_version: '1.1',
        project_id: 'api',
        run_id: 'run_api_999',
        status: 'active',
        phase: 'implementation',
        active_turns: {},
        turn_sequence: 0,
        accepted_count: 0,
        rejected_count: 0,
        blocked_on: null,
        blocked_reason: null,
        next_recommended_role: null,
      });
      writeJson(join(fixture.reposDir, 'web', '.agentxchain', 'state.json'), {
        schema_version: '1.1',
        project_id: 'web',
        run_id: 'run_web_001',
        status: 'active',
        phase: 'implementation',
        active_turns: {},
        turn_sequence: 0,
        accepted_count: 0,
        rejected_count: 0,
        blocked_on: null,
        blocked_reason: null,
        next_recommended_role: null,
      });
      writeJson(join(fixture.multiDir, 'state.json'), {
        super_run_id: 'srun_test_001',
        status: 'active',
        phase: 'implementation',
        pending_gate: null,
        repo_runs: {
          api: { run_id: 'run_api_001', status: 'linked', phase: 'implementation' },
          web: { run_id: 'run_web_001', status: 'linked', phase: 'implementation' },
        },
      });
      writeJson(join(fixture.multiDir, 'barriers.json'), {
        implementation_build_completion: {
          workstream_id: 'implementation_build',
          type: 'all_repos_accepted',
          status: 'satisfied',
          required_repos: ['api', 'web'],
          satisfied_repos: ['api', 'web'],
        },
        qa_release_completion: {
          workstream_id: 'qa_release',
          type: 'all_repos_accepted',
          status: 'pending',
          required_repos: ['api', 'web'],
          satisfied_repos: [],
        },
      });

      const res = await httpGet(port, '/api/coordinator/blockers');
      assert.equal(res.status, 200);
      const data = JSON.parse(res.body);
      assert.equal(data.mode, 'phase_transition');
      assert.equal(data.active.gate_type, 'phase_transition');
      assert.equal(data.active.ready, false);
      assert.equal(data.active.gate_id, 'phase_transition:implementation->qa');
      assert.equal(data.active.blockers.length, 1);
      assert.equal(data.active.blockers[0].code, 'repo_run_id_mismatch');
      assert.equal(data.active.blockers[0].repo_id, 'api');
      assert.equal(data.active.blockers[0].expected_run_id, 'run_api_001');
      assert.equal(data.active.blockers[0].actual_run_id, 'run_api_999');
      assert.equal(data.next_actions[0].code, 'repo_run_id_mismatch');
      assert.equal(data.next_actions[0].command, 'agentxchain multi resume');
      assert.match(data.next_actions[0].reason, /run identity drift/i);
      assert.equal(data.next_actions[1].code, 'repo_run_id_mismatch');
      assert.match(data.next_actions[1].reason, /Repo "api" run identity drifted/);
      assert.equal(data.evaluations.run_completion.ready, false);
    });

    it('GET /api/coordinator/blockers returns pending_gate mode when approval is waiting', async () => {
      writeJson(join(fixture.multiDir, 'state.json'), {
        super_run_id: 'srun_test_001',
        status: 'paused',
        phase: 'implementation',
        pending_gate: {
          gate_type: 'phase_transition',
          gate: 'phase_transition:implementation->qa',
          from: 'implementation',
          to: 'qa',
          required_repos: ['api', 'web'],
          human_barriers: [],
          requested_at: '2026-04-08T23:45:00.000Z',
        },
        repo_runs: {
          api: { run_id: 'run_api_001', status: 'linked', phase: 'implementation' },
          web: { run_id: 'run_web_001', status: 'linked', phase: 'implementation' },
        },
      });

      const res = await httpGet(port, '/api/coordinator/blockers');
      assert.equal(res.status, 200);
      const data = JSON.parse(res.body);
      assert.equal(data.mode, 'pending_gate');
      assert.equal(data.pending_gate.gate, 'phase_transition:implementation->qa');
      assert.equal(data.active.gate_type, 'phase_transition');
      assert.equal(data.active.pending, true);
      assert.equal(data.active.ready, true);
      assert.deepEqual(data.active.blockers, []);
      assert.equal(data.next_actions.length, 1);
      assert.equal(data.next_actions[0].code, 'pending_gate');
      assert.equal(data.next_actions[0].command, 'agentxchain multi approve-gate');
      assert.match(data.next_actions[0].reason, /waiting on pending gate/i);
    });

    it('GET /api/coordinator/blockers returns resync action when repo status drifts without run-id drift', async () => {
      writeJson(join(fixture.reposDir, 'api', '.agentxchain', 'state.json'), {
        schema_version: '1.1',
        project_id: 'api',
        run_id: 'run_api_001',
        status: 'blocked',
        phase: 'implementation',
        active_turns: {},
        turn_sequence: 0,
        accepted_count: 0,
        rejected_count: 0,
        blocked_on: 'dispatch:awaiting_followup',
        blocked_reason: 'Dispatch paused',
        next_recommended_role: null,
      });
      writeJson(join(fixture.reposDir, 'web', '.agentxchain', 'state.json'), {
        schema_version: '1.1',
        project_id: 'web',
        run_id: 'run_web_001',
        status: 'linked',
        phase: 'implementation',
        active_turns: {},
        turn_sequence: 0,
        accepted_count: 0,
        rejected_count: 0,
        blocked_on: null,
        blocked_reason: null,
        next_recommended_role: null,
      });
      writeJson(join(fixture.multiDir, 'state.json'), {
        super_run_id: 'srun_test_001',
        status: 'active',
        phase: 'implementation',
        pending_gate: null,
        repo_runs: {
          api: { run_id: 'run_api_001', status: 'linked', phase: 'implementation' },
          web: { run_id: 'run_web_001', status: 'linked', phase: 'implementation' },
        },
      });

      const res = await httpGet(port, '/api/coordinator/blockers');
      assert.equal(res.status, 200);
      const data = JSON.parse(res.body);
      assert.equal(data.next_actions[0].code, 'resync');
      assert.equal(data.next_actions[0].command, 'agentxchain multi resync');
      assert.match(data.next_actions[0].reason, /disagrees with repo authority/i);
    });

    it('AT-DPOLL-004: GET /api/poll in replay mode returns a clean no-op heartbeat and never evaluates reminders', async () => {
      const pollFixture = createDashboardPollFixture({ governed: true, withState: true, pendingApproval: true });
      let pollBridge;
      try {
        pollBridge = createBridgeServer({
          agentxchainDir: pollFixture.axcDir,
          dashboardDir: pollFixture.dashDir,
          port: 0,
          replayMode: true,
        });
        const started = await pollBridge.start();
        const res = await httpGet(started.port, '/api/poll');
        assert.equal(res.status, 200);
        const data = JSON.parse(res.body);
        assert.equal(data.ok, true);
        assert.equal(data.replay_mode, true);
        assert.equal(data.reminder_evaluation.notifications_emitted, 0);
        assert.deepEqual(data.reminder_evaluation.reminders_sent, []);
        assert.deepEqual(readNotificationAudit(pollFixture.root), []);
      } finally {
        if (pollBridge) {
          await pollBridge.stop();
        }
        rmSync(pollFixture.root, { recursive: true, force: true });
      }
    });

    it('GET /api/poll returns a no-op heartbeat when no governed project is present', async () => {
      const pollFixture = createDashboardPollFixture({ governed: false });
      let pollBridge;
      try {
        pollBridge = createBridgeServer({
          agentxchainDir: pollFixture.axcDir,
          dashboardDir: pollFixture.dashDir,
          port: 0,
        });
        const started = await pollBridge.start();
        const res = await httpGet(started.port, '/api/poll');
        assert.equal(res.status, 200);
        const data = JSON.parse(res.body);
        assert.equal(data.ok, true);
        assert.equal(data.replay_mode, false);
        assert.equal(data.governed_project_detected, false);
        assert.equal(data.state_available, false);
        assert.equal(data.reminder_evaluation.notifications_emitted, 0);
        assert.deepEqual(data.reminder_evaluation.reminders_sent, []);
      } finally {
        if (pollBridge) {
          await pollBridge.stop();
        }
        rmSync(pollFixture.root, { recursive: true, force: true });
      }
    });

    it('GET /api/poll returns governed_project_detected=true but state_available=false when state.json is absent', async () => {
      const pollFixture = createDashboardPollFixture({ governed: true, withState: false });
      let pollBridge;
      try {
        pollBridge = createBridgeServer({
          agentxchainDir: pollFixture.axcDir,
          dashboardDir: pollFixture.dashDir,
          port: 0,
        });
        const started = await pollBridge.start();
        const res = await httpGet(started.port, '/api/poll');
        assert.equal(res.status, 200);
        const data = JSON.parse(res.body);
        assert.equal(data.ok, true);
        assert.equal(data.replay_mode, false);
        assert.equal(data.governed_project_detected, true);
        assert.equal(data.state_available, false);
        assert.equal(data.reminder_evaluation.notifications_emitted, 0);
        assert.deepEqual(data.reminder_evaluation.reminders_sent, []);
      } finally {
        if (pollBridge) {
          await pollBridge.stop();
        }
        rmSync(pollFixture.root, { recursive: true, force: true });
      }
    });

    it('GET /api/unknown returns 404', async () => {
      const res = await httpGet(port, '/api/unknown');
      assert.equal(res.status, 404);
    });
  });

  // ── Static asset serving ──

  describe('Static assets', () => {
    it('GET / serves index.html', async () => {
      const res = await httpGet(port, '/');
      assert.equal(res.status, 200);
      assert.ok(res.body.includes('Dashboard'));
      assert.ok(res.headers['content-type'].includes('text/html'));
    });

    it('GET /app.js serves JavaScript', async () => {
      const res = await httpGet(port, '/app.js');
      assert.equal(res.status, 200);
      assert.ok(res.headers['content-type'].includes('javascript'));
    });

    it('GET /nonexistent falls back to index.html (SPA)', async () => {
      const res = await httpGet(port, '/some/route');
      assert.equal(res.status, 200);
      assert.ok(res.body.includes('Dashboard'));
    });

    it('rejects encoded path traversal attempts', async () => {
      writeFileSync(join(fixture.root, 'secret.txt'), 'top-secret');
      const res = await httpGet(port, '/..%2Fsecret.txt');
      assert.equal(res.status, 403);
      assert.equal(res.body, 'Forbidden');
    });

    it('decodes extended-length websocket text frames in the dashboard harness', () => {
      const message = JSON.stringify({
        type: 'invalidate',
        resource: `/api/${'x'.repeat(160)}`,
      });
      const frame = createServerTextFrame(message);

      assert.equal(decodeServerTextFrame(frame), message);
    });
  });

  // ── Dashboard actions ──

  describe('Dashboard action contract', () => {
    it('GET /api/session returns mutation token and approve capability', async () => {
      const res = await httpGet(port, '/api/session');
      assert.equal(res.status, 200);
      const data = JSON.parse(res.body);
      assert.equal(data.session_version, '1');
      assert.equal(typeof data.mutation_token, 'string');
      assert.ok(data.mutation_token.length > 20);
      assert.equal(data.capabilities.approve_gate, true);
    });

    it('POST /api/actions/approve-gate rejects requests without the session token', async () => {
      const res = await httpRequest(port, '/api/actions/approve-gate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      assert.equal(res.status, 403);
      const data = JSON.parse(res.body);
      assert.equal(data.code, 'invalid_token');
    });

    it('AT-DASH-ACT-011: POST /api/actions/approve-gate returns repo-local success state and next actions', async () => {
      writeJson(join(fixture.axcDir, 'state.json'), {
        schema_version: '1.1',
        project_id: 'dashboard-root',
        run_id: 'run_test_001',
        status: 'paused',
        phase: 'implementation',
        active_turns: {},
        turn_sequence: 1,
        accepted_count: 1,
        rejected_count: 0,
        blocked_on: null,
        blocked_reason: null,
        pending_phase_transition: {
          from: 'implementation',
          to: 'qa',
          gate: 'implementation_complete',
          requested_by_turn: 'turn_001',
        },
      });

      const session = JSON.parse((await httpGet(port, '/api/session')).body);
      const res = await httpRequest(port, '/api/actions/approve-gate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-AgentXchain-Token': session.mutation_token,
        },
        body: '{}',
      });

      assert.equal(res.status, 200);
      const data = JSON.parse(res.body);
      assert.equal(data.ok, true);
      assert.equal(data.scope, 'repo');
      assert.equal(data.gate_type, 'phase_transition');
      assert.equal(data.status, 'active');
      assert.equal(data.phase, 'qa');
      assert.match(data.message, /implementation -> qa/i);
      assert.equal(data.next_action, 'agentxchain step');
      assert.equal(data.next_actions.length, 1);
      assert.equal(data.next_actions[0].command, 'agentxchain step');
      assert.match(data.next_actions[0].reason, /phase "qa".*continue/i);

      const updated = JSON.parse(readFileSync(join(fixture.axcDir, 'state.json'), 'utf8'));
      assert.equal(updated.phase, 'qa');
      assert.equal(updated.status, 'active');
      assert.equal(updated.pending_phase_transition, null);
    });

    it('AT-DASH-ACT-010: POST /api/actions/approve-gate returns normalized repo-local hook-block failure fields', async () => {
      mkdirSync(join(fixture.root, 'hooks'), { recursive: true });
      writeFileSync(join(fixture.root, 'hooks', 'block-gate.sh'), `#!/bin/sh
cat <<'HOOKEOF'
{"verdict":"block","message":"Compliance review required"}
HOOKEOF
`);
      chmodSync(join(fixture.root, 'hooks', 'block-gate.sh'), 0o755);

      const repoConfig = JSON.parse(readFileSync(join(fixture.root, 'agentxchain.json'), 'utf8'));
      repoConfig.hooks = {
        before_gate: [
          {
            name: 'release-guard',
            type: 'process',
            command: ['./hooks/block-gate.sh'],
            timeout_ms: 5000,
            mode: 'blocking',
          },
        ],
      };
      writeJson(join(fixture.root, 'agentxchain.json'), repoConfig);

      writeJson(join(fixture.axcDir, 'state.json'), {
        schema_version: '1.1',
        project_id: 'dashboard-root',
        run_id: 'run_test_001',
        status: 'paused',
        phase: 'implementation',
        active_turns: {},
        turn_sequence: 1,
        accepted_count: 1,
        rejected_count: 0,
        blocked_on: null,
        blocked_reason: null,
        pending_phase_transition: {
          from: 'implementation',
          to: 'qa',
          gate: 'implementation_complete',
          requested_by_turn: 'turn_001',
        },
      });

      const session = JSON.parse((await httpGet(port, '/api/session')).body);
      const res = await httpRequest(port, '/api/actions/approve-gate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-AgentXchain-Token': session.mutation_token,
        },
        body: '{}',
      });

      assert.equal(res.status, 409);
      const data = JSON.parse(res.body);
      assert.equal(data.code, 'hook_blocked');
      assert.equal(data.scope, 'repo');
      assert.equal(data.gate, 'implementation_complete');
      assert.equal(data.gate_type, 'phase_transition');
      assert.equal(data.hook_phase, 'before_gate');
      assert.equal(data.hook_name, 'release-guard');
      assert.equal(data.next_action, 'agentxchain approve-transition');
      assert.equal(data.next_actions[0].command, 'agentxchain approve-transition');
      assert.equal(data.recovery_summary.typed_reason, 'pending_phase_transition');
      assert.equal(data.recovery_summary.recovery_action, 'agentxchain approve-transition');
      assert.equal(data.recovery_summary.detail, 'implementation_complete');
    });

    it('AT-DASH-ACT-012: POST /api/actions/approve-gate returns coordinator success state and next actions', async () => {
      writeJson(join(fixture.reposDir, 'api', '.agentxchain', 'state.json'), {
        schema_version: '1.1',
        project_id: 'api',
        run_id: 'run_api_001',
        status: 'active',
        phase: 'implementation',
        active_turns: {},
        turn_sequence: 0,
        accepted_count: 0,
        rejected_count: 0,
        blocked_on: null,
        blocked_reason: null,
        next_recommended_role: null,
      });
      writeJson(join(fixture.reposDir, 'web', '.agentxchain', 'state.json'), {
        schema_version: '1.1',
        project_id: 'web',
        run_id: 'run_web_001',
        status: 'active',
        phase: 'implementation',
        active_turns: {},
        turn_sequence: 0,
        accepted_count: 0,
        rejected_count: 0,
        blocked_on: null,
        blocked_reason: null,
        next_recommended_role: null,
      });

      writeJson(join(fixture.axcDir, 'state.json'), {
        schema_version: '1.1',
        run_id: 'run_test_001',
        status: 'running',
        phase: 'implementation',
        active_turns: {},
      });
      writeJson(join(fixture.multiDir, 'state.json'), {
        super_run_id: 'srun_test_001',
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
          api: { run_id: 'run_api_001', status: 'linked', phase: 'implementation' },
          web: { run_id: 'run_web_001', status: 'linked', phase: 'implementation' },
        },
      });

      const session = JSON.parse((await httpGet(port, '/api/session')).body);
      const res = await httpRequest(port, '/api/actions/approve-gate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-AgentXchain-Token': session.mutation_token,
        },
        body: '{}',
      });

      assert.equal(res.status, 200);
      const data = JSON.parse(res.body);
      assert.equal(data.ok, true);
      assert.equal(data.scope, 'coordinator');
      assert.equal(data.gate_type, 'phase_transition');
      assert.equal(data.status, 'active');
      assert.equal(data.phase, 'qa');
      assert.match(data.message, /implementation -> qa/i);
      assert.equal(data.next_action, 'agentxchain multi step');
      assert.equal(data.next_actions.length, 1);
      assert.equal(data.next_actions[0].command, 'agentxchain multi step');
      assert.match(data.next_actions[0].reason, /can continue/i);

      const updated = JSON.parse(readFileSync(join(fixture.multiDir, 'state.json'), 'utf8'));
      assert.equal(updated.phase, 'qa');
      assert.equal(updated.status, 'active');
      assert.equal(updated.pending_gate, null);
    });

    it('AT-DASH-ACT-014: POST /api/actions/approve-gate returns repo-local completion success with no next actions', async () => {
      const cleanRepoConfig = JSON.parse(readFileSync(join(fixture.root, 'agentxchain.json'), 'utf8'));
      delete cleanRepoConfig.hooks;
      writeJson(join(fixture.root, 'agentxchain.json'), cleanRepoConfig);

      writeJson(join(fixture.axcDir, 'state.json'), {
        schema_version: '1.1',
        project_id: 'dashboard-root',
        run_id: 'run_test_001',
        status: 'paused',
        phase: 'qa',
        active_turns: {},
        turn_sequence: 2,
        accepted_count: 2,
        rejected_count: 0,
        blocked_on: null,
        blocked_reason: null,
        pending_run_completion: {
          gate: 'qa_ship_verdict',
          requested_by_turn: 'turn_002',
        },
      });

      const session = JSON.parse((await httpGet(port, '/api/session')).body);
      const res = await httpRequest(port, '/api/actions/approve-gate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-AgentXchain-Token': session.mutation_token,
        },
        body: '{}',
      });

      assert.equal(res.status, 200);
      const data = JSON.parse(res.body);
      assert.equal(data.ok, true);
      assert.equal(data.scope, 'repo');
      assert.equal(data.gate_type, 'run_completion');
      assert.equal(data.status, 'completed');
      assert.equal(data.phase, 'qa');
      assert.equal(data.next_action, null);
      assert.deepEqual(data.next_actions, []);
      assert.match(data.message, /run completion approved/i);

      const updated = JSON.parse(readFileSync(join(fixture.axcDir, 'state.json'), 'utf8'));
      assert.equal(updated.status, 'completed');
      assert.equal(updated.phase, 'qa');
      assert.equal(updated.pending_run_completion, null);
    });

    it('AT-DASH-ACT-015: POST /api/actions/approve-gate returns coordinator completion success with no next actions even when repo snapshots drift', async () => {
      writeJson(join(fixture.reposDir, 'api', '.agentxchain', 'state.json'), {
        schema_version: '1.1',
        project_id: 'api',
        run_id: 'run_api_001',
        status: 'completed',
        phase: 'release',
        active_turns: {},
        turn_sequence: 3,
        accepted_count: 3,
        rejected_count: 0,
        blocked_on: null,
        blocked_reason: null,
        next_recommended_role: null,
      });
      writeJson(join(fixture.reposDir, 'web', '.agentxchain', 'state.json'), {
        schema_version: '1.1',
        project_id: 'web',
        run_id: 'run_web_001',
        status: 'completed',
        phase: 'release',
        active_turns: {},
        turn_sequence: 3,
        accepted_count: 3,
        rejected_count: 0,
        blocked_on: null,
        blocked_reason: null,
        next_recommended_role: null,
      });

      writeJson(join(fixture.axcDir, 'state.json'), {
        schema_version: '1.1',
        run_id: 'run_test_001',
        status: 'running',
        phase: 'release',
        active_turns: {},
      });
      writeJson(join(fixture.multiDir, 'state.json'), {
        super_run_id: 'srun_test_001',
        status: 'paused',
        phase: 'release',
        pending_gate: {
          gate_type: 'run_completion',
          gate: 'initiative_ship',
          required_repos: ['api', 'web'],
        },
        repo_runs: {
          api: { run_id: 'run_api_001', status: 'linked', phase: 'release' },
          web: { run_id: 'run_web_001', status: 'linked', phase: 'release' },
        },
      });

      const session = JSON.parse((await httpGet(port, '/api/session')).body);
      const res = await httpRequest(port, '/api/actions/approve-gate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-AgentXchain-Token': session.mutation_token,
        },
        body: '{}',
      });

      assert.equal(res.status, 200);
      const data = JSON.parse(res.body);
      assert.equal(data.ok, true);
      assert.equal(data.scope, 'coordinator');
      assert.equal(data.gate_type, 'run_completion');
      assert.equal(data.status, 'completed');
      assert.equal(data.phase, 'release');
      assert.equal(data.next_action, null);
      assert.deepEqual(data.next_actions, []);
      assert.match(data.message, /coordinator run completion approved/i);

      const updated = JSON.parse(readFileSync(join(fixture.multiDir, 'state.json'), 'utf8'));
      assert.equal(updated.status, 'completed');
      assert.equal(updated.phase, 'release');
      assert.equal(updated.pending_gate, null);
    });

    it('AT-DASH-ACT-009: POST /api/actions/approve-gate returns normalized coordinator hook-block failure fields', async () => {
      mkdirSync(join(fixture.root, 'hooks'), { recursive: true });
      writeFileSync(join(fixture.root, 'hooks', 'block-gate.sh'), `#!/bin/sh
cat <<'HOOKEOF'
{"verdict":"block","message":"Compliance review required"}
HOOKEOF
`);
      chmodSync(join(fixture.root, 'hooks', 'block-gate.sh'), 0o755);
      writeJson(join(fixture.root, 'agentxchain-multi.json'), buildCoordinatorConfigWithBlockingGateHook());
      writeJson(join(fixture.reposDir, 'api', '.agentxchain', 'state.json'), {
        schema_version: '1.1',
        project_id: 'api',
        run_id: 'run_api_001',
        status: 'active',
        phase: 'implementation',
        active_turns: {},
        turn_sequence: 0,
        accepted_count: 0,
        rejected_count: 0,
        blocked_on: null,
        blocked_reason: null,
        next_recommended_role: null,
      });
      writeJson(join(fixture.reposDir, 'web', '.agentxchain', 'state.json'), {
        schema_version: '1.1',
        project_id: 'web',
        run_id: 'run_web_001',
        status: 'active',
        phase: 'implementation',
        active_turns: {},
        turn_sequence: 0,
        accepted_count: 0,
        rejected_count: 0,
        blocked_on: null,
        blocked_reason: null,
        next_recommended_role: null,
      });

      writeJson(join(fixture.axcDir, 'state.json'), {
        schema_version: '1.1',
        run_id: 'run_test_001',
        status: 'running',
        phase: 'implementation',
        active_turns: {},
      });
      writeJson(join(fixture.multiDir, 'state.json'), {
        super_run_id: 'srun_test_001',
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
          api: { run_id: 'run_api_001', status: 'linked', phase: 'implementation' },
          web: { run_id: 'run_web_001', status: 'linked', phase: 'implementation' },
        },
      });

      const session = JSON.parse((await httpGet(port, '/api/session')).body);
      const res = await httpRequest(port, '/api/actions/approve-gate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-AgentXchain-Token': session.mutation_token,
        },
        body: '{}',
      });

      assert.equal(res.status, 409);
      const data = JSON.parse(res.body);
      assert.equal(data.code, 'hook_blocked');
      assert.equal(data.hook_phase, 'before_gate');
      assert.equal(data.hook_name, 'release-guard');
      assert.equal(data.next_action, 'agentxchain multi approve-gate');
      assert.equal(data.next_actions[0].command, 'agentxchain multi approve-gate');
      assert.equal(data.recovery_summary.typed_reason, 'hook_block');
      assert.match(data.recovery_summary.detail, /Coordinator state is unchanged/);
    });

    it('AT-DASH-ACT-016: POST /api/actions/approve-gate reconciles orphaned blocked_on into run completion and succeeds', async () => {
      // Seed orphaned state: blocked_on human_approval with no explicit
      // pending_run_completion.  loadProjectState reconciliation must
      // repair this before the action can route correctly.
      // protocol_mode: 'governed' is required so approvePendingDashboardGate
      // uses loadProjectState (which reconciles) instead of raw readJsonFile.
      const cleanRepoConfig = JSON.parse(readFileSync(join(fixture.root, 'agentxchain.json'), 'utf8'));
      delete cleanRepoConfig.hooks;
      cleanRepoConfig.protocol_mode = 'governed';
      // exit_gate must match blocked_on gate so reconciliation can infer
      // the pending approval type.  qa is the final phase (no next phase
      // in routing), so reconciliation routes to run_completion.
      // Gates must also be declared in the config for routing validation.
      cleanRepoConfig.routing = {
        implementation: { entry_role: 'dev', allowed_next_roles: ['dev', 'human'], exit_gate: 'implementation_complete' },
        qa: { entry_role: 'dev', allowed_next_roles: ['dev', 'human'], exit_gate: 'qa_ship_verdict' },
      };
      cleanRepoConfig.gates = {
        implementation_complete: { requires_human_approval: true },
        qa_ship_verdict: { requires_human_approval: true },
      };
      writeJson(join(fixture.root, 'agentxchain.json'), cleanRepoConfig);

      writeJson(join(fixture.axcDir, 'state.json'), {
        schema_version: '1.1',
        project_id: 'dashboard-root',
        run_id: 'run_test_001',
        status: 'blocked',
        phase: 'qa',
        active_turns: {},
        turn_sequence: 3,
        accepted_count: 3,
        rejected_count: 0,
        blocked_on: 'human_approval:qa_ship_verdict',
        blocked_reason: {
          detail: 'Waiting for QA ship verdict',
          turn_id: 'turn_qa_orphan',
        },
        phase_gate_status: {
          implementation_complete: 'passed',
          qa_ship_verdict: 'pending',
        },
      });
      // Clear coordinator gate so it does not interfere
      writeJson(join(fixture.multiDir, 'state.json'), {
        super_run_id: 'srun_test_001',
        status: 'active',
        phase: 'qa',
        pending_gate: null,
        repo_runs: {},
      });

      const session = JSON.parse((await httpGet(port, '/api/session')).body);
      const res = await httpRequest(port, '/api/actions/approve-gate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-AgentXchain-Token': session.mutation_token,
        },
        body: '{}',
      });

      assert.equal(res.status, 200, 'HTTP route should succeed on orphaned final-phase approval');
      const data = JSON.parse(res.body);
      assert.equal(data.ok, true);
      assert.equal(data.scope, 'repo');
      assert.equal(data.gate_type, 'run_completion');
      assert.equal(data.status, 'completed');

      const updated = JSON.parse(readFileSync(join(fixture.axcDir, 'state.json'), 'utf8'));
      assert.equal(updated.status, 'completed', 'disk state should complete via reconciled HTTP route');
      assert.equal(updated.pending_run_completion, null);
      assert.equal(updated.phase_gate_status?.qa_ship_verdict, 'passed');
    });

    it('AT-DASH-ACT-017: POST /api/actions/approve-gate reconciles orphaned blocked_on into phase transition and advances', async () => {
      // Seed orphaned state: blocked_on human_approval for a non-final
      // gate with no explicit pending_phase_transition.  Reconciliation
      // must surface it as a phase transition, not a completion.
      // protocol_mode: 'governed' required for reconciliation path.
      const repoConfig = JSON.parse(readFileSync(join(fixture.root, 'agentxchain.json'), 'utf8'));
      delete repoConfig.hooks;
      repoConfig.protocol_mode = 'governed';
      // exit_gate for implementation must match blocked_on gate.
      // Implementation has a next phase (qa), so reconciliation routes
      // to phase_transition.
      repoConfig.routing = {
        implementation: { entry_role: 'dev', allowed_next_roles: ['dev', 'human'], exit_gate: 'implementation_complete' },
        qa: { entry_role: 'dev', allowed_next_roles: ['dev', 'human'], exit_gate: 'qa_ship_verdict' },
      };
      repoConfig.gates = {
        implementation_complete: { requires_human_approval: true },
        qa_ship_verdict: { requires_human_approval: true },
      };
      writeJson(join(fixture.root, 'agentxchain.json'), repoConfig);

      writeJson(join(fixture.axcDir, 'state.json'), {
        schema_version: '1.1',
        project_id: 'dashboard-root',
        run_id: 'run_test_001',
        status: 'blocked',
        phase: 'implementation',
        active_turns: {},
        turn_sequence: 2,
        accepted_count: 2,
        rejected_count: 0,
        blocked_on: 'human_approval:implementation_complete',
        blocked_reason: {
          detail: 'Waiting for implementation signoff',
          turn_id: 'turn_impl_orphan',
        },
        phase_gate_status: {
          implementation_complete: 'pending',
        },
      });
      writeJson(join(fixture.multiDir, 'state.json'), {
        super_run_id: 'srun_test_001',
        status: 'active',
        phase: 'implementation',
        pending_gate: null,
        repo_runs: {},
      });

      const session = JSON.parse((await httpGet(port, '/api/session')).body);
      const res = await httpRequest(port, '/api/actions/approve-gate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-AgentXchain-Token': session.mutation_token,
        },
        body: '{}',
      });

      assert.equal(res.status, 200, 'HTTP route should succeed on orphaned non-final approval');
      const data = JSON.parse(res.body);
      assert.equal(data.ok, true);
      assert.equal(data.scope, 'repo');
      assert.equal(data.gate_type, 'phase_transition');
      assert.equal(data.status, 'active');
      assert.equal(data.phase, 'qa');

      const updated = JSON.parse(readFileSync(join(fixture.axcDir, 'state.json'), 'utf8'));
      assert.equal(updated.status, 'active', 'disk state should return to active via HTTP route');
      assert.equal(updated.phase, 'qa', 'phase should advance via reconciled HTTP route');
      assert.equal(updated.pending_phase_transition, null);
      assert.equal(updated.phase_gate_status?.implementation_complete, 'passed');
    });

    it('POST /api/actions/approve-gate returns 409 when no repo or coordinator gate exists', async () => {
      writeJson(join(fixture.axcDir, 'state.json'), {
        schema_version: '1.1',
        run_id: 'run_test_001',
        status: 'running',
        phase: 'implementation',
        active_turns: {},
      });
      writeJson(join(fixture.multiDir, 'state.json'), {
        super_run_id: 'srun_test_001',
        status: 'active',
        phase: 'implementation',
        pending_gate: null,
        repo_runs: {},
      });

      const session = JSON.parse((await httpGet(port, '/api/session')).body);
      const res = await httpRequest(port, '/api/actions/approve-gate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-AgentXchain-Token': session.mutation_token,
        },
        body: '{}',
      });

      assert.equal(res.status, 409);
      const data = JSON.parse(res.body);
      assert.equal(data.code, 'no_pending_gate');
    });
  });

  // ── Security: limited mutation surface ──

  describe('Mutation boundary enforcement', () => {
    for (const method of ['PUT', 'DELETE', 'PATCH']) {
      it(`${method} requests to state API return 405`, async () => {
        const res = await httpRequest(port, '/api/state', { method });
        assert.equal(res.status, 405);
        const data = JSON.parse(res.body);
        assert.match(data.error, /approve-gate/i);
      });
    }

    it('GET /api/actions/approve-gate returns 405', async () => {
      const res = await httpRequest(port, '/api/actions/approve-gate', { method: 'GET' });
      assert.equal(res.status, 405);
      const data = JSON.parse(res.body);
      assert.equal(data.code, 'method_not_allowed');
    });
  });

  // ── Security: localhost-only (AT-DASH-007) ──

  describe('Localhost binding (AT-DASH-007)', () => {
    it('Bridge binds to 127.0.0.1', () => {
      const addr = bridge.server.address();
      assert.equal(addr.address, '127.0.0.1');
    });
  });

  // ── Missing files ──

  describe('Missing .agentxchain files', () => {
    let emptyBridge;
    let emptyPort;
    let emptyFixture;

    before(async () => {
      const root = tmpDir();
      const axcDir = join(root, '.agentxchain');
      const dashDir = join(root, 'dashboard');
      mkdirSync(axcDir, { recursive: true });
      mkdirSync(dashDir, { recursive: true });
      writeFileSync(join(dashDir, 'index.html'), '<html><body>Empty</body></html>');

      emptyFixture = { root, axcDir, dashDir };
      emptyBridge = createBridgeServer({
        agentxchainDir: axcDir,
        dashboardDir: dashDir,
        port: 0,
      });
      const result = await emptyBridge.start();
      emptyPort = result.port;
    });

    after(async () => {
      await emptyBridge.stop();
      rmSync(emptyFixture.root, { recursive: true, force: true });
    });

    it('GET /api/state returns 404 when state.json is missing', async () => {
      const res = await httpGet(emptyPort, '/api/state');
      assert.equal(res.status, 404);
    });

    it('GET /api/history returns 404 when history.jsonl is missing', async () => {
      const res = await httpGet(emptyPort, '/api/history');
      assert.equal(res.status, 404);
    });

    it('GET /api/coordinator/blockers returns 404 when coordinator state is missing', async () => {
      const res = await httpGet(emptyPort, '/api/coordinator/blockers');
      assert.equal(res.status, 404);
      const data = JSON.parse(res.body);
      assert.equal(data.code, 'coordinator_config_missing');
    });

    it('GET /api/coordinator/repo-status returns 404 when coordinator state is missing', async () => {
      const res = await httpGet(emptyPort, '/api/coordinator/repo-status');
      assert.equal(res.status, 404);
      const data = JSON.parse(res.body);
      assert.equal(data.code, 'coordinator_config_missing');
    });
  });
});

describe('Dashboard State Reader', () => {
  let axcDir;
  let root;

  before(() => {
    root = tmpDir();
    axcDir = join(root, '.agentxchain');
    mkdirSync(axcDir, { recursive: true });
  });

  after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('readJsonFile returns parsed JSON', async () => {
    const { readJsonFile } = await import('../src/lib/dashboard/state-reader.js');
    writeFileSync(join(axcDir, 'state.json'), JSON.stringify({ run_id: 'test' }));
    const result = readJsonFile(axcDir, 'state.json');
    assert.deepEqual(result, { run_id: 'test' });
  });

  it('readJsonFile returns null for missing file', async () => {
    const { readJsonFile } = await import('../src/lib/dashboard/state-reader.js');
    const result = readJsonFile(axcDir, 'nonexistent.json');
    assert.equal(result, null);
  });

  it('readJsonlFile returns array of parsed entries', async () => {
    const { readJsonlFile } = await import('../src/lib/dashboard/state-reader.js');
    writeFileSync(join(axcDir, 'test.jsonl'),
      JSON.stringify({ a: 1 }) + '\n' + JSON.stringify({ b: 2 }) + '\n'
    );
    const result = readJsonlFile(axcDir, 'test.jsonl');
    assert.deepEqual(result, [{ a: 1 }, { b: 2 }]);
  });

  it('readJsonlFile returns empty array for empty file', async () => {
    const { readJsonlFile } = await import('../src/lib/dashboard/state-reader.js');
    writeFileSync(join(axcDir, 'empty.jsonl'), '');
    const result = readJsonlFile(axcDir, 'empty.jsonl');
    assert.deepEqual(result, []);
  });

  it('readJsonlFile returns null for missing file', async () => {
    const { readJsonlFile } = await import('../src/lib/dashboard/state-reader.js');
    const result = readJsonlFile(axcDir, 'missing.jsonl');
    assert.equal(result, null);
  });

  it('readResource returns compact repo-decision summary from repo-decisions.jsonl', async () => {
    const { readResource } = await import('../src/lib/dashboard/state-reader.js');
    writeFileSync(join(root, 'agentxchain.json'), JSON.stringify({
      schema_version: '1.0',
      project: { id: 'dash-repo-decisions', name: 'Dash Repo Decisions' },
      roles: {
        architect: {
          title: 'Architect',
          mandate: 'Set direction.',
          write_authority: 'authoritative',
          runtime: 'local-architect',
          decision_authority: 40,
        },
      },
      runtimes: {
        'local-architect': {
          type: 'local_cli',
          command: ['echo', '{prompt}'],
          prompt_transport: 'argv',
        },
      },
    }));
    writeFileSync(
      join(axcDir, 'repo-decisions.jsonl'),
      [
        JSON.stringify({
          id: 'DEC-001',
          status: 'overridden',
          category: 'architecture',
          statement: 'Use PostgreSQL',
          role: 'architect',
          run_id: 'run_001',
          overridden_by: 'DEC-002',
        }),
        JSON.stringify({
          id: 'DEC-002',
          status: 'active',
          category: 'architecture',
          statement: 'Move to SQLite for local-first mode',
          role: 'architect',
          run_id: 'run_002',
          overrides: 'DEC-001',
        }),
      ].join('\n') + '\n',
    );

    const result = readResource(axcDir, '/api/repo-decisions-summary');
    const context = loadProjectContext(root);

    assert.equal(context.config.roles.architect.decision_authority, 40);
    assert.equal(result.format, 'json');
    assert.equal(result.data.active_count, 1);
    assert.equal(result.data.overridden_count, 1);
    assert.equal(result.data.operator_summary.highest_active_authority_level, 40);
    assert.equal(result.data.operator_summary.highest_active_authority_role, 'architect');
    assert.equal(result.data.operator_summary.superseding_active_count, 1);
    assert.equal(result.data.operator_summary.overridden_with_successor_count, 1);
  });

  it('readJsonFile throws on malformed JSON', async () => {
    const { readJsonFile } = await import('../src/lib/dashboard/state-reader.js');
    writeFileSync(join(axcDir, 'bad.json'), '{ not valid json');
    assert.throws(() => readJsonFile(axcDir, 'bad.json'));
  });
});

describe('Dashboard File Watcher', () => {
  let root;
  let axcDir;

  before(() => {
    root = tmpDir();
    axcDir = join(root, '.agentxchain');
    mkdirSync(axcDir, { recursive: true });
    // Create the files before starting the watcher
    writeFileSync(join(axcDir, 'state.json'), '{}');
  });

  after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('emits invalidate event when a tracked file changes', async () => {
    const { FileWatcher } = await import('../src/lib/dashboard/file-watcher.js');
    const watcher = new FileWatcher(axcDir);
    watcher.start();

    const event = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        watcher.stop();
        reject(new Error('Watcher did not emit invalidate within 3s'));
      }, 3000);

      watcher.on('invalidate', (evt) => {
        clearTimeout(timeout);
        watcher.stop();
        resolve(evt);
      });

      // Trigger a change after watcher is set up
      setTimeout(() => {
        writeFileSync(join(axcDir, 'state.json'), JSON.stringify({ changed: true }));
      }, 200);
    });

    assert.equal(event.resource, '/api/state');
  });

  it('emits invalidate event when coordinator state changes', async () => {
    const multiDir = join(axcDir, 'multirepo');
    mkdirSync(multiDir, { recursive: true });
    writeFileSync(join(multiDir, 'state.json'), '{}');

    const { FileWatcher } = await import('../src/lib/dashboard/file-watcher.js');
    const watcher = new FileWatcher(axcDir);
    watcher.start();

    const event = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        watcher.stop();
        reject(new Error('Watcher did not emit coordinator invalidate within 3s'));
      }, 3000);

      watcher.on('invalidate', (evt) => {
        if (evt.resource !== '/api/coordinator/state') {
          return;
        }
        clearTimeout(timeout);
        watcher.stop();
        resolve(evt);
      });

      setTimeout(() => {
        writeFileSync(join(multiDir, 'state.json'), JSON.stringify({ changed: true }));
      }, 200);
    });

    assert.equal(event.resource, '/api/coordinator/state');
  });

  it('does not emit for untracked files', async () => {
    // Use a separate directory with no tracked files to avoid macOS fs.watch noise
    const isolatedRoot = tmpDir();
    const isolatedDir = join(isolatedRoot, '.agentxchain');
    mkdirSync(isolatedDir, { recursive: true });

    const { FileWatcher } = await import('../src/lib/dashboard/file-watcher.js');
    const watcher = new FileWatcher(isolatedDir);
    watcher.start();

    // Wait for watcher to stabilize
    await new Promise(resolve => setTimeout(resolve, 200));

    let emitted = false;
    watcher.on('invalidate', () => { emitted = true; });

    writeFileSync(join(isolatedDir, 'untracked.txt'), 'hello');

    await new Promise(resolve => setTimeout(resolve, 400));
    watcher.stop();
    rmSync(isolatedRoot, { recursive: true, force: true });
    assert.equal(emitted, false);
  });
});

describe('WebSocket invalidation', () => {
  let fixture;
  let bridge;
  let port;

  before(async () => {
    fixture = createTestFixture();
    bridge = createBridgeServer({
      agentxchainDir: fixture.axcDir,
      dashboardDir: fixture.dashDir,
      port: 0,
    });
    const result = await bridge.start();
    port = result.port;
  });

  after(async () => {
    await bridge.stop();
    rmSync(fixture.root, { recursive: true, force: true });
  });

  it('receives invalidation event on file change', async () => {
    // Connect via raw HTTP upgrade (no ws library needed in tests)
    const event = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('No WS message within 5s')), 5000);
      const key = randomBytes(16).toString('base64');

      const req = http.request({
        host: '127.0.0.1',
        port,
        path: '/ws',
        headers: {
          'Connection': 'Upgrade',
          'Upgrade': 'websocket',
          'Sec-WebSocket-Version': '13',
          'Sec-WebSocket-Key': key,
        },
      });

      req.on('upgrade', (res, socket, head) => {
        assert.equal(res.headers['sec-websocket-accept'], expectedWebSocketAccept(key));

        socket.on('data', (data) => {
          const payload = decodeServerTextFrame(data);
          if (!payload) return;
          try {
            const msg = JSON.parse(payload);
            if (msg.resource === '/api/state') {
              clearTimeout(timeout);
              socket.destroy();
              resolve(msg);
            }
          } catch {}
        });

        // Trigger a file change after connection is established
        setTimeout(() => {
          writeFileSync(join(fixture.axcDir, 'state.json'), JSON.stringify({ updated: true }));
        }, 300);
      });

      req.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });

      req.end();
    });

    assert.equal(event.type, 'invalidate');
    assert.equal(event.resource, '/api/state');
  });

  it('receives coordinator invalidation event on multirepo state change', async () => {
    const event = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('No coordinator WS message within 5s')), 5000);
      const key = randomBytes(16).toString('base64');

      const req = http.request({
        host: '127.0.0.1',
        port,
        path: '/ws',
        headers: {
          'Connection': 'Upgrade',
          'Upgrade': 'websocket',
          'Sec-WebSocket-Version': '13',
          'Sec-WebSocket-Key': key,
        },
      });

      req.on('upgrade', (res, socket) => {
        assert.equal(res.headers['sec-websocket-accept'], expectedWebSocketAccept(key));

        socket.on('data', (data) => {
          const payload = decodeServerTextFrame(data);
          if (!payload) return;
          try {
            const msg = JSON.parse(payload);
            if (msg.resource === '/api/coordinator/state') {
              clearTimeout(timeout);
              socket.destroy();
              resolve(msg);
            }
          } catch {}
        });

        setTimeout(() => {
          writeFileSync(join(fixture.multiDir, 'state.json'), JSON.stringify({ updated: true }));
        }, 300);
      });

      req.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });

      req.end();
    });

    assert.equal(event.type, 'invalidate');
    assert.equal(event.resource, '/api/coordinator/state');
  });

  it('rejects websocket command messages because websocket remains read-only', async () => {
    const message = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('No WS error message within 5s')), 5000);
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
          let parsed;
          try { parsed = JSON.parse(payload); } catch { return; }
          if (parsed.type !== 'error') return;
          clearTimeout(timeout);
          socket.destroy();
          resolve(parsed);
        });

        socket.write(createMaskedTextFrame(JSON.stringify({
          action: 'approve-transition',
        })));
      });

      req.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });

      req.end();
    });

    assert.equal(message.type, 'error');
    assert.match(message.error, /read-only/i);
  });
});

// ── Coordinator Timeout Bridge E2E ────────────────────────────────���────────
// Isolated fixture + bridge to prove /api/coordinator/timeouts through the
// HTTP layer without interference from other test suites' state mutations.

describe('Coordinator Timeout Bridge E2E', () => {
  let root, axcDir, multiDir, reposDir, bridge, port;

  function writeTimeoutFixture() {
    root = tmpDir();
    axcDir = join(root, '.agentxchain');
    multiDir = join(axcDir, 'multirepo');
    const dashDir = join(root, 'dashboard');
    reposDir = join(root, 'repos');
    mkdirSync(multiDir, { recursive: true });
    mkdirSync(dashDir, { recursive: true });

    // Coordinator config
    writeJson(join(root, 'agentxchain-multi.json'), {
      schema_version: '0.1',
      project: { id: 'timeout-proof', name: 'Timeout Proof' },
      repos: {
        api: { path: './repos/api', default_branch: 'main', required: true },
        web: { path: './repos/web', default_branch: 'main', required: true },
      },
      workstreams: {
        impl: {
          phase: 'implementation',
          repos: ['api', 'web'],
          entry_repo: 'api',
          depends_on: [],
          completion_barrier: 'all_repos_accepted',
        },
      },
      routing: {
        implementation: { entry_workstream: 'impl' },
      },
      gates: {},
    });

    // Child repos with timeout config
    for (const repoId of ['api', 'web']) {
      const repoRoot = join(reposDir, repoId);
      mkdirSync(join(repoRoot, '.agentxchain'), { recursive: true });

      const timeouts = repoId === 'api'
        ? { per_turn_minutes: 30, per_phase_minutes: 60, per_run_minutes: 480, action: 'escalate' }
        : { per_turn_minutes: 15, per_phase_minutes: 120, action: 'warn' };

      writeJson(join(repoRoot, 'agentxchain.json'), {
        schema_version: '1.0',
        template: 'generic',
        project: { id: repoId, name: repoId, default_branch: 'main' },
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
        },
        gates: {},
        timeouts,
      });

      const activeTurns = repoId === 'api'
        ? {
          turn_api_t1: {
            turn_id: 'turn_api_t1',
            assigned_role: 'dev',
            status: 'dispatched',
            runtime_id: 'local-dev',
            attempt: 1,
            assigned_sequence: 1,
            started_at: new Date(Date.now() - 40 * 60000).toISOString(),
          },
        }
        : {};

      writeJson(join(repoRoot, '.agentxchain', 'state.json'), {
        schema_version: '1.1',
        project_id: repoId,
        run_id: `run_${repoId}_001`,
        status: 'active',
        phase: 'implementation',
        active_turns: activeTurns,
        turn_sequence: repoId === 'api' ? 1 : 0,
        accepted_count: 0,
        rejected_count: 0,
        blocked_on: null,
        blocked_reason: null,
        phase_entered_at: new Date(Date.now() - 90 * 60000).toISOString(),
        created_at: new Date(Date.now() - 200 * 60000).toISOString(),
      });
    }

    // Coordinator state
    writeJson(join(multiDir, 'state.json'), {
      super_run_id: 'srun_timeout_001',
      status: 'active',
      phase: 'implementation',
      pending_gate: null,
      repo_runs: {
        api: { run_id: 'run_api_001', status: 'linked', phase: 'implementation' },
        web: { run_id: 'run_web_001', status: 'linked', phase: 'implementation' },
      },
    });

    // Coordinator ledger with a timeout warning
    writeFileSync(join(multiDir, 'decision-ledger.jsonl'),
      JSON.stringify({ type: 'timeout_warning', scope: 'per_turn', phase: 'implementation', turn_id: 'turn_api_t1', elapsed_minutes: 25, limit_minutes: 30, action: 'escalate', timestamp: '2026-04-11T06:00:00Z' }) + '\n'
    );

    // API repo ledger with a timeout exceeded event
    writeFileSync(join(reposDir, 'api', '.agentxchain', 'decision-ledger.jsonl'),
      JSON.stringify({ type: 'timeout_exceeded', scope: 'per_turn', phase: 'implementation', turn_id: 'turn_api_t1', elapsed_minutes: 35, limit_minutes: 30, exceeded_by_minutes: 5, action: 'escalate', timestamp: '2026-04-11T06:10:00Z' }) + '\n'
    );

    // Dashboard shell
    writeFileSync(join(dashDir, 'index.html'), '<html><body>Timeout Dashboard</body></html>');

    return { root, axcDir, multiDir, dashDir, reposDir };
  }

  before(async () => {
    writeTimeoutFixture();
    bridge = createBridgeServer({
      agentxchainDir: axcDir,
      dashboardDir: join(root, 'dashboard'),
      port: 0,
    });
    const result = await bridge.start();
    port = result.port;
  });

  after(async () => {
    await bridge.stop();
    rmSync(root, { recursive: true, force: true });
  });

  it('returns full coordinator timeout status with child-repo pressure and coordinator events', async () => {
    const res = await httpGet(port, '/api/coordinator/timeouts');
    assert.equal(res.status, 200);
    const data = JSON.parse(res.body);

    // Top-level shape
    assert.equal(data.ok, true);
    assert.equal(data.super_run_id, 'srun_timeout_001');
    assert.equal(data.status, 'active');
    assert.equal(data.phase, 'implementation');
    assert.equal(data.blocked_reason, null);

    // Summary
    assert.equal(data.summary.repo_count, 2);
    assert.equal(data.summary.configured_repo_count, 2);
    assert.equal(typeof data.summary.repos_with_live_exceeded, 'number');
    assert.equal(typeof data.summary.repos_with_live_warnings, 'number');
    assert.equal(data.summary.coordinator_event_count, 1);

    // Coordinator events from coordinator ledger
    assert.ok(Array.isArray(data.coordinator_events));
    assert.equal(data.coordinator_events.length, 1);
    assert.equal(data.coordinator_events[0].type, 'timeout_warning');
    assert.equal(data.coordinator_events[0].scope, 'per_turn');
    assert.equal(data.coordinator_events[0].limit_minutes, 30);

    // Repos array
    assert.ok(Array.isArray(data.repos));
    assert.equal(data.repos.length, 2);

    const apiRepo = data.repos.find(r => r.repo_id === 'api');
    const webRepo = data.repos.find(r => r.repo_id === 'web');
    assert.ok(apiRepo, 'api repo must be present');
    assert.ok(webRepo, 'web repo must be present');

    // API repo: timeout configured, has ledger event, active with live data
    assert.equal(apiRepo.configured, true);
    assert.ok(apiRepo.config);
    assert.equal(apiRepo.config.per_turn_minutes, 30);
    assert.equal(apiRepo.config.per_phase_minutes, 60);
    assert.equal(apiRepo.config.per_run_minutes, 480);
    assert.equal(apiRepo.config.action, 'escalate');
    assert.ok(apiRepo.live, 'active repo with timeouts must have live data');
    assert.ok(Array.isArray(apiRepo.live.exceeded));
    assert.ok(Array.isArray(apiRepo.live.warnings));
    assert.equal(apiRepo.events.length, 1);
    assert.equal(apiRepo.events[0].type, 'timeout_exceeded');
    assert.equal(apiRepo.events[0].exceeded_by_minutes, 5);
    assert.equal(apiRepo.error, null);

    // Web repo: timeout configured, no events, active with live data
    assert.equal(webRepo.configured, true);
    assert.ok(webRepo.config);
    assert.equal(webRepo.config.per_turn_minutes, 15);
    assert.equal(webRepo.config.per_phase_minutes, 120);
    assert.equal(webRepo.config.action, 'warn');
    assert.ok(webRepo.live, 'active repo with timeouts must have live data');
    assert.equal(webRepo.events.length, 0);
    assert.equal(webRepo.error, null);
  });

  it('API repo live pressure reflects per-phase timeout exceeded', async () => {
    const res = await httpGet(port, '/api/coordinator/timeouts');
    const data = JSON.parse(res.body);
    const apiRepo = data.repos.find(r => r.repo_id === 'api');

    // API phase entered 90 minutes ago against 60-minute per_phase limit — should be exceeded
    assert.ok(apiRepo.live.exceeded.length > 0, 'API repo per-phase should be exceeded (90min > 60min limit)');
    const exceeded = apiRepo.live.exceeded.find(e => e.scope === 'phase');
    assert.ok(exceeded, 'per-phase exceeded entry expected');
    assert.ok(exceeded.elapsed_minutes >= 89, 'elapsed should be ~90 minutes');
    assert.equal(exceeded.limit_minutes, 60);
  });

  it('handles missing child repo state gracefully', async () => {
    // Remove web repo state
    rmSync(join(reposDir, 'web', '.agentxchain', 'state.json'));

    const res = await httpGet(port, '/api/coordinator/timeouts');
    assert.equal(res.status, 200);
    const data = JSON.parse(res.body);
    assert.equal(data.ok, true);
    assert.equal(data.repos.length, 2);

    const webRepo = data.repos.find(r => r.repo_id === 'web');
    assert.ok(webRepo);
    assert.ok(webRepo.error, 'web repo should report an error when state is missing');
    assert.equal(webRepo.error.code, 'repo_state_missing');
    assert.equal(webRepo.configured, true);
    assert.ok(webRepo.config, 'config should still be readable even without state');

    // Restore for subsequent tests
    writeJson(join(reposDir, 'web', '.agentxchain', 'state.json'), {
      schema_version: '1.1',
      project_id: 'web',
      run_id: 'run_web_001',
      status: 'active',
      phase: 'implementation',
      active_turns: {},
      turn_sequence: 0,
      accepted_count: 0,
      rejected_count: 0,
      phase_entered_at: new Date(Date.now() - 10 * 60000).toISOString(),
      created_at: new Date(Date.now() - 30 * 60000).toISOString(),
    });
  });

  it('returns 404 when coordinator config is missing', async () => {
    const emptyRoot = tmpDir();
    const emptyAxcDir = join(emptyRoot, '.agentxchain');
    const emptyDashDir = join(emptyRoot, 'dashboard');
    mkdirSync(emptyAxcDir, { recursive: true });
    mkdirSync(emptyDashDir, { recursive: true });
    writeFileSync(join(emptyDashDir, 'index.html'), '<html></html>');

    const emptyBridge = createBridgeServer({
      agentxchainDir: emptyAxcDir,
      dashboardDir: emptyDashDir,
      port: 0,
    });
    const emptyResult = await emptyBridge.start();
    const emptyPort = emptyResult.port;

    try {
      const res = await httpGet(emptyPort, '/api/coordinator/timeouts');
      assert.equal(res.status, 404);
      const data = JSON.parse(res.body);
      assert.equal(data.ok, false);
      assert.equal(data.code, 'coordinator_config_missing');
    } finally {
      await emptyBridge.stop();
      rmSync(emptyRoot, { recursive: true, force: true });
    }
  });

  it('reports repo event count in summary across multiple repos', async () => {
    // Add a timeout event to web repo ledger too
    writeFileSync(join(reposDir, 'web', '.agentxchain', 'decision-ledger.jsonl'),
      JSON.stringify({ type: 'timeout_blocked', scope: 'per_phase', phase: 'implementation', elapsed_minutes: 65, limit_minutes: 60, action: 'block', timestamp: '2026-04-11T07:00:00Z' }) + '\n'
    );

    const res = await httpGet(port, '/api/coordinator/timeouts');
    const data = JSON.parse(res.body);
    assert.equal(data.summary.repo_event_count, 2); // 1 api + 1 web
    assert.equal(data.summary.coordinator_event_count, 1);

    const webRepo = data.repos.find(r => r.repo_id === 'web');
    assert.equal(webRepo.events.length, 1);
    assert.equal(webRepo.events[0].type, 'timeout_blocked');
    assert.equal(webRepo.events[0].scope, 'per_phase');
  });
});

// ── Notification Bridge HTTP Tests ─────────────────────────────────────────

describe('Notification Bridge HTTP', () => {
  // ── AT-NOTIFY-HTTP-001: no-config returns 404 ──
  describe('no config', () => {
    let bridge;
    let port;
    let root;

    before(async () => {
      root = tmpDir();
      const axcDir = join(root, '.agentxchain');
      const dashDir = join(root, 'dashboard');
      mkdirSync(axcDir, { recursive: true });
      mkdirSync(dashDir, { recursive: true });
      writeFileSync(join(dashDir, 'index.html'), '<html></html>');
      // No agentxchain.json — config missing
      bridge = createBridgeServer({ agentxchainDir: axcDir, dashboardDir: dashDir, port: 0 });
      const result = await bridge.start();
      port = result.port;
    });

    after(async () => {
      await bridge.stop();
      rmSync(root, { recursive: true, force: true });
    });

    it('AT-NOTIFY-HTTP-001: GET /api/notifications returns 404 config_missing when no project config', async () => {
      const res = await httpGet(port, '/api/notifications');
      assert.equal(res.status, 404);
      const data = JSON.parse(res.body);
      assert.equal(data.ok, false);
      assert.equal(data.code, 'config_missing');
    });
  });

  // ── AT-NOTIFY-HTTP-002/003: config present, with and without audit data ──
  describe('with notification config', () => {
    let bridge;
    let port;
    let root;
    let axcDir;

    before(async () => {
      root = tmpDir();
      axcDir = join(root, '.agentxchain');
      const dashDir = join(root, 'dashboard');
      mkdirSync(axcDir, { recursive: true });
      mkdirSync(dashDir, { recursive: true });
      writeFileSync(join(dashDir, 'index.html'), '<html></html>');

      writeJson(join(root, 'agentxchain.json'), {
        schema_version: '1.0',
        template: 'generic',
        project: { id: 'notify-test', name: 'Notify Test', default_branch: 'main' },
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
          implementation: { entry_role: 'dev', allowed_next_roles: ['dev'] },
        },
        gates: {},
        notifications: {
          webhooks: [
            {
              name: 'slack-ops',
              url: 'https://hooks.example.com/axc',
              timeout_ms: 5000,
              events: ['run_blocked', 'operator_escalation_raised', 'run_completed'],
            },
          ],
          approval_sla: {
            enabled: true,
            reminder_after_seconds: [300, 900],
          },
        },
      });

      writeJson(join(axcDir, 'state.json'), {
        schema_version: '1.1',
        project_id: 'notify-test',
        run_id: null,
        status: 'idle',
        phase: 'implementation',
        active_turns: {},
        turn_sequence: 0,
        accepted_count: 0,
        rejected_count: 0,
      });

      bridge = createBridgeServer({ agentxchainDir: axcDir, dashboardDir: dashDir, port: 0 });
      const result = await bridge.start();
      port = result.port;
    });

    after(async () => {
      await bridge.stop();
      rmSync(root, { recursive: true, force: true });
    });

    it('AT-NOTIFY-HTTP-002: GET /api/notifications returns configured snapshot with empty audit', async () => {
      const res = await httpGet(port, '/api/notifications');
      assert.equal(res.status, 200);
      const data = JSON.parse(res.body);

      assert.equal(data.ok, true);
      assert.equal(data.configured, true);
      assert.equal(data.webhooks.length, 1);
      assert.equal(data.webhooks[0].name, 'slack-ops');
      assert.equal(data.webhooks[0].timeout_ms, 5000);
      assert.equal(data.webhooks[0].event_count, 3);
      assert.deepEqual(data.webhooks[0].events, ['run_blocked', 'operator_escalation_raised', 'run_completed']);

      assert.equal(data.approval_sla.enabled, true);
      assert.deepEqual(data.approval_sla.reminder_after_seconds, [300, 900]);

      assert.equal(data.summary.total_attempts, 0);
      assert.equal(data.summary.delivered, 0);
      assert.equal(data.summary.failed, 0);
      assert.equal(data.summary.timed_out, 0);
      assert.deepEqual(data.recent, []);
    });

    it('AT-NOTIFY-HTTP-003: GET /api/notifications returns newest-first audit with aggregate counts', async () => {
      // Seed audit entries
      const entries = [
        { event: 'run_blocked', target: 'slack-ops', delivered: true, timed_out: false, emitted_at: '2026-04-19T10:00:00Z', duration_ms: 120 },
        { event: 'operator_escalation_raised', target: 'slack-ops', delivered: false, timed_out: true, emitted_at: '2026-04-19T10:05:00Z', duration_ms: 5000, error: 'timeout' },
        { event: 'run_completed', target: 'slack-ops', delivered: true, timed_out: false, emitted_at: '2026-04-19T10:10:00Z', duration_ms: 95 },
      ];
      writeFileSync(
        join(axcDir, 'notification-audit.jsonl'),
        entries.map(e => JSON.stringify(e)).join('\n') + '\n',
      );

      const res = await httpGet(port, '/api/notifications');
      assert.equal(res.status, 200);
      const data = JSON.parse(res.body);

      assert.equal(data.ok, true);
      assert.equal(data.configured, true);

      // Summary aggregates
      assert.equal(data.summary.total_attempts, 3);
      assert.equal(data.summary.delivered, 2);
      assert.equal(data.summary.failed, 1);
      assert.equal(data.summary.timed_out, 1);
      assert.equal(data.summary.last_emitted_at, '2026-04-19T10:10:00Z');
      assert.equal(data.summary.last_failure_at, '2026-04-19T10:05:00Z');

      // Recent entries are newest-first
      assert.equal(data.recent.length, 3);
      assert.equal(data.recent[0].emitted_at, '2026-04-19T10:10:00Z');
      assert.equal(data.recent[0].delivered, true);
      assert.equal(data.recent[1].emitted_at, '2026-04-19T10:05:00Z');
      assert.equal(data.recent[1].timed_out, true);
      assert.equal(data.recent[2].emitted_at, '2026-04-19T10:00:00Z');
    });

    it('AT-NOTIFY-HTTP-004: GET /api/notifications caps recent at 10 entries', async () => {
      // Seed 15 audit entries — use minute offsets to stay within valid hours
      const entries = [];
      for (let i = 0; i < 15; i++) {
        entries.push({
          event: 'run_blocked',
          target: 'slack-ops',
          delivered: true,
          timed_out: false,
          emitted_at: `2026-04-19T10:${String(i).padStart(2, '0')}:00Z`,
          duration_ms: 100,
        });
      }
      writeFileSync(
        join(axcDir, 'notification-audit.jsonl'),
        entries.map(e => JSON.stringify(e)).join('\n') + '\n',
      );

      const res = await httpGet(port, '/api/notifications');
      assert.equal(res.status, 200);
      const data = JSON.parse(res.body);

      assert.equal(data.summary.total_attempts, 15);
      assert.equal(data.recent.length, 10, 'recent must cap at 10');
      assert.equal(data.recent[0].emitted_at, '2026-04-19T10:14:00Z', 'newest first');
      assert.equal(data.recent[9].emitted_at, '2026-04-19T10:05:00Z', 'oldest of the 10');
    });

    it('AT-NOTIFY-HTTP-005: response content-type is application/json', async () => {
      const res = await httpGet(port, '/api/notifications');
      assert.equal(res.status, 200);
      assert.ok(res.headers['content-type']?.includes('application/json'));
    });
  });

  // ── AT-NOTIFY-HTTP-006: replay mode returns live-only message ──
  describe('replay mode', () => {
    let bridge;
    let port;
    let root;

    before(async () => {
      root = tmpDir();
      const axcDir = join(root, '.agentxchain');
      const dashDir = join(root, 'dashboard');
      mkdirSync(axcDir, { recursive: true });
      mkdirSync(dashDir, { recursive: true });
      writeFileSync(join(dashDir, 'index.html'), '<html></html>');

      writeJson(join(root, 'agentxchain.json'), {
        schema_version: '1.0',
        template: 'generic',
        project: { id: 'replay-test', name: 'Replay Test', default_branch: 'main' },
        roles: { dev: { title: 'Dev', mandate: 'Build.', write_authority: 'authoritative', runtime: 'local-dev' } },
        runtimes: { 'local-dev': { type: 'local_cli', command: ['echo', '{prompt}'], prompt_transport: 'argv' } },
        routing: { implementation: { entry_role: 'dev', allowed_next_roles: ['dev'] } },
        gates: {},
        notifications: {
          webhooks: [{ name: 'test-hook', url: 'https://example.com', timeout_ms: 3000, events: ['run_blocked'] }],
        },
      });
      writeJson(join(axcDir, 'state.json'), {
        schema_version: '1.1', project_id: 'replay-test', run_id: null,
        status: 'idle', phase: 'implementation', active_turns: {},
        turn_sequence: 0, accepted_count: 0, rejected_count: 0,
      });

      // Seed audit data that should NOT be returned in replay
      writeFileSync(join(axcDir, 'notification-audit.jsonl'),
        JSON.stringify({ event: 'run_blocked', target: 'test-hook', delivered: true, emitted_at: '2026-04-19T12:00:00Z' }) + '\n');

      bridge = createBridgeServer({ agentxchainDir: axcDir, dashboardDir: dashDir, port: 0, replayMode: true });
      const result = await bridge.start();
      port = result.port;
    });

    after(async () => {
      await bridge.stop();
      rmSync(root, { recursive: true, force: true });
    });

    it('AT-NOTIFY-HTTP-006: GET /api/notifications in replay mode returns live-only message, not audit data', async () => {
      const res = await httpGet(port, '/api/notifications');
      assert.equal(res.status, 200);
      const data = JSON.parse(res.body);
      assert.equal(data.ok, true);
      assert.equal(data.replay_mode, true);
      assert.ok(data.message.includes('live-only'));
      // Must NOT contain audit data
      assert.equal(data.configured, undefined);
      assert.equal(data.webhooks, undefined);
      assert.equal(data.recent, undefined);
    });
  });
});

// ── AT-CONNECTOR-HTTP: /api/connectors HTTP bridge tests ──────────────────────

describe('GET /api/connectors HTTP bridge', () => {
  describe('config/state guards', () => {
    let bridge;
    let port;
    let root;

    before(async () => {
      root = tmpDir();
      // No agentxchain.json — bare directory
      mkdirSync(join(root, '.agentxchain'), { recursive: true });
      const dashDir = join(root, 'dashboard');
      mkdirSync(dashDir, { recursive: true });
      writeFileSync(join(dashDir, 'index.html'), '<html></html>');

      bridge = createBridgeServer({ agentxchainDir: join(root, '.agentxchain'), dashboardDir: dashDir, port: 0 });
      const result = await bridge.start();
      port = result.port;
    });

    after(async () => {
      await bridge.stop();
      rmSync(root, { recursive: true, force: true });
    });

    it('AT-CONNECTOR-HTTP-001: no project config → 404 with config_missing', async () => {
      const res = await httpGet(port, '/api/connectors');
      assert.equal(res.status, 404);
      const data = JSON.parse(res.body);
      assert.equal(data.ok, false);
      assert.equal(data.code, 'config_missing');
    });
  });

  describe('config present, state missing', () => {
    let bridge;
    let port;
    let root;

    before(async () => {
      root = tmpDir();
      const axcDir = join(root, '.agentxchain');
      const dashDir = join(root, 'dashboard');
      mkdirSync(axcDir, { recursive: true });
      mkdirSync(dashDir, { recursive: true });
      writeFileSync(join(dashDir, 'index.html'), '<html></html>');

      writeJson(join(root, 'agentxchain.json'), {
        schema_version: '1.0',
        template: 'generic',
        project: { id: 'conn-nostate', name: 'Connector No State', default_branch: 'main' },
        roles: { dev: { title: 'Dev', mandate: 'Build.', write_authority: 'authoritative', runtime: 'local-dev' } },
        runtimes: { 'local-dev': { type: 'local_cli', command: ['echo', '{prompt}'], prompt_transport: 'argv' } },
        routing: { implementation: { entry_role: 'dev', allowed_next_roles: ['dev'] } },
        gates: {},
      });
      // No state.json

      bridge = createBridgeServer({ agentxchainDir: axcDir, dashboardDir: dashDir, port: 0 });
      const result = await bridge.start();
      port = result.port;
    });

    after(async () => {
      await bridge.stop();
      rmSync(root, { recursive: true, force: true });
    });

    it('AT-CONNECTOR-HTTP-002: config present but no state.json → 404 with state_missing', async () => {
      const res = await httpGet(port, '/api/connectors');
      assert.equal(res.status, 404);
      const data = JSON.parse(res.body);
      assert.equal(data.ok, false);
      assert.equal(data.code, 'state_missing');
    });
  });

  describe('healthy governed project with connectors', () => {
    let bridge;
    let port;
    let root;
    let axcDir;

    before(async () => {
      root = tmpDir();
      axcDir = join(root, '.agentxchain');
      const dashDir = join(root, 'dashboard');
      mkdirSync(axcDir, { recursive: true });
      mkdirSync(dashDir, { recursive: true });
      writeFileSync(join(dashDir, 'index.html'), '<html></html>');

      writeJson(join(root, 'agentxchain.json'), {
        schema_version: '1.0',
        template: 'generic',
        project: { id: 'conn-test', name: 'Connector Test', default_branch: 'main' },
        roles: {
          dev: { title: 'Dev', mandate: 'Build.', write_authority: 'authoritative', runtime: 'local-dev' },
          qa: { title: 'QA', mandate: 'Test.', write_authority: 'review_only', runtime: 'api-qa' },
        },
        runtimes: {
          'local-dev': { type: 'local_cli', command: ['echo', '{prompt}'], prompt_transport: 'argv' },
          'api-qa': { type: 'api_proxy', provider: 'anthropic', model: 'claude-sonnet-4-6', auth_env: 'ANTHROPIC_API_KEY' },
          'manual-human': { type: 'manual' },
        },
        routing: { implementation: { entry_role: 'dev', allowed_next_roles: ['dev', 'qa'] } },
        gates: {},
        protocol_mode: 'governed',
      });

      writeJson(join(axcDir, 'state.json'), {
        schema_version: '1.1',
        project_id: 'conn-test',
        run_id: 'run_abc123',
        status: 'running',
        phase: 'implementation',
        active_turns: {
          turn_001: {
            turn_id: 'turn_001',
            runtime_id: 'local-dev',
            assigned_role: 'dev',
            status: 'running',
          },
        },
        turn_sequence: 1,
        accepted_count: 0,
        rejected_count: 0,
      });

      // Seed a history entry for api-qa showing a past success
      writeFileSync(join(axcDir, 'history.jsonl'),
        JSON.stringify({
          turn_id: 'turn_prev',
          runtime_id: 'api-qa',
          role: 'qa',
          phase: 'implementation',
          accepted_at: '2026-04-19T08:00:00Z',
          outcome: 'accepted',
        }) + '\n',
      );

      bridge = createBridgeServer({ agentxchainDir: axcDir, dashboardDir: dashDir, port: 0 });
      const result = await bridge.start();
      port = result.port;
    });

    after(async () => {
      await bridge.stop();
      rmSync(root, { recursive: true, force: true });
    });

    it('AT-CONNECTOR-HTTP-003: returns 200 with connector health for governed project', async () => {
      const res = await httpGet(port, '/api/connectors');
      assert.equal(res.status, 200);
      const data = JSON.parse(res.body);
      assert.equal(data.ok, true);
      assert.ok(Array.isArray(data.connectors), 'connectors must be an array');
    });

    it('AT-CONNECTOR-HTTP-004: excludes manual runtimes from connectors', async () => {
      const res = await httpGet(port, '/api/connectors');
      const data = JSON.parse(res.body);
      const runtimeIds = data.connectors.map(c => c.runtime_id);
      assert.ok(!runtimeIds.includes('manual-human'), 'manual runtimes must be excluded');
      assert.ok(runtimeIds.includes('local-dev'), 'local_cli runtime must be present');
      assert.ok(runtimeIds.includes('api-qa'), 'api_proxy runtime must be present');
    });

    it('AT-CONNECTOR-HTTP-005: active turn surfaces in connector state', async () => {
      const res = await httpGet(port, '/api/connectors');
      const data = JSON.parse(res.body);
      const localDev = data.connectors.find(c => c.runtime_id === 'local-dev');
      assert.ok(localDev, 'local-dev connector must exist');
      assert.equal(localDev.type, 'local_cli');
      assert.ok(localDev.active_turn_ids.includes('turn_001'), 'active turn must be listed');
      assert.ok(localDev.active_roles.includes('dev'), 'active role must be listed');
      assert.equal(localDev.state, 'active');
    });

    it('AT-CONNECTOR-HTTP-006: history-based success surfaces in connector health', async () => {
      const res = await httpGet(port, '/api/connectors');
      const data = JSON.parse(res.body);
      const apiQa = data.connectors.find(c => c.runtime_id === 'api-qa');
      assert.ok(apiQa, 'api-qa connector must exist');
      assert.equal(apiQa.type, 'api_proxy');
      assert.equal(apiQa.target, 'anthropic / claude-sonnet-4-6');
      assert.equal(apiQa.state, 'healthy');
      assert.equal(apiQa.last_success_at, '2026-04-19T08:00:00Z');
      assert.equal(apiQa.last_turn_id, 'turn_prev');
      assert.equal(apiQa.last_role, 'qa');
    });

    it('AT-CONNECTOR-HTTP-007: connector entries have expected shape', async () => {
      const res = await httpGet(port, '/api/connectors');
      const data = JSON.parse(res.body);
      for (const connector of data.connectors) {
        assert.equal(typeof connector.runtime_id, 'string');
        assert.equal(typeof connector.type, 'string');
        assert.equal(typeof connector.target, 'string');
        assert.ok(['active', 'healthy', 'failing', 'never_used'].includes(connector.state),
          `state must be a known value, got: ${connector.state}`);
        assert.ok(['yes', 'no', 'unknown'].includes(connector.reachable),
          `reachable must be a known value, got: ${connector.reachable}`);
        assert.ok(Array.isArray(connector.active_turn_ids));
        assert.ok(Array.isArray(connector.active_roles));
        // Internal fields must be cleaned up
        assert.equal(connector._latest_success, undefined);
        assert.equal(connector._latest_failure, undefined);
        assert.equal(connector._latest_attempt, undefined);
        assert.equal(connector._latest_identity, undefined);
      }
    });

    it('AT-CONNECTOR-HTTP-008: response content-type is application/json', async () => {
      const res = await httpGet(port, '/api/connectors');
      assert.equal(res.status, 200);
      assert.ok(res.headers['content-type']?.includes('application/json'));
    });
  });

  describe('failing connector with retry trace', () => {
    let bridge;
    let port;
    let root;

    before(async () => {
      root = tmpDir();
      const axcDir = join(root, '.agentxchain');
      const dashDir = join(root, 'dashboard');
      const stagingDir = join(axcDir, 'staging', 'turn_fail_001');
      mkdirSync(axcDir, { recursive: true });
      mkdirSync(dashDir, { recursive: true });
      mkdirSync(stagingDir, { recursive: true });
      writeFileSync(join(dashDir, 'index.html'), '<html></html>');

      writeJson(join(root, 'agentxchain.json'), {
        schema_version: '1.0',
        template: 'generic',
        project: { id: 'conn-fail', name: 'Connector Fail', default_branch: 'main' },
        roles: { dev: { title: 'Dev', mandate: 'Build.', write_authority: 'proposed', runtime: 'api-dev' } },
        runtimes: {
          'api-dev': { type: 'api_proxy', provider: 'openai', model: 'gpt-4o', auth_env: 'OPENAI_API_KEY' },
        },
        routing: { implementation: { entry_role: 'dev', allowed_next_roles: ['dev'] } },
        gates: {},
        protocol_mode: 'governed',
      });

      writeJson(join(axcDir, 'state.json'), {
        schema_version: '1.1',
        project_id: 'conn-fail',
        run_id: 'run_fail',
        status: 'blocked',
        phase: 'implementation',
        active_turns: {
          turn_fail_001: {
            turn_id: 'turn_fail_001',
            runtime_id: 'api-dev',
            assigned_role: 'dev',
            status: 'running',
          },
        },
        turn_sequence: 1,
        accepted_count: 0,
        rejected_count: 0,
        blocked_on: 'runtime_error',
        blocked_reason: {
          turn_id: 'turn_fail_001',
          blocked_at: '2026-04-19T09:30:00Z',
          recovery: { detail: 'API rate limit exceeded' },
        },
      });

      // Seed retry trace with a failure
      writeJson(join(stagingDir, 'retry-trace.json'), {
        turn_id: 'turn_fail_001',
        runtime_id: 'api-dev',
        attempts_made: 3,
        final_outcome: 'failure',
        attempts: [
          { started_at: '2026-04-19T09:25:00Z', completed_at: '2026-04-19T09:25:05Z' },
          { started_at: '2026-04-19T09:27:00Z', completed_at: '2026-04-19T09:27:03Z' },
          { started_at: '2026-04-19T09:29:00Z', completed_at: '2026-04-19T09:29:02Z' },
        ],
      });
      writeJson(join(stagingDir, 'api-error.json'), {
        message: 'Rate limit exceeded: 429 Too Many Requests',
        error_class: 'rate_limit',
      });

      bridge = createBridgeServer({ agentxchainDir: axcDir, dashboardDir: dashDir, port: 0 });
      const result = await bridge.start();
      port = result.port;
    });

    after(async () => {
      await bridge.stop();
      rmSync(root, { recursive: true, force: true });
    });

    it('AT-CONNECTOR-HTTP-009: failing connector surfaces error, attempts, and latency', async () => {
      const res = await httpGet(port, '/api/connectors');
      assert.equal(res.status, 200);
      const data = JSON.parse(res.body);
      assert.equal(data.ok, true);
      const apiDev = data.connectors.find(c => c.runtime_id === 'api-dev');
      assert.ok(apiDev, 'api-dev connector must exist');
      assert.equal(apiDev.state, 'failing');
      assert.equal(apiDev.reachable, 'no');
      assert.ok(typeof apiDev.last_error === 'string' && apiDev.last_error.length > 0, 'last_error must be a non-empty string');
      assert.equal(apiDev.attempts_made, 3);
      assert.equal(typeof apiDev.latency_ms, 'number');
      assert.ok(apiDev.latency_ms >= 0, 'latency must be non-negative');
      assert.ok(typeof apiDev.last_failure_at === 'string', 'last_failure_at must be a timestamp string');
    });
  });
});

// ── AT-TIMEOUT-HTTP: /api/timeouts HTTP bridge tests ────────────────────────

describe('GET /api/timeouts HTTP bridge', () => {
  function writeTimeoutBridgeRepo(root, {
    projectId,
    timeouts = null,
    routing = null,
    state = undefined,
    ledgerEntries = [],
  }) {
    const axcDir = join(root, '.agentxchain');
    const dashDir = join(root, 'dashboard');
    mkdirSync(axcDir, { recursive: true });
    mkdirSync(dashDir, { recursive: true });
    writeFileSync(join(dashDir, 'index.html'), '<html></html>');

    writeJson(join(root, 'agentxchain.json'), {
      schema_version: '1.0',
      protocol_mode: 'governed',
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
      routing: routing || {
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
      ...(timeouts ? { timeouts } : {}),
    });

    if (state !== false) {
      writeJson(join(axcDir, 'state.json'), {
        schema_version: '1.1',
        project_id: projectId,
        run_id: 'run_timeout_http_001',
        status: 'idle',
        phase: 'implementation',
        active_turns: {},
        turn_sequence: 0,
        accepted_count: 0,
        rejected_count: 0,
        blocked_on: null,
        blocked_reason: null,
        next_recommended_role: null,
        ...state,
      });
    }

    if (ledgerEntries.length > 0) {
      writeFileSync(
        join(axcDir, 'decision-ledger.jsonl'),
        ledgerEntries.map((entry) => JSON.stringify(entry)).join('\n') + '\n',
      );
    }

    return { axcDir, dashDir };
  }

  describe('config/state guards', () => {
    let bridge;
    let port;
    let root;

    after(async () => {
      if (bridge) await bridge.stop();
      if (root) rmSync(root, { recursive: true, force: true });
    });

    it('AT-TIMEOUT-HTTP-001: no project config → 404 with config_missing', async () => {
      root = tmpDir();
      const axcDir = join(root, '.agentxchain');
      const dashDir = join(root, 'dashboard');
      mkdirSync(axcDir, { recursive: true });
      mkdirSync(dashDir, { recursive: true });
      writeFileSync(join(dashDir, 'index.html'), '<html></html>');

      bridge = createBridgeServer({ agentxchainDir: axcDir, dashboardDir: dashDir, port: 0 });
      ({ port } = await bridge.start());

      const res = await httpGet(port, '/api/timeouts');
      assert.equal(res.status, 404);
      const data = JSON.parse(res.body);
      assert.equal(data.ok, false);
      assert.equal(data.code, 'config_missing');
    });

    it('AT-TIMEOUT-HTTP-002: config present but no state.json → 404 with state_missing', async () => {
      await bridge.stop();
      rmSync(root, { recursive: true, force: true });

      root = tmpDir();
      const { axcDir, dashDir } = writeTimeoutBridgeRepo(root, {
        projectId: 'timeout-state-missing',
        timeouts: { per_turn_minutes: 30, action: 'warn' },
        state: false,
      });

      bridge = createBridgeServer({ agentxchainDir: axcDir, dashboardDir: dashDir, port: 0 });
      ({ port } = await bridge.start());

      const res = await httpGet(port, '/api/timeouts');
      assert.equal(res.status, 404);
      const data = JSON.parse(res.body);
      assert.equal(data.ok, false);
      assert.equal(data.code, 'state_missing');
    });
  });

  describe('governed timeout snapshots', () => {
    let bridge;
    let port;
    let root;

    afterEach(async () => {
      if (bridge) {
        await bridge.stop();
        bridge = null;
      }
      if (root) {
        rmSync(root, { recursive: true, force: true });
        root = null;
      }
    });

    it('AT-TIMEOUT-HTTP-003: returns configured false when no timeouts are configured', async () => {
      root = tmpDir();
      const { axcDir, dashDir } = writeTimeoutBridgeRepo(root, {
        projectId: 'timeout-not-configured',
      });

      bridge = createBridgeServer({ agentxchainDir: axcDir, dashboardDir: dashDir, port: 0 });
      ({ port } = await bridge.start());

      const res = await httpGet(port, '/api/timeouts');
      assert.equal(res.status, 200);
      const data = JSON.parse(res.body);
      assert.equal(data.ok, true);
      assert.equal(data.configured, false);
      assert.equal(data.config, null);
      assert.equal(data.live, null);
      assert.equal(data.live_context, null);
      assert.deepEqual(data.events, []);
    });

    it('AT-TIMEOUT-HTTP-004: active runs surface phase and turn timeout pressure plus persisted events', async () => {
      root = tmpDir();
      const now = Date.now();
      const { axcDir, dashDir } = writeTimeoutBridgeRepo(root, {
        projectId: 'timeout-active',
        timeouts: {
          per_turn_minutes: 30,
          per_phase_minutes: 60,
          per_run_minutes: 180,
          action: 'warn',
        },
        routing: {
          implementation: {
            entry_role: 'dev',
            allowed_next_roles: ['dev', 'human'],
            timeout_minutes: 45,
            timeout_action: 'skip_phase',
          },
          qa: {
            entry_role: 'dev',
            allowed_next_roles: ['dev', 'human'],
          },
        },
        state: {
          status: 'active',
          phase: 'implementation',
          created_at: new Date(now - (4 * 60 * 60 * 1000)).toISOString(),
          phase_entered_at: new Date(now - (2 * 60 * 60 * 1000)).toISOString(),
          turn_sequence: 1,
          active_turns: {
            turn_timeout_http_001: {
              turn_id: 'turn_timeout_http_001',
              assigned_role: 'dev',
              status: 'active',
              runtime_id: 'local-dev',
              attempt: 1,
              assigned_sequence: 1,
              assigned_at: new Date(now - (75 * 60 * 1000)).toISOString(),
              started_at: new Date(now - (75 * 60 * 1000)).toISOString(),
            },
          },
        },
        ledgerEntries: [
          {
            type: 'timeout_warning',
            scope: 'turn',
            phase: 'implementation',
            turn_id: 'turn_timeout_http_001',
            limit_minutes: 30,
            elapsed_minutes: 75,
            exceeded_by_minutes: 45,
            action: 'warn',
            timestamp: '2026-04-19T23:00:00Z',
          },
        ],
      });

      bridge = createBridgeServer({ agentxchainDir: axcDir, dashboardDir: dashDir, port: 0 });
      ({ port } = await bridge.start());

      const res = await httpGet(port, '/api/timeouts');
      assert.equal(res.status, 200);
      const data = JSON.parse(res.body);
      assert.equal(data.ok, true);
      assert.equal(data.configured, true);
      assert.equal(data.config.per_turn_minutes, 30);
      assert.equal(data.config.action, 'warn');
      assert.deepEqual(data.config.phase_overrides, [
        {
          phase: 'implementation',
          limit_minutes: 45,
          action: 'skip_phase',
        },
      ]);
      const liveItems = [...data.live.exceeded, ...data.live.warnings];
      assert.ok(liveItems.some((item) => item.scope === 'phase'));
      assert.ok(liveItems.some((item) => item.scope === 'run'));
      const turnWarning = data.live.warnings.find((item) => item.scope === 'turn');
      assert.ok(turnWarning, 'turn-scoped timeout pressure must be present');
      assert.equal(turnWarning.turn_id, 'turn_timeout_http_001');
      assert.equal(turnWarning.role_id, 'dev');
      assert.ok(Array.isArray(data.budget), 'budget must be returned');
      assert.equal(data.events.length, 1);
      assert.equal(data.events[0].type, 'timeout_warning');
    });

    it('AT-TIMEOUT-HTTP-005: approval-wait runs return read-only phase and run pressure with awaiting_approval context', async () => {
      root = tmpDir();
      const now = Date.now();
      const { axcDir, dashDir } = writeTimeoutBridgeRepo(root, {
        projectId: 'timeout-approval-wait',
        timeouts: {
          per_phase_minutes: 60,
          per_run_minutes: 120,
          action: 'warn',
        },
        state: {
          status: 'paused',
          phase: 'implementation',
          created_at: new Date(now - (5 * 60 * 60 * 1000)).toISOString(),
          phase_entered_at: new Date(now - (3 * 60 * 60 * 1000)).toISOString(),
          blocked_on: 'human_approval:implementation_signoff',
          pending_phase_transition: {
            from: 'implementation',
            to: 'qa',
            gate: 'implementation_signoff',
            requested_at: '2026-04-19T22:45:00Z',
          },
        },
      });

      bridge = createBridgeServer({ agentxchainDir: axcDir, dashboardDir: dashDir, port: 0 });
      ({ port } = await bridge.start());

      const res = await httpGet(port, '/api/timeouts');
      assert.equal(res.status, 200);
      const data = JSON.parse(res.body);
      assert.ok(data.live.warnings.some((item) => item.scope === 'phase'));
      assert.ok(data.live.warnings.some((item) => item.scope === 'run'));
      assert.ok(!data.live.warnings.some((item) => item.scope === 'turn'));
      assert.deepEqual(data.live_context, {
        awaiting_approval: true,
        pending_gate_type: 'phase_transition',
        requested_at: '2026-04-19T22:45:00Z',
      });
    });

    it('AT-TIMEOUT-HTTP-006: blocked runs return empty live arrays while preserving timeout ledger events', async () => {
      root = tmpDir();
      const { axcDir, dashDir } = writeTimeoutBridgeRepo(root, {
        projectId: 'timeout-blocked',
        timeouts: {
          per_turn_minutes: 30,
          action: 'escalate',
        },
        state: {
          status: 'blocked',
          phase: 'implementation',
          blocked_on: 'timeout:turn',
          blocked_reason: {
            category: 'timeout',
            blocked_at: '2026-04-19T22:00:00Z',
            turn_id: 'turn_timeout_http_002',
            recovery: {
              typed_reason: 'timeout',
              owner: 'operator',
              recovery_action: 'agentxchain resume',
              turn_retained: true,
              detail: 'Turn timeout',
            },
          },
          active_turns: {
            turn_timeout_http_002: {
              turn_id: 'turn_timeout_http_002',
              assigned_role: 'dev',
              status: 'active',
              runtime_id: 'local-dev',
              attempt: 1,
              assigned_sequence: 1,
            },
          },
        },
        ledgerEntries: [
          {
            type: 'timeout',
            scope: 'turn',
            phase: 'implementation',
            turn_id: 'turn_timeout_http_002',
            limit_minutes: 30,
            elapsed_minutes: 50,
            exceeded_by_minutes: 20,
            action: 'escalate',
            timestamp: '2026-04-19T22:10:00Z',
          },
        ],
      });

      bridge = createBridgeServer({ agentxchainDir: axcDir, dashboardDir: dashDir, port: 0 });
      ({ port } = await bridge.start());

      const res = await httpGet(port, '/api/timeouts');
      assert.equal(res.status, 200);
      const data = JSON.parse(res.body);
      assert.deepEqual(data.live, { exceeded: [], warnings: [] });
      assert.deepEqual(data.live_context, {
        awaiting_approval: false,
        pending_gate_type: null,
        requested_at: null,
      });
      assert.equal(data.events.length, 1);
      assert.equal(data.events[0].type, 'timeout');
    });

    it('AT-TIMEOUT-HTTP-007: response content-type is application/json', async () => {
      root = tmpDir();
      const { axcDir, dashDir } = writeTimeoutBridgeRepo(root, {
        projectId: 'timeout-content-type',
        timeouts: { per_turn_minutes: 30, action: 'warn' },
      });

      bridge = createBridgeServer({ agentxchainDir: axcDir, dashboardDir: dashDir, port: 0 });
      ({ port } = await bridge.start());

      const res = await httpGet(port, '/api/timeouts');
      assert.equal(res.status, 200);
      assert.ok(res.headers['content-type']?.includes('application/json'));
    });
  });
});
