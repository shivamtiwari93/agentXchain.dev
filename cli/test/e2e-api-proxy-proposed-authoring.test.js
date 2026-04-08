/**
 * AT-PROXY-PROP-E2E-001
 *
 * CLI-level proof for api_proxy proposed authoring:
 *   - `step --role dev` sends proposed-authoring instructions to the provider
 *   - accepted proposal materializes to `.agentxchain/proposed/<turn_id>/`
 *   - the next review_only dispatch bundle includes the proposal in CONTEXT.md
 */

import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';

import { scaffoldGoverned } from '../src/commands/init.js';

const cliRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const binPath = join(cliRoot, 'bin', 'agentxchain.js');

const tempDirs = [];
const servers = [];

function startMockAnthropicServer() {
  return new Promise((resolve, reject) => {
    const requestLog = [];

    const server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          requestLog.push({
            headers: { ...req.headers },
            body: parsed,
            timestamp: new Date().toISOString(),
          });

          const userMsg = parsed.messages?.find((m) => m.role === 'user');
          const promptText = userMsg?.content || '';
          const runId = promptText.match(/"run_id"\s*:\s*"([^"]+)"/)?.[1] || 'run_mock';
          const turnId = promptText.match(/"turn_id"\s*:\s*"([^"]+)"/)?.[1] || 'turn_mock';
          const runtimeId = promptText.match(/"runtime_id"\s*:\s*"([^"]+)"/)?.[1] || 'api-dev';
          const roleId = promptText.match(/"assigned_role"\s*:\s*"([^"]+)"/)?.[1] || 'dev';

          const turnResult = {
            schema_version: '1.0',
            run_id: runId,
            turn_id: turnId,
            role: roleId,
            runtime_id: runtimeId,
            status: 'completed',
            summary: 'Mock api_proxy proposed authoring completed.',
            decisions: [{
              id: 'DEC-001',
              category: 'implementation',
              statement: 'Return structured proposed changes.',
              rationale: 'Integration proof for proposed authoring.',
            }],
            objections: [],
            files_changed: ['src/proxy-feature.js'],
            artifacts_created: [],
            verification: {
              status: 'pass',
              commands: ['echo ok'],
              evidence_summary: 'proposal staged',
              machine_evidence: [{ command: 'echo ok', exit_code: 0 }],
            },
            artifact: { type: 'patch', ref: null },
            proposed_next_role: 'qa',
            phase_transition_request: 'qa',
            run_completion_request: null,
            needs_human_reason: null,
            proposed_changes: [
              {
                path: 'src/proxy-feature.js',
                action: 'create',
                content: 'export const proxyFeature = "ready";\n',
              },
            ],
            cost: { input_tokens: 120, output_tokens: 180, usd: 0.01 },
          };

          const response = {
            id: `msg_mock_${Date.now()}`,
            type: 'message',
            role: 'assistant',
            content: [{
              type: 'text',
              text: JSON.stringify(turnResult, null, 2),
            }],
            model: 'claude-sonnet-4-6',
            stop_reason: 'end_turn',
            usage: { input_tokens: 120, output_tokens: 180 },
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

function makeProject(mockServerUrl) {
  const root = mkdtempSync(join(tmpdir(), 'axc-proxy-proposed-e2e-'));
  tempDirs.push(root);
  scaffoldGoverned(root, 'API Proxy Proposed Authoring E2E', `apiproxy-proposed-${Date.now()}`);

  const configPath = join(root, 'agentxchain.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));

  config.roles.dev.write_authority = 'proposed';
  config.roles.dev.runtime = 'api-dev';
  config.runtimes['api-dev'] = {
    type: 'api_proxy',
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    auth_env: 'MOCK_ANTHROPIC_KEY',
    base_url: mockServerUrl,
    max_output_tokens: 4096,
    timeout_seconds: 30,
    retry_policy: { max_attempts: 1 },
  };
  config.gates.implementation_complete = {
    requires_verification_pass: true,
  };

  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');

  const statePath = join(root, '.agentxchain', 'state.json');
  const state = JSON.parse(readFileSync(statePath, 'utf8'));
  state.run_id = `run_${Date.now()}`;
  state.status = 'active';
  state.phase = 'implementation';
  state.active_turns = {};
  state.completed_turns = [];
  state.phase_gate_status = {
    planning_signoff: 'passed',
    implementation_complete: 'pending',
    qa_ship_verdict: 'pending',
  };
  writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n');

  mkdirSync(join(root, '.planning'), { recursive: true });
  return root;
}

function runCliAsync(root, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [binPath, ...args], {
      cwd: root,
      env: {
        ...process.env,
        MOCK_ANTHROPIC_KEY: 'test-key-for-mock-server',
        ...(opts.env || {}),
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.stdin.end();

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

describe('api_proxy proposed authoring — CLI integration', () => {
  it('AT-PROXY-PROP-E2E-001: step materializes proposals and next review bundle sees them in context', async () => {
    const mock = await startMockAnthropicServer();
    const root = makeProject(mock.url);

    const stepResult = await runCliAsync(root, ['step', '--role', 'dev']);
    assert.equal(stepResult.status, 0,
      `Expected exit 0, got ${stepResult.status}.\nstdout: ${stepResult.stdout?.slice(-800)}\nstderr: ${stepResult.stderr?.slice(-800)}`);

    assert.equal(mock.requestLog.length, 1, 'Expected exactly one api_proxy request for the dev turn');
    const providerPrompt = mock.requestLog[0].body.messages.find((m) => m.role === 'user')?.content || '';
    assert.match(providerPrompt, /proposed_changes/, 'Provider prompt must instruct the model to return proposed_changes');
    assert.match(providerPrompt, /\.agentxchain\/proposed\/<turn_id>\//, 'Provider prompt must mention proposal materialization path');

    const state = JSON.parse(readFileSync(join(root, '.agentxchain', 'state.json'), 'utf8'));
    assert.equal(state.phase, 'qa', 'Accepted proposed turn should advance to qa');
    assert.ok(state.last_completed_turn_id, 'Accepted proposed turn should become the last completed turn');

    const proposalDir = join(root, '.agentxchain', 'proposed', state.last_completed_turn_id);
    assert.ok(existsSync(join(proposalDir, 'PROPOSAL.md')), 'Accepted proposal must materialize PROPOSAL.md');
    assert.ok(existsSync(join(proposalDir, 'src/proxy-feature.js')), 'Accepted proposal must materialize proposed files');

    const proposalMd = readFileSync(join(proposalDir, 'PROPOSAL.md'), 'utf8');
    assert.match(proposalMd, /src\/proxy-feature\.js/);
    assert.match(proposalMd, /Mock api_proxy proposed authoring completed/);

    const resumeResult = await runCliAsync(root, ['resume', '--role', 'qa']);
    assert.equal(resumeResult.status, 0,
      `Expected resume exit 0, got ${resumeResult.status}.\nstdout: ${resumeResult.stdout?.slice(-800)}\nstderr: ${resumeResult.stderr?.slice(-800)}`);

    const refreshedState = JSON.parse(readFileSync(join(root, '.agentxchain', 'state.json'), 'utf8'));
    const qaTurnId = Object.keys(refreshedState.active_turns || {})[0];
    assert.ok(qaTurnId, 'QA turn should be assigned after resume --role qa');

    const contextPath = join(root, '.agentxchain', 'dispatch', 'turns', qaTurnId, 'CONTEXT.md');
    const context = readFileSync(contextPath, 'utf8');
    assert.match(context, /### Proposed Artifact/);
    assert.match(context, new RegExp(`\\.agentxchain/proposed/${state.last_completed_turn_id}`));
    assert.match(context, /### Proposed File Previews/);
    assert.match(context, /#### `src\/proxy-feature\.js` \(create\)/);
    assert.match(context, /export const proxyFeature = "ready";/);
  });
});
