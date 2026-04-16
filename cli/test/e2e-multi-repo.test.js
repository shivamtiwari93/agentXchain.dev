import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadCoordinatorState, readCoordinatorHistory, readBarriers } from '../src/lib/coordinator-state.js';
import { getTurnStagingResultPath } from '../src/lib/turn-paths.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(__dirname, '..', 'bin', 'agentxchain.js');

function writeJson(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function readJsonl(path) {
  if (!existsSync(path)) {
    return [];
  }
  const content = readFileSync(path, 'utf8').trim();
  if (!content) {
    return [];
  }
  return content.split('\n').map((line) => JSON.parse(line));
}

function writeGovernedRepo(root, projectId) {
  mkdirSync(root, { recursive: true });
  mkdirSync(join(root, '.agentxchain', 'prompts'), { recursive: true });
  mkdirSync(join(root, '.agentxchain', 'staging'), { recursive: true });

  writeJson(join(root, '.agentxchain', 'state.json'), {
    schema_version: '1.1',
    project_id: projectId,
    run_id: null,
    status: 'idle',
    phase: 'planning',
    active_turns: {},
    turn_sequence: 0,
    accepted_count: 0,
    rejected_count: 0,
    blocked_on: null,
    blocked_reason: null,
    next_recommended_role: null,
    protocol_mode: 'governed',
  });

  writeJson(join(root, 'agentxchain.json'), {
    schema_version: '1.0',
    template: 'generic',
    project: { id: projectId, name: projectId, default_branch: 'main' },
    roles: {
      dev: {
        title: 'Developer',
        mandate: 'Implement safely.',
        write_authority: 'authoritative',
        runtime: 'local-dev',
      },
    },
    runtimes: {
      'local-dev': {
        type: 'local_cli',
        command: ['echo', '{prompt}'],
        prompt_transport: 'argv',
      },
    },
    routing: {
      planning: {
        entry_role: 'dev',
        allowed_next_roles: ['dev', 'human'],
      },
      implementation: {
        entry_role: 'dev',
        allowed_next_roles: ['dev', 'human'],
      },
    },
    gates: {},
  });
}

function buildCoordinatorConfig(repoPaths) {
  return {
    schema_version: '0.1',
    project: { id: 'test-multi-e2e', name: 'Test Multi Repo E2E' },
    repos: {
      api: { path: repoPaths.api, default_branch: 'main', required: true },
      web: { path: repoPaths.web, default_branch: 'main', required: true },
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

function runCli(cwd, args) {
  return spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 15000,
    env: { ...process.env, NODE_NO_WARNINGS: '1' },
  });
}

function makeWorkspace() {
  const workspace = mkdtempSync(join(tmpdir(), 'axc-multi-e2e-'));
  const apiRepo = join(workspace, 'repos', 'api');
  const webRepo = join(workspace, 'repos', 'web');
  writeGovernedRepo(apiRepo, 'api');
  writeGovernedRepo(webRepo, 'web');
  writeJson(
    join(workspace, 'agentxchain-multi.json'),
    buildCoordinatorConfig({ api: './repos/api', web: './repos/web' }),
  );
  return { workspace, apiRepo, webRepo };
}

function getActiveTurn(repoRoot) {
  const state = readJson(join(repoRoot, '.agentxchain', 'state.json'));
  const activeTurn = Object.values(state.active_turns || {})[0];
  assert.ok(activeTurn, `expected active turn in ${repoRoot}`);
  return { state, activeTurn };
}

function stageAndAcceptTurn(repoRoot, repoId, summary, options = {}) {
  const { state, activeTurn } = getActiveTurn(repoRoot);
  const changedFile = `src/${repoId}-${summary.replace(/\s+/g, '-').toLowerCase()}.ts`;
  mkdirSync(join(repoRoot, 'src'), { recursive: true });
  writeFileSync(join(repoRoot, changedFile), `export const result = "${summary}";\n`);

  const stagingPath = join(repoRoot, getTurnStagingResultPath(activeTurn.turn_id));
  mkdirSync(dirname(stagingPath), { recursive: true });
  writeJson(stagingPath, {
    schema_version: '1.0',
    run_id: state.run_id,
    turn_id: activeTurn.turn_id,
    role: activeTurn.assigned_role,
    runtime_id: activeTurn.runtime_id,
    status: 'completed',
    summary,
    decisions: [
      {
        id: `DEC-${String(Date.now()).slice(-3)}`,
        category: 'implementation',
        statement: summary,
        rationale: 'Multi-repo E2E acceptance.',
      },
    ],
    objections: [],
    files_changed: [changedFile],
    artifacts_created: [],
    verification: {
      status: 'pass',
      commands: ['node --eval "process.exit(0)"'],
      evidence_summary: `Acceptance proof for ${repoId}.`,
      machine_evidence: [
        { command: 'node --eval "process.exit(0)"', exit_code: 0 },
      ],
    },
    artifact: { type: 'workspace', ref: null },
    proposed_next_role: 'human',
    phase_transition_request: options.phaseTransition || null,
    run_completion_request: options.completed || false,
    needs_human_reason: null,
    cost: { input_tokens: 10, output_tokens: 5, usd: 0 },
  });

  const acceptResult = runCli(repoRoot, ['accept-turn']);
  assert.equal(acceptResult.status, 0, `accept-turn failed in ${repoId}:\n${acceptResult.stdout}\n${acceptResult.stderr}`);

  return activeTurn.turn_id;
}

describe('E2E multi-repo lifecycle', () => {
  it('AT-CE-006: init → dispatch → resync projection → phase gate → completion gate', () => {
    const { workspace, apiRepo, webRepo } = makeWorkspace();

    try {
      const init = runCli(workspace, ['multi', 'init']);
      assert.equal(init.status, 0, `stderr: ${init.stderr}`);

      const planningApiDispatch = runCli(workspace, ['multi', 'step', '--json']);
      assert.equal(planningApiDispatch.status, 0, `stderr: ${planningApiDispatch.stderr}`);
      const planningApi = JSON.parse(planningApiDispatch.stdout);
      assert.equal(planningApi.action, undefined);
      assert.equal(planningApi.repo_id, 'api');

      stageAndAcceptTurn(apiRepo, 'api', 'Planning API accepted', { phaseTransition: 'implementation' });

      const planningWebDispatch = runCli(workspace, ['multi', 'step', '--json']);
      assert.equal(planningWebDispatch.status, 0, `stderr: ${planningWebDispatch.stderr}`);
      const planningWeb = JSON.parse(planningWebDispatch.stdout);
      assert.equal(planningWeb.repo_id, 'web');
      const planningContext = readJson(join(planningWeb.bundle_path, 'COORDINATOR_CONTEXT.json'));
      assert.equal(planningContext.upstream_acceptances.length, 1);
      assert.equal(planningContext.upstream_acceptances[0].repo_id, 'api');

      stageAndAcceptTurn(webRepo, 'web', 'Planning web accepted', { phaseTransition: 'implementation' });

      const phaseGateRequest = runCli(workspace, ['multi', 'step', '--json']);
      assert.equal(phaseGateRequest.status, 0, `stderr: ${phaseGateRequest.stderr}`);
      const phaseGate = JSON.parse(phaseGateRequest.stdout);
      assert.equal(phaseGate.action, 'phase_transition_requested');
      assert.equal(phaseGate.from, 'planning');
      assert.equal(phaseGate.to, 'implementation');

      const approvePhase = runCli(workspace, ['multi', 'approve-gate']);
      assert.equal(approvePhase.status, 0, `stderr: ${approvePhase.stderr}`);
      assert.match(approvePhase.stdout, /planning -> implementation/);

      const implementationApiDispatch = runCli(workspace, ['multi', 'step', '--json']);
      assert.equal(implementationApiDispatch.status, 0, `stderr: ${implementationApiDispatch.stderr}`);
      const implementationApi = JSON.parse(implementationApiDispatch.stdout);
      assert.equal(implementationApi.repo_id, 'api');

      stageAndAcceptTurn(apiRepo, 'api', 'Implementation API accepted', { completed: true });

      const implementationWebDispatch = runCli(workspace, ['multi', 'step', '--json']);
      assert.equal(implementationWebDispatch.status, 0, `stderr: ${implementationWebDispatch.stderr}`);
      const implementationWeb = JSON.parse(implementationWebDispatch.stdout);
      assert.equal(implementationWeb.repo_id, 'web');
      const implementationContext = readJson(join(implementationWeb.bundle_path, 'COORDINATOR_CONTEXT.json'));
      assert.ok(implementationContext.upstream_acceptances.length >= 1);
      assert.ok(implementationContext.upstream_acceptances.some((entry) => entry.repo_id === 'api'));

      stageAndAcceptTurn(webRepo, 'web', 'Implementation web accepted', { completed: true });

      const completionGateRequest = runCli(workspace, ['multi', 'step', '--json']);
      assert.equal(completionGateRequest.status, 0, `stderr: ${completionGateRequest.stderr}`);
      const completionGate = JSON.parse(completionGateRequest.stdout);
      assert.equal(completionGate.action, 'run_completion_requested');
      assert.equal(completionGate.gate_type, 'run_completion');

      const approveCompletion = runCli(workspace, ['multi', 'approve-gate']);
      assert.equal(approveCompletion.status, 0, `stderr: ${approveCompletion.stderr}`);
      assert.match(approveCompletion.stdout, /now complete/);

      const finalState = loadCoordinatorState(workspace);
      assert.equal(finalState.status, 'completed');
      assert.equal(finalState.phase, 'implementation');
      assert.equal(finalState.phase_gate_status['phase_transition:planning->implementation'], 'passed');
      assert.equal(finalState.phase_gate_status.initiative_ship, 'passed');

      const history = readCoordinatorHistory(workspace);
      assert.equal(history.filter((entry) => entry.type === 'turn_dispatched').length, 4);
      assert.equal(history.filter((entry) => entry.type === 'acceptance_projection').length, 4);
      assert.ok(history.some((entry) => entry.type === 'phase_transition_requested'));
      assert.ok(history.some((entry) => entry.type === 'phase_transition_approved'));
      assert.ok(history.some((entry) => entry.type === 'run_completion_requested'));
      assert.ok(history.some((entry) => entry.type === 'run_completed'));

      const barriers = readBarriers(workspace);
      assert.equal(barriers.planning_sync_completion.status, 'satisfied');
      assert.equal(barriers.implementation_sync_completion.status, 'satisfied');

      const barrierLedger = readJsonl(join(workspace, '.agentxchain', 'multirepo', 'barrier-ledger.jsonl'));
      assert.ok(
        barrierLedger.some((entry) => entry.barrier_id === 'planning_sync_completion' && entry.new_status === 'satisfied'),
      );
      assert.ok(
        barrierLedger.some((entry) => entry.barrier_id === 'implementation_sync_completion' && entry.new_status === 'satisfied'),
      );

      const apiHistory = readJsonl(join(apiRepo, '.agentxchain', 'history.jsonl'));
      const webHistory = readJsonl(join(webRepo, '.agentxchain', 'history.jsonl'));
      assert.equal(apiHistory.length, 2);
      assert.equal(webHistory.length, 2);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});
