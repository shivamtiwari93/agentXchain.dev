import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

import { dispatchRemoteAgent, describeRemoteAgentTarget, DEFAULT_REMOTE_AGENT_TIMEOUT_MS } from '../src/lib/adapters/remote-agent-adapter.js';
import { writeDispatchBundle } from '../src/lib/dispatch-bundle.js';
import { getTurnStagingResultPath } from '../src/lib/turn-paths.js';

function makeTmpDir() {
  const dir = join(tmpdir(), `axc-remote-agent-test-${randomBytes(6).toString('hex')}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function makeState(overrides = {}) {
  return {
    run_id: 'run_remote_test',
    status: 'active',
    phase: 'implementation',
    accepted_integration_ref: 'git:abc123',
    current_turn: {
      turn_id: 'turn_remote001',
      assigned_role: 'reviewer',
      status: 'running',
      attempt: 1,
      started_at: new Date().toISOString(),
      deadline_at: new Date(Date.now() + 600000).toISOString(),
      runtime_id: 'remote-review',
    },
    last_completed_turn_id: null,
    blocked_on: null,
    escalation: null,
    budget_status: { spent_usd: 0, remaining_usd: 50 },
    phase_gate_status: {},
    ...overrides,
  };
}

function makeConfig(url, runtimeOverrides = {}) {
  return {
    schema_version: 4,
    protocol_mode: 'governed',
    project: { id: 'remote-test', name: 'Remote Test', default_branch: 'main' },
    roles: {
      reviewer: {
        title: 'Reviewer',
        mandate: 'Review via remote agent.',
        write_authority: 'review_only',
        runtime: 'remote-review',
      },
    },
    runtimes: {
      'remote-review': {
        type: 'remote_agent',
        url,
        timeout_ms: 5000,
        headers: {
          'x-api-key': 'test-secret-key',
          'x-trace-id': 'visible-value',
        },
        ...runtimeOverrides,
      },
    },
    routing: {
      implementation: { entry_role: 'reviewer' },
    },
    gates: {},
    budget: { per_turn_max_usd: 2.0, per_run_max_usd: 10.0 },
    rules: { challenge_required: false },
    files: {
      talk: 'TALK.md',
      history: '.agentxchain/history.jsonl',
      state: '.agentxchain/state.json',
    },
  };
}

function scaffoldDispatch(root, state) {
  const turnId = state.current_turn.turn_id;
  const dispatchDir = join(root, `.agentxchain/dispatch/turns/${turnId}`);
  mkdirSync(dispatchDir, { recursive: true });
  writeFileSync(join(dispatchDir, 'PROMPT.md'), '# Test Prompt\nReview the code.');
  writeFileSync(join(dispatchDir, 'CONTEXT.md'), '# Context\nNo changes yet.');
  // Write a dispatch manifest so manifest verification passes
  writeFileSync(join(dispatchDir, 'MANIFEST.json'), JSON.stringify({
    turn_id: turnId,
    files: [
      { path: 'PROMPT.md', sha256: 'test' },
      { path: 'CONTEXT.md', sha256: 'test' },
    ],
  }));
}

function makeTurnResult(state) {
  return {
    schema_version: '1.0',
    run_id: state.run_id,
    turn_id: state.current_turn.turn_id,
    role: state.current_turn.assigned_role,
    runtime_id: state.current_turn.runtime_id,
    status: 'completed',
    summary: 'Remote agent completed the review',
    decisions: [],
    objections: [],
    files_changed: [],
    verification: { status: 'pass', commands: [], evidence_summary: '' },
    artifact: { type: 'review', ref: null },
    proposed_next_role: 'dev',
    phase_transition_request: null,
    run_completion_request: null,
    cost: { input_tokens: 100, output_tokens: 50, usd: 0.01 },
  };
}

describe('remote-agent adapter', () => {
  let tmpDir;
  /** @type {import('http').Server | null} */
  let server = null;
  let serverPort = 0;

  async function startServer(handler) {
    server = createServer(handler);
    server.listen(0);
    await once(server, 'listening');
    serverPort = server.address().port;
  }

  afterEach(async () => {
    if (server) {
      server.close();
      await once(server, 'close').catch(() => {});
      server = null;
    }
    if (tmpDir && existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  describe('happy path', () => {
    it('dispatches a turn to a remote agent and stages the result', async () => {
      const state = makeState();
      const turnResult = makeTurnResult(state);

      await startServer((req, res) => {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
          const envelope = JSON.parse(body);
          // Verify envelope contains expected fields
          assert.equal(envelope.run_id, state.run_id);
          assert.equal(envelope.turn_id, state.current_turn.turn_id);
          assert.equal(envelope.role, 'reviewer');
          assert.equal(envelope.phase, 'implementation');
          assert.ok(envelope.prompt.includes('Test Prompt'));
          assert.ok(envelope.context.includes('Context'));

          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify(turnResult));
        });
      });

      tmpDir = makeTmpDir();
      const config = makeConfig(`http://localhost:${serverPort}`);
      scaffoldDispatch(tmpDir, state);

      const result = await dispatchRemoteAgent(tmpDir, state, config, {
        skipManifestVerification: true,
      });

      assert.ok(result.ok, `Expected ok, got: ${result.error}`);
      assert.ok(Array.isArray(result.logs));
      assert.ok(result.logs.some(l => l.includes('POST')));

      // Verify staged result
      const stagingPath = join(tmpDir, getTurnStagingResultPath(state.current_turn.turn_id));
      assert.ok(existsSync(stagingPath), 'Staged result must exist');
      const staged = readJson(stagingPath);
      assert.equal(staged.status, 'completed');
      assert.equal(staged.summary, 'Remote agent completed the review');
    });

    it('does not leak secret headers into logs', async () => {
      const state = makeState();
      await startServer((req, res) => {
        // Verify the secret header was actually sent
        assert.equal(req.headers['x-api-key'], 'test-secret-key');
        assert.equal(req.headers['x-trace-id'], 'visible-value');

        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify(makeTurnResult(state)));
        });
      });

      tmpDir = makeTmpDir();
      const config = makeConfig(`http://localhost:${serverPort}`);
      scaffoldDispatch(tmpDir, state);

      const result = await dispatchRemoteAgent(tmpDir, state, config, {
        skipManifestVerification: true,
      });
      assert.ok(result.ok);

      // Logs must not contain the secret value
      const allLogs = result.logs.join('\n');
      assert.ok(!allLogs.includes('test-secret-key'), 'Logs must not contain secret header values');
      assert.ok(allLogs.includes('[REDACTED]'), 'Secret headers should be redacted in logs');
      // Non-secret headers should be visible
      assert.ok(allLogs.includes('visible-value'), 'Non-secret header values should appear in logs');
    });
  });

  describe('error paths', () => {
    it('fails on non-2xx response', async () => {
      await startServer((_req, res) => {
        res.writeHead(500, { 'content-type': 'text/plain' });
        res.end('Internal Server Error');
      });

      tmpDir = makeTmpDir();
      const state = makeState();
      const config = makeConfig(`http://localhost:${serverPort}`);
      scaffoldDispatch(tmpDir, state);

      const result = await dispatchRemoteAgent(tmpDir, state, config, {
        skipManifestVerification: true,
      });

      assert.equal(result.ok, false);
      assert.match(result.error, /HTTP 500/);
      assert.ok(result.logs.some(l => l.includes('500')));
    });

    it('fails on non-JSON response', async () => {
      await startServer((_req, res) => {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end('<html>not json</html>');
      });

      tmpDir = makeTmpDir();
      const state = makeState();
      const config = makeConfig(`http://localhost:${serverPort}`);
      scaffoldDispatch(tmpDir, state);

      const result = await dispatchRemoteAgent(tmpDir, state, config, {
        skipManifestVerification: true,
      });

      assert.equal(result.ok, false);
      assert.ok(result.error.includes('not valid JSON') || result.error.includes('not a valid turn result'));
    });

    it('fails on JSON that is not a valid turn result', async () => {
      await startServer((_req, res) => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ hello: 'world' }));
      });

      tmpDir = makeTmpDir();
      const state = makeState();
      const config = makeConfig(`http://localhost:${serverPort}`);
      scaffoldDispatch(tmpDir, state);

      const result = await dispatchRemoteAgent(tmpDir, state, config, {
        skipManifestVerification: true,
      });

      assert.equal(result.ok, false);
      assert.ok(result.error.includes('valid turn result'));
    });

    it('fails on timeout', async () => {
      await startServer((_req, _res) => {
        // Never respond — let it timeout
      });

      tmpDir = makeTmpDir();
      const state = makeState();
      // Very short timeout
      const config = makeConfig(`http://localhost:${serverPort}`, { timeout_ms: 200 });
      scaffoldDispatch(tmpDir, state);

      const result = await dispatchRemoteAgent(tmpDir, state, config, {
        skipManifestVerification: true,
      });

      assert.equal(result.ok, false);
      assert.ok(result.timedOut || result.error.includes('timed out') || result.error.includes('abort'), `Expected timeout, got: ${result.error}`);
    });

    it('fails on connection refused', async () => {
      tmpDir = makeTmpDir();
      const state = makeState();
      // Port that nothing listens on
      const config = makeConfig('http://localhost:19999');
      scaffoldDispatch(tmpDir, state);

      const result = await dispatchRemoteAgent(tmpDir, state, config, {
        skipManifestVerification: true,
      });

      assert.equal(result.ok, false);
      assert.ok(
        result.error.includes('network error') ||
        result.error.includes('ECONNREFUSED') ||
        result.error.includes('dispatch failed') ||
        result.error.includes('timed out'),
        `Expected connection failure, got: ${result.error}`,
      );
    });

    it('fails when no active turn exists', async () => {
      tmpDir = makeTmpDir();
      const state = { run_id: 'run_test', status: 'active', phase: 'implementation' };
      const config = makeConfig('http://localhost:9999');

      const result = await dispatchRemoteAgent(tmpDir, state, config, {
        skipManifestVerification: true,
      });

      assert.equal(result.ok, false);
      assert.ok(result.error.includes('No active turn'));
    });

    it('fails when runtime type is not remote_agent', async () => {
      tmpDir = makeTmpDir();
      const state = makeState();
      const config = makeConfig('http://localhost:9999');
      config.runtimes['remote-review'].type = 'manual';
      scaffoldDispatch(tmpDir, state);

      const result = await dispatchRemoteAgent(tmpDir, state, config, {
        skipManifestVerification: true,
      });

      assert.equal(result.ok, false);
      assert.ok(result.error.includes('not a remote_agent'));
    });

    it('fails when PROMPT.md is missing', async () => {
      tmpDir = makeTmpDir();
      const state = makeState();
      const config = makeConfig('http://localhost:9999');
      // Don't scaffold dispatch — no PROMPT.md

      const result = await dispatchRemoteAgent(tmpDir, state, config, {
        skipManifestVerification: true,
      });

      assert.equal(result.ok, false);
      assert.ok(result.error.includes('PROMPT.md'));
    });
  });

  describe('describeRemoteAgentTarget', () => {
    it('returns safe URL representation', () => {
      const desc = describeRemoteAgentTarget({ url: 'https://agent.example.com/v1/turn?key=secret' });
      assert.ok(desc.includes('agent.example.com'));
    });

    it('returns (unknown) for missing URL', () => {
      assert.equal(describeRemoteAgentTarget({}), '(unknown)');
      assert.equal(describeRemoteAgentTarget(null), '(unknown)');
    });
  });

  describe('defaults', () => {
    it('DEFAULT_REMOTE_AGENT_TIMEOUT_MS is 120000', () => {
      assert.equal(DEFAULT_REMOTE_AGENT_TIMEOUT_MS, 120000);
    });
  });
});
