import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';

const cliRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const missionCommandPath = join(cliRoot, 'src', 'commands', 'mission.js');
const missionPlansPath = join(cliRoot, 'src', 'lib', 'mission-plans.js');
const binPath = join(cliRoot, 'bin', 'agentxchain.js');

function createTmpProject() {
  const dir = join(tmpdir(), `axc-autopilot-test-${randomUUID().slice(0, 8)}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'agentxchain.json'), JSON.stringify({
    schema_version: '1.0',
    protocol_mode: 'governed',
    template: 'generic',
    project: { name: 'autopilot-test', id: 'ap-001', default_branch: 'main' },
    roles: {
      dev: { title: 'Developer', mandate: 'Implement.', write_authority: 'authoritative', runtime: 'manual-dev' },
    },
    runtimes: { 'manual-dev': { type: 'manual' } },
    routing: { implementation: { entry_role: 'dev', allowed_next_roles: ['dev'], exit_gate: 'done' } },
    gates: { done: {} },
    rules: { challenge_required: false, max_turn_retries: 1 },
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

function writeApprovedPlan(dir, missionId, planId, workstreams) {
  const plansDir = join(dir, '.agentxchain', 'missions', 'plans', missionId);
  mkdirSync(plansDir, { recursive: true });
  const now = new Date().toISOString();
  const plan = {
    plan_id: planId,
    mission_id: missionId,
    status: 'approved',
    supersedes_plan_id: null,
    superseded_by_plan_id: null,
    created_at: now,
    updated_at: now,
    approved_at: now,
    input: { goal: 'Test goal', constraints: [], role_hints: [] },
    planner: { mode: 'test' },
    workstreams,
    launch_records: [],
  };
  writeFileSync(join(plansDir, `${planId}.json`), JSON.stringify(plan, null, 2));
  return plan;
}

function makeWorkstream(id, { dependsOn = [], launchStatus } = {}) {
  return {
    workstream_id: id,
    title: `Workstream ${id}`,
    goal: `Do ${id}`,
    roles: ['dev'],
    phases: ['implementation'],
    depends_on: dependsOn,
    acceptance_checks: [`${id} works`],
    launch_status: launchStatus || (dependsOn.length > 0 ? 'blocked' : 'ready'),
  };
}

function makeMockExecutor(outcomes, seenCalls = []) {
  let callIndex = 0;
  return async (_context, opts) => {
    const outcome = outcomes[Math.min(callIndex, outcomes.length - 1)] || 'completed';
    const runNumber = callIndex + 1;
    seenCalls.push({
      autoApprove: opts.autoApprove,
      provenance: opts.provenance,
    });
    callIndex += 1;
    return {
      exitCode: outcome === 'completed' ? 0 : 1,
      result: {
        ok: outcome === 'completed',
        stop_reason: outcome,
        turns_executed: outcome === 'completed' ? 1 : 0,
        state: {
          run_id: `gov-autopilot-${runNumber}`,
          provenance: opts.provenance,
        },
      },
    };
  };
}

async function runAutopilot(planId, opts) {
  const { missionPlanAutopilotCommand } = await import(missionCommandPath);
  const output = [];
  const errors = [];
  let exitCode = null;

  const originalLog = console.log;
  const originalError = console.error;
  const originalExit = process.exit;

  console.log = (...args) => { output.push(args.join(' ')); };
  console.error = (...args) => { errors.push(args.join(' ')); };
  process.exit = (code) => {
    exitCode = code ?? 0;
    throw new Error('__AUTOPILOT_EXIT__');
  };

  try {
    await missionPlanAutopilotCommand(planId, opts);
  } catch (error) {
    if (error.message !== '__AUTOPILOT_EXIT__') {
      throw error;
    }
  } finally {
    console.log = originalLog;
    console.error = originalError;
    process.exit = originalExit;
  }

  const text = output.join('');
  return {
    exitCode,
    output,
    errors,
    parsed: opts.json && text.trim() ? JSON.parse(text) : null,
  };
}

let tmpDirs = [];
beforeEach(() => { tmpDirs = []; });
afterEach(() => { tmpDirs.forEach((d) => rmSync(d, { recursive: true, force: true })); });

function trackDir(dir) {
  tmpDirs.push(dir);
  return dir;
}

describe('Mission plan autopilot', () => {
  it('AT-AUTOPILOT-001: completes a two-wave dependency plan unattended', async () => {
    const dir = trackDir(createTmpProject());
    const missionId = 'mission-two-wave';
    writeMission(dir, { missionId, title: 'Two Wave', goal: 'Test two waves' });
    writeApprovedPlan(dir, missionId, 'plan-001', [
      makeWorkstream('ws-a'),
      makeWorkstream('ws-b', { dependsOn: ['ws-a'] }),
    ]);

    const seenCalls = [];
    const result = await runAutopilot('plan-001', {
      dir,
      mission: missionId,
      json: true,
      autoApprove: true,
      maxWaves: '5',
      cooldown: '0',
      _sleep: async () => {},
      _log: () => {},
      _executeGovernedRun: makeMockExecutor(['completed', 'completed'], seenCalls),
    });

    assert.equal(result.exitCode, null);
    assert.equal(result.parsed.summary.terminal_reason, 'plan_completed');
    assert.equal(result.parsed.summary.total_waves, 2);
    assert.equal(result.parsed.summary.total_launched, 2);
    assert.equal(result.parsed.summary.completed, 2);
    assert.deepEqual(result.parsed.waves.map((wave) => wave.launched), [['ws-a'], ['ws-b']]);
    assert.equal(seenCalls.length, 2);

    const plansMod = await import(missionPlansPath);
    const persistedPlan = plansMod.loadPlan(dir, missionId, 'plan-001');
    assert.equal(persistedPlan.status, 'completed');
    assert.deepEqual(
      persistedPlan.workstreams.map((ws) => [ws.workstream_id, ws.launch_status]),
      [['ws-a', 'completed'], ['ws-b', 'completed']]
    );
  });

  it('AT-AUTOPILOT-002: stops on the first failing workstream without --continue-on-failure', async () => {
    const dir = trackDir(createTmpProject());
    const missionId = 'mission-failure-stop';
    writeMission(dir, { missionId, title: 'Failure Stop', goal: 'Stop on failure' });
    writeApprovedPlan(dir, missionId, 'plan-stop', [
      makeWorkstream('ws-a'),
      makeWorkstream('ws-b'),
    ]);

    const result = await runAutopilot('plan-stop', {
      dir,
      mission: missionId,
      json: true,
      cooldown: '0',
      _sleep: async () => {},
      _log: () => {},
      _executeGovernedRun: makeMockExecutor(['failed']),
    });

    assert.equal(result.exitCode, 1);
    assert.equal(result.parsed.summary.terminal_reason, 'failure_stopped');
    assert.equal(result.parsed.summary.total_waves, 1);
    assert.equal(result.parsed.summary.total_launched, 1);
    assert.equal(result.parsed.summary.failed, 1);
    assert.equal(result.parsed.waves[0].results[0].status, 'needs_attention');
    assert.equal(result.parsed.waves[0].results[1].status, 'skipped');
    assert.equal(result.parsed.waves[0].results[1].skip_reason, 'prior workstream failed');

    const plansMod = await import(missionPlansPath);
    const persistedPlan = plansMod.loadPlan(dir, missionId, 'plan-stop');
    assert.equal(persistedPlan.status, 'needs_attention');
    assert.equal(persistedPlan.workstreams.find((ws) => ws.workstream_id === 'ws-a').launch_status, 'needs_attention');
    assert.equal(persistedPlan.workstreams.find((ws) => ws.workstream_id === 'ws-b').launch_status, 'ready');
  });

  it('AT-AUTOPILOT-003: continue-on-failure launches independent work and exits plan_incomplete when failures remain', async () => {
    const dir = trackDir(createTmpProject());
    const missionId = 'mission-continue-on-failure';
    writeMission(dir, { missionId, title: 'Continue On Failure', goal: 'Launch independent work anyway' });
    writeApprovedPlan(dir, missionId, 'plan-continue', [
      makeWorkstream('ws-a'),
      makeWorkstream('ws-b', { dependsOn: ['ws-a'] }),
      makeWorkstream('ws-c'),
    ]);

    const result = await runAutopilot('plan-continue', {
      dir,
      mission: missionId,
      json: true,
      continueOnFailure: true,
      cooldown: '0',
      _sleep: async () => {},
      _log: () => {},
      _executeGovernedRun: makeMockExecutor(['failed', 'completed']),
    });

    assert.equal(result.exitCode, 1);
    assert.equal(result.parsed.summary.terminal_reason, 'plan_incomplete');
    assert.equal(result.parsed.summary.total_waves, 1);
    assert.equal(result.parsed.summary.total_launched, 2);
    assert.equal(result.parsed.summary.completed, 1);
    assert.equal(result.parsed.summary.failed, 1);
    assert.deepEqual(result.parsed.waves[0].launched, ['ws-a', 'ws-c']);

    const plansMod = await import(missionPlansPath);
    const persistedPlan = plansMod.loadPlan(dir, missionId, 'plan-continue');
    assert.equal(persistedPlan.status, 'needs_attention');
    assert.equal(persistedPlan.workstreams.find((ws) => ws.workstream_id === 'ws-a').launch_status, 'needs_attention');
    assert.equal(persistedPlan.workstreams.find((ws) => ws.workstream_id === 'ws-b').launch_status, 'blocked');
    assert.equal(persistedPlan.workstreams.find((ws) => ws.workstream_id === 'ws-c').launch_status, 'completed');
  });

  it('AT-AUTOPILOT-004: respects --max-waves even when the next dependency wave becomes ready', async () => {
    const dir = trackDir(createTmpProject());
    const missionId = 'mission-wave-limit';
    writeMission(dir, { missionId, title: 'Wave Limit', goal: 'Stop after first wave' });
    writeApprovedPlan(dir, missionId, 'plan-limit', [
      makeWorkstream('ws-a'),
      makeWorkstream('ws-b', { dependsOn: ['ws-a'] }),
    ]);

    const result = await runAutopilot('plan-limit', {
      dir,
      mission: missionId,
      json: true,
      maxWaves: '1',
      cooldown: '0',
      _sleep: async () => {},
      _log: () => {},
      _executeGovernedRun: makeMockExecutor(['completed']),
    });

    assert.equal(result.exitCode, 1);
    assert.equal(result.parsed.summary.terminal_reason, 'wave_limit_reached');
    assert.equal(result.parsed.summary.total_waves, 1);
    assert.equal(result.parsed.summary.total_launched, 1);
    assert.equal(result.parsed.summary.completed, 1);

    const plansMod = await import(missionPlansPath);
    const persistedPlan = plansMod.loadPlan(dir, missionId, 'plan-limit');
    assert.equal(persistedPlan.status, 'approved');
    assert.equal(persistedPlan.workstreams.find((ws) => ws.workstream_id === 'ws-a').launch_status, 'completed');
    assert.equal(persistedPlan.workstreams.find((ws) => ws.workstream_id === 'ws-b').launch_status, 'ready');
  });

  it('AT-AUTOPILOT-005: exits immediately when the plan is already completed', async () => {
    const dir = trackDir(createTmpProject());
    const missionId = 'mission-already-done';
    writeMission(dir, { missionId, title: 'Done', goal: 'Already done' });
    writeApprovedPlan(dir, missionId, 'plan-done', [
      makeWorkstream('ws-a', { launchStatus: 'completed' }),
    ]);

    const planPath = join(dir, '.agentxchain', 'missions', 'plans', missionId, 'plan-done.json');
    const parsedPlan = JSON.parse(readFileSync(planPath, 'utf8'));
    parsedPlan.status = 'completed';
    writeFileSync(planPath, JSON.stringify(parsedPlan, null, 2));

    const result = await runAutopilot('plan-done', {
      dir,
      mission: missionId,
      json: true,
      _sleep: async () => {},
    });

    assert.equal(result.exitCode, null);
    assert.equal(result.parsed.summary.terminal_reason, 'plan_completed');
    assert.equal(result.parsed.summary.total_waves, 0);
    assert.equal(result.parsed.summary.total_launched, 0);
  });

  it('AT-AUTOPILOT-006: detects deadlock when all remaining workstreams are blocked', async () => {
    const dir = trackDir(createTmpProject());
    const missionId = 'mission-deadlock';
    writeMission(dir, { missionId, title: 'Deadlock', goal: 'Circular deps' });
    writeApprovedPlan(dir, missionId, 'plan-dead', [
      makeWorkstream('ws-a', { dependsOn: ['ws-b'] }),
      makeWorkstream('ws-b', { dependsOn: ['ws-a'] }),
    ]);

    const result = await runAutopilot('plan-dead', {
      dir,
      mission: missionId,
      json: true,
      _sleep: async () => {},
    });

    assert.equal(result.exitCode, 1);
    assert.equal(result.parsed.summary.terminal_reason, 'deadlock');
    assert.equal(result.parsed.summary.total_waves, 0);
    assert.equal(result.parsed.summary.total_launched, 0);
  });

  it('AT-AUTOPILOT-007: JSON output includes wave structure with launch and result entries', async () => {
    const dir = trackDir(createTmpProject());
    const missionId = 'mission-json';
    writeMission(dir, { missionId, title: 'JSON', goal: 'Emit wave JSON' });
    writeApprovedPlan(dir, missionId, 'plan-json', [
      makeWorkstream('ws-a'),
    ]);

    const result = await runAutopilot('plan-json', {
      dir,
      mission: missionId,
      json: true,
      cooldown: '0',
      _sleep: async () => {},
      _log: () => {},
      _executeGovernedRun: makeMockExecutor(['completed']),
    });

    assert.equal(result.exitCode, null);
    assert.equal(result.parsed.waves.length, 1);
    assert.deepEqual(result.parsed.waves[0].launched, ['ws-a']);
    assert.deepEqual(result.parsed.waves[0].results[0], {
      workstream_id: 'ws-a',
      chain_id: result.parsed.waves[0].results[0].chain_id,
      status: 'completed',
    });
    assert.match(result.parsed.waves[0].results[0].chain_id, /^chain-/);
  });

  it('AT-AUTOPILOT-008: executor provenance records the autopilot trigger and wave number', async () => {
    const dir = trackDir(createTmpProject());
    const missionId = 'mission-provenance';
    writeMission(dir, { missionId, title: 'Provenance', goal: 'Check trigger metadata' });
    writeApprovedPlan(dir, missionId, 'plan-prov', [
      makeWorkstream('ws-a'),
      makeWorkstream('ws-b', { dependsOn: ['ws-a'] }),
    ]);

    const seenCalls = [];
    const result = await runAutopilot('plan-prov', {
      dir,
      mission: missionId,
      json: true,
      autoApprove: true,
      cooldown: '0',
      _sleep: async () => {},
      _log: () => {},
      _executeGovernedRun: makeMockExecutor(['completed', 'completed'], seenCalls),
    });

    assert.equal(result.exitCode, null);
    assert.equal(seenCalls.length, 2);
    assert.deepEqual(
      seenCalls.map((call) => call.provenance.trigger_reason),
      [
        `mission:${missionId} workstream:ws-a autopilot:wave-1`,
        `mission:${missionId} workstream:ws-b autopilot:wave-2`,
      ]
    );
    assert.ok(seenCalls.every((call) => call.autoApprove === true));
    assert.ok(seenCalls.every((call) => call.provenance.trigger === 'autopilot'));
    assert.ok(seenCalls.every((call) => call.provenance.created_by === 'operator'));
  });

  it('AT-AUTOPILOT-009: CLI registration includes the autopilot surface and flags', () => {
    const binContent = readFileSync(binPath, 'utf8');
    assert.ok(binContent.includes('missionPlanAutopilotCommand'), 'autopilot command import exists');
    assert.ok(binContent.includes("'autopilot [plan_id]'"), 'autopilot subcommand registered');
    assert.ok(binContent.includes('--max-waves'), '--max-waves option registered');
    assert.ok(binContent.includes('--continue-on-failure'), '--continue-on-failure option registered');
    assert.ok(binContent.includes('--auto-retry'), '--auto-retry option registered');
    assert.ok(binContent.includes('--max-retries'), '--max-retries option registered');
    assert.ok(binContent.includes('--cooldown'), '--cooldown option registered');
  });

  it('AT-AUTOPILOT-010: single-repo autopilot rejects coordinator-only --auto-retry', async () => {
    const dir = trackDir(createTmpProject());
    const missionId = 'mission-auto-retry-guard';
    writeMission(dir, { missionId, title: 'Guard', goal: 'Reject coordinator-only flag' });
    writeApprovedPlan(dir, missionId, 'plan-guard', [makeWorkstream('ws-a')]);

    const result = await runAutopilot('plan-guard', {
      dir,
      mission: missionId,
      json: true,
      autoRetry: true,
      _sleep: async () => {},
    });

    assert.equal(result.exitCode, 1);
    assert.match(result.errors.join('\n'), /--auto-retry is only supported for coordinator-bound missions/);
  });
});

describe('Autopilot structural guards', () => {
  it('S11: missionPlanAutopilotCommand is exported', async () => {
    const mod = await import(missionCommandPath);
    assert.equal(typeof mod.missionPlanAutopilotCommand, 'function');
  });

  it('S12: spec file exists', () => {
    const specPath = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '.planning', 'MISSION_AUTOPILOT_SPEC.md');
    assert.ok(existsSync(specPath), 'MISSION_AUTOPILOT_SPEC.md exists');
  });
});
