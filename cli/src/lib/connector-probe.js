import {
  buildProviderHeaders,
  buildProviderRequest,
  PROVIDER_ENDPOINTS,
} from './adapters/api-proxy-adapter.js';
import { probeRuntimeSpawnContext } from './runtime-spawn-context.js';
import { getClaudeSubprocessAuthIssue, normalizeCommandTokens } from './claude-local-auth.js';

const PROBEABLE_RUNTIME_TYPES = new Set(['local_cli', 'api_proxy', 'mcp', 'remote_agent']);
const DEFAULT_TIMEOUT_MS = 8_000;

/**
 * Known local CLI tools and their authoritative-mode flags.
 * Each entry maps a binary name pattern to the flag required for true
 * unattended authoritative writes and any flags that look similar but
 * do NOT grant full authority.
 */
const KNOWN_CLI_AUTHORITY_FLAGS = [
  {
    binary: 'claude',
    authoritative_flag: '--dangerously-skip-permissions',
    weak_flags: [],
    label: 'Claude Code',
  },
  {
    binary: 'codex',
    authoritative_flag: '--dangerously-bypass-approvals-and-sandbox',
    weak_flags: ['--full-auto'],
    label: 'OpenAI Codex CLI',
  },
];

/**
 * Known prompt transport requirements per CLI binary.
 * Maps binary name to expected transport.
 */
const KNOWN_CLI_TRANSPORTS = {
  claude: ['stdin'],
  codex: ['argv', 'stdin'],
};

function formatCommand(command, args = []) {
  if (Array.isArray(command)) {
    return command.join(' ');
  }
  if (typeof command === 'string' && command.length > 0) {
    return [command, ...(Array.isArray(args) ? args : [])].join(' ');
  }
  return null;
}

function formatTarget(runtime) {
  switch (runtime?.type) {
    case 'api_proxy':
      return [runtime.provider, runtime.model].filter(Boolean).join(' / ') || 'unknown target';
    case 'remote_agent':
      return runtime.url || 'unknown target';
    case 'mcp':
      return runtime.transport === 'streamable_http'
        ? (runtime.url || 'unknown target')
        : (formatCommand(runtime.command, runtime.args) || 'unknown target');
    case 'local_cli':
      return formatCommand(runtime.command, runtime.args) || 'unknown target';
    default:
      return 'unknown target';
  }
}

function commandHead(runtime) {
  if (Array.isArray(runtime?.command)) {
    const first = runtime.command[0] || null;
    if (first && first.includes(' ')) return first.split(/\s+/)[0];
    return first;
  }
  if (typeof runtime?.command === 'string' && runtime.command.trim()) {
    return runtime.command.trim().split(/\s+/)[0];
  }
  return null;
}

function resolveProviderEndpoint(runtime) {
  if (typeof runtime?.base_url === 'string' && runtime.base_url.trim()) {
    return runtime.base_url.trim();
  }

  const provider = String(runtime?.provider || '').trim().toLowerCase();
  const endpointTemplate = PROVIDER_ENDPOINTS[provider];
  if (!endpointTemplate) return null;

  if (endpointTemplate.includes('{model}')) {
    return endpointTemplate.replace('{model}', encodeURIComponent(runtime.model || ''));
  }
  return endpointTemplate;
}

function classifyHttpFailure(status, bodyText, authEnv) {
  if (status === 401 || status === 403) {
    return {
      level: 'fail',
      detail: authEnv
        ? `${authEnv} was rejected by the remote endpoint`
        : 'Remote endpoint rejected the request as unauthorized',
    };
  }
  if (status === 404) {
    return {
      level: 'fail',
      detail: 'Configured endpoint or model was not found',
    };
  }
  if (status === 429) {
    return {
      level: 'fail',
      detail: 'Remote endpoint is reachable but currently rate limited',
    };
  }
  return {
    level: 'fail',
    detail: bodyText
      ? `Remote endpoint returned HTTP ${status}: ${bodyText.slice(0, 160)}`
      : `Remote endpoint returned HTTP ${status}`,
  };
}

async function probeHttp({ url, method = 'GET', headers = {}, body, timeoutMs }) {
  const startedAt = Date.now();
  try {
    const response = await fetch(url, {
      method,
      headers,
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const latencyMs = Date.now() - startedAt;
    const responseText = await response.text();
    return {
      ok: true,
      statusCode: response.status,
      latencyMs,
      responseText,
    };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - startedAt,
      error,
    };
  }
}

async function probeLocalCommand(runtimeId, runtime, probeKindLabel, options = {}) {
  const head = commandHead(runtime);
  const base = {
    runtime_id: runtimeId,
    type: runtime.type,
    target: formatTarget(runtime),
    probe_kind: probeKindLabel,
  };

  if (!head) {
    return {
      ...base,
      level: 'fail',
      detail: 'No command configured',
    };
  }

  const spawnProbe = probeRuntimeSpawnContext(options.root || process.cwd(), runtime, { runtimeId });
  const claudeAuthIssue = getClaudeSubprocessAuthIssue(runtime);

  if (!spawnProbe.ok) {
    return {
      ...base,
      level: 'fail',
      command: spawnProbe.command || head,
      detail: spawnProbe.detail,
    };
  }

  if (claudeAuthIssue) {
    return {
      ...base,
      level: 'fail',
      probe_kind: 'auth_preflight',
      command: spawnProbe.command || head,
      error_code: 'claude_auth_preflight_failed',
      detail: claudeAuthIssue.detail,
      fix: claudeAuthIssue.fix,
      auth_env_present: claudeAuthIssue.auth_env_present,
    };
  }

  if (spawnProbe.ok) {
    return {
      ...base,
      level: 'pass',
      command: spawnProbe.command || head,
      detail: spawnProbe.detail,
    };
  }
}

async function probeApiProxy(runtimeId, runtime, timeoutMs) {
  const base = {
    runtime_id: runtimeId,
    type: runtime.type,
    target: formatTarget(runtime),
    probe_kind: 'live_api_request',
    auth_env: runtime.auth_env || null,
  };

  if (runtime.auth_env && !process.env[runtime.auth_env]) {
    return {
      ...base,
      level: 'fail',
      detail: `${runtime.auth_env} is not set`,
    };
  }

  const endpoint = resolveProviderEndpoint(runtime);
  if (!endpoint) {
    return {
      ...base,
      level: 'fail',
      detail: `No probe endpoint is defined for provider "${runtime.provider || 'unknown'}"`,
    };
  }

  const provider = String(runtime.provider || '').trim().toLowerCase();
  const apiKey = runtime.auth_env ? process.env[runtime.auth_env] : '';
  const requestBody = JSON.stringify(buildProviderRequest(provider, 'ping', '', runtime.model, 1));
  const headers = buildProviderHeaders(provider, apiKey);
  const result = await probeHttp({
    url: endpoint,
    method: 'POST',
    headers,
    body: requestBody,
    timeoutMs,
  });

  if (!result.ok) {
    return {
      ...base,
      endpoint,
      level: 'fail',
      latency_ms: result.latencyMs,
      detail: `Probe failed: ${result.error?.name === 'TimeoutError' ? 'timed out' : (result.error?.message || 'network error')}`,
    };
  }

  if (result.statusCode >= 200 && result.statusCode < 300) {
    return {
      ...base,
      endpoint,
      status_code: result.statusCode,
      latency_ms: result.latencyMs,
      level: 'pass',
      detail: `${runtime.provider} accepted the live probe request`,
    };
  }

  const classified = classifyHttpFailure(result.statusCode, result.responseText, runtime.auth_env);
  return {
    ...base,
    endpoint,
    status_code: result.statusCode,
    latency_ms: result.latencyMs,
    ...classified,
  };
}

async function probeHttpRuntime(runtimeId, runtime, timeoutMs) {
  const endpoint = runtime.url;
  const base = {
    runtime_id: runtimeId,
    type: runtime.type,
    target: formatTarget(runtime),
    probe_kind: 'live_http_ping',
    endpoint,
  };

  const result = await probeHttp({
    url: endpoint,
    method: 'GET',
    headers: runtime.headers || {},
    timeoutMs,
  });

  if (!result.ok) {
    return {
      ...base,
      level: 'fail',
      latency_ms: result.latencyMs,
      detail: `Probe failed: ${result.error?.name === 'TimeoutError' ? 'timed out' : (result.error?.message || 'network error')}`,
    };
  }

  if ((result.statusCode >= 200 && result.statusCode < 300) || result.statusCode === 405) {
    return {
      ...base,
      level: 'pass',
      status_code: result.statusCode,
      latency_ms: result.latencyMs,
      detail: result.statusCode === 405
        ? 'Endpoint is reachable but rejects GET (expected for some RPC transports)'
        : 'Endpoint responded to the live probe',
    };
  }

  const classified = classifyHttpFailure(result.statusCode, result.responseText, null);
  return {
    ...base,
    status_code: result.statusCode,
    latency_ms: result.latencyMs,
    ...classified,
  };
}

/**
 * Analyze a local_cli runtime's command shape for authority-intent alignment.
 * Returns an array of warnings (may be empty).
 *
 * @param {string} runtimeId
 * @param {object} runtime - runtime config entry
 * @param {object} roles - map of roleId → role config (to determine write_authority)
 * @returns {{ warnings: Array<{probe_kind: string, level: string, detail: string, fix?: string}> }}
 */
function analyzeLocalCliAuthorityIntent(runtimeId, runtime, roles) {
  const warnings = [];
  if (runtime?.type !== 'local_cli') return { warnings };

  const commandTokens = normalizeCommandTokens(runtime);
  if (commandTokens.length === 0) return { warnings };

  const binaryName = commandTokens[0].toLowerCase();
  const allFlags = commandTokens.slice(1).join(' ');

  // Find roles that use this runtime
  const boundRoles = Object.entries(roles || {})
    .filter(([, role]) => role?.runtime === runtimeId)
    .map(([roleId, role]) => ({ roleId, write_authority: role.write_authority }));

  if (boundRoles.length === 0) return { warnings };

  const authoritativeRoles = boundRoles.filter((r) => r.write_authority === 'authoritative');
  const isCodex = binaryName === 'codex' || binaryName.endsWith('/codex');

  if (isCodex) {
    if (commandTokens[1] !== 'exec') {
      warnings.push({
        probe_kind: 'command_intent',
        level: 'warn',
        detail: 'OpenAI Codex CLI governed local runs should use the non-interactive "exec" subcommand. Top-level "codex" is the interactive entrypoint.',
        fix: 'Use ["codex", "exec", "--dangerously-bypass-approvals-and-sandbox", "{prompt}"]',
      });
    }

    if (commandTokens.includes('--quiet')) {
      warnings.push({
        probe_kind: 'command_intent',
        level: 'warn',
        detail: 'OpenAI Codex CLI rejects "--quiet" in governed local_cli commands on the current CLI. The command exits before the turn starts.',
        fix: 'Remove "--quiet" and use ["codex", "exec", "--dangerously-bypass-approvals-and-sandbox", "{prompt}"]',
      });
    }
  }

  // Check known CLI authority flags
  const knownCli = KNOWN_CLI_AUTHORITY_FLAGS.find((entry) => binaryName === entry.binary || binaryName.endsWith(`/${entry.binary}`));
  if (knownCli && authoritativeRoles.length > 0) {
    const hasAuthFlag = commandTokens.some((token) => token === knownCli.authoritative_flag);
    if (!hasAuthFlag) {
      const usesWeakFlag = knownCli.weak_flags.find((wf) => commandTokens.some((token) => token === wf));
      const roleNames = authoritativeRoles.map((r) => r.roleId).join(', ');
      if (usesWeakFlag) {
        warnings.push({
          probe_kind: 'authority_intent',
          level: 'warn',
          detail: `${knownCli.label} uses "${usesWeakFlag}" which does NOT grant full unattended authority — role(s) [${roleNames}] require authoritative writes`,
          fix: `Replace "${usesWeakFlag}" with "${knownCli.authoritative_flag}" in the command array`,
        });
      } else {
        warnings.push({
          probe_kind: 'authority_intent',
          level: 'warn',
          detail: `${knownCli.label} command is missing "${knownCli.authoritative_flag}" — role(s) [${roleNames}] require authoritative writes but the subprocess may block on approval prompts`,
          fix: `Add "${knownCli.authoritative_flag}" to the command array`,
        });
      }
    }
  }

  // Prompt transport validation
  const transport = runtime.prompt_transport || 'dispatch_bundle_only';
  const knownTransports = KNOWN_CLI_TRANSPORTS[binaryName];
  const claudeAuthIssue = getClaudeSubprocessAuthIssue(runtime);

  if (transport === 'argv' && !commandTokens.some((token) => token.includes('{prompt}'))) {
    warnings.push({
      probe_kind: 'transport_intent',
      level: 'warn',
      detail: `prompt_transport is "argv" but no {prompt} placeholder found in command — the prompt will not be delivered`,
      fix: `Add a "{prompt}" placeholder to the command array, e.g. ["${binaryName}", ..., "{prompt}"]`,
    });
  }

  if (knownTransports && !knownTransports.includes(transport) && transport !== 'dispatch_bundle_only') {
    const transportLabel = knownCli ? knownCli.label : binaryName;
    warnings.push({
      probe_kind: 'transport_intent',
      level: 'warn',
      detail: `${transportLabel} typically uses ${knownTransports.map((value) => `"${value}"`).join(' or ')} transport, but this runtime is configured with "${transport}"`,
      fix: `Set prompt_transport to ${knownTransports.map((value) => `"${value}"`).join(' or ')} or "dispatch_bundle_only"`,
    });
  }

  if (claudeAuthIssue) {
    warnings.push({
      probe_kind: 'auth_preflight',
      level: 'warn',
      detail: claudeAuthIssue.detail,
      fix: claudeAuthIssue.fix,
    });
  }

  return { warnings };
}

/**
 * Normalize a runtime's command field into an array of tokens.
 */
export async function probeConnectorRuntime(runtimeId, runtime, options = {}) {
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : DEFAULT_TIMEOUT_MS;
  const roles = options.roles || null;

  if (!runtime || !PROBEABLE_RUNTIME_TYPES.has(runtime.type)) {
    return {
      runtime_id: runtimeId,
      type: runtime?.type || 'unknown',
      target: formatTarget(runtime),
      probe_kind: 'unsupported',
      level: 'fail',
      detail: `Runtime type "${runtime?.type || 'unknown'}" cannot be probed`,
    };
  }

  if (runtime.type === 'local_cli') {
    const result = await probeLocalCommand(runtimeId, runtime, 'command_presence', options);
    // Add authority-intent and transport analysis when roles are available
    if (roles) {
      const { warnings } = analyzeLocalCliAuthorityIntent(runtimeId, runtime, roles);
      const visibleWarnings = result.error_code === 'claude_auth_preflight_failed'
        ? warnings.filter((warning) => warning.probe_kind !== 'auth_preflight')
        : warnings;
      if (visibleWarnings.length > 0) {
        result.authority_warnings = visibleWarnings;
        // Promote result level to 'warn' if binary is present but authority intent is wrong
        if (result.level === 'pass') {
          result.level = 'warn';
        }
      }
    }
    return result;
  }

  if (runtime.type === 'api_proxy') {
    return probeApiProxy(runtimeId, runtime, timeoutMs);
  }

  if (runtime.type === 'mcp') {
    if (runtime.transport === 'streamable_http') {
      return probeHttpRuntime(runtimeId, runtime, timeoutMs);
    }
    return probeLocalCommand(runtimeId, runtime, 'command_presence', options);
  }

  return probeHttpRuntime(runtimeId, runtime, timeoutMs);
}

export async function probeConfiguredConnectors(config, options = {}) {
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : DEFAULT_TIMEOUT_MS;
  const requestedRuntimeId = options.runtimeId || null;
  const onProbeStart = typeof options.onProbeStart === 'function' ? options.onProbeStart : null;
  const roles = config?.roles || null;

  const runtimeEntries = Object.entries(config?.runtimes || {})
    .filter(([, runtime]) => PROBEABLE_RUNTIME_TYPES.has(runtime?.type))
    .sort(([left], [right]) => left.localeCompare(right, 'en'));

  if (requestedRuntimeId) {
    const match = runtimeEntries.find(([runtimeId]) => runtimeId === requestedRuntimeId);
    if (!match) {
      return {
        ok: false,
        error: `Unknown connector runtime "${requestedRuntimeId}"`,
        exitCode: 2,
      };
    }
    const [runtimeId, runtime] = match;
    onProbeStart?.(runtimeId, runtime);
    const connector = await probeConnectorRuntime(runtimeId, runtime, { timeoutMs, roles });
    return summarizeResults([connector], timeoutMs);
  }

  const connectors = [];
  for (const [runtimeId, runtime] of runtimeEntries) {
    onProbeStart?.(runtimeId, runtime);
    connectors.push(await probeConnectorRuntime(runtimeId, runtime, { timeoutMs, roles }));
  }
  return summarizeResults(connectors, timeoutMs);
}

function summarizeResults(connectors, timeoutMs) {
  const failCount = connectors.filter((item) => item.level === 'fail').length;
  const warnCount = connectors.filter((item) => item.level === 'warn').length;
  const passCount = connectors.filter((item) => item.level === 'pass').length;
  const overall = failCount > 0 ? 'fail' : warnCount > 0 ? 'warn' : 'pass';
  return {
    ok: failCount === 0,
    exitCode: failCount === 0 ? 0 : 1,
    overall,
    timeout_ms: timeoutMs,
    pass_count: passCount,
    warn_count: warnCount,
    fail_count: failCount,
    connectors,
  };
}

export { DEFAULT_TIMEOUT_MS, PROBEABLE_RUNTIME_TYPES, KNOWN_CLI_AUTHORITY_FLAGS, KNOWN_CLI_TRANSPORTS, analyzeLocalCliAuthorityIntent, normalizeCommandTokens };
