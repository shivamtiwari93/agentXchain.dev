/**
 * AT-PROP-COMPLETION-E2E-001 through AT-PROP-COMPLETION-E2E-005
 *
 * Subprocess E2E proof that proposal-only files do NOT satisfy run-completion
 * gates, and that proposal apply + a second QA turn allows run completion.
 *
 * Scenario:
 *   1. QA turn (api_proxy, proposed authority) proposes run-completion gate
 *      artifacts (ship-verdict.md, RELEASE_NOTES.md) + requests run_completion_request
 *   2. Gate fails because files are in .agentxchain/proposed/ not workspace
 *   3. Operator applies proposal → files in workspace → git commit
 *   4. Second QA turn requests run_completion_request again
 *   5. Gate passes → run completes (auto-complete since no human approval)
 *   6. Decision ledger has proposal-apply entry before completion
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

const VALID_SHIP_VERDICT = '## Verdict: YES\n\nAll acceptance criteria satisfied.\n';
const VALID_RELEASE_NOTES = '# Release Notes\n\n## User Impact\n\nNew feature delivered.\n\n## Verification Summary\n\nAll tests pass.\n';

function startMockServer() {
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
          const runtimeId = getLastPromptField(promptText, 'runtime_id') || 'api-qa';

          let turnResult;

          if (requestNumber === 1) {
            // First QA turn: propose gate-required artifacts + request run completion
            turnResult = {
              schema_version: '1.0',
              run_id: runId,
              turn_id: turnId,
              role: 'qa',
              runtime_id: runtimeId,
              status: 'completed',
              summary: 'QA review complete. Proposing ship verdict and release notes.',
              decisions: [{
                id: 'DEC-001',
                category: 'quality',
                statement: 'All acceptance criteria met. Proposing ship verdict.',
                rationale: 'Manual and automated tests pass.',
              }],
              objections: [{ id: 'OBJ-001', severity: 'low', statement: 'No blocking issues.' }],
              files_changed: ['.planning/ship-verdict.md', '.planning/RELEASE_NOTES.md'],
              artifacts_created: [],
              verification: {
                status: 'pass',
                commands: ['echo ok'],
                evidence_summary: 'QA review complete',
                machine_evidence: [{ command: 'echo ok', exit_code: 0 }],
              },
              artifact: { type: 'patch', ref: null },
              proposed_next_role: 'human',
              phase_transition_request: null,
              run_completion_request: true,
              needs_human_reason: null,
              proposed_changes: [
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
              cost: { input_tokens: 200, output_tokens: 300, usd: 0.03 },
            };
          } else {
            // Second QA turn: same artifacts now in workspace, request completion again
            turnResult = {
              schema_version: '1.0',
              run_id: runId,
              turn_id: turnId,
              role: 'qa',
              runtime_id: runtimeId,
              status: 'completed',
              summary: 'Verified applied proposal. Requesting run completion.',
              decisions: [{
                id: 'DEC-002',
                category: 'quality',
                statement: 'Proposal applied and verified. Run can complete.',
                rationale: 'Ship verdict and release notes are in workspace.',
              }],
              objections: [{ id: 'OBJ-002', severity: 'low', statement: 'Ship it.' }],
              files_changed: ['.planning/qa-verification.md'],
              artifacts_created: [],
              verification: {
                status: 'pass',
                commands: ['echo ok'],
                evidence_summary: 'post-apply verification complete',
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
                  content: '# QA Verification\n\nPost-apply review complete.\n',
                },
              ],
              cost: { input_tokens: 100, output_tokens: 150, usd: 0.02 },
            };
          }

          const response = {
            id: `msg_mock_${Date.now()}`,
            type: 'message',
            role: 'assistant',
            content: [{ type: 'text', text: JSON.stringify(turnResult, null, 2) }],
            model: 'claude-sonnet-4-6',
            stop_reason: 'end_turn',
            usage: { input_tokens: 200, output_tokens: 300 },
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
  const root = mkdtempSync(join(tmpdir(), 'axc-prop-completion-e2e-'));
  tempDirs.push(root);
  scaffoldGoverned(root, 'Proposal Completion E2E', `propcomp-${Date.now()}`);

  const configPath = join(root, 'agentxchain.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));

  // QA uses proposed authority via api_proxy
  config.roles.qa.write_authority = 'proposed';
  config.roles.qa.runtime = 'api-qa';
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

  // Run-completion gate requires files but NO human approval (auto-complete)
  config.gates.qa_ship_verdict = {
    requires_files: ['.planning/ship-verdict.md', '.planning/RELEASE_NOTES.md'],
    // No requires_human_approval — auto-complete for clean test flow
  };
  config.workflow_kit = {
    phases: {
      qa: {
        artifacts: [
          { path: '.planning/ship-verdict.md', semantics: 'ship_verdict', required: true },
          { path: '.planning/RELEASE_NOTES.md', semantics: 'release_notes', required: true },
        ],
      },
    },
  };

  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');

  // Set state to QA phase (final phase) with prior gates passed
  const statePath = join(root, '.agentxchain', 'state.json');
  const state = JSON.parse(readFileSync(statePath, 'utf8'));
  state.run_id = `run_${Date.now()}`;
  state.status = 'active';
  state.phase = 'qa';
  state.active_turns = {};
  state.completed_turns = [];
  state.phase_gate_status = {
    planning_signoff: 'passed',
    implementation_complete: 'passed',
    qa_ship_verdict: 'pending',
  };
  writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n');

  // Remove scaffolded gate-required files so gate must be satisfied by proposal apply
  const shipVerdictPath = join(root, '.planning', 'ship-verdict.md');
  const releaseNotesPath = join(root, '.planning', 'RELEASE_NOTES.md');
  if (existsSync(shipVerdictPath)) rmSync(shipVerdictPath);
  if (existsSync(releaseNotesPath)) rmSync(releaseNotesPath);

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

describe('proposal-aware run-completion gates — CLI E2E', () => {
  it('AT-PROP-COMPLETION-E2E: proposed gate files fail completion, proposal apply + second turn completes run', async () => {
    const mock = await startMockServer();
    const root = makeProject(mock.url);

    // ── Step 1: First QA turn proposes gate artifacts + requests run completion ──
    const step1 = await runCli(root, ['step', '--role', 'qa']);
    assert.equal(step1.status, 0,
      `First QA step failed.\nstdout: ${step1.stdout?.slice(-800)}\nstderr: ${step1.stderr?.slice(-800)}`);

    const state1 = JSON.parse(readFileSync(join(root, '.agentxchain', 'state.json'), 'utf8'));
    const turn1Id = state1.last_completed_turn_id;
    assert.ok(turn1Id, 'First QA turn should complete');

    // AT-PROP-COMPLETION-E2E-001: Run must NOT be completed — gate files only in proposal dir
    assert.notEqual(state1.status, 'completed',
      'Run must NOT complete when gate-required files exist only in proposal directory');
    assert.equal(state1.status, 'active',
      'Run should remain active when run-completion gate fails');

    // AT-PROP-COMPLETION-E2E-002: Proposal was materialized
    const proposalDir = join(root, '.agentxchain', 'proposed', turn1Id);
    assert.ok(existsSync(join(proposalDir, 'PROPOSAL.md')),
      'Proposal must be materialized');
    assert.ok(existsSync(join(proposalDir, '.planning/ship-verdict.md')),
      'Gate-required ship-verdict.md must be in proposal directory');
    assert.ok(existsSync(join(proposalDir, '.planning/RELEASE_NOTES.md')),
      'Gate-required RELEASE_NOTES.md must be in proposal directory');

    // Files must NOT be in workspace yet
    assert.ok(!existsSync(join(root, '.planning', 'ship-verdict.md')),
      'ship-verdict.md must NOT be in workspace before proposal apply');
    assert.ok(!existsSync(join(root, '.planning', 'RELEASE_NOTES.md')),
      'RELEASE_NOTES.md must NOT be in workspace before proposal apply');

    // ── Step 2: Operator applies proposal ──
    const applyResult = await runCli(root, ['proposal', 'apply', turn1Id]);
    assert.equal(applyResult.status, 0,
      `Proposal apply failed.\nstdout: ${applyResult.stdout?.slice(-800)}\nstderr: ${applyResult.stderr?.slice(-800)}`);
    assert.match(applyResult.stdout, /Proposal Applied/);

    // Verify files are now in workspace
    assert.ok(existsSync(join(root, '.planning', 'ship-verdict.md')),
      'ship-verdict.md must be in workspace after proposal apply');
    assert.ok(existsSync(join(root, '.planning', 'RELEASE_NOTES.md')),
      'RELEASE_NOTES.md must be in workspace after proposal apply');

    // AT-PROP-COMPLETION-E2E-003: Decision ledger has proposal-apply entry
    const ledger1 = readFileSync(join(root, '.agentxchain', 'decision-ledger.jsonl'), 'utf8')
      .trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const applyEntry = ledger1.find((e) => e.category === 'proposal' && e.action === 'applied');
    assert.ok(applyEntry, 'Decision ledger must have proposal-apply entry');
    assert.equal(applyEntry.turn_id, turn1Id);
    assert.ok(applyEntry.files.includes('.planning/ship-verdict.md'),
      'Proposal-apply ledger entry must list ship-verdict.md');
    assert.ok(applyEntry.files.includes('.planning/RELEASE_NOTES.md'),
      'Proposal-apply ledger entry must list RELEASE_NOTES.md');

    // Commit applied files so baseline is clean for next turn
    execSync('git add .', { cwd: root, stdio: 'ignore' });
    execSync('git commit -m "apply proposal"', { cwd: root, stdio: 'ignore' });

    // ── Step 3: Second QA turn requests run completion → gate should pass ──
    const step2 = await runCli(root, ['step', '--role', 'qa']);
    assert.equal(step2.status, 0,
      `Second QA step failed.\nstdout: ${step2.stdout?.slice(-800)}\nstderr: ${step2.stderr?.slice(-800)}`);

    const state2 = JSON.parse(readFileSync(join(root, '.agentxchain', 'state.json'), 'utf8'));

    // AT-PROP-COMPLETION-E2E-004: Run completed (auto-complete, no human approval)
    assert.equal(state2.status, 'completed',
      'Run must complete when gate-required files are in workspace after proposal apply');
    assert.ok(state2.completed_at, 'completed_at must be set');

    // AT-PROP-COMPLETION-E2E-005: Audit trail has proposal-apply before completion
    const ledger2 = readFileSync(join(root, '.agentxchain', 'decision-ledger.jsonl'), 'utf8')
      .trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const applyIdx = ledger2.findIndex((e) => e.category === 'proposal' && e.action === 'applied');
    const secondTurnDecIdx = ledger2.findIndex((e) => e.id === 'DEC-002');
    assert.ok(applyIdx >= 0, 'Ledger must contain proposal-apply');
    assert.ok(secondTurnDecIdx >= 0, 'Ledger must contain second turn decision');
    assert.ok(applyIdx < secondTurnDecIdx,
      'Proposal-apply must appear in ledger before second turn decisions');

    // History should have exactly 2 accepted turns
    const history = readFileSync(join(root, '.agentxchain', 'history.jsonl'), 'utf8')
      .trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
    assert.equal(history.length, 2, 'History must have exactly 2 accepted turns');

    // Verify mock received exactly 2 requests
    assert.equal(mock.requestLog.length, 2,
      'Expected exactly 2 api_proxy requests (one per QA turn)');

    // Verify step on completed run exits cleanly with "already completed" message
    const cantStep = await runCli(root, ['step', '--role', 'qa']);
    assert.match(cantStep.stdout, /already completed/i,
      'Step on a completed run must report it is already completed');
  });
});
