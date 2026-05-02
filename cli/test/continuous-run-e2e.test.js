import { afterEach, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync, spawn, spawnSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { scaffoldGoverned } from '../src/commands/init.js';

const cliRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI_BIN = join(cliRoot, 'bin', 'agentxchain.js');
const MOCK_AGENT = join(cliRoot, 'test-support', 'mock-agent.mjs');

const tempDirs = [];

function writeFailingAgent(root) {
  const agentPath = join(root, '_failing-mock-agent.mjs');
  writeFileSync(agentPath, [
    '#!/usr/bin/env node',
    "console.error('intentional continuous failure');",
    'process.exit(1);',
    '',
  ].join('\n'));
  return agentPath;
}

function writeSilentStartupAgent(root) {
  const agentPath = join(root, '_silent-startup-agent.mjs');
  writeFileSync(agentPath, [
    '#!/usr/bin/env node',
    "import { setTimeout as sleep } from 'node:timers/promises';",
    'await sleep(5000);',
    '',
  ].join('\n'));
  return agentPath;
}

function makeProject({
  slowAgent = false,
  failingAgent = false,
  changingAgent = false,
  silentStartupAgent = false,
  startupWatchdogMs = null,
} = {}) {
  const root = mkdtempSync(join(tmpdir(), 'axc-continuous-e2e-'));
  tempDirs.push(root);
  scaffoldGoverned(root, 'Continuous Vision E2E', `continuous-e2e-${Date.now()}`);

  const configPath = join(root, 'agentxchain.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  let agentEntry = MOCK_AGENT;
  if (slowAgent) {
    agentEntry = join(root, '_slow-mock-agent.mjs');
    writeFileSync(agentEntry, `import { setTimeout as sleep } from 'node:timers/promises';\nawait sleep(1500);\nawait import(${JSON.stringify(MOCK_AGENT)});\n`);
  } else if (failingAgent) {
    agentEntry = writeFailingAgent(root);
  } else if (silentStartupAgent) {
    agentEntry = writeSilentStartupAgent(root);
  } else if (changingAgent) {
    agentEntry = join(root, '_changing-mock-agent.mjs');
    writeFileSync(agentEntry, `import { appendFileSync, readFileSync } from 'node:fs';\nimport { join } from 'node:path';\nconst root = process.cwd();\nconst index = JSON.parse(readFileSync(join(root, '.agentxchain/dispatch/index.json'), 'utf8'));\nconst entry = Object.values(index.active_turns || {})[0] || {};\nconst turnId = entry.turn_id || 'unknown';\nconst phase = index.phase || 'unknown';\nawait import(${JSON.stringify(MOCK_AGENT)});\nif (phase === 'planning') appendFileSync(join(root, '.planning/ROADMAP.md'), \`\\n- checkpoint \${turnId}\\n\`);\nif (phase === 'implementation') appendFileSync(join(root, 'src/output.js'), \`// checkpoint \${turnId}\\n\`);\nif (phase === 'qa') appendFileSync(join(root, '.planning/RELEASE_NOTES.md'), \`\\n- checkpoint \${turnId}\\n\`);\n`);
  }
  const mockRuntime = {
    type: 'local_cli',
    command: process.execPath,
    args: [agentEntry],
    prompt_transport: 'dispatch_bundle_only',
  };

  for (const runtimeId of Object.keys(config.runtimes || {})) {
    config.runtimes[runtimeId] = { ...mockRuntime };
  }
  for (const role of Object.values(config.roles || {})) {
    role.write_authority = 'authoritative';
  }
  config.intent_coverage_mode = 'lenient';
  if (failingAgent) {
    config.rules = { ...(config.rules || {}), max_turn_retries: 1 };
  }
  if (startupWatchdogMs != null) {
    config.run_loop = {
      ...(config.run_loop || {}),
      startup_watchdog_ms: startupWatchdogMs,
    };
  }

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

function runCli(root, args, timeout = 120000) {
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

function commitConfigChange(root, message = 'configure test runtime') {
  execSync('git add agentxchain.json', { cwd: root, stdio: 'ignore' });
  execSync(`git commit -m ${JSON.stringify(message)}`, { cwd: root, stdio: 'ignore' });
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('continuous run E2E', () => {
  it('AT-CONT-BUG51-001: ghost startup failures in continuous mode surface reissue-turn recovery, not unblock', () => {
    const root = makeProject({ silentStartupAgent: true, startupWatchdogMs: 400 });

    const run = runCli(root, [
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
    ], 30000);

    assert.equal(run.status, 0, `continuous run should pause cleanly on startup ghost recovery:\n${run.combined}`);
    assert.match(run.stdout, /Run blocked — continuous loop paused/);
    assert.match(run.stdout, /reissue-turn --turn .* --reason ghost/);
    assert.doesNotMatch(run.stdout, /unblock <id>/);

    const session = readJson(root, '.agentxchain/continuous-session.json');
    assert.equal(session.status, 'paused');
    assert.equal(session.runs_completed, 0);
    assert.ok(session.current_run_id, 'ghost-blocked run context must remain visible');

    const state = readJson(root, '.agentxchain/state.json');
    const [turnId] = Object.keys(state.active_turns || {});
    assert.equal(state.status, 'blocked');
    assert.equal(state.blocked_reason.category, 'ghost_turn');
    assert.match(state.blocked_reason.recovery.recovery_action, /reissue-turn --turn .* --reason ghost/);
    assert.equal(state.active_turns[turnId].status, 'failed_start');
    assert.equal(state.active_turns[turnId].failed_start_reason, 'stdout_attach_failed');

    const intentsDir = join(root, '.agentxchain', 'intake', 'intents');
    const intents = readdirSync(intentsDir)
      .filter((file) => file.endsWith('.json'))
      .map((file) => JSON.parse(readFileSync(join(intentsDir, file), 'utf8')));
    assert.equal(intents.length, 1);
    assert.equal(intents[0].status, 'blocked');
    assert.equal(intents[0].run_blocked_reason, 'ghost_turn');
    assert.match(intents[0].run_blocked_recovery, /reissue-turn --turn .* --reason ghost/);

    const events = readJsonl(root, '.agentxchain/events.jsonl');
    assert.ok(events.some((entry) => entry.event_type === 'turn_start_failed'));
  });

  it('AT-CONT-FAIL-003: startup failure pauses the continuous session and preserves ghost recovery truth', () => {
    const root = makeProject({ failingAgent: true });

    const run = runCli(root, [
      'run',
      '--continuous',
      '--vision',
      '.planning/VISION.md',
      '--max-runs',
      '3',
      '--max-idle-cycles',
      '1',
      '--poll-seconds',
      '0',
    ]);

    assert.equal(run.status, 0, `continuous run should pause cleanly on blocked recovery:\n${run.combined}`);
    assert.match(run.stdout, /Run blocked — continuous loop paused/);

    const session = readJson(root, '.agentxchain/continuous-session.json');
    assert.equal(session.status, 'paused');
    assert.equal(session.runs_completed, 0, 'blocked recovery must not count as a completed run');
    assert.ok(session.current_run_id, 'failed run context must remain visible');
    assert.ok(session.current_vision_objective, 'current objective must remain visible for recovery');

    const state = readJson(root, '.agentxchain/state.json');
    assert.equal(state.status, 'blocked');
    assert.equal(state.blocked_reason.category, 'ghost_turn');
    assert.match(state.blocked_reason.recovery.recovery_action, /reissue-turn --turn .* --reason ghost/);

    const intentsDir = join(root, '.agentxchain', 'intake', 'intents');
    const intents = readdirSync(intentsDir)
      .filter((file) => file.endsWith('.json'))
      .map((file) => JSON.parse(readFileSync(join(intentsDir, file), 'utf8')));
    assert.equal(intents.length, 1);
    assert.equal(intents[0].status, 'blocked');
    assert.equal(intents[0].run_blocked_reason, 'ghost_turn');
    assert.ok(intents[0].run_blocked_recovery);
    assert.match(intents[0].run_blocked_recovery, /reissue-turn --turn .* --reason ghost/);

    const status = runCli(root, ['status', '--json']);
    assert.equal(status.status, 0, `status failed:\n${status.combined}`);
    const parsedStatus = JSON.parse(status.stdout);
    assert.equal(parsedStatus.continuous_session.status, 'paused');
    assert.equal(parsedStatus.continuous_session.runs_completed, 0);
  });

  it('AT-VCONT-010: run --continuous rejects invalid --session-budget values instead of disabling the cap silently', () => {
    const root = makeProject();

    const run = runCli(root, [
      'run',
      '--continuous',
      '--vision',
      '.planning/VISION.md',
      '--session-budget',
      'nope',
    ]);

    assert.equal(run.status, 1, `continuous run should fail for invalid budget:\n${run.combined}`);
    assert.match(run.stdout, /--session-budget must be a finite number greater than 0/);

    const sessionPath = join(root, '.agentxchain', 'continuous-session.json');
    assert.equal(existsSync(sessionPath), false, 'invalid session budget must fail before session creation');
  });

  it('AT-VCONT-001: run --continuous completes 3 real governed runs from VISION.md and resolves intake state', () => {
    const root = makeProject();

    const run = runCli(root, [
      'run',
      '--continuous',
      '--vision',
      '.planning/VISION.md',
      '--max-runs',
      '3',
      '--max-idle-cycles',
      '1',
      '--poll-seconds',
      '0',
    ]);

    assert.equal(run.status, 0, `continuous run failed:\n${run.combined}`);
    assert.match(run.stdout, /agentxchain run --continuous/);
    assert.match(run.stdout, /Run 3\/3 completed: completed/);

    const session = readJson(root, '.agentxchain/continuous-session.json');
    assert.equal(session.status, 'completed');
    assert.equal(session.runs_completed, 3);
    assert.equal(session.vision_path, '.planning/VISION.md');

    const state = readJson(root, '.agentxchain/state.json');
    assert.equal(state.status, 'completed');
    assert.equal(state.provenance.trigger, 'vision_scan');
    assert.equal(state.provenance.created_by, 'continuous_loop');
    assert.ok(state.provenance.intake_intent_id);

    const history = readJsonl(root, '.agentxchain/run-history.jsonl');
    assert.equal(history.length, 3);
    for (const entry of history) {
      assert.equal(entry.status, 'completed');
      assert.equal(entry.provenance.trigger, 'vision_scan');
      assert.equal(entry.provenance.created_by, 'continuous_loop');
      assert.ok(entry.provenance.intake_intent_id);
    }

    const intentsDir = join(root, '.agentxchain', 'intake', 'intents');
    const intents = readdirSync(intentsDir)
      .filter((file) => file.endsWith('.json'))
      .map((file) => JSON.parse(readFileSync(join(intentsDir, file), 'utf8')));
    assert.equal(intents.length, 3);
    for (const intent of intents) {
      assert.equal(intent.status, 'completed');
      assert.ok(intent.target_run);
      assert.ok(intent.run_completed_at);
    }

    const status = runCli(root, ['status', '--json']);
    assert.equal(status.status, 0, `status failed:\n${status.combined}`);
    const parsedStatus = JSON.parse(status.stdout);
    assert.equal(parsedStatus.continuous_session.runs_completed, 3);
    assert.equal(parsedStatus.continuous_session.status, 'completed');
  });

  it('AT-CONT-CKPT-001: run --continuous auto-checkpoints accepted authoritative turns between role handoffs', () => {
    const root = makeProject({ changingAgent: true });

    const run = runCli(root, [
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
    ]);

    assert.equal(run.status, 0, `continuous auto-checkpoint run failed:\n${run.combined}`);
    assert.doesNotMatch(run.combined, /Authoritative\/proposed turns require a clean baseline/);
    assert.doesNotMatch(run.combined, /checkpoint-turn --turn/);

    const session = readJson(root, '.agentxchain/continuous-session.json');
    assert.equal(session.status, 'completed');
    assert.equal(session.runs_completed, 1);

    const runHistory = readJsonl(root, '.agentxchain/run-history.jsonl');
    assert.equal(runHistory.length, 1);
    for (const entry of runHistory) {
      assert.equal(entry.status, 'completed');
    }

    const events = readJsonl(root, '.agentxchain/events.jsonl');
    const checkpointEvents = events.filter((entry) => entry.event_type === 'turn_checkpointed');
    assert.ok(checkpointEvents.length >= 3, `expected checkpoint events for each accepted turn, got ${checkpointEvents.length}`);

    const logSubjects = execSync('git log --pretty=%s', { cwd: root, encoding: 'utf8' })
      .trim()
      .split('\n')
      .filter(Boolean);
    const checkpointSubjects = logSubjects.filter((line) => line.startsWith('checkpoint: '));
    assert.ok(checkpointSubjects.length >= 3, `expected checkpoint commits in git log, got ${checkpointSubjects.length}`);
    assert.ok(checkpointSubjects.some((line) => /\(role=pm, phase=planning, runtime=[^)]+\)/.test(line)));
    assert.ok(checkpointSubjects.some((line) => /\(role=dev, phase=implementation, runtime=[^)]+\)/.test(line)));
    assert.ok(checkpointSubjects.some((line) => /\(role=qa, phase=qa, runtime=[^)]+\)/.test(line)));
  });

  it('AT-VCONT-007: SIGINT stops the continuous loop cleanly after the current in-flight turn', async () => {
    const root = makeProject({ slowAgent: true });

    const child = spawn(process.execPath, [
      CLI_BIN,
      'run',
      '--continuous',
      '--vision',
      '.planning/VISION.md',
      '--max-runs',
      '100',
      '--max-idle-cycles',
      '1',
      '--poll-seconds',
      '0',
    ], {
      cwd: root,
      env: { ...process.env, NO_COLOR: '1', NODE_NO_WARNINGS: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

    const sessionPath = join(root, '.agentxchain', 'continuous-session.json');
    const started = Date.now();
    while (!existsSync(sessionPath)) {
      if (Date.now() - started > 10000) {
        throw new Error(`continuous session never started\n${stdout}${stderr}`);
      }
      await sleep(50);
    }

    await sleep(250);
    child.kill('SIGINT');

    const close = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error(`continuous SIGINT test timed out\n${stdout}${stderr}`));
      }, 30000);
      child.on('error', reject);
      child.on('close', (code, signal) => {
        clearTimeout(timeout);
        resolve({ code, signal });
      });
    });

    assert.deepEqual(close, { code: 0, signal: null });
    assert.match(stdout, /Stopping continuous loop \(finishing current work\)/);
    assert.match(stdout, /Continuous loop stopped by operator/);

    const session = readJson(root, '.agentxchain/continuous-session.json');
    assert.equal(session.status, 'stopped');
    assert.equal(session.runs_completed, 0);
  });
});
