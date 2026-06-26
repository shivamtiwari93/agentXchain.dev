/**
 * M8 Acceptance: Governed run completes via hosted runner with dashboard visibility
 *
 * Proves end-to-end lifecycle: run creation via HTTP API → execution worker
 * dispatches turns via mocked api_proxy → all 3 phases complete → run reaches
 * completed status → org dashboard reflects the completed run.
 *
 * Uses the real hosted runner stack (HTTP server, job queue, execution worker,
 * runLoop). Only dispatchApiProxy is mocked — this is the adapter boundary
 * where cloud API calls would happen.
 *
 * Acceptance criterion: ROADMAP.md:98
 */

import { strict as assert } from 'node:assert';
import { describe, it, beforeAll, afterAll, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import http from 'node:http';

// Mock dispatchApiProxy before any imports that use it
vi.mock('../src/lib/adapters/api-proxy-adapter.js', () => ({
  dispatchApiProxy: vi.fn(),
}));

import { createHostedRunner } from '../src/lib/api/hosted-runner.js';
import { loadNormalizedConfig } from '../src/lib/normalized-config.js';
import { getTurnStagingResultPath } from '../src/lib/turn-paths.js';
import { dispatchApiProxy } from '../src/lib/adapters/api-proxy-adapter.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function createGovernedProject() {
  const dir = mkdtempSync(join(tmpdir(), 'agentxchain-hosted-e2e-'));
  mkdirSync(join(dir, '.agentxchain', 'staging'), { recursive: true });
  mkdirSync(join(dir, '.planning'), { recursive: true });

  const config = {
    schema_version: '1.0',
    protocol_mode: 'governed',
    template: 'generic',
    project: {
      id: 'e2e-hosted',
      name: 'E2E Hosted Runner',
      default_branch: 'main',
    },
    roles: {
      dev: {
        title: 'Developer',
        mandate: 'Execute all phases.',
        write_authority: 'authoritative',
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
    gates: {
      planning_signoff: { requires_files: [], requires_human_approval: false },
      implementation_complete: { requires_files: [], requires_verification_pass: false },
      qa_ship_verdict: { requires_files: [], requires_human_approval: false },
    },
    phases: ['planning', 'implementation', 'qa'],
    budget: { per_turn_max_usd: 2.0, per_run_max_usd: 50.0, on_exceed: 'pause_and_escalate' },
    retention: { talk_strategy: 'append_only', history_strategy: 'jsonl_append_only' },
    prompts: {},
    rules: { challenge_required: false, max_turn_retries: 2 },
    files: { talk: 'TALK.md', history: '.agentxchain/history.jsonl', state: '.agentxchain/state.json' },
  };

  writeFileSync(join(dir, 'agentxchain.json'), JSON.stringify(config, null, 2));
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

async function waitForCondition(fn, timeoutMs = 15000, intervalMs = 500) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await fn()) return true;
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error(`Condition not met within ${timeoutMs}ms`);
}

/**
 * Build a phase-aware turn result.
 *
 * Challenge to PM spec (DEC-001): PM templates use artifact.type 'review' with
 * files_changed [] for all phases. The turn-result-validator enforces that
 * implementation-phase authoritative turns include product code in files_changed.
 * Fixed: implementation phase uses artifact.type 'workspace' with files_changed
 * ['src/feature.js'] (same fix applied in M4 crash recovery acceptance tests).
 */
function makeTurnResult(state, turnId, phase) {
  const isImpl = phase === 'implementation';
  return {
    schema_version: '1.0',
    run_id: state.run_id,
    turn_id: turnId,
    role: 'dev',
    runtime_id: 'api-dev',
    status: 'completed',
    summary: `${phase} phase complete.`,
    decisions: [{
      id: 'DEC-001',
      category: 'implementation',
      statement: `Completed ${phase}.`,
      rationale: 'Required by spec.',
    }],
    objections: [],
    files_changed: isImpl ? ['src/feature.js'] : [],
    artifacts_created: [],
    verification: {
      status: 'pass',
      commands: [],
      evidence_summary: 'Automated E2E test.',
      machine_evidence: [],
    },
    artifact: isImpl
      ? { type: 'workspace', ref: null }
      : { type: 'review', ref: null },
    proposed_next_role: phase === 'qa' ? null : 'dev',
    phase_transition_request: phase === 'planning'
      ? 'implementation'
      : (phase === 'implementation' ? 'qa' : null),
    run_completion_request: phase === 'qa' ? true : null,
    needs_human_reason: null,
    cost: { input_tokens: 1000, output_tokens: 500, usd: 0.01 },
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('M8 acceptance: governed run completes via hosted runner with dashboard visibility', () => {
  let project;
  let runner;
  let port;
  let runId;
  let createRes;
  let initialGetRes;

  beforeAll(async () => {
    project = createGovernedProject();
    port = 10000 + Math.floor(Math.random() * 50000);
    const config = loadTestConfig(project.dir);

    // Configure mock: write phase-aware staged turn results to disk
    dispatchApiProxy.mockImplementation(async (root, state, _config, opts) => {
      const turnResult = makeTurnResult(state, opts.turnId, state.phase);
      const stagingPath = join(root, getTurnStagingResultPath(opts.turnId));
      mkdirSync(dirname(stagingPath), { recursive: true });
      writeFileSync(stagingPath, JSON.stringify(turnResult, null, 2));
      return { ok: true };
    });

    runner = createHostedRunner({
      root: project.dir,
      config,
      port,
      host: '127.0.0.1',
    });
    await runner.start();

    // ── Create run via HTTP API ────────────────────────────────────────────
    createRes = await httpRequest(port, 'POST', '/v1/projects/e2e-hosted/runs', {});
    runId = createRes.body.data.run_id;

    // Capture initial GET before lifecycle modifies state
    initialGetRes = await httpRequest(port, 'GET', `/v1/runs/${runId}`);

    // ── Complete all 3 phases via job queue ─────────────────────────────────
    // Phase 1: planning → implementation
    runner.queue.enqueue({ run_id: runId, role: 'dev', runtime_class: 'api_proxy' });
    await waitForCondition(async () => {
      const res = await httpRequest(port, 'GET', `/v1/runs/${runId}`);
      return res.body.data?.phase === 'implementation';
    });

    // Phase 2: implementation → qa
    runner.queue.enqueue({ run_id: runId, role: 'dev', runtime_class: 'api_proxy' });
    await waitForCondition(async () => {
      const res = await httpRequest(port, 'GET', `/v1/runs/${runId}`);
      return res.body.data?.phase === 'qa';
    });

    // Phase 3: qa → completed
    runner.queue.enqueue({ run_id: runId, role: 'dev', runtime_class: 'api_proxy' });
    await waitForCondition(async () => {
      const res = await httpRequest(port, 'GET', `/v1/runs/${runId}`);
      return res.body.data?.status === 'completed';
    });
  }, 60_000);

  afterAll(async () => {
    if (runner) {
      await runner.stop();
    }
  });

  it('AT-M8E-001: Run created via hosted runner API', () => {
    // POST response assertions
    assert.equal(createRes.status, 201);
    assert.ok(createRes.body.data);
    assert.ok(createRes.body.data.run_id, 'run_id must be a non-null string');
    assert.equal(createRes.body.data.status, 'active');
    assert.equal(createRes.body.data.phase, 'planning');

    // GET response matches POST (captured before lifecycle started)
    assert.equal(initialGetRes.status, 200);
    assert.equal(initialGetRes.body.data.run_id, createRes.body.data.run_id);
    assert.equal(initialGetRes.body.data.status, 'active');
  });

  it('AT-M8E-002: Full governed lifecycle completes through all 3 phases', async () => {
    // dispatchApiProxy called exactly 3 times (once per phase)
    assert.equal(dispatchApiProxy.mock.calls.length, 3);

    // Phases dispatched in correct order
    assert.equal(dispatchApiProxy.mock.calls[0][1].phase, 'planning');
    assert.equal(dispatchApiProxy.mock.calls[1][1].phase, 'implementation');
    assert.equal(dispatchApiProxy.mock.calls[2][1].phase, 'qa');

    // Final run state is completed with no active turns
    const finalRes = await httpRequest(port, 'GET', `/v1/runs/${runId}`);
    assert.equal(finalRes.body.data.status, 'completed');
    const activeTurns = finalRes.body.data.active_turns;
    assert.ok(
      !activeTurns || Object.keys(activeTurns).length === 0,
      'No active turns should remain after completion',
    );
  });

  it('AT-M8E-003: Completed run reflected in org dashboard overview', async () => {
    const res = await httpRequest(port, 'GET', '/v1/org/overview');
    assert.equal(res.status, 200);
    assert.ok(res.body.data.total_projects >= 1);

    const projects = res.body.data.projects;
    assert.ok(Array.isArray(projects), 'projects must be an array');

    // Find the test project — its state should reflect the completed run
    const testProject = projects.find(p => p.state?.run_id === runId);
    assert.ok(testProject, 'Test project with completed run must appear in overview');
    assert.equal(testProject.state.status, 'completed');
  });

  it('AT-M8E-004: Turn history accessible via API after completion', async () => {
    const res = await httpRequest(port, 'GET', `/v1/runs/${runId}/turns`);
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.data), 'turns data must be an array');
    assert.ok(res.body.data.length >= 3, `Expected at least 3 history entries, got ${res.body.data.length}`);

    // Each entry has dev role and completed status
    for (const entry of res.body.data) {
      assert.equal(entry.role, 'dev');
      assert.equal(entry.status, 'completed');
    }

    // Entries span all 3 phases
    const phases = new Set(res.body.data.map(e => e.phase));
    assert.ok(phases.has('planning'), 'History must include planning phase');
    assert.ok(phases.has('implementation'), 'History must include implementation phase');
    assert.ok(phases.has('qa'), 'History must include qa phase');
  });

  it('AT-M8E-005: Governance decisions accessible after completion', async () => {
    const res = await httpRequest(port, 'GET', `/v1/runs/${runId}/decisions`);
    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.data), 'decisions data must be an array');
    assert.ok(res.body.data.length >= 1, `Expected at least 1 decision, got ${res.body.data.length}`);

    // Decision entries have required fields
    for (const dec of res.body.data) {
      assert.ok(dec.id, 'Decision must have id');
      assert.ok(dec.category, 'Decision must have category');
      assert.ok(dec.statement, 'Decision must have statement');
    }
  });
});
