import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';

const cliRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const binPath = join(cliRoot, 'bin', 'agentxchain.js');
const missionPlansPath = join(cliRoot, 'src', 'lib', 'mission-plans.js');
const missionCommandPath = join(cliRoot, 'src', 'commands', 'mission.js');

function createTmpProject() {
  const dir = join(tmpdir(), `axc-mission-plan-test-${randomUUID().slice(0, 8)}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'agentxchain.json'), JSON.stringify({
    version: 4,
    project: { name: 'plan-test', id: 'plan-001' },
    roles: { pm: { agent: 'manual' }, dev: { agent: 'manual' }, qa: { agent: 'manual' } },
    workflow: { phases: ['planning', 'implementation', 'qa'] },
  }, null, 2));
  return dir;
}

function writeMission(dir, { missionId, title, goal }) {
  const missionsDir = join(dir, '.agentxchain', 'missions');
  mkdirSync(missionsDir, { recursive: true });
  const now = new Date().toISOString();
  const artifact = {
    mission_id: missionId,
    title,
    goal,
    status: 'active',
    created_at: now,
    updated_at: now,
    chain_ids: [],
  };
  writeFileSync(join(missionsDir, `${missionId}.json`), JSON.stringify(artifact, null, 2));
  return artifact;
}

function validPlannerOutput() {
  return {
    workstreams: [
      {
        workstream_id: 'ws-alignment',
        title: 'Align release surfaces',
        goal: 'Unify version truth across package, docs, homepage.',
        roles: ['pm', 'dev'],
        phases: ['planning', 'implementation'],
        depends_on: [],
        acceptance_checks: ['All surfaces derive from one validator path'],
      },
      {
        workstream_id: 'ws-verification',
        title: 'Verify downstream parity',
        goal: 'Confirm npm, website, Homebrew match.',
        roles: ['qa'],
        phases: ['qa'],
        depends_on: ['ws-alignment'],
        acceptance_checks: ['Published surfaces match the release tag'],
      },
    ],
  };
}

describe('mission-plans.js — structural guards', () => {
  it('AT-MISSION-PLAN-S01: mission-plans.js module exists and exports core functions', async () => {
    assert.ok(existsSync(missionPlansPath), 'mission-plans.js must exist');
    const mod = await import(missionPlansPath);
    assert.equal(typeof mod.validatePlannerOutput, 'function');
    assert.equal(typeof mod.createPlanArtifact, 'function');
    assert.equal(typeof mod.loadAllPlans, 'function');
    assert.equal(typeof mod.loadLatestPlan, 'function');
    assert.equal(typeof mod.loadPlan, 'function');
    assert.equal(typeof mod.buildPlannerPrompt, 'function');
    assert.equal(typeof mod.parsePlannerResponse, 'function');
  });

  it('AT-MISSION-PLAN-S02: mission.js exports plan command functions', async () => {
    const mod = await import(missionCommandPath);
    assert.equal(typeof mod.missionPlanCommand, 'function');
    assert.equal(typeof mod.missionPlanShowCommand, 'function');
    assert.equal(typeof mod.missionPlanListCommand, 'function');
  });

  it('AT-MISSION-PLAN-S03: CLI registers mission plan subcommands', () => {
    const bin = readFileSync(binPath, 'utf8');
    assert.ok(bin.includes("command('plan"), 'mission plan must be registered');
    assert.ok(bin.includes('missionPlanCommand'), 'missionPlanCommand must be imported');
    assert.ok(bin.includes('missionPlanShowCommand'), 'missionPlanShowCommand must be imported');
    assert.ok(bin.includes('missionPlanListCommand'), 'missionPlanListCommand must be imported');
    assert.ok(bin.includes('--constraint'), 'plan must accept --constraint');
    assert.ok(bin.includes('--role-hint'), 'plan must accept --role-hint');
  });

  it('AT-MISSION-PLAN-S04: mission decomposition spec exists', () => {
    const specPath = join(cliRoot, '..', '.planning', 'MISSION_DECOMPOSITION_SPEC.md');
    assert.ok(existsSync(specPath), 'MISSION_DECOMPOSITION_SPEC.md must exist');
    const content = readFileSync(specPath, 'utf8');
    assert.ok(content.includes('workstreams'), 'spec must reference workstreams');
    assert.ok(content.includes('Approval is mandatory'), 'spec must document approval gate');
  });
});

describe('mission-plans.js — schema validation', () => {
  let mod;

  beforeEach(async () => {
    mod = await import(missionPlansPath);
  });

  it('AT-MISSION-PLAN-001: validates well-formed planner output', () => {
    const result = mod.validatePlannerOutput(validPlannerOutput());
    assert.equal(result.ok, true);
    assert.equal(result.workstreams.length, 2);
  });

  it('AT-MISSION-PLAN-002: rejects null/undefined planner output', () => {
    assert.equal(mod.validatePlannerOutput(null).ok, false);
    assert.equal(mod.validatePlannerOutput(undefined).ok, false);
    assert.equal(mod.validatePlannerOutput('string').ok, false);
  });

  it('AT-MISSION-PLAN-003: rejects output missing workstreams array', () => {
    const result = mod.validatePlannerOutput({ data: [] });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes('"workstreams" array')));
  });

  it('AT-MISSION-PLAN-004: rejects empty workstreams array', () => {
    const result = mod.validatePlannerOutput({ workstreams: [] });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes('at least one workstream')));
  });

  it('AT-MISSION-PLAN-005: rejects workstream missing required fields', () => {
    const result = mod.validatePlannerOutput({
      workstreams: [{ workstream_id: 'ws-1', title: 'Test' }],
    });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes('missing required field')));
  });

  it('AT-MISSION-PLAN-006: rejects workstream with pre-allocated chain_id', () => {
    const output = validPlannerOutput();
    output.workstreams[0].chain_id = 'chain-fake-123';
    const result = mod.validatePlannerOutput(output);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes('chain_id')));
  });

  it('AT-MISSION-PLAN-007: rejects duplicate workstream_id', () => {
    const output = validPlannerOutput();
    output.workstreams[1].workstream_id = 'ws-alignment';
    const result = mod.validatePlannerOutput(output);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes('duplicate')));
  });

  it('AT-MISSION-PLAN-008: rejects unknown dependency references', () => {
    const output = validPlannerOutput();
    output.workstreams[1].depends_on = ['ws-nonexistent'];
    const result = mod.validatePlannerOutput(output);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes('unknown workstream_id')));
  });
});

describe('mission-plans.js — plan artifact creation', () => {
  let tmpDir;
  let mod;

  beforeEach(async () => {
    tmpDir = createTmpProject();
    mod = await import(missionPlansPath);
  });

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  it('AT-MISSION-PLAN-009: createPlanArtifact writes plan under missions/plans/<mission_id>/', () => {
    const mission = writeMission(tmpDir, {
      missionId: 'mission-release-hardening',
      title: 'Release Hardening',
      goal: 'Eliminate release-surface drift.',
    });

    const result = mod.createPlanArtifact(tmpDir, mission, {
      constraints: ['No protocol version changes'],
      roleHints: ['pm', 'dev'],
      plannerOutput: validPlannerOutput(),
    });

    assert.equal(result.ok, true);
    assert.ok(result.plan.plan_id.startsWith('plan-'));
    assert.equal(result.plan.mission_id, 'mission-release-hardening');
    assert.equal(result.plan.status, 'proposed');
    assert.equal(result.plan.input.goal, 'Eliminate release-surface drift.');
    assert.deepEqual(result.plan.input.constraints, ['No protocol version changes']);
    assert.deepEqual(result.plan.input.role_hints, ['pm', 'dev']);

    // Verify file exists on disk
    const plansDir = join(tmpDir, '.agentxchain', 'missions', 'plans', 'mission-release-hardening');
    assert.ok(existsSync(plansDir));
    const files = readdirSync(plansDir).filter((f) => f.endsWith('.json'));
    assert.equal(files.length, 1);
  });

  it('AT-MISSION-PLAN-010: plan input uses mission goal, not operator-restated goal', () => {
    const mission = writeMission(tmpDir, {
      missionId: 'mission-goal-binding',
      title: 'Goal Binding Test',
      goal: 'The canonical mission goal.',
    });

    const result = mod.createPlanArtifact(tmpDir, mission, {
      plannerOutput: validPlannerOutput(),
    });

    assert.equal(result.ok, true);
    assert.equal(result.plan.input.goal, 'The canonical mission goal.');
  });

  it('AT-MISSION-PLAN-011: plan workstreams have no pre-allocated chain_id', () => {
    const mission = writeMission(tmpDir, {
      missionId: 'mission-no-chain-ids',
      title: 'No Chain IDs',
      goal: 'Verify no pre-allocated chain_ids.',
    });

    const result = mod.createPlanArtifact(tmpDir, mission, {
      plannerOutput: validPlannerOutput(),
    });

    assert.equal(result.ok, true);
    for (const ws of result.plan.workstreams) {
      assert.equal(ws.chain_id, undefined, `workstream ${ws.workstream_id} must not have chain_id`);
    }
  });

  it('AT-MISSION-PLAN-012: workstream launch_status derived from dependencies', () => {
    const mission = writeMission(tmpDir, {
      missionId: 'mission-launch-status',
      title: 'Launch Status',
      goal: 'Test dependency-derived launch_status.',
    });

    const result = mod.createPlanArtifact(tmpDir, mission, {
      plannerOutput: validPlannerOutput(),
    });

    assert.equal(result.ok, true);
    const alignment = result.plan.workstreams.find((ws) => ws.workstream_id === 'ws-alignment');
    const verification = result.plan.workstreams.find((ws) => ws.workstream_id === 'ws-verification');
    assert.equal(alignment.launch_status, 'ready', 'no-dependency workstream should be ready');
    assert.equal(verification.launch_status, 'blocked', 'dependent workstream should be blocked');
  });

  it('AT-MISSION-PLAN-013: malformed planner output does not create any artifact', () => {
    const mission = writeMission(tmpDir, {
      missionId: 'mission-malformed',
      title: 'Malformed Test',
      goal: 'Planner gives bad output.',
    });

    const result = mod.createPlanArtifact(tmpDir, mission, {
      plannerOutput: { workstreams: [{ workstream_id: 'ws-bad' }] },
    });

    assert.equal(result.ok, false);
    assert.ok(result.errors.length > 0);

    // No plan artifact should exist
    const plansDir = join(tmpDir, '.agentxchain', 'missions', 'plans', 'mission-malformed');
    assert.equal(existsSync(plansDir), false);
  });

  it('AT-MISSION-PLAN-014: second plan sets supersedes_plan_id to first plan', () => {
    const mission = writeMission(tmpDir, {
      missionId: 'mission-supersede',
      title: 'Supersession Test',
      goal: 'Test plan revision by supersession.',
    });

    const first = mod.createPlanArtifact(tmpDir, mission, {
      plannerOutput: validPlannerOutput(),
    });
    assert.equal(first.ok, true);
    assert.equal(first.plan.supersedes_plan_id, null);

    // Small delay to ensure different plan_id timestamp
    const second = mod.createPlanArtifact(tmpDir, mission, {
      constraints: ['Revised scope'],
      plannerOutput: validPlannerOutput(),
    });
    assert.equal(second.ok, true);
    assert.equal(second.plan.supersedes_plan_id, first.plan.plan_id);
  });
});

describe('mission-plans.js — plan loading', () => {
  let tmpDir;
  let mod;

  beforeEach(async () => {
    tmpDir = createTmpProject();
    mod = await import(missionPlansPath);
  });

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  it('AT-MISSION-PLAN-015: loadLatestPlan returns the most recent plan for a mission', () => {
    const mission = writeMission(tmpDir, {
      missionId: 'mission-load-latest',
      title: 'Load Latest',
      goal: 'Test latest plan loading.',
    });

    // Write plans with explicit timestamps to guarantee ordering
    const plansDir = join(tmpDir, '.agentxchain', 'missions', 'plans', 'mission-load-latest');
    mkdirSync(plansDir, { recursive: true });

    const olderPlan = {
      plan_id: 'plan-older',
      mission_id: 'mission-load-latest',
      status: 'proposed',
      created_at: '2026-04-16T10:00:00.000Z',
      workstreams: validPlannerOutput().workstreams,
    };
    const newerPlan = {
      plan_id: 'plan-newer',
      mission_id: 'mission-load-latest',
      status: 'proposed',
      created_at: '2026-04-16T11:00:00.000Z',
      workstreams: validPlannerOutput().workstreams,
    };
    writeFileSync(join(plansDir, 'plan-older.json'), JSON.stringify(olderPlan, null, 2));
    writeFileSync(join(plansDir, 'plan-newer.json'), JSON.stringify(newerPlan, null, 2));

    const latest = mod.loadLatestPlan(tmpDir, 'mission-load-latest');
    assert.ok(latest);
    assert.equal(latest.plan_id, 'plan-newer');
  });

  it('AT-MISSION-PLAN-016: loadPlan returns a specific plan by ID', () => {
    const mission = writeMission(tmpDir, {
      missionId: 'mission-load-specific',
      title: 'Load Specific',
      goal: 'Test specific plan loading.',
    });

    const first = mod.createPlanArtifact(tmpDir, mission, { plannerOutput: validPlannerOutput() });
    mod.createPlanArtifact(tmpDir, mission, { plannerOutput: validPlannerOutput() });

    const loaded = mod.loadPlan(tmpDir, 'mission-load-specific', first.plan.plan_id);
    assert.ok(loaded);
    assert.equal(loaded.plan_id, first.plan.plan_id);
  });

  it('AT-MISSION-PLAN-017: loadAllPlans returns newest-first', () => {
    const mission = writeMission(tmpDir, {
      missionId: 'mission-load-all',
      title: 'Load All',
      goal: 'Test all plans loading.',
    });

    // Write plans with explicit timestamps to guarantee ordering
    const plansDir = join(tmpDir, '.agentxchain', 'missions', 'plans', 'mission-load-all');
    mkdirSync(plansDir, { recursive: true });

    const olderPlan = {
      plan_id: 'plan-first',
      mission_id: 'mission-load-all',
      status: 'proposed',
      created_at: '2026-04-16T10:00:00.000Z',
      workstreams: validPlannerOutput().workstreams,
    };
    const newerPlan = {
      plan_id: 'plan-second',
      mission_id: 'mission-load-all',
      status: 'proposed',
      created_at: '2026-04-16T11:00:00.000Z',
      workstreams: validPlannerOutput().workstreams,
    };
    writeFileSync(join(plansDir, 'plan-first.json'), JSON.stringify(olderPlan, null, 2));
    writeFileSync(join(plansDir, 'plan-second.json'), JSON.stringify(newerPlan, null, 2));

    const all = mod.loadAllPlans(tmpDir, 'mission-load-all');
    assert.equal(all.length, 2);
    assert.equal(all[0].plan_id, 'plan-second');
    assert.equal(all[1].plan_id, 'plan-first');
  });

  it('AT-MISSION-PLAN-018: loadLatestPlan returns null for mission with no plans', () => {
    writeMission(tmpDir, {
      missionId: 'mission-no-plans',
      title: 'No Plans',
      goal: 'Empty.',
    });

    const latest = mod.loadLatestPlan(tmpDir, 'mission-no-plans');
    assert.equal(latest, null);
  });
});

describe('mission-plans.js — planner prompt and response parsing', () => {
  let mod;

  beforeEach(async () => {
    mod = await import(missionPlansPath);
  });

  it('AT-MISSION-PLAN-019: buildPlannerPrompt includes mission goal and constraints', () => {
    const mission = { goal: 'Fix release drift' };
    const constraints = ['No protocol changes'];
    const roleHints = ['dev', 'qa'];

    const { systemPrompt, userPrompt } = mod.buildPlannerPrompt(mission, constraints, roleHints);
    assert.ok(systemPrompt.includes('workstreams'));
    assert.ok(systemPrompt.includes('chain_id'));
    assert.ok(userPrompt.includes('Fix release drift'));
    assert.ok(userPrompt.includes('No protocol changes'));
    assert.ok(userPrompt.includes('dev'));
    assert.ok(userPrompt.includes('qa'));
  });

  it('AT-MISSION-PLAN-020: parsePlannerResponse handles valid JSON', () => {
    const result = mod.parsePlannerResponse(JSON.stringify(validPlannerOutput()));
    assert.equal(result.ok, true);
    assert.ok(Array.isArray(result.data.workstreams));
  });

  it('AT-MISSION-PLAN-021: parsePlannerResponse strips markdown fences', () => {
    const wrapped = '```json\n' + JSON.stringify(validPlannerOutput()) + '\n```';
    const result = mod.parsePlannerResponse(wrapped);
    assert.equal(result.ok, true);
    assert.ok(Array.isArray(result.data.workstreams));
  });

  it('AT-MISSION-PLAN-022: parsePlannerResponse rejects invalid JSON', () => {
    const result = mod.parsePlannerResponse('not valid json {');
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('Failed to parse'));
  });

  it('AT-MISSION-PLAN-023: parsePlannerResponse rejects empty input', () => {
    assert.equal(mod.parsePlannerResponse('').ok, false);
    assert.equal(mod.parsePlannerResponse(null).ok, false);
  });
});
