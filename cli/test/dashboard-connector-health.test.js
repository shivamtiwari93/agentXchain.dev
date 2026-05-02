import { afterAll, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';
import http from 'http';

import { createBridgeServer } from '../src/lib/dashboard/bridge-server.js';
import { render as renderTimeline } from '../dashboard/components/timeline.js';

const dirs = [];
const bridges = [];

function tmpDir() {
  const dir = join(tmpdir(), `axc-dash-connectors-${randomBytes(6).toString('hex')}`);
  mkdirSync(dir, { recursive: true });
  dirs.push(dir);
  return dir;
}

function writeJson(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
}

function httpGet(port, path) {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://127.0.0.1:${port}${path}`, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.setTimeout(5000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function createFixture() {
  const root = tmpDir();
  const agentxchainDir = join(root, '.agentxchain');
  const dashboardDir = join(root, 'dashboard');
  mkdirSync(agentxchainDir, { recursive: true });
  mkdirSync(join(agentxchainDir, 'staging', 'turn-qa-004'), { recursive: true });
  mkdirSync(dashboardDir, { recursive: true });

  writeJson(join(root, 'agentxchain.json'), {
    schema_version: '1.0',
    template: 'generic',
    project: { id: 'dashboard-connectors', name: 'Dashboard Connectors', default_branch: 'main' },
    roles: {
      dev: { title: 'Developer', mandate: 'Build.', write_authority: 'authoritative', runtime: 'local-dev' },
      qa: { title: 'QA', mandate: 'Verify.', write_authority: 'review_only', runtime: 'api-qa' },
    },
    runtimes: {
      'local-dev': { type: 'local_cli', command: ['claude', '--print'], prompt_transport: 'stdin' },
      'api-qa': { type: 'api_proxy', provider: 'anthropic', model: 'claude-sonnet-4-6', auth_env: 'ANTHROPIC_API_KEY' },
      'manual-pm': { type: 'manual' },
    },
    routing: {
      implementation: { entry_role: 'dev', allowed_next_roles: ['dev', 'qa', 'human'] },
      qa: { entry_role: 'qa', allowed_next_roles: ['dev', 'qa', 'human'] },
    },
    gates: {},
  });

  writeJson(join(agentxchainDir, 'state.json'), {
    schema_version: '1.1',
    project_id: 'dashboard-connectors',
    run_id: 'run_dashboard_connectors',
    status: 'active',
    phase: 'qa',
    active_turns: {
      'turn-dev-004': {
        turn_id: 'turn-dev-004',
        assigned_role: 'dev',
        runtime_id: 'local-dev',
        status: 'running',
        attempt: 1,
      },
    },
  });

  writeFileSync(join(agentxchainDir, 'history.jsonl'), [
    JSON.stringify({
      turn_id: 'turn-qa-004',
      role: 'qa',
      runtime_id: 'api-qa',
      phase: 'qa',
      accepted_at: '2026-04-10T15:00:03Z',
    }),
  ].join('\n') + '\n');

  writeJson(join(agentxchainDir, 'staging', 'turn-qa-004', 'retry-trace.json'), {
    runtime_id: 'api-qa',
    turn_id: 'turn-qa-004',
    attempts_made: 2,
    final_outcome: 'success',
    attempts: [
      {
        attempt: 2,
        started_at: '2026-04-10T15:00:01.000Z',
        completed_at: '2026-04-10T15:00:01.250Z',
        outcome: 'success',
      },
    ],
  });

  writeFileSync(join(dashboardDir, 'index.html'), '<html><body>Dashboard</body></html>');
  writeFileSync(join(dashboardDir, 'app.js'), 'console.log("dashboard");');

  return { root, agentxchainDir, dashboardDir };
}

afterAll(async () => {
  for (const bridge of bridges) {
    await bridge.stop();
  }
  for (const dir of dirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('dashboard connector health surface', () => {
  it('AT-DASH-CH-001: GET /api/connectors returns computed connector health payload', async () => {
    const fixture = createFixture();
    const bridge = createBridgeServer({ agentxchainDir: fixture.agentxchainDir, dashboardDir: fixture.dashboardDir, port: 0 });
    bridges.push(bridge);
    const { port } = await bridge.start();

    const response = await httpGet(port, '/api/connectors');
    assert.equal(response.status, 200);
    const payload = JSON.parse(response.body);
    assert.equal(payload.ok, true);
    assert.equal(payload.connectors.length, 2);
    assert.equal(payload.connectors[0].runtime_id, 'api-qa');
    assert.equal(payload.connectors[0].state, 'healthy');
    assert.equal(payload.connectors[1].runtime_id, 'local-dev');
    assert.equal(payload.connectors[1].state, 'active');
  });

  it('AT-DASH-CH-002: timeline renders connector health without adding a top-level view', () => {
    const html = renderTimeline({
      state: {
        run_id: 'run_dashboard_connectors',
        status: 'active',
        phase: 'qa',
        active_turns: {},
      },
      connectors: {
        connectors: [
          {
            runtime_id: 'api-qa',
            type: 'api_proxy',
            target: 'anthropic / claude-sonnet-4-6',
            state: 'healthy',
            reachable: 'yes',
            active_turn_ids: [],
            last_success_at: '2026-04-10T15:00:03Z',
            last_failure_at: null,
            last_error: null,
            attempts_made: 2,
            latency_ms: 250,
          },
          {
            runtime_id: 'local-dev',
            type: 'local_cli',
            target: 'claude --print',
            state: 'active',
            reachable: 'unknown',
            active_turn_ids: ['turn-dev-004'],
            last_success_at: null,
            last_failure_at: null,
            last_error: null,
            attempts_made: null,
            latency_ms: null,
          },
        ],
      },
      history: [],
    });

    assert.match(html, /Connector Health/);
    assert.match(html, /api-qa/);
    assert.match(html, /anthropic \/ claude-sonnet-4-6/);
    assert.match(html, /local-dev/);
    assert.match(html, /turn-dev-004/);
  });
});
