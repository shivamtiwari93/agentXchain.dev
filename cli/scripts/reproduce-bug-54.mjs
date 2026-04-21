#!/usr/bin/env node
/**
 * BUG-54 reproduction harness.
 *
 * Purpose:
 *   Reproduce, with full diagnostic capture, the exact spawn shape the
 *   `local_cli` adapter uses (`cli/src/lib/adapters/local-cli-adapter.js`).
 *   Eliminates every layer between the adapter and the subprocess so the
 *   tester (and the agents) can see the raw behavior of `claude -p ...`
 *   (or whatever the configured runtime is) under repeated invocation.
 *
 * Why this exists:
 *   HUMAN-ROADMAP demands diagnostic proof BEFORE any further code fix on
 *   BUG-54. Twenty-seven post-v2.148.0 commits refined classification /
 *   display, none of them captured the underlying spawn behavior. This
 *   script captures exactly what the adapter sees, with no truncation, no
 *   classification, and no governed-state machinery between us and the
 *   process.
 *
 * What it captures, per attempt:
 *   - Pre-spawn snapshot:
 *       resolved command + args (with a redacted prompt placeholder)
 *       cwd
 *       prompt transport
 *       stdin byte count
 *       diagnostic env keys present (PATH/HOME/PWD/SHELL/TMPDIR + auth-key
 *         presence flags — values are NEVER captured)
 *   - Spawn lifecycle:
 *       spawn_attempted_at, spawn_attached_at, pid
 *       first stdout byte timestamp + line count
 *       first stderr byte timestamp + line count
 *       startup watchdog firing (if any) with elapsed time
 *       process_exit: exit code, signal, wall-clock duration
 *   - Output (FULL, NO TRUNCATION):
 *       stdout (raw)
 *       stderr (raw)
 *   - Spawn-failure errors:
 *       code, errno, syscall, message
 *
 * Usage:
 *   node cli/scripts/reproduce-bug-54.mjs                     # auto-discover, 5 attempts
 *   node cli/scripts/reproduce-bug-54.mjs --attempts 10
 *   node cli/scripts/reproduce-bug-54.mjs --runtime local-claude
 *   node cli/scripts/reproduce-bug-54.mjs --turn-id turn_abc123
 *   node cli/scripts/reproduce-bug-54.mjs --synthetic "Say only the word READY and nothing else."
 *   node cli/scripts/reproduce-bug-54.mjs --watchdog-ms 60000
 *   node cli/scripts/reproduce-bug-54.mjs --no-watchdog
 *   node cli/scripts/reproduce-bug-54.mjs --out /tmp/bug54-evidence.json
 *
 * Output:
 *   - Live progress to stderr (one line per lifecycle event, per attempt).
 *   - Full JSON capture to --out path (default ./bug-54-repro-<ts>.json).
 *   - Tester runs this and shares the JSON file. That JSON is the artifact
 *     the agents need to actually identify root cause.
 *
 * This script does NOT modify any state, does NOT write into
 * `.agentxchain/staging/` (it ignores the staged-result contract on
 * purpose), and does NOT require the governed dispatcher to be running.
 */

import { spawn, spawnSync } from 'child_process';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';

import {
  resolveCommand,
  resolvePromptTransport,
  resolveStartupWatchdogMs,
} from '../src/lib/adapters/local-cli-adapter.js';

const SCRIPT_DIR = fileURLToPath(new URL('.', import.meta.url));
const REPO_ROOT_GUESS = resolve(SCRIPT_DIR, '..', '..');

const DIAGNOSTIC_ENV_KEYS = ['PATH', 'HOME', 'PWD', 'SHELL', 'TMPDIR'];
const AUTH_ENV_KEYS_TO_PROBE = [
  'ANTHROPIC_API_KEY',
  'CLAUDE_API_KEY',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_BEDROCK',
];

// ──────────────────────────────────────────────────────────────────────────────
// Argv parsing — kept simple/explicit so tester can read what their flags do.
// ──────────────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const opts = {
    runtimeId: null,
    turnId: null,
    synthetic: null,
    attempts: 5,
    watchdogMs: null,           // null => use adapter default
    noWatchdog: false,
    out: null,
    delayBetweenMs: 500,
    cwdOverride: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--runtime' || a === '--runtime-id') opts.runtimeId = next();
    else if (a === '--turn-id') opts.turnId = next();
    else if (a === '--synthetic') opts.synthetic = next();
    else if (a === '--attempts') opts.attempts = Number.parseInt(next(), 10);
    else if (a === '--watchdog-ms') opts.watchdogMs = Number.parseInt(next(), 10);
    else if (a === '--no-watchdog') opts.noWatchdog = true;
    else if (a === '--out') opts.out = next();
    else if (a === '--delay-ms') opts.delayBetweenMs = Number.parseInt(next(), 10);
    else if (a === '--cwd') opts.cwdOverride = next();
    else if (a === '-h' || a === '--help') { printHelpAndExit(); }
    else { console.error(`[repro] unknown arg: ${a}`); printHelpAndExit(1); }
  }
  return opts;
}

function printHelpAndExit(code = 0) {
  console.error(`Usage: node cli/scripts/reproduce-bug-54.mjs [options]

  --runtime <id>          local_cli runtime to test (default: first local_cli runtime in agentxchain.json)
  --turn-id <id>          replay an existing dispatch bundle's prompt (default: most recent dispatch turn)
  --synthetic "<prompt>"  use a minimal synthetic prompt instead of a dispatch bundle
                          (isolates spawn behavior from prompt content)
  --attempts <N>          number of consecutive spawn attempts (default: 5)
  --watchdog-ms <ms>      override startup watchdog (default: adapter default, usually 30000)
  --no-watchdog           do not kill subprocess on watchdog timeout
  --delay-ms <ms>         delay between consecutive attempts (default: 500)
  --cwd <path>            override project root (default: auto-discover)
  --out <path>            write full JSON capture here (default: ./bug-54-repro-<ts>.json)
  -h, --help              show this help

Examples:
  # Default: discover real local_cli runtime, replay last dispatch, 5 attempts
  node cli/scripts/reproduce-bug-54.mjs

  # Isolate spawn from prompt content (recommended first run)
  node cli/scripts/reproduce-bug-54.mjs --synthetic "Say READY and nothing else."

  # Reproduce the operator's exact failing turn
  node cli/scripts/reproduce-bug-54.mjs --turn-id turn_abc123 --attempts 10
`);
  process.exit(code);
}

// ──────────────────────────────────────────────────────────────────────────────
// Project + runtime discovery (mirrors loadConfig but lighter; no schema dep
// chain so the script runs even on a partially-broken install).
// ──────────────────────────────────────────────────────────────────────────────

function findProjectRoot(startDir) {
  let dir = resolve(startDir);
  while (true) {
    if (existsSync(join(dir, 'agentxchain.json'))) return dir;
    const parent = resolve(dir, '..');
    if (parent === dir) return null;
    dir = parent;
  }
}

function loadConfigRaw(root) {
  const filePath = join(root, 'agentxchain.json');
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function pickLocalCliRuntime(config, requestedId) {
  const runtimes = config.runtimes || {};
  if (requestedId) {
    const runtime = runtimes[requestedId];
    if (!runtime) throw new Error(`Runtime "${requestedId}" not found in agentxchain.json`);
    if (runtime.type && runtime.type !== 'local_cli') {
      throw new Error(`Runtime "${requestedId}" is type "${runtime.type}", not local_cli`);
    }
    return { id: requestedId, runtime };
  }
  for (const [id, runtime] of Object.entries(runtimes)) {
    if ((runtime?.type ?? 'local_cli') === 'local_cli' && runtime?.command) {
      return { id, runtime };
    }
  }
  throw new Error('No local_cli runtime with a "command" field found in agentxchain.json');
}

// ──────────────────────────────────────────────────────────────────────────────
// Dispatch-bundle resolution — mirror the adapter's prompt-source logic.
// ──────────────────────────────────────────────────────────────────────────────

function findMostRecentTurnId(root) {
  const turnsDir = join(root, '.agentxchain', 'dispatch', 'turns');
  if (!existsSync(turnsDir)) return null;
  const entries = readdirSync(turnsDir)
    .map((name) => {
      const path = join(turnsDir, name);
      try {
        const stat = statSync(path);
        return stat.isDirectory() ? { name, mtime: stat.mtimeMs } : null;
      } catch { return null; }
    })
    .filter(Boolean)
    .sort((a, b) => b.mtime - a.mtime);
  return entries[0]?.name ?? null;
}

function loadPromptForTurn(root, turnId) {
  const promptPath = join(root, '.agentxchain', 'dispatch', 'turns', turnId, 'PROMPT.md');
  const contextPath = join(root, '.agentxchain', 'dispatch', 'turns', turnId, 'CONTEXT.md');
  if (!existsSync(promptPath)) {
    throw new Error(`Dispatch bundle not found: ${promptPath}`);
  }
  const prompt = readFileSync(promptPath, 'utf8');
  const context = existsSync(contextPath) ? readFileSync(contextPath, 'utf8') : '';
  return { fullPrompt: prompt + '\n---\n\n' + context, promptPath, contextPath };
}

function redactArgs(args, fullPrompt, transport) {
  const placeholder = `<prompt:${Buffer.byteLength(fullPrompt, 'utf8')} bytes>`;
  return args.map((a) => {
    if (typeof a !== 'string') return a;
    if (transport === 'argv' && a === fullPrompt) return placeholder;
    return a;
  });
}

function snapshotEnv(env) {
  const visible = {};
  for (const k of DIAGNOSTIC_ENV_KEYS) {
    if (typeof env[k] === 'string' && env[k].length > 0) visible[k] = env[k];
  }
  const authProbe = {};
  for (const k of AUTH_ENV_KEYS_TO_PROBE) {
    authProbe[k] = typeof env[k] === 'string' && env[k].length > 0;
  }
  return { visible, auth_env_present: authProbe };
}

// ──────────────────────────────────────────────────────────────────────────────
// One spawn attempt. Captures everything; never throws.
// ──────────────────────────────────────────────────────────────────────────────

async function runOneAttempt({
  attemptIndex,
  command,
  args,
  cwd,
  env,
  transport,
  fullPrompt,
  watchdogMs,
  noWatchdog,
}) {
  const t0 = Date.now();
  const attempt = {
    attempt_index: attemptIndex,
    spawn_attempted_at: new Date(t0).toISOString(),
    pid: null,
    spawn_attached_at: null,
    spawn_attached_elapsed_ms: null,
    first_stdout_at: null,
    first_stdout_elapsed_ms: null,
    first_stderr_at: null,
    first_stderr_elapsed_ms: null,
    stdout_lines: 0,
    stderr_lines: 0,
    stdout_bytes: 0,
    stderr_bytes: 0,
    stdout: '',
    stderr: '',
    watchdog_fired: false,
    watchdog_elapsed_ms: null,
    spawn_error: null,            // sync throw at spawn() — process never created
    process_error: null,          // 'error' event from subprocess
    exit_code: null,
    exit_signal: null,
    exit_at: null,
    exit_elapsed_ms: null,
    classification: null,         // computed at end
  };

  return await new Promise((resolveAttempt) => {
    let child;
    let watchdogTimer = null;
    let settled = false;

    const settle = () => {
      if (settled) return;
      settled = true;
      if (watchdogTimer) { clearTimeout(watchdogTimer); watchdogTimer = null; }
      attempt.classification = classifyAttempt(attempt);
      resolveAttempt(attempt);
    };

    try {
      child = spawn(command, args, {
        cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        env,
      });
    } catch (err) {
      attempt.spawn_error = {
        code: err?.code ?? null,
        errno: err?.errno ?? null,
        syscall: err?.syscall ?? null,
        message: err?.message || String(err),
      };
      attempt.exit_at = new Date().toISOString();
      attempt.exit_elapsed_ms = Date.now() - t0;
      settle();
      return;
    }

    child.on('spawn', () => {
      const now = Date.now();
      attempt.pid = child.pid ?? null;
      attempt.spawn_attached_at = new Date(now).toISOString();
      attempt.spawn_attached_elapsed_ms = now - t0;
    });

    if (child.stdout) {
      child.stdout.on('data', (chunk) => {
        const text = chunk.toString();
        if (!attempt.first_stdout_at) {
          const now = Date.now();
          attempt.first_stdout_at = new Date(now).toISOString();
          attempt.first_stdout_elapsed_ms = now - t0;
        }
        attempt.stdout += text;
        attempt.stdout_bytes += Buffer.byteLength(text);
        attempt.stdout_lines += (text.match(/\n/g) || []).length;
      });
    }

    if (child.stdin) {
      child.stdin.on('error', (err) => {
        // Capture but do not fail — adapter behavior matches: stdin EPIPE is
        // logged and the spawn continues to play out via close/error events.
        attempt.stderr += `[repro:stdin_error] ${err?.code || ''} ${err?.message || ''}\n`;
      });
      try {
        if (transport === 'stdin') child.stdin.write(fullPrompt);
        child.stdin.end();
      } catch (err) {
        attempt.stderr += `[repro:stdin_throw] ${err?.code || ''} ${err?.message || ''}\n`;
      }
    }

    if (child.stderr) {
      child.stderr.on('data', (chunk) => {
        const text = chunk.toString();
        if (!attempt.first_stderr_at) {
          const now = Date.now();
          attempt.first_stderr_at = new Date(now).toISOString();
          attempt.first_stderr_elapsed_ms = now - t0;
        }
        attempt.stderr += text;
        attempt.stderr_bytes += Buffer.byteLength(text);
        attempt.stderr_lines += (text.match(/\n/g) || []).length;
      });
    }

    if (!noWatchdog && Number.isFinite(watchdogMs) && watchdogMs > 0) {
      watchdogTimer = setTimeout(() => {
        if (attempt.first_stdout_at || attempt.first_stderr_at) {
          // Match adapter behavior: if anything came out we still let the
          // adapter's no-output rule decide. But here we mark fire either way.
        }
        attempt.watchdog_fired = true;
        attempt.watchdog_elapsed_ms = Date.now() - t0;
        try { child.kill('SIGTERM'); } catch {}
        // Give 2s then SIGKILL just in case
        setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 2000);
      }, watchdogMs);
    }

    child.on('error', (err) => {
      attempt.process_error = {
        code: err?.code ?? null,
        errno: err?.errno ?? null,
        syscall: err?.syscall ?? null,
        message: err?.message || String(err),
      };
      // 'error' may fire before or instead of 'close'; settle if no close coming
      if (!child.exitCode && !child.signalCode) {
        // Wait briefly for close; if it doesn't come, settle.
        setTimeout(() => {
          if (!settled && attempt.exit_at == null) {
            attempt.exit_at = new Date().toISOString();
            attempt.exit_elapsed_ms = Date.now() - t0;
            settle();
          }
        }, 250);
      }
    });

    child.on('close', (code, signal) => {
      const now = Date.now();
      attempt.exit_code = code;
      attempt.exit_signal = signal;
      attempt.exit_at = new Date(now).toISOString();
      attempt.exit_elapsed_ms = now - t0;
      settle();
    });
  });
}

function classifyAttempt(a) {
  if (a.spawn_error) return 'spawn_error_pre_process';
  if (a.process_error && !a.spawn_attached_at) return 'spawn_attach_failed';
  if (!a.spawn_attached_at) return 'spawn_unattached';
  if (a.watchdog_fired && !a.first_stdout_at && !a.first_stderr_at) return 'watchdog_no_output';
  if (a.watchdog_fired && !a.first_stdout_at) return 'watchdog_stderr_only';
  if (!a.first_stdout_at && !a.first_stderr_at) return 'exit_no_output';
  if (!a.first_stdout_at) return 'exit_stderr_only';
  if (a.exit_code === 0) return 'exit_clean_with_stdout';
  return 'exit_nonzero_with_stdout';
}

// ──────────────────────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const startDir = opts.cwdOverride || process.cwd();
  let root = findProjectRoot(startDir);
  if (!root) root = REPO_ROOT_GUESS;
  if (!root || !existsSync(join(root, 'agentxchain.json'))) {
    console.error(`[repro] could not find an agentxchain.json starting from ${startDir}`);
    console.error(`[repro] use --cwd <path> to point at a project root`);
    process.exit(2);
  }

  let configRaw;
  try {
    configRaw = loadConfigRaw(root);
  } catch (err) {
    console.error(`[repro] failed to read agentxchain.json at ${root}: ${err.message}`);
    process.exit(2);
  }

  let runtimeChoice;
  try {
    runtimeChoice = pickLocalCliRuntime(configRaw, opts.runtimeId);
  } catch (err) {
    console.error(`[repro] ${err.message}`);
    process.exit(2);
  }
  const { id: runtimeId, runtime } = runtimeChoice;

  // Resolve prompt
  let fullPrompt;
  let promptSource;
  if (opts.synthetic) {
    fullPrompt = opts.synthetic;
    promptSource = { kind: 'synthetic', length_bytes: Buffer.byteLength(fullPrompt) };
  } else {
    const turnId = opts.turnId || findMostRecentTurnId(root);
    if (!turnId) {
      // No real bundle available — fall back to a synthetic prompt and warn.
      fullPrompt = 'Say only the word READY and nothing else. Do not reason out loud.';
      promptSource = {
        kind: 'synthetic_fallback',
        reason: 'no dispatch bundle found; pass --turn-id or --synthetic to override',
        length_bytes: Buffer.byteLength(fullPrompt),
      };
    } else {
      try {
        const loaded = loadPromptForTurn(root, turnId);
        fullPrompt = loaded.fullPrompt;
        promptSource = {
          kind: 'dispatch_bundle',
          turn_id: turnId,
          prompt_path: loaded.promptPath,
          context_path: loaded.contextPath,
          length_bytes: Buffer.byteLength(fullPrompt),
        };
      } catch (err) {
        console.error(`[repro] failed to load dispatch bundle for ${turnId}: ${err.message}`);
        process.exit(2);
      }
    }
  }

  const transport = resolvePromptTransport(runtime);
  const { command, args } = resolveCommand(runtime, fullPrompt);
  if (!command) {
    console.error(`[repro] runtime "${runtimeId}" has no resolvable command`);
    process.exit(2);
  }

  const watchdogMs = opts.watchdogMs ?? resolveStartupWatchdogMs(configRaw, runtime);
  const runtimeCwd = runtime.cwd ? join(root, runtime.cwd) : root;

  // Synthetic turn id so the subprocess sees the same env shape the adapter sets
  const fakeTurnId = `turn_repro_${Date.now()}`;
  const spawnEnv = { ...process.env, AGENTXCHAIN_TURN_ID: fakeTurnId };
  const stdinBytes = transport === 'stdin' ? Buffer.byteLength(fullPrompt) : 0;
  const diagnosticArgs = redactArgs(args, fullPrompt, transport);
  const envSnapshot = snapshotEnv(spawnEnv);
  const commandProbe = probeCommand(command, runtimeCwd, spawnEnv);

  const header = {
    repro_version: 1,
    started_at: new Date().toISOString(),
    project_root: root,
    runtime_id: runtimeId,
    runtime_type: runtime.type ?? 'local_cli',
    resolved_command: command,
    resolved_args_redacted: diagnosticArgs,
    cwd: runtimeCwd,
    prompt_transport: transport,
    stdin_bytes: stdinBytes,
    prompt_source: promptSource,
    env_snapshot: envSnapshot,
    command_probe: commandProbe,
    watchdog_ms: opts.noWatchdog ? null : watchdogMs,
    no_watchdog: opts.noWatchdog,
    attempts_planned: opts.attempts,
    delay_between_ms: opts.delayBetweenMs,
    fake_turn_id: fakeTurnId,
    node_version: process.version,
    platform: process.platform,
    arch: process.arch,
  };

  console.error('[repro] BUG-54 reproduction harness');
  console.error(`[repro] root         : ${header.project_root}`);
  console.error(`[repro] runtime      : ${header.runtime_id} (${header.runtime_type})`);
  console.error(`[repro] command      : ${header.resolved_command} ${JSON.stringify(header.resolved_args_redacted)}`);
  console.error(`[repro] transport    : ${header.prompt_transport} (stdin_bytes=${header.stdin_bytes})`);
  console.error(`[repro] cwd          : ${header.cwd}`);
  console.error(`[repro] prompt       : ${promptSource.kind} (${promptSource.length_bytes} bytes)`);
  console.error(`[repro] watchdog_ms  : ${header.watchdog_ms ?? 'disabled'}`);
  console.error(`[repro] auth env     : ${JSON.stringify(envSnapshot.auth_env_present)}`);
  if (commandProbe.kind === 'claude_version') {
    console.error(`[repro] claude probe : status=${commandProbe.status ?? '-'} signal=${commandProbe.signal ?? '-'} stdout=${JSON.stringify(commandProbe.stdout || '')}`);
  } else {
    console.error(`[repro] command probe: ${commandProbe.kind} (${commandProbe.reason})`);
  }
  console.error(`[repro] attempts     : ${header.attempts_planned}`);
  console.error('');

  const attempts = [];
  for (let i = 1; i <= opts.attempts; i++) {
    console.error(`[repro] attempt ${i}/${opts.attempts} starting...`);
    const result = await runOneAttempt({
      attemptIndex: i,
      command,
      args,
      cwd: runtimeCwd,
      env: spawnEnv,
      transport,
      fullPrompt,
      watchdogMs,
      noWatchdog: opts.noWatchdog,
    });
    attempts.push(result);
    console.error(
      `[repro] attempt ${i} -> classification=${result.classification} ` +
      `pid=${result.pid ?? '-'} ` +
      `attached_ms=${result.spawn_attached_elapsed_ms ?? '-'} ` +
      `first_stdout_ms=${result.first_stdout_elapsed_ms ?? '-'} ` +
      `first_stderr_ms=${result.first_stderr_elapsed_ms ?? '-'} ` +
      `exit=${result.exit_code ?? '-'} signal=${result.exit_signal ?? '-'} ` +
      `dur_ms=${result.exit_elapsed_ms ?? '-'} ` +
      `stdout_lines=${result.stdout_lines} stderr_lines=${result.stderr_lines}`
    );
    if (i < opts.attempts && opts.delayBetweenMs > 0) {
      await new Promise((r) => setTimeout(r, opts.delayBetweenMs));
    }
  }

  const summary = summarize(attempts);
  console.error('');
  console.error(`[repro] summary: ${JSON.stringify(summary)}`);

  const outPath = opts.out
    ? resolve(opts.out)
    : resolve(`bug-54-repro-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  const payload = {
    ...header,
    finished_at: new Date().toISOString(),
    summary,
    attempts,
  };
  writeFileSync(outPath, JSON.stringify(payload, null, 2) + '\n');
  console.error('');
  console.error(`[repro] full capture written to: ${outPath}`);
  console.error('[repro] share this file in BUG-54 thread / AGENT-TALK.md');
}

function summarize(attempts) {
  const classification = {};
  let stdout_attached = 0;
  let attached = 0;
  let watchdog_fires = 0;
  let spawn_errors = 0;
  let process_errors = 0;
  let total_first_stdout_ms = 0;
  let stdout_samples = 0;
  for (const a of attempts) {
    classification[a.classification] = (classification[a.classification] || 0) + 1;
    if (a.spawn_attached_at) attached++;
    if (a.first_stdout_at) {
      stdout_attached++;
      total_first_stdout_ms += a.first_stdout_elapsed_ms || 0;
      stdout_samples++;
    }
    if (a.watchdog_fired) watchdog_fires++;
    if (a.spawn_error) spawn_errors++;
    if (a.process_error) process_errors++;
  }
  return {
    total: attempts.length,
    spawn_attached: attached,
    stdout_attached,
    watchdog_fires,
    spawn_errors,
    process_errors,
    avg_first_stdout_ms: stdout_samples > 0 ? Math.round(total_first_stdout_ms / stdout_samples) : null,
    classification,
    success_rate_first_stdout: attempts.length > 0
      ? Number((stdout_attached / attempts.length).toFixed(3))
      : 0,
  };
}

function probeCommand(command, cwd, env) {
  if (!isClaudeCommand(command)) {
    return {
      kind: 'skipped',
      reason: 'not a claude command',
    };
  }
  try {
    const result = spawnSync(command, ['--version'], {
      cwd,
      env,
      encoding: 'utf8',
      timeout: 10_000,
      maxBuffer: 1024 * 1024,
    });
    return {
      kind: 'claude_version',
      command,
      args: ['--version'],
      timeout_ms: 10_000,
      status: result.status,
      signal: result.signal,
      stdout: result.stdout || '',
      stderr: result.stderr || '',
      error: result.error ? {
        code: result.error.code ?? null,
        errno: result.error.errno ?? null,
        syscall: result.error.syscall ?? null,
        message: result.error.message || String(result.error),
      } : null,
      timed_out: result.error?.code === 'ETIMEDOUT',
    };
  } catch (err) {
    return {
      kind: 'claude_version',
      command,
      args: ['--version'],
      timeout_ms: 10_000,
      status: null,
      signal: null,
      stdout: '',
      stderr: '',
      error: {
        code: err?.code ?? null,
        errno: err?.errno ?? null,
        syscall: err?.syscall ?? null,
        message: err?.message || String(err),
      },
      timed_out: err?.code === 'ETIMEDOUT',
    };
  }
}

function isClaudeCommand(command) {
  if (typeof command !== 'string') return false;
  const normalized = command.replace(/\\/g, '/');
  return normalized === 'claude' || normalized.endsWith('/claude');
}

main().catch((err) => {
  console.error(`[repro] fatal: ${err?.stack || err?.message || err}`);
  process.exit(99);
});
