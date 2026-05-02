/**
 * AT-CONT-APIPROXY-001: Continuous mode through api_proxy adapter E2E.
 *
 * Proves that `agentxchain run --continuous --vision` can execute multiple
 * governed runs through the real api_proxy adapter pathway (backed by a mock
 * Anthropic HTTP server). This is the critical proof gap between "plumbing
 * works" (local_cli mock agent) and "adapter integration works" (api_proxy
 * dispatches, extracts structured results, and flows through intake lifecycle).
 *
 * The mock server returns phase-aware turn results so the governed run
 * completes all three phases (planning → implementation → qa) per run.
 *
 * Uses async spawn because the mock HTTP server runs in the test process.
 */

import { afterEach, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import {
  mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync,
  mkdirSync, readdirSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';

import { scaffoldGoverned } from '../src/commands/init.js';
import { gitInit } from '../test-support/git-test-helpers.js';

const cliRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const binPath = join(cliRoot, 'bin', 'agentxchain.js');
const mockAgentPath = join(cliRoot, 'test-support', 'mock-agent.mjs');

const tempDirs = [];
const servers = [];

// ── Mock Anthropic server that returns phase-aware turn results ──────────

/**
 * Build a turn result for the given phase, role, and turn metadata.
 * Planning creates gate files via files_changed.
 * Implementation creates source artifacts.
 * QA requests run completion without claiming repo writes because the
 * api_proxy QA role is review_only.
 */
function buildTurnResult({ runId, turnId, runtimeId, roleId, phase }) {
  let phaseTransitionRequest = null;
  let runCompletionRequest = null;
  let proposedNextRole = 'human';
  let filesChanged = [];

  if (phase === 'planning') {
    phaseTransitionRequest = 'implementation';
    filesChanged = ['.planning/PM_SIGNOFF.md', '.planning/ROADMAP.md', '.planning/SYSTEM_SPEC.md'];
  } else if (phase === 'implementation') {
    phaseTransitionRequest = 'qa';
    proposedNextRole = 'qa';
    filesChanged = ['src/output.js', '.planning/IMPLEMENTATION_NOTES.md'];
  } else if (phase === 'qa') {
    runCompletionRequest = true;
    filesChanged = [];
  }

  return {
    schema_version: '1.0',
    run_id: runId,
    turn_id: turnId,
    role: roleId,
    runtime_id: runtimeId,
    status: 'completed',
    summary: `API proxy ${roleId} completed ${phase} phase.`,
    decisions: [{
      id: 'DEC-001',
      category: 'implementation',
      statement: `${roleId} completed governed slice in ${phase}.`,
      rationale: 'API proxy integration test.',
    }],
    objections: [{
      id: 'OBJ-001',
      severity: 'low',
      statement: `Mock objection from ${roleId}.`,
      status: 'raised',
    }],
    files_changed: filesChanged,
    artifacts_created: [],
    verification: {
      status: 'pass',
      commands: ['echo ok'],
      evidence_summary: 'pass',
      machine_evidence: [{ command: 'echo ok', exit_code: 0 }],
    },
    artifact: { type: roleId === 'dev' ? 'workspace' : 'review', ref: null },
    proposed_next_role: proposedNextRole,
    phase_transition_request: phaseTransitionRequest,
    run_completion_request: runCompletionRequest,
    needs_human_reason: null,
    cost: { input_tokens: 100, output_tokens: 200, usd: 0.01 },
  };
}

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

          const userMsg = parsed.messages?.find(m => m.role === 'user');
          const promptText = userMsg?.content || '';

          // PROMPT.md and CONTEXT.md use markdown format:
          //   **Run:** run_abc123
          //   **Turn:** turn_def456
          //   **Phase:** planning
          //   # Turn Assignment: PM (pm)
          //   **Runtime:** api-qa
          const runIdMatch = promptText.match(/\*\*Run:\*\*\s+(run_[a-f0-9]+)/);
          const turnIdMatch = promptText.match(/\*\*Turn:\*\*\s+(turn_[a-f0-9]+)/);
          const runtimeIdMatch = promptText.match(/\*\*Runtime:\*\*\s+(\S+)/);
          const roleMatch = promptText.match(/# Turn Assignment:.*?\((\w+)\)/);
          const phaseMatch = promptText.match(/\*\*Phase:\*\*\s+(\w+)/);

          const runId = runIdMatch?.[1] || 'run_mock';
          const turnId = turnIdMatch?.[1] || 'turn_mock';
          const runtimeId = runtimeIdMatch?.[1] || 'api-runtime';
          const roleId = roleMatch?.[1] || 'pm';
          const phase = phaseMatch?.[1] || 'planning';

          const turnResult = buildTurnResult({ runId, turnId, runtimeId, roleId, phase });

          const response = {
            id: 'msg_mock_' + Date.now(),
            type: 'message',
            role: 'assistant',
            content: [{
              type: 'text',
              text: JSON.stringify(turnResult, null, 2),
            }],
            model: 'claude-haiku-4-5-20251001',
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

// ── Project scaffolding ──────────────────────────────────────────────────

function makeProject(mockServerUrl) {
  const root = mkdtempSync(join(tmpdir(), 'axc-cont-apiproxy-e2e-'));
  tempDirs.push(root);
  scaffoldGoverned(root, 'Continuous API Proxy E2E', `cont-apiproxy-e2e-${Date.now()}`);

  const configPath = join(root, 'agentxchain.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));

  // Mixed adapter setup matching production contract:
  //   pm, dev, eng_director: local_cli (authoritative) — can write gate files
  //   qa: api_proxy (review_only) — dispatches through real adapter to mock server
  const localRuntime = {
    type: 'local_cli',
    command: process.execPath,
    args: [mockAgentPath],
    prompt_transport: 'dispatch_bundle_only',
  };

  const apiRuntime = {
    type: 'api_proxy',
    provider: 'anthropic',
    model: 'claude-haiku-4-5-20251001',
    auth_env: 'MOCK_ANTHROPIC_KEY',
    base_url: mockServerUrl,
    max_output_tokens: 4096,
    timeout_seconds: 30,
    retry_policy: { max_attempts: 1 },
  };

  // Authoritative roles get local_cli
  config.runtimes['local-pm'] = { ...localRuntime };
  config.runtimes['local-dev'] = { ...localRuntime };
  config.runtimes['local-director'] = { ...localRuntime };
  config.roles.pm.runtime = 'local-pm';
  config.roles.pm.write_authority = 'authoritative';
  config.roles.dev.runtime = 'local-dev';
  config.roles.dev.write_authority = 'authoritative';
  config.roles.eng_director.runtime = 'local-director';
  config.roles.eng_director.write_authority = 'authoritative';
  config.intent_coverage_mode = 'lenient';

  // QA gets api_proxy (review_only) — the adapter we're proving
  config.runtimes['api-qa'] = { ...apiRuntime };
  config.roles.qa.runtime = 'api-qa';
  config.roles.qa.write_authority = 'review_only';

  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');

  // Vision file
  mkdirSync(join(root, '.planning'), { recursive: true });
  writeFileSync(join(root, '.planning', 'VISION.md'), `# Test Vision

## Governed Delivery

- durable decision ledger
- explicit phase gates
- recovery-first blocked state handling

## Quality Surface

- acceptance matrix with pass/fail evidence
`, 'utf8');

  // Pre-seed QA gate files since api_proxy review_only cannot write workspace.
  // Planning and implementation gate files are created by the mock agent.
  seedQaGateFiles(root);
  gitInit(root);

  return root;
}

function seedQaGateFiles(root) {
  mkdirSync(join(root, '.planning'), { recursive: true });
  writeFileSync(join(root, '.planning', 'acceptance-matrix.md'),
    '# Acceptance Matrix\n\n| Req # | Requirement | Acceptance criteria | Test status | Last tested | Status |\n|-------|-------------|-------------------|-------------|-------------|--------|\n| 1 | API proxy E2E | Run completes | pass | 2026-04-17 | pass |\n');
  writeFileSync(join(root, '.planning', 'ship-verdict.md'), '# Ship Verdict\n\n## Verdict: YES\n');
  writeFileSync(join(root, '.planning', 'RELEASE_NOTES.md'),
    '# Release Notes\n\n## User Impact\n\nAPI proxy continuous mode proof.\n\n## Verification Summary\n\n- agentxchain run --continuous\n');
}

// ── Async CLI runner ─────────────────────────────────────────────────────

function runCliAsync(root, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [binPath, ...args], {
      cwd: root,
      env: {
        ...process.env,
        MOCK_ANTHROPIC_KEY: 'test-key-for-mock-server',
        NO_COLOR: '1',
        NODE_NO_WARNINGS: '1',
        ...(opts.env || {}),
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    child.stdin.end();

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`CLI timed out after ${opts.timeout || 180000}ms`));
    }, opts.timeout || 180000);

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ status: code, stdout, stderr, combined: stdout + stderr });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────

function readJson(root, relPath) {
  return JSON.parse(readFileSync(join(root, relPath), 'utf8'));
}

function readJsonl(root, relPath) {
  const raw = readFileSync(join(root, relPath), 'utf8').trim();
  if (!raw) return [];
  return raw.split('\n').filter(Boolean).map(line => JSON.parse(line));
}

// ── Cleanup ──────────────────────────────────────────────────────────────

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
  for (const s of servers.splice(0)) {
    try { s.close(); } catch {}
  }
});

// ── Tests ────────────────────────────────────────────────────────────────

describe('continuous mode through api_proxy adapter E2E', () => {

  it('AT-CONT-APIPROXY-001: run --continuous completes 3 governed runs through api_proxy with full intake lifecycle', async () => {
    const mock = await startMockAnthropicServer();
    const root = makeProject(mock.url);

    const result = await runCliAsync(root, [
      'run',
      '--continuous',
      '--vision', '.planning/VISION.md',
      '--max-runs', '3',
      '--max-idle-cycles', '1',
      '--poll-seconds', '0',
    ]);

    assert.equal(result.status, 0,
      `continuous run failed (exit ${result.status}):\n${result.combined.slice(-2000)}`);

    // ── Mock server received API requests ──
    assert.ok(mock.requestLog.length >= 3,
      `Expected >= 3 API requests, got ${mock.requestLog.length}`);

    // Verify Anthropic API contract
    const firstReq = mock.requestLog[0];
    assert.equal(firstReq.headers['x-api-key'], 'test-key-for-mock-server');
    assert.ok(firstReq.headers['anthropic-version']);
    assert.equal(firstReq.body.model, 'claude-haiku-4-5-20251001');
    assert.ok(Array.isArray(firstReq.body.messages));

    // ── Continuous session reflects 3 completed runs ──
    const session = readJson(root, '.agentxchain/continuous-session.json');
    assert.equal(session.status, 'completed');
    assert.equal(session.runs_completed, 3);
    assert.equal(session.vision_path, '.planning/VISION.md');

    // ── Run history has 3 entries with vision provenance ──
    const history = readJsonl(root, '.agentxchain/run-history.jsonl');
    assert.equal(history.length, 3, `expected 3 history entries, got ${history.length}`);
    for (const entry of history) {
      assert.equal(entry.status, 'completed');
      assert.equal(entry.provenance.trigger, 'vision_scan');
      assert.equal(entry.provenance.created_by, 'continuous_loop');
      assert.ok(entry.provenance.intake_intent_id);
    }
    assert.equal(new Set(history.map((entry) => entry.run_id)).size, 3);

    // ── Intents resolve through real intake lifecycle ──
    const intentsDir = join(root, '.agentxchain', 'intake', 'intents');
    assert.ok(existsSync(intentsDir), 'intents directory must exist');
    const intents = readdirSync(intentsDir)
      .filter(f => f.endsWith('.json'))
      .map(f => JSON.parse(readFileSync(join(intentsDir, f), 'utf8')));
    assert.equal(intents.length, 3, `expected 3 resolved intents, got ${intents.length}`);
    for (const intent of intents) {
      assert.equal(intent.status, 'completed');
      assert.ok(intent.target_run);
      assert.ok(intent.run_completed_at);
    }

    // ── Final state is completed with intake provenance ──
    const state = readJson(root, '.agentxchain/state.json');
    assert.equal(state.status, 'completed');
    assert.ok(state.provenance.intake_intent_id);
  });

  it('AT-CONT-APIPROXY-002: api_proxy requests include correct role and phase context in prompt', async () => {
    const mock = await startMockAnthropicServer();
    const root = makeProject(mock.url);

    const result = await runCliAsync(root, [
      'run',
      '--continuous',
      '--vision', '.planning/VISION.md',
      '--max-runs', '1',
      '--max-idle-cycles', '1',
      '--poll-seconds', '0',
    ]);

    assert.equal(result.status, 0,
      `continuous run failed:\n${result.combined.slice(-1000)}`);

    // At least 1 request (QA phase dispatches through api_proxy; pm/dev use local_cli)
    assert.ok(mock.requestLog.length >= 1,
      `Expected >= 1 API request (QA via api_proxy), got ${mock.requestLog.length}`);

    // Each request should carry role/phase context in the prompt
    for (const req of mock.requestLog) {
      const userMsg = req.body.messages?.find(m => m.role === 'user');
      assert.ok(userMsg, 'Each API request must have a user message');
      const text = userMsg.content;
      assert.ok(text.includes('**Run:**'), 'Prompt must include Run ID');
      assert.ok(text.includes('**Turn:**'), 'Prompt must include Turn ID');
      assert.ok(text.includes('Turn Assignment:'), 'Prompt must include role assignment');
    }
  });
});
