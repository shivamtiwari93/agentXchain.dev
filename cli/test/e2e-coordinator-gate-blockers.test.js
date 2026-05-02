import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { getTurnStagingResultPath } from '../src/lib/turn-paths.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(__dirname, '..', 'bin', 'agentxchain.js');

function writeJson(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
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
    project: { id: 'coord-gate-blockers-e2e', name: 'Coordinator Gate Blockers E2E' },
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
  const result = spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 15000,
    env: { ...process.env, NODE_NO_WARNINGS: '1' },
  });
  return {
    ...result,
    exitCode: result.status,
    combined: `${result.stdout}\n${result.stderr}`,
  };
}

function makeWorkspace() {
  const workspace = mkdtempSync(join(tmpdir(), 'axc-coord-gate-blockers-'));
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
        id: `DEC-${String(Date.now()).slice(-4)}`,
        category: 'implementation',
        statement: summary,
        rationale: 'Coordinator gate blocker E2E.',
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
  assert.equal(acceptResult.exitCode, 0, `accept-turn failed in ${repoId}:\n${acceptResult.combined}`);
}

describe('E2E coordinator gate blocker surfacing', () => {
  it('AT-CGBE-001: multi step surfaces repo_active_turns and barrier_unsatisfied when a phase gate is not ready', () => {
    const { workspace, apiRepo } = makeWorkspace();

    try {
      const init = runCli(workspace, ['multi', 'init']);
      assert.equal(init.exitCode, 0, init.combined);

      const apiDispatch = runCli(workspace, ['multi', 'step', '--json']);
      assert.equal(apiDispatch.exitCode, 0, apiDispatch.combined);
      const apiPayload = JSON.parse(apiDispatch.stdout);
      assert.equal(apiPayload.repo_id, 'api');

      stageAndAcceptTurn(apiRepo, 'api', 'Planning API accepted', { phaseTransition: 'implementation' });

      const webDispatch = runCli(workspace, ['multi', 'step', '--json']);
      assert.equal(webDispatch.exitCode, 0, webDispatch.combined);
      const webPayload = JSON.parse(webDispatch.stdout);
      assert.equal(webPayload.repo_id, 'web');

      const blockedStep = runCli(workspace, ['multi', 'step']);
      assert.notEqual(blockedStep.exitCode, 0, 'multi step must fail while a required repo still has an active turn');
      assert.match(blockedStep.stderr, /Coordinator phase gate is not ready:/);
      assert.match(blockedStep.stderr, /\[repo_active_turns\] Repo "web" still has 1 active turn\(s\)/);
      assert.match(blockedStep.stderr, /\[barrier_unsatisfied\] Barrier "planning_sync_completion" is "partially_satisfied"/);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('AT-CGBE-002: multi step surfaces repo_run_id_mismatch with expected and actual values', () => {
    const { workspace, apiRepo, webRepo } = makeWorkspace();

    try {
      const init = runCli(workspace, ['multi', 'init']);
      assert.equal(init.exitCode, 0, init.combined);

      const apiDispatch = runCli(workspace, ['multi', 'step', '--json']);
      assert.equal(apiDispatch.exitCode, 0, apiDispatch.combined);
      stageAndAcceptTurn(apiRepo, 'api', 'Planning API accepted', { phaseTransition: 'implementation' });

      const webDispatch = runCli(workspace, ['multi', 'step', '--json']);
      assert.equal(webDispatch.exitCode, 0, webDispatch.combined);
      stageAndAcceptTurn(webRepo, 'web', 'Planning web accepted', { phaseTransition: 'implementation' });

      const tamperedStatePath = join(webRepo, '.agentxchain', 'state.json');
      const tamperedState = readJson(tamperedStatePath);
      const expectedRunId = tamperedState.run_id;
      tamperedState.run_id = `${expectedRunId}-tampered`;
      writeJson(tamperedStatePath, tamperedState);

      const blockedStep = runCli(workspace, ['multi', 'step']);
      assert.notEqual(blockedStep.exitCode, 0, 'multi step must fail when repo-local run identity drifts');
      assert.match(blockedStep.stderr, /Coordinator resync entered blocked state:/);
      assert.match(blockedStep.stderr, /\[repo_run_id_mismatch\] Repo "web" run identity drifted:/);
      assert.match(blockedStep.stderr, new RegExp(`Expected:\\s+${expectedRunId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
      assert.match(blockedStep.stderr, new RegExp(`Actual:\\s+${(expectedRunId + '-tampered').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});
