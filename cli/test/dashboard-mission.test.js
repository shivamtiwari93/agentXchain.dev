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
import { WATCH_DIRECTORIES, resourcesForRelativePath } from '../src/lib/dashboard/state-reader.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const DASHBOARD_DIR = fileURLToPath(new URL('../dashboard', import.meta.url));
const DASHBOARD_APP = readFileSync(join(REPO_ROOT, 'cli', 'dashboard', 'app.js'), 'utf8');
const DASHBOARD_INDEX = readFileSync(join(REPO_ROOT, 'cli', 'dashboard', 'index.html'), 'utf8');
const CLI_DOCS = readFileSync(join(REPO_ROOT, 'website-v2', 'docs', 'cli.mdx'), 'utf8');
const DASHBOARD_MISSION_SPEC = readFileSync(join(REPO_ROOT, '.planning', 'DASHBOARD_MISSION_SURFACE_SPEC.md'), 'utf8');

function tmpRoot() {
  const dir = join(tmpdir(), `axc-dash-mission-${randomBytes(6).toString('hex')}`);
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

function writeChainReport(root, chainId, overrides = {}) {
  const reportsDir = join(root, '.agentxchain', 'reports');
  mkdirSync(reportsDir, { recursive: true });
  writeJson(join(reportsDir, `${chainId}.json`), {
    chain_id: chainId,
    started_at: '2026-04-17T00:00:00.000Z',
    completed_at: '2026-04-17T00:10:00.000Z',
    terminal_reason: 'chain_limit_reached',
    total_turns: 8,
    total_duration_ms: 600000,
    runs: [
      { run_id: 'gov-001', status: 'completed', turns: 5 },
      { run_id: 'gov-002', status: 'completed', turns: 3 },
    ],
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

describe('dashboard mission endpoint', () => {
  it('AT-DASH-MISSION-001: GET /api/missions returns newest-first mission snapshots and latest', async () => {
    const root = tmpRoot();
    rootsToCleanup.push(root);
    mkdirSync(join(root, '.agentxchain'), { recursive: true });

    writeChainReport(root, 'chain-older', {
      started_at: '2026-04-16T23:00:00.000Z',
      total_turns: 4,
      runs: [{ run_id: 'gov-old', status: 'completed', turns: 4 }],
    });
    writeChainReport(root, 'chain-newer', {
      started_at: '2026-04-17T01:00:00.000Z',
      total_turns: 9,
      runs: [{ run_id: 'gov-new-a', status: 'completed', turns: 5 }, { run_id: 'gov-new-b', status: 'completed', turns: 4 }],
    });
    writeMission(root, 'mission-older', {
      updated_at: '2026-04-16T23:30:00.000Z',
      chain_ids: ['chain-older'],
    });
    writeMission(root, 'mission-newer', {
      updated_at: '2026-04-17T01:30:00.000Z',
      chain_ids: ['chain-newer'],
      title: 'Release hardening',
      goal: 'Unify release truth',
    });
    writeJsonl(join(root, '.agentxchain', 'repo-decisions.jsonl'), [{
      id: 'DEC-901',
      category: 'governance',
      statement: 'Keep mission distinct from initiative.',
      role: 'dev',
      status: 'active',
      durability: 'repo',
    }]);

    const bridge = createBridgeServer({
      agentxchainDir: join(root, '.agentxchain'),
      dashboardDir: DASHBOARD_DIR,
      port: 0,
    });

    try {
      const { port } = await bridge.start();
      const response = await getJson(port, '/api/missions');
      assert.equal(response.status, 200);
      assert.equal(response.body.latest.mission_id, 'mission-newer');
      assert.equal(response.body.latest.total_turns, 9);
      assert.equal(response.body.latest.total_runs, 2);
      assert.equal(response.body.latest.active_repo_decisions_count, 1);
      assert.deepEqual(
        response.body.missions.map((mission) => mission.mission_id),
        ['mission-newer', 'mission-older'],
      );
    } finally {
      await bridge.stop();
    }
  });
});

describe('dashboard mission component', () => {
  it('AT-DASH-MISSION-002: Mission view renders latest-mission summary plus attached-chain lineage and recent missions', () => {
    const html = renderMission({
      missions: {
        latest: {
          mission_id: 'mission-release-hardening',
          title: 'Release hardening',
          goal: 'Unify release truth',
          derived_status: 'progressing',
          chain_count: 2,
          attached_chain_count: 2,
          missing_chain_ids: [],
          total_runs: 5,
          total_turns: 14,
          latest_chain_id: 'chain-release-001',
          latest_terminal_reason: 'chain_limit_reached',
          active_repo_decisions_count: 3,
          updated_at: '2026-04-17T01:45:00.000Z',
          created_at: '2026-04-17T01:00:00.000Z',
          chains: [
            { chain_id: 'chain-release-001', started_at: '2026-04-17T01:30:00.000Z', terminal_reason: 'chain_limit_reached', total_turns: 8, runs: [{}, {}] },
            { chain_id: 'chain-release-000', started_at: '2026-04-17T00:45:00.000Z', terminal_reason: 'completed', total_turns: 6, runs: [{}] },
          ],
        },
        missions: [
          {
            mission_id: 'mission-release-hardening',
            title: 'Release hardening',
            derived_status: 'progressing',
            chain_count: 2,
            total_runs: 5,
            total_turns: 14,
            active_repo_decisions_count: 3,
            latest_terminal_reason: 'chain_limit_reached',
            updated_at: '2026-04-17T01:45:00.000Z',
          },
        ],
      },
    });

    assert.match(html, /latest mission mission-release-hardening/);
    assert.match(html, /Release hardening/);
    assert.match(html, /Active Repo Decisions/);
    assert.match(html, /Attached Chains/);
    assert.match(html, /Recent Missions/);
    assert.match(html, /chain-release-001/);
  });
});

describe('dashboard mission contract', () => {
  it('AT-DASH-MISSION-003: shell, docs, and spec expose Mission as a shipped top-level view with /api/missions', () => {
    assert.match(DASHBOARD_APP, /import.*renderMission.*from.*components\/mission/);
    assert.match(DASHBOARD_APP, /mission:\s*\{\s*fetch:\s*\['missions'\],\s*render:\s*renderMission\s*\}/);
    assert.match(DASHBOARD_APP, /missions:\s*'\/api\/missions'/);
    assert.match(DASHBOARD_INDEX, /<a href="#mission">Mission<\/a>/);
    assert.match(CLI_DOCS, /\*\*Mission\*\*/);
    assert.match(CLI_DOCS, /\/api\/missions/);
    assert.match(CLI_DOCS, /separate from coordinator \*\*Initiative\*\*/);
    assert.match(DASHBOARD_MISSION_SPEC, /AT-DASH-MISSION-001/);
    assert.match(DASHBOARD_MISSION_SPEC, /GET \/api\/missions/);
  });

  it('AT-DASH-MISSION-004: mission invalidation watches missions and shares chain-report invalidation', () => {
    assert.ok(WATCH_DIRECTORIES.includes('missions'));
    assert.ok(WATCH_DIRECTORIES.includes('reports'));
    assert.deepEqual(resourcesForRelativePath('missions/mission-release-hardening.json'), ['/api/missions']);
    assert.deepEqual(resourcesForRelativePath('reports/chain-release-001.json'), ['/api/chain-reports', '/api/missions']);
  });
});
