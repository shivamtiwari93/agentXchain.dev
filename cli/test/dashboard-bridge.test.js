/**
 * Dashboard bridge server tests — Slice 1
 *
 * Tests the HTTP bridge server, read-only API endpoints, WebSocket
 * invalidation, and security constraints (localhost-only, no mutations).
 *
 * See: V2_DASHBOARD_SPEC.md, AT-DASH-007, AT-DASH-008.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createHash, randomBytes } from 'crypto';
import http from 'http';

import { createBridgeServer } from '../src/lib/dashboard/bridge-server.js';

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

function createTestFixture() {
  const root = tmpDir();
  const axcDir = join(root, '.agentxchain');
  const multiDir = join(axcDir, 'multirepo');
  const dashDir = join(root, 'dashboard');
  const reposDir = join(root, 'repos');
  mkdirSync(axcDir, { recursive: true });
  mkdirSync(multiDir, { recursive: true });
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

    it('POST /api/actions/approve-gate approves a repo-local pending transition before any coordinator gate', async () => {
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
      assert.match(data.message, /implementation -> qa/i);

      const updated = JSON.parse(readFileSync(join(fixture.axcDir, 'state.json'), 'utf8'));
      assert.equal(updated.phase, 'qa');
      assert.equal(updated.status, 'active');
      assert.equal(updated.pending_phase_transition, null);
    });

    it('POST /api/actions/approve-gate approves a coordinator pending gate when no repo gate exists', async () => {
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
      assert.match(data.message, /implementation -> qa/i);

      const updated = JSON.parse(readFileSync(join(fixture.multiDir, 'state.json'), 'utf8'));
      assert.equal(updated.phase, 'qa');
      assert.equal(updated.status, 'active');
      assert.equal(updated.pending_gate, null);
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
