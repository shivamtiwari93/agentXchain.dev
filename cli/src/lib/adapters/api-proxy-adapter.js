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
 * Supported providers: "anthropic" (others can be added behind the same interface)
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

const DISPATCH_CURRENT = '.agentxchain/dispatch/current';
const STAGING_DIR = '.agentxchain/staging';
const STAGING_RESULT_PATH = '.agentxchain/staging/turn-result.json';

// Provider endpoint registry
const PROVIDER_ENDPOINTS = {
  anthropic: 'https://api.anthropic.com/v1/messages',
};

// Cost rates per million tokens (USD)
const COST_RATES = {
  'claude-sonnet-4-6': { input_per_1m: 3.00, output_per_1m: 15.00 },
  'claude-opus-4-6': { input_per_1m: 15.00, output_per_1m: 75.00 },
  'claude-haiku-4-5-20251001': { input_per_1m: 0.80, output_per_1m: 4.00 },
};

// ── Error classification ──────────────────────────────────────────────────────

/**
 * Build a classified ApiProxyError object.
 */
function classifyError(errorClass, message, recovery, retryable, httpStatus, rawDetail) {
  return {
    error_class: errorClass,
    message,
    recovery,
    retryable,
    http_status: httpStatus ?? null,
    raw_detail: rawDetail ? String(rawDetail).slice(0, 500) : null,
  };
}

/**
 * Classify an HTTP error response into a typed ApiProxyError.
 */
function classifyHttpError(status, body, provider, model, authEnv) {
  if (status === 401 || status === 403) {
    return classifyError(
      'auth_failure',
      `API authentication failed (${status})`,
      `Check that "${authEnv}" contains a valid API key for ${provider}`,
      false, status, body
    );
  }

  if (status === 429) {
    return classifyError(
      'rate_limited',
      `Rate limited by ${provider}`,
      `Rate limited by ${provider}. Wait and retry: agentxchain step --resume`,
      true, status, body
    );
  }

  if (status === 404) {
    return classifyError(
      'model_not_found',
      `Model "${model}" not found (404)`,
      `Model "${model}" not found. Check runtime config model name.`,
      false, status, body
    );
  }

  if (status === 400) {
    const lowerBody = (body || '').toLowerCase();
    if (lowerBody.includes('context') || lowerBody.includes('token')) {
      return classifyError(
        'context_overflow',
        'Prompt exceeds model context window',
        'Prompt exceeds model context window. Reduce context or switch to a larger model.',
        false, status, body
      );
    }
  }

  return classifyError(
    'unknown_api_error',
    `API returned ${status}`,
    `API returned ${status}. Review error detail and retry or complete manually.`,
    true, status, body
  );
}

/**
 * Persist classified error to staging for auditability (best-effort).
 */
function persistApiError(root, classified) {
  try {
    const stagingDir = join(root, STAGING_DIR);
    mkdirSync(stagingDir, { recursive: true });
    writeFileSync(
      join(stagingDir, 'api-error.json'),
      JSON.stringify(classified, null, 2) + '\n'
    );
  } catch {
    // best-effort audit artifact
  }
}

/**
 * Build an error return with classification and audit persistence.
 */
function errorReturn(root, classified) {
  persistApiError(root, classified);
  return { ok: false, error: classified.message, classified };
}

// ── Main dispatch ─────────────────────────────────────────────────────────────

/**
 * Dispatch a review-only turn via API proxy.
 *
 * @param {string} root - project root directory
 * @param {object} state - current governed state
 * @param {object} config - normalized config
 * @param {object} options - { signal?: AbortSignal, onStatus?: (msg: string) => void }
 * @returns {Promise<{ ok: boolean, error?: string, classified?: ApiProxyError, usage?: object, staged?: boolean }>}
 */
export async function dispatchApiProxy(root, state, config, options = {}) {
  const { signal, onStatus } = options;

  const turn = state.current_turn;
  if (!turn) {
    return { ok: false, error: 'No active turn in state' };
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
  const promptPath = join(root, DISPATCH_CURRENT, 'PROMPT.md');
  const contextPath = join(root, DISPATCH_CURRENT, 'CONTEXT.md');

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
    return errorReturn(root, classified);
  }

  const endpoint = PROVIDER_ENDPOINTS[provider];
  if (!endpoint) {
    const classified = classifyError(
      'unsupported_provider',
      `Unsupported provider: "${provider}". Supported: ${Object.keys(PROVIDER_ENDPOINTS).join(', ')}`,
      `Provider "${provider}" is not supported. Supported: ${Object.keys(PROVIDER_ENDPOINTS).join(', ')}`,
      false, null, null
    );
    return errorReturn(root, classified);
  }

  // Build request
  const maxOutputTokens = runtime.max_output_tokens || 4096;
  const timeoutSeconds = runtime.timeout_seconds || 120;
  const timeoutMs = timeoutSeconds * 1000;

  const requestBody = buildAnthropicRequest(promptMd, contextMd, model, maxOutputTokens);

  // Persist request metadata for auditability
  const dispatchDir = join(root, DISPATCH_CURRENT);
  try {
    writeFileSync(
      join(dispatchDir, 'API_REQUEST.json'),
      JSON.stringify({
        provider,
        model,
        endpoint,
        max_output_tokens: maxOutputTokens,
        timestamp: new Date().toISOString(),
        // Do not persist the API key
      }, null, 2) + '\n'
    );
  } catch {
    // best-effort audit artifact
  }

  onStatus?.(`Sending request to ${provider} (${model})...`);

  // Make the API call
  let response;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    // Respect external abort signal too
    if (signal) {
      signal.addEventListener('abort', () => controller.abort(), { once: true });
    }

    response = await fetch(endpoint, {
      method: 'POST',
      headers: buildAnthropicHeaders(apiKey),
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
  } catch (err) {
    if (err.name === 'AbortError') {
      const classified = classifyError(
        'timeout',
        `Request timed out after ${timeoutSeconds}s`,
        `Request timed out after ${timeoutSeconds}s. Increase timeout_seconds in runtime config or retry: agentxchain step --resume`,
        true, null, null
      );
      return errorReturn(root, classified);
    }
    const classified = classifyError(
      'network_failure',
      `Network error: ${err.message}`,
      `Network error: ${err.message}. Check connectivity and retry: agentxchain step --resume`,
      true, null, err.message
    );
    return errorReturn(root, classified);
  }

  if (!response.ok) {
    let errorBody = '';
    try { errorBody = await response.text(); } catch {}
    const classified = classifyHttpError(response.status, errorBody, provider, model, authEnv);
    return errorReturn(root, classified);
  }

  let responseData;
  try {
    responseData = await response.json();
  } catch (err) {
    const classified = classifyError(
      'response_parse_failure',
      'Provider returned non-JSON response',
      'Provider returned non-JSON response. This is usually transient. Retry: agentxchain step --resume',
      true, response.status, err.message
    );
    return errorReturn(root, classified);
  }

  // Persist raw response for auditability
  const stagingDir = join(root, STAGING_DIR);
  mkdirSync(stagingDir, { recursive: true });

  try {
    writeFileSync(
      join(stagingDir, 'provider-response.json'),
      JSON.stringify(responseData, null, 2) + '\n'
    );
  } catch {
    // best-effort audit artifact
  }

  // Extract turn result JSON from response
  const extraction = extractTurnResult(responseData);
  if (!extraction.ok) {
    const classified = classifyError(
      'turn_result_extraction_failure',
      extraction.error,
      'Model responded but did not produce valid turn result JSON. Retry or complete manually.',
      true, null, null
    );
    return errorReturn(root, classified);
  }

  // Overwrite cost with provider telemetry (authoritative source)
  const usage = responseData.usage;
  if (usage && extraction.turnResult) {
    const inputTokens = usage.input_tokens || 0;
    const outputTokens = usage.output_tokens || 0;
    const rates = COST_RATES[model];
    const usd = rates
      ? (inputTokens / 1_000_000) * rates.input_per_1m + (outputTokens / 1_000_000) * rates.output_per_1m
      : 0;

    extraction.turnResult.cost = {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      usd: Math.round(usd * 1000) / 1000,
    };
  }

  // Stage the turn result
  try {
    writeFileSync(
      join(root, STAGING_RESULT_PATH),
      JSON.stringify(extraction.turnResult, null, 2) + '\n'
    );
  } catch (err) {
    return { ok: false, error: `Failed to stage turn result: ${err.message}` };
  }

  onStatus?.('Turn result staged successfully.');

  return {
    ok: true,
    staged: true,
    usage: responseData.usage || null,
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
  const systemPrompt = [
    'You are acting as a governed agent in an AgentXchain protocol run.',
    'Your task and rules are described in the user message.',
    'You MUST respond with a valid JSON object matching the turn result schema provided in the prompt.',
    'Do NOT wrap the JSON in markdown code fences. Respond with raw JSON only.',
  ].join('\n');

  const userContent = contextMd
    ? `${promptMd}\n\n---\n\n${contextMd}`
    : promptMd;

  return {
    model,
    max_tokens: maxOutputTokens,
    system: systemPrompt,
    messages: [
      { role: 'user', content: userContent },
    ],
  };
}

/**
 * Extract structured turn result JSON from an Anthropic API response.
 * Looks for JSON in the first text content block.
 */
function extractTurnResult(responseData) {
  if (!responseData?.content || !Array.isArray(responseData.content)) {
    return { ok: false, error: 'API response has no content blocks' };
  }

  const textBlock = responseData.content.find(b => b.type === 'text');
  if (!textBlock?.text) {
    return { ok: false, error: 'API response has no text content block' };
  }

  const text = textBlock.text.trim();

  // Try parsing the entire response as JSON first
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && parsed.schema_version) {
      return { ok: true, turnResult: parsed };
    }
  } catch {
    // Not pure JSON — try extracting from markdown fences
  }

  // Try extracting JSON from markdown code fences
  const fenceMatch = text.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
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

  // Try finding JSON object boundaries
  const jsonStart = text.indexOf('{');
  const jsonEnd = text.lastIndexOf('}');
  if (jsonStart >= 0 && jsonEnd > jsonStart) {
    try {
      const parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1));
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

export { extractTurnResult, buildAnthropicRequest, classifyError, classifyHttpError, COST_RATES };
