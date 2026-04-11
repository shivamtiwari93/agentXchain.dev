import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  readFileSync,
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

function makeProject({ schedules } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'axc-run-schedule-e2e-'));
  tempDirs.push(root);
  scaffoldGoverned(root, 'Run Schedule E2E', `run-schedule-e2e-${Date.now()}`);

  const configPath = join(root, 'agentxchain.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  const mockRuntime = {
    type: 'local_cli',
    command: process.execPath,
    args: [MOCK_AGENT],
    prompt_transport: 'dispatch_bundle_only',
  };

  for (const runtimeId of Object.keys(config.runtimes || {})) {
    config.runtimes[runtimeId] = { ...mockRuntime };
  }
  for (const role of Object.values(config.roles || {})) {
    role.write_authority = 'authoritative';
  }

  config.schedules = schedules || {
    nightly_governed_run: {
      every_minutes: 60,
      auto_approve: true,
      max_turns: 5,
      initial_role: 'pm',
    },
  };

  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
  return root;
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

function readJson(root, relPath) {
  return JSON.parse(readFileSync(join(root, relPath), 'utf8'));
}

function readRunHistory(root) {
  const content = readFileSync(join(root, '.agentxchain', 'run-history.jsonl'), 'utf8').trim();
  if (!content) return [];
  return content.split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('run schedule E2E', () => {
  it('AT-SCHED-003: schedule list reports due status and next due time', () => {
    const root = makeProject();

    const result = runCli(root, ['schedule', 'list', '--json']);
    assert.equal(result.status, 0, result.combined);

    const payload = JSON.parse(result.stdout);
    assert.equal(payload.schedules.length, 1);
    assert.equal(payload.schedules[0].id, 'nightly_governed_run');
    assert.equal(payload.schedules[0].due, true);
    assert.equal(payload.schedules[0].trigger_reason, 'schedule:nightly_governed_run');
    assert.equal(payload.state_file, '.agentxchain/schedule-state.json');
  });

  it('AT-SCHED-004: schedule run-due starts a governed run with schedule provenance', () => {
    const root = makeProject();

    const result = runCli(root, ['schedule', 'run-due', '--schedule', 'nightly_governed_run', '--json']);
    assert.equal(result.status, 0, result.combined);

    const payload = JSON.parse(result.stdout);
    assert.equal(payload.ok, true);
    assert.equal(payload.results[0].action, 'ran');

    const state = readJson(root, '.agentxchain/state.json');
    assert.equal(state.status, 'completed');
    assert.equal(state.provenance.trigger, 'schedule');
    assert.equal(state.provenance.trigger_reason, 'schedule:nightly_governed_run');

    const scheduleState = readJson(root, '.agentxchain/schedule-state.json');
    assert.equal(scheduleState.schedules.nightly_governed_run.last_run_id, state.run_id);
    assert.equal(scheduleState.schedules.nightly_governed_run.last_status, 'completed');

    const runHistory = readRunHistory(root);
    assert.equal(runHistory.at(-1).provenance.trigger, 'schedule');
  });

  it('AT-SCHED-005: schedule run-due skips blocked repos instead of auto-recovering them', () => {
    const root = makeProject();

    const resume = runCli(root, ['resume']);
    assert.equal(resume.status, 0, resume.combined);

    const escalate = runCli(root, ['escalate', '--reason', 'Need human review', '--detail', 'operator decision required']);
    assert.equal(escalate.status, 0, escalate.combined);

    const blockedState = readJson(root, '.agentxchain/state.json');
    assert.equal(blockedState.status, 'blocked');

    const result = runCli(root, ['schedule', 'run-due', '--json']);
    assert.equal(result.status, 0, result.combined);

    const payload = JSON.parse(result.stdout);
    assert.equal(payload.results[0].action, 'skipped');
    assert.equal(payload.results[0].reason, 'run_blocked');

    const scheduleState = readJson(root, '.agentxchain/schedule-state.json');
    assert.equal(scheduleState.schedules.nightly_governed_run.last_skip_reason, 'run_blocked');
    assert.equal(readJson(root, '.agentxchain/state.json').run_id, blockedState.run_id);
  });

  it('AT-SCHED-006: schedule run-due skips active repos instead of attaching to the existing run', () => {
    const root = makeProject();

    const resume = runCli(root, ['resume']);
    assert.equal(resume.status, 0, resume.combined);

    const activeState = readJson(root, '.agentxchain/state.json');
    assert.equal(activeState.status, 'active');

    const result = runCli(root, ['schedule', 'run-due', '--json']);
    assert.equal(result.status, 0, result.combined);

    const payload = JSON.parse(result.stdout);
    assert.equal(payload.results[0].action, 'skipped');
    assert.equal(payload.results[0].reason, 'run_active');

    const afterState = readJson(root, '.agentxchain/state.json');
    assert.equal(afterState.run_id, activeState.run_id);
    assert.equal(afterState.provenance.trigger, 'manual');
  });

  it('AT-SCHED-007: schedule daemon executes the same due-run path', () => {
    const root = makeProject();

    const result = runCli(root, ['schedule', 'daemon', '--max-cycles', '1', '--poll-seconds', '1', '--json'], {
      timeout: 90000,
    });
    assert.equal(result.status, 0, result.combined);

    const lines = result.stdout.trim().split('\n').filter(Boolean);
    const payload = JSON.parse(lines.at(-1));
    assert.equal(payload.ok, true);
    assert.equal(payload.results[0].action, 'ran');

    const state = readJson(root, '.agentxchain/state.json');
    assert.equal(state.provenance.trigger, 'schedule');
  });

  it('AT-SCHED-008: --schedule runs only the targeted configured schedule', () => {
    const root = makeProject({
      schedules: {
        nightly_governed_run: {
          every_minutes: 60,
          auto_approve: true,
          max_turns: 5,
          initial_role: 'pm',
        },
        hourly_cleanup: {
          every_minutes: 60,
          auto_approve: true,
          max_turns: 5,
          initial_role: 'pm',
        },
      },
    });

    const result = runCli(root, ['schedule', 'run-due', '--schedule', 'hourly_cleanup', '--json']);
    assert.equal(result.status, 0, result.combined);

    const payload = JSON.parse(result.stdout);
    assert.equal(payload.results.length, 1);
    assert.equal(payload.results[0].id, 'hourly_cleanup');

    const scheduleState = readJson(root, '.agentxchain/schedule-state.json');
    assert.equal(scheduleState.schedules.hourly_cleanup.last_status, 'completed');
    assert.equal(scheduleState.schedules.nightly_governed_run.last_run_id, null);
  });
});
