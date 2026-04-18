import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readdirSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';

import {
  createPlanArtifact,
  validatePlanCoordinatorPhaseAlignment,
  buildPlannerPrompt,
  buildPlanProgressSummary,
} from '../src/lib/mission-plans.js';
import { createMission, bindCoordinatorToMission } from '../src/lib/missions.js';

function createTmpProject() {
  const dir = join(tmpdir(), `axc-plan-coord-test-${randomUUID().slice(0, 8)}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'agentxchain.json'), JSON.stringify({
    schema_version: '1.0',
    protocol_mode: 'governed',
    template: 'generic',
    project: { name: 'coord-test', id: 'coord-001', default_branch: 'main' },
    roles: { pm: { title: 'PM', mandate: 'Plan', write_authority: 'review_only', runtime: 'manual' } },
    runtimes: { manual: { type: 'manual' } },
    routing: {
      planning: { entry_role: 'pm', allowed_next_roles: ['pm'], exit_gate: 'planning_done' },
      implementation: { entry_role: 'pm', allowed_next_roles: ['pm'], exit_gate: 'impl_done' },
    },
    gates: { planning_done: {}, impl_done: {} },
    rules: { challenge_required: false, max_turn_retries: 1, max_deadlock_cycles: 1 },
  }));
  mkdirSync(join(dir, '.agentxchain'), { recursive: true });
  return dir;
}

function makeCoordinatorConfig({ phases, repos, workstreams } = {}) {
  return {
    project: { id: 'test-multi', name: 'Test Multi' },
    repos: repos || {
      frontend: { path: '/tmp/fe', resolved_path: '/tmp/fe' },
      backend: { path: '/tmp/be', resolved_path: '/tmp/be' },
      shared: { path: '/tmp/shared', resolved_path: '/tmp/shared' },
    },
    routing: phases
      ? Object.fromEntries(phases.map((p) => [p, {}]))
      : { planning: {}, implementation: {}, qa: {} },
    workstreams: workstreams || {
      'ws-api': { phase: 'implementation', repos: ['backend', 'shared'], entry_repo: 'backend', depends_on: [], completion_barrier: 'all_repos_accepted' },
      'ws-ui': { phase: 'implementation', repos: ['frontend'], entry_repo: 'frontend', depends_on: ['ws-api'], completion_barrier: 'all_repos_accepted' },
    },
  };
}

function makePlannerOutput(workstreams) {
  return {
    workstreams: workstreams || [
      {
        workstream_id: 'ws-plan',
        title: 'Planning',
        goal: 'Plan the work',
        roles: ['pm'],
        phases: ['planning'],
        depends_on: [],
        acceptance_checks: ['Plan approved'],
      },
      {
        workstream_id: 'ws-impl',
        title: 'Implementation',
        goal: 'Build it',
        roles: ['dev'],
        phases: ['implementation'],
        depends_on: ['ws-plan'],
        acceptance_checks: ['Tests pass'],
      },
    ],
  };
}

function createMissionWithCoordinator(root) {
  const result = createMission(root, { title: 'test-coord-mission', goal: 'Test coordinator integration' });
  assert.ok(result.ok);
  const bindResult = bindCoordinatorToMission(root, result.mission.mission_id, {
    super_run_id: 'srun_test_123',
    workspace_path: '/tmp/coord-workspace',
    config_path: null,
  });
  assert.ok(bindResult.ok);
  return bindResult.mission;
}

describe('validatePlanCoordinatorPhaseAlignment', () => {
  it('passes when all workstream phases match coordinator phases', () => {
    const workstreams = [
      { workstream_id: 'ws-1', phases: ['planning', 'implementation'] },
      { workstream_id: 'ws-2', phases: ['qa'] },
    ];
    const config = makeCoordinatorConfig();
    const result = validatePlanCoordinatorPhaseAlignment(workstreams, config);
    assert.ok(result.ok);
  });

  it('fails when a workstream uses a phase not in coordinator config', () => {
    const workstreams = [
      { workstream_id: 'ws-1', phases: ['planning', 'deployment'] },
    ];
    const config = makeCoordinatorConfig();
    const result = validatePlanCoordinatorPhaseAlignment(workstreams, config);
    assert.equal(result.ok, false);
    assert.ok(result.errors.length > 0);
    assert.ok(result.errors[0].includes('deployment'));
    assert.ok(result.errors[0].includes('ws-1'));
  });

  it('uses custom routing phases from coordinator config', () => {
    const workstreams = [
      { workstream_id: 'ws-1', phases: ['design', 'build'] },
    ];
    const config = makeCoordinatorConfig({ phases: ['design', 'build', 'verify'] });
    const result = validatePlanCoordinatorPhaseAlignment(workstreams, config);
    assert.ok(result.ok);
  });

  it('returns ok when coordinator config is null', () => {
    const workstreams = [
      { workstream_id: 'ws-1', phases: ['anything'] },
    ];
    const result = validatePlanCoordinatorPhaseAlignment(workstreams, null);
    assert.ok(result.ok);
  });

  it('skips workstreams with no phases array', () => {
    const workstreams = [
      { workstream_id: 'ws-1' },
    ];
    const config = makeCoordinatorConfig();
    const result = validatePlanCoordinatorPhaseAlignment(workstreams, config);
    assert.ok(result.ok);
  });

  it('reports multiple phase violations across workstreams', () => {
    const workstreams = [
      { workstream_id: 'ws-1', phases: ['staging'] },
      { workstream_id: 'ws-2', phases: ['deployment', 'rollback'] },
    ];
    const config = makeCoordinatorConfig();
    const result = validatePlanCoordinatorPhaseAlignment(workstreams, config);
    assert.equal(result.ok, false);
    assert.ok(result.errors.length >= 3); // staging + deployment + rollback
  });
});

describe('createPlanArtifact with coordinatorConfig', () => {
  let root;

  beforeEach(() => {
    root = createTmpProject();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('adds coordinator_scope to plan when mission is coordinator-bound', () => {
    const mission = createMissionWithCoordinator(root);
    const config = makeCoordinatorConfig();
    const result = createPlanArtifact(root, mission, {
      plannerOutput: makePlannerOutput(),
      coordinatorConfig: config,
    });
    assert.ok(result.ok);
    assert.ok(result.plan.coordinator_scope);
    assert.deepEqual(result.plan.coordinator_scope.repo_ids, ['frontend', 'backend', 'shared']);
    assert.deepEqual(result.plan.coordinator_scope.phases, ['planning', 'implementation', 'qa']);
    assert.equal(result.plan.coordinator_scope.super_run_id, 'srun_test_123');
    assert.ok(result.plan.coordinator_scope.bound_at);
  });

  it('does not add coordinator_scope when coordinatorConfig is null', () => {
    const missionResult = createMission(root, { title: 'plain-mission', goal: 'No coordinator' });
    assert.ok(missionResult.ok);
    const result = createPlanArtifact(root, missionResult.mission, {
      plannerOutput: makePlannerOutput(),
    });
    assert.ok(result.ok);
    assert.equal(result.plan.coordinator_scope, undefined);
  });

  it('rejects plan with phases misaligned to coordinator', () => {
    const mission = createMissionWithCoordinator(root);
    const config = makeCoordinatorConfig();
    const badOutput = makePlannerOutput([
      {
        workstream_id: 'ws-bad',
        title: 'Bad phases',
        goal: 'Wrong phase',
        roles: ['dev'],
        phases: ['deployment'], // not in coordinator
        depends_on: [],
        acceptance_checks: ['Deployed'],
      },
    ]);
    const result = createPlanArtifact(root, mission, {
      plannerOutput: badOutput,
      coordinatorConfig: config,
    });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes('deployment')));
  });

  it('persists coordinator_scope in plan artifact file', () => {
    const mission = createMissionWithCoordinator(root);
    const config = makeCoordinatorConfig();
    const result = createPlanArtifact(root, mission, {
      plannerOutput: makePlannerOutput(),
      coordinatorConfig: config,
    });
    assert.ok(result.ok);

    // Read back from disk
    const planDir = join(root, '.agentxchain', 'missions', 'plans', mission.mission_id);
    const files = readdirSync(planDir).filter((f) => f.endsWith('.json'));
    assert.equal(files.length, 1);
    const persisted = JSON.parse(readFileSync(join(planDir, files[0]), 'utf8'));
    assert.ok(persisted.coordinator_scope);
    assert.deepEqual(persisted.coordinator_scope.repo_ids, ['frontend', 'backend', 'shared']);
  });

  it('includes coordinator_workstream_ids in scope', () => {
    const mission = createMissionWithCoordinator(root);
    const config = makeCoordinatorConfig();
    const result = createPlanArtifact(root, mission, {
      plannerOutput: makePlannerOutput(),
      coordinatorConfig: config,
    });
    assert.ok(result.ok);
    assert.deepEqual(result.plan.coordinator_scope.coordinator_workstream_ids, ['ws-api', 'ws-ui']);
  });
});

describe('buildPlannerPrompt with coordinatorConfig', () => {
  const baseMission = { mission_id: 'test-mission', goal: 'Build a multi-repo feature' };

  it('includes multi-repo context when coordinatorConfig is provided', () => {
    const config = makeCoordinatorConfig();
    const { systemPrompt, userPrompt } = buildPlannerPrompt(baseMission, [], [], config);

    assert.ok(systemPrompt.includes('Multi-repo coordinator context'));
    assert.ok(systemPrompt.includes('frontend'));
    assert.ok(systemPrompt.includes('backend'));
    assert.ok(systemPrompt.includes('shared'));
    assert.ok(systemPrompt.includes('planning, implementation, qa'));
    assert.ok(userPrompt.includes('Repos in coordinator scope'));
    assert.ok(userPrompt.includes('Coordinator workstreams'));
  });

  it('does not include multi-repo context when coordinatorConfig is null', () => {
    const { systemPrompt, userPrompt } = buildPlannerPrompt(baseMission, [], []);

    assert.ok(!systemPrompt.includes('Multi-repo coordinator context'));
    assert.ok(!userPrompt.includes('Repos in coordinator scope'));
  });

  it('uses custom routing phases from coordinator config', () => {
    const config = makeCoordinatorConfig({ phases: ['design', 'build', 'verify'] });
    const { systemPrompt } = buildPlannerPrompt(baseMission, [], [], config);

    assert.ok(systemPrompt.includes('design, build, verify'));
  });

  it('includes coordinator workstream details in user prompt', () => {
    const config = makeCoordinatorConfig();
    const { userPrompt } = buildPlannerPrompt(baseMission, [], [], config);

    assert.ok(userPrompt.includes('ws-api'));
    assert.ok(userPrompt.includes('ws-ui'));
    assert.ok(userPrompt.includes('implementation'));
  });
});

describe('buildPlanProgressSummary with coordinator_scope', () => {
  it('includes coordinator_bound and repo_count for coordinator-scoped plans', () => {
    const plan = {
      plan_id: 'plan-test',
      mission_id: 'mission-test',
      status: 'proposed',
      created_at: '2026-04-17T00:00:00Z',
      updated_at: '2026-04-17T00:00:00Z',
      input: { goal: 'Test' },
      workstreams: [
        { workstream_id: 'ws-1', launch_status: 'ready' },
      ],
      launch_records: [],
      coordinator_scope: {
        super_run_id: 'srun_123',
        repo_ids: ['fe', 'be'],
        phases: ['planning', 'implementation'],
        coordinator_workstream_ids: ['ws-a'],
        bound_at: '2026-04-17T00:00:00Z',
      },
    };

    const summary = buildPlanProgressSummary(plan);
    assert.equal(summary.coordinator_bound, true);
    assert.equal(summary.coordinator_repo_count, 2);
    assert.deepEqual(summary.coordinator_phases, ['planning', 'implementation']);
  });

  it('omits coordinator fields for non-coordinator plans', () => {
    const plan = {
      plan_id: 'plan-test',
      mission_id: 'mission-test',
      status: 'proposed',
      created_at: '2026-04-17T00:00:00Z',
      updated_at: '2026-04-17T00:00:00Z',
      input: { goal: 'Test' },
      workstreams: [
        { workstream_id: 'ws-1', launch_status: 'ready' },
      ],
      launch_records: [],
    };

    const summary = buildPlanProgressSummary(plan);
    assert.equal(summary.coordinator_bound, undefined);
    assert.equal(summary.coordinator_repo_count, undefined);
  });
});
