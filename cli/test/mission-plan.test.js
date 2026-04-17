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
    schema_version: '1.0',
    protocol_mode: 'governed',
    template: 'generic',
    project: { name: 'plan-test', id: 'plan-001', default_branch: 'main' },
    roles: {
      pm: {
        title: 'PM',
        mandate: 'Plan the work.',
        write_authority: 'review_only',
        runtime: 'manual-pm',
      },
      dev: {
        title: 'Developer',
        mandate: 'Implement the work.',
        write_authority: 'authoritative',
        runtime: 'manual-dev',
      },
      qa: {
        title: 'QA',
        mandate: 'Verify the work.',
        write_authority: 'review_only',
        runtime: 'manual-qa',
      },
    },
    runtimes: {
      'manual-pm': { type: 'manual' },
      'manual-dev': { type: 'manual' },
      'manual-qa': { type: 'manual' },
    },
    routing: {
      planning: { entry_role: 'pm', allowed_next_roles: ['pm', 'dev', 'human'], exit_gate: 'planning_signoff' },
      implementation: { entry_role: 'dev', allowed_next_roles: ['dev', 'qa', 'human'], exit_gate: 'implementation_complete' },
      qa: { entry_role: 'qa', allowed_next_roles: ['qa', 'human'], exit_gate: 'qa_signoff' },
    },
    gates: {
      planning_signoff: { requires_human_approval: true },
      implementation_complete: {},
      qa_signoff: { requires_human_approval: true },
    },
    rules: {
      challenge_required: true,
      max_turn_retries: 2,
      max_deadlock_cycles: 2,
    },
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

function writeChainReport(dir, report) {
  const reportsDir = join(dir, '.agentxchain', 'reports');
  mkdirSync(reportsDir, { recursive: true });
  writeFileSync(join(reportsDir, `${report.chain_id}.json`), JSON.stringify(report, null, 2));
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
    assert.equal(typeof mod.approvePlanArtifact, 'function');
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
    assert.equal(typeof mod.missionPlanApproveCommand, 'function');
    assert.equal(typeof mod.missionPlanListCommand, 'function');
  });

  it('AT-MISSION-PLAN-S03: CLI registers mission plan subcommands', () => {
    const bin = readFileSync(binPath, 'utf8');
    assert.ok(bin.includes("command('plan"), 'mission plan must be registered');
    assert.ok(bin.includes('missionPlanCommand'), 'missionPlanCommand must be imported');
    assert.ok(bin.includes('missionPlanShowCommand'), 'missionPlanShowCommand must be imported');
    assert.ok(bin.includes('missionPlanApproveCommand'), 'missionPlanApproveCommand must be imported');
    assert.ok(bin.includes('missionPlanListCommand'), 'missionPlanListCommand must be imported');
    assert.ok(bin.includes('--constraint'), 'plan must accept --constraint');
    assert.ok(bin.includes('--role-hint'), 'plan must accept --role-hint');
    assert.ok(bin.includes("command('approve"), 'mission plan approve must be registered');
  });

  it('AT-MISSION-PLAN-S04: mission decomposition spec exists', () => {
    const specPath = join(cliRoot, '..', '.planning', 'MISSION_DECOMPOSITION_SPEC.md');
    assert.ok(existsSync(specPath), 'MISSION_DECOMPOSITION_SPEC.md must exist');
    const content = readFileSync(specPath, 'utf8');
    assert.ok(content.includes('workstreams'), 'spec must reference workstreams');
    assert.ok(content.includes('Approval is mandatory'), 'spec must document approval gate');
  });
});

describe('mission-plans.js — plan approval', () => {
  let tmpDir;
  let mod;

  beforeEach(async () => {
    tmpDir = createTmpProject();
    mod = await import(missionPlansPath);
  });

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  it('AT-MISSION-PLAN-024: approvePlanArtifact approves the latest proposed plan', () => {
    const mission = writeMission(tmpDir, {
      missionId: 'mission-approve-latest',
      title: 'Approve Latest',
      goal: 'Approve the current revision.',
    });

    const created = mod.createPlanArtifact(tmpDir, mission, {
      plannerOutput: validPlannerOutput(),
    });
    assert.equal(created.ok, true);

    const approved = mod.approvePlanArtifact(tmpDir, mission.mission_id, created.plan.plan_id);
    assert.equal(approved.ok, true);
    assert.equal(approved.plan.status, 'approved');
    assert.ok(approved.plan.approved_at);
    assert.deepEqual(approved.supersededPlanIds, []);
  });

  it('AT-MISSION-PLAN-025: approvePlanArtifact rejects double approval', () => {
    const mission = writeMission(tmpDir, {
      missionId: 'mission-double-approve',
      title: 'Double Approval',
      goal: 'Reject duplicate approval.',
    });

    const created = mod.createPlanArtifact(tmpDir, mission, {
      plannerOutput: validPlannerOutput(),
    });
    assert.equal(created.ok, true);
    assert.equal(mod.approvePlanArtifact(tmpDir, mission.mission_id, created.plan.plan_id).ok, true);

    const second = mod.approvePlanArtifact(tmpDir, mission.mission_id, created.plan.plan_id);
    assert.equal(second.ok, false);
    assert.match(second.error, /already approved/i);
  });

  it('AT-MISSION-PLAN-026: older plan cannot be approved when a newer revision exists', () => {
    const mission = writeMission(tmpDir, {
      missionId: 'mission-superseded-approval',
      title: 'Superseded Approval',
      goal: 'Reject stale approval targets.',
    });

    const first = mod.createPlanArtifact(tmpDir, mission, {
      plannerOutput: validPlannerOutput(),
    });
    const second = mod.createPlanArtifact(tmpDir, mission, {
      constraints: ['Refined plan'],
      plannerOutput: validPlannerOutput(),
    });

    assert.equal(first.ok, true);
    assert.equal(second.ok, true);

    const rejected = mod.approvePlanArtifact(tmpDir, mission.mission_id, first.plan.plan_id);
    assert.equal(rejected.ok, false);
    assert.match(rejected.error, /superseded by newer plan/i);
  });

  it('AT-MISSION-PLAN-027: approving a newer plan supersedes older active plans', () => {
    const mission = writeMission(tmpDir, {
      missionId: 'mission-supersede-active',
      title: 'Supersede Active',
      goal: 'Keep one current approved plan.',
    });

    const first = mod.createPlanArtifact(tmpDir, mission, {
      plannerOutput: validPlannerOutput(),
    });
    assert.equal(mod.approvePlanArtifact(tmpDir, mission.mission_id, first.plan.plan_id).ok, true);

    const second = mod.createPlanArtifact(tmpDir, mission, {
      constraints: ['Refined scope'],
      plannerOutput: validPlannerOutput(),
    });
    const approved = mod.approvePlanArtifact(tmpDir, mission.mission_id, second.plan.plan_id);
    assert.equal(approved.ok, true);
    assert.deepEqual(approved.supersededPlanIds, [first.plan.plan_id]);

    const reloadedFirst = mod.loadPlan(tmpDir, mission.mission_id, first.plan.plan_id);
    assert.equal(reloadedFirst.status, 'superseded');
    assert.equal(reloadedFirst.superseded_by_plan_id, second.plan.plan_id);
  });

  it('AT-MISSION-PLAN-028: new revisions supersede the latest plan artifact, not an older approved plan', () => {
    const mission = writeMission(tmpDir, {
      missionId: 'mission-supersede-latest',
      title: 'Supersede Latest',
      goal: 'Revision lineage follows recency.',
    });

    const first = mod.createPlanArtifact(tmpDir, mission, {
      plannerOutput: validPlannerOutput(),
    });
    assert.equal(mod.approvePlanArtifact(tmpDir, mission.mission_id, first.plan.plan_id).ok, true);

    const second = mod.createPlanArtifact(tmpDir, mission, {
      constraints: ['First revision'],
      plannerOutput: validPlannerOutput(),
    });
    const third = mod.createPlanArtifact(tmpDir, mission, {
      constraints: ['Second revision'],
      plannerOutput: validPlannerOutput(),
    });

    assert.equal(second.ok, true);
    assert.equal(third.ok, true);
    assert.equal(second.plan.supersedes_plan_id, first.plan.plan_id);
    assert.equal(third.plan.supersedes_plan_id, second.plan.plan_id);
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

describe('mission-plans.js — workstream launch', () => {
  let tmpDir;
  let mod;

  beforeEach(async () => {
    tmpDir = createTmpProject();
    mod = await import(missionPlansPath);
  });

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  it('AT-MISSION-PLAN-029: launchWorkstream rejects launch from unapproved plan', () => {
    const mission = writeMission(tmpDir, {
      missionId: 'mission-launch-unapproved',
      title: 'Launch Unapproved',
      goal: 'Reject launch from proposed plan.',
    });

    const created = mod.createPlanArtifact(tmpDir, mission, {
      plannerOutput: validPlannerOutput(),
    });
    assert.equal(created.ok, true);
    assert.equal(created.plan.status, 'proposed');

    const result = mod.launchWorkstream(tmpDir, mission.mission_id, created.plan.plan_id, 'ws-alignment');
    assert.equal(result.ok, false);
    assert.match(result.error, /not approved/i);
  });

  it('AT-MISSION-PLAN-030: launchWorkstream rejects launch for nonexistent workstream', () => {
    const mission = writeMission(tmpDir, {
      missionId: 'mission-launch-bad-ws',
      title: 'Bad Workstream',
      goal: 'Reject nonexistent workstream.',
    });

    const created = mod.createPlanArtifact(tmpDir, mission, {
      plannerOutput: validPlannerOutput(),
    });
    mod.approvePlanArtifact(tmpDir, mission.mission_id, created.plan.plan_id);

    const result = mod.launchWorkstream(tmpDir, mission.mission_id, created.plan.plan_id, 'ws-nonexistent');
    assert.equal(result.ok, false);
    assert.match(result.error, /not found/i);
  });

  it('AT-MISSION-PLAN-031: launchWorkstream rejects launch with unsatisfied dependencies', () => {
    const mission = writeMission(tmpDir, {
      missionId: 'mission-launch-blocked',
      title: 'Blocked Launch',
      goal: 'Reject launch of dependency-blocked workstream.',
    });

    const created = mod.createPlanArtifact(tmpDir, mission, {
      plannerOutput: validPlannerOutput(),
    });
    mod.approvePlanArtifact(tmpDir, mission.mission_id, created.plan.plan_id);

    // ws-verification depends on ws-alignment which hasn't been launched
    const result = mod.launchWorkstream(tmpDir, mission.mission_id, created.plan.plan_id, 'ws-verification');
    assert.equal(result.ok, false);
    assert.match(result.error, /unsatisfied dependencies/i);
    assert.match(result.error, /ws-alignment/);
  });

  it('AT-MISSION-PLAN-032: launchWorkstream records chain linkage for ready workstream', () => {
    const mission = writeMission(tmpDir, {
      missionId: 'mission-launch-ready',
      title: 'Ready Launch',
      goal: 'Launch a no-dependency workstream.',
    });

    const created = mod.createPlanArtifact(tmpDir, mission, {
      plannerOutput: validPlannerOutput(),
    });
    mod.approvePlanArtifact(tmpDir, mission.mission_id, created.plan.plan_id);

    const result = mod.launchWorkstream(tmpDir, mission.mission_id, created.plan.plan_id, 'ws-alignment');
    assert.equal(result.ok, true);
    assert.ok(result.chainId, 'launch must return a chain_id');
    assert.ok(result.chainId.startsWith('chain-'), 'chain_id must start with chain-');
    assert.equal(result.launchRecord.workstream_id, 'ws-alignment');
    assert.equal(result.launchRecord.chain_id, result.chainId);
    assert.equal(result.launchRecord.status, 'launched');

    // Verify plan artifact was updated on disk
    const reloaded = mod.loadPlan(tmpDir, mission.mission_id, created.plan.plan_id);
    assert.equal(reloaded.launch_records.length, 1);
    assert.equal(reloaded.launch_records[0].workstream_id, 'ws-alignment');
    assert.equal(reloaded.launch_records[0].chain_id, result.chainId);
    const ws = reloaded.workstreams.find((w) => w.workstream_id === 'ws-alignment');
    assert.equal(ws.launch_status, 'launched');
  });

  it('AT-MISSION-PLAN-033: launchWorkstream rejects double launch of same workstream', () => {
    const mission = writeMission(tmpDir, {
      missionId: 'mission-launch-double',
      title: 'Double Launch',
      goal: 'Reject duplicate launch.',
    });

    const created = mod.createPlanArtifact(tmpDir, mission, {
      plannerOutput: validPlannerOutput(),
    });
    mod.approvePlanArtifact(tmpDir, mission.mission_id, created.plan.plan_id);

    const first = mod.launchWorkstream(tmpDir, mission.mission_id, created.plan.plan_id, 'ws-alignment');
    assert.equal(first.ok, true);

    const second = mod.launchWorkstream(tmpDir, mission.mission_id, created.plan.plan_id, 'ws-alignment');
    assert.equal(second.ok, false);
    assert.match(second.error, /already been launched/i);
  });

  it('AT-MISSION-PLAN-034: launchWorkstream records chain linkage without mutating the mission artifact first', () => {
    const mission = writeMission(tmpDir, {
      missionId: 'mission-launch-attach',
      title: 'Attach Chain',
      goal: 'Keep launch bookkeeping separate from mission attachment.',
    });

    const created = mod.createPlanArtifact(tmpDir, mission, {
      plannerOutput: validPlannerOutput(),
    });
    mod.approvePlanArtifact(tmpDir, mission.mission_id, created.plan.plan_id);

    const result = mod.launchWorkstream(tmpDir, mission.mission_id, created.plan.plan_id, 'ws-alignment');
    assert.equal(result.ok, true);

    // Mission attachment happens after execution writes a real chain report.
    const missionPath = join(tmpDir, '.agentxchain', 'missions', 'mission-launch-attach.json');
    const missionData = JSON.parse(readFileSync(missionPath, 'utf8'));
    assert.deepEqual(missionData.chain_ids, [], 'launch bookkeeping must not pre-attach a chain without a chain report');
  });
});

describe('mission-plans.js — workstream outcome', () => {
  let tmpDir;
  let mod;

  beforeEach(async () => {
    tmpDir = createTmpProject();
    mod = await import(missionPlansPath);
  });

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  it('AT-MISSION-PLAN-035: markWorkstreamOutcome records completed chain and unblocks dependents', () => {
    const mission = writeMission(tmpDir, {
      missionId: 'mission-outcome-complete',
      title: 'Outcome Complete',
      goal: 'Test completion unblocks dependents.',
    });

    const created = mod.createPlanArtifact(tmpDir, mission, {
      plannerOutput: validPlannerOutput(),
    });
    mod.approvePlanArtifact(tmpDir, mission.mission_id, created.plan.plan_id);

    // Launch the no-dep workstream
    const launched = mod.launchWorkstream(tmpDir, mission.mission_id, created.plan.plan_id, 'ws-alignment');
    assert.equal(launched.ok, true);

    // Write a completed chain report so dependency check can find it
    const reportsDir = join(tmpDir, '.agentxchain', 'reports');
    mkdirSync(reportsDir, { recursive: true });
    writeFileSync(join(reportsDir, `${launched.chainId}.json`), JSON.stringify({
      chain_id: launched.chainId,
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      terminal_reason: 'completed',
      runs: [{ run_id: 'run-001', status: 'completed', turns: 3 }],
    }, null, 2));

    // Mark the outcome
    const outcome = mod.markWorkstreamOutcome(tmpDir, mission.mission_id, created.plan.plan_id, 'ws-alignment', {
      terminalReason: 'completed',
    });
    assert.equal(outcome.ok, true);
    assert.equal(outcome.workstream.launch_status, 'completed');

    // Verify dependent ws-verification is now unblocked
    const reloaded = mod.loadPlan(tmpDir, mission.mission_id, created.plan.plan_id);
    const depWs = reloaded.workstreams.find((w) => w.workstream_id === 'ws-verification');
    assert.equal(depWs.launch_status, 'ready', 'dependent workstream should be unblocked after dependency completes');
  });

  it('AT-MISSION-PLAN-038: dependency satisfaction accepts a successful single-run chain even when the chain terminal reason is chain_limit_reached', () => {
    const mission = writeMission(tmpDir, {
      missionId: 'mission-outcome-success-terminal',
      title: 'Successful Single Run',
      goal: 'Treat completed last-run status as satisfied dependency truth.',
    });

    const created = mod.createPlanArtifact(tmpDir, mission, {
      plannerOutput: validPlannerOutput(),
    });
    mod.approvePlanArtifact(tmpDir, mission.mission_id, created.plan.plan_id);

    const launched = mod.launchWorkstream(tmpDir, mission.mission_id, created.plan.plan_id, 'ws-alignment');
    assert.equal(launched.ok, true);

    writeChainReport(tmpDir, {
      chain_id: launched.chainId,
      started_at: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      terminal_reason: 'chain_limit_reached',
      runs: [{ run_id: 'run-001', status: 'completed', turns: 3 }],
    });

    const reloaded = mod.loadPlan(tmpDir, mission.mission_id, created.plan.plan_id);
    const dependent = reloaded.workstreams.find((w) => w.workstream_id === 'ws-verification');
    assert.deepEqual(mod.checkDependencySatisfaction(reloaded, dependent, tmpDir), []);
  });

  it('AT-MISSION-PLAN-036: markWorkstreamOutcome sets needs_attention on failure', () => {
    const mission = writeMission(tmpDir, {
      missionId: 'mission-outcome-fail',
      title: 'Outcome Fail',
      goal: 'Test failure marks plan needs_attention.',
    });

    const created = mod.createPlanArtifact(tmpDir, mission, {
      plannerOutput: validPlannerOutput(),
    });
    mod.approvePlanArtifact(tmpDir, mission.mission_id, created.plan.plan_id);

    const launched = mod.launchWorkstream(tmpDir, mission.mission_id, created.plan.plan_id, 'ws-alignment');
    assert.equal(launched.ok, true);

    const outcome = mod.markWorkstreamOutcome(tmpDir, mission.mission_id, created.plan.plan_id, 'ws-alignment', {
      terminalReason: 'blocked',
    });
    assert.equal(outcome.ok, true);
    assert.equal(outcome.workstream.launch_status, 'needs_attention');

    // Plan status should be needs_attention
    const reloaded = mod.loadPlan(tmpDir, mission.mission_id, created.plan.plan_id);
    assert.equal(reloaded.status, 'needs_attention');

    // Dependent workstream should remain blocked
    const depWs = reloaded.workstreams.find((w) => w.workstream_id === 'ws-verification');
    assert.equal(depWs.launch_status, 'blocked');
  });

  it('AT-MISSION-PLAN-037: markWorkstreamOutcome rejects outcome for unlaunched workstream', () => {
    const mission = writeMission(tmpDir, {
      missionId: 'mission-outcome-nope',
      title: 'No Launch Record',
      goal: 'Reject outcome without launch.',
    });

    const created = mod.createPlanArtifact(tmpDir, mission, {
      plannerOutput: validPlannerOutput(),
    });
    mod.approvePlanArtifact(tmpDir, mission.mission_id, created.plan.plan_id);

    const outcome = mod.markWorkstreamOutcome(tmpDir, mission.mission_id, created.plan.plan_id, 'ws-alignment', {
      terminalReason: 'completed',
    });
    assert.equal(outcome.ok, false);
    assert.match(outcome.error, /no launch record/i);
  });
});

describe('mission-plans.js — structural guards (launch)', () => {
  it('AT-MISSION-PLAN-S05: mission-plans.js exports launch functions', async () => {
    const mod = await import(missionPlansPath);
    assert.equal(typeof mod.launchWorkstream, 'function');
    assert.equal(typeof mod.markWorkstreamOutcome, 'function');
    assert.equal(typeof mod.checkDependencySatisfaction, 'function');
    assert.equal(typeof mod.didChainFinishSuccessfully, 'function');
  });

  it('AT-MISSION-PLAN-S06: mission.js exports missionPlanLaunchCommand', async () => {
    const mod = await import(missionCommandPath);
    assert.equal(typeof mod.missionPlanLaunchCommand, 'function');
  });

  it('AT-MISSION-PLAN-S07: CLI registers mission plan launch subcommand', () => {
    const bin = readFileSync(binPath, 'utf8');
    assert.ok(bin.includes('missionPlanLaunchCommand'), 'missionPlanLaunchCommand must be imported');
    assert.ok(bin.includes("command('launch"), 'mission plan launch must be registered');
    assert.ok(bin.includes('--workstream'), 'launch must accept --workstream');
    assert.ok(bin.includes('--auto-approve'), 'launch must accept --auto-approve');
  });
});

describe('missionPlanLaunchCommand — execution path', () => {
  let tmpDir;
  let plansMod;
  let missionMod;

  beforeEach(async () => {
    tmpDir = createTmpProject();
    plansMod = await import(missionPlansPath);
    missionMod = await import(missionCommandPath);
  });

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  it('AT-MISSION-PLAN-039: missionPlanLaunchCommand executes a real chain report with the preallocated chain_id and reconciles the plan outcome', async () => {
    const mission = writeMission(tmpDir, {
      missionId: 'mission-launch-command',
      title: 'Launch Command',
      goal: 'Execute the launched workstream through the real chain path.',
    });

    const created = plansMod.createPlanArtifact(tmpDir, mission, {
      plannerOutput: validPlannerOutput(),
    });
    plansMod.approvePlanArtifact(tmpDir, mission.mission_id, created.plan.plan_id);

    let seenOpts = null;
    const fakeExecutor = async (_context, opts) => {
      seenOpts = opts;
      return {
        exitCode: 0,
        result: {
          ok: true,
          stop_reason: 'completed',
          turns_executed: 2,
          state: {
            run_id: 'gov-launch-001',
            provenance: opts.provenance,
          },
        },
      };
    };

    const originalLog = console.log;
    const originalError = console.error;
    console.log = () => {};
    console.error = () => {};
    try {
      await missionMod.missionPlanLaunchCommand('latest', {
        dir: tmpDir,
        mission: mission.mission_id,
        workstream: 'ws-alignment',
        autoApprove: true,
        _log: () => {},
        _executeGovernedRun: fakeExecutor,
      });
    } finally {
      console.log = originalLog;
      console.error = originalError;
    }

    assert.equal(seenOpts.autoApprove, true, 'launch must pass through --auto-approve');

    const reloadedPlan = plansMod.loadPlan(tmpDir, mission.mission_id, created.plan.plan_id);
    const launchRecord = reloadedPlan.launch_records.find((record) => record.workstream_id === 'ws-alignment');
    assert.ok(launchRecord, 'launch record must exist for the executed workstream');
    assert.equal(launchRecord.status, 'completed');

    const ws = reloadedPlan.workstreams.find((workstream) => workstream.workstream_id === 'ws-alignment');
    assert.equal(ws.launch_status, 'completed', 'executed workstream must reconcile to completed');

    const missionPath = join(tmpDir, '.agentxchain', 'missions', `${mission.mission_id}.json`);
    const missionArtifact = JSON.parse(readFileSync(missionPath, 'utf8'));
    assert.deepEqual(missionArtifact.chain_ids, [launchRecord.chain_id], 'mission must attach the emitted chain after execution writes the report');

    const reportPath = join(tmpDir, '.agentxchain', 'reports', `${launchRecord.chain_id}.json`);
    assert.ok(existsSync(reportPath), 'launch execution must write a chain report using the preallocated chain ID');
    const report = JSON.parse(readFileSync(reportPath, 'utf8'));
    assert.equal(report.chain_id, launchRecord.chain_id);
    assert.equal(report.runs[0].run_id, 'gov-launch-001');
  });
});
