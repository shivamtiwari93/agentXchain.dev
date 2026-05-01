/**
 * Local CLI adapter — subprocess-based agent execution.
 *
 * Per the frozen spec (§20, §37, §38, Session #17):
 *   - dispatch: spawns a subprocess with the seed prompt
 *   - wait:    watches for the staged turn-result.json (file-based, not output-scraping)
 *   - collect: reads the staged file (validation happens at the orchestrator level)
 *
 * Prompt transport (Session #17 freeze):
 *   - argv:               command/args contain {prompt}; adapter substitutes before spawn
 *   - stdin:              adapter writes prompt to subprocess stdin
 *   - dispatch_bundle_only: adapter does NOT deliver prompt; operator reads from disk
 *
 * Key design rules:
 *   - Subprocess success !== turn success. Only a validated staged result is turn success.
 *   - The adapter does NOT write state, decide transitions, or bypass validation.
 *   - Uses the same staging contract as manual mode (.agentxchain/staging/turn-result.json).
 */

import { spawn } from 'child_process';
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'fs';
import { delimiter, join } from 'path';
import {
  getDispatchContextPath,
  getDispatchLogPath,
  getDispatchPromptPath,
  getDispatchTurnDir,
  getTurnStagingDir,
  getTurnStagingResultPath,
} from '../turn-paths.js';
import { verifyDispatchManifestForAdapter } from '../dispatch-manifest.js';
import { hasMeaningfulStagedResult } from '../staged-result-proof.js';
import {
  getClaudeSubprocessAuthIssue,
  hasClaudeAuthenticationFailureText,
  hasClaudeNodeIncompatibilityText,
  isClaudeLocalCliRuntime,
  resolveClaudeCompatibleNodeBinary,
} from '../claude-local-auth.js';

const DIAGNOSTIC_ENV_KEYS = [
  'PATH',
  'HOME',
  'PWD',
  'SHELL',
  'TMPDIR',
  'AGENTXCHAIN_TURN_ID',
];
const DIAGNOSTIC_STDERR_EXCERPT_LIMIT = 800;
const DEFAULT_STARTUP_WATCHDOG_MS = 180_000;
const DEFAULT_STARTUP_WATCHDOG_SIGKILL_GRACE_MS = 10_000;
const DEFAULT_STARTUP_HEARTBEAT_MS = 30_000;

/**
 * Launch a local CLI subprocess for a governed turn.
 *
 * Reads the rendered PROMPT.md + CONTEXT.md from the dispatch bundle and
 * passes them as the prompt to the configured CLI command.
 *
 * @param {string} root - project root directory
 * @param {object} state - current governed state (must expose an active turn via active_turns; current_turn is a non-enumerable compatibility alias re-attached on load, not a persisted schema field)
 * @param {object} config - normalized config
 * @param {object} [options]
 * @param {AbortSignal} [options.signal] - abort signal for cancellation
 * @param {function} [options.onStdout] - callback for stdout lines (for logging)
 * @param {function} [options.onStderr] - callback for stderr lines (for logging)
 * @param {boolean} [options.verifyManifest] - require MANIFEST.json and verify before execution
 * @param {boolean} [options.skipManifestVerification] - explicit escape hatch; skip verification even if a manifest exists
 * @returns {Promise<{ ok: boolean, exitCode?: number, timedOut?: boolean, aborted?: boolean, error?: string, logs?: string[] }>}
 */
export async function dispatchLocalCli(root, state, config, options = {}) {
  const {
    signal,
    onStdout,
    onStderr,
    onSpawnAttached,
    onFirstOutput,
    startupWatchdogMs: startupWatchdogOverrideMs,
    turnId,
  } = options;

  const turn = resolveTargetTurn(state, turnId);
  if (!turn) {
    return { ok: false, error: 'No active turn in state' };
  }

  // Default policy verifies finalized bundles automatically; step.js still
  // passes verifyManifest: true to require a manifest on governed dispatch.
  const manifestCheck = verifyDispatchManifestForAdapter(root, turn.turn_id, options);
  if (!manifestCheck.ok) {
    return { ok: false, error: `Dispatch manifest verification failed: ${manifestCheck.error}` };
  }

  const runtimeId = turn.runtime_id;
  const runtime = config.runtimes?.[runtimeId];
  if (!runtime) {
    return { ok: false, error: `Runtime "${runtimeId}" not found in config` };
  }
  const startupWatchdogMs = startupWatchdogOverrideMs ?? resolveStartupWatchdogMs(config, runtime);
  const startupWatchdogKillGraceMs = resolveStartupWatchdogKillGraceMs(options.startupWatchdogKillGraceMs);
  const startupHeartbeatMs = resolveStartupHeartbeatMs(config, runtime, options.startupHeartbeatMs);

  // Read the dispatch bundle prompt
  const promptPath = join(root, getDispatchPromptPath(turn.turn_id));
  const contextPath = join(root, getDispatchContextPath(turn.turn_id));

  if (!existsSync(promptPath)) {
    return { ok: false, error: 'Dispatch bundle not found. Run writeDispatchBundle() first.' };
  }

  const prompt = readFileSync(promptPath, 'utf8');
  const context = existsSync(contextPath) ? readFileSync(contextPath, 'utf8') : '';
  const fullPrompt = prompt + '\n---\n\n' + context;

  // Resolve command, args, and prompt transport from runtime config
  const { command, args, transport } = resolveCommand(runtime, fullPrompt);
  if (!command) {
    return { ok: false, error: `Cannot resolve CLI command for runtime "${runtimeId}". Expected "command" field in runtime config.` };
  }

  const compatibility = validateLocalCliCommandCompatibility({ command, args, runtimeId });
  if (!compatibility.ok) {
    const logs = [];
    appendDiagnostic(logs, 'command_compatibility_failed', compatibility.diagnostic);
    return {
      ok: false,
      blocked: true,
      classified: {
        error_class: compatibility.error_class,
        recovery: compatibility.recovery,
      },
      error: compatibility.error,
      logs,
    };
  }

  // Compute timeout from explicit dispatch deadline, turn deadline, or default (20 minutes).
  const timeoutMs = options.dispatchTimeoutMs != null
    ? options.dispatchTimeoutMs
    : options.dispatchDeadlineAt
      ? Math.max(0, new Date(options.dispatchDeadlineAt).getTime() - Date.now())
      : turn.deadline_at
    ? Math.max(0, new Date(turn.deadline_at).getTime() - Date.now())
    : 1200000;

  // Ensure staging directory exists and clear any previous result
  const stagingDir = join(root, getTurnStagingDir(turn.turn_id));
  mkdirSync(stagingDir, { recursive: true });
  const stagingFile = join(root, getTurnStagingResultPath(turn.turn_id));
  try {
    if (existsSync(stagingFile)) {
      writeFileSync(stagingFile, '{}');
    }
  } catch {}

  // Capture logs for dispatch record
  const logs = [];
  const runtimeCwd = runtime.cwd ? join(root, runtime.cwd) : root;
  const spawnEnv = { ...process.env, AGENTXCHAIN_TURN_ID: turn.turn_id };
  const stdinBytes = transport === 'stdin' ? Buffer.byteLength(fullPrompt, 'utf8') : 0;
  const diagnosticArgs = redactPromptArgs(args, fullPrompt, transport);
  const spawnSpec = resolveClaudeSpawnSpec(runtime, command, args, spawnEnv);
  const claudeAuthIssue = await getClaudeSubprocessAuthIssue(runtime, spawnEnv);

  if (claudeAuthIssue) {
    appendDiagnostic(logs, 'claude_auth_preflight_failed', {
      runtime_id: runtimeId,
      turn_id: turn.turn_id,
      auth_env_present: claudeAuthIssue.auth_env_present,
      smoke_probe: claudeAuthIssue.smoke_probe,
      recommendation: claudeAuthIssue.fix,
    });
    return {
      ok: false,
      error: `${claudeAuthIssue.detail} ${claudeAuthIssue.fix}`,
      logs,
    };
  }

  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve({ ok: false, aborted: true, logs });
      return;
    }

    let child;
    try {
      appendDiagnostic(logs, 'spawn_prepare', {
        runtime_id: runtimeId,
        turn_id: turn.turn_id,
        command: spawnSpec.command,
        args: spawnSpec.args === args ? diagnosticArgs : redactPromptArgs(spawnSpec.args, fullPrompt, transport),
        configured_command: spawnSpec.command === command ? undefined : command,
        configured_args: spawnSpec.command === command ? undefined : diagnosticArgs,
        spawn_wrapper: spawnSpec.wrapper,
        cwd: runtimeCwd,
        prompt_transport: transport,
        stdin_bytes: stdinBytes,
        env: pickDiagnosticEnv(spawnEnv),
      });
      child = spawn(spawnSpec.command, spawnSpec.args, {
        cwd: runtimeCwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: spawnEnv,
      });
    } catch (err) {
      appendDiagnostic(logs, 'spawn_error', normalizeDiagnosticError(err));
      resolve({
        ok: false,
        startupFailure: true,
        startupFailureType: 'runtime_spawn_failed',
        error: `Failed to spawn "${command}": ${err.message}`,
        logs,
      });
      return;
    }

    let settled = false;
    let firstOutputAt = null;
    let firstOutputStream = null;
    let spawnConfirmedAt = null;
    let spawnConfirmedAtMs = null;
    let firstOutputLatencyMs = null;
    let startupWatchdog = null;
    let startupSigkillHandle = null;
    let startupHeartbeat = null;
    let startupTimedOut = false;
    let startupFailureType = null;
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let stderrExcerpt = '';

    const settle = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const clearStartupWatchdog = () => {
      if (startupWatchdog) {
        clearTimeout(startupWatchdog);
        startupWatchdog = null;
      }
      if (startupSigkillHandle) {
        clearTimeout(startupSigkillHandle);
        startupSigkillHandle = null;
      }
    };

    const clearStartupHeartbeat = () => {
      if (startupHeartbeat) {
        clearInterval(startupHeartbeat);
        startupHeartbeat = null;
      }
    };

    const armStartupHeartbeat = () => {
      if (startupHeartbeat || !(startupHeartbeatMs > 0 && Number.isFinite(startupHeartbeatMs))) {
        return;
      }
      startupHeartbeat = setInterval(() => {
        if (firstOutputAt || settled) {
          clearStartupHeartbeat();
          return;
        }
        const payload = {
          startup_heartbeat_ms: startupHeartbeatMs,
          startup_watchdog_ms: startupWatchdogMs,
          pid: child.pid ?? null,
          spawn_confirmed_at: spawnConfirmedAt,
          elapsed_since_spawn_ms: spawnConfirmedAtMs == null ? null : Math.max(0, Date.now() - spawnConfirmedAtMs),
          stdout_bytes: stdoutBytes,
          stderr_bytes: stderrBytes,
        };
        appendDiagnostic(logs, 'startup_heartbeat', payload);
        if (options.onStartupHeartbeat) {
          try {
            options.onStartupHeartbeat(payload);
          } catch {}
        }
      }, startupHeartbeatMs);
      if (typeof startupHeartbeat.unref === 'function') {
        startupHeartbeat.unref();
      }
    };

    const armStartupWatchdog = () => {
      if (startupWatchdog || !(startupWatchdogMs > 0 && Number.isFinite(startupWatchdogMs))) {
        return;
      }
      startupWatchdog = setTimeout(() => {
        if (firstOutputAt || isStagedResultReady(join(root, getTurnStagingResultPath(turn.turn_id)))) {
          return;
        }
        startupTimedOut = true;
        startupFailureType = 'no_subprocess_output';
        logs.push(`[adapter] Startup watchdog fired after ${Math.round(startupWatchdogMs / 1000)}s with no output.`);
        appendDiagnostic(logs, 'startup_watchdog_fired', {
          startup_watchdog_ms: startupWatchdogMs,
          startup_watchdog_sigkill_grace_ms: startupWatchdogKillGraceMs,
          pid: child.pid ?? null,
          spawn_confirmed_at: spawnConfirmedAt,
          elapsed_since_spawn_ms: spawnConfirmedAtMs == null ? null : Math.max(0, Date.now() - spawnConfirmedAtMs),
        });
        try {
          child.kill('SIGTERM');
        } catch {}
        if (startupWatchdogKillGraceMs > 0) {
          startupSigkillHandle = setTimeout(() => {
            logs.push('[adapter] Startup watchdog grace period expired. Sending SIGKILL.');
            appendDiagnostic(logs, 'startup_watchdog_sigkill', {
              startup_watchdog_ms: startupWatchdogMs,
              startup_watchdog_sigkill_grace_ms: startupWatchdogKillGraceMs,
              pid: child.pid ?? null,
              spawn_confirmed_at: spawnConfirmedAt,
              elapsed_since_spawn_ms: spawnConfirmedAtMs == null ? null : Math.max(0, Date.now() - spawnConfirmedAtMs),
            });
            try {
              child.kill('SIGKILL');
            } catch {}
          }, startupWatchdogKillGraceMs);
        }
      }, startupWatchdogMs);
    };

    const recordFirstOutput = (stream) => {
      if (firstOutputAt) return;
      firstOutputAt = new Date().toISOString();
      firstOutputStream = stream;
      firstOutputLatencyMs = spawnConfirmedAtMs == null ? null : Math.max(0, Date.now() - spawnConfirmedAtMs);
      clearStartupWatchdog();
      clearStartupHeartbeat();
      appendDiagnostic(logs, 'first_output', {
        at: firstOutputAt,
        stream,
        pid: child.pid ?? null,
        startup_latency_ms: firstOutputLatencyMs,
      });
      if (onFirstOutput) {
        try {
          onFirstOutput({ pid: child.pid ?? null, at: firstOutputAt, stream });
        } catch {}
      }
    };

    child.once('spawn', () => {
      spawnConfirmedAtMs = Date.now();
      spawnConfirmedAt = new Date().toISOString();
      appendDiagnostic(logs, 'spawn_attached', {
        pid: child.pid ?? null,
        at: spawnConfirmedAt,
        startup_watchdog_ms: startupWatchdogMs,
      });
      if (onSpawnAttached) {
        try {
          onSpawnAttached({ pid: child.pid ?? null, at: spawnConfirmedAt });
        } catch {}
      }
      armStartupWatchdog();
      armStartupHeartbeat();
    });

    // Collect stdout/stderr
    if (child.stdout) {
      child.stdout.on('data', (chunk) => {
        const text = chunk.toString();
        stdoutBytes += Buffer.byteLength(text);
        recordFirstOutput('stdout');
        logs.push(text);
        if (onStdout) onStdout(text);
      });
    }

    if (child.stderr) {
      child.stderr.on('data', (chunk) => {
        const text = chunk.toString();
        stderrBytes += Buffer.byteLength(text);
        stderrExcerpt = appendDiagnosticExcerpt(stderrExcerpt, text, DIAGNOSTIC_STDERR_EXCERPT_LIMIT);
        logs.push('[stderr] ' + text);
        if (onStderr) onStderr(text);
      });
    }

    // Deliver prompt only after output listeners are registered. This removes
    // the remaining adapter-side ordering risk for fast stdin-driven children.
    if (child.stdin) {
      child.stdin.on('error', (err) => {
        appendDiagnostic(logs, 'stdin_error', {
          at: new Date().toISOString(),
          stdin_bytes: stdinBytes,
          ...normalizeDiagnosticError(err),
        });
      });
      try {
        if (transport === 'stdin') {
          child.stdin.write(fullPrompt);
        }
        child.stdin.end();
      } catch (err) {
        appendDiagnostic(logs, 'stdin_error', {
          at: new Date().toISOString(),
          stdin_bytes: stdinBytes,
          ...normalizeDiagnosticError(err),
        });
      }
    }

    // Timeout handling per §20.4
    let timeoutHandle;
    let sigkillHandle;
    let abortSigkillHandle;

    if (timeoutMs > 0 && timeoutMs < Infinity) {
      timeoutHandle = setTimeout(() => {
        logs.push(`[adapter] Turn timed out after ${Math.round(timeoutMs / 1000)}s. Sending SIGTERM.`);
        try {
          child.kill('SIGTERM');
        } catch {}

        // Grace period: SIGKILL after 10 seconds
        sigkillHandle = setTimeout(() => {
          logs.push('[adapter] Grace period expired. Sending SIGKILL.');
          try {
            child.kill('SIGKILL');
          } catch {}
        }, 10000);
      }, timeoutMs);
    }

    // Abort signal handling
    const onAbort = () => {
      logs.push('[adapter] Abort signal received. Sending SIGTERM.');
      clearStartupWatchdog();
      clearStartupHeartbeat();
      clearTimeout(timeoutHandle);
      clearTimeout(sigkillHandle);
      clearTimeout(abortSigkillHandle);
      try {
        child.kill('SIGTERM');
      } catch {}
      // Give it 5 seconds to exit gracefully
      abortSigkillHandle = setTimeout(() => {
        abortSigkillHandle = null;
        try { child.kill('SIGKILL'); } catch {}
      }, 5000);
    };

    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
    }

    // Process exit
    child.on('close', (exitCode, killSignal) => {
      clearStartupWatchdog();
      clearStartupHeartbeat();
      clearTimeout(timeoutHandle);
      clearTimeout(sigkillHandle);
      clearTimeout(abortSigkillHandle);
      if (signal) signal.removeEventListener('abort', onAbort);

      if (signal?.aborted) {
        settle({ ok: false, aborted: true, exitCode, logs });
        return;
      }

      const timedOut = killSignal === 'SIGTERM' || killSignal === 'SIGKILL';

      // Check if staged result was written (regardless of exit code)
      const hasResult = isStagedResultReady(join(root, getTurnStagingResultPath(turn.turn_id)));
      if (hasResult && !firstOutputAt) {
        recordFirstOutput('staged_result');
      }
      const exitDiagnostic = {
        pid: child.pid ?? null,
        exit_code: exitCode,
        signal: killSignal,
        exit_signal: killSignal,
        spawn_confirmed_at: spawnConfirmedAt,
        elapsed_since_spawn_ms: spawnConfirmedAtMs == null ? null : Math.max(0, Date.now() - spawnConfirmedAtMs),
        first_output_at: firstOutputAt,
        first_output_stream: firstOutputStream,
        startup_latency_ms: firstOutputLatencyMs,
        stdout_bytes: stdoutBytes,
        stderr_bytes: stderrBytes,
        staged_result_ready: hasResult,
        watchdog_fired: startupTimedOut,
      };
      if (stderrExcerpt) {
        exitDiagnostic.stderr_excerpt = stderrExcerpt;
      }
      if (startupTimedOut) {
        exitDiagnostic.startup_failure_type = startupFailureType || 'no_subprocess_output';
      } else if (!spawnConfirmedAt) {
        exitDiagnostic.startup_failure_type = 'runtime_spawn_failed';
      } else if (timedOut) {
        exitDiagnostic.timed_out = true;
      } else if (!firstOutputAt) {
        exitDiagnostic.startup_failure_type = 'no_subprocess_output';
      }
      appendDiagnostic(logs, 'process_exit', exitDiagnostic);

      if (hasResult) {
        settle({ ok: true, exitCode, timedOut: false, aborted: false, logs, firstOutputAt });
      } else if (isClaudeLocalCliRuntime(runtime) && hasClaudeAuthFailureOutput(logs)) {
        const recovery = 'Refresh Claude credentials before resuming: export a valid ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN, then run agentxchain step --resume.';
        settle({
          ok: false,
          blocked: true,
          exitCode,
          timedOut: false,
          aborted: false,
          firstOutputAt,
          classified: {
            error_class: 'claude_auth_failed',
            recovery,
          },
          error: `Claude local_cli authentication failed. ${recovery}`,
          logs,
        });
      } else if (isClaudeLocalCliRuntime(runtime) && hasClaudeNodeRuntimeIncompatibilityOutput(logs)) {
        const recovery = 'Run AgentXchain with Node.js 20.5+ available to the Claude local_cli runtime, then resume continuous mode.';
        settle({
          ok: false,
          blocked: true,
          exitCode,
          timedOut: false,
          aborted: false,
          firstOutputAt,
          classified: {
            error_class: 'claude_node_incompatible',
            recovery,
          },
          error: `Claude local_cli runtime is using an incompatible Node.js version. ${recovery}`,
          logs,
        });
      } else if (startupTimedOut) {
        settle({
          ok: false,
          exitCode,
          timedOut: false,
          aborted: false,
          startupFailure: true,
          startupFailureType: startupFailureType || 'no_subprocess_output',
          startupWatchdogMs,
          firstOutputAt,
          error: `Subprocess produced no output within ${Math.round(startupWatchdogMs / 1000)}s and did not stage a turn result.`,
          logs,
        });
      } else if (!spawnConfirmedAt) {
        settle({
          ok: false,
          exitCode,
          timedOut: false,
          aborted: false,
          startupFailure: true,
          startupFailureType: 'runtime_spawn_failed',
          firstOutputAt,
          error: `Subprocess exited (code ${exitCode}) before reporting a successful spawn or staging a turn result.`,
          logs,
        });
      } else if (timedOut) {
        settle({ ok: false, exitCode, timedOut: true, aborted: false, error: 'Turn timed out without producing a staged result.', logs });
      } else if (!firstOutputAt) {
        settle({
          ok: false,
          exitCode,
          timedOut: false,
          aborted: false,
          startupFailure: true,
          startupFailureType: 'no_subprocess_output',
          startupWatchdogMs,
          firstOutputAt,
          error: `Subprocess exited (code ${exitCode}) before producing output or staging a turn result.`,
          logs,
        });
      } else {
        settle({
          ok: false,
          exitCode,
          timedOut: false,
          aborted: false,
          firstOutputAt,
          error: `Subprocess exited (code ${exitCode}) without writing a staged turn result to ${getTurnStagingResultPath(turn.turn_id)}.`,
          logs,
        });
      }
    });

    child.on('error', (err) => {
      clearStartupWatchdog();
      clearStartupHeartbeat();
      clearTimeout(timeoutHandle);
      clearTimeout(sigkillHandle);
      clearTimeout(abortSigkillHandle);
      if (signal) signal.removeEventListener('abort', onAbort);
      // BUG-54 hypothesis #1 fix: explicitly release stdio streams on the
      // error path so Node reclaims pipe handles immediately instead of
      // waiting for GC. Without this, repeated `runtime_spawn_failed` turns
      // leak ~4 handles per failure until the next GC sweep, which in a
      // long-running `run --continuous` session can push the parent process
      // toward its fd limit and cascade additional spawn failures.
      try { child.stdin?.destroy(); } catch {}
      try { child.stdout?.destroy(); } catch {}
      try { child.stderr?.destroy(); } catch {}
      appendDiagnostic(logs, 'spawn_error', {
        pid: child.pid ?? null,
        spawn_confirmed_at: spawnConfirmedAt,
        elapsed_since_spawn_ms: spawnConfirmedAtMs == null ? null : Math.max(0, Date.now() - spawnConfirmedAtMs),
        first_output_at: firstOutputAt,
        startup_latency_ms: firstOutputLatencyMs,
        stdout_bytes: stdoutBytes,
        stderr_bytes: stderrBytes,
        ...normalizeDiagnosticError(err),
      });
      settle({
        ok: false,
        startupFailure: !firstOutputAt,
        startupFailureType: !firstOutputAt ? 'runtime_spawn_failed' : null,
        firstOutputAt,
        error: `Subprocess error: ${err.message}`,
        logs,
      });
    });
  });
}

/**
 * Save dispatch logs to the dispatch directory for auditability.
 *
 * @param {string} root - project root
 * @param {string} turnId - target turn id
 * @param {string[]} logs - collected log lines
 */
export function saveDispatchLogs(root, turnId, logs) {
  const logDir = join(root, getDispatchTurnDir(turnId));
  if (!existsSync(logDir)) return;

  try {
    writeFileSync(join(root, getDispatchLogPath(turnId)), logs.join(''));
  } catch {}
}

// ── Internal ──────────────────────────────────────────────────────────────────

/**
 * Resolve the CLI command and arguments from runtime config.
 *
 * Supports two config shapes:
 *   1. { command: ["claude", "--print", "-p", "{prompt}"] }
 *      → command = "claude", args = ["--print", "-p", "<rendered prompt>"]
 *
 *   2. { command: "claude", args: ["--print"] }
 *      → command = "claude", args = ["--print"]
 *
 * Prompt injection depends on prompt_transport (Session #17):
 *   - "argv" (default when {prompt} present): {prompt} placeholders replaced with prompt text
 *   - "stdin": prompt delivered via stdin, no argv substitution
 *   - "dispatch_bundle_only": no prompt delivery; subprocess reads from disk
 *
 * Returns { command, args, transport } where transport is the resolved prompt_transport.
 */
function resolveCommand(runtime, fullPrompt) {
  if (!runtime.command) return { command: null, args: [], transport: null };

  const transport = resolvePromptTransport(runtime);

  // Shape 1: command is an array
  if (Array.isArray(runtime.command)) {
    // Normalize: if the first element contains spaces (e.g., ["echo test"]), split it
    // into binary + args. Only the first element is split — later elements may contain
    // legitimate spaces (e.g., script text for `node -e "..."`).
    const first = runtime.command[0] || '';
    const headParts = typeof first === 'string' && first.includes(' ') ? first.split(/\s+/) : [first];
    const [cmd, ...headArgs] = headParts;
    const rest = [...headArgs, ...runtime.command.slice(1)];
    const args = transport === 'argv'
      ? rest.map(arg => arg === '{prompt}' ? fullPrompt : arg)
      : rest.filter(arg => arg !== '{prompt}');
    return { command: cmd, args, transport };
  }

  // Shape 2: command is a string, args is separate
  const cmd = runtime.command;
  const baseArgs = runtime.args || [];
  const args = transport === 'argv'
    ? baseArgs.map(a => a === '{prompt}' ? fullPrompt : a)
    : baseArgs.filter(a => a !== '{prompt}');
  return { command: cmd, args, transport };
}

/**
 * Resolve the effective prompt transport for a local_cli runtime.
 *
 * Explicit prompt_transport field takes precedence.
 * Fallback: if command/args contain {prompt} → "argv"; otherwise → "dispatch_bundle_only".
 */
function resolvePromptTransport(runtime) {
  const VALID_TRANSPORTS = ['argv', 'stdin', 'dispatch_bundle_only'];
  if (runtime.prompt_transport && VALID_TRANSPORTS.includes(runtime.prompt_transport)) {
    return runtime.prompt_transport;
  }

  // Infer from command shape (backwards compat)
  const commandParts = Array.isArray(runtime.command)
    ? runtime.command
    : [runtime.command, ...(runtime.args || [])];
  const hasPlaceholder = commandParts.some(p => typeof p === 'string' && p.includes('{prompt}'));
  return hasPlaceholder ? 'argv' : 'dispatch_bundle_only';
}

function resolveStartupWatchdogMs(config, runtime) {
  if (runtime?.type === 'local_cli' && Number.isInteger(runtime?.startup_watchdog_ms) && runtime.startup_watchdog_ms > 0) {
    return runtime.startup_watchdog_ms;
  }
  if (Number.isInteger(config?.run_loop?.startup_watchdog_ms) && config.run_loop.startup_watchdog_ms > 0) {
    return config.run_loop.startup_watchdog_ms;
  }
  return DEFAULT_STARTUP_WATCHDOG_MS;
}

function resolveStartupHeartbeatMs(config, runtime, override) {
  if (Number.isInteger(override) && override > 0) {
    return override;
  }
  if (runtime?.type === 'local_cli' && Number.isInteger(runtime?.startup_heartbeat_ms) && runtime.startup_heartbeat_ms > 0) {
    return runtime.startup_heartbeat_ms;
  }
  if (Number.isInteger(config?.run_loop?.startup_heartbeat_ms) && config.run_loop.startup_heartbeat_ms > 0) {
    return config.run_loop.startup_heartbeat_ms;
  }
  return DEFAULT_STARTUP_HEARTBEAT_MS;
}

function resolveStartupWatchdogKillGraceMs(value) {
  if (Number.isInteger(value) && value >= 0) {
    return value;
  }
  return DEFAULT_STARTUP_WATCHDOG_SIGKILL_GRACE_MS;
}

function validateLocalCliCommandCompatibility({ command, args = [], runtimeId = null }) {
  const tokens = [command, ...args].filter((token) => typeof token === 'string');
  const binaryName = command ? command.split('/').filter(Boolean).pop() || command : '';
  const outputFormatIndex = tokens.findIndex((token) => token === '--output-format');
  const outputFormatValue = outputFormatIndex >= 0 ? tokens[outputFormatIndex + 1] : null;
  const usesStreamJson = tokens.includes('--output-format=stream-json')
    || outputFormatValue === 'stream-json';
  const usesPrint = tokens.includes('--print') || tokens.includes('-p');
  const hasVerbose = tokens.includes('--verbose');

  if (binaryName === 'claude' && usesPrint && usesStreamJson && !hasVerbose) {
    const runtimeLabel = runtimeId ? `Runtime "${runtimeId}"` : 'Claude local_cli runtime';
    const recovery = `${runtimeLabel} uses "claude --print --output-format stream-json" without "--verbose". Add "--verbose" to the command array before dispatching again.`;
    return {
      ok: false,
      error_class: 'local_cli_command_incompatible',
      recovery,
      error: recovery,
      diagnostic: {
        runtime_id: runtimeId,
        binary: binaryName,
        rule: 'claude_print_stream_json_requires_verbose',
        has_print: usesPrint,
        has_stream_json: usesStreamJson,
        has_verbose: hasVerbose,
        recovery,
      },
    };
  }

  return { ok: true };
}

/**
 * Check if the staged result file exists and has meaningful content.
 * Delegates to the shared `hasMeaningfulStagedResult` helper so watchdog,
 * manual adapter, and local-cli adapter all agree on what counts as proof.
 * Per DEC-BUG51-STAGING-PLACEHOLDER-NOT-PROOF-001, placeholders (`{}`, blank,
 * whitespace-only, or `{}\n`) are cleanup artifacts, not evidence.
 */
function isStagedResultReady(filePath) {
  return hasMeaningfulStagedResult(filePath);
}

function resolveTargetTurn(state, turnId) {
  if (turnId && state?.active_turns?.[turnId]) {
    return state.active_turns[turnId];
  }
  return state?.current_turn || Object.values(state?.active_turns || {})[0];
}

function appendDiagnostic(logs, label, payload) {
  logs.push(`[adapter:diag] ${label} ${JSON.stringify(payload)}\n`);
}

function hasClaudeAuthFailureOutput(logs) {
  if (!Array.isArray(logs)) return false;
  return logs.some((line) => hasClaudeAuthenticationFailureText(line));
}

function hasClaudeNodeRuntimeIncompatibilityOutput(logs) {
  if (!Array.isArray(logs)) return false;
  return hasClaudeNodeIncompatibilityText(logs.join('\n'));
}

function resolveCommandPath(command, pathValue) {
  if (!command || command.includes('/')) {
    return existsSync(command) ? command : null;
  }
  const parts = String(pathValue || '').split(delimiter).filter(Boolean);
  for (const dir of parts) {
    const candidate = join(dir, command);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function resolveClaudeSpawnSpec(runtime, command, args, env) {
  if (command !== 'claude' || !isClaudeLocalCliRuntime(runtime)) {
    return { command, args, wrapper: null };
  }
  const nodeBinary = resolveClaudeCompatibleNodeBinary(env);
  if (!nodeBinary) {
    return { command, args, wrapper: null };
  }
  const claudeEntry = resolveCommandPath(command, env?.PATH);
  if (!claudeEntry) {
    return { command, args, wrapper: null };
  }
  if (!isNodeEntrypoint(claudeEntry)) {
    return { command, args, wrapper: null };
  }
  return {
    command: nodeBinary,
    args: [claudeEntry, ...args],
    wrapper: 'claude_compatible_node',
  };
}

function isNodeEntrypoint(filePath) {
  try {
    const head = readFileSync(filePath, 'utf8').slice(0, 256);
    const firstLine = head.split(/\r?\n/, 1)[0] || '';
    return /^#!.*(?:^|[\/\s])(?:env\s+)?node(?:\s|$)/.test(firstLine);
  } catch {
    return false;
  }
}

function pickDiagnosticEnv(env) {
  return Object.fromEntries(
    DIAGNOSTIC_ENV_KEYS
      .filter((key) => typeof env?.[key] === 'string' && env[key].length > 0)
      .map((key) => [key, env[key]]),
  );
}

function redactPromptArgs(args, fullPrompt, transport) {
  const promptPlaceholder = `<prompt:${Buffer.byteLength(fullPrompt, 'utf8')} bytes>`;
  return args.map((arg) => {
    if (typeof arg !== 'string') {
      return arg;
    }
    if (transport === 'argv' && arg === fullPrompt) {
      return promptPlaceholder;
    }
    return arg;
  });
}

function normalizeDiagnosticError(err) {
  return {
    code: err?.code || null,
    errno: err?.errno || null,
    syscall: err?.syscall || null,
    message: err?.message || String(err),
  };
}

function appendDiagnosticExcerpt(existing, chunk, limit) {
  const combined = `${existing}${chunk}`;
  if (combined.length <= limit) {
    return combined;
  }
  return combined.slice(combined.length - limit);
}

export { resolveCommand };
export { resolvePromptTransport };
export { resolveStartupWatchdogMs };
export { resolveStartupHeartbeatMs };
export { validateLocalCliCommandCompatibility };
