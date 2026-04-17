import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
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

function writeBlockingMockAgent(root) {
  const agentPath = join(root, 'mock-blocking-agent.mjs');
  const source = [
    '#!/usr/bin/env node',
    "import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';",
    "import { join, dirname } from 'path';",
    '',
    'const root = process.cwd();',
    "const indexPath = join(root, '.agentxchain/dispatch/index.json');",
    'if (!existsSync(indexPath)) process.exit(1);',
    "const index = JSON.parse(readFileSync(indexPath, 'utf8'));",
    'const entry = Object.values(index.active_turns || {})[0];',
    'if (!entry) process.exit(1);',
    'const turnId = entry.turn_id;',
    'const roleId = entry.role;',
    'const runtimeId = entry.runtime_id;',
    'const stagingResultPath = entry.staging_result_path;',
    'const phase = index.phase;',
    'const runId = index.run_id;',
    "const blockedMarker = join(root, '.agentxchain', 'mock-blocked-once');",
    '',
    'function ensureFile(relPath, content) {',
    '  const absPath = join(root, relPath);',
    '  mkdirSync(dirname(absPath), { recursive: true });',
    '  writeFileSync(absPath, content);',
    '}',
    '',
    "let status = 'completed';",
    "let summary = 'Mock agent completed phase.';",
    'let phaseTransitionRequest = null;',
    'let runCompletionRequest = false;',
    "let proposedNextRole = 'human';",
    'let filesChanged = [];',
    'let artifactType = roleId === "dev" ? "workspace" : "review";',
    'let needsHumanReason = null;',
    '',
    "if (phase === 'planning' && !existsSync(blockedMarker)) {",
    "  writeFileSync(blockedMarker, '1\\n');",
    "  status = 'needs_human';",
    "  summary = 'Mock agent requires human unblock before continuing.';",
    "  needsHumanReason = 'Linear OAuth expired for governed intake sync. Reconnect the OAuth session before continuing.';",
    "  proposedNextRole = 'human';",
    '} else if (phase === "planning") {',
    "  ensureFile('.planning/PM_SIGNOFF.md', '# PM Signoff\\n\\nApproved: YES\\n');",
    "  ensureFile('.planning/ROADMAP.md', '# Roadmap\\n\\n## Phases\\n\\n- planning\\n- implementation\\n- qa\\n');",
    "  ensureFile('.planning/SYSTEM_SPEC.md', '# System Spec\\n\\n## Purpose\\n\\nMock governed project for integration testing.\\n\\n## Interface\\n\\nagentxchain run --auto-approve completes a 3-turn lifecycle.\\n\\n## Acceptance Tests\\n\\n- [ ] Run completes with exit 0 and 3 turns executed.\\n');",
    "  filesChanged = ['.planning/PM_SIGNOFF.md', '.planning/ROADMAP.md', '.planning/SYSTEM_SPEC.md'];",
    "  summary = 'Mock planning completed after unblock.';",
    "  phaseTransitionRequest = 'implementation';",
    "  proposedNextRole = 'human';",
    '} else if (phase === "implementation") {',
    "  ensureFile('src/output.js', 'export const ok = true;\\n');",
    "  ensureFile('.planning/IMPLEMENTATION_NOTES.md', '# Implementation Notes\\n\\n## Changes\\n\\nImplemented the integration-test governed artifact output.\\n\\n## Verification\\n\\nRun the governed integration test flow and confirm the implementation phase exits cleanly.\\n');",
    "  filesChanged = ['src/output.js', '.planning/IMPLEMENTATION_NOTES.md'];",
    "  summary = 'Mock implementation completed.';",
    "  phaseTransitionRequest = 'qa';",
    "  proposedNextRole = 'qa';",
    '} else if (phase === "qa") {',
    "  ensureFile('.planning/acceptance-matrix.md', '# Acceptance Matrix\\n\\n| Req # | Requirement | Acceptance criteria | Test status | Last tested | Status |\\n|-------|-------------|-------------------|-------------|-------------|--------|\\n| 1 | Mock governed run | QA confirms the mocked governed run can complete end to end | pass | 2026-04-06 | pass |\\n');",
    "  ensureFile('.planning/ship-verdict.md', '# Ship Verdict\\n\\n## Verdict: YES\\n');",
    "  ensureFile('.planning/RELEASE_NOTES.md', '# Release Notes\\n\\n## User Impact\\n\\nMock governed run completed successfully through QA.\\n\\n## Verification Summary\\n\\nIntegration-test mock agent created the full workflow-kit artifact set required by the shipped gates.\\n');",
    "  filesChanged = ['.planning/acceptance-matrix.md', '.planning/ship-verdict.md', '.planning/RELEASE_NOTES.md'];",
    "  summary = 'Mock QA completed.';",
    '  runCompletionRequest = true;',
    "  proposedNextRole = 'human';",
    '}',
    '',
    'const turnResult = {',
    "  schema_version: '1.0',",
    '  run_id: runId,',
    '  turn_id: turnId,',
    '  role: roleId,',
    '  runtime_id: runtimeId,',
    '  status,',
    '  summary,',
    '  decisions: [],',
    '  objections: [],',
    '  files_changed: filesChanged,',
    '  artifacts_created: [],',
    "  verification: { status: 'pass', commands: ['echo ok'], evidence_summary: 'pass', machine_evidence: [{ command: 'echo ok', exit_code: 0 }] },",
    '  artifact: { type: artifactType, ref: null },',
    '  proposed_next_role: proposedNextRole,',
    '  phase_transition_request: phaseTransitionRequest,',
    '  run_completion_request: runCompletionRequest,',
    '  needs_human_reason: needsHumanReason,',
    "  cost: { input_tokens: 0, output_tokens: 0, usd: 0 },",
    '};',
    '',
    'const absStaging = join(root, stagingResultPath);',
    'mkdirSync(dirname(absStaging), { recursive: true });',
    "writeFileSync(absStaging, JSON.stringify(turnResult, null, 2) + '\\n');",
  ].join('\n');

  writeFileSync(agentPath, source);
  return agentPath;
}

function writeLoopingMockAgent(root) {
  const agentPath = join(root, 'mock-looping-agent.mjs');
  const source = [
    '#!/usr/bin/env node',
    "import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';",
    "import { join, dirname } from 'path';",
    '',
    'const root = process.cwd();',
    "const indexPath = join(root, '.agentxchain/dispatch/index.json');",
    "const counterPath = join(root, '.agentxchain', 'mock-loop-count');",
    'if (!existsSync(indexPath)) process.exit(1);',
    "const index = JSON.parse(readFileSync(indexPath, 'utf8'));",
    'const entry = Object.values(index.active_turns || {})[0];',
    'if (!entry) process.exit(1);',
    'const turnId = entry.turn_id;',
    'const roleId = entry.role;',
    'const runtimeId = entry.runtime_id;',
    'const stagingResultPath = entry.staging_result_path;',
    'const runId = index.run_id;',
    '',
    'const count = existsSync(counterPath)',
    "  ? Number.parseInt(readFileSync(counterPath, 'utf8').trim() || '0', 10) + 1",
    '  : 1;',
    "writeFileSync(counterPath, `${count}\\n`);",
    '',
    'await new Promise((resolve) => setTimeout(resolve, 1200));',
    '',
    'const turnResult = {',
    "  schema_version: '1.0',",
    '  run_id: runId,',
    '  turn_id: turnId,',
    '  role: roleId,',
    '  runtime_id: runtimeId,',
    "  status: 'completed',",
    "  summary: `Looping mock turn ${count} completed.`,",
    '  decisions: [],',
    '  objections: [],',
    '  files_changed: [],',
    '  artifacts_created: [],',
    "  verification: { status: 'pass', commands: ['echo ok'], evidence_summary: 'pass', machine_evidence: [{ command: 'echo ok', exit_code: 0 }] },",
    '  artifact: { type: roleId === "dev" ? "workspace" : "review", ref: null },',
    '  proposed_next_role: roleId,',
    '  phase_transition_request: null,',
    '  run_completion_request: false,',
    '  needs_human_reason: null,',
    "  cost: { input_tokens: 0, output_tokens: 0, usd: 0 },",
    '};',
    '',
    'const absStaging = join(root, stagingResultPath);',
    'mkdirSync(dirname(absStaging), { recursive: true });',
    "writeFileSync(absStaging, JSON.stringify(turnResult, null, 2) + '\\n');",
  ].join('\n');

  writeFileSync(agentPath, source);
  return agentPath;
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

function spawnCli(root, args, opts = {}) {
  const child = spawn(process.execPath, [CLI_BIN, ...args], {
    cwd: root,
    env: { ...process.env, NO_COLOR: '1', NODE_NO_WARNINGS: '1' },
  });

  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });

  const completed = new Promise((resolve) => {
    child.on('close', (code) => {
      resolve({
        status: code ?? 1,
        stdout,
        stderr,
        combined: `${stdout}${stderr}`,
      });
    });
  });

  if (opts.timeout) {
    setTimeout(() => {
      if (child.exitCode == null) {
        child.kill('SIGTERM');
      }
    }, opts.timeout).unref();
  }

  return {
    child,
    completed,
    getStdout: () => stdout,
    getStderr: () => stderr,
  };
}

function readJson(root, relPath) {
  return JSON.parse(readFileSync(join(root, relPath), 'utf8'));
}

function readHumanEscalations(root) {
  const relPath = join(root, '.agentxchain', 'human-escalations.jsonl');
  if (!existsSync(relPath)) return [];
  const content = readFileSync(relPath, 'utf8').trim();
  if (!content) return [];
  return content.split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

function readRunHistory(root) {
  const content = readFileSync(join(root, '.agentxchain', 'run-history.jsonl'), 'utf8').trim();
  if (!content) return [];
  return content.split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

function readIntent(root, intentId) {
  return JSON.parse(readFileSync(join(root, '.agentxchain', 'intake', 'intents', `${intentId}.json`), 'utf8'));
}

async function waitFor(fn, { timeoutMs = 15000, intervalMs = 100 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = fn();
    if (value) {
      return value;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Timed out after ${timeoutMs}ms`);
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

  it('AT-SCHED-009: schedule daemon keeps polling blocked schedule runs and continues them after unblock', async () => {
    const root = makeProject();
    const configPath = join(root, 'agentxchain.json');
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    const blockingAgent = writeBlockingMockAgent(root);
    const runtime = {
      type: 'local_cli',
      command: process.execPath,
      args: [blockingAgent],
      prompt_transport: 'dispatch_bundle_only',
    };

    for (const runtimeId of Object.keys(config.runtimes || {})) {
      config.runtimes[runtimeId] = { ...runtime };
    }
    writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');

    const daemon = spawnCli(root, ['schedule', 'daemon', '--max-cycles', '3', '--poll-seconds', '1', '--json'], {
      timeout: 20000,
    });

    const escalationId = await waitFor(() => {
      if (daemon.child.exitCode != null) {
        throw new Error(`daemon exited before escalation surfaced:\n${daemon.getStdout()}\n${daemon.getStderr()}`);
      }
      const match = daemon.getStderr().match(/agentxchain unblock (hesc_[a-z0-9]+)/i);
      return match ? match[1] : null;
    });

    assert.equal(daemon.child.exitCode, null, 'daemon must keep polling while waiting for human unblock');

    const unblock = runCli(root, ['unblock', escalationId], { timeout: 30000 });
    assert.equal(unblock.status, 0, unblock.combined);

    const daemonResult = await daemon.completed;
    assert.equal(daemonResult.status, 0, daemonResult.combined);

    const state = readJson(root, '.agentxchain/state.json');
    assert.equal(state.status, 'completed');

    const scheduleState = readJson(root, '.agentxchain/schedule-state.json');
    assert.equal(scheduleState.schedules.nightly_governed_run.last_status, 'completed');

    const escalations = readHumanEscalations(root);
    const resolved = escalations.find((entry) => entry.escalation_id === escalationId && entry.kind === 'resolved');
    assert.ok(resolved, 'expected resolved human escalation record after unblock');
    assert.equal(resolved.resolved_via, 'operator_unblock');

    const daemonCycles = daemonResult.stdout.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
    assert.ok(
      daemonCycles.some((cycle) => cycle.results?.some((entry) => entry.action === 'blocked' && entry.stop_reason === 'blocked')),
      `expected a blocked cycle, got: ${daemonResult.stdout}`,
    );
    assert.ok(
      daemonCycles.some((cycle) => cycle.results?.some((entry) => entry.action === 'continued' && entry.stop_reason === 'completed')),
      `expected a continued cycle, got: ${daemonResult.stdout}`,
    );
  });

  it('AT-SCHED-010: schedule daemon consumes injected p0 work after priority preemption', async () => {
    const root = makeProject();
    const configPath = join(root, 'agentxchain.json');
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    const loopingAgent = writeLoopingMockAgent(root);
    const runtime = {
      type: 'local_cli',
      command: process.execPath,
      args: [loopingAgent],
      prompt_transport: 'dispatch_bundle_only',
    };

    for (const runtimeId of Object.keys(config.runtimes || {})) {
      config.runtimes[runtimeId] = { ...runtime };
    }
    writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');

    const daemon = spawnCli(root, ['schedule', 'daemon', '--max-cycles', '2', '--poll-seconds', '1', '--json'], {
      timeout: 20000,
    });

    await waitFor(() => {
      const statePath = join(root, '.agentxchain', 'state.json');
      if (!existsSync(statePath)) return null;
      try {
        const state = JSON.parse(readFileSync(statePath, 'utf8'));
        return state.status === 'active' && Object.keys(state.active_turns || {}).length > 0 ? state : null;
      } catch {
        return null;
      }
    });

    const inject = runCli(root, ['inject', 'Emergency schedule fix', '--priority', 'p0', '--json'], { timeout: 30000 });
    assert.equal(inject.status, 0, inject.combined);
    const injected = JSON.parse(inject.stdout);

    const daemonResult = await daemon.completed;
    assert.equal(daemonResult.status, 0, daemonResult.combined);

    const injectedIntent = readIntent(root, injected.intent_id);
    assert.equal(injectedIntent.status, 'executing');
    assert.ok(injectedIntent.target_turn, 'injected intent must be started by the daemon');

    const markerPath = join(root, '.agentxchain', 'intake', 'injected-priority.json');
    assert.equal(existsSync(markerPath), false, 'daemon must clear the preemption marker after starting injected work');

    const daemonCycles = daemonResult.stdout.trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
    assert.ok(
      daemonCycles.some((cycle) => cycle.results?.some((entry) =>
        entry.action === 'preempted'
        && entry.stop_reason === 'priority_preempted'
        && entry.injected_intent_id === injected.intent_id
        && entry.injected_turn_id === injectedIntent.target_turn
      )),
      `expected a preempted cycle that promoted the injected intent, got: ${daemonResult.stdout}`,
    );
    assert.ok(
      daemonCycles.some((cycle) => cycle.results?.some((entry) => entry.action === 'continued')),
      `expected a continuation cycle after injected work was started, got: ${daemonResult.stdout}`,
    );
  });
});
