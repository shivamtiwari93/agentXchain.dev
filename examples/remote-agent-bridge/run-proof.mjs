#!/usr/bin/env node

/**
 * Remote Agent Bridge — Live Proof Script
 *
 * Exercises the remote_agent adapter through the public agentxchain CLI:
 *   1. Starts the example bridge server on a random port
 *   2. Scaffolds a governed project with remote_agent runtime config
 *   3. Runs `agentxchain step --role dev` → bridge returns proposed changes
 *   4. Runs `agentxchain proposal apply <turn_id>` → applies proposed files
 *   5. Runs `agentxchain step --role qa` → bridge returns a review
 *   6. Verifies all artifacts exist
 *   7. Prints a summary and exits
 *
 * Usage:
 *   node run-proof.mjs
 *
 * Requires: agentxchain CLI installed or available at ../../cli/bin/agentxchain.js
 */

import { createServer } from 'node:http';
import { execSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(__dirname, '..', '..', 'cli', 'bin', 'agentxchain.js');

let cleanup = null;

function log(msg) {
  console.log(`\x1b[36m[proof]\x1b[0m ${msg}`);
}

function fail(msg) {
  console.error(`\x1b[31m[FAIL]\x1b[0m ${msg}`);
  if (cleanup) cleanup();
  process.exit(1);
}

function pass(msg) {
  console.log(`\x1b[32m[PASS]\x1b[0m ${msg}`);
}

/**
 * Run a CLI command asynchronously (does not block event loop).
 */
function cliAsync(args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI_BIN, ...args], {
      cwd,
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.stdin.end();
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`CLI timed out: agentxchain ${args.join(' ')}`));
    }, 60_000);
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

function buildProposedResult(envelope) {
  return {
    schema_version: '1.0',
    run_id: envelope.run_id,
    turn_id: envelope.turn_id,
    role: envelope.role || 'dev',
    runtime_id: envelope.runtime_id || 'remote-bridge',
    status: 'completed',
    summary: 'Remote bridge proposed changes for proof.',
    decisions: [{
      id: 'DEC-001',
      category: 'implementation',
      statement: 'Proposed file changes through the remote_agent bridge.',
      rationale: 'remote_agent v1 uses proposed write authority.',
    }],
    objections: [],
    files_changed: ['src/proof-feature.js'],
    artifacts_created: [],
    verification: {
      status: 'pass',
      commands: ['echo proof-ok'],
      evidence_summary: 'proof proposal staged',
      machine_evidence: [{ command: 'echo proof-ok', exit_code: 0 }],
    },
    artifact: { type: 'patch', ref: null },
    proposed_next_role: 'qa',
    phase_transition_request: null,
    run_completion_request: null,
    needs_human_reason: null,
    proposed_changes: [{
      path: 'src/proof-feature.js',
      action: 'create',
      content: '// Created by remote agent bridge proof\nexport const proofFeature = "verified";\n',
    }],
    cost: { input_tokens: 100, output_tokens: 150, usd: 0.005 },
  };
}

function buildReviewResult(envelope) {
  return {
    schema_version: '1.0',
    run_id: envelope.run_id,
    turn_id: envelope.turn_id,
    role: envelope.role || 'qa',
    runtime_id: envelope.runtime_id || 'remote-bridge',
    status: 'completed',
    summary: 'Remote bridge QA review for proof.',
    decisions: [{
      id: 'DEC-002',
      category: 'quality',
      statement: 'Reviewed proposed changes.',
      rationale: 'review_only turns derive audit artifacts.',
    }],
    objections: [{
      id: 'OBJ-001',
      severity: 'low',
      against_turn_id: 'turn_prev',
      statement: 'Remote bridge proof should add negative-path test coverage.',
      status: 'raised',
    }],
    files_changed: [],
    artifacts_created: [],
    verification: {
      status: 'pass',
      commands: ['echo review-ok'],
      evidence_summary: 'proof review passed',
      machine_evidence: [{ command: 'echo review-ok', exit_code: 0 }],
    },
    artifact: { type: 'review', ref: null },
    proposed_next_role: 'human',
    phase_transition_request: null,
    run_completion_request: null,
    needs_human_reason: null,
    cost: { input_tokens: 80, output_tokens: 120, usd: 0.003 },
  };
}

function startBridge() {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        try {
          const envelope = JSON.parse(body);
          const result = envelope.role === 'qa'
            ? buildReviewResult(envelope)
            : buildProposedResult(envelope);
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify(result));
        } catch (err) {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
    });

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve({
        url: `http://127.0.0.1:${addr.port}`,
        server,
        close: () => server.close(),
      });
    });

    server.on('error', reject);
  });
}

async function main() {
  log('Starting remote agent bridge proof...');

  // 1. Start bridge server
  const bridge = await startBridge();
  log(`Bridge server listening on ${bridge.url}`);

  // 2. Scaffold governed project (sync is OK here — no bridge interaction)
  const root = mkdtempSync(join(tmpdir(), 'axc-bridge-proof-'));
  cleanup = () => {
    bridge.close();
    rmSync(root, { recursive: true, force: true });
  };
  log(`Project dir: ${root}`);

  const initResult = await cliAsync(['init', '--governed', '-y', '--dir', '.'], root);
  if (initResult.status !== 0) fail(`init failed:\n${initResult.stdout}\n${initResult.stderr}`);
  pass('Project scaffolded');

  // 3. Configure remote_agent runtimes
  const configPath = join(root, 'agentxchain.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  config.roles.dev.write_authority = 'proposed';
  config.roles.dev.runtime = 'remote-dev';
  config.roles.qa.write_authority = 'review_only';
  config.roles.qa.runtime = 'remote-qa';
  config.runtimes['remote-dev'] = {
    type: 'remote_agent',
    url: bridge.url,
    timeout_ms: 30000,
  };
  config.runtimes['remote-qa'] = {
    type: 'remote_agent',
    url: bridge.url,
    timeout_ms: 30000,
  };
  config.workflow_kit = {};
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
  pass('Config updated with remote_agent runtimes');

  // Set state to active/implementation
  const statePath = join(root, '.agentxchain', 'state.json');
  const state = JSON.parse(readFileSync(statePath, 'utf8'));
  state.run_id = `run_proof_${Date.now()}`;
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

  // Initialize git (required for step)
  execSync('git init', { cwd: root, stdio: 'ignore' });
  execSync('git config user.email "proof@example.com"', { cwd: root, stdio: 'ignore' });
  execSync('git config user.name "Proof Runner"', { cwd: root, stdio: 'ignore' });
  execSync('git add .', { cwd: root, stdio: 'ignore' });
  execSync('git commit -m "baseline"', { cwd: root, stdio: 'ignore' });
  pass('Git initialized');

  // 4. Run dev step (proposed authoring) — async so bridge can respond
  log('Running agentxchain step --role dev...');
  const devStep = await cliAsync(['step', '--role', 'dev'], root);
  if (devStep.status !== 0) fail(`dev step failed (exit ${devStep.status}):\n${devStep.stdout.slice(-600)}\n${devStep.stderr.slice(-600)}`);
  pass('Dev step completed');

  // 5. Verify proposal materialized
  const stateAfterDev = JSON.parse(readFileSync(statePath, 'utf8'));
  const proposalTurnId = stateAfterDev.last_completed_turn_id;
  if (!proposalTurnId) fail('No completed turn after dev step');

  const proposalDir = join(root, '.agentxchain', 'proposed', proposalTurnId);
  if (!existsSync(join(proposalDir, 'PROPOSAL.md'))) fail('PROPOSAL.md not materialized');
  if (!existsSync(join(proposalDir, 'SOURCE_SNAPSHOT.json'))) fail('SOURCE_SNAPSHOT.json not materialized');
  if (existsSync(join(root, 'src', 'proof-feature.js'))) fail('Proposed file appeared in workspace before apply');
  pass(`Proposal materialized at .agentxchain/proposed/${proposalTurnId}/`);

  // 6. Apply proposal
  log(`Applying proposal ${proposalTurnId}...`);
  const applyResult = await cliAsync(['proposal', 'apply', proposalTurnId], root);
  if (applyResult.status !== 0) fail(`proposal apply failed (exit ${applyResult.status}):\n${applyResult.stdout.slice(-600)}\n${applyResult.stderr.slice(-600)}`);
  if (!existsSync(join(root, 'src', 'proof-feature.js'))) fail('proof-feature.js not in workspace after apply');
  if (!existsSync(join(proposalDir, 'APPLIED.json'))) fail('APPLIED.json not recorded');
  pass('Proposal applied — src/proof-feature.js in workspace');

  // 7. Run QA step (review)
  log('Running agentxchain step --role qa...');
  const qaStep = await cliAsync(['step', '--role', 'qa'], root);
  if (qaStep.status !== 0) fail(`qa step failed (exit ${qaStep.status}):\n${qaStep.stdout.slice(-600)}\n${qaStep.stderr.slice(-600)}`);
  pass('QA step completed');

  // 8. Verify review artifact
  const stateAfterQa = JSON.parse(readFileSync(statePath, 'utf8'));
  const historyPath = join(root, '.agentxchain', 'history.jsonl');
  const historyLines = readFileSync(historyPath, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
  if (historyLines.length < 2) fail(`Expected 2 history entries, got ${historyLines.length}`);

  const devEntry = historyLines[0];
  const qaEntry = historyLines[1];
  if (devEntry.artifact?.type !== 'patch') fail(`Dev artifact type: ${devEntry.artifact?.type}, expected patch`);
  if (qaEntry.artifact?.type !== 'review') fail(`QA artifact type: ${qaEntry.artifact?.type}, expected review`);

  const reviewRef = qaEntry.artifact?.ref;
  if (reviewRef && !existsSync(join(root, reviewRef))) fail(`Review artifact not on disk: ${reviewRef}`);
  pass('QA review artifact derived');

  // 9. Summary
  console.log('\n' + '='.repeat(60));
  console.log('  REMOTE AGENT BRIDGE PROOF — ALL CHECKS PASSED');
  console.log('='.repeat(60));
  console.log(`  Bridge URL:     ${bridge.url}`);
  console.log(`  Project:        ${root}`);
  console.log(`  Run ID:         ${stateAfterQa.run_id}`);
  console.log(`  Dev turn:       ${proposalTurnId} (proposed → applied)`);
  console.log(`  QA turn:        ${stateAfterQa.last_completed_turn_id} (review → artifact)`);
  console.log(`  History entries: ${historyLines.length}`);
  console.log('='.repeat(60) + '\n');

  cleanup();
  log('Proof complete. Temp files cleaned up.');
}

main().catch((err) => {
  console.error(err);
  if (cleanup) cleanup();
  process.exit(1);
});
