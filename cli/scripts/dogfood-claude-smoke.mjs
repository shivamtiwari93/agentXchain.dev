#!/usr/bin/env node
/**
 * DOGFOOD-100 Claude credential smoke helper.
 *
 * This script is intentionally state-free: it does not run AgentXchain,
 * mutate `.agentxchain`, or touch staging JSON. Its job is to prove whether
 * the local Claude process can authenticate under a compatible Node runtime
 * before anyone resumes the paused Tusq DOGFOOD-100 session.
 */

import { spawn, spawnSync } from 'node:child_process';
import { accessSync, constants, existsSync, readFileSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  getClaudeEnvAuthPresence,
  hasClaudeAuthenticationFailureText,
  hasClaudeNodeIncompatibilityText,
  isClaudeCompatibleNodeVersion,
  resolveClaudeCompatibleNodeBinary,
} from '../src/lib/claude-local-auth.js';

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_PROMPT = 'Say only READY.';
const STDIO_SNIPPET_LIMIT = 1200;

const EXIT = {
  success: 0,
  usage_error: 64,
  env_file_missing: 66,
  anthropic_auth_failed: 3,
  node_runtime_incompatible: 4,
  timeout: 5,
  spawn_error: 6,
  exit_nonzero: 2,
};

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = resolve(SCRIPT_DIR, '..');
const REPO_ROOT = resolve(CLI_ROOT, '..');

function parseArgs(argv) {
  const opts = {
    credentialEnvFile: null,
    cwd: process.cwd(),
    claude: 'claude',
    node: null,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    prompt: DEFAULT_PROMPT,
    json: false,
  };

  for (let i = 0; i < argv.length;) {
    const arg = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) {
        throw new Error(`Missing value for ${arg}`);
      }
      i += 1;
      return argv[i];
    };
    if (arg === '--credential-env-file') opts.credentialEnvFile = next();
    else if (arg === '--env-file') {
      throw new Error('Use --credential-env-file; --env-file collides with Node.js process flags.');
    }
    else if (arg === '--cwd') opts.cwd = next();
    else if (arg === '--claude') opts.claude = next();
    else if (arg === '--node') opts.node = next();
    else if (arg === '--timeout-ms') opts.timeoutMs = Number.parseInt(next(), 10);
    else if (arg === '--prompt') opts.prompt = next();
    else if (arg === '--json') opts.json = true;
    else if (arg === '-h' || arg === '--help') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
    i += 1;
  }

  if (!Number.isInteger(opts.timeoutMs) || opts.timeoutMs <= 0) {
    throw new Error('--timeout-ms must be a positive integer');
  }
  return opts;
}

function printHelp() {
  console.log(`Usage: node cli/scripts/dogfood-claude-smoke.mjs [options]

Options:
  --credential-env-file <path>
                      Load dotenv-style credential env before running Claude.
  --cwd <path>        Working directory for Claude. Defaults to current dir.
  --claude <path>     Claude executable or name. Defaults to "claude".
  --node <path>       Compatible Node binary override.
  --timeout-ms <n>    Watchdog timeout. Defaults to ${DEFAULT_TIMEOUT_MS}.
  --prompt <text>     Non-secret prompt. Defaults to "${DEFAULT_PROMPT}".
  --json              Emit compact JSON only.
`);
}

function parseDotenv(raw) {
  const env = {};
  for (const line of String(raw || '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    let value = rawValue.trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

function loadEnvFile(env, envFile) {
  if (!envFile) return env;
  const resolved = resolve(envFile);
  if (!existsSync(resolved)) {
    return {
      error: {
        ok: false,
        classification: 'env_file_missing',
        message: `Env file not found: ${resolved}`,
      },
    };
  }
  return { ...env, ...parseDotenv(readFileSync(resolved, 'utf8')) };
}

function isExecutable(filePath) {
  if (!filePath) return false;
  try {
    accessSync(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveCommandPath(command, envPath) {
  if (!command) return null;
  if (command.includes('/')) {
    const resolved = resolve(command);
    return existsSync(resolved) ? resolved : null;
  }
  for (const dir of String(envPath || '').split(delimiter).filter(Boolean)) {
    const candidate = join(dir, command);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function readNodeVersion(nodePath) {
  if (!isExecutable(nodePath)) return null;
  const result = spawnSync(nodePath, ['--version'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: 2000,
  });
  if (result.status !== 0) return null;
  return String(result.stdout || '').trim();
}

function isNodeEntrypoint(filePath) {
  try {
    const firstLine = readFileSync(filePath, 'utf8').split(/\r?\n/, 1)[0] || '';
    return /^#!.*(?:^|[\/\s])(?:env\s+)?node(?:\s|$)/.test(firstLine);
  } catch {
    return false;
  }
}

function resolveNode(opts, env) {
  const candidate = opts.node ? resolve(opts.node) : resolveClaudeCompatibleNodeBinary(env);
  const version = readNodeVersion(candidate);
  return {
    command: candidate,
    version,
    compatible: isClaudeCompatibleNodeVersion(version),
    source: opts.node ? 'argv' : 'agentxchain_resolution',
  };
}

function buildSpawnSpec(opts, env) {
  const claudeEntry = resolveCommandPath(opts.claude, env.PATH);
  const node = resolveNode(opts, env);
  const claude = {
    configured: opts.claude,
    resolved: claudeEntry,
    is_node_entrypoint: claudeEntry ? isNodeEntrypoint(claudeEntry) : false,
    spawn_wrapper: null,
  };

  if (!claudeEntry) {
    return {
      command: opts.claude,
      args: ['--print'],
      node,
      claude,
      preflightClassification: 'spawn_error',
      preflightMessage: `Claude executable not found: ${opts.claude}`,
    };
  }

  if (claude.is_node_entrypoint) {
    if (!node.compatible || !node.command) {
      return {
        command: claudeEntry,
        args: ['--print'],
        node,
        claude,
        preflightClassification: 'node_runtime_incompatible',
        preflightMessage: 'Claude is a Node entrypoint but no compatible Node binary is available.',
      };
    }
    claude.spawn_wrapper = 'claude_compatible_node';
    return {
      command: node.command,
      args: [claudeEntry, '--print'],
      node,
      claude,
      preflightClassification: null,
      preflightMessage: null,
    };
  }

  return {
    command: claudeEntry,
    args: ['--print'],
    node,
    claude,
    preflightClassification: null,
    preflightMessage: null,
  };
}

function snippet(text) {
  const raw = String(text || '');
  if (raw.length <= STDIO_SNIPPET_LIMIT) return raw;
  return raw.slice(raw.length - STDIO_SNIPPET_LIMIT);
}

function classifyProcess({ code, signal, timedOut, stdout, stderr, spawnError }) {
  const combined = `${stdout || ''}\n${stderr || ''}`;
  if (spawnError) return 'spawn_error';
  if (timedOut) return 'timeout';
  if (hasClaudeNodeIncompatibilityText(combined)) return 'node_runtime_incompatible';
  if (hasClaudeAuthenticationFailureText(combined)) return 'anthropic_auth_failed';
  if (code === 0) return 'success';
  return 'exit_nonzero';
}

function runClaude(spawnSpec, opts, env) {
  return new Promise((resolveResult) => {
    let child;
    try {
      child = spawn(spawnSpec.command, spawnSpec.args, {
        cwd: resolve(opts.cwd),
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (error) {
      resolveResult({ spawnError: normalizeError(error), stdout: '', stderr: '' });
      return;
    }

    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveResult({ ...result, timedOut, stdout, stderr });
    };

    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill('SIGTERM'); } catch {}
      finish({ code: null, signal: 'SIGTERM' });
    }, opts.timeoutMs);
    if (typeof timer.unref === 'function') timer.unref();

    child.stdout?.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
    child.stderr?.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
    child.on('error', (error) => finish({ spawnError: normalizeError(error), code: null, signal: null }));
    child.on('exit', (code, signal) => finish({ code, signal }));

    try {
      child.stdin?.end(`${opts.prompt}\n`);
    } catch {}
  });
}

function normalizeError(error) {
  return {
    code: error?.code ?? null,
    errno: error?.errno ?? null,
    syscall: error?.syscall ?? null,
    message: error?.message ?? String(error),
  };
}

function buildPayload({ classification, message = null, opts, env, spawnSpec = null, processResult = null }) {
  return {
    ok: classification === 'success',
    classification,
    message,
    cwd: resolve(opts.cwd),
    auth_env_present: getClaudeEnvAuthPresence(env),
    node: spawnSpec?.node ?? null,
    claude: spawnSpec?.claude ?? { configured: opts.claude, resolved: null, is_node_entrypoint: null, spawn_wrapper: null },
    exit_code: processResult?.code ?? null,
    exit_signal: processResult?.signal ?? null,
    stdout_snippet: snippet(processResult?.stdout),
    stderr_snippet: snippet(processResult?.stderr),
    spawn_error: processResult?.spawnError ?? null,
  };
}

function emit(payload, jsonOnly) {
  if (jsonOnly) {
    console.log(JSON.stringify(payload));
    return;
  }
  console.log(JSON.stringify(payload, null, 2));
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (error) {
    const payload = {
      ok: false,
      classification: 'usage_error',
      message: error?.message || String(error),
    };
    emit(payload, false);
    process.exit(EXIT.usage_error);
  }

  const envResult = loadEnvFile(process.env, opts.credentialEnvFile);
  if (envResult?.error) {
    const payload = { ...envResult.error, auth_env_present: getClaudeEnvAuthPresence(process.env) };
    emit(payload, opts.json);
    process.exit(EXIT.env_file_missing);
  }
  const env = envResult;
  const spawnSpec = buildSpawnSpec(opts, env);
  if (spawnSpec.preflightClassification) {
    const payload = buildPayload({
      classification: spawnSpec.preflightClassification,
      message: spawnSpec.preflightMessage,
      opts,
      env,
      spawnSpec,
    });
    emit(payload, opts.json);
    process.exit(EXIT[spawnSpec.preflightClassification] ?? EXIT.exit_nonzero);
  }

  const processResult = await runClaude(spawnSpec, opts, env);
  const classification = classifyProcess(processResult);
  const payload = buildPayload({ classification, opts, env, spawnSpec, processResult });
  emit(payload, opts.json);
  process.exit(EXIT[classification] ?? EXIT.exit_nonzero);
}

await main();

export {
  buildSpawnSpec,
  classifyProcess,
  parseDotenv,
};
