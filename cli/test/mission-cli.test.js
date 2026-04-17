import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { execFileSync } from 'child_process';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';

const cliRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const binPath = join(cliRoot, 'bin', 'agentxchain.js');
const missionCommandPath = join(cliRoot, 'src', 'commands', 'mission.js');

function createTmpProject() {
  const dir = join(tmpdir(), `axc-mission-test-${randomUUID().slice(0, 8)}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'agentxchain.json'), JSON.stringify({
    version: 4,
    project: { name: 'mission-test', id: 'mission-001' },
    roles: { dev: { agent: 'manual' } },
    workflow: { phases: ['implementation'] },
  }, null, 2));
  return dir;
}

function writeChainReport(dir, report) {
  const reportsDir = join(dir, '.agentxchain', 'reports');
  mkdirSync(reportsDir, { recursive: true });
  writeFileSync(join(reportsDir, `${report.chain_id}.json`), JSON.stringify(report, null, 2));
}

function writePlanArtifact(dir, missionId, plan) {
  const plansDir = join(dir, '.agentxchain', 'missions', 'plans', missionId);
  mkdirSync(plansDir, { recursive: true });
  writeFileSync(join(plansDir, `${plan.plan_id}.json`), JSON.stringify(plan, null, 2));
}

function writePlannerOutputFile(dir, plannerOutput) {
  const filePath = join(dir, `planner-output-${randomUUID().slice(0, 8)}.json`);
  writeFileSync(filePath, JSON.stringify(plannerOutput, null, 2));
  return filePath;
}

function appendRepoDecision(dir, decision) {
  const decisionsPath = join(dir, '.agentxchain', 'repo-decisions.jsonl');
  mkdirSync(join(dir, '.agentxchain'), { recursive: true });
  writeFileSync(decisionsPath, `${JSON.stringify(decision)}\n`, { flag: 'a' });
}

function makeChainReport(overrides = {}) {
  const chainId = `chain-${randomUUID().slice(0, 8)}`;
  return {
    chain_id: chainId,
    started_at: new Date(Date.now() - 60000).toISOString(),
    completed_at: new Date().toISOString(),
    terminal_reason: 'chain_limit_reached',
    total_turns: 6,
    total_duration_ms: 45000,
    runs: [
      { run_id: `gov-${randomUUID().slice(0, 8)}`, status: 'completed', turns: 3 },
      { run_id: `gov-${randomUUID().slice(0, 8)}`, status: 'completed', turns: 3 },
    ],
    ...overrides,
  };
}

function runCli(args, dir) {
  return execFileSync(process.execPath, [binPath, ...args], {
    cwd: dir,
    encoding: 'utf8',
    timeout: 10000,
    env: { ...process.env, NODE_NO_WARNINGS: '1' },
  });
}

describe('mission CLI — structural guards', () => {
  it('AT-MISSION-CLI-001: mission.js command module exists and CLI registers the family', async () => {
    assert.ok(existsSync(missionCommandPath), 'mission.js must exist');
    const mod = await import(missionCommandPath);
    assert.equal(typeof mod.missionStartCommand, 'function');
    assert.equal(typeof mod.missionListCommand, 'function');
    assert.equal(typeof mod.missionShowCommand, 'function');
    assert.equal(typeof mod.missionAttachChainCommand, 'function');

    const bin = readFileSync(binPath, 'utf8');
    assert.ok(bin.includes("command('mission')"), 'mission parent command must be registered');
    assert.ok(bin.includes("command('start')"), 'mission start must be registered');
    assert.ok(bin.includes("command('list')"), 'mission list must be registered');
    assert.ok(bin.includes("command('show"), 'mission show must be registered');
    assert.ok(bin.includes("command('attach-chain"), 'mission attach-chain must be registered');
    assert.ok(bin.includes('--plan'), 'mission start must expose --plan');
    assert.ok(bin.includes('--planner-output-file <path>'), 'mission planning must expose --planner-output-file');
  });
});

describe('mission CLI behavior', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTmpProject();
  });

  afterEach(() => {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  it('AT-MISSION-CLI-002: mission start creates a durable mission artifact with normalized ID', () => {
    const output = runCli([
      'mission',
      'start',
      '--title', 'Governed Release Hardening',
      '--goal', 'Unify release truth',
      '--json',
      '-d', tmpDir,
    ], tmpDir);

    const parsed = JSON.parse(output);
    assert.equal(parsed.mission_id, 'mission-governed-release-hardening');
    assert.equal(parsed.goal, 'Unify release truth');
    assert.equal(parsed.chain_count, 0);
    assert.equal(parsed.derived_status, 'planned');
  });

  it('AT-MISSION-CLI-003: mission show without an ID resolves the latest mission and renders aggregate counts', () => {
    runCli([
      'mission',
      'start',
      '--title', 'First Mission',
      '--goal', 'Goal one',
      '-d', tmpDir,
    ], tmpDir);

    writeChainReport(tmpDir, makeChainReport({ chain_id: 'chain-one', total_turns: 7 }));
    runCli(['mission', 'attach-chain', 'chain-one', '-d', tmpDir], tmpDir);

    runCli([
      'mission',
      'start',
      '--title', 'Second Mission',
      '--goal', 'Goal two',
      '-d', tmpDir,
    ], tmpDir);

    const output = runCli(['mission', 'show', '-d', tmpDir], tmpDir);
    assert.match(output, /Mission: mission-second-mission/);
    assert.match(output, /Status:\s+planned/);
    assert.match(output, /Chains:\s+0/);
  });

  it('AT-MISSION-CLI-004: mission attach-chain latest binds the newest chain and derives totals', () => {
    runCli([
      'mission',
      'start',
      '--title', 'Chain Binding',
      '--goal', 'Track chained runs',
      '-d', tmpDir,
    ], tmpDir);

    writeChainReport(tmpDir, makeChainReport({
      chain_id: 'chain-older',
      started_at: new Date(Date.now() - 120000).toISOString(),
      total_turns: 4,
      runs: [{ status: 'completed' }],
    }));
    writeChainReport(tmpDir, makeChainReport({
      chain_id: 'chain-newer',
      started_at: new Date(Date.now() - 10000).toISOString(),
      total_turns: 9,
      runs: [{ status: 'completed' }, { status: 'completed' }, { status: 'completed' }],
    }));

    const output = runCli(['mission', 'attach-chain', 'latest', '--json', '-d', tmpDir], tmpDir);
    const parsed = JSON.parse(output);
    assert.equal(parsed.latest_chain_id, 'chain-newer');
    assert.equal(parsed.total_turns, 9);
    assert.equal(parsed.total_runs, 3);
    assert.equal(parsed.derived_status, 'progressing');
  });

  it('AT-MISSION-CLI-005: mission summaries include active repo-decision count for cross-chain carryover visibility', () => {
    runCli([
      'mission',
      'start',
      '--title', 'Decision Carryover',
      '--goal', 'Keep repo decisions visible',
      '-d', tmpDir,
    ], tmpDir);
    writeChainReport(tmpDir, makeChainReport({ chain_id: 'chain-decisions' }));
    appendRepoDecision(tmpDir, {
      id: 'DEC-900',
      category: 'governance',
      statement: 'Keep release alignment manifest-driven.',
      role: 'dev',
      status: 'active',
      durability: 'repo',
    });

    const output = runCli(['mission', 'attach-chain', 'chain-decisions', '-d', tmpDir], tmpDir);
    assert.match(output, /Active repo decisions:\s+1/);
  });

  it('AT-MISSION-CLI-006: mission list sorts newest-first by updated_at', () => {
    runCli([
      'mission',
      'start',
      '--title', 'Older Mission',
      '--goal', 'Older goal',
      '-d', tmpDir,
    ], tmpDir);
    writeChainReport(tmpDir, makeChainReport({ chain_id: 'chain-old' }));
    runCli(['mission', 'attach-chain', 'chain-old', '-d', tmpDir], tmpDir);

    runCli([
      'mission',
      'start',
      '--title', 'Newer Mission',
      '--goal', 'Newer goal',
      '-d', tmpDir,
    ], tmpDir);

    const output = runCli(['mission', 'list', '-d', tmpDir], tmpDir);
    const newerPos = output.indexOf('mission-newer-mission');
    const olderPos = output.indexOf('mission-older-mission');
    assert.ok(newerPos >= 0 && olderPos >= 0 && newerPos < olderPos, 'newest mission should render first');
  });

  it('AT-MISSION-CLI-007: mission plan approve approves the latest proposed plan', () => {
    runCli([
      'mission',
      'start',
      '--title', 'Plan Approval',
      '--goal', 'Approve a proposed plan',
      '-d', tmpDir,
    ], tmpDir);

    writePlanArtifact(tmpDir, 'mission-plan-approval', {
      plan_id: 'plan-2026-04-16T21-00-00Z-a',
      mission_id: 'mission-plan-approval',
      status: 'proposed',
      supersedes_plan_id: null,
      created_at: '2026-04-16T21:00:00.000Z',
      updated_at: '2026-04-16T21:00:00.000Z',
      input: { goal: 'Approve a proposed plan', constraints: [], role_hints: [] },
      planner: { mode: 'llm_one_shot', model: 'test' },
      workstreams: [],
      launch_records: [],
    });

    const output = runCli(['mission', 'plan', 'approve', 'latest', '-d', tmpDir], tmpDir);
    assert.match(output, /Approved plan plan-2026-04-16T21-00-00Z-a/);
    assert.match(output, /Status:\s+approved/);
  });

  it('AT-MISSION-CLI-008: mission plan approve rejects an older superseded plan', () => {
    runCli([
      'mission',
      'start',
      '--title', 'Superseded Approval',
      '--goal', 'Reject stale plan approval',
      '-d', tmpDir,
    ], tmpDir);

    writePlanArtifact(tmpDir, 'mission-superseded-approval', {
      plan_id: 'plan-older',
      mission_id: 'mission-superseded-approval',
      status: 'proposed',
      supersedes_plan_id: null,
      created_at: '2026-04-16T21:00:00.000Z',
      updated_at: '2026-04-16T21:00:00.000Z',
      input: { goal: 'Reject stale plan approval', constraints: [], role_hints: [] },
      planner: { mode: 'llm_one_shot', model: 'test' },
      workstreams: [],
      launch_records: [],
    });
    writePlanArtifact(tmpDir, 'mission-superseded-approval', {
      plan_id: 'plan-newer',
      mission_id: 'mission-superseded-approval',
      status: 'proposed',
      supersedes_plan_id: 'plan-older',
      created_at: '2026-04-16T22:00:00.000Z',
      updated_at: '2026-04-16T22:00:00.000Z',
      input: { goal: 'Reject stale plan approval', constraints: [], role_hints: [] },
      planner: { mode: 'llm_one_shot', model: 'test' },
      workstreams: [],
      launch_records: [],
    });

    assert.throws(
      () => runCli(['mission', 'plan', 'approve', 'plan-older', '-d', tmpDir], tmpDir),
      /superseded by newer plan/i
    );
  });

  it('AT-MISSION-CLI-009: mission start --plan creates mission and proposed plan from planner-output-file JSON', () => {
    const plannerOutputPath = writePlannerOutputFile(tmpDir, {
      workstreams: [
        {
          workstream_id: 'ws-plan',
          title: 'Plan release hardening',
          goal: 'Create the first proposed plan.',
          roles: ['pm', 'dev'],
          phases: ['planning', 'implementation'],
          depends_on: [],
          acceptance_checks: ['Plan artifact is created'],
        },
      ],
    });

    const output = runCli([
      'mission',
      'start',
      '--title', 'Auto Plan Mission',
      '--goal', 'Create mission and plan together',
      '--plan',
      '--planner-output-file', plannerOutputPath,
      '--json',
      '-d', tmpDir,
    ], tmpDir);

    const parsed = JSON.parse(output);
    assert.equal(parsed.mission.mission_id, 'mission-auto-plan-mission');
    assert.equal(parsed.plan.mission_id, 'mission-auto-plan-mission');
    assert.equal(parsed.plan.status, 'proposed');
    assert.equal(parsed.plan.workstreams.length, 1);

    const planDir = join(tmpDir, '.agentxchain', 'missions', 'plans', 'mission-auto-plan-mission');
    const planFiles = existsSync(planDir) ? readFileSync(join(planDir, `${parsed.plan.plan_id}.json`), 'utf8') : null;
    assert.ok(planFiles, 'mission start --plan must write a durable plan artifact');
  });

  it('AT-MISSION-CLI-010: mission start --plan forwards constraints and role hints into plan input', () => {
    const plannerOutputPath = writePlannerOutputFile(tmpDir, {
      workstreams: [
        {
          workstream_id: 'ws-proof',
          title: 'Generate proof',
          goal: 'Preserve planner metadata in the artifact.',
          roles: ['dev', 'qa'],
          phases: ['implementation', 'qa'],
          depends_on: [],
          acceptance_checks: ['Constraints and role hints are preserved'],
        },
      ],
    });

    const output = runCli([
      'mission',
      'start',
      '--title', 'Forward Planner Inputs',
      '--goal', 'Keep planner inputs visible',
      '--plan',
      '--constraint', 'Keep releases idempotent',
      '--constraint', 'Do not mutate protocol',
      '--role-hint', 'dev',
      '--role-hint', 'qa',
      '--planner-output-file', plannerOutputPath,
      '--json',
      '-d', tmpDir,
    ], tmpDir);

    const parsed = JSON.parse(output);
    assert.deepEqual(parsed.plan.input.constraints, ['Keep releases idempotent', 'Do not mutate protocol']);
    assert.deepEqual(parsed.plan.input.role_hints, ['dev', 'qa']);
    assert.equal(parsed.plan.status, 'proposed');
  });

  it('AT-MISSION-CLI-011: mission show surfaces the latest plan summary with completion and workstream counts', () => {
    runCli([
      'mission',
      'start',
      '--title', 'Mission Summary',
      '--goal', 'Show plan health in one command',
      '-d', tmpDir,
    ], tmpDir);

    writePlanArtifact(tmpDir, 'mission-summary', {
      plan_id: 'plan-older-summary',
      mission_id: 'mission-summary',
      status: 'approved',
      supersedes_plan_id: null,
      created_at: '2026-04-17T10:00:00.000Z',
      updated_at: '2026-04-17T10:00:00.000Z',
      input: { goal: 'Show plan health in one command', constraints: [], role_hints: [] },
      planner: { mode: 'llm_one_shot', model: 'test' },
      workstreams: [
        { workstream_id: 'ws-old', title: 'Older', goal: 'Old', roles: ['dev'], phases: ['implementation'], depends_on: [], acceptance_checks: [], launch_status: 'completed' },
      ],
      launch_records: [],
    });

    writePlanArtifact(tmpDir, 'mission-summary', {
      plan_id: 'plan-newer-summary',
      mission_id: 'mission-summary',
      status: 'needs_attention',
      supersedes_plan_id: 'plan-older-summary',
      created_at: '2026-04-17T11:00:00.000Z',
      updated_at: '2026-04-17T11:15:00.000Z',
      input: { goal: 'Show plan health in one command', constraints: [], role_hints: [] },
      planner: { mode: 'llm_one_shot', model: 'test' },
      workstreams: [
        { workstream_id: 'ws-ready', title: 'Ready', goal: 'Ready', roles: ['dev'], phases: ['implementation'], depends_on: [], acceptance_checks: [], launch_status: 'ready' },
        { workstream_id: 'ws-blocked', title: 'Blocked', goal: 'Blocked', roles: ['qa'], phases: ['qa'], depends_on: ['ws-ready'], acceptance_checks: [], launch_status: 'blocked' },
        { workstream_id: 'ws-complete', title: 'Complete', goal: 'Complete', roles: ['dev'], phases: ['implementation'], depends_on: [], acceptance_checks: [], launch_status: 'completed' },
        { workstream_id: 'ws-failed', title: 'Failed', goal: 'Failed', roles: ['dev'], phases: ['implementation'], depends_on: [], acceptance_checks: [], launch_status: 'needs_attention' },
      ],
      launch_records: [],
    });

    const output = runCli(['mission', 'show', 'mission-summary', '-d', tmpDir], tmpDir);
    assert.match(output, /Latest plan:/);
    assert.match(output, /Plan ID:\s+plan-newer-summary/);
    assert.match(output, /Status:\s+needs_attention/);
    assert.match(output, /Completion:\s+25% \(1\/4 completed\)/);
    assert.match(output, /Workstream summary:\s+ready 1, blocked 1, launched 0, completed 1, needs_attention 1/);
  });

  it('AT-MISSION-CLI-012: mission show --json includes latest plan summary for machine-readable mission health', () => {
    runCli([
      'mission',
      'start',
      '--title', 'Mission Json Summary',
      '--goal', 'Return latest plan health in JSON',
      '-d', tmpDir,
    ], tmpDir);

    writePlanArtifact(tmpDir, 'mission-json-summary', {
      plan_id: 'plan-json-summary',
      mission_id: 'mission-json-summary',
      status: 'completed',
      supersedes_plan_id: null,
      created_at: '2026-04-17T12:00:00.000Z',
      updated_at: '2026-04-17T12:20:00.000Z',
      approved_at: '2026-04-17T12:05:00.000Z',
      input: { goal: 'Return latest plan health in JSON', constraints: [], role_hints: [] },
      planner: { mode: 'llm_one_shot', model: 'test' },
      workstreams: [
        { workstream_id: 'ws-a', title: 'A', goal: 'A', roles: ['dev'], phases: ['implementation'], depends_on: [], acceptance_checks: [], launch_status: 'completed' },
        { workstream_id: 'ws-b', title: 'B', goal: 'B', roles: ['qa'], phases: ['qa'], depends_on: ['ws-a'], acceptance_checks: [], launch_status: 'completed' },
      ],
      launch_records: [
        { workstream_id: 'ws-a', chain_id: 'chain-a', launched_at: '2026-04-17T12:05:00.000Z', completed_at: '2026-04-17T12:10:00.000Z', status: 'completed', terminal_reason: 'completed' },
        { workstream_id: 'ws-b', chain_id: 'chain-b', launched_at: '2026-04-17T12:11:00.000Z', completed_at: '2026-04-17T12:20:00.000Z', status: 'completed', terminal_reason: 'completed' },
      ],
    });

    const output = runCli(['mission', 'show', 'mission-json-summary', '--json', '-d', tmpDir], tmpDir);
    const parsed = JSON.parse(output);

    assert.equal(parsed.latest_plan.plan_id, 'plan-json-summary');
    assert.equal(parsed.latest_plan.status, 'completed');
    assert.equal(parsed.latest_plan.workstream_count, 2);
    assert.equal(parsed.latest_plan.launch_record_count, 2);
    assert.equal(parsed.latest_plan.completed_count, 2);
    assert.equal(parsed.latest_plan.ready_count, 0);
    assert.equal(parsed.latest_plan.needs_attention_count, 0);
    assert.equal(parsed.latest_plan.completion_percentage, 100);
  });
});
