import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { basename, join } from 'node:path';

const DEFAULT_PROBE_TIMEOUT_MS = 500;
const PROMPT_PLACEHOLDER = 'AgentXchain spawn-context probe';

function resolveLocalCliPromptTransport(runtime) {
  const valid = new Set(['argv', 'stdin', 'dispatch_bundle_only']);
  if (valid.has(runtime?.prompt_transport)) {
    return runtime.prompt_transport;
  }

  const parts = Array.isArray(runtime?.command)
    ? runtime.command
    : [runtime?.command, ...(Array.isArray(runtime?.args) ? runtime.args : [])];
  const hasPrompt = parts.some((part) => typeof part === 'string' && part.includes('{prompt}'));
  return hasPrompt ? 'argv' : 'dispatch_bundle_only';
}

function resolveLocalCliInvocation(runtime) {
  if (!runtime?.command) {
    return { command: null, args: [] };
  }

  const transport = resolveLocalCliPromptTransport(runtime);

  if (Array.isArray(runtime.command)) {
    const first = runtime.command[0] || '';
    const headParts = typeof first === 'string' && first.includes(' ') ? first.split(/\s+/) : [first];
    const [command, ...headArgs] = headParts;
    const rest = [...headArgs, ...runtime.command.slice(1)];
    const args = transport === 'argv'
      ? rest.map((arg) => arg === '{prompt}' ? PROMPT_PLACEHOLDER : arg)
      : rest.filter((arg) => arg !== '{prompt}');
    return { command, args };
  }

  const args = transport === 'argv'
    ? (runtime.args || []).map((arg) => arg === '{prompt}' ? PROMPT_PLACEHOLDER : arg)
    : (runtime.args || []).filter((arg) => arg !== '{prompt}');
  return { command: runtime.command, args };
}

function resolveMcpInvocation(runtime) {
  if (!runtime?.command) {
    return { command: null, args: [] };
  }

  if (Array.isArray(runtime.command)) {
    const [command, ...args] = runtime.command;
    return { command, args };
  }

  return {
    command: runtime.command,
    args: Array.isArray(runtime.args) ? runtime.args : [],
  };
}

function resolveInvocation(runtime) {
  if (runtime?.type === 'local_cli') {
    return resolveLocalCliInvocation(runtime);
  }
  return resolveMcpInvocation(runtime);
}

function buildResolutionFix(command) {
  const commandValue = String(command || '');
  const commandBase = basename(commandValue);

  if (commandBase === 'codex' || commandBase === 'codex.exe') {
    return 'Set "command" to the absolute path, e.g. "/Applications/Codex.app/Contents/Resources/codex", or add Codex to PATH in the dispatch spawn context.';
  }
  if (commandValue.includes('~')) {
    return 'Expand "~" to an absolute path in "command". Shell expansion does not apply to governed dispatch.';
  }
  return 'Set "command" to an absolute path or add it to PATH in the dispatch spawn context.';
}

export function probeRuntimeSpawnContext(root, runtime, options = {}) {
  const runtimeId = options.runtimeId || null;
  const cwd = runtime?.cwd ? join(root, runtime.cwd) : root;
  const { command, args } = resolveInvocation(runtime);

  if (!command) {
    return {
      ok: false,
      runtime_id: runtimeId,
      command: null,
      cwd,
      detail: 'No command configured for the dispatch spawn context.',
    };
  }

  if (!existsSync(cwd)) {
    return {
      ok: false,
      runtime_id: runtimeId,
      command,
      cwd,
      detail: `Runtime cwd "${runtime.cwd}" does not exist in the dispatch spawn context.`,
    };
  }

  const probe = spawnSync(command, args, {
    cwd,
    env: { ...process.env, AGENTXCHAIN_SPAWN_PROBE: '1' },
    stdio: 'ignore',
    timeout: options.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS,
    windowsHide: true,
  });

  if (probe.error) {
    const errorCode = probe.error.code || 'spawn_error';
    if (errorCode === 'ETIMEDOUT') {
      return {
        ok: true,
        runtime_id: runtimeId,
        command,
        cwd,
        timed_out: true,
        detail: `"${command}" launched in the dispatch spawn context but exceeded the short probe timeout. Treating this as resolvable.`,
      };
    }
    if (errorCode === 'ENOENT') {
      return {
        ok: false,
        runtime_id: runtimeId,
        command,
        cwd,
        error_code: errorCode,
        detail: `"${command}" is not resolvable in the dispatch spawn context. ${buildResolutionFix(command)}`,
      };
    }
    if (errorCode === 'EACCES') {
      return {
        ok: false,
        runtime_id: runtimeId,
        command,
        cwd,
        error_code: errorCode,
        detail: `"${command}" exists but is not executable in the dispatch spawn context. Mark it executable or point "command" at the real executable path.`,
      };
    }
    return {
      ok: false,
      runtime_id: runtimeId,
      command,
      cwd,
      error_code: errorCode,
      detail: `Dispatch spawn probe failed for "${command}": ${probe.error.message}`,
    };
  }

  return {
    ok: true,
    runtime_id: runtimeId,
    command,
    cwd,
    detail: `"${command}" is resolvable in the dispatch spawn context.`,
  };
}
