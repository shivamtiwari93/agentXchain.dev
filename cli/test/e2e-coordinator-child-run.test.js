/**
 * E2E coordinator child-run proof
 *
 * Proves that coordinator-dispatched child repos complete work through real
 * `agentxchain step --resume` execution (local-cli adapter → mock-agent →
 * staged result → `accept-turn`), not through hand-staged turn-result.json.
 *
 * See: .planning/COORDINATOR_CHILD_RUN_E2E_SPEC.md
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

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(__dirname, '..', 'bin', 'agentxchain.js');

const tempDirs = [];

/**
 * Create a two-phase mock-agent that requests run completion in implementation
 * (instead of the standard mock-agent which requests a qa phase).
 * This aligns with the coordinator's two-phase model (planning + implementation).
 */
function createTwoPhaseAgent() {
  const agentDir = mkdtempSync(join(tmpdir(), 'axc-coord-mock-'));
  tempDirs.push(agentDir);
  const agentPath = join(agentDir, 'mock-agent-two-phase.mjs');
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

if (phase === 'planning') {
  ensureFile('.planning/PM_SIGNOFF.md', '# PM Signoff\\nApproved: YES\\n');
  ensureFile('.planning/ROADMAP.md', '# Roadmap\\nMock roadmap.\\n');
}
if (phase === 'implementation') {
  ensureFile('src/output.js', 'export const ok = true;\\n');
}

// Two-phase model: planning requests impl transition, implementation requests completion
let phaseTransitionRequest = null;
let runCompletionRequest = null;
if (phase === 'planning') {
  phaseTransitionRequest = 'implementation';
} else if (phase === 'implementation') {
  runCompletionRequest = true;
}

const turnResult = {
  schema_version: '1.0', run_id: runId, turn_id: turnId, role, runtime_id: runtimeId,
  status: 'completed',
  summary: \`Mock \${role} completed \${phase} (two-phase).\`,
  decisions: [{ id: 'DEC-001', category: 'implementation', statement: \`\${role} done in \${phase}.\`, rationale: 'E2E mock.' }],
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
console.log(\`mock-agent-two-phase: \${role} completed (\${phase})\`);
`);
  return agentPath;
}

function writeJson(filePath, value) {
  writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n');
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function readJsonl(filePath) {
  if (!existsSync(filePath)) return [];
  const content = readFileSync(filePath, 'utf8').trim();
  if (!content) return [];
  return content.split('\n').map((line) => JSON.parse(line));
}

/**
 * Scaffold a governed child repo with mock-agent runtime.
 * Uses scaffoldGoverned() + patches runtimes to local_cli backed by two-phase mock-agent.
 */
function makeChildRepo(name, agentPath) {
  const root = mkdtempSync(join(tmpdir(), `axc-coord-run-${name}-`));
  tempDirs.push(root);
  scaffoldGoverned(root, `Coord Run ${name}`, `coord-run-${name}-${Date.now()}`);

  const configPath = join(root, 'agentxchain.json');
  const config = readJson(configPath);

  // Patch all runtimes to use the two-phase mock-agent
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

  // Restrict to two-phase routing (planning + implementation) to match coordinator config.
  // The default scaffold includes qa phase, but our coordinator only has two phases.
  config.routing = {
    planning: {
      entry_role: 'pm',
      allowed_next_roles: ['pm', 'dev', 'human'],
      exit_gate: 'planning_signoff',
    },
    implementation: {
      entry_role: 'dev',
      allowed_next_roles: ['dev', 'human'],
    },
  };

  writeJson(configPath, config);
  return root;
}

/**
 * Build coordinator config linking two child repos.
 */
function buildCoordinatorConfig(apiPath, webPath) {
  return {
    schema_version: '0.1',
    project: { id: 'coord-child-run-e2e', name: 'Coordinator Child Run E2E' },
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
      implementation_sync: {
        phase: 'implementation',
        repos: ['api', 'web'],
        entry_repo: 'api',
        depends_on: ['planning_sync'],
        completion_barrier: 'all_repos_accepted',
      },
    },
    routing: {
      planning: { entry_workstream: 'planning_sync' },
      implementation: { entry_workstream: 'implementation_sync' },
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
 * Execute the full child-repo turn cycle through a real CLI command:
 *   `agentxchain step --resume` — dispatches via local-cli adapter (mock-agent),
 *   then auto-validates and auto-accepts the staged result (Phase 4 of step).
 *
 * The mock-agent requests phase transitions (planning→implementation, etc.)
 * which create repo-local pending gates. If a pending gate is created, we
 * approve it so the coordinator can proceed.
 *
 * No direct writes to state.json or history.jsonl.
 */
function executeChildRepoTurn(repoRoot, label) {
  const stepResult = runCli(repoRoot, ['step', '--resume'], { timeout: 30000 });
  assert.equal(
    stepResult.exitCode,
    0,
    `step --resume failed in ${label}:\n${stepResult.combined}`,
  );

  // The mock-agent requests phase transitions which create pending gates.
  // Approve any pending repo-local gate so the coordinator can evaluate its own gates.
  const approveResult = runCli(repoRoot, ['approve-transition']);
  // approve-transition may exit 0 (gate approved) or non-zero (no pending gate) — both fine
  if (approveResult.exitCode !== 0 && !approveResult.combined.includes('No pending')) {
    // Only fail if it's a real error, not "no pending gate"
    assert.equal(
      approveResult.exitCode,
      0,
      `approve-transition unexpected failure in ${label}:\n${approveResult.combined}`,
    );
  }
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('E2E coordinator with real child-repo execution', () => {
  it('AT-COORD-RUN-001/002/003: full lifecycle with real agentxchain step in child repos', () => {
    // ── Setup ────────────────────────────────────────────────────────────────
    const agentPath = createTwoPhaseAgent();
    const apiRepo = makeChildRepo('api', agentPath);
    const webRepo = makeChildRepo('web', agentPath);
    const workspace = mkdtempSync(join(tmpdir(), 'axc-coord-run-ws-'));
    tempDirs.push(workspace);

    writeJson(
      join(workspace, 'agentxchain-multi.json'),
      buildCoordinatorConfig(apiRepo, webRepo),
    );

    // ── Init coordinator ─────────────────────────────────────────────────────
    const init = runCli(workspace, ['multi', 'init']);
    assert.equal(init.exitCode, 0, `multi init failed:\n${init.combined}`);

    // ── Planning phase: api ──────────────────────────────────────────────────
    const planApiDispatch = runCli(workspace, ['multi', 'step', '--json']);
    assert.equal(planApiDispatch.exitCode, 0, `plan api dispatch failed:\n${planApiDispatch.combined}`);
    const planApi = JSON.parse(planApiDispatch.stdout);
    assert.equal(planApi.repo_id, 'api', 'first planning dispatch should target api');

    // Real child-repo execution (not simulateAcceptedTurn!)
    executeChildRepoTurn(apiRepo, 'planning/api');

    // ── Planning phase: web ──────────────────────────────────────────────────
    const planWebDispatch = runCli(workspace, ['multi', 'step', '--json']);
    assert.equal(planWebDispatch.exitCode, 0, `plan web dispatch failed:\n${planWebDispatch.combined}`);
    const planWeb = JSON.parse(planWebDispatch.stdout);
    assert.equal(planWeb.repo_id, 'web', 'second planning dispatch should target web');

    // AT-COORD-RUN-003: Verify upstream acceptance propagation
    const planWebContext = readJson(join(planWeb.bundle_path, 'COORDINATOR_CONTEXT.json'));
    assert.equal(planWebContext.upstream_acceptances.length, 1, 'web should see api upstream acceptance');
    assert.equal(planWebContext.upstream_acceptances[0].repo_id, 'api');

    executeChildRepoTurn(webRepo, 'planning/web');

    // ── Phase gate: planning → implementation ────────────────────────────────
    const phaseGateReq = runCli(workspace, ['multi', 'step', '--json']);
    assert.equal(phaseGateReq.exitCode, 0, `phase gate request failed:\n${phaseGateReq.combined}`);
    const phaseGate = JSON.parse(phaseGateReq.stdout);
    assert.equal(phaseGate.action, 'phase_transition_requested');
    assert.equal(phaseGate.from, 'planning');
    assert.equal(phaseGate.to, 'implementation');

    const approvePhase = runCli(workspace, ['multi', 'approve-gate']);
    assert.equal(approvePhase.exitCode, 0, `approve phase gate failed:\n${approvePhase.combined}`);

    // ── Implementation phase: api ────────────────────────────────────────────
    const implApiDispatch = runCli(workspace, ['multi', 'step', '--json']);
    assert.equal(implApiDispatch.exitCode, 0, `impl api dispatch failed:\n${implApiDispatch.combined}`);
    const implApi = JSON.parse(implApiDispatch.stdout);
    assert.equal(implApi.repo_id, 'api');

    executeChildRepoTurn(apiRepo, 'implementation/api');

    // ── Implementation phase: web ────────────────────────────────────────────
    const implWebDispatch = runCli(workspace, ['multi', 'step', '--json']);
    assert.equal(implWebDispatch.exitCode, 0, `impl web dispatch failed:\n${implWebDispatch.combined}`);
    const implWeb = JSON.parse(implWebDispatch.stdout);
    assert.equal(implWeb.repo_id, 'web');

    // Verify upstream acceptance from implementation/api
    const implWebContext = readJson(join(implWeb.bundle_path, 'COORDINATOR_CONTEXT.json'));
    assert.ok(
      implWebContext.upstream_acceptances.some((a) => a.repo_id === 'api'),
      'implementation/web should see api upstream acceptance',
    );

    executeChildRepoTurn(webRepo, 'implementation/web');

    // ── Completion gate ──────────────────────────────────────────────────────
    const completionReq = runCli(workspace, ['multi', 'step', '--json']);
    assert.equal(completionReq.exitCode, 0, `completion gate request failed:\n${completionReq.combined}`);
    const completion = JSON.parse(completionReq.stdout);
    assert.equal(completion.action, 'run_completion_requested');

    const approveCompletion = runCli(workspace, ['multi', 'approve-gate']);
    assert.equal(approveCompletion.exitCode, 0, `approve completion failed:\n${approveCompletion.combined}`);

    // ── Final assertions ─────────────────────────────────────────────────────

    // Coordinator state
    const finalState = loadCoordinatorState(workspace);
    assert.equal(finalState.status, 'completed');
    assert.equal(finalState.phase, 'implementation');

    // Coordinator history: 4 dispatches + 4 acceptance projections
    const history = readCoordinatorHistory(workspace);
    const dispatches = history.filter((e) => e.type === 'turn_dispatched');
    const projections = history.filter((e) => e.type === 'acceptance_projection');
    assert.equal(dispatches.length, 4, 'should have 4 turn dispatches');
    assert.equal(projections.length, 4, 'should have 4 acceptance projections');
    assert.ok(history.some((e) => e.type === 'phase_transition_requested'));
    assert.ok(history.some((e) => e.type === 'phase_transition_approved'));
    assert.ok(history.some((e) => e.type === 'run_completion_requested'));
    assert.ok(history.some((e) => e.type === 'run_completed'));

    // Barriers satisfied
    const barriers = readBarriers(workspace);
    assert.equal(barriers.planning_sync_completion.status, 'satisfied');
    assert.equal(barriers.implementation_sync_completion.status, 'satisfied');

    // AT-COORD-RUN-002: Child repo histories written by accept-turn, not by test
    const apiHistory = readJsonl(join(apiRepo, '.agentxchain', 'history.jsonl'));
    const webHistory = readJsonl(join(webRepo, '.agentxchain', 'history.jsonl'));
    assert.equal(apiHistory.length, 2, 'api should have 2 accepted turns');
    assert.equal(webHistory.length, 2, 'web should have 2 accepted turns');

    // Verify each history entry was written by the real accept flow (not hand-staged)
    for (const entry of [...apiHistory, ...webHistory]) {
      // acceptGovernedTurn writes status 'completed' (turn completed and accepted)
      assert.ok(
        entry.status === 'completed' || entry.status === 'accepted',
        `entry must be completed or accepted, got: ${entry.status}`,
      );
      assert.ok(entry.turn_id, 'each entry must have a turn_id');
      assert.ok(entry.accepted_at || entry.timestamp, 'each entry must have a timestamp');
    }

    // Dispatch directories exist in child repos (proof the adapter path was used)
    // The step --resume command re-writes bundles, so check the dispatch dir exists
    assert.ok(
      existsSync(join(apiRepo, '.agentxchain', 'dispatch')),
      'api repo must have dispatch directory from real step execution',
    );
    assert.ok(
      existsSync(join(webRepo, '.agentxchain', 'dispatch')),
      'web repo must have dispatch directory from real step execution',
    );
  });
});
