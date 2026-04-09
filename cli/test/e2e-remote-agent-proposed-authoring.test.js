/**
 * AT-REMOTE-PROP-E2E-001 through AT-REMOTE-PROP-E2E-004
 *
 * CLI-level proof for remote_agent proposed/review flow:
 *   - `step --role dev` dispatches a proposed-authoring turn over HTTP
 *   - acceptance materializes the proposal under `.agentxchain/proposed/<turn_id>/`
 *   - `proposal apply` copies the proposal into the workspace
 *   - `step --role qa` dispatches a review_only turn over HTTP and derives a review artifact
 */

import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync,
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

- Added src/remote-feature.js through a remote_agent proposal

## Verification

- \`echo remote-ok\`
`;

function startMockRemoteAgentServer() {
  return new Promise((resolve, reject) => {
    const requestLog = [];

    const server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        try {
          const envelope = JSON.parse(body);
          requestLog.push({
            headers: { ...req.headers },
            body: envelope,
            timestamp: new Date().toISOString(),
          });

          const runtimeId = envelope.runtime_id || 'remote-runtime';
          const turnResult = envelope.role === 'qa'
            ? {
              schema_version: '1.0',
              run_id: envelope.run_id,
              turn_id: envelope.turn_id,
              role: 'qa',
              runtime_id: runtimeId,
              status: 'completed',
              summary: 'Remote QA review completed after proposal apply.',
              decisions: [{
                id: 'DEC-002',
                category: 'quality',
                statement: 'Review the applied remote proposal through the remote_agent bridge.',
                rationale: 'The review path must derive an audit artifact without claiming repo writes.',
              }],
              objections: [{
                id: 'OBJ-001',
                severity: 'low',
                against_turn_id: 'turn_prev',
                statement: 'QA wants stronger negative-path coverage for the remote bridge.',
                status: 'raised',
              }],
              files_changed: [],
              artifacts_created: [],
              verification: {
                status: 'pass',
                commands: ['echo review-ok'],
                evidence_summary: 'remote qa review passed',
                machine_evidence: [{ command: 'echo review-ok', exit_code: 0 }],
              },
              artifact: { type: 'review', ref: null },
              proposed_next_role: 'human',
              phase_transition_request: null,
              run_completion_request: null,
              needs_human_reason: null,
              cost: { input_tokens: 80, output_tokens: 120, usd: 0.01 },
            }
            : {
              schema_version: '1.0',
              run_id: envelope.run_id,
              turn_id: envelope.turn_id,
              role: 'dev',
              runtime_id: runtimeId,
              status: 'completed',
              summary: 'Remote proposed authoring completed.',
              decisions: [{
                id: 'DEC-001',
                category: 'implementation',
                statement: 'Return structured proposed changes instead of claiming direct workspace writes.',
                rationale: 'remote_agent does not support authoritative writes in v1.',
              }],
              objections: [],
              files_changed: ['src/remote-feature.js', '.planning/IMPLEMENTATION_NOTES.md'],
              artifacts_created: [],
              verification: {
                status: 'pass',
                commands: ['echo remote-ok'],
                evidence_summary: 'remote proposal staged',
                machine_evidence: [{ command: 'echo remote-ok', exit_code: 0 }],
              },
              artifact: { type: 'patch', ref: null },
              proposed_next_role: 'qa',
              phase_transition_request: null,
              run_completion_request: null,
              needs_human_reason: null,
              proposed_changes: [
                {
                  path: 'src/remote-feature.js',
                  action: 'create',
                  content: 'export const remoteFeature = "ready";\n',
                },
                {
                  path: '.planning/IMPLEMENTATION_NOTES.md',
                  action: 'create',
                  content: VALID_IMPL_NOTES,
                },
              ],
              cost: { input_tokens: 120, output_tokens: 180, usd: 0.01 },
            };

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(turnResult));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
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
  const root = mkdtempSync(join(tmpdir(), 'axc-remote-proposed-e2e-'));
  tempDirs.push(root);
  scaffoldGoverned(root, 'Remote Agent Proposed E2E', `remote-proposed-${Date.now()}`);

  const configPath = join(root, 'agentxchain.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));

  config.roles.dev.write_authority = 'proposed';
  config.roles.dev.runtime = 'remote-dev';
  config.roles.qa.write_authority = 'review_only';
  config.roles.qa.runtime = 'remote-qa';
  config.runtimes['remote-dev'] = {
    type: 'remote_agent',
    url: mockServerUrl,
    timeout_ms: 30000,
    headers: {
      authorization: 'Bearer remote-test-token',
      'x-trace-id': 'remote-proposed-e2e',
    },
  };
  config.runtimes['remote-qa'] = {
    type: 'remote_agent',
    url: mockServerUrl,
    timeout_ms: 30000,
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
  const implNotesPath = join(root, '.planning', 'IMPLEMENTATION_NOTES.md');
  if (existsSync(implNotesPath)) unlinkSync(implNotesPath);

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

afterEach(() => {
  for (const server of servers.splice(0)) {
    try {
      server.close();
    } catch {}
  }
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('remote_agent proposed authoring — CLI integration', () => {
  it('accepts proposed remote turns, materializes proposals, applies them, and derives a QA review artifact', async () => {
    const mock = await startMockRemoteAgentServer();
    const root = makeProject(mock.url);

    const devStep = await runCliAsync(root, ['step', '--role', 'dev']);
    assert.equal(devStep.status, 0,
      `Expected dev step exit 0, got ${devStep.status}.\nstdout: ${devStep.stdout?.slice(-800)}\nstderr: ${devStep.stderr?.slice(-800)}`);

    const stateAfterDev = JSON.parse(readFileSync(join(root, '.agentxchain', 'state.json'), 'utf8'));
    const proposalTurnId = stateAfterDev.last_completed_turn_id;
    assert.ok(proposalTurnId, 'dev step should complete a proposal turn');

    const proposalDir = join(root, '.agentxchain', 'proposed', proposalTurnId);
    assert.ok(existsSync(join(proposalDir, 'PROPOSAL.md')), 'accepted remote proposal must materialize PROPOSAL.md');
    assert.ok(existsSync(join(proposalDir, 'SOURCE_SNAPSHOT.json')), 'accepted remote proposal must materialize SOURCE_SNAPSHOT.json');
    assert.ok(!existsSync(join(root, 'src', 'remote-feature.js')),
      'proposal must not write product files into the workspace before proposal apply');
    assert.ok(!existsSync(join(root, '.planning', 'IMPLEMENTATION_NOTES.md')),
      'gate-required files must not appear in the workspace before proposal apply');

    const listPending = await runCliAsync(root, ['proposal', 'list']);
    assert.equal(listPending.status, 0);
    assert.match(listPending.stdout, new RegExp(proposalTurnId));
    assert.match(listPending.stdout, /pending/);

    const applyResult = await runCliAsync(root, ['proposal', 'apply', proposalTurnId]);
    assert.equal(applyResult.status, 0,
      `Expected proposal apply exit 0, got ${applyResult.status}.\nstdout: ${applyResult.stdout?.slice(-800)}\nstderr: ${applyResult.stderr?.slice(-800)}`);
    assert.match(applyResult.stdout, /Proposal Applied/);
    assert.ok(existsSync(join(root, 'src', 'remote-feature.js')), 'proposal apply must copy the staged product file into the workspace');
    assert.ok(existsSync(join(root, '.planning', 'IMPLEMENTATION_NOTES.md')),
      'proposal apply must copy the staged gate artifact into the workspace');
    assert.ok(existsSync(join(proposalDir, 'APPLIED.json')),
      'proposal apply must record APPLIED.json');

    const qaStep = await runCliAsync(root, ['step', '--role', 'qa']);
    assert.equal(qaStep.status, 0,
      `Expected qa step exit 0, got ${qaStep.status}.\nstdout: ${qaStep.stdout?.slice(-800)}\nstderr: ${qaStep.stderr?.slice(-800)}`);
    assert.doesNotMatch(qaStep.stdout + qaStep.stderr, /Observed artifact mismatch|review_only role modified product files|Acceptance conflict/i,
      'QA acceptance must not blame proposal-applied workspace files on the remote reviewer');

    assert.equal(mock.requestLog.length, 2, 'Expected one remote_agent request for dev and one for qa');
    const devPrompt = mock.requestLog[0].body.prompt || '';
    const qaPrompt = mock.requestLog[1].body.prompt || '';
    assert.match(devPrompt, /cannot write repo files directly/i,
      'proposed remote turn prompt must explain the non-authoritative runtime boundary');
    assert.match(devPrompt, /proposed_changes/i,
      'proposed remote turn prompt must require structured proposed_changes');
    assert.match(qaPrompt, /cannot write repo files directly/i,
      'review-only remote turn prompt must explain the non-authoritative runtime boundary');
    assert.doesNotMatch(qaPrompt, /proposed_changes/,
      'review-only remote turn prompt must not ask for proposed_changes');

    const historyLines = readFileSync(join(root, '.agentxchain', 'history.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    assert.equal(historyLines.length, 2, 'history should contain accepted dev and qa turns');
    assert.equal(historyLines[0].artifact.type, 'patch');
    assert.match(historyLines[0].artifact.ref || '', new RegExp(`\\.agentxchain/proposed/${proposalTurnId}`));
    assert.equal(historyLines[1].artifact.type, 'review');
    const reviewRef = historyLines[1].artifact.ref;
    assert.ok(reviewRef, 'QA review should derive an audit artifact ref');
    assert.ok(existsSync(join(root, reviewRef)), 'derived remote review artifact must exist on disk');
  });
});
