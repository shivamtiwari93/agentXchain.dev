import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const SCRIPT_PATH = join(REPO_ROOT, 'examples', 'live-governed-proof', 'run-multi-provider-proof.mjs');
const SPEC_PATH = join(REPO_ROOT, '.planning', 'LIVE_MULTI_PROVIDER_GOVERNED_PROOF_SPEC.md');

const servers = [];

afterEach(() => {
  while (servers.length > 0) {
    const server = servers.pop();
    try {
      server.close();
    } catch {}
  }
});

function parseAssignmentFromContent(content) {
  const runIdMatch = content.match(/"run_id"\s*:\s*"([^"]+)"/);
  const turnIdMatch = content.match(/"turn_id"\s*:\s*"([^"]+)"/);
  const runtimeIdMatch = content.match(/"runtime_id"\s*:\s*"([^"]+)"/);
  const roleMatch = content.match(/"role"\s*:\s*"([^"]+)"/)
    || content.match(/"assigned_role"\s*:\s*"([^"]+)"/);

  return {
    runId: runIdMatch?.[1] || 'run_mock',
    turnId: turnIdMatch?.[1] || 'turn_mock',
    runtimeId: runtimeIdMatch?.[1] || 'runtime_mock',
    roleId: roleMatch?.[1] || 'role_mock',
  };
}

function startOpenAiServer() {
  return new Promise((resolve, reject) => {
    const requestLog = [];
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          requestLog.push({ headers: { ...req.headers }, body: parsed });
          const userMessage = parsed.messages?.find((msg) => msg.role === 'user');
          const assignment = parseAssignmentFromContent(userMessage?.content || '');
          const turnResult = {
            schema_version: '1.0',
            run_id: assignment.runId,
            turn_id: assignment.turnId,
            role: assignment.roleId,
            runtime_id: assignment.runtimeId,
            status: 'completed',
            summary: 'OpenAI PM review completed.',
            decisions: [
              {
                id: 'DEC-001',
                category: 'scope',
                statement: 'Seeded planning artifacts are sufficient for the implementation handoff.',
                rationale: 'The governed proof only needs honest seeded planning files.',
              },
            ],
            objections: [
              {
                id: 'OBJ-001',
                severity: 'low',
                statement: 'The proof is intentionally narrow and should not be overstated.',
                status: 'raised',
              },
            ],
            files_changed: [],
            artifacts_created: [],
            verification: {
              status: 'pass',
              commands: [],
              evidence_summary: 'Reviewed seeded planning files.',
              machine_evidence: [],
            },
            artifact: { type: 'review', ref: null },
            proposed_next_role: 'human',
            phase_transition_request: 'implementation',
            run_completion_request: null,
            needs_human_reason: null,
            cost: { input_tokens: 0, output_tokens: 0, usd: 0 },
          };

          const response = {
            id: 'chatcmpl_mock_openai',
            object: 'chat.completion',
            created: 1,
            model: 'gpt-4o-mini',
            choices: [
              {
                index: 0,
                message: {
                  role: 'assistant',
                  content: JSON.stringify(turnResult, null, 2),
                },
                finish_reason: 'stop',
              },
            ],
            usage: {
              prompt_tokens: 120,
              completion_tokens: 220,
              total_tokens: 340,
            },
          };

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(response));
        } catch (error) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { type: 'invalid_request_error', message: error.message } }));
        }
      });
    });

    server.listen(0, '127.0.0.1', () => {
      servers.push(server);
      const address = server.address();
      resolve({ url: `http://127.0.0.1:${address.port}/v1/chat/completions`, requestLog });
    });
    server.on('error', reject);
  });
}

function startAnthropicServer() {
  return new Promise((resolve, reject) => {
    const requestLog = [];
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          requestLog.push({ headers: { ...req.headers }, body: parsed });
          const assignment = parseAssignmentFromContent(parsed.messages?.[0]?.content || '');
          const turnResult = {
            schema_version: '1.0',
            run_id: assignment.runId,
            turn_id: assignment.turnId,
            role: assignment.roleId,
            runtime_id: assignment.runtimeId,
            status: 'completed',
            summary: 'Anthropic QA review completed.',
            decisions: [
              {
                id: 'DEC-001',
                category: 'quality',
                statement: 'The multi-provider governed proof can request completion.',
                rationale: 'Both review turns and gate approvals are satisfied.',
              },
            ],
            objections: [
              {
                id: 'OBJ-001',
                severity: 'low',
                statement: 'This still does not prove provider-authored code writes.',
                status: 'raised',
              },
            ],
            files_changed: [],
            artifacts_created: [],
            verification: {
              status: 'pass',
              commands: [],
              evidence_summary: 'Reviewed seeded QA files.',
              machine_evidence: [],
            },
            artifact: { type: 'review', ref: null },
            proposed_next_role: 'human',
            phase_transition_request: null,
            run_completion_request: true,
            needs_human_reason: null,
            cost: { input_tokens: 0, output_tokens: 0, usd: 0 },
          };

          const response = {
            id: 'msg_mock_anthropic',
            type: 'message',
            role: 'assistant',
            model: 'claude-haiku-4-5-20251001',
            content: [
              {
                type: 'text',
                text: JSON.stringify(turnResult, null, 2),
              },
            ],
            stop_reason: 'end_turn',
            usage: {
              input_tokens: 90,
              output_tokens: 180,
            },
          };

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(response));
        } catch (error) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { type: 'invalid_request_error', message: error.message } }));
        }
      });
    });

    server.listen(0, '127.0.0.1', () => {
      servers.push(server);
      const address = server.address();
      resolve({ url: `http://127.0.0.1:${address.port}/v1/messages`, requestLog });
    });
    server.on('error', reject);
  });
}

function startGoogleServer() {
  return new Promise((resolve, reject) => {
    const requestLog = [];
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          requestLog.push({ headers: { ...req.headers }, body: parsed, url: req.url });
          const userContent = parsed.contents?.[0]?.parts?.[0]?.text || '';
          const assignment = parseAssignmentFromContent(userContent);
          const turnResult = {
            schema_version: '1.0',
            run_id: assignment.runId,
            turn_id: assignment.turnId,
            role: assignment.roleId,
            runtime_id: assignment.runtimeId,
            status: 'completed',
            summary: 'Google Architect review completed.',
            decisions: [
              {
                id: 'DEC-001',
                category: 'architecture',
                statement: 'The three-provider governed proof architecture is sound.',
                rationale: 'Review-only roles across three providers proves orchestration.',
              },
            ],
            objections: [
              {
                id: 'OBJ-001',
                severity: 'low',
                statement: 'This still does not prove provider-authored code writes.',
                status: 'raised',
              },
            ],
            files_changed: [],
            artifacts_created: [],
            verification: {
              status: 'pass',
              commands: [],
              evidence_summary: 'Reviewed seeded implementation artifacts.',
              machine_evidence: [],
            },
            artifact: { type: 'review', ref: null },
            proposed_next_role: 'human',
            phase_transition_request: 'qa',
            run_completion_request: null,
            needs_human_reason: null,
            cost: { input_tokens: 0, output_tokens: 0, usd: 0 },
          };

          const response = {
            candidates: [
              {
                content: {
                  parts: [{ text: JSON.stringify(turnResult, null, 2) }],
                  role: 'model',
                },
                finishReason: 'STOP',
              },
            ],
            usageMetadata: {
              promptTokenCount: 100,
              candidatesTokenCount: 200,
              totalTokenCount: 300,
            },
            modelVersion: 'gemini-2.0-flash',
          };

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(response));
        } catch (error) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { status: 'INVALID_ARGUMENT', message: error.message } }));
        }
      });
    });

    server.listen(0, '127.0.0.1', () => {
      servers.push(server);
      const address = server.address();
      // Google endpoint uses model interpolation; the proof script replaces {model} in the URL
      // We serve all paths on this port so the interpolated URL still hits our server
      resolve({ url: `http://127.0.0.1:${address.port}/v1beta/models/{model}:generateContent`, requestLog });
    });
    server.on('error', reject);
  });
}

function runScriptAsync(args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: REPO_ROOT,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`script timed out\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`));
    }, 30_000);

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ status: code, stdout, stderr });
    });

    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.stdin.end();
  });
}

describe('multi-provider governed proof contract', () => {
  const source = readFileSync(SCRIPT_PATH, 'utf8');
  const spec = readFileSync(SPEC_PATH, 'utf8');

  it('imports only from runner-interface.js and api-proxy-adapter.js', () => {
    assert.match(source, /runner-interface\.js/);
    assert.match(source, /api-proxy-adapter\.js/);
    assert.doesNotMatch(source, /governed-state\.js/);
    assert.doesNotMatch(source, /dispatch-bundle\.js/);
    assert.doesNotMatch(source, /turn-paths\.js/);
  });

  it('does not shell out to the CLI binary', () => {
    assert.doesNotMatch(source, /child_process/);
    assert.doesNotMatch(source, /spawnSync/);
    assert.doesNotMatch(source, /execSync/);
  });

  it('uses cheap models for all three providers', () => {
    assert.match(source, /gpt-4o-mini/);
    assert.match(source, /gemini-2\.0-flash/);
    assert.match(source, /claude-haiku-4-5-20251001/);
  });

  it('documents the review-only scope limit truthfully', () => {
    assert.match(spec, /does not prove provider-authored repo writes/i);
    assert.match(spec, /review_only/i);
  });

  it('skips cleanly when provider credentials are missing', () => {
    const env = { ...process.env };
    delete env.OPENAI_API_KEY;
    delete env.ANTHROPIC_API_KEY;
    delete env.GOOGLE_API_KEY;

    const result = spawnSync(process.execPath, [SCRIPT_PATH, '--json'], {
      cwd: REPO_ROOT,
      env,
      timeout: 10_000,
    });

    assert.equal(result.status, 0);
    const parsed = JSON.parse(result.stdout.toString());
    assert.equal(parsed.result, 'skip');
    assert.deepEqual(parsed.missing_env, ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GOOGLE_API_KEY']);
  });

  it('completes a mock-backed three-provider governed run', async () => {
    const openai = await startOpenAiServer();
    const google = await startGoogleServer();
    const anthropic = await startAnthropicServer();

    const result = await runScriptAsync(
      [
        SCRIPT_PATH,
        '--json',
        '--openai-base-url',
        openai.url,
        '--google-base-url',
        google.url,
        '--anthropic-base-url',
        anthropic.url,
      ],
      {
        ...process.env,
        OPENAI_API_KEY: 'test-openai-key',
        GOOGLE_API_KEY: 'test-google-key',
        ANTHROPIC_API_KEY: 'test-anthropic-key',
      }
    );

    assert.equal(result.status, 0, `STDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.result, 'pass');
    assert.equal(parsed.final_state.status, 'completed');
    assert.equal(parsed.final_state.phase_gate_status.planning_signoff, 'passed');
    assert.equal(parsed.final_state.phase_gate_status.implementation_signoff, 'passed');
    assert.equal(parsed.final_state.phase_gate_status.qa_ship_verdict, 'passed');
    assert.deepEqual(parsed.history.roles, ['pm', 'architect', 'qa']);
    assert.equal(parsed.providers.openai.provider, 'openai');
    assert.equal(parsed.providers.google.provider, 'google');
    assert.equal(parsed.providers.anthropic.provider, 'anthropic');
    assert.equal(parsed.providers.openai.artifacts.turn_result.phase_transition_request, 'implementation');
    assert.equal(parsed.providers.google.artifacts.turn_result.phase_transition_request, 'qa');
    assert.equal(parsed.providers.anthropic.artifacts.turn_result.run_completion_request, true);
    assert.equal(openai.requestLog.length, 1);
    assert.equal(google.requestLog.length, 1);
    assert.equal(anthropic.requestLog.length, 1);
  });
});
