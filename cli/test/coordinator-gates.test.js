import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initializeCoordinatorRun, loadCoordinatorState, readBarriers, readCoordinatorHistory, saveCoordinatorState } from '../src/lib/coordinator-state.js';
import { loadCoordinatorConfig } from '../src/lib/coordinator-config.js';
import { projectRepoAcceptance } from '../src/lib/coordinator-acceptance.js';
import {
  approveCoordinatorCompletion,
  approveCoordinatorPhaseTransition,
  evaluateCompletionGate,
  evaluatePhaseGate,
  requestCoordinatorCompletion,
  requestPhaseTransition,
} from '../src/lib/coordinator-gates.js';

function writeJson(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
}

function makeWorkspace() {
  return mkdtempSync(join(tmpdir(), 'axc-multi-gates-'));
}

function writeGovernedRepo(root, projectId) {
  mkdirSync(root, { recursive: true });
  mkdirSync(join(root, '.agentxchain'), { recursive: true });

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
      qa: {
        entry_role: 'dev',
        allowed_next_roles: ['dev', 'human'],
      },
    },
    gates: {},
  });

  writeJson(join(root, '.agentxchain/state.json'), {
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
  });
}

function buildCoordinatorConfig(repoPaths, overrides = {}) {
  return {
    schema_version: '0.1',
    project: { id: 'test-project', name: 'Test Project' },
    repos: {
      web: { path: repoPaths.web, default_branch: 'main', required: true },
      api: { path: repoPaths.api, default_branch: 'main', required: true },
    },
    workstreams: overrides.workstreams || {
      planning_sync: {
        phase: 'planning',
        repos: ['api', 'web'],
        entry_repo: 'api',
        depends_on: [],
        completion_barrier: 'all_repos_accepted',
      },
      implementation_build: {
        phase: 'implementation',
        repos: ['api', 'web'],
        entry_repo: 'api',
        depends_on: ['planning_sync'],
        completion_barrier: 'all_repos_accepted',
      },
      qa_release: {
        phase: 'qa',
        repos: ['api', 'web'],
        entry_repo: 'web',
        depends_on: ['implementation_build'],
        completion_barrier: 'all_repos_accepted',
      },
    },
    routing: overrides.routing || {
      planning: { entry_workstream: 'planning_sync' },
      implementation: { entry_workstream: 'implementation_build' },
      qa: { entry_workstream: 'qa_release' },
    },
    gates: overrides.gates || {
      initiative_ship: {
        requires_human_approval: true,
        requires_repos: ['api', 'web'],
      },
    },
  };
}

function setupWorkspace(configOverrides = {}) {
  const workspace = makeWorkspace();
  const webRepo = join(workspace, 'repos', 'web');
  const apiRepo = join(workspace, 'repos', 'api');

  writeGovernedRepo(webRepo, 'web');
  writeGovernedRepo(apiRepo, 'api');
  writeJson(
    join(workspace, 'agentxchain-multi.json'),
    buildCoordinatorConfig({ web: './repos/web', api: './repos/api' }, configOverrides),
  );

  const configResult = loadCoordinatorConfig(workspace);
  assert.equal(configResult.ok, true, configResult.errors?.join('\n'));

  const initResult = initializeCoordinatorRun(workspace, configResult.config);
  assert.equal(initResult.ok, true, initResult.errors?.join('\n'));

  const state = loadCoordinatorState(workspace);
  assert.ok(state, 'coordinator state should exist after init');

  return { workspace, webRepo, apiRepo, config: configResult.config, state };
}

function makeAcceptedTurn(turnId, overrides = {}) {
  return {
    turn_id: turnId,
    summary: overrides.summary ?? `Completed work for ${turnId}`,
    files_changed: overrides.files_changed ?? ['src/index.ts'],
    decisions: overrides.decisions ?? [`DEC-${turnId}`],
    verification: overrides.verification ?? { command: 'npm test', exit_code: 0 },
    ...overrides,
  };
}

function updateRepoState(repoRoot, patch) {
  const file = join(repoRoot, '.agentxchain/state.json');
  const current = JSON.parse(readFileSync(file, 'utf8'));
  writeJson(file, { ...current, ...patch });
}

function markAllBarriersSatisfied(workspace) {
  const barriers = readBarriers(workspace);
  for (const barrier of Object.values(barriers)) {
    barrier.status = 'satisfied';
  }
  writeJson(join(workspace, '.agentxchain/multirepo/barriers.json'), barriers);
}

describe('coordinator gates', () => {
  it('AT-CG-001: phase gate blocks when one required repo has an active turn', () => {
    const { workspace, apiRepo, config, state } = setupWorkspace();
    try {
      updateRepoState(apiRepo, {
        active_turns: {
          turn_api_001: {
            turn_id: 'turn_api_001',
            assigned_role: 'dev',
            status: 'running',
          },
        },
      });

      const result = evaluatePhaseGate(workspace, state, config);
      assert.equal(result.ready, false);
      assert.ok(result.blockers.some((blocker) => blocker.code === 'repo_active_turns' && blocker.repo_id === 'api'));
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('AT-CG-002: phase gate blocks when a barrier is partially_satisfied', () => {
    const { workspace, config, state } = setupWorkspace();
    try {
      const projection = projectRepoAcceptance(workspace, state, config, 'api', makeAcceptedTurn('turn_api_001'), 'planning_sync');
      assert.equal(projection.ok, true);

      const result = evaluatePhaseGate(workspace, state, config);
      assert.equal(result.ready, false);
      assert.ok(result.blockers.some((blocker) =>
        blocker.code === 'barrier_unsatisfied'
        && blocker.barrier_id === 'planning_sync_completion'
        && blocker.barrier_status === 'partially_satisfied'));
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('AT-CG-003: phase transition pauses for approval, then advances after approval', () => {
    const { workspace, config, state } = setupWorkspace();
    try {
      projectRepoAcceptance(workspace, state, config, 'api', makeAcceptedTurn('turn_api_001'), 'planning_sync');
      projectRepoAcceptance(workspace, state, config, 'web', makeAcceptedTurn('turn_web_001'), 'planning_sync');

      const request = requestPhaseTransition(workspace, state, config, 'implementation');
      assert.equal(request.ok, true);
      assert.equal(request.state.status, 'paused');
      assert.equal(request.state.pending_gate?.gate_type, 'phase_transition');
      assert.equal(request.state.pending_gate?.to, 'implementation');

      const approval = approveCoordinatorPhaseTransition(workspace, request.state, config);
      assert.equal(approval.ok, true);
      assert.equal(approval.state.status, 'active');
      assert.equal(approval.state.phase, 'implementation');
      assert.equal(approval.state.pending_gate, null);
      assert.equal(approval.state.phase_gate_status['phase_transition:planning->implementation'], 'passed');

      const history = readCoordinatorHistory(workspace);
      assert.ok(history.some((entry) => entry.type === 'phase_transition_requested'));
      assert.ok(history.some((entry) => entry.type === 'phase_transition_approved'));
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('AT-CG-004: completion gate blocks when one required repo is blocked', () => {
    const { workspace, apiRepo, webRepo, config, state } = setupWorkspace();
    try {
      saveCoordinatorState(workspace, { ...state, phase: 'qa' });
      markAllBarriersSatisfied(workspace);

      updateRepoState(apiRepo, {
        status: 'blocked',
        active_turns: {},
      });
      updateRepoState(webRepo, {
        status: 'completed',
        active_turns: {},
      });

      const result = evaluateCompletionGate(workspace, loadCoordinatorState(workspace), config);
      assert.equal(result.ready, false);
      assert.ok(result.blockers.some((blocker) => blocker.code === 'repo_blocked' && blocker.repo_id === 'api'));
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('AT-CG-005: completion gate pauses for approval, then completes the initiative', () => {
    const { workspace, apiRepo, webRepo, config, state } = setupWorkspace();
    try {
      saveCoordinatorState(workspace, { ...state, phase: 'qa' });
      markAllBarriersSatisfied(workspace);

      updateRepoState(apiRepo, {
        status: 'completed',
        active_turns: {},
      });
      updateRepoState(webRepo, {
        status: 'completed',
        active_turns: {},
      });

      const request = requestCoordinatorCompletion(workspace, loadCoordinatorState(workspace), config);
      assert.equal(request.ok, true);
      assert.equal(request.state.status, 'paused');
      assert.equal(request.state.pending_gate?.gate_type, 'run_completion');

      const approval = approveCoordinatorCompletion(workspace, request.state, config);
      assert.equal(approval.ok, true);
      assert.equal(approval.state.status, 'completed');
      assert.equal(approval.state.pending_gate, null);
      assert.equal(approval.state.phase_gate_status.initiative_ship, 'passed');
      assert.ok(approval.state.completed_at, 'completed_at should be recorded');
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('AT-CG-006: approving a phase transition satisfies pending shared_human_gate barriers', () => {
    const { workspace, config, state } = setupWorkspace({
      workstreams: {
        planning_sync: {
          phase: 'planning',
          repos: ['api', 'web'],
          entry_repo: 'api',
          depends_on: [],
          completion_barrier: 'shared_human_gate',
        },
        implementation_build: {
          phase: 'implementation',
          repos: ['api', 'web'],
          entry_repo: 'api',
          depends_on: ['planning_sync'],
          completion_barrier: 'all_repos_accepted',
        },
        qa_release: {
          phase: 'qa',
          repos: ['api', 'web'],
          entry_repo: 'web',
          depends_on: ['implementation_build'],
          completion_barrier: 'all_repos_accepted',
        },
      },
    });
    try {
      const evaluation = evaluatePhaseGate(workspace, state, config);
      assert.equal(evaluation.ready, true);
      assert.deepEqual(evaluation.human_barriers, ['planning_sync_completion']);

      const request = requestPhaseTransition(workspace, state, config, 'implementation');
      assert.equal(request.ok, true);

      const approval = approveCoordinatorPhaseTransition(workspace, request.state, config);
      assert.equal(approval.ok, true);

      const barriers = readBarriers(workspace);
      assert.equal(barriers.planning_sync_completion.status, 'satisfied');
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});
