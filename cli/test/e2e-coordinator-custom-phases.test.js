/**
 * E2E coordinator custom-phase proof
 *
 * Proves that coordinator-orchestrated multi-repo execution works correctly
 * with custom phases (beyond the default planning/implementation/qa).
 *
 * This closes the gap between single-repo custom-phase proof
 * (e2e-custom-phases-runtime.test.js) and multi-repo coordinator proof.
 *
 * See: .planning/COORDINATOR_CUSTOM_PHASES_E2E_SPEC.md
 */

import assert from 'node:assert/strict';
import { describe, it, afterEach } from 'node:test';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { scaffoldGoverned } from '../src/commands/init.js';
import {
  loadCoordinatorState,
  readCoordinatorHistory,
  readBarriers,
} from '../src/lib/coordinator-state.js';
import { loadCoordinatorConfig } from '../src/lib/coordinator-config.js';
import { evaluatePhaseGate } from '../src/lib/coordinator-gates.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(__dirname, '..', 'bin', 'agentxchain.js');

const tempDirs = [];

/**
 * Create a 4-phase mock agent that handles:
 *   planning → request transition to design
 *   design → request transition to implementation
 *   implementation → request transition to qa
 *   qa → request run completion
 */
function createFourPhaseAgent() {
  const agentDir = mkdtempSync(join(tmpdir(), 'axc-coord-cp-mock-'));
  tempDirs.push(agentDir);
  const agentPath = join(agentDir, 'mock-agent-four-phase.mjs');
  writeFileSync(agentPath, `
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';

const root = process.cwd();
const indexPath = join(root, '.agentxchain/dispatch/index.json');
if (!existsSync(indexPath)) { console.error('no dispatch index'); process.exit(1); }

const index = JSON.parse(readFileSync(indexPath, 'utf8'));
const entry = Object.values(index.active_turns || {})[0];
if (!entry) { console.error('no active turns'); process.exit(1); }

const { turn_id: turnId, role, runtime_id: runtimeId, staging_result_path } = entry;
const { phase, run_id: runId } = index;

function ensureFile(relPath, content) {
  const absPath = join(root, relPath);
  mkdirSync(dirname(absPath), { recursive: true });
  writeFileSync(absPath, content);
}

// Produce phase-specific gate artifacts
if (phase === 'planning') {
  ensureFile('.planning/PM_SIGNOFF.md', '# PM Signoff\\nApproved: YES\\n');
  ensureFile('.planning/ROADMAP.md', '# Roadmap\\nMock roadmap.\\n');
  ensureFile('.planning/SYSTEM_SPEC.md', '# System Spec\\n\\n## Purpose\\n\\nMock governed project for custom-phase coordinator E2E.\\n\\n## Interface\\n\\nagentxchain run completes a four-phase lifecycle.\\n\\n## Acceptance Tests\\n\\n- [ ] Run completes with exit 0.\\n');
}
if (phase === 'design') {
  ensureFile('.planning/DESIGN_REVIEW.md', '# Design Review\\nArchitecture reviewed.\\n');
}
if (phase === 'implementation') {
  ensureFile('src/output.js', 'export const ok = true;\\n');
}
if (phase === 'qa') {
  ensureFile('.planning/acceptance-matrix.md', '# Acceptance Matrix\\nAll criteria met.\\n');
}

// 4-phase transition model
let phaseTransitionRequest = null;
let runCompletionRequest = null;
if (phase === 'planning') {
  phaseTransitionRequest = 'design';
} else if (phase === 'design') {
  phaseTransitionRequest = 'implementation';
} else if (phase === 'implementation') {
  phaseTransitionRequest = 'qa';
} else if (phase === 'qa') {
  runCompletionRequest = true;
}

const turnResult = {
  schema_version: '1.0', run_id: runId, turn_id: turnId, role, runtime_id: runtimeId,
  status: 'completed',
  summary: 'Mock ' + role + ' completed ' + phase + ' (four-phase).',
  decisions: [{ id: 'DEC-001', category: 'implementation', statement: role + ' done in ' + phase + '.', rationale: 'E2E mock.' }],
  objections: [],
  files_changed: [],
  artifacts_created: [],
  verification: { status: 'pass', commands: ['echo ok'], evidence_summary: 'pass', machine_evidence: [{ command: 'echo ok', exit_code: 0 }] },
  artifact: { type: 'workspace', ref: null },
  proposed_next_role: 'human',
  phase_transition_request: phaseTransitionRequest,
  run_completion_request: runCompletionRequest,
  needs_human_reason: null,
  cost: { input_tokens: 0, output_tokens: 0, usd: 0 },
};

const absStaging = join(root, staging_result_path);
mkdirSync(dirname(absStaging), { recursive: true });
writeFileSync(absStaging, JSON.stringify(turnResult, null, 2));
console.log('mock-agent-four-phase: ' + role + ' completed (' + phase + ')');
`);
  return agentPath;
}

function writeJson(filePath, value) {
  writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n');
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

/**
 * Scaffold a governed child repo with 4-phase routing and mock-agent runtimes.
 */
function makeChildRepo(name, agentPath) {
  const root = mkdtempSync(join(tmpdir(), `axc-coord-cp-${name}-`));
  tempDirs.push(root);
  scaffoldGoverned(root, `Coord CP ${name}`, `coord-cp-${name}-${Date.now()}`);

  const configPath = join(root, 'agentxchain.json');
  const config = readJson(configPath);

  // Add architect role for design phase
  config.roles.architect = {
    title: 'Architect',
    mandate: 'Review architecture and define system design.',
    write_authority: 'authoritative',
    runtime: 'manual-architect',
  };
  config.runtimes['manual-architect'] = {
    type: 'local_cli',
    command: process.execPath,
    args: [agentPath],
    prompt_transport: 'dispatch_bundle_only',
  };

  // Patch all existing runtimes to use the mock-agent
  const mockRuntime = {
    type: 'local_cli',
    command: process.execPath,
    args: [agentPath],
    prompt_transport: 'dispatch_bundle_only',
  };
  for (const key of Object.keys(config.runtimes || {})) {
    config.runtimes[key] = { ...mockRuntime };
  }
  for (const role of Object.values(config.roles || {})) {
    role.write_authority = 'authoritative';
  }

  // 4-phase routing: planning → design → implementation → qa
  config.routing = {
    planning: {
      entry_role: 'pm',
      allowed_next_roles: ['pm', 'architect', 'dev', 'human'],
      exit_gate: 'planning_signoff',
    },
    design: {
      entry_role: 'architect',
      allowed_next_roles: ['architect', 'dev', 'human'],
      exit_gate: 'design_review',
    },
    implementation: {
      entry_role: 'dev',
      allowed_next_roles: ['dev', 'human'],
      exit_gate: 'implementation_gate',
    },
    qa: {
      entry_role: 'dev',
      allowed_next_roles: ['dev', 'human'],
    },
  };

  // Add design_review gate
  config.gates = config.gates || {};
  config.gates.design_review = {
    requires_files: ['.planning/DESIGN_REVIEW.md'],
  };

  // Ensure implementation gate exists
  if (!config.gates.implementation_gate) {
    config.gates.implementation_gate = {
      requires_files: ['src/output.js'],
    };
  }

  config.workflow_kit = {
    phases: {
      planning: {
        artifacts: [
          { path: '.planning/PM_SIGNOFF.md', semantics: 'pm_signoff', required: true },
          { path: '.planning/ROADMAP.md', semantics: null, required: true },
        ],
      },
      design: {
        artifacts: [
          { path: '.planning/DESIGN_REVIEW.md', semantics: null, required: true },
        ],
      },
      implementation: {
        artifacts: [
          { path: 'src/output.js', semantics: null, required: true },
        ],
      },
      qa: {
        artifacts: [],
      },
    },
  };

  config.prompts = config.prompts || {};
  config.prompts.architect = '.agentxchain/prompts/architect.md';

  writeJson(configPath, config);
  return root;
}

/**
 * Build coordinator config with 4 phases: planning → design → implementation → qa
 */
function buildCoordinatorConfig(apiPath, webPath) {
  return {
    schema_version: '0.1',
    project: { id: 'coord-custom-phase-e2e', name: 'Coordinator Custom Phase E2E' },
    repos: {
      api: { path: apiPath, default_branch: 'main', required: true },
      web: { path: webPath, default_branch: 'main', required: true },
    },
    workstreams: {
      planning_sync: {
        phase: 'planning',
        repos: ['api', 'web'],
        entry_repo: 'api',
        depends_on: [],
        completion_barrier: 'all_repos_accepted',
      },
      design_sync: {
        phase: 'design',
        repos: ['api', 'web'],
        entry_repo: 'api',
        depends_on: ['planning_sync'],
        completion_barrier: 'all_repos_accepted',
      },
      implementation_sync: {
        phase: 'implementation',
        repos: ['api', 'web'],
        entry_repo: 'api',
        depends_on: ['design_sync'],
        completion_barrier: 'all_repos_accepted',
      },
      qa_sync: {
        phase: 'qa',
        repos: ['api', 'web'],
        entry_repo: 'api',
        depends_on: ['implementation_sync'],
        completion_barrier: 'all_repos_accepted',
      },
    },
    routing: {
      planning: { entry_workstream: 'planning_sync' },
      design: { entry_workstream: 'design_sync' },
      implementation: { entry_workstream: 'implementation_sync' },
      qa: { entry_workstream: 'qa_sync' },
    },
    gates: {
      initiative_ship: {
        requires_human_approval: true,
        requires_repos: ['api', 'web'],
      },
    },
  };
}

function runCli(cwd, args, opts = {}) {
  const result = spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: opts.timeout || 30000,
    env: { ...process.env, NODE_NO_WARNINGS: '1' },
  });
  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    combined: `${result.stdout || ''}${result.stderr || ''}`,
  };
}

/**
 * Execute a full child-repo turn cycle via real CLI subprocess.
 * Approves any pending repo-local gate afterwards.
 */
function executeChildRepoTurn(repoRoot, label) {
  const stepResult = runCli(repoRoot, ['step', '--resume'], { timeout: 30000 });
  assert.equal(
    stepResult.exitCode,
    0,
    `step --resume failed in ${label}:\n${stepResult.combined}`,
  );

  const approveResult = runCli(repoRoot, ['approve-transition']);
  if (approveResult.exitCode !== 0 && !approveResult.combined.includes('No pending')) {
    assert.equal(
      approveResult.exitCode,
      0,
      `approve-transition unexpected failure in ${label}:\n${approveResult.combined}`,
    );
  }
}

/**
 * Execute one coordinator phase: dispatch to each repo, execute child turns.
 * Returns the last dispatch result for assertions.
 */
function executeCoordinatorPhase(workspace, repos, phaseLabel) {
  const dispatches = [];
  for (const [repoId, repoPath] of repos) {
    const dispatch = runCli(workspace, ['multi', 'step', '--json']);
    assert.equal(dispatch.exitCode, 0, `${phaseLabel}/${repoId} dispatch failed:\n${dispatch.combined}`);
    const parsed = JSON.parse(dispatch.stdout);
    assert.equal(parsed.repo_id, repoId, `${phaseLabel} dispatch should target ${repoId}`);
    dispatches.push(parsed);
    executeChildRepoTurn(repoPath, `${phaseLabel}/${repoId}`);
  }
  return dispatches;
}

/**
 * Request and approve a coordinator phase transition.
 */
function transitionCoordinatorPhase(workspace, fromPhase, toPhase) {
  const gateReq = runCli(workspace, ['multi', 'step', '--json']);
  assert.equal(gateReq.exitCode, 0, `phase gate ${fromPhase}→${toPhase} request failed:\n${gateReq.combined}`);
  const gate = JSON.parse(gateReq.stdout);
  assert.equal(gate.action, 'phase_transition_requested', `expected phase_transition_requested for ${fromPhase}→${toPhase}`);
  assert.equal(gate.from, fromPhase);
  assert.equal(gate.to, toPhase);

  const approve = runCli(workspace, ['multi', 'approve-gate']);
  assert.equal(approve.exitCode, 0, `approve gate ${fromPhase}→${toPhase} failed:\n${approve.combined}`);
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('E2E coordinator with custom phases', () => {
  it('AT-COORD-CP-001/003: full 4-phase lifecycle planning→design→implementation→qa', () => {
    // ── Setup ────────────────────────────────────────────────────────────────
    const agentPath = createFourPhaseAgent();
    const apiRepo = makeChildRepo('api', agentPath);
    const webRepo = makeChildRepo('web', agentPath);
    const workspace = mkdtempSync(join(tmpdir(), 'axc-coord-cp-ws-'));
    tempDirs.push(workspace);

    writeJson(
      join(workspace, 'agentxchain-multi.json'),
      buildCoordinatorConfig(apiRepo, webRepo),
    );

    // ── Init coordinator ─────────────────────────────────────────────────────
    const init = runCli(workspace, ['multi', 'init']);
    assert.equal(init.exitCode, 0, `multi init failed:\n${init.combined}`);

    const repos = [['api', apiRepo], ['web', webRepo]];

    // ── Planning phase ───────────────────────────────────────────────────────
    executeCoordinatorPhase(workspace, repos, 'planning');
    transitionCoordinatorPhase(workspace, 'planning', 'design');

    // Verify coordinator state after first custom transition
    let coordState = loadCoordinatorState(workspace);
    assert.equal(coordState.phase, 'design', 'coordinator must be in design phase after planning→design');
    assert.equal(coordState.status, 'active');

    // ── Design phase (custom) ────────────────────────────────────────────────
    executeCoordinatorPhase(workspace, repos, 'design');
    transitionCoordinatorPhase(workspace, 'design', 'implementation');

    coordState = loadCoordinatorState(workspace);
    assert.equal(coordState.phase, 'implementation', 'coordinator must be in implementation phase after design→implementation');

    // ── Implementation phase ─────────────────────────────────────────────────
    executeCoordinatorPhase(workspace, repos, 'implementation');
    transitionCoordinatorPhase(workspace, 'implementation', 'qa');

    coordState = loadCoordinatorState(workspace);
    assert.equal(coordState.phase, 'qa', 'coordinator must be in qa phase after implementation→qa');

    // ── QA phase ─────────────────────────────────────────────────────────────
    executeCoordinatorPhase(workspace, repos, 'qa');

    // ── Completion gate ──────────────────────────────────────────────────────
    const completionReq = runCli(workspace, ['multi', 'step', '--json']);
    assert.equal(completionReq.exitCode, 0, `completion gate request failed:\n${completionReq.combined}`);
    const completion = JSON.parse(completionReq.stdout);
    assert.equal(completion.action, 'run_completion_requested');

    const approveCompletion = runCli(workspace, ['multi', 'approve-gate']);
    assert.equal(approveCompletion.exitCode, 0, `approve completion failed:\n${approveCompletion.combined}`);

    // ── Final assertions ─────────────────────────────────────────────────────

    // AT-COORD-CP-001: Coordinator completed successfully
    const finalState = loadCoordinatorState(workspace);
    assert.equal(finalState.status, 'completed');
    assert.equal(finalState.phase, 'qa');

    // AT-COORD-CP-003: History contains all phase transitions
    const history = readCoordinatorHistory(workspace);
    const phaseTransitions = history.filter((e) => e.type === 'phase_transition_requested');
    const phaseApprovals = history.filter((e) => e.type === 'phase_transition_approved');

    // Must have 3 phase transitions: planning→design, design→implementation, implementation→qa
    assert.equal(phaseTransitions.length, 3, 'must have 3 phase transition requests');
    assert.equal(phaseApprovals.length, 3, 'must have 3 phase transition approvals');

    // Verify transition order
    assert.equal(phaseTransitions[0].from, 'planning');
    assert.equal(phaseTransitions[0].to, 'design');
    assert.equal(phaseTransitions[1].from, 'design');
    assert.equal(phaseTransitions[1].to, 'implementation');
    assert.equal(phaseTransitions[2].from, 'implementation');
    assert.equal(phaseTransitions[2].to, 'qa');

    // 8 dispatches: 2 per phase × 4 phases
    const dispatches = history.filter((e) => e.type === 'turn_dispatched');
    assert.equal(dispatches.length, 8, 'must have 8 turn dispatches (2 repos × 4 phases)');

    // 8 acceptance projections
    const projections = history.filter((e) => e.type === 'acceptance_projection');
    assert.equal(projections.length, 8, 'must have 8 acceptance projections');

    // Run completed
    assert.ok(history.some((e) => e.type === 'run_completion_requested'));
    assert.ok(history.some((e) => e.type === 'run_completed'));

    // All barriers satisfied
    const barriers = readBarriers(workspace);
    assert.equal(barriers.planning_sync_completion.status, 'satisfied');
    assert.equal(barriers.design_sync_completion.status, 'satisfied');
    assert.equal(barriers.implementation_sync_completion.status, 'satisfied');
    assert.equal(barriers.qa_sync_completion.status, 'satisfied');
  });

  it('AT-COORD-CP-002: rejects phase skip planning→implementation when design is between them', () => {
    // ── Setup ────────────────────────────────────────────────────────────────
    const agentPath = createFourPhaseAgent();
    const apiRepo = makeChildRepo('api', agentPath);
    const webRepo = makeChildRepo('web', agentPath);
    const workspace = mkdtempSync(join(tmpdir(), 'axc-coord-cp-skip-'));
    tempDirs.push(workspace);

    writeJson(
      join(workspace, 'agentxchain-multi.json'),
      buildCoordinatorConfig(apiRepo, webRepo),
    );

    // ── Init coordinator ─────────────────────────────────────────────────────
    const init = runCli(workspace, ['multi', 'init']);
    assert.equal(init.exitCode, 0, `multi init failed:\n${init.combined}`);

    // ── Complete planning phase ──────────────────────────────────────────────
    const repos = [['api', apiRepo], ['web', webRepo]];
    executeCoordinatorPhase(workspace, repos, 'planning');

    // ── Attempt to skip design → go straight to implementation ───────────────
    // After planning completes, multi step would request planning→design (the next
    // ordered phase). We verify that evaluatePhaseGate rejects a skip target.

    const coordState = loadCoordinatorState(workspace);
    const configResult = loadCoordinatorConfig(workspace);
    assert.ok(configResult.ok, `loadCoordinatorConfig failed: ${configResult.errors}`);
    const coordConfig = configResult.config;

    // Evaluate a skip: planning → implementation (skipping design)
    const skipEval = evaluatePhaseGate(workspace, coordState, coordConfig, 'implementation');
    assert.equal(skipEval.ready, false, 'phase gate must not be ready for a skip');
    assert.ok(
      skipEval.blockers.some((b) => b.code === 'phase_skip_forbidden'),
      'must have phase_skip_forbidden blocker',
    );
    assert.match(
      skipEval.blockers.find((b) => b.code === 'phase_skip_forbidden').message,
      /next phase is "design"/,
      'blocker must name design as the correct next phase',
    );

    // Verify coordinator state was NOT mutated
    const afterState = loadCoordinatorState(workspace);
    assert.equal(afterState.phase, 'planning', 'phase must still be planning');
    assert.equal(afterState.status, 'active', 'status must still be active');
    assert.equal(afterState.pending_gate, null, 'no pending gate should exist');
  });
});
