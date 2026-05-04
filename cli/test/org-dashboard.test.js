/**
 * Integration tests for the org dashboard — project registry, org aggregator,
 * and org routes on the hosted runner.
 *
 * Tests cover: project registration CRUD, cross-project aggregation, org routes,
 * and multi-project scenarios with isolated temp directories.
 *
 * Follows hosted-runner.test.js patterns: temp dirs, node:http requests, beforeEach/afterEach.
 */

import { strict as assert } from 'node:assert';
import { describe, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';

import { loadNormalizedConfig } from '../src/lib/normalized-config.js';
import { createHostedRunner } from '../src/lib/api/hosted-runner.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function createGovernedProject(overrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'agentxchain-org-dashboard-test-'));
  mkdirSync(join(dir, '.agentxchain', 'staging'), { recursive: true });
  mkdirSync(join(dir, '.planning'), { recursive: true });

  const config = {
    schema_version: '1.0',
    protocol_mode: 'governed',
    template: 'generic',
    project: {
      id: overrides.projectId || 'org-test',
      name: overrides.projectName || 'Org Test',
      default_branch: 'main',
    },
    roles: {
      dev: {
        title: 'Developer',
        mandate: 'Implement.',
        write_authority: 'review_only',
        runtime: 'api-dev',
      },
    },
    runtimes: {
      'api-dev': {
        type: 'api_proxy',
        provider: 'anthropic',
        model: 'claude-sonnet-4-6',
        auth_env: 'ANTHROPIC_API_KEY',
      },
    },
    routing: {
      planning: { entry_role: 'dev', allowed_next_roles: ['dev', 'human'], exit_gate: 'planning_signoff' },
      implementation: { entry_role: 'dev', allowed_next_roles: ['dev', 'human'], exit_gate: 'implementation_complete' },
      qa: { entry_role: 'dev', allowed_next_roles: ['dev', 'human'], exit_gate: 'qa_ship_verdict' },
    },
    phases: ['planning', 'implementation', 'qa'],
  };

  writeFileSync(join(dir, 'agentxchain.json'), JSON.stringify(config, null, 2));

  // Write state.json if requested
  if (overrides.state) {
    writeFileSync(
      join(dir, '.agentxchain', 'state.json'),
      JSON.stringify(overrides.state, null, 2)
    );
  }

  // Write decision ledger if requested
  if (overrides.decisions) {
    const lines = overrides.decisions.map(d => JSON.stringify(d)).join('\n');
    writeFileSync(join(dir, '.agentxchain', 'decision-ledger.jsonl'), lines);
  }

  // Write history if requested
  if (overrides.history) {
    const lines = overrides.history.map(h => JSON.stringify(h)).join('\n');
    writeFileSync(join(dir, '.agentxchain', 'history.jsonl'), lines);
  }

  return { dir, config };
}

function loadTestConfig(dir) {
  const raw = JSON.parse(readFileSync(join(dir, 'agentxchain.json'), 'utf8'));
  const result = loadNormalizedConfig(raw, dir);
  return result.ok ? result.normalized : raw;
}

function httpRequest(port, method, path, body) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: '127.0.0.1',
      port,
      path,
      method,
      headers: { 'Content-Type': 'application/json' },
    };

    const req = http.request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let data = null;
        try { data = JSON.parse(raw); } catch { data = raw; }
        resolve({ status: res.statusCode, body: data });
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Org Dashboard — AT-OD', () => {
  let primary;
  let runner;
  let port;
  const tempDirs = [];

  beforeEach(async () => {
    primary = createGovernedProject({
      projectId: 'primary-proj',
      projectName: 'Primary Project',
      state: {
        run_id: 'run_primary_001',
        status: 'active',
        phase: 'implementation',
        active_turns: { turn_a: { assigned_role: 'dev' } },
        cost_tracker: { total_cost_usd: 5.50 },
        gates: {
          planning_signoff: 'passed',
          implementation_complete: 'pending',
        },
        created_at: '2026-05-01T00:00:00Z',
        updated_at: '2026-05-04T12:00:00Z',
      },
      decisions: [
        { id: 'DEC-001', phase: 'planning', role: 'pm', runtime_id: 'local-opus-4.7', category: 'architecture', statement: 'Use flat registry', rationale: 'MVP simplicity' },
        { id: 'DEC-002', phase: 'implementation', role: 'dev', runtime_id: 'local-opus-4.7', category: 'implementation', statement: 'Fix path resolution', rationale: 'PM cited wrong path' },
      ],
      history: [
        { turn_id: 'turn_001', role: 'pm', status: 'completed' },
      ],
    });
    tempDirs.push(primary.dir);

    port = 10000 + Math.floor(Math.random() * 50000);
    const config = loadTestConfig(primary.dir);
    runner = createHostedRunner({
      root: primary.dir,
      config,
      port,
      host: '127.0.0.1',
    });
    await runner.start();
  });

  afterEach(async () => {
    if (runner) await runner.stop();
    for (const dir of tempDirs) {
      try { rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
    }
    tempDirs.length = 0;
  });

  it('AT-OD-001: Register project via POST /v1/org/projects returns 201', async () => {
    const secondary = createGovernedProject({
      projectId: 'secondary-proj',
      projectName: 'Secondary',
    });
    tempDirs.push(secondary.dir);

    const res = await httpRequest(port, 'POST', '/v1/org/projects', {
      root: secondary.dir,
      name: 'My Secondary',
    });

    assert.equal(res.status, 201);
    assert.ok(res.body.data);
    assert.ok(res.body.data.id);
    assert.equal(res.body.data.name, 'My Secondary');
    assert.equal(res.body.data.root, secondary.dir);
  });

  it('AT-OD-002: List projects via GET /v1/org/projects returns registered projects', async () => {
    const res = await httpRequest(port, 'GET', '/v1/org/projects');

    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.data));
    assert.ok(res.body.data.length >= 1, 'Should have at least the primary project');

    const primaryEntry = res.body.data.find(p => p.is_primary);
    assert.ok(primaryEntry, 'Primary project should be in the list');
    assert.equal(primaryEntry.root, primary.dir);
  });

  it('AT-OD-003: Unregister project via DELETE /v1/org/projects/:id returns 200', async () => {
    // Register a secondary project
    const secondary = createGovernedProject({ projectId: 'del-proj' });
    tempDirs.push(secondary.dir);

    const regRes = await httpRequest(port, 'POST', '/v1/org/projects', {
      root: secondary.dir,
    });
    assert.equal(regRes.status, 201);
    const projId = regRes.body.data.id;

    // Unregister it
    const delRes = await httpRequest(port, 'DELETE', `/v1/org/projects/${projId}`);
    assert.equal(delRes.status, 200);
    assert.ok(delRes.body.ok);

    // Verify it's gone from the list
    const listRes = await httpRequest(port, 'GET', '/v1/org/projects');
    const ids = listRes.body.data.map(p => p.id);
    assert.ok(!ids.includes(projId), 'Unregistered project should not appear in list');
  });

  it('AT-OD-004: Org overview returns correct aggregated metrics', async () => {
    const res = await httpRequest(port, 'GET', '/v1/org/overview');

    assert.equal(res.status, 200);
    assert.ok(res.body.data);
    assert.ok(res.body.data.total_projects >= 1, 'At least 1 project');
    assert.ok(Array.isArray(res.body.data.projects));
    assert.ok(res.body.data.projects.length >= 1);

    // Primary project should show its state
    const primaryProj = res.body.data.projects.find(p => p.root === primary.dir);
    assert.ok(primaryProj, 'Primary project should appear in overview');
    assert.equal(primaryProj.state.run_id, 'run_primary_001');
    assert.equal(primaryProj.state.status, 'active');
    assert.equal(primaryProj.state.phase, 'implementation');
  });

  it('AT-OD-005: Cross-project runs include project attribution', async () => {
    const res = await httpRequest(port, 'GET', '/v1/org/runs');

    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.data));

    for (const run of res.body.data) {
      assert.ok(run.project_id, 'Each run must have project_id');
      assert.ok(run.project_name, 'Each run must have project_name');
    }

    // Primary project has an active run
    if (res.body.data.length > 0) {
      const primaryRun = res.body.data.find(r => r.run_id === 'run_primary_001');
      assert.ok(primaryRun, 'Primary project run should appear');
      assert.equal(primaryRun.status, 'active');
    }
  });

  it('AT-OD-006: Cross-project decisions include project attribution', async () => {
    const res = await httpRequest(port, 'GET', '/v1/org/decisions');

    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.data));

    for (const dec of res.body.data) {
      assert.ok(dec.project_id, 'Each decision must have project_id');
      assert.ok(dec.project_name, 'Each decision must have project_name');
    }

    // Primary project should have its 2 decisions
    const primaryDecs = res.body.data.filter(d =>
      d.project_id === res.body.data[0]?.project_id
    );
    assert.ok(primaryDecs.length >= 2, 'Primary project should have at least 2 decisions');
  });

  it('AT-OD-007: Multi-project aggregation shows all registered projects', async () => {
    // Create 2 additional projects with different states
    const projA = createGovernedProject({
      projectId: 'proj-alpha',
      projectName: 'Alpha',
      state: {
        run_id: 'run_alpha_001',
        status: 'active',
        phase: 'qa',
        active_turns: {},
        cost_tracker: { total_cost_usd: 3.00 },
        gates: {},
        updated_at: '2026-05-04T10:00:00Z',
      },
      decisions: [
        { id: 'DEC-001', phase: 'qa', role: 'qa', category: 'quality', statement: 'Ship it', rationale: 'All tests pass' },
      ],
    });
    tempDirs.push(projA.dir);

    const projB = createGovernedProject({
      projectId: 'proj-beta',
      projectName: 'Beta',
      state: {
        run_id: 'run_beta_001',
        status: 'blocked',
        phase: 'planning',
        active_turns: {},
        cost_tracker: { total_cost_usd: 1.25 },
        gates: { planning_signoff: 'pending' },
        updated_at: '2026-05-03T08:00:00Z',
      },
    });
    tempDirs.push(projB.dir);

    // Register both
    const regA = await httpRequest(port, 'POST', '/v1/org/projects', { root: projA.dir });
    assert.equal(regA.status, 201);
    const regB = await httpRequest(port, 'POST', '/v1/org/projects', { root: projB.dir });
    assert.equal(regB.status, 201);

    // Get overview
    const res = await httpRequest(port, 'GET', '/v1/org/overview');
    assert.equal(res.status, 200);

    const overview = res.body.data;
    assert.ok(overview.total_projects >= 3, `Expected >= 3 projects, got ${overview.total_projects}`);

    // Both new projects should appear
    const roots = overview.projects.map(p => p.root);
    assert.ok(roots.includes(projA.dir), 'Alpha project should appear in overview');
    assert.ok(roots.includes(projB.dir), 'Beta project should appear in overview');

    // Verify aggregated metrics include both
    assert.ok(overview.active_runs >= 2, 'Should count active runs from primary + alpha');
    assert.ok(overview.total_cost_usd >= 9.75, 'Should aggregate costs from all projects');
  });

  it('AT-OD-008: Unregistered project excluded from aggregation', async () => {
    // Register a temp project
    const temp = createGovernedProject({
      projectId: 'temp-proj',
      projectName: 'Temporary',
      state: {
        run_id: 'run_temp_001',
        status: 'active',
        phase: 'planning',
        active_turns: {},
        cost_tracker: { total_cost_usd: 2.00 },
        gates: {},
      },
    });
    tempDirs.push(temp.dir);

    const regRes = await httpRequest(port, 'POST', '/v1/org/projects', { root: temp.dir });
    assert.equal(regRes.status, 201);
    const tempId = regRes.body.data.id;

    // Verify it appears in overview
    const beforeRes = await httpRequest(port, 'GET', '/v1/org/overview');
    const beforeRoots = beforeRes.body.data.projects.map(p => p.root);
    assert.ok(beforeRoots.includes(temp.dir), 'Temp project should appear before unregister');

    // Unregister
    const delRes = await httpRequest(port, 'DELETE', `/v1/org/projects/${tempId}`);
    assert.equal(delRes.status, 200);

    // Verify it's excluded from overview
    const afterRes = await httpRequest(port, 'GET', '/v1/org/overview');
    const afterRoots = afterRes.body.data.projects.map(p => p.root);
    assert.ok(!afterRoots.includes(temp.dir), 'Temp project should be gone after unregister');
  });
});
