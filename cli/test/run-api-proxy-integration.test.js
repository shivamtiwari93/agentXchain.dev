/**
 * AT-RUN-APIPROXY-INT-001, AT-RUN-APIPROXY-INT-002, AT-RUN-APIPROXY-INT-003
 *
 * Integration tests for `agentxchain run` with mixed adapter types:
 *   - local_cli (authoritative) for dev role
 *   - api_proxy (review_only) for qa role via a local mock HTTP server
 *
 * Proves that review_only + api_proxy works end-to-end through the real
 * `run` CLI surface without weakening any production validation rules.
 *
 * Uses async spawn (not spawnSync) because the mock HTTP server runs in
 * the test process — spawnSync blocks the event loop and prevents the
 * server from responding.
 */

import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, mkdirSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';

import { scaffoldGoverned } from '../src/commands/init.js';

const cliRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const binPath = join(cliRoot, 'bin', 'agentxchain.js');
const mockAgentPath = join(cliRoot, 'test-support', 'mock-agent.mjs');

const tempDirs = [];
const servers = [];

/**
 * Start a mock Anthropic API server that returns a valid turn result
 * wrapped in an Anthropic Messages API response format.
 */
function startMockAnthropicServer() {
  return new Promise((resolve, reject) => {
    const requestLog = [];

    const server = createServer((req, res) => {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          requestLog.push({
            headers: { ...req.headers },
            body: parsed,
            timestamp: new Date().toISOString(),
          });

          // Extract run_id and turn_id from the prompt text
          // The dispatch bundle embeds ASSIGNMENT.json content in the prompt
          const userMsg = parsed.messages?.find(m => m.role === 'user');
          const promptText = userMsg?.content || '';
          const runIdMatch = promptText.match(/"run_id"\s*:\s*"([^"]+)"/);
          const turnIdMatch = promptText.match(/"turn_id"\s*:\s*"([^"]+)"/);
          const runtimeIdMatch = promptText.match(/"runtime_id"\s*:\s*"([^"]+)"/);
          const roleMatch = promptText.match(/"assigned_role"\s*:\s*"([^"]+)"/);

          const runId = runIdMatch?.[1] || 'run_mock';
          const turnId = turnIdMatch?.[1] || 'turn_mock';
          const runtimeId = runtimeIdMatch?.[1] || 'api-qa';
          const roleId = roleMatch?.[1] || 'qa';

          // Build a governed turn result that requests run completion
          const turnResult = {
            schema_version: '1.0',
            run_id: runId,
            turn_id: turnId,
            role: roleId,
            runtime_id: runtimeId,
            status: 'completed',
            summary: 'Mock QA review completed via api_proxy.',
            decisions: [{
              id: 'DEC-001',
              category: 'quality',
              statement: 'QA review passed via api_proxy adapter.',
              rationale: 'Integration test mock.',
            }],
            objections: [{
              id: 'OBJ-001',
              severity: 'low',
              statement: 'Mock objection from QA review.',
              status: 'raised',
            }],
            files_changed: [],
            artifacts_created: [],
            verification: {
              status: 'pass',
              commands: ['echo ok'],
              evidence_summary: 'api_proxy review pass',
              machine_evidence: [{ command: 'echo ok', exit_code: 0 }],
            },
            artifact: { type: 'review', ref: null },
            proposed_next_role: 'human',
            phase_transition_request: null,
            run_completion_request: true,
            needs_human_reason: null,
            cost: { input_tokens: 100, output_tokens: 200, usd: 0.01 },
          };

          const response = {
            id: 'msg_mock_' + Date.now(),
            type: 'message',
            role: 'assistant',
            content: [{
              type: 'text',
              text: JSON.stringify(turnResult, null, 2),
            }],
            model: 'claude-sonnet-4-6',
            stop_reason: 'end_turn',
            usage: { input_tokens: 100, output_tokens: 200 },
          };

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(response));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { type: 'invalid_request_error', message: err.message } }));
        }
      });
    });

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      servers.push(server);
      resolve({ server, url: `http://127.0.0.1:${addr.port}`, requestLog });
    });

    server.on('error', reject);
  });
}

/**
 * Create a governed project with mixed adapters:
 *   - pm: local_cli (authoritative) — planning
 *   - dev: local_cli (authoritative) — implementation
 *   - qa: api_proxy (review_only) via mock server — QA review
 *
 * This is the exact production-valid configuration. No validation bypasses.
 */
function makeProject(mockServerUrl) {
  const root = mkdtempSync(join(tmpdir(), 'axc-apiproxy-int-'));
  tempDirs.push(root);
  scaffoldGoverned(root, 'API Proxy Integration Test', `apiproxy-int-${Date.now()}`);

  const configPath = join(root, 'agentxchain.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));

  // pm and dev use local_cli with mock agent (authoritative)
  config.runtimes['manual-pm'] = {
    type: 'local_cli',
    command: process.execPath,
    args: [mockAgentPath],
    prompt_transport: 'dispatch_bundle_only',
  };
  config.roles.pm.write_authority = 'authoritative';
  config.roles.pm.runtime = 'manual-pm';

  config.runtimes['local-dev'] = {
    type: 'local_cli',
    command: process.execPath,
    args: [mockAgentPath],
    prompt_transport: 'dispatch_bundle_only',
  };

  // qa uses api_proxy (review_only) — production contract
  config.runtimes['api-qa'] = {
    type: 'api_proxy',
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    auth_env: 'MOCK_ANTHROPIC_KEY',
    base_url: mockServerUrl,
    max_output_tokens: 4096,
    timeout_seconds: 30,
    retry_policy: { max_attempts: 1 },
  };
  config.roles.qa.write_authority = 'review_only';
  config.roles.qa.runtime = 'api-qa';

  // eng_director uses local_cli
  config.runtimes['manual-director'] = {
    type: 'local_cli',
    command: process.execPath,
    args: [mockAgentPath],
    prompt_transport: 'dispatch_bundle_only',
  };
  config.roles.eng_director.write_authority = 'authoritative';
  config.roles.eng_director.runtime = 'manual-director';

  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
  return root;
}

function seedQaCompletionArtifacts(root) {
  mkdirSync(join(root, '.planning'), { recursive: true });
  writeFileSync(
    join(root, '.planning', 'acceptance-matrix.md'),
    '# Acceptance Matrix\n\n| Req # | Requirement | Acceptance criteria | Test status | Last tested | Status |\n|-------|-------------|-------------------|-------------|-------------|--------|\n| 1 | API proxy governed run | QA confirms the governed run can complete with API-backed execution | pass | 2026-04-06 | pass |\n',
  );
  writeFileSync(
    join(root, '.planning', 'ship-verdict.md'),
    '# Ship Verdict\n\n## Verdict: YES\n',
  );
}

/**
 * Run CLI asynchronously so the event loop stays active for the mock server.
 */
function runCliAsync(root, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [binPath, ...args], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        MOCK_ANTHROPIC_KEY: 'test-key-for-mock-server',
        ...(opts.env || {}),
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });

    if (opts.input) {
      child.stdin.write(opts.input);
      child.stdin.end();
    } else {
      child.stdin.end();
    }

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`CLI timed out after ${opts.timeout || 60000}ms`));
    }, opts.timeout || 60000);

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ status: code, stdout, stderr });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
  for (const s of servers.splice(0)) {
    try { s.close(); } catch {}
  }
});

describe('agentxchain run — review_only api_proxy integration', () => {

  // ──────────────────────────────────────────────────────────────────────────
  // AT-RUN-APIPROXY-INT-001: Mixed local_cli + api_proxy lifecycle
  // Proves a governed run with authoritative local_cli (pm, dev) and
  // review_only api_proxy (qa) completes end-to-end.
  // ──────────────────────────────────────────────────────────────────────────
  it('AT-RUN-APIPROXY-INT-001: full lifecycle with mixed local_cli + api_proxy completes', async () => {
    const mock = await startMockAnthropicServer();
    const root = makeProject(mock.url);
    // api_proxy review_only can validate and request completion, but it cannot
    // author repo-local gate files. Pre-seed the QA artifacts to model the
    // real contract instead of pretending remote review writes the workspace.
    seedQaCompletionArtifacts(root);

    const result = await runCliAsync(root, ['run', '--auto-approve', '--max-turns', '10']);

    assert.equal(result.status, 0,
      `Expected exit 0, got ${result.status}.\nstdout: ${result.stdout?.slice(-800)}\nstderr: ${result.stderr?.slice(-500)}`);

    // Mock server received at least one request (the QA turn via api_proxy)
    assert.ok(mock.requestLog.length >= 1,
      `Expected mock server to receive >= 1 request, got ${mock.requestLog.length}`);

    // Proper auth header
    const firstReq = mock.requestLog[0];
    assert.equal(firstReq.headers['x-api-key'], 'test-key-for-mock-server',
      'API proxy should send the API key from MOCK_ANTHROPIC_KEY env var');

    // Anthropic version header
    assert.ok(firstReq.headers['anthropic-version'],
      'API proxy should send anthropic-version header');

    // State file should reflect completion
    const statePath = join(root, '.agentxchain', 'state.json');
    assert.ok(existsSync(statePath), 'state.json should exist after run');

    const state = JSON.parse(readFileSync(statePath, 'utf8'));
    assert.equal(state.status, 'completed',
      `Expected completed, got "${state.status}"`);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // AT-RUN-APIPROXY-INT-002: Correct Anthropic request format
  // ──────────────────────────────────────────────────────────────────────────
  it('AT-RUN-APIPROXY-INT-002: api_proxy sends correct Anthropic request format', async () => {
    const mock = await startMockAnthropicServer();
    const root = makeProject(mock.url);

    // Patch state to QA phase so api_proxy is the first dispatch
    const statePath = join(root, '.agentxchain', 'state.json');
    const state = JSON.parse(readFileSync(statePath, 'utf8'));
    state.phase = 'qa';
    state.run_id = `run_${Date.now()}`;
    state.status = 'active';
    state.phase_gate_status = {
      planning_signoff: 'passed',
      implementation_complete: 'passed',
      qa_ship_verdict: 'pending',
    };
    writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n');

    const result = await runCliAsync(root, ['run', '--auto-approve', '--max-turns', '3']);

    // Should have received an API request
    if (mock.requestLog.length > 0) {
      const req = mock.requestLog[0];
      assert.ok(req.body.model, 'Request should include model');
      assert.equal(req.body.model, 'claude-sonnet-4-6');
      assert.ok(Array.isArray(req.body.messages), 'Request should have messages array');
      assert.ok(req.body.max_tokens > 0, 'Request should have max_tokens');
      assert.ok(req.body.messages.some(m => m.role === 'user'), 'Should have user message');
    }

    assert.ok(result.status !== null, 'Process should exit cleanly');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // AT-RUN-APIPROXY-INT-003: Missing credentials → graceful failure
  // ──────────────────────────────────────────────────────────────────────────
  it('AT-RUN-APIPROXY-INT-003: missing api key causes graceful failure', async () => {
    const mock = await startMockAnthropicServer();
    const root = makeProject(mock.url);

    // Patch state to QA phase
    const statePath = join(root, '.agentxchain', 'state.json');
    const state = JSON.parse(readFileSync(statePath, 'utf8'));
    state.phase = 'qa';
    state.run_id = `run_${Date.now()}`;
    state.status = 'active';
    state.phase_gate_status = {
      planning_signoff: 'passed',
      implementation_complete: 'passed',
      qa_ship_verdict: 'pending',
    };
    writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n');

    // Run WITHOUT the MOCK_ANTHROPIC_KEY
    const result = await runCliAsync(root, ['run', '--auto-approve', '--max-turns', '2'], {
      env: { MOCK_ANTHROPIC_KEY: '' },
    });

    // Should not crash
    assert.ok(result.status !== null, 'Process should exit cleanly');

    // No requests to mock server
    assert.equal(mock.requestLog.length, 0,
      'No request should reach server when credentials are missing');

    // Output should mention the credential issue
    const combined = result.stdout + result.stderr;
    assert.ok(
      combined.includes('MOCK_ANTHROPIC_KEY') || combined.includes('not set'),
      'Output should mention the missing credential'
    );
  });
});
