/**
 * API proxy adapter — review-only synchronous provider calls.
 *
 * v1 scope (Session #19 freeze):
 *   - review_only roles only
 *   - single request / single response (synchronous within `step`)
 *   - no tool use, no patch application, no repo writes
 *   - turn result must arrive as structured JSON
 *   - provider telemetry is authoritative for cost
 *
 * The adapter:
 *   1. Reads the rendered dispatch bundle (PROMPT.md + CONTEXT.md)
 *   2. Sends a single API request to the configured provider
 *   3. Persists raw request/response metadata for auditability
 *   4. Extracts structured turn result JSON from the response
 *   5. Stages it at .agentxchain/staging/turn-result.json
 *
 * Error classification (Turn 13 — API_PROXY_ERROR_RECOVERY_SPEC):
 *   All error returns include a `classified` ApiProxyError object with
 *   error_class, recovery instructions, and retryable flag.
 *
 * Supported providers: "anthropic", "openai"
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { evaluateTokenBudget, SYSTEM_PROMPT, SEPARATOR } from '../token-budget.js';
import {
  getDispatchApiRequestPath,
  getDispatchContextPath,
  getDispatchEffectiveContextPath,
  getDispatchPromptPath,
  getDispatchTokenBudgetPath,
  getDispatchTurnDir,
  getTurnApiErrorPath,
  getTurnProviderResponsePath,
  getTurnRetryTracePath,
  getTurnStagingDir,
  getTurnStagingResultPath,
} from '../turn-paths.js';
import { verifyDispatchManifestForAdapter } from '../dispatch-manifest.js';

// Provider endpoint registry
const PROVIDER_ENDPOINTS = {
  anthropic: 'https://api.anthropic.com/v1/messages',
  openai: 'https://api.openai.com/v1/chat/completions',
};

// Cost rates per million tokens (USD)
const COST_RATES = {
  'claude-sonnet-4-6': { input_per_1m: 3.00, output_per_1m: 15.00 },
  'claude-opus-4-6': { input_per_1m: 15.00, output_per_1m: 75.00 },
  'claude-haiku-4-5-20251001': { input_per_1m: 0.80, output_per_1m: 4.00 },
};

const RETRYABLE_ERROR_CLASSES = [
  'rate_limited',
  'network_failure',
  'timeout',
  'response_parse_failure',
  'turn_result_extraction_failure',
  'unknown_api_error',
  'provider_overloaded',
];

const DEFAULT_RETRY_POLICY = {
  max_attempts: 3,
  base_delay_ms: 1000,
  max_delay_ms: 8000,
  backoff_multiplier: 2,
  jitter: 'full',
  retry_on: RETRYABLE_ERROR_CLASSES,
};

const PROVIDER_ERROR_MAPS = {
  anthropic: {
    extractErrorType(body) {
      return typeof body?.error?.type === 'string' ? body.error.type : null;
    },
    extractErrorCode(body) {
      return typeof body?.error?.code === 'string' ? body.error.code : null;
    },
    mappings: [
      { provider_error_type: 'authentication_error', http_status: 401, error_class: 'auth_failure', retryable: false },
      { provider_error_type: 'permission_error', http_status: 403, error_class: 'auth_failure', retryable: false },
      { provider_error_type: 'not_found_error', http_status: 404, error_class: 'model_not_found', retryable: false },
      { provider_error_type: 'overloaded_error', http_status: 529, error_class: 'provider_overloaded', retryable: true },
      { provider_error_type: 'rate_limit_error', http_status: 429, body_pattern: /daily|spend|budget/i, error_class: 'rate_limited', retryable: false },
      { provider_error_type: 'rate_limit_error', http_status: 429, error_class: 'rate_limited', retryable: true },
      { provider_error_type: 'invalid_request_error', http_status: 400, body_pattern: /context|token.*limit|too.many.tokens/i, error_class: 'context_overflow', retryable: false },
      { provider_error_type: 'invalid_request_error', http_status: 400, error_class: 'invalid_request', retryable: false },
      { provider_error_type: 'api_error', http_status: 500, error_class: 'unknown_api_error', retryable: true },
    ],
  },
  openai: {
    extractErrorType(body) {
      return typeof body?.error?.type === 'string' ? body.error.type : null;
    },
    extractErrorCode(body) {
      return typeof body?.error?.code === 'string' ? body.error.code : null;
    },
    mappings: [
      { provider_error_code: 'invalid_api_key', http_status: 401, error_class: 'auth_failure', retryable: false },
      { provider_error_code: 'model_not_found', http_status: 404, error_class: 'model_not_found', retryable: false },
      { provider_error_type: 'invalid_request_error', http_status: 400, body_pattern: /context|token.*limit|too.many.tokens/i, error_class: 'context_overflow', retryable: false },
      { provider_error_type: 'invalid_request_error', http_status: 400, error_class: 'invalid_request', retryable: false },
      { provider_error_type: 'rate_limit_error', http_status: 429, error_class: 'rate_limited', retryable: true },
    ],
  },
};

// ── Error classification ──────────────────────────────────────────────────────

/**
 * Build a classified ApiProxyError object.
 */
function classifyError(
  errorClass,
  message,
  recovery,
  retryable,
  httpStatus,
  rawDetail,
  providerErrorType = null,
  providerErrorCode = null
) {
  return {
    error_class: errorClass,
    message,
    recovery,
    retryable,
    http_status: httpStatus ?? null,
    raw_detail: rawDetail ? String(rawDetail).slice(0, 500) : null,
    provider_error_type: providerErrorType,
    provider_error_code: providerErrorCode,
  };
}

function tryParseJson(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function httpStatusMatches(ruleStatus, actualStatus) {
  if (Array.isArray(ruleStatus)) {
    return ruleStatus.includes(actualStatus);
  }
  if (typeof ruleStatus === 'number') {
    return ruleStatus === actualStatus;
  }
  return true;
}

function buildMappedProviderError(mapping, context) {
  const {
    provider,
    model,
    authEnv,
    status,
    rawDetail,
    providerErrorType,
    providerErrorCode,
  } = context;

  switch (mapping.error_class) {
    case 'auth_failure':
      return classifyError(
        'auth_failure',
        `API authentication failed (${status})`,
        `Check that "${authEnv}" contains a valid API key for ${provider}`,
        mapping.retryable ?? false,
        status,
        rawDetail,
        providerErrorType,
        providerErrorCode
      );
    case 'model_not_found':
      return classifyError(
        'model_not_found',
        `Model "${model}" not found (${status})`,
        `Model "${model}" not found. Check runtime config model name.`,
        mapping.retryable ?? false,
        status,
        rawDetail,
        providerErrorType,
        providerErrorCode
      );
    case 'provider_overloaded':
      return classifyError(
        'provider_overloaded',
        `${provider} is temporarily overloaded`,
        `${provider} is overloaded. Retry with backoff: agentxchain step --resume`,
        mapping.retryable ?? true,
        status,
        rawDetail,
        providerErrorType,
        providerErrorCode
      );
    case 'rate_limited':
      if (mapping.retryable === false) {
        return classifyError(
          'rate_limited',
          `Provider spend limit reached at ${provider}`,
          `${provider} rejected the request due to a spend or budget limit. Increase provider budget or wait for reset before retrying.`,
          false,
          status,
          rawDetail,
          providerErrorType,
          providerErrorCode
        );
      }
      return classifyError(
        'rate_limited',
        `Rate limited by ${provider}`,
        `Rate limited by ${provider}. Wait and retry: agentxchain step --resume`,
        true,
        status,
        rawDetail,
        providerErrorType,
        providerErrorCode
      );
    case 'context_overflow':
      return classifyError(
        'context_overflow',
        'Prompt exceeds model context window',
        'Prompt exceeds model context window. Reduce context or switch to a larger model.',
        false,
        status,
        rawDetail,
        providerErrorType,
        providerErrorCode
      );
    case 'invalid_request':
      return classifyError(
        'invalid_request',
        `API request rejected by ${provider}`,
        'Provider rejected the request as invalid. Fix the prompt, parameters, or adapter request shape before retrying.',
        false,
        status,
        rawDetail,
        providerErrorType,
        providerErrorCode
      );
    default:
      return classifyError(
        mapping.error_class,
        `API returned ${status}`,
        `API returned ${status}. Review error detail and retry or complete manually.`,
        mapping.retryable ?? true,
        status,
        rawDetail,
        providerErrorType,
        providerErrorCode
      );
  }
}

function classifyProviderHttpError(status, body, provider, model, authEnv) {
  const providerMap = PROVIDER_ERROR_MAPS[provider];
  if (!providerMap) {
    return null;
  }

  const parsedBody = tryParseJson(body);
  if (!parsedBody) {
    return null;
  }

  const providerErrorType = providerMap.extractErrorType(parsedBody);
  const providerErrorCode = providerMap.extractErrorCode(parsedBody);
  if (!providerErrorType) {
    return { matched: null, providerErrorType: null, providerErrorCode };
  }

  for (const mapping of providerMap.mappings) {
    if (mapping.provider_error_type && mapping.provider_error_type !== providerErrorType) continue;
    if (mapping.provider_error_code && mapping.provider_error_code !== providerErrorCode) continue;
    if (!httpStatusMatches(mapping.http_status, status)) continue;
    if (mapping.body_pattern && !mapping.body_pattern.test(body)) continue;
    return {
      matched: buildMappedProviderError(mapping, {
        provider,
        model,
        authEnv,
        status,
        rawDetail: body,
        providerErrorType,
        providerErrorCode,
      }),
      providerErrorType,
      providerErrorCode,
    };
  }

  return { matched: null, providerErrorType, providerErrorCode };
}

/**
 * Classify an HTTP error response into a typed ApiProxyError.
 */
function classifyHttpError(status, body, provider, model, authEnv) {
  const providerClassification = classifyProviderHttpError(status, body, provider, model, authEnv);
  if (providerClassification?.matched) {
    return providerClassification.matched;
  }
  const providerErrorType = providerClassification?.providerErrorType ?? null;
  const providerErrorCode = providerClassification?.providerErrorCode ?? null;

  if (status === 401 || status === 403) {
    return classifyError(
      'auth_failure',
      `API authentication failed (${status})`,
      `Check that "${authEnv}" contains a valid API key for ${provider}`,
      false, status, body, providerErrorType, providerErrorCode
    );
  }

  if (status === 429) {
    return classifyError(
      'rate_limited',
      `Rate limited by ${provider}`,
      `Rate limited by ${provider}. Wait and retry: agentxchain step --resume`,
      true, status, body, providerErrorType, providerErrorCode
    );
  }

  if (status === 404) {
    return classifyError(
      'model_not_found',
      `Model "${model}" not found (404)`,
      `Model "${model}" not found. Check runtime config model name.`,
      false, status, body, providerErrorType, providerErrorCode
    );
  }

  if (status === 400) {
    const lowerBody = (body || '').toLowerCase();
    if (lowerBody.includes('context') || lowerBody.includes('token')) {
      return classifyError(
        'context_overflow',
        'Prompt exceeds model context window',
        'Prompt exceeds model context window. Reduce context or switch to a larger model.',
        false, status, body, providerErrorType, providerErrorCode
      );
    }
  }

  return classifyError(
    'unknown_api_error',
    `API returned ${status}`,
    `API returned ${status}. Review error detail and retry or complete manually.`,
    true, status, body, providerErrorType, providerErrorCode
  );
}

/**
 * Persist classified error to staging for auditability (best-effort).
 */
function persistApiError(root, turnId, classified) {
  try {
    const stagingDir = join(root, getTurnStagingDir(turnId));
    mkdirSync(stagingDir, { recursive: true });
    writeFileSync(
      join(root, getTurnApiErrorPath(turnId)),
      JSON.stringify(classified, null, 2) + '\n'
    );
  } catch {
    // best-effort audit artifact
  }
}

function clearApiError(root, turnId) {
  try {
    rmSync(join(root, getTurnApiErrorPath(turnId)), { force: true });
  } catch {
    // best-effort cleanup
  }
}

/**
 * Persist retry trace artifact for auditability (best-effort).
 */
function persistRetryTrace(root, turnId, trace) {
  try {
    const stagingDir = join(root, getTurnStagingDir(turnId));
    mkdirSync(stagingDir, { recursive: true });
    const tracePath = join(root, getTurnRetryTracePath(turnId));
    writeFileSync(tracePath, JSON.stringify(trace, null, 2) + '\n');
    return tracePath;
  } catch {
    // best-effort audit artifact
    return null;
  }
}

function emptyUsageTotals() {
  return {
    input_tokens: 0,
    output_tokens: 0,
    usd: 0,
  };
}

function usageFromTelemetry(provider, model, usage) {
  if (!usage || typeof usage !== 'object') return null;

  let inputTokens = 0;
  let outputTokens = 0;

  if (provider === 'openai') {
    inputTokens = Number.isFinite(usage.prompt_tokens) ? usage.prompt_tokens : 0;
    outputTokens = Number.isFinite(usage.completion_tokens) ? usage.completion_tokens : 0;
  } else {
    inputTokens = Number.isFinite(usage.input_tokens) ? usage.input_tokens : 0;
    outputTokens = Number.isFinite(usage.output_tokens) ? usage.output_tokens : 0;
  }

  const rates = COST_RATES[model];
  const usd = rates
    ? (inputTokens / 1_000_000) * rates.input_per_1m + (outputTokens / 1_000_000) * rates.output_per_1m
    : 0;

  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    usd: Math.round(usd * 1000) / 1000,
  };
}

function addUsageTotals(total, usage) {
  if (!usage) return total;
  return {
    input_tokens: total.input_tokens + (usage.input_tokens || 0),
    output_tokens: total.output_tokens + (usage.output_tokens || 0),
    usd: Math.round((total.usd + (usage.usd || 0)) * 1000) / 1000,
  };
}

function writeRetryTrace(root, turnId, provider, model, state, runtimeId, retryPolicy, attemptsMade, finalOutcome, aggregateUsage, attempts) {
  const trace = {
    provider,
    model,
    run_id: state.run_id,
    turn_id: turnId,
    runtime_id: runtimeId,
    max_attempts: retryPolicy?.max_attempts ?? 1,
    attempts_made: attemptsMade,
    final_outcome: finalOutcome,
    aggregate_usage: { ...aggregateUsage },
    attempts,
  };
  return persistRetryTrace(root, turnId, trace);
}

function persistPreflightArtifacts(root, turnId, effectiveContext, report) {
  try {
    const dispatchDir = join(root, getDispatchTurnDir(turnId));
    mkdirSync(dispatchDir, { recursive: true });
    writeFileSync(join(root, getDispatchEffectiveContextPath(turnId)), effectiveContext);
    writeFileSync(join(root, getDispatchTokenBudgetPath(turnId)), JSON.stringify(report, null, 2) + '\n');
  } catch {
    // best-effort audit artifacts
  }
}

function resolveRetryPolicy(runtime) {
  const retryPolicy = runtime?.retry_policy;
  if (!retryPolicy || retryPolicy.enabled !== true) {
    return null;
  }

  return {
    enabled: true,
    max_attempts: retryPolicy.max_attempts ?? DEFAULT_RETRY_POLICY.max_attempts,
    base_delay_ms: retryPolicy.base_delay_ms ?? DEFAULT_RETRY_POLICY.base_delay_ms,
    max_delay_ms: retryPolicy.max_delay_ms ?? DEFAULT_RETRY_POLICY.max_delay_ms,
    backoff_multiplier: retryPolicy.backoff_multiplier ?? DEFAULT_RETRY_POLICY.backoff_multiplier,
    jitter: retryPolicy.jitter ?? DEFAULT_RETRY_POLICY.jitter,
    retry_on: Array.isArray(retryPolicy.retry_on)
      ? retryPolicy.retry_on
      : DEFAULT_RETRY_POLICY.retry_on,
  };
}

function resolvePreflightTokenization(runtime) {
  const preflight = runtime?.preflight_tokenization;
  if (!preflight || preflight.enabled !== true) {
    return null;
  }

  return {
    enabled: true,
    tokenizer: preflight.tokenizer ?? 'provider_local',
    safety_margin_tokens: preflight.safety_margin_tokens ?? 2048,
    context_window_tokens: runtime.context_window_tokens,
  };
}

function shouldRetryAttempt(classified, retryPolicy, attemptNumber) {
  if (!retryPolicy || !classified?.retryable) return false;
  if (attemptNumber >= retryPolicy.max_attempts) return false;
  if (!Array.isArray(retryPolicy.retry_on)) return true;
  return retryPolicy.retry_on.includes(classified.error_class);
}

function calculateRetryDelayMs(retryPolicy, nextAttemptNumber) {
  const rawDelayMs = Math.min(
    retryPolicy.max_delay_ms,
    retryPolicy.base_delay_ms * retryPolicy.backoff_multiplier ** (nextAttemptNumber - 2)
  );

  if (retryPolicy.jitter === 'none') {
    return rawDelayMs;
  }

  return Math.floor(Math.random() * (rawDelayMs + 1));
}

function waitForRetryDelay(delayMs, signal) {
  if (delayMs <= 0) {
    if (signal?.aborted) {
      return Promise.reject(new Error('aborted'));
    }
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('aborted'));
      return;
    }

    const timeoutId = setTimeout(() => {
      cleanup();
      resolve();
    }, delayMs);

    const onAbort = () => {
      clearTimeout(timeoutId);
      cleanup();
      reject(new Error('aborted'));
    };

    const cleanup = () => {
      if (signal) {
        signal.removeEventListener('abort', onAbort);
      }
    };

    if (signal) {
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

async function executeApiCall({
  endpoint,
  apiKey,
  provider,
  model,
  authEnv,
  requestBody,
  timeoutSeconds,
  signal,
}) {
  const timeoutMs = timeoutSeconds * 1000;
  const controller = new AbortController();
  let externalAbort = false;
  let timeoutTriggered = false;

  const onExternalAbort = () => {
    externalAbort = true;
    controller.abort();
  };

  if (signal) {
    if (signal.aborted) {
      return { ok: false, aborted: true, error: 'Dispatch aborted by operator' };
    }
    signal.addEventListener('abort', onExternalAbort, { once: true });
  }

  const timeoutId = setTimeout(() => {
    timeoutTriggered = true;
    controller.abort();
  }, timeoutMs);

  let response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: buildProviderHeaders(provider, apiKey),
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeoutId);
    if (signal) {
      signal.removeEventListener('abort', onExternalAbort);
    }

    if (err.name === 'AbortError') {
      if (externalAbort && !timeoutTriggered) {
        return { ok: false, aborted: true, error: 'Dispatch aborted by operator' };
      }
      return {
        ok: false,
        classified: classifyError(
          'timeout',
          `Request timed out after ${timeoutSeconds}s`,
          `Request timed out after ${timeoutSeconds}s. Increase timeout_seconds in runtime config or retry: agentxchain step --resume`,
          true, null, null
        ),
        usage: null,
      };
    }

    return {
      ok: false,
      classified: classifyError(
        'network_failure',
        `Network error: ${err.message}`,
        `Network error: ${err.message}. Check connectivity and retry: agentxchain step --resume`,
        true, null, err.message
      ),
      usage: null,
    };
  }

  clearTimeout(timeoutId);
  if (signal) {
    signal.removeEventListener('abort', onExternalAbort);
  }

  if (!response.ok) {
    let errorBody = '';
    try { errorBody = await response.text(); } catch {}
    return {
      ok: false,
      classified: classifyHttpError(response.status, errorBody, provider, model, authEnv),
      usage: null,
    };
  }

  let responseData;
  try {
    responseData = await response.json();
  } catch (err) {
    return {
      ok: false,
      classified: classifyError(
        'response_parse_failure',
        'Provider returned non-JSON response',
        'Provider returned non-JSON response. This is usually transient. Retry: agentxchain step --resume',
        true, response.status, err.message
      ),
      usage: null,
    };
  }

  const usage = usageFromTelemetry(provider, model, responseData.usage);
  const extraction = extractTurnResult(responseData, provider);

  if (!extraction.ok) {
    return {
      ok: false,
      classified: classifyError(
        'turn_result_extraction_failure',
        extraction.error,
        'Model responded but did not produce valid turn result JSON. Retry or complete manually.',
        true, null, null
      ),
      usage,
      responseData,
    };
  }

  return {
    ok: true,
    responseData,
    turnResult: extraction.turnResult,
    usage,
  };
}

/**
 * Build an error return with classification and audit persistence.
 */
function errorReturn(root, turnId, classified, extras = {}) {
  persistApiError(root, turnId, classified);
  return { ok: false, error: classified.message, classified, ...extras };
}

// ── Main dispatch ─────────────────────────────────────────────────────────────

/**
 * Dispatch a review-only turn via API proxy.
 *
 * @param {string} root - project root directory
 * @param {object} state - current governed state
 * @param {object} config - normalized config
 * @param {object} options - { signal?: AbortSignal, onStatus?: (msg: string) => void, verifyManifest?: boolean, skipManifestVerification?: boolean }
 * @returns {Promise<{ ok: boolean, error?: string, classified?: ApiProxyError, usage?: object, staged?: boolean }>}
 */
export async function dispatchApiProxy(root, state, config, options = {}) {
  const { signal, onStatus, turnId } = options;

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

  const roleId = turn.assigned_role;
  const role = config.roles?.[roleId];
  const runtimeId = turn.runtime_id;
  const runtime = config.runtimes?.[runtimeId];

  if (!runtime || runtime.type !== 'api_proxy') {
    return { ok: false, error: `Runtime "${runtimeId}" is not an api_proxy runtime` };
  }

  // Enforce v1 restriction: review_only only
  if (role?.write_authority !== 'review_only') {
    return { ok: false, error: `v1 api_proxy only supports review_only roles (got "${role?.write_authority}")` };
  }

  // Read dispatch bundle
  const promptPath = join(root, getDispatchPromptPath(turn.turn_id));
  const contextPath = join(root, getDispatchContextPath(turn.turn_id));

  if (!existsSync(promptPath)) {
    return { ok: false, error: 'Dispatch bundle not found — PROMPT.md missing' };
  }

  const promptMd = readFileSync(promptPath, 'utf8');
  const contextMd = existsSync(contextPath) ? readFileSync(contextPath, 'utf8') : '';

  // Resolve provider and credentials
  const provider = runtime.provider;
  const model = runtime.model;
  const authEnv = runtime.auth_env;
  const apiKey = process.env[authEnv];

  if (!apiKey) {
    const classified = classifyError(
      'missing_credentials',
      `Environment variable "${authEnv}" is not set — required for api_proxy`,
      `Set environment variable "${authEnv}" and retry: agentxchain step --resume`,
      false, null, null
    );
    return errorReturn(root, turn.turn_id, classified);
  }

  const endpoint = PROVIDER_ENDPOINTS[provider];
  if (!endpoint) {
    const classified = classifyError(
      'unsupported_provider',
      `Unsupported provider: "${provider}". Supported: ${Object.keys(PROVIDER_ENDPOINTS).join(', ')}`,
      `Provider "${provider}" is not supported. Supported: ${Object.keys(PROVIDER_ENDPOINTS).join(', ')}`,
      false, null, null
    );
    return errorReturn(root, turn.turn_id, classified);
  }

  // Build request
  const maxOutputTokens = runtime.max_output_tokens || 4096;
  const timeoutSeconds = runtime.timeout_seconds || 120;
  const retryPolicy = resolveRetryPolicy(runtime);
  const preflightTokenization = resolvePreflightTokenization(runtime);
  let effectiveContextMd = contextMd;

  if (preflightTokenization) {
    const budgetEvaluation = evaluateTokenBudget({
      promptMd,
      contextMd,
      provider,
      model,
      runtimeId,
      runId: state.run_id,
      turnId: turn.turn_id,
      contextWindowTokens: preflightTokenization.context_window_tokens,
      maxOutputTokens,
      safetyMarginTokens: preflightTokenization.safety_margin_tokens,
    });

    effectiveContextMd = budgetEvaluation.effective_context;
    persistPreflightArtifacts(root, turn.turn_id, effectiveContextMd, budgetEvaluation.report);

    if (!budgetEvaluation.sent_to_provider) {
      const classified = classifyError(
        'context_overflow',
        'Prompt exceeds model context window (detected locally before API call)',
        'Prompt exceeds model context window. Reduce context or switch to a larger model.',
        false, null,
        'Local preflight token-budget estimate exceeded available input tokens.'
      );
      return errorReturn(root, turn.turn_id, classified, {
        preflight_artifacts: {
          token_budget: join(root, getDispatchTokenBudgetPath(turn.turn_id)),
          effective_context: join(root, getDispatchEffectiveContextPath(turn.turn_id)),
        },
      });
    }
  }

  const requestBody = buildProviderRequest(provider, promptMd, effectiveContextMd, model, maxOutputTokens);

  // Persist request metadata for auditability
  const dispatchDir = join(root, getDispatchTurnDir(turn.turn_id));
  try {
    writeFileSync(
      join(root, getDispatchApiRequestPath(turn.turn_id)),
      JSON.stringify({
        provider,
        model,
        endpoint,
        max_output_tokens: maxOutputTokens,
        retry_policy: retryPolicy,
        preflight_tokenization: preflightTokenization
          ? {
              enabled: true,
              tokenizer: preflightTokenization.tokenizer,
              context_window_tokens: preflightTokenization.context_window_tokens,
              safety_margin_tokens: preflightTokenization.safety_margin_tokens,
            }
          : null,
        timestamp: new Date().toISOString(),
        // Do not persist the API key
      }, null, 2) + '\n'
    );
  } catch {
    // best-effort audit artifact
  }

  onStatus?.(`Sending request to ${provider} (${model})...`);
  const aggregateUsage = emptyUsageTotals();
  let hasUsageTelemetry = false;
  let attemptsMade = 0;
  let execution;
  const traceAttempts = [];
  let pendingScheduledDelayMs = 0;
  let pendingActualDelayMs = 0;

  while (true) {
    attemptsMade += 1;
    const attemptStartedAt = new Date().toISOString();
    const scheduledDelayMs = pendingScheduledDelayMs;
    const actualDelayMs = pendingActualDelayMs;
    pendingScheduledDelayMs = 0;
    pendingActualDelayMs = 0;

    execution = await executeApiCall({
      endpoint,
      apiKey,
      provider,
      model,
      authEnv,
      requestBody,
      timeoutSeconds,
      signal,
    });

    const attemptCompletedAt = new Date().toISOString();

    if (execution.usage) {
      hasUsageTelemetry = true;
      const totals = addUsageTotals(aggregateUsage, execution.usage);
      aggregateUsage.input_tokens = totals.input_tokens;
      aggregateUsage.output_tokens = totals.output_tokens;
      aggregateUsage.usd = totals.usd;
    }

    if (execution.ok) {
      traceAttempts.push({
        attempt: attemptsMade,
        started_at: attemptStartedAt,
        completed_at: attemptCompletedAt,
        outcome: 'success',
        retryable: false,
        http_status: null,
        scheduled_delay_ms: scheduledDelayMs,
        actual_delay_ms: actualDelayMs,
        usage: execution.usage || null,
      });
      break;
    }

    if (execution.aborted) {
      traceAttempts.push({
        attempt: attemptsMade,
        started_at: attemptStartedAt,
        completed_at: attemptCompletedAt,
        outcome: 'aborted',
        retryable: false,
        http_status: null,
        scheduled_delay_ms: scheduledDelayMs,
        actual_delay_ms: actualDelayMs,
        usage: execution.usage || null,
      });
      const tracePath = writeRetryTrace(root, turn.turn_id, provider, model, state, runtimeId, retryPolicy, attemptsMade, 'aborted', aggregateUsage, traceAttempts);
      return { ok: false, error: execution.error, attempts_made: attemptsMade, retry_trace_path: tracePath };
    }

    const classified = execution.classified;
      traceAttempts.push({
        attempt: attemptsMade,
        started_at: attemptStartedAt,
        completed_at: attemptCompletedAt,
        outcome: classified?.error_class || 'non_retryable_error',
        retryable: classified?.retryable || false,
        http_status: classified?.http_status ?? null,
        provider_error_type: classified?.provider_error_type ?? null,
        scheduled_delay_ms: scheduledDelayMs,
        actual_delay_ms: actualDelayMs,
        usage: execution.usage || null,
      });

    if (!shouldRetryAttempt(classified, retryPolicy, attemptsMade)) {
      // Persist raw provider response on failure for debugging (e.g. extraction failure)
      if (execution.responseData) {
        const stagingDir = join(root, getTurnStagingDir(turn.turn_id));
        mkdirSync(stagingDir, { recursive: true });
        try {
          writeFileSync(
            join(root, getTurnProviderResponsePath(turn.turn_id)),
            JSON.stringify(execution.responseData, null, 2) + '\n'
          );
        } catch {
          // best-effort audit artifact
        }
      }
      const tracePath = writeRetryTrace(root, turn.turn_id, provider, model, state, runtimeId, retryPolicy, attemptsMade, 'failure', aggregateUsage, traceAttempts);
      return errorReturn(root, turn.turn_id, classified, { attempts_made: attemptsMade, retry_trace_path: tracePath });
    }

    const nextAttemptNumber = attemptsMade + 1;
    const retryDelayMs = calculateRetryDelayMs(retryPolicy, nextAttemptNumber);
    onStatus?.(
      `Attempt ${attemptsMade}/${retryPolicy.max_attempts} failed with ${classified.error_class}; retrying in ${retryDelayMs}ms...`
    );

    const delayStart = Date.now();
    try {
      await waitForRetryDelay(retryDelayMs, signal);
    } catch {
      const tracePath = writeRetryTrace(root, turn.turn_id, provider, model, state, runtimeId, retryPolicy, attemptsMade, 'aborted', aggregateUsage, traceAttempts);
      return { ok: false, error: 'Dispatch aborted by operator', attempts_made: attemptsMade, retry_trace_path: tracePath };
    }
    pendingScheduledDelayMs = retryDelayMs;
    pendingActualDelayMs = Date.now() - delayStart;
  }

  // Write trace on success too (only when retries were attempted)
  let retryTracePath = undefined;
  if (attemptsMade > 1) {
    retryTracePath = writeRetryTrace(root, turn.turn_id, provider, model, state, runtimeId, retryPolicy, attemptsMade, 'success', aggregateUsage, traceAttempts);
  }

  const { responseData, turnResult } = execution;

  // Persist raw response for auditability
  const stagingDir = join(root, getTurnStagingDir(turn.turn_id));
  mkdirSync(stagingDir, { recursive: true });

  try {
    writeFileSync(
      join(root, getTurnProviderResponsePath(turn.turn_id)),
      JSON.stringify(responseData, null, 2) + '\n'
    );
  } catch {
    // best-effort audit artifact
  }

  if (hasUsageTelemetry && turnResult) {
    turnResult.cost = { ...aggregateUsage };
  }

  // Stage the turn result
  try {
    writeFileSync(
      join(root, getTurnStagingResultPath(turn.turn_id)),
      JSON.stringify(turnResult, null, 2) + '\n'
    );
  } catch (err) {
    return { ok: false, error: `Failed to stage turn result: ${err.message}` };
  }

  clearApiError(root, turn.turn_id);
  onStatus?.('Turn result staged successfully.');

  return {
    ok: true,
    staged: true,
    usage: hasUsageTelemetry ? { ...aggregateUsage } : null,
    attempts_made: attemptsMade,
    retry_trace_path: retryTracePath,
  };
}

// ── Anthropic-specific request/response handling ────────────────────────────

function buildAnthropicHeaders(apiKey) {
  return {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
  };
}

function buildAnthropicRequest(promptMd, contextMd, model, maxOutputTokens) {
  const userContent = contextMd
    ? `${promptMd}${SEPARATOR}${contextMd}`
    : promptMd;

  return {
    model,
    max_tokens: maxOutputTokens,
    system: SYSTEM_PROMPT,
    messages: [
      { role: 'user', content: userContent },
    ],
  };
}

function buildOpenAiHeaders(apiKey) {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  };
}

function buildOpenAiRequest(promptMd, contextMd, model, maxOutputTokens) {
  const userContent = contextMd
    ? `${promptMd}${SEPARATOR}${contextMd}`
    : promptMd;

  return {
    model,
    max_completion_tokens: maxOutputTokens,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'developer', content: SYSTEM_PROMPT },
      { role: 'user', content: userContent },
    ],
  };
}

function buildProviderHeaders(provider, apiKey) {
  if (provider === 'openai') {
    return buildOpenAiHeaders(apiKey);
  }
  return buildAnthropicHeaders(apiKey);
}

function buildProviderRequest(provider, promptMd, contextMd, model, maxOutputTokens) {
  if (provider === 'openai') {
    return buildOpenAiRequest(promptMd, contextMd, model, maxOutputTokens);
  }
  return buildAnthropicRequest(promptMd, contextMd, model, maxOutputTokens);
}

/**
 * Extract structured turn result JSON from an Anthropic API response.
 * Looks for JSON in the first text content block.
 */
function extractTurnResultFromText(text) {
  if (typeof text !== 'string' || !text.trim()) {
    return {
      ok: false,
      error: 'Could not extract structured turn result JSON from API response. The model did not return valid turn result JSON.',
    };
  }

  const trimmed = text.trim();

  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object' && parsed.schema_version) {
      return { ok: true, turnResult: parsed };
    }
  } catch {
    // Not pure JSON — try extracting from markdown fences
  }

  const fenceMatch = trimmed.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  if (fenceMatch) {
    try {
      const parsed = JSON.parse(fenceMatch[1].trim());
      if (parsed && typeof parsed === 'object' && parsed.schema_version) {
        return { ok: true, turnResult: parsed };
      }
    } catch {
      // Invalid JSON inside fence
    }
  }

  const jsonStart = trimmed.indexOf('{');
  const jsonEnd = trimmed.lastIndexOf('}');
  if (jsonStart >= 0 && jsonEnd > jsonStart) {
    try {
      const parsed = JSON.parse(trimmed.slice(jsonStart, jsonEnd + 1));
      if (parsed && typeof parsed === 'object' && parsed.schema_version) {
        return { ok: true, turnResult: parsed };
      }
    } catch {
      // Not valid JSON
    }
  }

  return {
    ok: false,
    error: 'Could not extract structured turn result JSON from API response. The model did not return valid turn result JSON.',
  };
}

function extractAnthropicTurnResult(responseData) {
  if (!responseData?.content || !Array.isArray(responseData.content)) {
    return { ok: false, error: 'API response has no content blocks' };
  }

  const textBlock = responseData.content.find(b => b.type === 'text');
  if (!textBlock?.text) {
    return { ok: false, error: 'API response has no text content block' };
  }

  return extractTurnResultFromText(textBlock.text);
}

function extractOpenAiTurnResult(responseData) {
  if (!Array.isArray(responseData?.choices) || responseData.choices.length === 0) {
    return { ok: false, error: 'API response has no choices' };
  }

  const content = responseData.choices[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    return { ok: false, error: 'API response has no message content' };
  }

  return extractTurnResultFromText(content);
}

function extractTurnResult(responseData, provider = 'anthropic') {
  if (provider === 'openai') {
    return extractOpenAiTurnResult(responseData);
  }
  return extractAnthropicTurnResult(responseData);
}

function resolveTargetTurn(state, turnId) {
  if (turnId && state?.active_turns?.[turnId]) {
    return state.active_turns[turnId];
  }
  return state?.current_turn || Object.values(state?.active_turns || {})[0];
}

export {
  extractTurnResult,
  buildAnthropicRequest,
  buildOpenAiRequest,
  classifyError,
  classifyHttpError,
  COST_RATES,
};
