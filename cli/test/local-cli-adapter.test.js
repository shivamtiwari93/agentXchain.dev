import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';

import {
  dispatchLocalCli,
  resolveStartupWatchdogMs,
  saveDispatchLogs,
  resolvePromptTransport,
} from '../src/lib/adapters/local-cli-adapter.js';
import { writeDispatchBundle } from '../src/lib/dispatch-bundle.js';
import {
  getDispatchTurnDir,
  getTurnStagingResultPath,
} from '../src/lib/turn-paths.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeTmpDir() {
  const dir = join(tmpdir(), `axc-cli-adapter-test-${randomBytes(6).toString('hex')}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function makeState(overrides = {}) {
  return {
    run_id: 'run_test123',
    status: 'active',
    phase: 'implementation',
    accepted_integration_ref: 'git:abc123',
    current_turn: {
      turn_id: 'turn_test001',
      assigned_role: 'dev',
      status: 'running',
      attempt: 1,
      started_at: new Date().toISOString(),
      deadline_at: new Date(Date.now() + 600000).toISOString(), // 10 min
      runtime_id: 'local-dev',
    },
    last_completed_turn_id: null,
    blocked_on: null,
    escalation: null,
    budget_status: { spent_usd: 0, remaining_usd: 50 },
    phase_gate_status: {},
    ...overrides,
  };
}

function makeConfig(runtimeOverrides = {}) {
  return {
    schema_version: 4,
    protocol_mode: 'governed',
    project: { id: 'test-project', name: 'Test', default_branch: 'main' },
    roles: {
      dev: {
        title: 'Developer',
        mandate: 'Implement approved work.',
        write_authority: 'authoritative',
        runtime_class: 'local_cli',
        runtime_id: 'local-dev',
      },
    },
    runtimes: {
      'local-dev': {
        type: 'local_cli',
        command: ['node', '-e', 'console.log("hello")'],
        cwd: '.',
        ...runtimeOverrides,
      },
    },
    routing: {
      implementation: { entry_role: 'dev', allowed_next_roles: ['dev', 'qa', 'human'] },
    },
    gates: {},
    budget: { per_turn_max_usd: 2.0, per_run_max_usd: 50.0 },
    rules: { challenge_required: true, max_turn_retries: 2 },
  };
}

function makeValidTurnResult(state) {
  const turn = state.current_turn;
  return {
    schema_version: '1.0',
    run_id: state.run_id,
    turn_id: turn.turn_id,
    role: turn.assigned_role,
    runtime_id: turn.runtime_id,
    status: 'completed',
    summary: 'Implemented feature X.',
    decisions: [],
    objections: [],
    files_changed: [],
    artifacts_created: [],
    verification: { status: 'pass', commands: ['npm test'], evidence_summary: 'All tests pass.' },
    artifact: { type: 'workspace', ref: 'git:dirty' },
    proposed_next_role: 'qa',
    phase_transition_request: null,
    needs_human_reason: null,
    cost: { input_tokens: 500, output_tokens: 200, usd: 0.10 },
  };
}

function setupDispatchBundle(root, state, config) {
  writeDispatchBundle(root, state, config);
}

function stagingPathFor(state) {
  return getTurnStagingResultPath(state.current_turn.turn_id);
}

function dispatchDirFor(state) {
  return getDispatchTurnDir(state.current_turn.turn_id);
}

let tmpDirs = [];
function createAndTrack() {
  const dir = makeTmpDir();
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tmpDirs) {
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }
  tmpDirs = [];
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('local-cli-adapter', () => {
  describe('dispatchLocalCli', () => {
    it('returns error when no active turn', async () => {
      const root = createAndTrack();
      const state = makeState();
      delete state.current_turn;
      const config = makeConfig();

      const result = await dispatchLocalCli(root, state, config);
      assert.equal(result.ok, false);
      assert.match(result.error, /No active turn/);
    });

    it('returns error when runtime not found', async () => {
      const root = createAndTrack();
      const state = makeState();
      const config = makeConfig();
      delete config.runtimes['local-dev'];

      const result = await dispatchLocalCli(root, state, config);
      assert.equal(result.ok, false);
      assert.match(result.error, /not found in config/);
    });

    it('returns error when dispatch bundle missing', async () => {
      const root = createAndTrack();
      const state = makeState();
      const config = makeConfig();

      const result = await dispatchLocalCli(root, state, config);
      assert.equal(result.ok, false);
      assert.match(result.error, /Dispatch bundle not found/);
    });

    it('returns error when command is not configured', async () => {
      const root = createAndTrack();
      const state = makeState();
      const config = makeConfig({ command: undefined });
      setupDispatchBundle(root, state, config);

      const result = await dispatchLocalCli(root, state, config);
      assert.equal(result.ok, false);
      assert.match(result.error, /Cannot resolve CLI command/);
    });

    it('succeeds when subprocess writes staged result', async () => {
      const root = createAndTrack();
      const state = makeState();
      const turnResult = makeValidTurnResult(state);

      // Command: node script that writes the staged result
      const scriptContent = `
        const fs = require('fs');
        const path = require('path');
        const stagingDir = path.join(process.cwd(), ${JSON.stringify(join('.agentxchain', 'staging', state.current_turn.turn_id))});
        fs.mkdirSync(stagingDir, { recursive: true });
        fs.writeFileSync(
          path.join(stagingDir, 'turn-result.json'),
          JSON.stringify(${JSON.stringify(turnResult)}, null, 2)
        );
        console.log('Turn result written.');
      `;
      const scriptPath = join(root, '_test_agent.js');
      writeFileSync(scriptPath, scriptContent);

      const config = makeConfig({ command: ['node', scriptPath] });
      setupDispatchBundle(root, state, config);

      const result = await dispatchLocalCli(root, state, config);
      assert.equal(result.ok, true);
      assert.equal(result.aborted, false);
      assert.equal(result.timedOut, false);
      assert.equal(result.exitCode, 0);

      // Verify staged result was written
      const staged = readJson(join(root, stagingPathFor(state)));
      assert.equal(staged.run_id, state.run_id);
      assert.equal(staged.turn_id, state.current_turn.turn_id);
    });

    it('fails when subprocess exits without writing staged result', async () => {
      const root = createAndTrack();
      const state = makeState();

      const scriptPath = join(root, '_noop.js');
      writeFileSync(scriptPath, 'console.log("no result written");');

      const config = makeConfig({
        command: ['node', scriptPath],
      });
      config.run_loop = { startup_watchdog_ms: 60_000 };
      setupDispatchBundle(root, state, config);

      const result = await dispatchLocalCli(root, state, config);
      assert.equal(result.ok, false);
      assert.match(result.error, /without writing a staged turn result/);
      assert.equal(result.exitCode, 0); // process succeeded but no result
    });

    it('fails when subprocess exits with nonzero code and no staged result', async () => {
      const root = createAndTrack();
      const state = makeState();

      const scriptPath = join(root, '_fail.js');
      writeFileSync(scriptPath, 'process.exit(1);');

      const config = makeConfig({
        command: ['node', scriptPath],
      });
      setupDispatchBundle(root, state, config);

      const result = await dispatchLocalCli(root, state, config);
      assert.equal(result.ok, false);
      assert.equal(result.exitCode, 1);
    });

    it('succeeds even when subprocess exits nonzero IF staged result exists', async () => {
      const root = createAndTrack();
      const state = makeState();
      const turnResult = makeValidTurnResult(state);

      // Script writes result then exits with error code
      const scriptContent = `
        const fs = require('fs');
        const path = require('path');
        const stagingDir = path.join(process.cwd(), ${JSON.stringify(join('.agentxchain', 'staging', state.current_turn.turn_id))});
        fs.mkdirSync(stagingDir, { recursive: true });
        fs.writeFileSync(
          path.join(stagingDir, 'turn-result.json'),
          JSON.stringify(${JSON.stringify(turnResult)}, null, 2)
        );
        process.exit(1);
      `;
      const scriptPath = join(root, '_test_agent.js');
      writeFileSync(scriptPath, scriptContent);

      const config = makeConfig({ command: ['node', scriptPath] });
      setupDispatchBundle(root, state, config);

      const result = await dispatchLocalCli(root, state, config);
      assert.equal(result.ok, true);
      assert.equal(result.exitCode, 1);
    });

    it('captures stdout and stderr in logs', async () => {
      const root = createAndTrack();
      const state = makeState();

      const scriptPath = join(root, '_log.js');
      writeFileSync(scriptPath, 'console.log("out1"); console.error("err1");');

      const config = makeConfig({
        command: ['node', scriptPath],
      });
      setupDispatchBundle(root, state, config);

      const result = await dispatchLocalCli(root, state, config);
      assert.ok(result.logs.length > 0);
      const fullLog = result.logs.join('');
      assert.ok(fullLog.includes('out1'));
      assert.ok(fullLog.includes('err1'));
    });

    it('calls onStdout and onStderr callbacks', async () => {
      const root = createAndTrack();
      const state = makeState();
      const stdoutChunks = [];
      const stderrChunks = [];

      const scriptPath = join(root, '_log2.js');
      writeFileSync(scriptPath, 'console.log("hello"); console.error("world");');

      const config = makeConfig({
        command: ['node', scriptPath],
      });
      setupDispatchBundle(root, state, config);

      await dispatchLocalCli(root, state, config, {
        onStdout: (text) => stdoutChunks.push(text),
        onStderr: (text) => stderrChunks.push(text),
      });

      assert.ok(stdoutChunks.join('').includes('hello'));
      assert.ok(stderrChunks.join('').includes('world'));
    });

    it('handles abort signal', async () => {
      const root = createAndTrack();
      const state = makeState();

      // Long-running script
      const scriptPath = join(root, '_long.js');
      writeFileSync(scriptPath, 'setTimeout(() => {}, 30000);');

      const config = makeConfig({
        command: ['node', scriptPath],
      });
      setupDispatchBundle(root, state, config);

      const ac = new AbortController();
      // Abort after 500ms
      setTimeout(() => ac.abort(), 500);

      const result = await dispatchLocalCli(root, state, config, {
        signal: ac.signal,
      });

      assert.equal(result.ok, false);
      assert.equal(result.aborted, true);
    });

    it('handles pre-aborted signal', async () => {
      const root = createAndTrack();
      const state = makeState();
      const config = makeConfig();
      setupDispatchBundle(root, state, config);

      const ac = new AbortController();
      ac.abort(); // Already aborted

      const result = await dispatchLocalCli(root, state, config, {
        signal: ac.signal,
      });

      assert.equal(result.ok, false);
      assert.equal(result.aborted, true);
    });

    it('times out when deadline is very short', async () => {
      const root = createAndTrack();
      const state = makeState({
        current_turn: {
          turn_id: 'turn_test001',
          assigned_role: 'dev',
          status: 'running',
          attempt: 1,
          started_at: new Date().toISOString(),
          deadline_at: new Date(Date.now() + 1000).toISOString(), // 1s
          runtime_id: 'local-dev',
        },
      });

      // Long-running script
      const scriptPath = join(root, '_slow.js');
      writeFileSync(scriptPath, 'setTimeout(() => {}, 30000);');

      const config = makeConfig({
        command: ['node', scriptPath],
      });
      setupDispatchBundle(root, state, config);

      const result = await dispatchLocalCli(root, state, config);
      assert.equal(result.ok, false);
      assert.equal(result.timedOut, true);
    });

    it('clears previous staging file before dispatch', async () => {
      const root = createAndTrack();
      const state = makeState();

      // Pre-populate staging with a valid-looking result
      const stagingDir = join(root, '.agentxchain/staging', state.current_turn.turn_id);
      mkdirSync(stagingDir, { recursive: true });
      writeFileSync(join(root, stagingPathFor(state)),
        JSON.stringify({ old: true, schema_version: '1.0' }, null, 2));

      // Subprocess that does NOT write a result
      const scriptPath = join(root, '_noop2.js');
      writeFileSync(scriptPath, 'console.log("noop");');

      const config = makeConfig({
        command: ['node', scriptPath],
      });
      setupDispatchBundle(root, state, config);

      const result = await dispatchLocalCli(root, state, config);
      // Should fail because the old file was cleared to "{}" (2 bytes)
      assert.equal(result.ok, false);
      assert.match(result.error, /without writing/);
    });

    it('uses cwd from runtime config', async () => {
      const root = createAndTrack();
      const state = makeState();
      const turnResult = makeValidTurnResult(state);
      const stagingDir = join(root, '.agentxchain', 'staging', state.current_turn.turn_id);

      // Create a subdirectory
      const subDir = join(root, 'workspace');
      mkdirSync(subDir, { recursive: true });

      // Script that writes result relative to cwd
      const scriptContent = `
        const fs = require('fs');
        const path = require('path');
        fs.writeFileSync(path.join(process.cwd(), 'cwd-proof.txt'), 'workspace cwd');
        const stagingDir = ${JSON.stringify(stagingDir)};
        fs.mkdirSync(stagingDir, { recursive: true });
        fs.writeFileSync(
          path.join(stagingDir, 'turn-result.json'),
          JSON.stringify(${JSON.stringify(turnResult)}, null, 2)
        );
      `;
      const scriptPath = join(root, '_test_agent.js');
      writeFileSync(scriptPath, scriptContent);

      const config = makeConfig({
        command: ['node', scriptPath],
        cwd: 'workspace',
      });
      setupDispatchBundle(root, state, config);

      const result = await dispatchLocalCli(root, state, config);
      assert.equal(result.ok, true);
      assert.equal(readFileSync(join(subDir, 'cwd-proof.txt'), 'utf8'), 'workspace cwd');
    });

    it('supports string command with separate args', async () => {
      const root = createAndTrack();
      const state = makeState();
      const turnResult = makeValidTurnResult(state);

      const scriptContent = `
        const fs = require('fs');
        const path = require('path');
        const stagingDir = path.join(process.cwd(), ${JSON.stringify(join('.agentxchain', 'staging', state.current_turn.turn_id))});
        fs.mkdirSync(stagingDir, { recursive: true });
        fs.writeFileSync(
          path.join(stagingDir, 'turn-result.json'),
          JSON.stringify(${JSON.stringify(turnResult)}, null, 2)
        );
      `;
      const scriptPath = join(root, '_test_agent.js');
      writeFileSync(scriptPath, scriptContent);

      const config = makeConfig();
      // Override with string command + args
      config.runtimes['local-dev'] = {
        type: 'local_cli',
        command: 'node',
        args: [scriptPath],
        cwd: '.',
      };
      setupDispatchBundle(root, state, config);

      const result = await dispatchLocalCli(root, state, config);
      assert.equal(result.ok, true);
    });

    it('returns error for invalid spawn (nonexistent command)', async () => {
      const root = createAndTrack();
      const state = makeState();

      const config = makeConfig({
        command: ['nonexistent_binary_xyz_12345'],
      });
      setupDispatchBundle(root, state, config);

      const result = await dispatchLocalCli(root, state, config);
      assert.equal(result.ok, false);
      assert.ok(result.error);
      const log = result.logs.join('');
      assert.match(log, /\[adapter:diag\] spawn_prepare /);
      assert.match(log, /"command":"nonexistent_binary_xyz_12345"/);
      assert.match(log, /"prompt_transport":"dispatch_bundle_only"/);
      assert.match(log, /"stdin_bytes":0/);
      assert.match(log, /\[adapter:diag\] spawn_error /);
    });

    it('calls onSpawnAttached only after the child reports a successful spawn', async () => {
      const root = createAndTrack();
      const state = makeState();
      const turnResult = makeValidTurnResult(state);
      const scriptContent = `
        const fs = require('fs');
        const path = require('path');
        const stagingDir = path.join(process.cwd(), ${JSON.stringify(join('.agentxchain', 'staging', state.current_turn.turn_id))});
        fs.mkdirSync(stagingDir, { recursive: true });
        fs.writeFileSync(path.join(stagingDir, 'turn-result.json'), JSON.stringify(${JSON.stringify(turnResult)}, null, 2));
        console.log('spawned');
      `;
      const scriptPath = join(root, '_spawn-success.js');
      writeFileSync(scriptPath, scriptContent);

      const config = makeConfig({
        command: ['node', scriptPath],
      });
      setupDispatchBundle(root, state, config);

      const attached = [];
      const result = await dispatchLocalCli(root, state, config, {
        onSpawnAttached: (details) => attached.push(details),
      });
      assert.equal(result.ok, true);
      assert.equal(attached.length, 1);
      assert.ok(Number.isInteger(attached[0].pid) && attached[0].pid > 0, `expected real child pid, got ${attached[0].pid}`);
      assert.ok(attached[0].at, 'spawn callback should receive an attachment timestamp');
    });

    it('does not call onSpawnAttached when the subprocess never spawns', async () => {
      const root = createAndTrack();
      const state = makeState();
      const config = makeConfig({
        command: ['nonexistent_binary_xyz_spawn_guard'],
      });
      setupDispatchBundle(root, state, config);

      let attachedCalls = 0;
      const result = await dispatchLocalCli(root, state, config, {
        onSpawnAttached: () => {
          attachedCalls += 1;
        },
      });

      assert.equal(result.ok, false);
      assert.equal(result.startupFailure, true);
      assert.equal(result.startupFailureType, 'runtime_spawn_failed');
      assert.equal(attachedCalls, 0, 'spawn callback must not run for a process that never spawned');
    });

    it('records structured diagnostics for a spawn-but-silent subprocess', async () => {
      const root = createAndTrack();
      const state = makeState();
      const scriptPath = join(root, '_silent.js');
      writeFileSync(scriptPath, 'setTimeout(() => process.exit(0), 300);');

      const config = makeConfig({
        command: ['node', scriptPath],
      });
      config.run_loop = { startup_watchdog_ms: 100 };
      setupDispatchBundle(root, state, config);

      const result = await dispatchLocalCli(root, state, config);
      assert.equal(result.ok, false);
      assert.equal(result.startupFailure, true);
      assert.equal(result.startupFailureType, 'no_subprocess_output');
      const log = result.logs.join('');
      assert.match(log, /\[adapter:diag\] spawn_attached /);
      assert.match(log, /"pid":\d+/);
      assert.match(log, /\[adapter:diag\] startup_watchdog_fired /);
      assert.match(log, /"elapsed_since_spawn_ms":[1-9]\d*/);
      assert.match(log, /\[adapter:diag\] process_exit /);
      assert.match(log, /"startup_failure_type":"no_subprocess_output"/);
      assert.match(log, /"stderr_bytes":0/);
    });

    it('treats stderr-only startup as no_subprocess_output and preserves a stderr excerpt', async () => {
      const root = createAndTrack();
      const state = makeState();
      const scriptPath = join(root, '_stderr_only.js');
      writeFileSync(scriptPath, `
        process.stderr.write('boot failed on stderr only\\n');
        process.exit(17);
      `);

      const config = makeConfig({
        command: ['node', scriptPath],
      });
      setupDispatchBundle(root, state, config);

      const firstOutput = [];
      const result = await dispatchLocalCli(root, state, config, {
        onFirstOutput: (details) => firstOutput.push(details),
      });
      assert.equal(result.ok, false);
      assert.equal(result.startupFailure, true);
      assert.equal(result.startupFailureType, 'no_subprocess_output');
      assert.equal(firstOutput.length, 0, 'stderr-only output must not count as startup proof');
      const log = result.logs.join('');
      assert.match(log, /\[stderr\] boot failed on stderr only/);
      assert.match(log, /\[adapter:diag\] process_exit /);
      assert.match(log, /"stderr_excerpt":"boot failed on stderr only\\n"/);
      assert.match(log, /"startup_failure_type":"no_subprocess_output"/);
    });

    it('prefers local_cli runtime startup_watchdog_ms over a tighter global run_loop watchdog', async () => {
      const root = createAndTrack();
      const state = makeState();
      const scriptPath = join(root, '_delayed_output.js');
      writeFileSync(scriptPath, `
        setTimeout(() => console.log("hello"), 120);
        setTimeout(() => process.exit(0), 180);
      `);

      const config = makeConfig({
        command: ['node', scriptPath],
        startup_watchdog_ms: 500,
      });
      config.run_loop = { startup_watchdog_ms: 50 };
      setupDispatchBundle(root, state, config);

      const result = await dispatchLocalCli(root, state, config);
      assert.equal(resolveStartupWatchdogMs(config, config.runtimes['local-dev']), 500);
      assert.equal(result.ok, false);
      assert.equal(result.startupFailure, undefined, 'runtime override must prevent a false startup failure');
      const log = result.logs.join('');
      assert.match(log, /\[adapter:diag\] spawn_attached /);
      assert.match(log, /"startup_watchdog_ms":500/);
      assert.match(log, /\[adapter:diag\] first_output /);
      assert.doesNotMatch(log, /\[adapter:diag\] startup_watchdog_fired /);
    });
  });

  describe('saveDispatchLogs', () => {
    it('writes logs to dispatch directory', () => {
      const root = createAndTrack();
      const state = makeState();
      const logDir = join(root, dispatchDirFor(state));
      mkdirSync(logDir, { recursive: true });

      saveDispatchLogs(root, state.current_turn.turn_id, ['line 1\n', 'line 2\n']);

      const logPath = join(logDir, 'stdout.log');
      assert.ok(existsSync(logPath));
      const content = readFileSync(logPath, 'utf8');
      assert.ok(content.includes('line 1'));
      assert.ok(content.includes('line 2'));
    });

    it('does nothing when dispatch directory missing', () => {
      const root = createAndTrack();
      // Should not throw
      saveDispatchLogs(root, 'turn_missing', ['test']);
    });
  });

  describe('resolvePromptTransport', () => {
    it('returns explicit prompt_transport when set', () => {
      assert.equal(resolvePromptTransport({ command: ['claude'], prompt_transport: 'stdin' }), 'stdin');
      assert.equal(resolvePromptTransport({ command: ['claude'], prompt_transport: 'argv' }), 'argv');
      assert.equal(resolvePromptTransport({ command: ['claude'], prompt_transport: 'dispatch_bundle_only' }), 'dispatch_bundle_only');
    });

    it('infers argv when command contains {prompt}', () => {
      assert.equal(resolvePromptTransport({ command: ['claude', '--print', '-p', '{prompt}'] }), 'argv');
    });

    it('infers argv when string command + args contain {prompt}', () => {
      assert.equal(resolvePromptTransport({ command: 'claude', args: ['--print', '-p', '{prompt}'] }), 'argv');
    });

    it('infers dispatch_bundle_only when no {prompt} placeholder', () => {
      assert.equal(resolvePromptTransport({ command: ['claude', '--print'] }), 'dispatch_bundle_only');
    });

    it('ignores invalid prompt_transport and falls back to inference', () => {
      assert.equal(resolvePromptTransport({ command: ['claude', '{prompt}'], prompt_transport: 'magic' }), 'argv');
      assert.equal(resolvePromptTransport({ command: ['claude'], prompt_transport: 'magic' }), 'dispatch_bundle_only');
    });
  });

  describe('prompt delivery via stdin transport', () => {
    it('delivers prompt text to subprocess stdin', async () => {
      const root = createAndTrack();
      const state = makeState();
      const turnResult = makeValidTurnResult(state);

      // Script reads stdin and writes it as evidence in the staged result
      const scriptContent = `
        const fs = require('fs');
        const path = require('path');
        let input = '';
        process.stdin.setEncoding('utf8');
        process.stdin.on('data', (chunk) => { input += chunk; });
        process.stdin.on('end', () => {
          const stagingDir = path.join(process.cwd(), ${JSON.stringify(join('.agentxchain', 'staging', state.current_turn.turn_id))});
          fs.mkdirSync(stagingDir, { recursive: true });
          const result = ${JSON.stringify(turnResult)};
          result.summary = 'stdin_received:' + input.substring(0, 50);
          fs.writeFileSync(
            path.join(stagingDir, 'turn-result.json'),
            JSON.stringify(result, null, 2)
          );
        });
      `;
      const scriptPath = join(root, '_stdin_test.js');
      writeFileSync(scriptPath, scriptContent);

      const config = makeConfig({
        command: ['node', scriptPath],
        prompt_transport: 'stdin',
      });
      setupDispatchBundle(root, state, config);

      const result = await dispatchLocalCli(root, state, config);
      assert.equal(result.ok, true);
      assert.match(result.logs.join(''), /\[adapter:diag\] spawn_prepare [^\n]*"stdin_bytes":[1-9]\d*/);
      assert.match(result.logs.join(''), /\[adapter:diag\] first_output [^\n]*"stream":"staged_result"[^\n]*"startup_latency_ms":[1-9]\d*/);

      // Verify the subprocess actually received stdin content
      const staged = JSON.parse(readFileSync(join(root, stagingPathFor(state)), 'utf8'));
      assert.ok(staged.summary.startsWith('stdin_received:'), 'Subprocess should have received prompt via stdin');
      assert.ok(staged.summary.length > 'stdin_received:'.length, 'Stdin should contain prompt text');
    });

    it('does NOT deliver prompt via stdin when transport is argv', async () => {
      const root = createAndTrack();
      const state = makeState();
      const turnResult = makeValidTurnResult(state);

      // Script that checks if stdin has data (it shouldn't for argv transport)
      const scriptContent = `
        const fs = require('fs');
        const path = require('path');
        let gotStdin = false;
        process.stdin.setEncoding('utf8');
        process.stdin.on('data', () => { gotStdin = true; });
        // stdin will close immediately if nothing is written
        process.stdin.on('end', () => {
          const stagingDir = path.join(process.cwd(), ${JSON.stringify(join('.agentxchain', 'staging', state.current_turn.turn_id))});
          fs.mkdirSync(stagingDir, { recursive: true });
          const result = ${JSON.stringify(turnResult)};
          result.summary = 'stdin_got_data:' + gotStdin;
          fs.writeFileSync(
            path.join(stagingDir, 'turn-result.json'),
            JSON.stringify(result, null, 2)
          );
        });
      `;
      const scriptPath = join(root, '_no_stdin_test.js');
      writeFileSync(scriptPath, scriptContent);

      const config = makeConfig({
        command: ['node', scriptPath],
        prompt_transport: 'argv',
      });
      setupDispatchBundle(root, state, config);

      const result = await dispatchLocalCli(root, state, config);
      assert.equal(result.ok, true);

      const staged = JSON.parse(readFileSync(join(root, stagingPathFor(state)), 'utf8'));
      assert.equal(staged.summary, 'stdin_got_data:false', 'Subprocess should NOT receive stdin for argv transport');
    });
  });
});
