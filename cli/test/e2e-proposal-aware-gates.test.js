/**
 * AT-GATE-PROP-001 through AT-GATE-PROP-005
 *
 * CLI-level proof that operator-applied proposal files satisfy downstream
 * completion gates without lying about authorship.
 *
 * Scenario:
 *   1. Dev turn (api_proxy, proposed authority) proposes a gate-required
 *      artifact (.planning/IMPLEMENTATION_NOTES.md) + product code
 *   2. Dev turn requests phase_transition_request: 'qa'
 *   3. Gate fails because the file is in .agentxchain/proposed/ not workspace
 *   4. Operator applies proposal → files in workspace → git commit
 *   5. Second dev turn requests the same transition
 *   6. Gate passes → phase advances to 'qa'
 *   7. Decision ledger has proposal-apply entry before gate passage
 *   8. Second turn's observed artifact does not include proposal-applied files
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

const VALID_IMPL_NOTES = `# Implementation Notes

## Changes

- Added src/feature.js with core proxy feature implementation
- Updated module exports

## Verification

- Unit tests pass: \`node --test test/feature.test.js\` → 3 tests / 0 failures
- Manual verification: feature loads correctly in governed run
`;

function startMockServer() {
  return new Promise((resolve, reject) => {
    const requestLog = [];

    function getLastPromptField(promptText, fieldName) {
      const matches = [...promptText.matchAll(new RegExp(`"${fieldName}"\\s*:\\s*"([^"]+)"`, 'g'))];
      return matches.length > 0 ? matches[matches.length - 1][1] : null;
    }

    function getPromptPhase(promptText) {
      const jsonPhase = getLastPromptField(promptText, 'phase');
      if (jsonPhase) return jsonPhase;
      const markdownPhase = promptText.match(/\*\*Phase:\*\*\s+([^\s\n]+)/);
      if (markdownPhase) return markdownPhase[1];
      const plainPhase = promptText.match(/^Phase:\s+([^\s\n]+)/m);
      return plainPhase ? plainPhase[1] : null;
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
          const runtimeId = getLastPromptField(promptText, 'runtime_id') || 'api-dev';
          const phase = getPromptPhase(promptText) || 'implementation';

          let turnResult;

          if (requestNumber === 1) {
            // First dev turn: propose gate-required artifact + product code
            turnResult = {
              schema_version: '1.0',
              run_id: runId,
              turn_id: turnId,
              role: 'dev',
              runtime_id: runtimeId,
              status: 'completed',
              summary: 'Proposed implementation with gate artifact.',
              decisions: [{
                id: 'DEC-001',
                category: 'implementation',
                statement: 'Structured implementation with proposed changes.',
                rationale: 'Gate artifact included in proposal.',
              }],
              objections: [],
              files_changed: ['src/feature.js', '.planning/IMPLEMENTATION_NOTES.md'],
              artifacts_created: [],
              verification: {
                status: 'pass',
                commands: ['echo ok'],
                evidence_summary: 'proposed implementation staged',
                machine_evidence: [{ command: 'echo ok', exit_code: 0 }],
              },
              artifact: { type: 'patch', ref: null },
              proposed_next_role: 'dev',
              phase_transition_request: 'qa',
              run_completion_request: null,
              needs_human_reason: null,
              proposed_changes: [
                {
                  path: '.planning/IMPLEMENTATION_NOTES.md',
                  action: 'create',
                  content: VALID_IMPL_NOTES,
                },
                {
                  path: 'src/feature.js',
                  action: 'create',
                  content: 'export const feature = "ready";\n',
                },
              ],
              cost: { input_tokens: 150, output_tokens: 200, usd: 0.02 },
            };
          } else {
            // Second dev turn: verification pass + the valid request for the
            // phase observed in the dispatch prompt. Proposal apply can advance
            // the pending implementation gate before this turn runs, so the mock
            // must not keep requesting a transition from the final qa phase.
            const isFinalPhase = phase === 'qa';
            const nextRequestSummary = isFinalPhase
              ? 'Verified implementation and requested run completion.'
              : 'Verified implementation and requested phase transition.';
            // Still needs proposed_changes because write_authority is 'proposed'
            turnResult = {
              schema_version: '1.0',
              run_id: runId,
              turn_id: turnId,
              role: 'dev',
              runtime_id: runtimeId,
              status: 'completed',
              summary: nextRequestSummary,
              decisions: [{
                id: 'DEC-002',
                category: 'implementation',
                statement: isFinalPhase
                  ? 'Implementation verified in QA, requesting run completion.'
                  : 'Implementation verified, requesting QA phase.',
                rationale: 'All proposed changes applied and committed.',
              }],
              objections: [],
              files_changed: ['src/verify.js'],
              artifacts_created: [],
              verification: {
                status: 'pass',
                commands: ['echo ok'],
                evidence_summary: 'implementation verified',
                machine_evidence: [{ command: 'echo ok', exit_code: 0 }],
              },
              artifact: { type: 'patch', ref: null },
              proposed_next_role: isFinalPhase ? 'human' : 'qa',
              phase_transition_request: isFinalPhase ? null : 'qa',
              run_completion_request: isFinalPhase ? true : null,
              needs_human_reason: null,
              proposed_changes: [
                {
                  path: 'src/verify.js',
                  action: 'create',
                  content: 'export const verified = true;\n',
                },
              ],
              cost: { input_tokens: 100, output_tokens: 120, usd: 0.01 },
            };
          }

          const response = {
            id: `msg_mock_${Date.now()}`,
            type: 'message',
            role: 'assistant',
            content: [{ type: 'text', text: JSON.stringify(turnResult, null, 2) }],
            model: 'claude-sonnet-4-6',
            stop_reason: 'end_turn',
            usage: { input_tokens: 150, output_tokens: 200 },
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
  const root = mkdtempSync(join(tmpdir(), 'axc-gate-prop-e2e-'));
  tempDirs.push(root);
  scaffoldGoverned(root, 'Gate Proposal E2E', `gateprop-${Date.now()}`);

  const configPath = join(root, 'agentxchain.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));

  // Dev uses proposed authority via api_proxy
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

  // Gate requires both a file AND verification pass
  config.gates.implementation_complete = {
    requires_files: ['.planning/IMPLEMENTATION_NOTES.md'],
    requires_verification_pass: true,
  };

  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');

  // Set state to active in implementation phase with planning gate passed
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

  // Remove the scaffolded IMPLEMENTATION_NOTES.md so the gate must be satisfied
  // by proposal-applied content, not by the placeholder scaffold.
  const implNotesPath = join(root, '.planning', 'IMPLEMENTATION_NOTES.md');
  if (existsSync(implNotesPath)) {
    rmSync(implNotesPath);
  }
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

describe('proposal-aware completion gates — CLI integration', () => {
  it('AT-GATE-PROP: proposed gate artifact fails gate, proposal apply + second turn passes gate', async () => {
    const mock = await startMockServer();
    const root = makeProject(mock.url);

    // ── Step 1: First dev turn proposes gate artifact ──
    const step1 = await runCli(root, ['step', '--role', 'dev']);
    assert.equal(step1.status, 0,
      `First dev step failed.\nstdout: ${step1.stdout?.slice(-800)}\nstderr: ${step1.stderr?.slice(-800)}`);

    const state1 = JSON.parse(readFileSync(join(root, '.agentxchain', 'state.json'), 'utf8'));
    const turn1Id = state1.last_completed_turn_id;
    assert.ok(turn1Id, 'First dev turn should complete');

    // AT-GATE-PROP-001: Gate failed → phase stays implementation
    assert.equal(state1.phase, 'implementation',
      'Phase must stay implementation when gate-required file is only in proposal');

    // AT-GATE-PROP-005: Verify gate failure was recorded in history
    const history1 = readFileSync(join(root, '.agentxchain', 'history.jsonl'), 'utf8')
      .trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
    assert.equal(history1.length, 1, 'One accepted turn in history');
    // The gate result should indicate failure (if it's recorded in the turn)
    // Check that the proposal was materialized
    const proposalDir = join(root, '.agentxchain', 'proposed', turn1Id);
    assert.ok(existsSync(join(proposalDir, 'PROPOSAL.md')),
      'Proposal must be materialized');
    assert.ok(existsSync(join(proposalDir, '.planning/IMPLEMENTATION_NOTES.md')),
      'Gate-required artifact must be in proposal directory');
    // File must NOT be in workspace yet
    assert.ok(!existsSync(join(root, '.planning', 'IMPLEMENTATION_NOTES.md')),
      'Gate-required file must NOT be in workspace before proposal apply');

    // ── Step 2: Operator applies proposal ──
    const applyResult = await runCli(root, ['proposal', 'apply', turn1Id]);
    assert.equal(applyResult.status, 0,
      `Proposal apply failed.\nstdout: ${applyResult.stdout?.slice(-800)}\nstderr: ${applyResult.stderr?.slice(-800)}`);
    assert.match(applyResult.stdout, /Proposal Applied/);

    // Verify files are now in workspace
    assert.ok(existsSync(join(root, '.planning', 'IMPLEMENTATION_NOTES.md')),
      'Gate-required file must be in workspace after proposal apply');
    assert.ok(existsSync(join(root, 'src', 'feature.js')),
      'Product code must be in workspace after proposal apply');

    // AT-GATE-PROP-003: Decision ledger has proposal-apply entry
    const ledger1 = readFileSync(join(root, '.agentxchain', 'decision-ledger.jsonl'), 'utf8')
      .trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const applyEntry = ledger1.find((e) => e.category === 'proposal' && e.action === 'applied');
    assert.ok(applyEntry, 'Decision ledger must have proposal-apply entry');
    assert.equal(applyEntry.turn_id, turn1Id);
    assert.ok(applyEntry.files.includes('.planning/IMPLEMENTATION_NOTES.md'),
      'Proposal-apply ledger entry must list the gate artifact');

    // Commit applied files so baseline is clean for next turn
    execSync('git add .', { cwd: root, stdio: 'ignore' });
    execSync('git commit -m "apply proposal"', { cwd: root, stdio: 'ignore' });

    // ── Step 3: Second dev turn requests transition → gate should pass ──
    const step2 = await runCli(root, ['step', '--role', 'dev']);
    assert.equal(step2.status, 0,
      `Second dev step failed.\nstdout: ${step2.stdout?.slice(-800)}\nstderr: ${step2.stderr?.slice(-800)}`);

    const state2 = JSON.parse(readFileSync(join(root, '.agentxchain', 'state.json'), 'utf8'));

    // AT-GATE-PROP-002: Gate passed → phase advanced to qa
    assert.equal(state2.phase, 'qa',
      'Phase must advance to qa when gate-required file is in workspace after proposal apply');

    // AT-GATE-PROP-004: Second turn's observed artifact does not include proposal-applied files
    const history2 = readFileSync(join(root, '.agentxchain', 'history.jsonl'), 'utf8')
      .trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
    assert.equal(history2.length, 2, 'Two accepted turns in history');
    const secondTurn = history2[1];
    const observedFiles = secondTurn.artifact?.files_changed || [];
    assert.ok(!observedFiles.includes('.planning/IMPLEMENTATION_NOTES.md'),
      'Second turn must NOT have .planning/IMPLEMENTATION_NOTES.md in observed files');
    assert.ok(!observedFiles.includes('src/feature.js'),
      'Second turn must NOT have src/feature.js in observed files');

    // Verify the full audit trail: proposal-apply appears before second turn
    const ledger2 = readFileSync(join(root, '.agentxchain', 'decision-ledger.jsonl'), 'utf8')
      .trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const applyIdx = ledger2.findIndex((e) => e.category === 'proposal' && e.action === 'applied');
    const secondTurnDecIdx = ledger2.findIndex((e) => e.id === 'DEC-002');
    assert.ok(applyIdx >= 0, 'Ledger must contain proposal-apply');
    assert.ok(secondTurnDecIdx >= 0, 'Ledger must contain second turn decision');
    assert.ok(applyIdx < secondTurnDecIdx,
      'Proposal-apply must appear in ledger before second turn decisions');

    // Verify mock received exactly 2 requests
    assert.equal(mock.requestLog.length, 2,
      'Expected exactly 2 api_proxy requests (one per dev turn)');
  });
});
