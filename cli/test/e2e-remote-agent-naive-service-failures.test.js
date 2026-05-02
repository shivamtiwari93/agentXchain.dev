/**
 * AT-REMOTE-NAIVE-E2E-001 through AT-REMOTE-NAIVE-E2E-004
 *
 * CLI-level proof that the remote_agent adapter fails closed when a naive
 * remote service returns payloads that look plausible but violate the
 * governed turn-result contract:
 *   - decisions[].id must match DEC-NNN
 *   - review_only roles must raise at least one objection
 */

import { afterEach, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
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

function countEntries(dir) {
  return existsSync(dir) ? readdirSync(dir).length : 0;
}

function startMockRemoteAgentServer(options = {}) {
  const {
    devDecisionId = 'DEC-001',
    qaIncludesObjection = true,
  } = options;

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
              summary: 'Naive remote QA review completed.',
              decisions: [{
                id: 'DEC-002',
                category: 'quality',
                statement: 'Review the applied remote proposal through the remote_agent bridge.',
                rationale: 'The review path must derive an audit artifact without claiming repo writes.',
              }],
              objections: qaIncludesObjection
                ? [{
                  id: 'OBJ-001',
                  severity: 'low',
                  against_turn_id: 'turn_prev',
                  statement: 'QA wants stronger negative-path coverage for the remote bridge.',
                  status: 'raised',
                }]
                : [],
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
              summary: 'Naive remote proposed authoring completed.',
              decisions: [{
                id: devDecisionId,
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
  const root = mkdtempSync(join(tmpdir(), 'axc-remote-naive-e2e-'));
  tempDirs.push(root);
  scaffoldGoverned(root, 'Remote Agent Naive E2E', `remote-naive-${Date.now()}`);

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

async function runValidDevTurnAndApply(root) {
  const devStep = await runCliAsync(root, ['step', '--role', 'dev']);
  assert.equal(devStep.status, 0,
    `Expected dev step exit 0, got ${devStep.status}.\nstdout: ${devStep.stdout?.slice(-800)}\nstderr: ${devStep.stderr?.slice(-800)}`);

  const stateAfterDev = JSON.parse(readFileSync(join(root, '.agentxchain', 'state.json'), 'utf8'));
  const proposalTurnId = stateAfterDev.last_completed_turn_id;
  assert.ok(proposalTurnId, 'dev step should complete a proposal turn');

  const applyResult = await runCliAsync(root, ['proposal', 'apply', proposalTurnId]);
  assert.equal(applyResult.status, 0,
    `Expected proposal apply exit 0, got ${applyResult.status}.\nstdout: ${applyResult.stdout?.slice(-800)}\nstderr: ${applyResult.stderr?.slice(-800)}`);

  return proposalTurnId;
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

describe('remote_agent naive service failures', () => {
  it('normalizes proposed remote turns that use non-DEC-NNN decision IDs (BUG-90)', async () => {
    const mock = await startMockRemoteAgentServer({ devDecisionId: 'DEC-BRIDGE-20260409' });
    const root = makeProject(mock.url);

    // BUG-90: non-DEC-NNN decision IDs are now auto-normalized to DEC-001, DEC-002, etc.
    const devStep = await runCliAsync(root, ['step', '--role', 'dev']);
    assert.equal(devStep.status, 0, `dev step must succeed after normalization, got ${devStep.status}.\nstdout: ${devStep.stdout?.slice(-800)}\nstderr: ${devStep.stderr?.slice(-800)}`);
    assert.equal(mock.requestLog.length, 1, 'only one dev dispatch should have been sent');
  });

  it('rejects review_only remote turns that omit objections', async () => {
    const mock = await startMockRemoteAgentServer({ qaIncludesObjection: false });
    const root = makeProject(mock.url);

    const proposalTurnId = await runValidDevTurnAndApply(root);
    const qaStep = await runCliAsync(root, ['step', '--role', 'qa']);
    assert.equal(qaStep.status, 1, `invalid qa turn must exit non-zero, got ${qaStep.status}`);
    assert.match(qaStep.stdout, /Validation failed:/);
    assert.match(qaStep.stdout, /must raise at least one objection/);

    const state = JSON.parse(readFileSync(join(root, '.agentxchain', 'state.json'), 'utf8'));
    const activeTurns = Object.values(state.active_turns || {});
    assert.equal(activeTurns.length, 1, 'failing remote qa response should retain the active review turn');
    assert.equal(activeTurns[0].assigned_role, 'qa');
    assert.equal(state.last_completed_turn_id, proposalTurnId, 'qa validation failure must not overwrite the last accepted turn');
    assert.equal(countEntries(join(root, '.agentxchain', 'reviews')), 0, 'invalid remote review must not derive a review artifact');
    assert.equal(mock.requestLog.length, 2, 'dev and qa turns should both dispatch to the bridge');
  });
});
