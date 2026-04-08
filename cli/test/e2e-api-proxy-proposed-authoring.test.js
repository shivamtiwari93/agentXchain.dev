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
import { execSync, spawn } from 'node:child_process';
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

    function getLastPromptField(promptText, fieldName) {
      const matches = [...promptText.matchAll(new RegExp(`"${fieldName}"\\s*:\\s*"([^"]+)"`, 'g'))];
      return matches.length > 0 ? matches[matches.length - 1][1] : null;
    }

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
          const requestNumber = requestLog.length;

          const userMsg = parsed.messages?.find((m) => m.role === 'user');
          const promptText = userMsg?.content || '';
          const runId = getLastPromptField(promptText, 'run_id') || 'run_mock';
          const turnId = getLastPromptField(promptText, 'turn_id') || 'turn_mock';
          const isProposedAuthoringPrompt = requestNumber === 1;
          const roleId = getLastPromptField(promptText, 'assigned_role')
            || (isProposedAuthoringPrompt ? 'dev' : 'qa');
          const runtimeId = getLastPromptField(promptText, 'runtime_id')
            || (roleId === 'qa' ? 'api-qa' : 'api-dev');

          const turnResult = !isProposedAuthoringPrompt
            ? {
              schema_version: '1.0',
              run_id: runId,
              turn_id: turnId,
              role: roleId,
              runtime_id: runtimeId,
              status: 'completed',
              summary: 'Mock api_proxy QA review completed.',
              decisions: [{
                id: 'DEC-002',
                category: 'quality',
                statement: 'Proposal application reviewed successfully.',
                rationale: 'Integration proof for post-apply acceptance.',
              }],
              objections: [{
                id: 'OBJ-001',
                severity: 'low',
                statement: 'Review-only QA confirmed the staged proposal still needs normal human/operator judgement before ship.',
                status: 'raised',
              }],
              files_changed: [],
              artifacts_created: [],
              verification: {
                status: 'pass',
                commands: ['echo ok'],
                evidence_summary: 'qa review passed',
                machine_evidence: [{ command: 'echo ok', exit_code: 0 }],
              },
              artifact: { type: 'review', ref: null },
              proposed_next_role: 'human',
              phase_transition_request: null,
              run_completion_request: null,
              needs_human_reason: null,
              cost: { input_tokens: 80, output_tokens: 140, usd: 0.01 },
            }
            : {
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
  config.roles.qa.write_authority = 'review_only';
  config.roles.qa.runtime = 'api-qa';
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
  config.gates.implementation_complete = {
    requires_verification_pass: true,
  };
  config.workflow_kit = {};

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
  execSync('git init', { cwd: root, stdio: 'ignore' });
  execSync('git config user.email "test@example.com"', { cwd: root, stdio: 'ignore' });
  execSync('git config user.name "Test User"', { cwd: root, stdio: 'ignore' });
  execSync('git add .', { cwd: root, stdio: 'ignore' });
  execSync('git commit -m "baseline"', { cwd: root, stdio: 'ignore' });
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

  it('AT-PROXY-PROP-E2E-002: proposal list/diff/apply integrates cleanly with the next QA acceptance', async () => {
    const mock = await startMockAnthropicServer();
    const root = makeProject(mock.url);

    const devStep = await runCliAsync(root, ['step', '--role', 'dev']);
    assert.equal(devStep.status, 0,
      `Expected dev step exit 0, got ${devStep.status}.\nstdout: ${devStep.stdout?.slice(-800)}\nstderr: ${devStep.stderr?.slice(-800)}`);

    const stateAfterDev = JSON.parse(readFileSync(join(root, '.agentxchain', 'state.json'), 'utf8'));
    const proposalTurnId = stateAfterDev.last_completed_turn_id;
    assert.ok(proposalTurnId, 'dev step should complete a proposal turn');

    const listPending = await runCliAsync(root, ['proposal', 'list']);
    assert.equal(listPending.status, 0);
    assert.match(listPending.stdout, new RegExp(proposalTurnId));
    assert.match(listPending.stdout, /pending/);

    const diffResult = await runCliAsync(root, ['proposal', 'diff', proposalTurnId]);
    assert.equal(diffResult.status, 0);
    assert.match(diffResult.stdout, /src\/proxy-feature\.js/);
    assert.match(diffResult.stdout, /new file/i);

    const applyResult = await runCliAsync(root, ['proposal', 'apply', proposalTurnId]);
    assert.equal(applyResult.status, 0,
      `Expected proposal apply exit 0, got ${applyResult.status}.\nstdout: ${applyResult.stdout?.slice(-800)}\nstderr: ${applyResult.stderr?.slice(-800)}`);
    assert.match(applyResult.stdout, /Proposal Applied/);
    assert.ok(existsSync(join(root, 'src', 'proxy-feature.js')), 'proposal apply must copy the staged file into the workspace');
    assert.ok(existsSync(join(root, '.agentxchain', 'proposed', proposalTurnId, 'APPLIED.json')),
      'proposal apply must record APPLIED.json');

    const listApplied = await runCliAsync(root, ['proposal', 'list']);
    assert.equal(listApplied.status, 0);
    assert.match(listApplied.stdout, /applied/);

    const qaStep = await runCliAsync(root, ['step', '--role', 'qa']);
    assert.equal(qaStep.status, 0,
      `Expected qa step exit 0, got ${qaStep.status}.\nstdout: ${qaStep.stdout?.slice(-800)}\nstderr: ${qaStep.stderr?.slice(-800)}`);
    assert.doesNotMatch(qaStep.stdout + qaStep.stderr, /Observed artifact mismatch|review_only role modified product files|Acceptance conflict/i,
      'QA acceptance must not blame proposal-applied workspace files on the reviewer');

    assert.equal(mock.requestLog.length, 2, 'Expected one api_proxy request for dev and one for qa');
    const qaPrompt = mock.requestLog[1].body.messages.find((m) => m.role === 'user')?.content || '';
    assert.doesNotMatch(qaPrompt, /proposed_changes/,
      'QA review prompt should not instruct review_only turns to return proposed_changes');

    const historyLines = readFileSync(join(root, '.agentxchain', 'history.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    const finalState = JSON.parse(readFileSync(join(root, '.agentxchain', 'state.json'), 'utf8'));
    assert.equal(historyLines.length, 2, 'history should contain accepted dev and qa turns');
    assert.deepEqual(historyLines.map((entry) => entry.role), ['dev', 'qa']);
    assert.equal(finalState.last_completed_turn_id, historyLines[1].turn_id,
      'QA turn should become the last completed turn after proposal apply');
    assert.equal(Object.keys(finalState.active_turns || {}).length, 0, 'QA acceptance should clear active turns');
    assert.deepEqual(historyLines[1].artifact.files_changed || [], [],
      'QA acceptance should not attribute the proposal-applied workspace file to the qa turn');
  });
});
