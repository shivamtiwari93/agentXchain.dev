/**
 * BUG-59 beta-tester scenario: generated full-auto policy closes routine
 * human-approval gates after evidence passes, while credentialed gates still
 * require a human approval boundary.
 */

import { afterEach, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { execFileSync, execSync, spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { getActiveTurn, normalizeGovernedStateShape } from '../../src/lib/governed-state.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(__dirname, '..', '..', 'bin', 'agentxchain.js');
const tempDirs = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

function execAgentxchain(cwd, args, options = {}) {
  return execFileSync(process.execPath, [CLI_BIN, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: options.timeout || 20_000,
    env: { ...process.env, NO_COLOR: '1', NODE_NO_WARNINGS: '1' },
  });
}

function git(cwd, command) {
  execSync(command, { cwd, stdio: 'ignore' });
}

function initGitRepo(cwd, message) {
  git(cwd, 'git init');
  git(cwd, 'git config user.email "bug59@test.local"');
  git(cwd, 'git config user.name "BUG-59 Test"');
  git(cwd, 'git add -A');
  git(cwd, `git commit -m "${message}"`);
}

function commitAll(cwd, message) {
  git(cwd, 'git add -A');
  git(cwd, `git commit -m "${message}" --allow-empty`);
}

function readState(cwd) {
  const raw = JSON.parse(readFileSync(join(cwd, '.agentxchain', 'state.json'), 'utf8'));
  const normalized = normalizeGovernedStateShape(raw).state;
  Object.defineProperty(normalized, 'current_turn', {
    configurable: true,
    enumerable: false,
    get() {
      return getActiveTurn(normalized);
    },
  });
  return normalized;
}

function readJsonl(cwd, relPath) {
  const raw = readFileSync(join(cwd, relPath), 'utf8').trim();
  if (!raw) return [];
  return raw.split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

function configureManualRuntimes(cwd, options = {}) {
  const configPath = join(cwd, 'agentxchain.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  assert.ok(config.approval_policy, 'generated governed config must include approval_policy defaults');
  assert.equal(config.gates?.planning_signoff?.credentialed, false);
  assert.equal(config.gates?.qa_ship_verdict?.credentialed, false);
  assert.equal(config.gates?.qa_ship_verdict?.requires_verification_pass, true);
  config.roles.dev.runtime = 'manual-dev';
  config.roles.qa.runtime = 'manual-qa';
  config.runtimes['manual-dev'] = { type: 'manual' };
  config.runtimes['manual-qa'] = { type: 'manual' };
  if (options.credentialedQaShipGate) {
    config.gates.qa_ship_verdict.credentialed = true;
  }
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
  return config;
}

async function waitFor(check, timeoutMs = 10_000, intervalMs = 100) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error('Timed out waiting for condition');
}

function spawnStep(cwd) {
  const child = spawn(process.execPath, [CLI_BIN, 'step', '--poll', '1'], {
    cwd,
    env: { ...process.env, NO_COLOR: '1', NODE_NO_WARNINGS: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

  return {
    child,
    async waitForExit() {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          child.kill('SIGKILL');
          reject(new Error(`step timed out\nstdout:\n${stdout}\nstderr:\n${stderr}`));
        }, 15_000);
        child.on('error', reject);
        child.on('exit', (code) => {
          clearTimeout(timer);
          resolve({ code, stdout, stderr, combined: `${stdout}${stderr}` });
        });
      });
    },
  };
}

function stageTurnResult(cwd, turn, state, overrides = {}) {
  const isDevTurn = turn.assigned_role === 'dev';
  const defaultFilesChanged = isDevTurn ? ['src/bug59-implementation-proof.js'] : [];
  if (isDevTurn) {
    const absPath = join(cwd, defaultFilesChanged[0]);
    mkdirSync(dirname(absPath), { recursive: true });
    writeFileSync(absPath, 'export const bug59ImplementationProof = true;\n');
  }
  const result = {
    schema_version: '1.0',
    run_id: state.run_id,
    turn_id: turn.turn_id,
    role: turn.assigned_role,
    runtime_id: turn.runtime_id,
    status: 'completed',
    summary: `Completed ${turn.assigned_role} work.`,
    decisions: [{
      id: 'DEC-001',
      category: turn.assigned_role === 'qa' ? 'quality' : 'implementation',
      statement: `Complete the ${turn.assigned_role} step for BUG-59 full-auto proof.`,
      rationale: 'Command-chain regression for approval_policy gate closure.',
    }],
    objections: [{
      id: 'OBJ-001',
      severity: 'low',
      statement: 'Keep BUG-59 auto-approval scoped to routine non-credentialed gates.',
      status: 'raised',
    }],
    files_changed: defaultFilesChanged,
    artifacts_created: [],
    verification: {
      status: 'pass',
      commands: [],
      evidence_summary: 'Fixture verification passed.',
      machine_evidence: [],
    },
    artifact: { type: turn.assigned_role === 'dev' ? 'workspace' : 'review', ref: null },
    proposed_next_role: 'human',
    phase_transition_request: null,
    run_completion_request: false,
    needs_human_reason: null,
    cost: { input_tokens: 0, output_tokens: 0, usd: 0 },
    ...overrides,
  };
  if (isDevTurn && !result.files_changed.some((p) => !p.startsWith('.planning/'))) {
    result.files_changed = [...result.files_changed, defaultFilesChanged[0]];
  }
  if (isDevTurn) result.artifact = { type: 'workspace', ref: null };

  const stagingDir = join(cwd, '.agentxchain', 'staging', turn.turn_id);
  mkdirSync(stagingDir, { recursive: true });
  writeFileSync(join(stagingDir, 'turn-result.json'), JSON.stringify(result, null, 2) + '\n');
}

function writePlanningArtifacts(cwd) {
  writeFileSync(join(cwd, '.planning', 'PM_SIGNOFF.md'), '# PM Planning Sign-Off\n\nApproved: YES\n');
  writeFileSync(join(cwd, '.planning', 'ROADMAP.md'), '# Roadmap\n\n- Planning complete\n- Implementation pending\n- QA pending\n');
  writeFileSync(join(cwd, '.planning', 'SYSTEM_SPEC.md'), [
    '# System Spec',
    '',
    '## Purpose',
    '',
    'Prove full-auto gate closure for routine governed delivery.',
    '',
    '## Interface',
    '',
    '- Generated governed config',
    '- Approval policy',
    '',
    '## Acceptance Tests',
    '',
    '- [ ] Routine QA completion closes without approve-completion',
    '',
  ].join('\n'));
}

function writeImplementationArtifacts(cwd) {
  writeFileSync(
    join(cwd, '.planning', 'IMPLEMENTATION_NOTES.md'),
    '# Implementation Notes\n\n## Changes\n\nConfigured the generated project for BUG-59 full-auto proof.\n\n## Verification\n\n- `node --test bug-59`\n',
  );
  const productPath = join(cwd, 'src', 'bug59-implementation-proof.js');
  mkdirSync(dirname(productPath), { recursive: true });
  writeFileSync(productPath, 'export const bug59ImplementationProof = true;\n');
}

function writeQaArtifacts(cwd) {
  const rows = Array.from({ length: 38 }, (_, index) => {
    const id = index + 1;
    return `| ${id} | Criterion ${id} | Evidence ${id} completed | smoke exit 0 | 2026-04-21 | PASS |`;
  });
  writeFileSync(join(cwd, '.planning', 'acceptance-matrix.md'), [
    '# Acceptance Matrix',
    '',
    '| Req # | Requirement | Acceptance criteria | Test status | Last tested | Status |',
    '|-------|-------------|---------------------|-------------|-------------|--------|',
    ...rows,
    '',
  ].join('\n'));
  writeFileSync(join(cwd, '.planning', 'ship-verdict.md'), '# Ship Verdict\n\n## Verdict: YES\n\n38/38 acceptance criteria pass and smoke tests exit 0.\n');
  writeFileSync(
    join(cwd, '.planning', 'RELEASE_NOTES.md'),
    '# Release Notes\n\n## User Impact\n\nRoutine full-auto QA ship approval can close without an operator when evidence passes.\n\n## Verification Summary\n\n38/38 acceptance criteria pass. Smoke tests exit 0.\n',
  );
}

function createGeneratedProject(options = {}) {
  const root = mkdtempSync(join(tmpdir(), 'axc-bug59-full-auto-'));
  tempDirs.push(root);
  mkdirSync(root, { recursive: true });
  execAgentxchain(root, ['init', '--governed', '--template', 'generic', '--dir', '.', '-y']);
  configureManualRuntimes(root, options);
  initGitRepo(root, 'initial generated governed config');
  return root;
}

async function driveGeneratedRunToQa(cwd) {
  const planningStep = spawnStep(cwd);
  const planningState = await waitFor(() => {
    const state = readState(cwd);
    return state.current_turn?.assigned_role === 'pm' ? state : null;
  });
  writePlanningArtifacts(cwd);
  stageTurnResult(cwd, planningState.current_turn, planningState, {
    role: 'pm',
    runtime_id: 'manual-pm',
    summary: 'Planning artifacts pass and request implementation.',
    phase_transition_request: 'implementation',
  });
  const planningExit = await planningStep.waitForExit();
  assert.equal(planningExit.code, 0, planningExit.combined);
  assert.match(planningExit.combined, /Turn Accepted/);

  let state = readState(cwd);
  assert.equal(state.phase, 'implementation', 'planning_signoff should auto-approve by generated policy');
  assert.equal(state.status, 'active');
  commitAll(cwd, 'complete planning');

  const implementationStep = spawnStep(cwd);
  const implementationState = await waitFor(() => {
    const current = readState(cwd);
    return current.current_turn?.assigned_role === 'dev' ? current : null;
  });
  writeImplementationArtifacts(cwd);
  stageTurnResult(cwd, implementationState.current_turn, implementationState, {
    role: 'dev',
    runtime_id: 'manual-dev',
    summary: 'Implementation evidence passes and requests QA.',
    files_changed: ['.planning/IMPLEMENTATION_NOTES.md'],
    proposed_next_role: 'qa',
    phase_transition_request: 'qa',
  });
  const implementationExit = await implementationStep.waitForExit();
  assert.equal(implementationExit.code, 0, implementationExit.combined);
  assert.match(implementationExit.combined, /Turn Accepted/);

  state = readState(cwd);
  assert.equal(state.phase, 'qa', 'implementation verification-pass gate should advance to QA');
  assert.equal(state.status, 'active');
  commitAll(cwd, 'complete implementation');
}

async function completeQa(cwd) {
  const qaStep = spawnStep(cwd);
  const qaState = await waitFor(() => {
    const current = readState(cwd);
    return current.current_turn?.assigned_role === 'qa' ? current : null;
  });
  writeQaArtifacts(cwd);
  stageTurnResult(cwd, qaState.current_turn, qaState, {
    role: 'qa',
    runtime_id: 'manual-qa',
    summary: 'QA passed: 38/38 acceptance criteria pass and smoke tests exit 0.',
    run_completion_request: true,
    verification: {
      status: 'pass',
      commands: ['npm test -- --smoke'],
      evidence_summary: '38/38 acceptance criteria pass; smoke tests exit 0.',
      machine_evidence: [{ command: 'npm test -- --smoke', exit_code: 0, stdout_excerpt: '38/38 PASS' }],
    },
  });
  const qaExit = await qaStep.waitForExit();
  assert.equal(qaExit.code, 0, qaExit.combined);
  assert.match(qaExit.combined, /Turn Accepted/);
  return qaExit;
}

describe('BUG-59 full-auto gate closure command chain', () => {
  it('positive: generated approval_policy completes routine QA gate without approve-completion', async () => {
    const root = createGeneratedProject();
    await driveGeneratedRunToQa(root);
    await completeQa(root);

    const state = readState(root);
    assert.equal(state.status, 'completed', `routine QA ship verdict should auto-complete the run: ${JSON.stringify({
      status: state.status,
      phase: state.phase,
      pending_run_completion: state.pending_run_completion,
      last_gate_failure: state.last_gate_failure,
      blocked_on: state.blocked_on,
      active_turns: state.active_turns,
      queued_run_completion: state.queued_run_completion,
    })}`);
    assert.equal(state.pending_run_completion ?? null, null);
    assert.equal(state.blocked_on ?? null, null);

    const ledger = readJsonl(root, '.agentxchain/decision-ledger.jsonl').filter((entry) => entry.type === 'approval_policy');
    assert.equal(ledger.length, 2, 'planning transition and run completion should both record approval_policy decisions');
    assert.equal(ledger[0].gate_type, 'phase_transition');
    assert.equal(ledger[0].gate_id, 'planning_signoff');
    assert.equal(ledger[1].gate_type, 'run_completion');
    assert.equal(ledger[1].gate_id, 'qa_ship_verdict');
    assert.equal(ledger[1].matched_rule?.when?.credentialed_gate, false);

    const status = execAgentxchain(root, ['status']);
    assert.match(status, /completed/i);
    assert.doesNotMatch(status, /approve-completion|human_approval/i);
  });

  it('negative: credentialed QA ship gate blocks even under generated auto-approval policy', async () => {
    const root = createGeneratedProject({ credentialedQaShipGate: true });
    await driveGeneratedRunToQa(root);
    await completeQa(root);

    const state = readState(root);
    assert.equal(state.status, 'paused', `credentialed run-completion gate must remain human-gated: ${JSON.stringify({
      status: state.status,
      phase: state.phase,
      pending_run_completion: state.pending_run_completion,
      last_gate_failure: state.last_gate_failure,
      blocked_on: state.blocked_on,
      active_turns: state.active_turns,
      queued_run_completion: state.queued_run_completion,
    })}`);
    assert.equal(state.blocked_on, 'human_approval:qa_ship_verdict');
    assert.equal(state.pending_run_completion?.gate, 'qa_ship_verdict');

    const ledger = readJsonl(root, '.agentxchain/decision-ledger.jsonl')
      .filter((entry) => entry.type === 'approval_policy' && entry.gate_type === 'run_completion');
    assert.equal(ledger.length, 0, 'credentialed gate must not write an auto_approve run-completion ledger entry');

    const dryRun = execAgentxchain(root, ['approve-completion', '--dry-run']);
    assert.match(dryRun, /qa_ship_verdict|run completion/i);
  });
});
