/**
 * Dashboard bridge HTTP contract proof — resource-endpoint gap closure.
 *
 * Closes the HTTP-level bridge coverage gap identified in Turn 7:
 *   - /api/workflow-kit-artifacts had only helper-level proof
 *     (workflow-kit-dashboard.test.js calls readWorkflowKitArtifacts()
 *     directly; no route was exercised).
 *   - /api/run-history had only helper-level proof
 *     (run-history.test.js calls queryRunHistory() directly; no route
 *     was exercised). AT-RH-007 in RUN_HISTORY_SPEC.md explicitly names
 *     this endpoint as an acceptance-test target.
 *
 * Pattern follows dashboard-event-stream.test.js: boot a real bridge on
 * port 0, drive it with http.get, assert on status + parsed body.
 *
 * See:
 *   - WORKFLOW_KIT_DASHBOARD_SPEC.md (AT-WKDASH-008, AT-WKDASH-009)
 *   - RUN_HISTORY_SPEC.md (AT-RH-007)
 *   - DEC-DPOLL-HTTP-CONTRACT-001 (same "prove the route, not the helper"
 *     standard applied to /api/poll in Turn 6)
 */

import { describe, it, beforeAll, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, appendFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';
import http from 'http';

import { createBridgeServer } from '../src/lib/dashboard/bridge-server.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

function tmpDir(tag) {
  const dir = join(tmpdir(), `axc-bridge-resource-${tag}-${randomBytes(6).toString('hex')}`);
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

function writeJson(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
}

function scaffoldDashboardDir(root) {
  const dashboardDir = join(root, 'dashboard');
  mkdirSync(dashboardDir, { recursive: true });
  writeFileSync(join(dashboardDir, 'index.html'), '<html></html>');
  return dashboardDir;
}

async function startBridge(root) {
  const dashboardDir = scaffoldDashboardDir(root);
  const bridge = createBridgeServer({
    agentxchainDir: join(root, '.agentxchain'),
    dashboardDir,
    port: 0,
  });
  const { port } = await bridge.start();
  return { bridge, port };
}

function writeWorkflowKitConfig(root, { workflowKit = 'planning-only', phase = 'planning' } = {}) {
  mkdirSync(join(root, '.agentxchain'), { recursive: true });
  const config = {
    schema_version: '1.0',
    template: 'generic',
    project: { id: 'bridge-resource', name: 'Bridge Resource', default_branch: 'main' },
    roles: {
      pm: {
        title: 'PM',
        mandate: 'Plan',
        write_authority: 'review_only',
        runtime: 'manual-pm',
      },
    },
    runtimes: { 'manual-pm': { type: 'manual' } },
    routing: {
      planning: { entry_role: 'pm', allowed_next_roles: ['pm', 'human'] },
    },
    gates: {},
  };
  if (workflowKit === 'opt-out') {
    // `workflow_kit: {}` is the explicit opt-out recognised by the
    // normalizer (normalized-config.js:1296). Defaults are NOT injected.
    config.workflow_kit = {};
  } else if (workflowKit === 'planning-only') {
    config.workflow_kit = {
      phases: {
        planning: {
          artifacts: [
            { path: '.planning/SYSTEM_SPEC.md', required: true, semantics: 'system_spec', owned_by: 'pm' },
            { path: '.planning/PM_SIGNOFF.md', required: true, semantics: 'pm_signoff' },
          ],
        },
      },
    };
    // Seed one of the two artifacts so "exists" distinguishes both states.
    mkdirSync(join(root, '.planning'), { recursive: true });
    writeFileSync(join(root, '.planning', 'SYSTEM_SPEC.md'), '# spec\n');
  }
  writeJson(join(root, 'agentxchain.json'), config);
  writeJson(join(root, '.agentxchain', 'state.json'), {
    schema_version: '1.1',
    project_id: 'bridge-resource',
    run_id: 'run_http_001',
    status: 'active',
    phase,
    active_turns: {},
    turn_sequence: 0,
  });
}

// ── /api/workflow-kit-artifacts HTTP contract ───────────────────────────────

describe('HTTP contract — /api/workflow-kit-artifacts', () => {
  it('AT-WKDASH-HTTP-001: returns 404 config_missing when agentxchain.json absent', async () => {
    const root = tmpDir('wk-no-cfg');
    mkdirSync(join(root, '.agentxchain'), { recursive: true });
    const { bridge, port } = await startBridge(root);
    try {
      const res = await httpGet(port, '/api/workflow-kit-artifacts');
      assert.equal(res.status, 404);
      const body = JSON.parse(res.body);
      assert.equal(body.ok, false);
      assert.equal(body.code, 'config_missing');
      assert.match(body.error, /agentxchain init --governed/);
    } finally {
      await bridge.stop();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('AT-WKDASH-HTTP-002: returns 404 state_missing when state.json absent', async () => {
    const root = tmpDir('wk-no-state');
    mkdirSync(join(root, '.agentxchain'), { recursive: true });
    writeJson(join(root, 'agentxchain.json'), {
      schema_version: '1.0',
      template: 'generic',
      project: { id: 'wk-no-state', name: 'WK No State', default_branch: 'main' },
      roles: { pm: { title: 'PM', mandate: 'Plan', write_authority: 'review_only', runtime: 'manual-pm' } },
      runtimes: { 'manual-pm': { type: 'manual' } },
      routing: { planning: { entry_role: 'pm' } },
      gates: {},
    });
    const { bridge, port } = await startBridge(root);
    try {
      const res = await httpGet(port, '/api/workflow-kit-artifacts');
      assert.equal(res.status, 404);
      const body = JSON.parse(res.body);
      assert.equal(body.ok, false);
      assert.equal(body.code, 'state_missing');
    } finally {
      await bridge.stop();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('AT-WKDASH-HTTP-003: returns 200 with empty artifacts[] for explicit workflow_kit opt-out', async () => {
    // `workflow_kit: {}` is a recognised opt-out. The normaliser keeps
    // `phases: {}` and `readWorkflowKitArtifacts` returns `artifacts: []`
    // for the current phase (since `config.workflow_kit.phases[phase]`
    // is undefined).
    const root = tmpDir('wk-opt-out');
    writeWorkflowKitConfig(root, { workflowKit: 'opt-out' });
    const { bridge, port } = await startBridge(root);
    try {
      const res = await httpGet(port, '/api/workflow-kit-artifacts');
      assert.equal(res.status, 200);
      const body = JSON.parse(res.body);
      assert.equal(body.ok, true);
      assert.equal(body.phase, 'planning');
      assert.deepEqual(body.artifacts, []);
    } finally {
      await bridge.stop();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('AT-WKDASH-HTTP-004: returns 200 with artifacts array including exists + owner_resolution', async () => {
    const root = tmpDir('wk-full');
    writeWorkflowKitConfig(root, { workflowKit: 'planning-only' });
    const { bridge, port } = await startBridge(root);
    try {
      const res = await httpGet(port, '/api/workflow-kit-artifacts');
      assert.equal(res.status, 200);
      const body = JSON.parse(res.body);
      assert.equal(body.ok, true);
      assert.equal(body.phase, 'planning');
      assert.ok(Array.isArray(body.artifacts), 'artifacts is array');
      assert.equal(body.artifacts.length, 2);

      const spec = body.artifacts.find(a => a.path === '.planning/SYSTEM_SPEC.md');
      assert.ok(spec, 'spec artifact present');
      assert.equal(spec.exists, true);
      assert.equal(spec.owned_by, 'pm');
      assert.equal(spec.owner_resolution, 'explicit');

      const signoff = body.artifacts.find(a => a.path === '.planning/PM_SIGNOFF.md');
      assert.ok(signoff, 'signoff artifact present');
      assert.equal(signoff.exists, false);
      assert.equal(signoff.owned_by, 'pm', 'entry_role fallback');
      assert.equal(signoff.owner_resolution, 'entry_role');
    } finally {
      await bridge.stop();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('AT-WKDASH-HTTP-005: returns 200 with empty artifacts[] when current phase has no workflow_kit entry', async () => {
    const root = tmpDir('wk-other-phase');
    writeWorkflowKitConfig(root, { workflowKit: 'planning-only', phase: 'implementation' });
    const { bridge, port } = await startBridge(root);
    try {
      const res = await httpGet(port, '/api/workflow-kit-artifacts');
      assert.equal(res.status, 200);
      const body = JSON.parse(res.body);
      assert.equal(body.ok, true);
      assert.equal(body.phase, 'implementation');
      assert.deepEqual(body.artifacts, []);
    } finally {
      await bridge.stop();
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ── /api/run-history HTTP contract ──────────────────────────────────────────

describe('HTTP contract — /api/run-history (AT-RH-007)', () => {
  function scaffoldGovernedRoot(tag) {
    const root = tmpDir(tag);
    mkdirSync(join(root, '.agentxchain'), { recursive: true });
    writeJson(join(root, 'agentxchain.json'), {
      schema_version: '1.0',
      template: 'generic',
      project: { id: tag, name: tag, default_branch: 'main' },
      roles: { pm: { title: 'PM', mandate: 'Plan', write_authority: 'review_only', runtime: 'manual-pm' } },
      runtimes: { 'manual-pm': { type: 'manual' } },
      routing: { planning: { entry_role: 'pm' } },
      gates: {},
    });
    return root;
  }

  function appendHistory(root, entry) {
    appendFileSync(join(root, '.agentxchain', 'run-history.jsonl'), JSON.stringify(entry) + '\n');
  }

  it('AT-RH-HTTP-001: returns 200 with empty array when run-history.jsonl missing', async () => {
    const root = scaffoldGovernedRoot('rh-missing');
    const { bridge, port } = await startBridge(root);
    try {
      const res = await httpGet(port, '/api/run-history');
      assert.equal(res.status, 200);
      const body = JSON.parse(res.body);
      assert.ok(Array.isArray(body));
      assert.equal(body.length, 0);
    } finally {
      await bridge.stop();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('AT-RH-HTTP-002: returns 200 with empty array when run-history.jsonl is empty', async () => {
    const root = scaffoldGovernedRoot('rh-empty');
    writeFileSync(join(root, '.agentxchain', 'run-history.jsonl'), '');
    const { bridge, port } = await startBridge(root);
    try {
      const res = await httpGet(port, '/api/run-history');
      assert.equal(res.status, 200);
      const body = JSON.parse(res.body);
      assert.deepEqual(body, []);
    } finally {
      await bridge.stop();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('AT-RH-HTTP-003: returns entries most-recent-first (append order reversed)', async () => {
    const root = scaffoldGovernedRoot('rh-order');
    appendHistory(root, { run_id: 'run_a', status: 'completed', total_turns: 1, recorded_at: '2026-04-01T00:00:00Z' });
    appendHistory(root, { run_id: 'run_b', status: 'completed', total_turns: 2, recorded_at: '2026-04-02T00:00:00Z' });
    appendHistory(root, { run_id: 'run_c', status: 'blocked', total_turns: 3, recorded_at: '2026-04-03T00:00:00Z' });
    const { bridge, port } = await startBridge(root);
    try {
      const res = await httpGet(port, '/api/run-history');
      assert.equal(res.status, 200);
      const body = JSON.parse(res.body);
      assert.equal(body.length, 3);
      assert.deepEqual(
        body.map(e => e.run_id),
        ['run_c', 'run_b', 'run_a'],
        'most-recent-first order',
      );
    } finally {
      await bridge.stop();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('AT-RH-HTTP-004: honours ?limit=N by returning only the N most-recent entries', async () => {
    const root = scaffoldGovernedRoot('rh-limit');
    for (let i = 1; i <= 5; i += 1) {
      appendHistory(root, {
        run_id: `run_${i}`,
        status: 'completed',
        total_turns: i,
        recorded_at: `2026-04-0${i}T00:00:00Z`,
      });
    }
    const { bridge, port } = await startBridge(root);
    try {
      const res = await httpGet(port, '/api/run-history?limit=2');
      assert.equal(res.status, 200);
      const body = JSON.parse(res.body);
      assert.equal(body.length, 2);
      assert.deepEqual(body.map(e => e.run_id), ['run_5', 'run_4']);
    } finally {
      await bridge.stop();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('AT-RH-HTTP-005: skips corrupt JSONL lines without failing the route', async () => {
    const root = scaffoldGovernedRoot('rh-corrupt');
    const historyPath = join(root, '.agentxchain', 'run-history.jsonl');
    appendFileSync(historyPath, JSON.stringify({ run_id: 'run_ok', status: 'completed', total_turns: 1 }) + '\n');
    appendFileSync(historyPath, '{this is not valid json\n');
    appendFileSync(historyPath, JSON.stringify({ run_id: 'run_ok_2', status: 'completed', total_turns: 2 }) + '\n');
    const { bridge, port } = await startBridge(root);
    try {
      const res = await httpGet(port, '/api/run-history');
      assert.equal(res.status, 200);
      const body = JSON.parse(res.body);
      assert.equal(body.length, 2, 'corrupt line filtered; two valid entries returned');
      assert.deepEqual(body.map(e => e.run_id), ['run_ok_2', 'run_ok']);
    } finally {
      await bridge.stop();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
