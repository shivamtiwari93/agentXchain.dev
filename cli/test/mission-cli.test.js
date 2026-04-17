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
});
