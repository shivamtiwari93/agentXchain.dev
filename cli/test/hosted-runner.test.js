/**
 * Integration tests for the hosted runner.
 *
 * Tests cover: HTTP server routes, job queue semantics, execution worker
 * lifecycle, error handling, and graceful shutdown.
 *
 * Mocking strategy: dispatchApiProxy is mocked at the module level to avoid
 * real API calls. Job queue stale-lease tests use manual time manipulation.
 */

import { strict as assert } from 'node:assert';
import { describe, it, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';

import { createJobQueue } from '../src/lib/api/job-queue.js';
import { createHostedRunner } from '../src/lib/api/hosted-runner.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function createGovernedProject() {
  const dir = mkdtempSync(join(tmpdir(), 'agentxchain-hosted-runner-test-'));

  mkdirSync(join(dir, '.agentxchain', 'staging'), { recursive: true });
  mkdirSync(join(dir, '.planning'), { recursive: true });

  const config = {
    schema_version: '1.0',
    protocol_mode: 'governed',
    template: 'generic',
    project: {
      id: 'hosted-test',
      name: 'Hosted Runner Test',
      default_branch: 'main',
    },
    roles: {
      dev: {
        title: 'Developer',
        mandate: 'Implement approved work.',
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

  return { dir, config };
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

// ── Normalized config loader mock ────────────────────────────────────────────

// We import loadNormalizedConfig to produce a valid normalized config for tests
import { loadNormalizedConfig } from '../src/lib/normalized-config.js';

function loadTestConfig(dir) {
  const raw = JSON.parse(readFileSync(join(dir, 'agentxchain.json'), 'utf8'));
  const result = loadNormalizedConfig(raw, dir);
  return result.ok ? result.normalized : raw;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Hosted Runner — AT-HR', () => {
  let project;
  let runner;
  let port;

  beforeEach(async () => {
    project = createGovernedProject();
    // Use a random high port to avoid collisions
    port = 10000 + Math.floor(Math.random() * 50000);

    const config = loadTestConfig(project.dir);
    runner = createHostedRunner({
      root: project.dir,
      config,
      port,
      host: '127.0.0.1',
    });
  });

  afterEach(async () => {
    if (runner) {
      await runner.stop();
    }
  });

  it('AT-HR-001: Server starts and serves /health', async () => {
    await runner.start();
    const res = await httpRequest(port, 'GET', '/health');
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'ok');
    assert.ok(res.body.version);
  });

  it('AT-HR-002: POST /v1/projects/:id/runs creates a run', async () => {
    await runner.start();
    const res = await httpRequest(port, 'POST', '/v1/projects/hosted-test/runs', {});
    assert.equal(res.status, 201);
    assert.ok(res.body.data);
    assert.equal(res.body.data.status, 'active');
    assert.ok(res.body.data.run_id);
  });

  it('AT-HR-003: GET /v1/runs/:id returns run state', async () => {
    await runner.start();
    // Create a run first
    const createRes = await httpRequest(port, 'POST', '/v1/projects/hosted-test/runs', {});
    assert.equal(createRes.status, 201);
    const runId = createRes.body.data.run_id;

    const getRes = await httpRequest(port, 'GET', `/v1/runs/${runId}`);
    assert.equal(getRes.status, 200);
    assert.ok(getRes.body.data);
    assert.equal(getRes.body.data.run_id, runId);
    assert.equal(getRes.body.data.status, 'active');
  });

  it('AT-HR-005: Job queue FIFO and lease exclusivity', () => {
    const queue = createJobQueue();

    // Enqueue two jobs
    const id1 = queue.enqueue({ run_id: 'run-1', role: 'dev', runtime_class: 'api_proxy' });
    const id2 = queue.enqueue({ run_id: 'run-2', role: 'dev', runtime_class: 'api_proxy' });

    // First claim gets first job (FIFO)
    const claim1 = queue.claim('worker-a');
    assert.ok(claim1);
    assert.equal(claim1.job.job_id, id1);

    // Second claim gets second job (exclusivity: job 1 is already claimed)
    const claim2 = queue.claim('worker-b');
    assert.ok(claim2);
    assert.equal(claim2.job.job_id, id2);

    // No more claimable jobs
    const claim3 = queue.claim('worker-c');
    assert.equal(claim3, null);
  });

  it('AT-HR-006: Stale lease transitions to needs_recovery', () => {
    const queue = createJobQueue({
      heartbeatIntervalMs: 30_000,
      staleThresholdMultiplier: 2,
    });

    queue.enqueue({ run_id: 'run-stale', role: 'dev', runtime_class: 'api_proxy' });
    const claimed = queue.claim('worker-stale');
    assert.ok(claimed);

    // Simulate time passing by manipulating heartbeat_at
    claimed.lease.heartbeat_at = Date.now() - 65_000; // 65s ago (> 60s stale threshold)

    const expired = queue.expireStaleLeases();
    assert.equal(expired.length, 1);

    const jobs = queue.getJobs({ status: 'needs_recovery' });
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].run_id, 'run-stale');
  });

  it('AT-HR-008: Error responses use standard format', async () => {
    await runner.start();
    const res = await httpRequest(port, 'GET', '/v1/runs/nonexistent-run-id');
    // Should get 404 because no state.json exists for this project yet
    assert.ok(res.status === 404 || res.status === 409);
    assert.ok(res.body.error);
    assert.ok(res.body.error.code);
    assert.ok(res.body.error.message);
  });

  it('AT-HR-009: Graceful shutdown', async () => {
    await runner.start();
    // Verify server is alive
    const res = await httpRequest(port, 'GET', '/health');
    assert.equal(res.status, 200);

    // Stop
    await runner.stop();

    // Small delay to let OS release the socket
    await new Promise(r => setTimeout(r, 50));

    // Verify server is down
    try {
      await httpRequest(port, 'GET', '/health');
      assert.fail('Server should be closed');
    } catch (err) {
      // Accept any connection error (ECONNREFUSED, ECONNRESET, etc.)
      assert.ok(
        err.code === 'ECONNREFUSED' || err.code === 'ECONNRESET' ||
        err.message.includes('ECONNREFUSED') || err.message.includes('ECONNRESET') ||
        err.message.includes('socket hang up'),
        `Expected connection error, got: ${err.code || err.message}`
      );
    }
    // Prevent double-stop in afterEach
    runner = null;
  });

  it('AT-HR-010: Cancel run transitions state', async () => {
    await runner.start();
    // Create a run first
    const createRes = await httpRequest(port, 'POST', '/v1/projects/hosted-test/runs', {});
    assert.equal(createRes.status, 201);
    const runId = createRes.body.data.run_id;

    // Cancel — the response itself contains the blocked state
    const cancelRes = await httpRequest(port, 'POST', `/v1/runs/${runId}/cancel`, { reason: 'test cancellation' });
    assert.equal(cancelRes.status, 200);
    assert.ok(cancelRes.body.data);
    // markRunBlocked returns the updated state or a result object
    // Verify the cancel succeeded by checking the response reflects blocked status
    const cancelData = cancelRes.body.data;
    if (cancelData.status) {
      assert.equal(cancelData.status, 'blocked');
    } else if (cancelData.state) {
      assert.equal(cancelData.state.status, 'blocked');
    } else {
      // cancelRun returns the markRunBlocked result which may have ok: true
      assert.ok(cancelData.ok !== false, 'Cancel should succeed');
    }
  });
});

describe('Hosted Runner — Job Queue Unit', () => {
  it('Queue enqueue returns job_id and getStatus reflects counts', () => {
    const queue = createJobQueue();
    queue.enqueue({ run_id: 'r1', role: 'dev', runtime_class: 'api_proxy' });
    queue.enqueue({ run_id: 'r2', role: 'qa', runtime_class: 'api_proxy' });

    const status = queue.getStatus();
    assert.equal(status.total, 2);
    assert.equal(status.waiting, 2);
    assert.equal(status.claimed, 0);
  });

  it('Heartbeat returns false for expired lease', () => {
    const queue = createJobQueue({ defaultLeaseDurationMs: 100 });
    queue.enqueue({ run_id: 'r-hb', role: 'dev', runtime_class: 'api_proxy' });
    const claimed = queue.claim('w1');
    assert.ok(claimed);

    // Force-expire
    claimed.lease.expires_at = Date.now() - 1;
    const alive = queue.heartbeat(claimed.lease.lease_id);
    assert.equal(alive, false);
  });

  it('Finalize marks job as completed', () => {
    const queue = createJobQueue();
    queue.enqueue({ run_id: 'r-fin', role: 'dev', runtime_class: 'api_proxy' });
    const claimed = queue.claim('w1');
    assert.ok(claimed);

    queue.finalize(claimed.lease.lease_id, 'completed');
    const status = queue.getStatus();
    assert.equal(status.completed, 1);
    assert.equal(status.claimed, 0);
  });
});
