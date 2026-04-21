import { spawn } from 'node:child_process';

const CLAUDE_ENV_AUTH_KEYS = [
  'ANTHROPIC_API_KEY',
  'CLAUDE_API_KEY',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_BEDROCK',
];

const DEFAULT_SMOKE_PROBE_TIMEOUT_MS = 10_000;
const DEFAULT_SMOKE_PROBE_STDIN = 'ok';

function normalizeCommandTokens(runtime) {
  if (Array.isArray(runtime?.command)) {
    return runtime.command.flatMap((element) =>
      typeof element === 'string' ? element.trim().split(/\s+/).filter(Boolean) : []
    );
  }
  if (typeof runtime?.command === 'string' && runtime.command.trim()) {
    return runtime.command.trim().split(/\s+/).filter(Boolean);
  }
  return [];
}

export function isClaudeLocalCliRuntime(runtime) {
  const tokens = normalizeCommandTokens(runtime);
  if (tokens.length === 0) {
    return false;
  }
  const head = tokens[0].toLowerCase();
  return head === 'claude' || head.endsWith('/claude');
}

export function hasClaudeBareFlag(runtime) {
  return normalizeCommandTokens(runtime).includes('--bare');
}

export function getClaudeEnvAuthPresence(env = process.env) {
  return Object.fromEntries(
    CLAUDE_ENV_AUTH_KEYS.map((key) => [key, Boolean(env?.[key])]),
  );
}

export function hasClaudeEnvAuth(env = process.env) {
  return Object.values(getClaudeEnvAuthPresence(env)).some(Boolean);
}

function buildClaudeSubprocessAuthIssue(env, smokeProbe = null) {
  const auth_env_present = getClaudeEnvAuthPresence(env);
  return {
    auth_env_present,
    smoke_probe: smokeProbe,
    detail: 'Claude local_cli runtime has no env-based auth and is missing "--bare"; non-interactive subprocesses can hang on macOS keychain reads.',
    fix: 'Export ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN before running AgentXchain, or add "--bare" to the Claude command if you intentionally want env-only auth.',
  };
}

function resolveSmokeProbeTimeoutMs(env, options = {}) {
  if (Number.isFinite(options?.timeoutMs) && options.timeoutMs > 0) {
    return options.timeoutMs;
  }
  const raw = env?.AGENTXCHAIN_CLAUDE_AUTH_PROBE_TIMEOUT_MS;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_SMOKE_PROBE_TIMEOUT_MS;
}

export async function getClaudeSubprocessAuthIssue(runtime, env = process.env, options = {}) {
  if (!isClaudeLocalCliRuntime(runtime)) {
    return null;
  }

  if (hasClaudeBareFlag(runtime) || hasClaudeEnvAuth(env)) {
    return null;
  }

  const smokeProbe = await runClaudeSmokeProbe({
    runtime,
    env,
    timeoutMs: resolveSmokeProbeTimeoutMs(env, options),
    stdinPayload: options?.stdinPayload,
    spawnImpl: options?.spawnImpl,
  });

  if (smokeProbe.kind === 'stdout_observed' || smokeProbe.kind === 'spawn_error' || smokeProbe.kind === 'skipped') {
    return null;
  }

  if (smokeProbe.kind === 'hang' || smokeProbe.kind === 'exit_nonzero' || smokeProbe.kind === 'stderr_only') {
    return buildClaudeSubprocessAuthIssue(env, smokeProbe);
  }

  return null;
}

/**
 * Bounded smoke probe that spawns the runtime's actual Claude command with a
 * tiny prompt on stdin and a watchdog. Returns a classification:
 *
 *   { kind: 'stdout_observed' }      — real stdout arrived before watchdog;
 *                                      the setup is NOT hanging on auth.
 *   { kind: 'hang', elapsed_ms }     — watchdog fired with no stdout/stderr
 *                                      bytes; the keychain-hang shape (BUG-54).
 *   { kind: 'stderr_only', ... }     — process wrote stderr but no stdout
 *                                      before watchdog (auth error or similar).
 *   { kind: 'exit_nonzero', ... }    — process exited non-zero with no stdout
 *                                      (explicit auth failure — not a hang).
 *   { kind: 'spawn_error', ... }     — spawn itself failed (ENOENT / EPERM).
 *   { kind: 'skipped', reason }      — probe disabled or unavailable.
 *
 * This is the positive-case-testable alternative to the static shape-check in
 * `getClaudeSubprocessAuthIssue`: it observes what the subprocess actually
 * does rather than predicting what it *might* do from config shape alone.
 *
 * Added 2026-04-21 for the BUG-56 false-positive fix. See
 * `.planning/BUG_56_FALSE_POSITIVE_RETRO.md` for the decision trail.
 *
 * @param {{ runtime: object, env?: object, timeoutMs?: number, stdinPayload?: string, spawnImpl?: Function }} opts
 * @returns {Promise<object>}
 */
export async function runClaudeSmokeProbe(opts) {
  const runtime = opts?.runtime ?? null;
  const env = opts?.env ?? process.env;
  const timeoutMs = Number.isFinite(opts?.timeoutMs) ? opts.timeoutMs : DEFAULT_SMOKE_PROBE_TIMEOUT_MS;
  const stdinPayload = typeof opts?.stdinPayload === 'string' ? opts.stdinPayload : DEFAULT_SMOKE_PROBE_STDIN;
  const spawnImpl = typeof opts?.spawnImpl === 'function' ? opts.spawnImpl : spawn;

  if (!isClaudeLocalCliRuntime(runtime)) {
    return { kind: 'skipped', reason: 'not_claude_local_cli' };
  }

  const tokens = normalizeCommandTokens(runtime);
  if (tokens.length === 0) {
    return { kind: 'skipped', reason: 'empty_command' };
  }
  const [command, ...args] = tokens;

  return new Promise((resolve) => {
    let child;
    try {
      child = spawnImpl(command, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env,
      });
    } catch (error) {
      resolve({
        kind: 'spawn_error',
        errno: error?.errno ?? null,
        code: error?.code ?? null,
        message: error?.message ?? String(error),
      });
      return;
    }

    if (!child || typeof child.on !== 'function') {
      resolve({ kind: 'spawn_error', code: 'NO_CHILD_HANDLE', message: 'spawn returned no child handle' });
      return;
    }

    const start = Date.now();
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let stderrBuf = '';
    let settled = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      try { child.kill('SIGTERM'); } catch { /* ignore */ }
      resolve(result);
    };

    const watchdog = setTimeout(() => {
      const elapsed_ms = Date.now() - start;
      if (stdoutBytes > 0) {
        finish({ kind: 'stdout_observed', elapsed_ms });
      } else if (stderrBytes > 0) {
        finish({ kind: 'stderr_only', elapsed_ms, stderr_snippet: stderrBuf.slice(0, 500) });
      } else {
        finish({ kind: 'hang', elapsed_ms });
      }
    }, timeoutMs);
    if (typeof watchdog.unref === 'function') watchdog.unref();

    child.stdout?.on('data', (chunk) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > 0 && !settled) {
        clearTimeout(watchdog);
        finish({ kind: 'stdout_observed', elapsed_ms: Date.now() - start });
      }
    });

    child.stderr?.on('data', (chunk) => {
      stderrBytes += chunk.length;
      stderrBuf += chunk.toString('utf8');
    });

    child.on('error', (error) => {
      clearTimeout(watchdog);
      finish({
        kind: 'spawn_error',
        errno: error?.errno ?? null,
        code: error?.code ?? null,
        message: error?.message ?? String(error),
      });
    });

    child.on('exit', (code, signal) => {
      if (settled) return;
      clearTimeout(watchdog);
      const elapsed_ms = Date.now() - start;
      if (stdoutBytes > 0) {
        finish({ kind: 'stdout_observed', elapsed_ms });
      } else if (code !== 0) {
        finish({
          kind: 'exit_nonzero',
          elapsed_ms,
          exit_code: code,
          exit_signal: signal,
          stderr_snippet: stderrBuf.slice(0, 500),
        });
      } else if (stderrBytes > 0) {
        finish({ kind: 'stderr_only', elapsed_ms, stderr_snippet: stderrBuf.slice(0, 500) });
      } else {
        finish({ kind: 'hang', elapsed_ms });
      }
    });

    try {
      child.stdin?.end(`${stdinPayload}\n`);
    } catch {
      // best-effort; error will surface via 'error' event if real
    }
  });
}

export { CLAUDE_ENV_AUTH_KEYS, normalizeCommandTokens };
