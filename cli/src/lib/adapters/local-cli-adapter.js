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
import { existsSync, readFileSync, statSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import {
  getDispatchContextPath,
  getDispatchLogPath,
  getDispatchPromptPath,
  getDispatchTurnDir,
  getTurnStagingDir,
  getTurnStagingResultPath,
} from '../turn-paths.js';
import { verifyDispatchManifestForAdapter } from '../dispatch-manifest.js';

/**
 * Launch a local CLI subprocess for a governed turn.
 *
 * Reads the rendered PROMPT.md + CONTEXT.md from the dispatch bundle and
 * passes them as the prompt to the configured CLI command.
 *
 * @param {string} root - project root directory
 * @param {object} state - current governed state (must have current_turn)
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
  const { signal, onStdout, onStderr, turnId } = options;

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

  // Compute timeout from deadline or default (20 minutes)
  const timeoutMs = turn.deadline_at
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

  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve({ ok: false, aborted: true, logs });
      return;
    }

    let child;
    try {
      child = spawn(command, args, {
        cwd: runtime.cwd ? join(root, runtime.cwd) : root,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env },
      });
    } catch (err) {
      resolve({ ok: false, error: `Failed to spawn "${command}": ${err.message}`, logs });
      return;
    }

    let settled = false;
    const settle = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    // Deliver prompt via stdin if transport is "stdin"; otherwise close immediately
    if (child.stdin) {
      try {
        if (transport === 'stdin') {
          child.stdin.write(fullPrompt);
        }
        child.stdin.end();
      } catch {}
    }

    // Collect stdout/stderr
    if (child.stdout) {
      child.stdout.on('data', (chunk) => {
        const text = chunk.toString();
        logs.push(text);
        if (onStdout) onStdout(text);
      });
    }

    if (child.stderr) {
      child.stderr.on('data', (chunk) => {
        const text = chunk.toString();
        logs.push('[stderr] ' + text);
        if (onStderr) onStderr(text);
      });
    }

    // Timeout handling per §20.4
    let timeoutHandle;
    let sigkillHandle;

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
      clearTimeout(timeoutHandle);
      clearTimeout(sigkillHandle);
      try {
        child.kill('SIGTERM');
      } catch {}
      // Give it 5 seconds to exit gracefully
      setTimeout(() => {
        try { child.kill('SIGKILL'); } catch {}
      }, 5000);
    };

    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
    }

    // Process exit
    child.on('close', (exitCode, killSignal) => {
      clearTimeout(timeoutHandle);
      clearTimeout(sigkillHandle);
      if (signal) signal.removeEventListener('abort', onAbort);

      if (signal?.aborted) {
        settle({ ok: false, aborted: true, exitCode, logs });
        return;
      }

      const timedOut = killSignal === 'SIGTERM' || killSignal === 'SIGKILL';

      // Check if staged result was written (regardless of exit code)
      const hasResult = isStagedResultReady(join(root, getTurnStagingResultPath(turn.turn_id)));

      if (hasResult) {
        settle({ ok: true, exitCode, timedOut: false, aborted: false, logs });
      } else if (timedOut) {
        settle({ ok: false, exitCode, timedOut: true, aborted: false, error: 'Turn timed out without producing a staged result.', logs });
      } else {
        settle({
          ok: false,
          exitCode,
          timedOut: false,
          aborted: false,
          error: `Subprocess exited (code ${exitCode}) without writing a staged turn result to ${getTurnStagingResultPath(turn.turn_id)}.`,
          logs,
        });
      }
    });

    child.on('error', (err) => {
      clearTimeout(timeoutHandle);
      clearTimeout(sigkillHandle);
      if (signal) signal.removeEventListener('abort', onAbort);
      settle({ ok: false, error: `Subprocess error: ${err.message}`, logs });
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
    const [cmd, ...rest] = runtime.command;
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

/**
 * Check if the staged result file exists and has meaningful content.
 */
function isStagedResultReady(filePath) {
  try {
    if (!existsSync(filePath)) return false;
    const stat = statSync(filePath);
    return stat.size > 2; // Must be more than just "{}" or empty
  } catch {
    return false;
  }
}

function resolveTargetTurn(state, turnId) {
  if (turnId && state?.active_turns?.[turnId]) {
    return state.active_turns[turnId];
  }
  return state?.current_turn || Object.values(state?.active_turns || {})[0];
}

export { resolvePromptTransport };
