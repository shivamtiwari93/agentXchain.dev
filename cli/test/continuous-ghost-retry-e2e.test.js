import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { scaffoldGoverned } from '../src/commands/init.js';

const cliRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI_BIN = join(cliRoot, 'bin', 'agentxchain.js');
const MOCK_AGENT = join(cliRoot, 'test-support', 'mock-agent.mjs');

const tempDirs = [];

function writeGhostThenSuccessAgent(root, ghostsBeforeSuccess) {
  const agentPath = join(root, `_ghost-${ghostsBeforeSuccess}-then-success-agent.mjs`);
  const counterPath = join(dirname(root), `${root.split('/').pop()}-ghost-attempts.txt`);
  writeFileSync(agentPath, [
    '#!/usr/bin/env node',
    "import { existsSync, readFileSync, writeFileSync } from 'node:fs';",
    "import { setTimeout as sleep } from 'node:timers/promises';",
    `const counterPath = ${JSON.stringify(counterPath)};`,
    "const current = existsSync(counterPath) ? Number.parseInt(readFileSync(counterPath, 'utf8') || '0', 10) : 0;",
    'const next = Number.isFinite(current) ? current + 1 : 1;',
    "writeFileSync(counterPath, String(next));",
    `if (next <= ${ghostsBeforeSuccess}) {`,
    '  await sleep(5000);',
    '  process.exit(0);',
    '}',
    `await import(${JSON.stringify(MOCK_AGENT)});`,
    '',
  ].join('\n'));
  return agentPath;
}

function makeProject({ ghostThenSuccessCount, startupWatchdogMs = 400 } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'axc-continuous-ghost-e2e-'));
  tempDirs.push(root);
  scaffoldGoverned(root, 'Continuous Ghost Retry E2E', `continuous-ghost-e2e-${Date.now()}`);

  const configPath = join(root, 'agentxchain.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  const mockRuntime = {
    type: 'local_cli',
    command: process.execPath,
    args: [writeGhostThenSuccessAgent(root, ghostThenSuccessCount)],
    prompt_transport: 'dispatch_bundle_only',
  };

  for (const runtimeId of Object.keys(config.runtimes || {})) {
    config.runtimes[runtimeId] = { ...mockRuntime };
  }
  for (const role of Object.values(config.roles || {})) {
    role.write_authority = 'authoritative';
  }
  config.intent_coverage_mode = 'lenient';
  config.run_loop = {
    ...(config.run_loop || {}),
    startup_watchdog_ms: startupWatchdogMs,
  };

  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
  mkdirSync(join(root, '.planning'), { recursive: true });
  writeFileSync(join(root, '.planning', 'VISION.md'), `# Test Vision

## Governed Delivery

- durable decision ledger
- explicit phase gates
- recovery-first blocked state handling
`, 'utf8');

  execSync('git init', { cwd: root, stdio: 'ignore' });
  execSync('git config user.email "continuous@test.local"', { cwd: root, stdio: 'ignore' });
  execSync('git config user.name "Continuous Test"', { cwd: root, stdio: 'ignore' });
  execSync('git add .', { cwd: root, stdio: 'ignore' });
  execSync('git commit -m "initial"', { cwd: root, stdio: 'ignore' });
  return root;
}

function runCli(root, args, timeout = 45000) {
  const result = spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout,
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

function readJsonl(root, relPath) {
  const raw = readFileSync(join(root, relPath), 'utf8').trim();
  if (!raw) return [];
  return raw.split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

function commitConfigChange(root, message = 'configure ghost auto-retry') {
  execSync('git add agentxchain.json', { cwd: root, stdio: 'ignore' });
  execSync(`git commit -m ${JSON.stringify(message)}`, { cwd: root, stdio: 'ignore' });
}

function configureGhostRetry(root, autoRetryOnGhost) {
  const configPath = join(root, 'agentxchain.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  config.run_loop = {
    ...(config.run_loop || {}),
    continuous: {
      ...(config.run_loop?.continuous || {}),
      auto_retry_on_ghost: autoRetryOnGhost,
    },
  };
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
  commitConfigChange(root);
}

function runContinuousOnce(root, timeout) {
  return runCli(root, [
    'run',
    '--continuous',
    '--vision',
    '.planning/VISION.md',
    '--max-runs',
    '1',
    '--max-idle-cycles',
    '1',
    '--poll-seconds',
    '0',
  ], timeout);
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('BUG-61 continuous ghost auto-retry E2E', () => {
  it('AT-BUG61-001: continuous mode auto-retries startup ghosts and completes without operator intervention', () => {
    const root = makeProject({ ghostThenSuccessCount: 2 });
    configureGhostRetry(root, {
      enabled: true,
      max_retries_per_run: 3,
      cooldown_seconds: 1,
    });

    const run = runContinuousOnce(root, 45000);

    assert.equal(run.status, 0, `continuous run should recover from two ghosts:\n${run.combined}`);
    assert.match(run.stdout, /Ghost turn auto-retried \(1\/3\)/);
    assert.match(run.stdout, /Ghost turn auto-retried \(2\/3\)/);
    assert.match(run.stdout, /Run 1\/1 completed: completed|Active run completed \(1\/1\): completed/);

    const session = readJson(root, '.agentxchain/continuous-session.json');
    assert.equal(session.status, 'completed');
    assert.equal(session.runs_completed, 1);
    assert.equal(session.ghost_retry.attempts, 2);
    assert.equal(session.ghost_retry.exhausted, false);

    const state = readJson(root, '.agentxchain/state.json');
    assert.equal(state.status, 'completed');

    const events = readJsonl(root, '.agentxchain/events.jsonl');
    const autoRetryEvents = events.filter((entry) => entry.event_type === 'auto_retried_ghost');
    assert.equal(autoRetryEvents.length, 2);
    assert.deepEqual(autoRetryEvents.map((entry) => entry.payload.attempt), [1, 2]);
    assert.equal(events.some((entry) => entry.event_type === 'ghost_retry_exhausted'), false);
  });

  it('AT-BUG61-002: continuous ghost auto-retry stops early on same-signature repeat and preserves manual recovery', () => {
    const root = makeProject({ ghostThenSuccessCount: 4 });
    configureGhostRetry(root, {
      enabled: true,
      max_retries_per_run: 3,
      cooldown_seconds: 1,
    });

    const run = runContinuousOnce(root, 45000);

    assert.equal(run.status, 0, `continuous run should pause cleanly after same-signature early stop:\n${run.combined}`);
    assert.match(run.stdout, /Ghost auto-retry exhausted \(same_signature_repeat \[.+\|.+\|.+\] after 2 attempts\)/);
    assert.match(run.stdout, /reissue-turn --turn .* --reason ghost/);

    const session = readJson(root, '.agentxchain/continuous-session.json');
    assert.equal(session.status, 'paused');
    assert.equal(session.runs_completed, 0);
    assert.equal(session.ghost_retry.attempts, 2);
    assert.equal(session.ghost_retry.exhausted, true);
    assert.ok(Array.isArray(session.ghost_retry.attempts_log));
    assert.equal(session.ghost_retry.attempts_log.length, 2);
    // Slice 2d (Turn 201): each attempt entry carries the adapter's
    // process_exit / spawn_error diagnostic (stderr_excerpt / exit_code /
    // exit_signal). The fields may legitimately be null when the adapter did
    // not surface that particular piece of evidence for this ghost, but the
    // KEYS MUST always be present so operators reading session.json or the
    // exhaustion event payload never have to cross-reference the per-turn
    // stdout.log file just to know whether stderr evidence was available.
    for (const entry of session.ghost_retry.attempts_log) {
      assert.ok(Object.hasOwn(entry, 'stderr_excerpt'), 'attempts_log entry must carry stderr_excerpt key');
      assert.ok(Object.hasOwn(entry, 'exit_code'), 'attempts_log entry must carry exit_code key');
      assert.ok(Object.hasOwn(entry, 'exit_signal'), 'attempts_log entry must carry exit_signal key');
    }

    const state = readJson(root, '.agentxchain/state.json');
    assert.equal(state.status, 'blocked');
    assert.equal(state.blocked_reason.category, 'ghost_turn');
    assert.match(state.blocked_reason.recovery.detail, /Auto-retry stopped early after 2 consecutive same-signature attempts/);
    assert.match(state.blocked_reason.recovery.detail, /reissue-turn --turn .* --reason ghost/);

    const events = readJsonl(root, '.agentxchain/events.jsonl');
    assert.equal(events.filter((entry) => entry.event_type === 'auto_retried_ghost').length, 2);
    const exhausted = events.filter((entry) => entry.event_type === 'ghost_retry_exhausted');
    assert.equal(exhausted.length, 1);
    assert.equal(exhausted[0].payload.exhaustion_reason, 'same_signature_repeat');
    assert.ok(exhausted[0].payload.signature_repeat);
    assert.equal(exhausted[0].payload.signature_repeat.consecutive, 2);
    assert.ok(exhausted[0].payload.diagnostic_bundle);
    assert.equal(exhausted[0].payload.diagnostic_bundle.attempts_log.length, 2);
    assert.ok(exhausted[0].payload.diagnostic_bundle.final_signature);
  });

  it('AT-BUG61-003: explicit ghost auto-retry opt-out preserves current manual recovery', () => {
    const root = makeProject({ ghostThenSuccessCount: 1 });
    configureGhostRetry(root, {
      enabled: false,
      max_retries_per_run: 3,
      cooldown_seconds: 1,
    });

    const run = runContinuousOnce(root, 30000);

    assert.equal(run.status, 0, `continuous run should pause with manual recovery when opted out:\n${run.combined}`);
    assert.match(run.stdout, /Run blocked — continuous loop paused/);
    assert.match(run.stdout, /reissue-turn --turn .* --reason ghost/);

    const session = readJson(root, '.agentxchain/continuous-session.json');
    assert.equal(session.status, 'paused');
    assert.equal(session.runs_completed, 0);

    const events = readJsonl(root, '.agentxchain/events.jsonl');
    assert.equal(events.some((entry) => entry.event_type === 'auto_retried_ghost'), false);
    assert.equal(events.some((entry) => entry.event_type === 'ghost_retry_exhausted'), false);
  });
});
