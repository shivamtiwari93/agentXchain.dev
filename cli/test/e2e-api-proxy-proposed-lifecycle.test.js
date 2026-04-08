/**
 * AT-APIPROXY-PROP-LC-001 through AT-APIPROXY-PROP-LC-006
 *
 * Subprocess E2E proof for the missing lifecycle slice:
 *   planning -> implementation -> qa -> completion
 * with `api_proxy` using `proposed` authority in implementation and QA.
 *
 * The key contract is not just proposal materialization in isolation. The
 * operator `proposal apply` actions must be part of the real governed path
 * that advances gates and completes the run.
 */

import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';

import { scaffoldGoverned } from '../src/commands/init.js';

const cliRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const binPath = join(cliRoot, 'bin', 'agentxchain.js');
const mockAgentPath = join(cliRoot, 'test-support', 'mock-agent.mjs');

const tempDirs = [];
const servers = [];

const VALID_IMPL_NOTES = `# Implementation Notes

## Changes

- Added src/proxy-feature.js with the governed implementation slice
- Added src/impl-verification.js with a follow-up verification helper

## Verification

- \`echo ok\`
- Implementation proposal applied and committed before QA
`;

const VALID_ACCEPTANCE_MATRIX = `# Acceptance Matrix

| Req # | Requirement | Acceptance criteria | Test status | Last tested | Status |
|-------|-------------|-------------------|-------------|-------------|--------|
| 1 | Proposed implementation enters QA honestly | Implementation gate only passes after proposal apply | pass | 2026-04-07 | pass |
| 2 | Proposed QA artifacts gate completion honestly | Completion gate only passes after proposal apply | pass | 2026-04-07 | pass |
`;

const VALID_SHIP_VERDICT = `# Ship Verdict

## Verdict: YES

Implementation and QA proposal flows were applied and verified.
`;

const VALID_RELEASE_NOTES = `# Release Notes

## User Impact

Governed lifecycle proof now covers api_proxy proposed authoring in implementation and QA.

## Verification Summary

- \`node --test cli/test/e2e-api-proxy-proposed-lifecycle.test.js\`
`;

const VALID_QA_VERIFICATION = `# QA Verification

Final QA review confirmed the applied artifacts match the governed run intent.
`;

function startMockAnthropicServer() {
  return new Promise((resolve, reject) => {
    const requestLog = [];
    const roleCounts = {};

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
          const userMsg = parsed.messages?.find((m) => m.role === 'user');
          const promptText = userMsg?.content || '';
          const runId = getLastPromptField(promptText, 'run_id') || 'run_mock';
          const turnId = getLastPromptField(promptText, 'turn_id') || 'turn_mock';
          const requestNumber = requestLog.length + 1;
          const roleId = requestNumber <= 2 ? 'dev' : 'qa';
          const runtimeId = roleId === 'qa' ? 'api-qa' : 'api-dev';

          roleCounts[roleId] = (roleCounts[roleId] || 0) + 1;

          requestLog.push({
            headers: { ...req.headers },
            body: parsed,
            role: roleId,
            turn: roleCounts[roleId],
            timestamp: new Date().toISOString(),
          });

          let turnResult;

          if (roleId === 'dev' && roleCounts[roleId] === 1) {
            turnResult = {
              schema_version: '1.0',
              run_id: runId,
              turn_id: turnId,
              role: 'dev',
              runtime_id: runtimeId,
              status: 'completed',
              summary: 'Proposed implementation artifacts for the governed lifecycle proof.',
              decisions: [{
                id: 'DEC-001',
                category: 'implementation',
                statement: 'Stage implementation artifacts as a proposal before QA.',
                rationale: 'Implementation gate must not pass on proposal-only files.',
              }],
              objections: [],
              files_changed: ['src/proxy-feature.js', '.planning/IMPLEMENTATION_NOTES.md'],
              artifacts_created: [],
              verification: {
                status: 'pass',
                commands: ['echo ok'],
                evidence_summary: 'implementation proposal staged',
                machine_evidence: [{ command: 'echo ok', exit_code: 0 }],
              },
              artifact: { type: 'patch', ref: null },
              proposed_next_role: 'dev',
              phase_transition_request: 'qa',
              run_completion_request: null,
              needs_human_reason: null,
              proposed_changes: [
                {
                  path: 'src/proxy-feature.js',
                  action: 'create',
                  content: 'export const proxyFeature = "ready";\n',
                },
                {
                  path: '.planning/IMPLEMENTATION_NOTES.md',
                  action: 'create',
                  content: VALID_IMPL_NOTES,
                },
              ],
              cost: { input_tokens: 120, output_tokens: 180, usd: 0.01 },
            };
          } else if (roleId === 'dev' && roleCounts[roleId] === 2) {
            turnResult = {
              schema_version: '1.0',
              run_id: runId,
              turn_id: turnId,
              role: 'dev',
              runtime_id: runtimeId,
              status: 'completed',
              summary: 'Verified applied implementation and requested QA.',
              decisions: [{
                id: 'DEC-002',
                category: 'implementation',
                statement: 'Implementation proposal was applied and the phase may advance to QA.',
                rationale: 'Gate-required workspace files now exist in the repo.',
              }],
              objections: [],
              files_changed: ['src/impl-verification.js'],
              artifacts_created: [],
              verification: {
                status: 'pass',
                commands: ['echo ok'],
                evidence_summary: 'implementation verified after proposal apply',
                machine_evidence: [{ command: 'echo ok', exit_code: 0 }],
              },
              artifact: { type: 'patch', ref: null },
              proposed_next_role: 'qa',
              phase_transition_request: 'qa',
              run_completion_request: null,
              needs_human_reason: null,
              proposed_changes: [
                {
                  path: 'src/impl-verification.js',
                  action: 'create',
                  content: 'export const implementationVerified = true;\n',
                },
              ],
              cost: { input_tokens: 90, output_tokens: 120, usd: 0.01 },
            };
          } else if (roleId === 'qa' && roleCounts[roleId] === 1) {
            turnResult = {
              schema_version: '1.0',
              run_id: runId,
              turn_id: turnId,
              role: 'qa',
              runtime_id: runtimeId,
              status: 'completed',
              summary: 'Proposed QA completion artifacts for governed ship review.',
              decisions: [{
                id: 'DEC-003',
                category: 'quality',
                statement: 'Stage completion-gate artifacts as a proposal before ship approval.',
                rationale: 'Completion must fail closed until proposal apply copies them into the workspace.',
              }],
              objections: [],
              files_changed: ['.planning/acceptance-matrix.md', '.planning/ship-verdict.md', '.planning/RELEASE_NOTES.md'],
              artifacts_created: [],
              verification: {
                status: 'pass',
                commands: ['echo ok'],
                evidence_summary: 'qa completion proposal staged',
                machine_evidence: [{ command: 'echo ok', exit_code: 0 }],
              },
              artifact: { type: 'patch', ref: null },
              proposed_next_role: 'qa',
              phase_transition_request: null,
              run_completion_request: true,
              needs_human_reason: null,
              proposed_changes: [
                {
                  path: '.planning/acceptance-matrix.md',
                  action: 'create',
                  content: VALID_ACCEPTANCE_MATRIX,
                },
                {
                  path: '.planning/ship-verdict.md',
                  action: 'create',
                  content: VALID_SHIP_VERDICT,
                },
                {
                  path: '.planning/RELEASE_NOTES.md',
                  action: 'create',
                  content: VALID_RELEASE_NOTES,
                },
              ],
              cost: { input_tokens: 150, output_tokens: 220, usd: 0.02 },
            };
          } else if (roleId === 'qa' && roleCounts[roleId] === 2) {
            turnResult = {
              schema_version: '1.0',
              run_id: runId,
              turn_id: turnId,
              role: 'qa',
              runtime_id: runtimeId,
              status: 'completed',
              summary: 'Verified applied QA artifacts and requested human ship approval.',
              decisions: [{
                id: 'DEC-004',
                category: 'quality',
                statement: 'Applied QA gate artifacts are present and ready for human ship approval.',
                rationale: 'Completion gate should pause for approval, not auto-complete.',
              }],
              objections: [],
              files_changed: ['.planning/qa-verification.md'],
              artifacts_created: [],
              verification: {
                status: 'pass',
                commands: ['echo ok'],
                evidence_summary: 'qa verification complete after proposal apply',
                machine_evidence: [{ command: 'echo ok', exit_code: 0 }],
              },
              artifact: { type: 'patch', ref: null },
              proposed_next_role: 'human',
              phase_transition_request: null,
              run_completion_request: true,
              needs_human_reason: null,
              proposed_changes: [
                {
                  path: '.planning/qa-verification.md',
                  action: 'create',
                  content: VALID_QA_VERIFICATION,
                },
              ],
              cost: { input_tokens: 110, output_tokens: 150, usd: 0.01 },
            };
          } else {
            throw new Error(`Unexpected request sequence for role "${roleId}" (#${roleCounts[roleId]})`);
          }

          const response = {
            id: `msg_mock_${Date.now()}`,
            type: 'message',
            role: 'assistant',
            content: [{ type: 'text', text: JSON.stringify(turnResult, null, 2) }],
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

function removeIfExists(path) {
  if (existsSync(path)) {
    unlinkSync(path);
  }
}

function makeProject(mockServerUrl) {
  const root = mkdtempSync(join(tmpdir(), 'axc-apiproxy-proposed-lifecycle-'));
  tempDirs.push(root);
  scaffoldGoverned(root, 'API Proxy Proposed Lifecycle E2E', `apiprop-life-${Date.now()}`);

  const configPath = join(root, 'agentxchain.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));

  config.runtimes['local-pm'] = {
    type: 'local_cli',
    command: process.execPath,
    args: [mockAgentPath],
    prompt_transport: 'dispatch_bundle_only',
  };
  config.roles.pm.write_authority = 'authoritative';
  config.roles.pm.runtime = 'local-pm';

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
  config.roles.dev.write_authority = 'proposed';
  config.roles.dev.runtime = 'api-dev';

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
  config.roles.qa.write_authority = 'proposed';
  config.roles.qa.runtime = 'api-qa';

  config.gates.planning_signoff = {
    requires_files: ['.planning/PM_SIGNOFF.md', '.planning/ROADMAP.md'],
    requires_human_approval: true,
  };
  config.gates.implementation_complete = {
    requires_files: ['.planning/IMPLEMENTATION_NOTES.md'],
    requires_verification_pass: true,
  };
  config.gates.qa_ship_verdict = {
    requires_files: ['.planning/acceptance-matrix.md', '.planning/ship-verdict.md', '.planning/RELEASE_NOTES.md'],
    requires_human_approval: true,
  };

  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');

  removeIfExists(join(root, '.planning', 'PM_SIGNOFF.md'));
  removeIfExists(join(root, '.planning', 'ROADMAP.md'));
  removeIfExists(join(root, '.planning', 'IMPLEMENTATION_NOTES.md'));
  removeIfExists(join(root, '.planning', 'acceptance-matrix.md'));
  removeIfExists(join(root, '.planning', 'ship-verdict.md'));
  removeIfExists(join(root, '.planning', 'RELEASE_NOTES.md'));
  removeIfExists(join(root, '.planning', 'qa-verification.md'));

  execSync('git init', { cwd: root, stdio: 'ignore' });
  execSync('git config user.email "test@example.com"', { cwd: root, stdio: 'ignore' });
  execSync('git config user.name "Test User"', { cwd: root, stdio: 'ignore' });
  execSync('git add .', { cwd: root, stdio: 'ignore' });
  execSync('git commit -m "baseline"', { cwd: root, stdio: 'ignore' });
  return root;
}

function runCli(root, args, opts = {}) {
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
    child.stdin.end(opts.input || '');

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

function readState(root) {
  return JSON.parse(readFileSync(join(root, '.agentxchain', 'state.json'), 'utf8'));
}

function readLedger(root) {
  const ledgerPath = join(root, '.agentxchain', 'decision-ledger.jsonl');
  const content = readFileSync(ledgerPath, 'utf8').trim();
  return content ? content.split('\n').map((line) => JSON.parse(line)) : [];
}

function commitAll(root, message) {
  execSync('git add .', { cwd: root, stdio: 'ignore' });
  execSync(`git commit -m "${message}"`, { cwd: root, stdio: 'ignore' });
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
  for (const s of servers.splice(0)) {
    try { s.close(); } catch {}
  }
});

describe('api_proxy proposed lifecycle — governed CLI E2E', () => {
  it('AT-APIPROXY-PROP-LC: planning approval + proposed implementation + proposed QA complete truthfully', async () => {
    const mock = await startMockAnthropicServer();
    const root = makeProject(mock.url);

    const planningStep = await runCli(root, ['step', '--role', 'pm']);
    assert.equal(planningStep.status, 0,
      `Planning step failed.\nstdout: ${planningStep.stdout?.slice(-800)}\nstderr: ${planningStep.stderr?.slice(-800)}`);

    const stateAfterPlanning = readState(root);
    assert.equal(stateAfterPlanning.status, 'paused',
      'AT-APIPROXY-PROP-LC-001: planning gate must pause for approval');
    assert.equal(stateAfterPlanning.pending_phase_transition?.to, 'implementation',
      'AT-APIPROXY-PROP-LC-001: pending transition must target implementation');

    const approvePlanning = await runCli(root, ['approve-transition']);
    assert.equal(approvePlanning.status, 0,
      `approve-transition failed.\nstdout: ${approvePlanning.stdout?.slice(-800)}\nstderr: ${approvePlanning.stderr?.slice(-800)}`);

    commitAll(root, 'accept planning phase');

    const devStep1 = await runCli(root, ['step', '--role', 'dev']);
    assert.equal(devStep1.status, 0,
      `First dev step failed.\nstdout: ${devStep1.stdout?.slice(-800)}\nstderr: ${devStep1.stderr?.slice(-800)}`);

    const stateAfterDev1 = readState(root);
    const devTurn1 = stateAfterDev1.last_completed_turn_id;
    assert.equal(stateAfterDev1.phase, 'implementation',
      'AT-APIPROXY-PROP-LC-002: implementation must not advance on proposal-only gate files');
    assert.equal(stateAfterDev1.status, 'active',
      'AT-APIPROXY-PROP-LC-002: run should stay active when the implementation gate fails');
    assert.ok(existsSync(join(root, '.agentxchain', 'proposed', devTurn1, 'PROPOSAL.md')),
      'AT-APIPROXY-PROP-LC-002: first implementation proposal must materialize');
    assert.ok(!existsSync(join(root, '.planning', 'IMPLEMENTATION_NOTES.md')),
      'AT-APIPROXY-PROP-LC-002: implementation notes must not be in workspace before proposal apply');

    const applyDev1 = await runCli(root, ['proposal', 'apply', devTurn1]);
    assert.equal(applyDev1.status, 0,
      `First implementation proposal apply failed.\nstdout: ${applyDev1.stdout?.slice(-800)}\nstderr: ${applyDev1.stderr?.slice(-800)}`);
    commitAll(root, 'apply implementation proposal');

    const devStep2 = await runCli(root, ['step', '--role', 'dev']);
    assert.equal(devStep2.status, 0,
      `Second dev step failed.\nstdout: ${devStep2.stdout?.slice(-800)}\nstderr: ${devStep2.stderr?.slice(-800)}`);

    const stateAfterDev2 = readState(root);
    const devTurn2 = stateAfterDev2.last_completed_turn_id;
    assert.equal(stateAfterDev2.phase, 'qa',
      'AT-APIPROXY-PROP-LC-003: second implementation turn must advance to qa after proposal apply');
    assert.equal(stateAfterDev2.phase_gate_status?.implementation_complete, 'passed',
      'AT-APIPROXY-PROP-LC-003: implementation gate must be marked passed');

    const applyDev2 = await runCli(root, ['proposal', 'apply', devTurn2]);
    assert.equal(applyDev2.status, 0,
      `Second implementation proposal apply failed.\nstdout: ${applyDev2.stdout?.slice(-800)}\nstderr: ${applyDev2.stderr?.slice(-800)}`);
    commitAll(root, 'apply implementation verification proposal');

    const qaStep1 = await runCli(root, ['step', '--role', 'qa']);
    assert.equal(qaStep1.status, 0,
      `First QA step failed.\nstdout: ${qaStep1.stdout?.slice(-800)}\nstderr: ${qaStep1.stderr?.slice(-800)}`);

    const stateAfterQa1 = readState(root);
    const qaTurn1 = stateAfterQa1.last_completed_turn_id;
    assert.equal(stateAfterQa1.phase, 'qa',
      'AT-APIPROXY-PROP-LC-004: qa phase must remain active before completion artifacts are applied');
    assert.equal(stateAfterQa1.status, 'active',
      'AT-APIPROXY-PROP-LC-004: run must stay active when completion artifacts exist only in a proposal');
    assert.ok(existsSync(join(root, '.agentxchain', 'proposed', qaTurn1, '.planning', 'ship-verdict.md')),
      'AT-APIPROXY-PROP-LC-004: first QA proposal must include ship verdict');
    assert.ok(!existsSync(join(root, '.planning', 'ship-verdict.md')),
      'AT-APIPROXY-PROP-LC-004: ship verdict must not be in workspace before proposal apply');

    const applyQa1 = await runCli(root, ['proposal', 'apply', qaTurn1]);
    assert.equal(applyQa1.status, 0,
      `First QA proposal apply failed.\nstdout: ${applyQa1.stdout?.slice(-800)}\nstderr: ${applyQa1.stderr?.slice(-800)}`);
    commitAll(root, 'apply qa completion proposal');

    const qaStep2 = await runCli(root, ['step', '--role', 'qa']);
    assert.equal(qaStep2.status, 0,
      `Second QA step failed.\nstdout: ${qaStep2.stdout?.slice(-800)}\nstderr: ${qaStep2.stderr?.slice(-800)}`);

    const stateAfterQa2 = readState(root);
    const qaTurn2 = stateAfterQa2.last_completed_turn_id;
    assert.equal(stateAfterQa2.status, 'paused',
      'AT-APIPROXY-PROP-LC-005: second QA turn must pause on pending run completion');
    assert.equal(stateAfterQa2.pending_run_completion?.gate, 'qa_ship_verdict',
      'AT-APIPROXY-PROP-LC-005: pending run completion must point at qa_ship_verdict');

    const applyQa2 = await runCli(root, ['proposal', 'apply', qaTurn2]);
    assert.equal(applyQa2.status, 0,
      `Second QA proposal apply failed.\nstdout: ${applyQa2.stdout?.slice(-800)}\nstderr: ${applyQa2.stderr?.slice(-800)}`);
    commitAll(root, 'apply qa verification proposal');

    const approveCompletion = await runCli(root, ['approve-completion']);
    assert.equal(approveCompletion.status, 0,
      `approve-completion failed.\nstdout: ${approveCompletion.stdout?.slice(-800)}\nstderr: ${approveCompletion.stderr?.slice(-800)}`);

    const finalState = readState(root);
    assert.equal(finalState.status, 'completed',
      'AT-APIPROXY-PROP-LC-006: approve-completion must complete the run');
    assert.equal(finalState.phase_gate_status?.qa_ship_verdict, 'passed',
      'AT-APIPROXY-PROP-LC-006: completion gate must be marked passed after approval');

    const ledger = readLedger(root);
    const proposalApplyEntries = ledger.filter((entry) => entry.category === 'proposal' && entry.action === 'applied');
    assert.equal(proposalApplyEntries.length, 4,
      'AT-APIPROXY-PROP-LC-006: decision ledger must record all four proposal apply actions');

    assert.equal(mock.requestLog.length, 4,
      'Expected exactly four api_proxy requests (two dev turns, two qa turns)');
    assert.equal(mock.requestLog.filter((entry) => entry.role === 'dev').length, 2,
      'Expected exactly two dev api_proxy requests');
    assert.equal(mock.requestLog.filter((entry) => entry.role === 'qa').length, 2,
      'Expected exactly two qa api_proxy requests');
  });
});
