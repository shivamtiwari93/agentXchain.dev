/**
 * E2E Multi-Repo Quickstart
 *
 * Validates the cold-start coordinator onboarding path from real child repo
 * scaffolds instead of hand-written governed fixtures.
 *
 * See: .planning/MULTI_REPO_QUICKSTART_SPEC.md
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execSync, spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(__dirname, '..', 'bin', 'agentxchain.js');

function runCli(cwd, args) {
  return spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1', NODE_NO_WARNINGS: '1' },
    timeout: 20000,
  });
}

function gitCommitAll(cwd, message) {
  execSync('git add -A', { cwd, stdio: 'ignore' });
  execSync(`git -c user.name="test" -c user.email="test@test" commit -m "${message}"`, {
    cwd,
    stdio: 'ignore',
  });
}

function writeJson(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function markGateCredentialed(repoRoot, gateId) {
  const configPath = join(repoRoot, 'agentxchain.json');
  const config = readJson(configPath);
  config.gates[gateId] = {
    ...config.gates[gateId],
    credentialed: true,
  };
  writeJson(configPath, config);
}

function buildCoordinatorConfig() {
  return {
    schema_version: '0.1',
    project: {
      id: 'agentxchain-rollout',
      name: 'AgentXchain Rollout',
    },
    repos: {
      api: {
        path: './repos/api',
        default_branch: 'main',
        required: true,
      },
      web: {
        path: './repos/web',
        default_branch: 'main',
        required: true,
      },
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
      qa_sync: {
        phase: 'qa',
        repos: ['api', 'web'],
        entry_repo: 'api',
        depends_on: ['implementation_sync'],
        completion_barrier: 'all_repos_accepted',
      },
    },
    routing: {
      planning: {
        entry_workstream: 'planning_sync',
      },
      implementation: {
        entry_workstream: 'implementation_sync',
      },
      qa: {
        entry_workstream: 'qa_sync',
      },
    },
    gates: {
      initiative_ship: {
        requires_human_approval: true,
        requires_repos: ['api', 'web'],
      },
    },
  };
}

function getActiveTurn(repoRoot) {
  const state = readJson(join(repoRoot, '.agentxchain', 'state.json'));
  const activeTurn = Object.values(state.active_turns || {})[0];
  assert.ok(activeTurn, `expected active turn in ${repoRoot}`);
  return { state, activeTurn };
}

function stagePlanningTurn(repoRoot, summary) {
  const { state, activeTurn } = getActiveTurn(repoRoot);
  mkdirSync(join(repoRoot, '.planning'), { recursive: true });
  writeFileSync(join(repoRoot, '.planning', 'PM_SIGNOFF.md'), '# PM Signoff\n\nApproved: YES\n');
  writeFileSync(join(repoRoot, '.planning', 'ROADMAP.md'), '# Roadmap\n\n## Phases\n\n- Planning accepted\n');
  gitCommitAll(repoRoot, `planning artifacts for ${summary}`);

  const stagingDir = join(repoRoot, '.agentxchain', 'staging', activeTurn.turn_id);
  mkdirSync(stagingDir, { recursive: true });
  writeJson(join(stagingDir, 'turn-result.json'), {
    schema_version: '1.0',
    run_id: state.run_id,
    turn_id: activeTurn.turn_id,
    role: activeTurn.assigned_role,
    runtime_id: activeTurn.runtime_id,
    status: 'completed',
    summary,
    decisions: [
      {
        id: 'DEC-001',
        category: 'scope',
        statement: `${summary} planned`,
        rationale: 'Required for coordinated rollout.',
      },
    ],
    objections: [
      {
        id: 'OBJ-001',
        severity: 'low',
        statement: 'Manual coordination remains required at the gate boundary.',
        status: 'raised',
      },
    ],
    files_changed: [],
    artifacts_created: [],
    verification: {
      status: 'skipped',
      commands: [],
      evidence_summary: 'Planning turn.',
      machine_evidence: [],
    },
    artifact: {
      type: 'review',
      path: '.planning/PM_SIGNOFF.md',
    },
    proposed_next_role: 'human',
    phase_transition_request: 'implementation',
    run_completion_request: null,
    needs_human_reason: null,
    cost: {
      input_tokens: 0,
      output_tokens: 0,
      usd: 0,
    },
  });
}

describe('multi-repo quickstart cold-start E2E', () => {
  it('scaffolds child repos, dispatches coordinated planning, and opens the coordinator phase gate', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'axc-multi-quickstart-'));
    const apiRepo = join(workspace, 'repos', 'api');
    const webRepo = join(workspace, 'repos', 'web');

    try {
      let result = runCli(workspace, ['init', '--governed', '--template', 'api-service', '--dir', 'repos/api', '-y']);
      assert.equal(result.status, 0, result.stderr);
      result = runCli(workspace, ['init', '--governed', '--template', 'web-app', '--dir', 'repos/web', '-y']);
      assert.equal(result.status, 0, result.stderr);

      execSync('git init', { cwd: apiRepo, stdio: 'ignore' });
      markGateCredentialed(apiRepo, 'planning_signoff');
      gitCommitAll(apiRepo, 'bootstrap api governed scaffold');
      execSync('git init', { cwd: webRepo, stdio: 'ignore' });
      markGateCredentialed(webRepo, 'planning_signoff');
      gitCommitAll(webRepo, 'bootstrap web governed scaffold');

      result = runCli(apiRepo, ['template', 'validate']);
      assert.equal(result.status, 0, result.stderr);
      result = runCli(webRepo, ['template', 'validate']);
      assert.equal(result.status, 0, result.stderr);

      writeJson(join(workspace, 'agentxchain-multi.json'), buildCoordinatorConfig());

      result = runCli(workspace, ['multi', 'init', '--json']);
      assert.equal(result.status, 0, result.stderr);
      const init = JSON.parse(result.stdout);
      assert.ok(init.super_run_id);
      assert.ok(init.repo_runs.api);
      assert.ok(init.repo_runs.web);

      result = runCli(workspace, ['multi', 'step', '--json']);
      assert.equal(result.status, 0, result.stderr);
      const firstDispatch = JSON.parse(result.stdout);
      assert.equal(firstDispatch.repo_id, 'api');
      assert.ok(existsSync(join(firstDispatch.bundle_path, 'COORDINATOR_CONTEXT.json')));

      stagePlanningTurn(apiRepo, 'API planning accepted');
      result = runCli(apiRepo, ['accept-turn']);
      assert.equal(result.status, 0, result.stderr);
      result = runCli(apiRepo, ['approve-transition']);
      assert.equal(result.status, 0, result.stderr);

      result = runCli(workspace, ['multi', 'step', '--json']);
      assert.equal(result.status, 0, result.stderr);
      const secondDispatch = JSON.parse(result.stdout);
      assert.equal(secondDispatch.repo_id, 'web');
      const webContext = readJson(join(secondDispatch.bundle_path, 'COORDINATOR_CONTEXT.json'));
      assert.equal(webContext.upstream_acceptances.length, 1);
      assert.equal(webContext.upstream_acceptances[0].repo_id, 'api');

      stagePlanningTurn(webRepo, 'Web planning accepted');
      result = runCli(webRepo, ['accept-turn']);
      assert.equal(result.status, 0, result.stderr);
      result = runCli(webRepo, ['approve-transition']);
      assert.equal(result.status, 0, result.stderr);

      result = runCli(workspace, ['multi', 'step', '--json']);
      assert.equal(result.status, 0, result.stderr);
      const gateRequest = JSON.parse(result.stdout);
      assert.equal(gateRequest.action, 'phase_transition_requested');
      assert.equal(gateRequest.from, 'planning');
      assert.equal(gateRequest.to, 'implementation');

      result = runCli(workspace, ['multi', 'approve-gate']);
      assert.equal(result.status, 0, result.stderr);

      result = runCli(workspace, ['multi', 'status', '--json']);
      assert.equal(result.status, 0, result.stderr);
      const status = JSON.parse(result.stdout);
      assert.equal(status.phase, 'implementation');
      assert.equal(status.status, 'active');
      assert.equal(status.barriers.planning_sync_completion.status, 'satisfied');
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});
