import { execFileSync } from 'node:child_process';

import {
  buildProviderHeaders,
  buildProviderRequest,
  PROVIDER_ENDPOINTS,
} from './adapters/api-proxy-adapter.js';

const PROBEABLE_RUNTIME_TYPES = new Set(['local_cli', 'api_proxy', 'mcp', 'remote_agent']);
const DEFAULT_TIMEOUT_MS = 8_000;

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
    return runtime.command[0] || null;
  }
  if (typeof runtime?.command === 'string' && runtime.command.trim()) {
    return runtime.command.trim().split(/\s+/)[0];
  }
  return null;
}

function resolveBinary(command) {
  const resolver = process.platform === 'win32' ? 'where' : 'which';
  execFileSync(resolver, [command], { stdio: 'ignore' });
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

async function probeLocalCommand(runtimeId, runtime, probeKindLabel) {
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

  try {
    resolveBinary(head);
    return {
      ...base,
      level: 'pass',
      command: head,
      detail: `${head} is available on PATH`,
    };
  } catch {
    return {
      ...base,
      level: 'fail',
      command: head,
      detail: `${head} was not found on PATH`,
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

export async function probeConnectorRuntime(runtimeId, runtime, options = {}) {
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : DEFAULT_TIMEOUT_MS;

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
    return probeLocalCommand(runtimeId, runtime, 'command_presence');
  }

  if (runtime.type === 'api_proxy') {
    return probeApiProxy(runtimeId, runtime, timeoutMs);
  }

  if (runtime.type === 'mcp') {
    if (runtime.transport === 'streamable_http') {
      return probeHttpRuntime(runtimeId, runtime, timeoutMs);
    }
    return probeLocalCommand(runtimeId, runtime, 'command_presence');
  }

  return probeHttpRuntime(runtimeId, runtime, timeoutMs);
}

export async function probeConfiguredConnectors(config, options = {}) {
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : DEFAULT_TIMEOUT_MS;
  const requestedRuntimeId = options.runtimeId || null;
  const onProbeStart = typeof options.onProbeStart === 'function' ? options.onProbeStart : null;

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
    const connector = await probeConnectorRuntime(runtimeId, runtime, { timeoutMs });
    return summarizeResults([connector], timeoutMs);
  }

  const connectors = [];
  for (const [runtimeId, runtime] of runtimeEntries) {
    onProbeStart?.(runtimeId, runtime);
    connectors.push(await probeConnectorRuntime(runtimeId, runtime, { timeoutMs }));
  }
  return summarizeResults(connectors, timeoutMs);
}

function summarizeResults(connectors, timeoutMs) {
  const failCount = connectors.filter((item) => item.level === 'fail').length;
  const passCount = connectors.filter((item) => item.level === 'pass').length;
  return {
    ok: failCount === 0,
    exitCode: failCount === 0 ? 0 : 1,
    overall: failCount === 0 ? 'pass' : 'fail',
    timeout_ms: timeoutMs,
    pass_count: passCount,
    fail_count: failCount,
    connectors,
  };
}

export { DEFAULT_TIMEOUT_MS, PROBEABLE_RUNTIME_TYPES };
