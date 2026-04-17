import { strict as assert } from 'node:assert';
import { afterEach, describe, it } from 'node:test';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createBridgeServer } from '../src/lib/dashboard/bridge-server.js';
import { render as renderMission } from '../dashboard/components/mission.js';
import { WATCH_DIRECTORIES, RECURSIVE_WATCH_DIRECTORIES, resourcesForRelativePath } from '../src/lib/dashboard/state-reader.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const DASHBOARD_DIR = fileURLToPath(new URL('../dashboard', import.meta.url));
const DASHBOARD_APP = readFileSync(join(REPO_ROOT, 'cli', 'dashboard', 'app.js'), 'utf8');

function tmpRoot() {
  const dir = join(tmpdir(), `axc-dash-plan-${randomBytes(6).toString('hex')}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeJson(filePath, data) {
  writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function writeMission(root, missionId, overrides = {}) {
  const missionsDir = join(root, '.agentxchain', 'missions');
  mkdirSync(missionsDir, { recursive: true });
  const now = new Date().toISOString();
  writeJson(join(missionsDir, `${missionId}.json`), {
    mission_id: missionId,
    title: `Title for ${missionId}`,
    goal: `Goal for ${missionId}`,
    status: 'active',
    created_at: now,
    updated_at: now,
    chain_ids: [],
    ...overrides,
  });
}

function writePlan(root, missionId, planId, overrides = {}) {
  const plansDir = join(root, '.agentxchain', 'missions', 'plans', missionId);
  mkdirSync(plansDir, { recursive: true });
  const now = new Date().toISOString();
  writeJson(join(plansDir, `${planId}.json`), {
    plan_id: planId,
    mission_id: missionId,
    status: 'proposed',
    supersedes_plan_id: null,
    created_at: now,
    updated_at: now,
    input: { goal: `Goal for ${missionId}`, constraints: [], role_hints: [] },
    planner: { mode: 'llm_one_shot', model: 'test' },
    workstreams: [
      {
        workstream_id: 'ws-alpha',
        title: 'Alpha workstream',
        goal: 'Build alpha',
        roles: ['dev', 'qa'],
        phases: ['planning', 'implementation'],
        depends_on: [],
        acceptance_checks: ['Tests pass'],
        launch_status: 'ready',
      },
      {
        workstream_id: 'ws-beta',
        title: 'Beta workstream',
        goal: 'Build beta',
        roles: ['dev'],
        phases: ['implementation', 'qa'],
        depends_on: ['ws-alpha'],
        acceptance_checks: ['Integration passes'],
        launch_status: 'blocked',
      },
    ],
    launch_records: [],
    ...overrides,
  });
}

function getJson(port, path) {
  return new Promise((resolve, reject) => {
    const req = http.request(`http://127.0.0.1:${port}${path}`, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(body) });
        } catch (error) {
          reject(error);
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

const rootsToCleanup = [];

afterEach(async () => {
  while (rootsToCleanup.length > 0) {
    const root = rootsToCleanup.pop();
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {}
  }
});

describe('dashboard plan endpoint', () => {
  it('AT-DASH-PLAN-001: GET /api/plans returns newest-first plan snapshots with workstream and launch detail', async () => {
    const root = tmpRoot();
    rootsToCleanup.push(root);
    mkdirSync(join(root, '.agentxchain'), { recursive: true });

    writeMission(root, 'mission-alpha', { goal: 'Build alpha product' });

    writePlan(root, 'mission-alpha', 'plan-2026-04-17T01-00-00-000Z-0000000001-0000000001', {
      created_at: '2026-04-17T01:00:00.000Z',
      status: 'superseded',
      superseded_by_plan_id: 'plan-2026-04-17T02-00-00-000Z-0000000002-0000000002',
    });

    writePlan(root, 'mission-alpha', 'plan-2026-04-17T02-00-00-000Z-0000000002-0000000002', {
      created_at: '2026-04-17T02:00:00.000Z',
      status: 'approved',
      approved_at: '2026-04-17T02:05:00.000Z',
      supersedes_plan_id: 'plan-2026-04-17T01-00-00-000Z-0000000001-0000000001',
      launch_records: [
        {
          workstream_id: 'ws-alpha',
          chain_id: 'chain-ws-alpha-001',
          launched_at: '2026-04-17T02:10:00.000Z',
          status: 'launched',
        },
      ],
      workstreams: [
        {
          workstream_id: 'ws-alpha',
          title: 'Alpha workstream',
          goal: 'Build alpha',
          roles: ['dev', 'qa'],
          phases: ['planning', 'implementation'],
          depends_on: [],
          acceptance_checks: ['Tests pass'],
          launch_status: 'launched',
        },
        {
          workstream_id: 'ws-beta',
          title: 'Beta workstream',
          goal: 'Build beta',
          roles: ['dev'],
          phases: ['implementation'],
          depends_on: ['ws-alpha'],
          acceptance_checks: ['Integration passes'],
          launch_status: 'blocked',
        },
      ],
    });

    const bridge = createBridgeServer({
      agentxchainDir: join(root, '.agentxchain'),
      dashboardDir: DASHBOARD_DIR,
      port: 0,
    });

    try {
      const { port } = await bridge.start();
      const response = await getJson(port, '/api/plans');
      assert.equal(response.status, 200);

      // Latest plan is the approved one (newest-first)
      assert.equal(response.body.latest.plan_id, 'plan-2026-04-17T02-00-00-000Z-0000000002-0000000002');
      assert.equal(response.body.latest.status, 'approved');
      assert.equal(response.body.latest.workstream_count, 2);
      assert.equal(response.body.latest.launch_record_count, 1);
      assert.ok(response.body.latest.approved_at);

      // Workstream detail is preserved
      assert.equal(response.body.latest.workstreams[0].workstream_id, 'ws-alpha');
      assert.equal(response.body.latest.workstreams[0].launch_status, 'launched');
      assert.equal(response.body.latest.workstreams[1].workstream_id, 'ws-beta');
      assert.equal(response.body.latest.workstreams[1].launch_status, 'blocked');

      // Launch records are preserved
      assert.equal(response.body.latest.launch_records[0].chain_id, 'chain-ws-alpha-001');

      // Status counts
      assert.equal(response.body.latest.workstream_status_counts.launched, 1);
      assert.equal(response.body.latest.workstream_status_counts.blocked, 1);

      // Both plans returned newest-first
      assert.equal(response.body.plans.length, 2);
      assert.equal(response.body.plans[0].status, 'approved');
      assert.equal(response.body.plans[1].status, 'superseded');
    } finally {
      await bridge.stop();
    }
  });

  it('AT-DASH-PLAN-002: GET /api/plans?mission=<id> filters plans by mission', async () => {
    const root = tmpRoot();
    rootsToCleanup.push(root);
    mkdirSync(join(root, '.agentxchain'), { recursive: true });

    writeMission(root, 'mission-alpha');
    writeMission(root, 'mission-beta');
    writePlan(root, 'mission-alpha', 'plan-alpha-001', { created_at: '2026-04-17T01:00:00.000Z' });
    writePlan(root, 'mission-beta', 'plan-beta-001', { created_at: '2026-04-17T02:00:00.000Z' });

    const bridge = createBridgeServer({
      agentxchainDir: join(root, '.agentxchain'),
      dashboardDir: DASHBOARD_DIR,
      port: 0,
    });

    try {
      const { port } = await bridge.start();

      // Filter by mission-alpha
      const alphaResponse = await getJson(port, '/api/plans?mission=mission-alpha');
      assert.equal(alphaResponse.body.plans.length, 1);
      assert.equal(alphaResponse.body.plans[0].mission_id, 'mission-alpha');

      // All plans
      const allResponse = await getJson(port, '/api/plans');
      assert.equal(allResponse.body.plans.length, 2);
    } finally {
      await bridge.stop();
    }
  });
});

describe('dashboard plan component rendering', () => {
  it('AT-DASH-PLAN-003: Mission view renders latest plan detail with workstreams and launch records', () => {
    const html = renderMission({
      missions: {
        latest: {
          mission_id: 'mission-alpha',
          title: 'Alpha',
          goal: 'Build alpha product',
          derived_status: 'progressing',
          chain_count: 1,
          attached_chain_count: 1,
          missing_chain_ids: [],
          total_runs: 2,
          total_turns: 6,
          latest_chain_id: 'chain-ws-alpha-001',
          latest_terminal_reason: 'chain_limit_reached',
          active_repo_decisions_count: 0,
          updated_at: '2026-04-17T02:10:00.000Z',
          created_at: '2026-04-17T01:00:00.000Z',
          chains: [],
        },
        missions: [{
          mission_id: 'mission-alpha',
          title: 'Alpha',
          derived_status: 'progressing',
          chain_count: 1,
          total_runs: 2,
          total_turns: 6,
          active_repo_decisions_count: 0,
          latest_terminal_reason: 'chain_limit_reached',
          updated_at: '2026-04-17T02:10:00.000Z',
        }],
      },
      plans: {
        latest: {
          plan_id: 'plan-alpha-001',
          mission_id: 'mission-alpha',
          status: 'approved',
          created_at: '2026-04-17T01:30:00.000Z',
          approved_at: '2026-04-17T01:35:00.000Z',
          workstream_count: 2,
          launch_record_count: 1,
          workstream_status_counts: { launched: 1, blocked: 1 },
          workstreams: [
            {
              workstream_id: 'ws-alpha',
              title: 'Alpha workstream',
              goal: 'Build alpha',
              roles: ['dev', 'qa'],
              phases: ['planning', 'implementation'],
              depends_on: [],
              launch_status: 'launched',
            },
            {
              workstream_id: 'ws-beta',
              title: 'Beta workstream',
              goal: 'Build beta',
              roles: ['dev'],
              phases: ['implementation'],
              depends_on: ['ws-alpha'],
              launch_status: 'blocked',
            },
          ],
          launch_records: [
            {
              workstream_id: 'ws-alpha',
              chain_id: 'chain-ws-alpha-001',
              launched_at: '2026-04-17T02:10:00.000Z',
              status: 'launched',
            },
          ],
        },
        plans: [],
      },
    });

    // Plan summary section
    assert.match(html, /Latest Plan/);
    assert.match(html, /plan-alpha-001/);
    assert.match(html, /approved/);

    // Workstreams table
    assert.match(html, /Workstreams/);
    assert.match(html, /ws-alpha/);
    assert.match(html, /ws-beta/);
    assert.match(html, /Alpha workstream/);
    assert.match(html, /Beta workstream/);
    assert.match(html, /launched/);
    assert.match(html, /blocked/);

    // Launch records table
    assert.match(html, /Launch Records/);
    assert.match(html, /chain-ws-alpha/);
  });

  it('AT-DASH-PLAN-004: Mission view renders empty plan state with guidance', () => {
    const html = renderMission({
      missions: {
        latest: {
          mission_id: 'mission-alpha',
          title: 'Alpha',
          goal: 'Build alpha product',
          derived_status: 'planned',
          chain_count: 0,
          attached_chain_count: 0,
          missing_chain_ids: [],
          total_runs: 0,
          total_turns: 0,
          latest_chain_id: null,
          latest_terminal_reason: null,
          active_repo_decisions_count: 0,
          updated_at: '2026-04-17T01:00:00.000Z',
          created_at: '2026-04-17T01:00:00.000Z',
          chains: [],
        },
        missions: [{
          mission_id: 'mission-alpha',
          title: 'Alpha',
          derived_status: 'planned',
          chain_count: 0,
          total_runs: 0,
          total_turns: 0,
          active_repo_decisions_count: 0,
          updated_at: '2026-04-17T01:00:00.000Z',
        }],
      },
      plans: {
        latest: null,
        plans: [],
      },
    });

    assert.match(html, /Latest Plan/);
    assert.match(html, /agentxchain mission plan/);
  });
});

describe('dashboard plan contract', () => {
  it('AT-DASH-PLAN-005: app.js wires plans API and fetches for mission view', () => {
    assert.match(DASHBOARD_APP, /plans:\s*'\/api\/plans'/);
    assert.match(DASHBOARD_APP, /mission:\s*\{\s*fetch:\s*\['missions',\s*'plans'\]/);
  });

  it('AT-DASH-PLAN-006: plan file invalidation watches missions/plans recursively and maps to /api/plans + /api/missions', () => {
    assert.ok(RECURSIVE_WATCH_DIRECTORIES.includes('missions/plans'));
    const planResources = resourcesForRelativePath('missions/plans/mission-alpha/plan-001.json');
    assert.deepEqual(planResources, ['/api/plans', '/api/missions']);

    // Regular mission files still only map to /api/missions
    const missionResources = resourcesForRelativePath('missions/mission-alpha.json');
    assert.deepEqual(missionResources, ['/api/missions']);
  });
});
