import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';
import { pathToFileURL } from 'node:url';

import {
  dispatchLocalCli,
  resolveStartupHeartbeatMs,
  resolveStartupWatchdogMs,
  saveDispatchLogs,
  resolvePromptTransport,
  validateLocalCliCommandCompatibility,
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

function writeClaudeShim(root, contents) {
  const shimDir = join(root, 'shim-bin');
  mkdirSync(shimDir, { recursive: true });
  const shimPath = join(shimDir, 'claude');
  writeFileSync(shimPath, contents);
  chmodSync(shimPath, 0o755);
  return shimPath;
}

function writeCodexShim(root, contents) {
  const shimDir = join(root, 'shim-bin');
  mkdirSync(shimDir, { recursive: true });
  const shimPath = join(shimDir, 'codex');
  writeFileSync(shimPath, contents);
  chmodSync(shimPath, 0o755);
  return shimPath;
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function parseDiagPayloads(logs, label) {
  const prefix = `[adapter:diag] ${label} `;
  return (Array.isArray(logs) ? logs : [])
    .filter((line) => typeof line === 'string' && line.startsWith(prefix))
    .map((line) => JSON.parse(line.slice(prefix.length)));
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

    it('blocks Claude stream-json --print commands that are missing --verbose before spawning', async () => {
      const root = createAndTrack();
      const state = makeState();
      const shim = writeClaudeShim(root, `#!/bin/sh
echo "should not spawn"
exit 0
`);
      const config = makeConfig({
        command: [shim, '--print', '--output-format', 'stream-json', '--dangerously-skip-permissions'],
        prompt_transport: 'stdin',
      });
      setupDispatchBundle(root, state, config);

      const result = await dispatchLocalCli(root, state, config);

      assert.equal(result.ok, false);
      assert.equal(result.blocked, true);
      assert.equal(result.startupFailure, undefined);
      assert.equal(result.classified?.error_class, 'local_cli_command_incompatible');
      assert.match(result.error, /--verbose/);
      const log = result.logs.join('');
      assert.match(log, /\[adapter:diag\] command_compatibility_failed /);
      assert.doesNotMatch(log, /\[adapter:diag\] spawn_prepare /);
      assert.doesNotMatch(log, /should not spawn/);
    });

    it('fails fast before governed spawn only when the Claude smoke probe observes a hang', async () => {
      const root = createAndTrack();
      const state = makeState();
      const shim = writeClaudeShim(root, `#!/bin/sh
cat > /dev/null
exec sleep 30
`);
      const config = makeConfig({
        command: [shim, '--print', '--dangerously-skip-permissions'],
        prompt_transport: 'stdin',
      });
      setupDispatchBundle(root, state, config);

      const originalEnv = {
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
        CLAUDE_API_KEY: process.env.CLAUDE_API_KEY,
        CLAUDE_CODE_OAUTH_TOKEN: process.env.CLAUDE_CODE_OAUTH_TOKEN,
        CLAUDE_CODE_USE_VERTEX: process.env.CLAUDE_CODE_USE_VERTEX,
        CLAUDE_CODE_USE_BEDROCK: process.env.CLAUDE_CODE_USE_BEDROCK,
        AGENTXCHAIN_CLAUDE_AUTH_PROBE_TIMEOUT_MS: process.env.AGENTXCHAIN_CLAUDE_AUTH_PROBE_TIMEOUT_MS,
      };
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.CLAUDE_API_KEY;
      delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
      delete process.env.CLAUDE_CODE_USE_VERTEX;
      delete process.env.CLAUDE_CODE_USE_BEDROCK;
      process.env.AGENTXCHAIN_CLAUDE_AUTH_PROBE_TIMEOUT_MS = '500';

      try {
        const result = await dispatchLocalCli(root, state, config);
        assert.equal(result.ok, false);
        assert.match(result.error, /no env-based auth/i);
        assert.match(result.error, /ANTHROPIC_API_KEY/);
        assert.match(result.error, /--bare/);

        const payloads = parseDiagPayloads(result.logs, 'claude_auth_preflight_failed');
        assert.equal(payloads.length, 1);
        assert.equal(payloads[0].auth_env_present.ANTHROPIC_API_KEY, false);
        assert.equal(payloads[0].smoke_probe.kind, 'hang');
        assert.match(payloads[0].recommendation, /CLAUDE_CODE_OAUTH_TOKEN/);
      } finally {
        for (const [key, value] of Object.entries(originalEnv)) {
          if (value === undefined) {
            delete process.env[key];
          } else {
            process.env[key] = value;
          }
        }
      }
    });

    it('classifies Claude stdout auth failures as typed dispatch blockers instead of retryable turn failures', async () => {
      const root = createAndTrack();
      const state = makeState();
      const shim = writeClaudeShim(root, `#!/bin/sh
cat > /dev/null
printf '%s\\n' '{"type":"assistant","message":{"content":[{"type":"text","text":"Failed to authenticate. API Error: 401 {\\"type\\":\\"error\\",\\"error\\":{\\"type\\":\\"authentication_error\\",\\"message\\":\\"Invalid authentication credentials\\"}}"}]},"error":"authentication_failed"}'
exit 1
`);
      const config = makeConfig({
        command: [shim, '--print', '--output-format', 'stream-json', '--verbose'],
        prompt_transport: 'stdin',
      });
      setupDispatchBundle(root, state, config);

      const originalEnv = {
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
        CLAUDE_API_KEY: process.env.CLAUDE_API_KEY,
        CLAUDE_CODE_OAUTH_TOKEN: process.env.CLAUDE_CODE_OAUTH_TOKEN,
        CLAUDE_CODE_USE_VERTEX: process.env.CLAUDE_CODE_USE_VERTEX,
        CLAUDE_CODE_USE_BEDROCK: process.env.CLAUDE_CODE_USE_BEDROCK,
      };
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.CLAUDE_API_KEY;
      process.env.CLAUDE_CODE_OAUTH_TOKEN = 'expired-oauth-token';
      delete process.env.CLAUDE_CODE_USE_VERTEX;
      delete process.env.CLAUDE_CODE_USE_BEDROCK;

      try {
        const result = await dispatchLocalCli(root, state, config);
        assert.equal(result.ok, false);
        assert.equal(result.blocked, true);
        assert.equal(result.classified?.error_class, 'claude_auth_failed');
        assert.match(result.error, /Claude local_cli authentication failed/);
        assert.match(result.classified.recovery, /ANTHROPIC_API_KEY|CLAUDE_CODE_OAUTH_TOKEN/);
      } finally {
        for (const [key, value] of Object.entries(originalEnv)) {
          if (value === undefined) {
            delete process.env[key];
          } else {
            process.env[key] = value;
          }
        }
      }
    });

    it('classifies Codex --json stdout auth failures as typed dispatch blockers instead of retryable turn failures', async () => {
      const root = createAndTrack();
      const state = makeState();
      const shim = writeCodexShim(root, `#!/bin/sh
cat > /dev/null
printf '%s\\n' '{"error":"unauthorized","message":"Invalid API key for OpenAI request","status":401}'
exit 1
`);
      const config = makeConfig({
        command: [shim, 'exec', '--json'],
        prompt_transport: 'stdin',
      });
      setupDispatchBundle(root, state, config);

      const result = await dispatchLocalCli(root, state, config);

      assert.equal(result.ok, false);
      assert.equal(result.blocked, true);
      assert.equal(result.startupFailure, undefined);
      assert.equal(result.classified?.error_class, 'codex_auth_failed');
      assert.match(result.error, /Codex local_cli authentication failed/);
      assert.match(result.classified.recovery, /OPENAI_API_KEY/);
    });

    it('blocks Codex runtimes missing the exec subcommand before spawning', async () => {
      const root = createAndTrack();
      const state = makeState();
      const shim = writeCodexShim(root, `#!/bin/sh
printf '%s\\n' 'unexpected spawn' >&2
exit 99
`);
      const config = makeConfig({
        command: [shim, '--json'],
        prompt_transport: 'stdin',
      });
      setupDispatchBundle(root, state, config);

      const result = await dispatchLocalCli(root, state, config);

      assert.equal(result.ok, false);
      assert.equal(result.blocked, true);
      assert.equal(result.exitCode, undefined);
      assert.equal(result.classified?.error_class, 'local_cli_command_incompatible');
      assert.match(result.classified.recovery, /codex exec/);
      assert.ok(
        result.logs.some((line) => line.includes('command_compatibility_failed')),
        'compatibility failure should be logged before spawn',
      );
    });

    it('BUG-113 classifies Claude Node runtime incompatibility as a typed dispatch blocker instead of a ghost turn', async () => {
      const root = createAndTrack();
      const state = makeState();
      const shim = writeClaudeShim(root, `#!/bin/sh
cat > /dev/null
printf '%s\\n' 'file:///usr/local/lib/node_modules/@anthropic-ai/claude-code/cli.js:8' >&2
printf '%s\\n' 'var VY=(q,K,_)=>{if(K!=null){if(typeof K!=="object"&&typeof K!=="function")throw TypeError("Object expected to be assigned to "using" declaration");var Y;if(_)Y=K[Symbol.asyncDispose];if(Y===void 0)Y=K[Symbol.dispose];if(typeof Y!=="function")throw TypeError("Object not disposable");q.push([_,Y,K])}};' >&2
exit 1
`);
      const config = makeConfig({
        command: [shim, '--print', '--output-format', 'stream-json', '--verbose'],
        prompt_transport: 'stdin',
      });
      setupDispatchBundle(root, state, config);

      const originalEnv = {
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
        CLAUDE_API_KEY: process.env.CLAUDE_API_KEY,
        CLAUDE_CODE_OAUTH_TOKEN: process.env.CLAUDE_CODE_OAUTH_TOKEN,
        CLAUDE_CODE_USE_VERTEX: process.env.CLAUDE_CODE_USE_VERTEX,
        CLAUDE_CODE_USE_BEDROCK: process.env.CLAUDE_CODE_USE_BEDROCK,
      };
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.CLAUDE_API_KEY;
      process.env.CLAUDE_CODE_OAUTH_TOKEN = 'valid-shape-token';
      delete process.env.CLAUDE_CODE_USE_VERTEX;
      delete process.env.CLAUDE_CODE_USE_BEDROCK;

      try {
        const result = await dispatchLocalCli(root, state, config);
        assert.equal(result.ok, false);
        assert.equal(result.blocked, true);
        assert.equal(result.startupFailure, undefined);
        assert.equal(result.classified?.error_class, 'claude_node_incompatible');
        assert.match(result.error, /Node\.js 20\.5\+/);
      } finally {
        for (const [key, value] of Object.entries(originalEnv)) {
          if (value === undefined) {
            delete process.env[key];
          } else {
            process.env[key] = value;
          }
        }
      }
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

    it('succeeds when Codex exec --json emits diagnostic JSON and writes a staged result', async () => {
      const root = createAndTrack();
      const state = makeState();
      const turnResult = makeValidTurnResult(state);
      const shim = writeCodexShim(root, `#!/bin/sh
cat > /dev/null
mkdir -p ${JSON.stringify(join(root, '.agentxchain', 'staging', state.current_turn.turn_id))}
cat > ${JSON.stringify(join(root, stagingPathFor(state)))} <<'JSON'
${JSON.stringify(turnResult, null, 2)}
JSON
printf '%s\\n' '{"type":"message","message":"turn result staged"}'
exit 0
`);
      const config = makeConfig({
        command: [shim, 'exec', '--json'],
        prompt_transport: 'stdin',
      });
      setupDispatchBundle(root, state, config);

      const result = await dispatchLocalCli(root, state, config);

      assert.equal(result.ok, true);
      assert.equal(result.aborted, false);
      assert.equal(result.timedOut, false);
      const staged = readJson(join(root, stagingPathFor(state)));
      assert.equal(staged.runtime_id, state.current_turn.runtime_id);
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

    it('clears abort SIGKILL timer after a subprocess exits on SIGTERM', async () => {
      const root = createAndTrack();
      const helperPath = join(root, '_abort_sigkill_timer_helper.mjs');
      const childPath = join(root, '_abort_graceful_child.js');
      const adapterUrl = pathToFileURL(join(import.meta.dirname, '..', 'src', 'lib', 'adapters', 'local-cli-adapter.js')).href;
      const bundleUrl = pathToFileURL(join(import.meta.dirname, '..', 'src', 'lib', 'dispatch-bundle.js')).href;

      writeFileSync(childPath, 'setInterval(() => {}, 1000);');
      writeFileSync(helperPath, `
        import { dispatchLocalCli } from ${JSON.stringify(adapterUrl)};
        import { writeDispatchBundle } from ${JSON.stringify(bundleUrl)};

        const root = process.argv[2];
        const childPath = ${JSON.stringify(childPath)};
        const state = {
          run_id: 'run_abort_timer',
          status: 'active',
          phase: 'implementation',
          accepted_integration_ref: 'git:abc123',
          current_turn: {
            turn_id: 'turn_abort_timer',
            assigned_role: 'dev',
            status: 'running',
            attempt: 1,
            started_at: new Date().toISOString(),
            deadline_at: new Date(Date.now() + 600000).toISOString(),
            runtime_id: 'local-dev',
          },
          budget_status: { spent_usd: 0, remaining_usd: 50 },
          phase_gate_status: {},
        };
        const config = {
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
              command: ['node', childPath],
              cwd: '.',
            },
          },
          routing: {
            implementation: { entry_role: 'dev', allowed_next_roles: ['dev', 'qa', 'human'] },
          },
          gates: {},
          budget: { per_turn_max_usd: 2.0, per_run_max_usd: 50.0 },
          rules: { challenge_required: true, max_turn_retries: 2 },
        };

        writeDispatchBundle(root, state, config);
        const ac = new AbortController();
        setTimeout(() => ac.abort(), 50);
        const result = await dispatchLocalCli(root, state, config, { signal: ac.signal });
        if (!result.aborted) {
          console.error(JSON.stringify(result, null, 2));
          process.exit(2);
        }
      `);

      const { execFileSync } = await import('node:child_process');
      assert.doesNotThrow(() => {
        execFileSync(process.execPath, [helperPath, root], {
          cwd: root,
          timeout: 2500,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      }, 'helper process must exit promptly after abort; stale abort SIGKILL timers hold it open');
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
      const [exitDiagnostic] = parseDiagPayloads(result.logs, 'process_exit');
      assert.equal(exitDiagnostic.watchdog_fired, true);
      assert.equal(exitDiagnostic.exit_signal, 'SIGTERM');
      assert.equal(exitDiagnostic.signal, 'SIGTERM');
      assert.equal(exitDiagnostic.first_output_stream, null);
    });

    it('SIGKILLs a startup-watchdog subprocess that ignores SIGTERM before the turn deadline', async () => {
      const root = createAndTrack();
      const state = makeState();
      const scriptPath = join(root, '_ignore_sigterm_silent.js');
      writeFileSync(scriptPath, `
        process.on('SIGTERM', () => {});
        setInterval(() => {}, 1000);
      `);

      const config = makeConfig({
        command: ['node', scriptPath],
      });
      config.run_loop = { startup_watchdog_ms: 100 };
      setupDispatchBundle(root, state, config);

      const startedAt = Date.now();
      const result = await dispatchLocalCli(root, state, config, {
        startupWatchdogKillGraceMs: 100,
      });
      const elapsedMs = Date.now() - startedAt;

      assert.equal(result.ok, false);
      assert.equal(result.startupFailure, true);
      assert.equal(result.startupFailureType, 'no_subprocess_output');
      assert.ok(
        elapsedMs < 2000,
        `startup watchdog SIGKILL path must return promptly, not wait for the turn deadline; elapsed=${elapsedMs}ms`,
      );

      const log = result.logs.join('');
      assert.match(log, /\[adapter:diag\] startup_watchdog_fired /);
      assert.match(log, /"startup_watchdog_sigkill_grace_ms":100/);
      assert.match(log, /\[adapter:diag\] startup_watchdog_sigkill /);
      assert.match(log, /\[adapter:diag\] process_exit /);

      const [exitDiagnostic] = parseDiagPayloads(result.logs, 'process_exit');
      assert.equal(exitDiagnostic.watchdog_fired, true);
      assert.equal(exitDiagnostic.exit_signal, 'SIGKILL');
      assert.equal(exitDiagnostic.signal, 'SIGKILL');
      assert.equal(exitDiagnostic.first_output_stream, null);
      assert.equal(exitDiagnostic.startup_failure_type, 'no_subprocess_output');
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
      const [exitDiagnostic] = parseDiagPayloads(result.logs, 'process_exit');
      assert.equal(exitDiagnostic.watchdog_fired, false);
      assert.equal(exitDiagnostic.exit_signal, null);
      assert.equal(exitDiagnostic.first_output_stream, null);
    });

    it('emits startup heartbeat diagnostics during pre-output subprocess silence without marking startup proof', async () => {
      const root = createAndTrack();
      const state = makeState();
      const scriptPath = join(root, '_silent_then_exit.js');
      writeFileSync(scriptPath, 'setTimeout(() => process.exit(0), 180);');

      const config = makeConfig({
        command: ['node', scriptPath],
      });
      config.run_loop = {
        startup_watchdog_ms: 1000,
        startup_heartbeat_ms: 40,
      };
      setupDispatchBundle(root, state, config);

      const heartbeats = [];
      const firstOutput = [];
      const result = await dispatchLocalCli(root, state, config, {
        onStartupHeartbeat: (payload) => heartbeats.push(payload),
        onFirstOutput: (details) => firstOutput.push(details),
      });

      assert.equal(result.ok, false);
      assert.equal(result.startupFailure, true);
      assert.equal(result.startupFailureType, 'no_subprocess_output');
      assert.ok(heartbeats.length >= 1, 'expected at least one startup heartbeat before silent process exit');
      assert.equal(firstOutput.length, 0, 'heartbeat must not count as first-output proof');
      const heartbeatPayloads = parseDiagPayloads(result.logs, 'startup_heartbeat');
      assert.ok(heartbeatPayloads.length >= 1, 'startup heartbeat diagnostics must be written to adapter logs');
      assert.equal(heartbeatPayloads[0].startup_heartbeat_ms, 40);
      assert.equal(heartbeatPayloads[0].startup_watchdog_ms, 1000);
      const [exitDiagnostic] = parseDiagPayloads(result.logs, 'process_exit');
      assert.equal(exitDiagnostic.first_output_stream, null);
      assert.equal(exitDiagnostic.watchdog_fired, false);
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

    it('uses a 180s default startup watchdog for realistic slow Claude prompt processing', () => {
      const config = makeConfig();
      assert.equal(resolveStartupWatchdogMs(config, config.runtimes['local-dev']), 180_000);
    });

    it('resolves startup heartbeat interval with runtime over global over default precedence', () => {
      const config = makeConfig({ startup_heartbeat_ms: 12_000 });
      config.run_loop = { startup_heartbeat_ms: 20_000 };
      assert.equal(resolveStartupHeartbeatMs(config, config.runtimes['local-dev']), 12_000);
      delete config.runtimes['local-dev'].startup_heartbeat_ms;
      assert.equal(resolveStartupHeartbeatMs(config, config.runtimes['local-dev']), 20_000);
      delete config.run_loop.startup_heartbeat_ms;
      assert.equal(resolveStartupHeartbeatMs(config, config.runtimes['local-dev']), 30_000);
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

  describe('validateLocalCliCommandCompatibility', () => {
    it('requires --verbose for Claude --print stream-json command shapes', () => {
      const invalid = validateLocalCliCommandCompatibility({
        command: 'claude',
        args: ['--print', '--output-format=stream-json'],
        runtimeId: 'local-claude',
      });
      assert.equal(invalid.ok, false);
      assert.equal(invalid.error_class, 'local_cli_command_incompatible');
      assert.match(invalid.error, /--verbose/);

      const valid = validateLocalCliCommandCompatibility({
        command: 'claude',
        args: ['--print', '--output-format', 'stream-json', '--verbose'],
        runtimeId: 'local-claude',
      });
      assert.equal(valid.ok, true);
    });

    it('requires Codex runtimes to use exec with JSON diagnostics', () => {
      const missingExec = validateLocalCliCommandCompatibility({
        command: 'codex',
        args: ['--json', '{prompt}'],
        runtimeId: 'local-codex',
      });
      assert.equal(missingExec.ok, false);
      assert.equal(missingExec.error_class, 'local_cli_command_incompatible');
      assert.equal(missingExec.diagnostic.rule, 'codex_requires_exec');
      assert.match(missingExec.error, /codex exec/);

      const missingJson = validateLocalCliCommandCompatibility({
        command: '/Applications/Codex.app/Contents/Resources/codex',
        args: ['exec', '{prompt}'],
        runtimeId: 'local-codex',
      });
      assert.equal(missingJson.ok, false);
      assert.equal(missingJson.error_class, 'local_cli_command_incompatible');
      assert.equal(missingJson.diagnostic.rule, 'codex_exec_requires_json');
      assert.match(missingJson.error, /--json/);

      const valid = validateLocalCliCommandCompatibility({
        command: 'codex',
        args: ['exec', '--json'],
        runtimeId: 'local-codex',
      });
      assert.equal(valid.ok, true);
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
      const [exitDiagnostic] = parseDiagPayloads(result.logs, 'process_exit');
      assert.equal(exitDiagnostic.first_output_stream, 'staged_result');
      assert.equal(exitDiagnostic.watchdog_fired, false);

      // Verify the subprocess actually received stdin content
      const staged = JSON.parse(readFileSync(join(root, stagingPathFor(state)), 'utf8'));
      assert.ok(staged.summary.startsWith('stdin_received:'), 'Subprocess should have received prompt via stdin');
      assert.ok(staged.summary.length > 'stdin_received:'.length, 'Stdin should contain prompt text');
    });

    it('captures immediate stdout from a stdin-driven subprocess before it exits', async () => {
      const root = createAndTrack();
      const state = makeState();

      const scriptContent = `
        process.stdin.resume();
        process.stdin.on('end', () => {
          process.stdout.write('READY\\n');
        });
      `;
      const scriptPath = join(root, '_stdin_fast_stdout.js');
      writeFileSync(scriptPath, scriptContent);

      const config = makeConfig({
        command: ['node', scriptPath],
        prompt_transport: 'stdin',
      });
      setupDispatchBundle(root, state, config);

      const result = await dispatchLocalCli(root, state, config);
      assert.equal(result.ok, false);
      assert.equal(result.startupFailure, undefined, 'stdout proof must avoid startup failure');
      assert.match(result.logs.join(''), /READY/);
      const [firstOutput] = parseDiagPayloads(result.logs, 'first_output');
      assert.equal(firstOutput.stream, 'stdout');
      const [exitDiagnostic] = parseDiagPayloads(result.logs, 'process_exit');
      assert.equal(exitDiagnostic.first_output_stream, 'stdout');
      assert.equal(exitDiagnostic.stdout_bytes, 6);
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
