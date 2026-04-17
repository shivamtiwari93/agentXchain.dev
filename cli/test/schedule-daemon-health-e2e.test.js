import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { scaffoldGoverned } from '../src/commands/init.js';

const cliRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI_BIN = join(cliRoot, 'bin', 'agentxchain.js');
const MOCK_AGENT = join(cliRoot, 'test-support', 'mock-agent.mjs');
const tempDirs = [];

function makeProject({ schedules, mockAgentPath = MOCK_AGENT } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'axc-sdh-e2e-'));
  tempDirs.push(root);
  scaffoldGoverned(root, 'SDH E2E', `sdh-e2e-${Date.now()}`);

  const configPath = join(root, 'agentxchain.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  const mockRuntime = {
    type: 'local_cli',
    command: process.execPath,
    args: [mockAgentPath],
    prompt_transport: 'dispatch_bundle_only',
  };

  for (const runtimeId of Object.keys(config.runtimes || {})) {
    config.runtimes[runtimeId] = { ...mockRuntime };
  }
  for (const role of Object.values(config.roles || {})) {
    role.write_authority = 'authoritative';
  }

  config.schedules = schedules || {
    health_check: {
      every_minutes: 60,
      auto_approve: true,
      max_turns: 3,
      initial_role: 'pm',
    },
  };

  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
  return root;
}

function writeCostedMockAgent(root, usdPerTurn) {
  const scriptPath = join(root, 'costed-mock-agent.mjs');
  const source = readFileSync(MOCK_AGENT, 'utf8').replace(
    /usd:\s*0\b/,
    `usd: ${usdPerTurn}`,
  );
  writeFileSync(scriptPath, source);
  return scriptPath;
}

function runCli(root, args, opts = {}) {
  const result = spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout: opts.timeout || 60000,
    env: { ...process.env, NO_COLOR: '1', NODE_NO_WARNINGS: '1' },
  });

  return {
    status: result.status ?? 1,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    combined: `${result.stdout || ''}${result.stderr || ''}`,
  };
}

function writeVision(root, content) {
  const planningDir = join(root, '.planning');
  mkdirSync(planningDir, { recursive: true });
  writeFileSync(join(planningDir, 'VISION.md'), content);
}

afterEach(() => {
  for (const dir of tempDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {}
  }
  tempDirs.length = 0;
});

describe('AT-SDH-001: schedule daemon --max-cycles 1 creates daemon state file', () => {
  it('creates .agentxchain/schedule-daemon.json', () => {
    const root = makeProject();
    const r = runCli(root, ['schedule', 'daemon', '--max-cycles', '1', '--json']);
    assert.equal(r.status, 0, `daemon failed: ${r.combined}`);

    const daemonPath = join(root, '.agentxchain', 'schedule-daemon.json');
    assert.ok(existsSync(daemonPath), 'schedule-daemon.json must exist after daemon run');
  });
});

describe('AT-SDH-002: daemon state records pid, started_at, last_heartbeat_at, poll_seconds', () => {
  it('has required fields', () => {
    const root = makeProject();
    runCli(root, ['schedule', 'daemon', '--max-cycles', '1', '--poll-seconds', '5', '--json']);

    const state = JSON.parse(readFileSync(join(root, '.agentxchain', 'schedule-daemon.json'), 'utf8'));
    assert.equal(state.schema_version, '0.1');
    assert.equal(typeof state.pid, 'number');
    assert.ok(state.pid > 0, 'pid must be positive');
    assert.ok(state.started_at, 'started_at must exist');
    assert.ok(state.last_heartbeat_at, 'last_heartbeat_at must exist');
    assert.equal(state.poll_seconds, 5);
    assert.equal(state.last_cycle_result, 'ok');
  });
});

describe('AT-SDH-003: schedule status --json reports running after daemon cycle', () => {
  it('reports running status', () => {
    const root = makeProject();
    // Run daemon for 1 cycle first
    const daemon = runCli(root, ['schedule', 'daemon', '--max-cycles', '1', '--json']);
    assert.equal(daemon.status, 0, `daemon failed: ${daemon.combined}`);

    // Now check status
    const status = runCli(root, ['schedule', 'status', '--json']);
    assert.equal(status.status, 0, `status failed: ${status.combined}`);

    const parsed = JSON.parse(status.stdout.trim());
    assert.equal(parsed.ok, true);
    assert.equal(parsed.daemon.status, 'running');
    assert.equal(typeof parsed.daemon.pid, 'number');
    assert.ok(parsed.daemon.started_at);
    assert.ok(parsed.daemon.last_heartbeat_at);
    assert.equal(parsed.daemon.last_cycle_result, 'ok');
    assert.equal(typeof parsed.daemon.poll_seconds, 'number');
    assert.equal(typeof parsed.daemon.stale_after_seconds, 'number');
  });
});

describe('AT-SDH-004: schedule status --json reports never_started when no state file', () => {
  it('reports never_started status', () => {
    const root = makeProject();
    // Do not run daemon, just check status
    const status = runCli(root, ['schedule', 'status', '--json']);
    assert.equal(status.status, 0, `status failed: ${status.combined}`);

    const parsed = JSON.parse(status.stdout.trim());
    assert.equal(parsed.daemon.status, 'never_started');
  });
});

describe('AT-SDH-005: stale heartbeat reports stale, not running', () => {
  it('reports stale when heartbeat is old', () => {
    const root = makeProject();
    // Write a daemon state with an old heartbeat
    const daemonDir = join(root, '.agentxchain');
    mkdirSync(daemonDir, { recursive: true });
    const oldState = {
      schema_version: '0.1',
      pid: 99999,
      started_at: '2020-01-01T00:00:00.000Z',
      last_heartbeat_at: '2020-01-01T00:00:00.000Z',
      last_cycle_started_at: '2020-01-01T00:00:00.000Z',
      last_cycle_finished_at: '2020-01-01T00:00:01.000Z',
      last_cycle_result: 'ok',
      poll_seconds: 60,
      schedule_id: null,
      max_cycles: null,
      last_error: null,
    };
    writeFileSync(join(daemonDir, 'schedule-daemon.json'), JSON.stringify(oldState));

    const status = runCli(root, ['schedule', 'status', '--json']);
    assert.equal(status.status, 0, `status failed: ${status.combined}`);

    const parsed = JSON.parse(status.stdout.trim());
    assert.equal(parsed.daemon.status, 'stale');
  });
});

describe('AT-SDH-006: malformed state file is handled gracefully', () => {
  it('does not crash on malformed state', () => {
    const root = makeProject();
    const daemonDir = join(root, '.agentxchain');
    mkdirSync(daemonDir, { recursive: true });
    writeFileSync(join(daemonDir, 'schedule-daemon.json'), 'not valid json{{{');

    const status = runCli(root, ['schedule', 'status', '--json']);
    assert.equal(status.status, 0, `status crashed: ${status.combined}`);

    const parsed = JSON.parse(status.stdout.trim());
    assert.equal(parsed.daemon.status, 'not_running');
  });
});

describe('AT-SDH-007: schedule-daemon.json classified as orchestrator-owned state and in export/restore roots', () => {
  it('is in repo-observer ORCHESTRATOR_STATE_FILES', () => {
    const observerSrc = readFileSync(join(cliRoot, 'src', 'lib', 'repo-observer.js'), 'utf8');
    assert.match(observerSrc, /schedule-daemon\.json/);
  });

  it('is in export RUN_EXPORT_INCLUDED_ROOTS and RUN_RESTORE_ROOTS', () => {
    const exportSrc = readFileSync(join(cliRoot, 'src', 'lib', 'export.js'), 'utf8');
    const exportRootsMatch = exportSrc.match(/RUN_EXPORT_INCLUDED_ROOTS\s*=\s*\[([\s\S]*?)\];/);
    const restoreRootsMatch = exportSrc.match(/RUN_RESTORE_ROOTS\s*=\s*\[([\s\S]*?)\];/);
    assert.ok(exportRootsMatch, 'RUN_EXPORT_INCLUDED_ROOTS not found');
    assert.ok(restoreRootsMatch, 'RUN_RESTORE_ROOTS not found');
    assert.match(exportRootsMatch[1], /schedule-daemon\.json/);
    assert.match(restoreRootsMatch[1], /schedule-daemon\.json/);
  });
});

describe('schedule status human-readable output', () => {
  it('prints human-readable status without --json', () => {
    const root = makeProject();
    runCli(root, ['schedule', 'daemon', '--max-cycles', '1', '--json']);

    const status = runCli(root, ['schedule', 'status']);
    assert.equal(status.status, 0, `status failed: ${status.combined}`);
    assert.match(status.stdout, /Schedule Daemon Status/i);
    assert.match(status.stdout, /running/i);
  });
});

describe('AT-SDH-008: daemon selects a due continuous schedule instead of the first configured non-due entry', () => {
  it('starts the due schedule-owned continuous session', () => {
    const root = makeProject({
      schedules: {
        alpha: {
          every_minutes: 60,
          auto_approve: true,
          max_turns: 5,
          initial_role: 'pm',
          continuous: {
            enabled: true,
            vision_path: '.planning/VISION.md',
            max_runs: 2,
            max_idle_cycles: 3,
            triage_approval: 'auto',
          },
        },
        beta: {
          every_minutes: 60,
          auto_approve: true,
          max_turns: 5,
          initial_role: 'pm',
          continuous: {
            enabled: true,
            vision_path: '.planning/VISION.md',
            max_runs: 2,
            max_idle_cycles: 3,
            triage_approval: 'auto',
          },
        },
      },
    });

    writeVision(root, '# Vision\n\n## Goals\n\n- Build the beta path\n');
    writeFileSync(join(root, '.agentxchain', 'schedule-state.json'), JSON.stringify({
      schema_version: '0.1',
      schedules: {
        alpha: {
          last_started_at: new Date().toISOString(),
          last_finished_at: new Date().toISOString(),
          last_run_id: 'run_alpha_recent',
          last_status: 'continuous_running',
          last_skip_at: null,
          last_skip_reason: null,
        },
      },
    }, null, 2));

    const daemon = runCli(root, ['schedule', 'daemon', '--max-cycles', '1', '--json'], { timeout: 120000 });
    assert.equal(daemon.status, 0, `daemon failed: ${daemon.combined}`);

    const session = JSON.parse(readFileSync(join(root, '.agentxchain', 'continuous-session.json'), 'utf8'));
    assert.equal(session.owner_type, 'schedule');
    assert.equal(session.owner_id, 'beta');
    assert.ok(session.runs_completed >= 1, 'daemon should advance the due continuous session at least one run');
  });
});

describe('AT-SDH-009: daemon --max-cycles 2 executes two governed runs through a single schedule-owned continuous session', () => {
  it('session_id stays stable, runs_completed reaches 2, and intents resolve through real intake lifecycle', () => {
    const root = makeProject({
      schedules: {
        factory: {
          every_minutes: 1,
          auto_approve: true,
          max_turns: 5,
          initial_role: 'pm',
          continuous: {
            enabled: true,
            vision_path: '.planning/VISION.md',
            max_runs: 10,
            max_idle_cycles: 5,
            triage_approval: 'auto',
          },
        },
      },
    });

    writeVision(root, `# Factory Vision

## Governed Delivery

- durable decision ledger
- explicit phase gates
- recovery-first blocked state handling

## Quality Surface

- acceptance matrix with pass/fail evidence
- conformance fixtures for protocol boundaries
`);

    const daemon = runCli(root, [
      'schedule', 'daemon',
      '--max-cycles', '2',
      '--poll-seconds', '1',
      '--json',
    ], { timeout: 180000 });

    assert.equal(daemon.status, 0, `daemon failed:\n${daemon.combined}`);

    // Parse both cycle JSON outputs
    const cycleOutputs = daemon.stdout.trim().split('\n')
      .filter(Boolean)
      .map((line) => { try { return JSON.parse(line); } catch { return null; } })
      .filter(Boolean);
    assert.equal(cycleOutputs.length, 2, `expected 2 cycle outputs, got ${cycleOutputs.length}`);

    // Both cycles should be ok
    assert.equal(cycleOutputs[0].ok, true, `cycle 1 failed: ${JSON.stringify(cycleOutputs[0])}`);
    assert.equal(cycleOutputs[1].ok, true, `cycle 2 failed: ${JSON.stringify(cycleOutputs[1])}`);

    // Session id must be stable across both cycles
    const contResult1 = cycleOutputs[0].results.find((r) => r.continuous);
    const contResult2 = cycleOutputs[1].results.find((r) => r.continuous);
    assert.ok(contResult1, 'cycle 1 must have a continuous result');
    assert.ok(contResult2, 'cycle 2 must have a continuous result');
    assert.equal(contResult1.session_id, contResult2.session_id, 'session_id must stay stable across cycles');

    // runs_completed must increment
    assert.equal(contResult1.runs_completed, 1, 'cycle 1 should complete 1 run');
    assert.equal(contResult2.runs_completed, 2, 'cycle 2 should complete 2 runs');

    // Session file must reflect final state
    const session = JSON.parse(readFileSync(join(root, '.agentxchain', 'continuous-session.json'), 'utf8'));
    assert.equal(session.owner_type, 'schedule');
    assert.equal(session.owner_id, 'factory');
    assert.equal(session.runs_completed, 2);
    assert.equal(session.status, 'running');
    assert.equal(session.session_id, contResult1.session_id);

    // Schedule state must track the continuous session
    const schedState = JSON.parse(readFileSync(join(root, '.agentxchain', 'schedule-state.json'), 'utf8'));
    assert.ok(schedState.schedules.factory, 'factory schedule state must exist');
    assert.equal(schedState.schedules.factory.last_continuous_session_id, session.session_id);
    assert.equal(schedState.schedules.factory.last_status, 'continuous_running');

    // Run history must have 2 completed entries with provenance
    const historyPath = join(root, '.agentxchain', 'run-history.jsonl');
    assert.ok(existsSync(historyPath), 'run-history.jsonl must exist');
    const history = readFileSync(historyPath, 'utf8').trim().split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    assert.equal(history.length, 2, `expected 2 history entries, got ${history.length}`);
    for (const entry of history) {
      assert.equal(entry.status, 'completed');
      assert.equal(entry.provenance.trigger, 'vision_scan');
      assert.equal(entry.provenance.created_by, 'continuous_loop');
      assert.ok(entry.provenance.intake_intent_id, 'each run must trace to an intake intent');
    }

    // Both runs must have distinct run_ids
    assert.notEqual(history[0].run_id, history[1].run_id, 'two runs must have distinct run_ids');

    // Intents must resolve through real intake lifecycle
    const intentsDir = join(root, '.agentxchain', 'intake', 'intents');
    assert.ok(existsSync(intentsDir), 'intents directory must exist');
    const intents = readdirSync(intentsDir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => JSON.parse(readFileSync(join(intentsDir, f), 'utf8')));
    assert.equal(intents.length, 2, `expected 2 resolved intents, got ${intents.length}`);
    for (const intent of intents) {
      assert.equal(intent.status, 'completed', `intent ${intent.intent_id} must be completed`);
      assert.ok(intent.target_run, `intent ${intent.intent_id} must have target_run`);
      assert.ok(intent.run_completed_at, `intent ${intent.intent_id} must have run_completed_at`);
    }

    // Final governed state must be completed
    const state = JSON.parse(readFileSync(join(root, '.agentxchain', 'state.json'), 'utf8'));
    assert.equal(state.status, 'completed');
    assert.ok(state.provenance.intake_intent_id);
  });
});

describe('AT-SDH-010: schedule-owned continuous session stops cleanly when the session budget is exhausted', () => {
  it('preserves the session across polls, stops before a third run, and records a truthful budget stop reason', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'axc-sdh-budget-agent-'));
    tempDirs.push(tempRoot);
    const costedAgent = writeCostedMockAgent(tempRoot, 0.02);

    const root = makeProject({
      mockAgentPath: costedAgent,
      schedules: {
        budgeted_factory: {
          every_minutes: 1,
          auto_approve: true,
          max_turns: 5,
          initial_role: 'pm',
          continuous: {
            enabled: true,
            vision_path: '.planning/VISION.md',
            max_runs: 10,
            max_idle_cycles: 5,
            triage_approval: 'auto',
            per_session_max_usd: 0.1,
          },
        },
      },
    });

    writeVision(root, `# Budget Vision

## Governed Delivery

- governed scheduling loop
- session budget evidence
- truthful operator status
`);

    const daemon = runCli(root, [
      'schedule', 'daemon',
      '--max-cycles', '3',
      '--poll-seconds', '1',
      '--json',
    ], { timeout: 180000 });

    assert.equal(daemon.status, 0, `daemon failed:\n${daemon.combined}`);

    const cycleOutputs = daemon.stdout.trim().split('\n')
      .filter(Boolean)
      .map((line) => { try { return JSON.parse(line); } catch { return null; } })
      .filter(Boolean);
    assert.equal(cycleOutputs.length, 3, `expected 3 cycle outputs, got ${cycleOutputs.length}`);

    const cont1 = cycleOutputs[0].results.find((r) => r.continuous);
    const cont2 = cycleOutputs[1].results.find((r) => r.continuous);
    const cont3 = cycleOutputs[2].results.find((r) => r.continuous);
    assert.ok(cont1 && cont2 && cont3, 'every cycle must include the continuous result');

    assert.equal(cont1.session_id, cont2.session_id);
    assert.equal(cont2.session_id, cont3.session_id);
    assert.equal(cont1.runs_completed, 1);
    assert.equal(cont2.runs_completed, 2);
    assert.equal(cont3.runs_completed, 2, 'budget stop must happen before a third run starts');
    assert.equal(cont3.action, 'session_budget_exhausted');
    assert.equal(cont3.status, 'completed');

    const session = JSON.parse(readFileSync(join(root, '.agentxchain', 'continuous-session.json'), 'utf8'));
    assert.equal(session.owner_type, 'schedule');
    assert.equal(session.owner_id, 'budgeted_factory');
    assert.equal(session.status, 'completed');
    assert.equal(session.budget_exhausted, true);
    assert.equal(session.runs_completed, 2);
    assert.equal(session.per_session_max_usd, 0.1);
    assert.ok(Math.abs(session.cumulative_spent_usd - 0.12) < 1e-9,
      `expected cumulative spend near 0.12, got ${session.cumulative_spent_usd}`);

    const schedState = JSON.parse(readFileSync(join(root, '.agentxchain', 'schedule-state.json'), 'utf8'));
    assert.equal(schedState.schedules.budgeted_factory.last_continuous_session_id, session.session_id);
    assert.equal(schedState.schedules.budgeted_factory.last_status, 'continuous_session_budget_exhausted');

    const history = readFileSync(join(root, '.agentxchain', 'run-history.jsonl'), 'utf8').trim().split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    assert.equal(history.length, 2, `expected 2 completed runs before budget stop, got ${history.length}`);

    const status = runCli(root, ['status', '--json']);
    assert.equal(status.status, 0, `status failed:\n${status.combined}`);
    const parsedStatus = JSON.parse(status.stdout.trim());
    assert.equal(parsedStatus.continuous_session.status, 'completed');
    assert.equal(parsedStatus.continuous_session.budget_exhausted, true);
    assert.ok(Math.abs(parsedStatus.continuous_session.cumulative_spent_usd - 0.12) < 1e-9,
      `expected status cumulative spend near 0.12, got ${parsedStatus.continuous_session.cumulative_spent_usd}`);
  });
});
