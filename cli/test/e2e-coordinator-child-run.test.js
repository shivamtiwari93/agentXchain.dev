import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'vitest';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { loadCoordinatorState, readBarriers, readCoordinatorHistory } from '../src/lib/coordinator-state.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(__dirname, '..', 'bin', 'agentxchain.js');
const CHILD_AGENT = join(__dirname, '..', 'test-support', 'coordinator-child-run-agent.mjs');
const tempDirs = [];

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

function runCli(cwd, args, timeout = 60000) {
  const result = spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd,
    encoding: 'utf8',
    timeout,
    env: { ...process.env, NODE_NO_WARNINGS: '1', NO_COLOR: '1' },
  });

  return {
    status: result.status ?? 1,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    combined: `${result.stdout || ''}${result.stderr || ''}`,
  };
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
        command: process.execPath,
        args: [CHILD_AGENT],
        prompt_transport: 'dispatch_bundle_only',
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
    rules: {
      challenge_required: false,
      max_turn_retries: 1,
    },
  });
}

function buildCoordinatorConfig(repoPaths) {
  return {
    schema_version: '0.1',
    project: { id: 'coord-child-run', name: 'Coordinator Child Run' },
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

function makeWorkspace() {
  const workspace = mkdtempSync(join(tmpdir(), 'axc-coord-child-run-'));
  tempDirs.push(workspace);

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

function acceptedTurnIds(repoRoot) {
  return readJsonl(join(repoRoot, '.agentxchain', 'history.jsonl'))
    .filter((entry) => entry.turn_id && (entry.accepted_at || entry.status === 'accepted' || entry.status === 'completed'))
    .map((entry) => entry.turn_id);
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

describe('Coordinator child-run E2E', () => {
  it('AT-COORD-RUN-001/002/003: coordinator dispatches child repos through real step execution and projects upstream acceptances', () => {
    const { workspace, apiRepo, webRepo } = makeWorkspace();

    const init = runCli(workspace, ['multi', 'init']);
    assert.equal(init.status, 0, `multi init failed:\n${init.combined}`);

    const planningApiDispatch = runCli(workspace, ['multi', 'step', '--json']);
    assert.equal(planningApiDispatch.status, 0, `planning api dispatch failed:\n${planningApiDispatch.combined}`);
    const planningApi = JSON.parse(planningApiDispatch.stdout);
    assert.equal(planningApi.repo_id, 'api');
    assert.ok(existsSync(join(planningApi.bundle_path, 'ASSIGNMENT.json')));

    const apiPlanningStep = runCli(apiRepo, ['step', '--resume']);
    assert.equal(apiPlanningStep.status, 0, `api planning step failed:\n${apiPlanningStep.combined}`);
    assert.match(apiPlanningStep.combined, /Turn accepted/i);

    const planningWebDispatch = runCli(workspace, ['multi', 'step', '--json']);
    assert.equal(planningWebDispatch.status, 0, `planning web dispatch failed:\n${planningWebDispatch.combined}`);
    const planningWeb = JSON.parse(planningWebDispatch.stdout);
    assert.equal(planningWeb.repo_id, 'web');
    assert.ok(existsSync(join(planningWeb.bundle_path, 'ASSIGNMENT.json')));
    const planningContext = readJson(join(planningWeb.bundle_path, 'COORDINATOR_CONTEXT.json'));
    assert.equal(planningContext.upstream_acceptances.length, 1);
    assert.equal(planningContext.upstream_acceptances[0].repo_id, 'api');

    const webPlanningStep = runCli(webRepo, ['step', '--resume']);
    assert.equal(webPlanningStep.status, 0, `web planning step failed:\n${webPlanningStep.combined}`);
    assert.match(webPlanningStep.combined, /Turn accepted/i);

    const phaseGateRequest = runCli(workspace, ['multi', 'step', '--json']);
    assert.equal(phaseGateRequest.status, 0, `phase gate request failed:\n${phaseGateRequest.combined}`);
    const phaseGate = JSON.parse(phaseGateRequest.stdout);
    assert.equal(phaseGate.action, 'phase_transition_requested');
    assert.equal(phaseGate.from, 'planning');
    assert.equal(phaseGate.to, 'implementation');

    const approvePhase = runCli(workspace, ['multi', 'approve-gate']);
    assert.equal(approvePhase.status, 0, `approve phase failed:\n${approvePhase.combined}`);

    const implementationApiDispatch = runCli(workspace, ['multi', 'step', '--json']);
    assert.equal(implementationApiDispatch.status, 0, `implementation api dispatch failed:\n${implementationApiDispatch.combined}`);
    const implementationApi = JSON.parse(implementationApiDispatch.stdout);
    assert.equal(implementationApi.repo_id, 'api');
    assert.ok(existsSync(join(implementationApi.bundle_path, 'ASSIGNMENT.json')));

    const apiImplementationStep = runCli(apiRepo, ['step', '--resume']);
    assert.equal(apiImplementationStep.status, 0, `api implementation step failed:\n${apiImplementationStep.combined}`);
    assert.match(apiImplementationStep.combined, /Turn accepted/i);

    const implementationWebDispatch = runCli(workspace, ['multi', 'step', '--json']);
    assert.equal(implementationWebDispatch.status, 0, `implementation web dispatch failed:\n${implementationWebDispatch.combined}`);
    const implementationWeb = JSON.parse(implementationWebDispatch.stdout);
    assert.equal(implementationWeb.repo_id, 'web');
    assert.ok(existsSync(join(implementationWeb.bundle_path, 'ASSIGNMENT.json')));
    const implementationContext = readJson(join(implementationWeb.bundle_path, 'COORDINATOR_CONTEXT.json'));
    assert.ok(
      implementationContext.upstream_acceptances.some((entry) => entry.repo_id === 'api'),
      'implementation dispatch must carry upstream acceptance from api',
    );

    const webImplementationStep = runCli(webRepo, ['step', '--resume']);
    assert.equal(webImplementationStep.status, 0, `web implementation step failed:\n${webImplementationStep.combined}`);
    assert.match(webImplementationStep.combined, /Turn accepted/i);

    const completionGateRequest = runCli(workspace, ['multi', 'step', '--json']);
    assert.equal(completionGateRequest.status, 0, `completion gate request failed:\n${completionGateRequest.combined}`);
    const completionGate = JSON.parse(completionGateRequest.stdout);
    assert.equal(completionGate.action, 'run_completion_requested');
    assert.equal(completionGate.gate_type, 'run_completion');

    const approveCompletion = runCli(workspace, ['multi', 'approve-gate']);
    assert.equal(approveCompletion.status, 0, `approve completion failed:\n${approveCompletion.combined}`);

    const finalState = loadCoordinatorState(workspace);
    assert.equal(finalState.status, 'completed');
    assert.equal(finalState.phase, 'implementation');

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

    const apiAcceptedTurns = acceptedTurnIds(apiRepo);
    const webAcceptedTurns = acceptedTurnIds(webRepo);
    assert.equal(apiAcceptedTurns.length, 2);
    assert.equal(webAcceptedTurns.length, 2);
  });
});
