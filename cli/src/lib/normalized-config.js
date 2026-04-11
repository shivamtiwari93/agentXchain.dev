/**
 * Normalized config loader for AgentXchain.
 *
 * Supports two config generations:
 *   - Legacy v3: the current CLI format (lock.json-centered, TALK.md routing)
 *   - Governed: the current spec format (orchestrator-owned state, structured turn results)
 *
 * Both are normalized into a single internal shape so that all downstream code
 * can operate without branching on config version.
 *
 * Design rule: Legacy projects are supported, not upgraded silently.
 * No automatic rewrite on read.
 */

import { validateHooksConfig } from './hook-runner.js';
import { validateNotificationsConfig } from './notification-runner.js';
import { validatePolicies, normalizePolicies } from './policy-evaluator.js';
import { validateTimeoutsConfig } from './timeout-evaluator.js';
import { SUPPORTED_TOKEN_COUNTER_PROVIDERS } from './token-counter.js';
import {
  buildDefaultWorkflowKitArtifactsForPhase,
  expandWorkflowKitPhaseArtifacts,
  isWorkflowKitPhaseTemplateId,
  VALID_WORKFLOW_KIT_PHASE_TEMPLATE_IDS,
} from './workflow-kit-phase-templates.js';

const VALID_WRITE_AUTHORITIES = ['authoritative', 'proposed', 'review_only'];
const VALID_RUNTIME_TYPES = ['manual', 'local_cli', 'api_proxy', 'mcp', 'remote_agent'];
export const VALID_API_PROXY_PROVIDERS = ['anthropic', 'openai', 'google', 'ollama'];
const AUTH_OPTIONAL_PROVIDERS = ['ollama'];
export const VALID_PROMPT_TRANSPORTS = ['argv', 'stdin', 'dispatch_bundle_only'];
const VALID_MCP_TRANSPORTS = ['stdio', 'streamable_http'];
const DEFAULT_PHASES = ['planning', 'implementation', 'qa'];
export { DEFAULT_PHASES };
const VALID_PHASE_NAME = /^[a-z][a-z0-9_-]*$/;
const VALID_SEMANTIC_IDS = ['pm_signoff', 'system_spec', 'implementation_notes', 'acceptance_matrix', 'ship_verdict', 'release_notes', 'section_check'];
const VALID_SCHEDULE_ID = /^[a-z0-9_-]+$/;

const VALID_API_PROXY_RETRY_JITTER = ['none', 'full'];
const VALID_API_PROXY_RETRY_CLASSES = [
  'rate_limited',
  'network_failure',
  'timeout',
  'response_parse_failure',
  'turn_result_extraction_failure',
  'unknown_api_error',
  'provider_overloaded',
];
const VALID_API_PROXY_RETRY_POLICY_FIELDS = [
  'enabled',
  'max_attempts',
  'base_delay_ms',
  'max_delay_ms',
  'backoff_multiplier',
  'jitter',
  'retry_on',
];
const VALID_API_PROXY_PREFLIGHT_TOKENIZERS = ['provider_local'];
const VALID_API_PROXY_PREFLIGHT_FIELDS = [
  'enabled',
  'tokenizer',
  'safety_margin_tokens',
];
const VALID_BUDGET_ON_EXCEED = ['pause_and_escalate'];

function validateMcpRuntime(runtimeId, runtime, errors) {
  const transport = typeof runtime?.transport === 'string' && runtime.transport.trim()
    ? runtime.transport.trim()
    : 'stdio';
  const command = runtime?.command;

  if (!VALID_MCP_TRANSPORTS.includes(transport)) {
    errors.push(`Runtime "${runtimeId}": mcp transport must be one of: ${VALID_MCP_TRANSPORTS.join(', ')}`);
  }

  if ('tool_name' in runtime && (typeof runtime.tool_name !== 'string' || !runtime.tool_name.trim())) {
    errors.push(`Runtime "${runtimeId}": mcp tool_name must be a non-empty string`);
  }

  if (transport === 'streamable_http') {
    if (typeof runtime?.url !== 'string' || !runtime.url.trim()) {
      errors.push(`Runtime "${runtimeId}": mcp streamable_http requires "url"`);
    } else {
      try {
        const parsed = new URL(runtime.url);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          errors.push(`Runtime "${runtimeId}": mcp url must use http or https`);
        }
      } catch {
        errors.push(`Runtime "${runtimeId}": mcp url must be a valid absolute URL`);
      }
    }

    if ('headers' in runtime) {
      if (!runtime.headers || typeof runtime.headers !== 'object' || Array.isArray(runtime.headers)) {
        errors.push(`Runtime "${runtimeId}": mcp headers must be an object of string values`);
      } else {
        for (const [key, value] of Object.entries(runtime.headers)) {
          if (typeof value !== 'string') {
            errors.push(`Runtime "${runtimeId}": mcp headers["${key}"] must be a string`);
          }
        }
      }
    }

    if ('command' in runtime) {
      errors.push(`Runtime "${runtimeId}": mcp streamable_http does not accept "command"`);
    }

    if ('args' in runtime) {
      errors.push(`Runtime "${runtimeId}": mcp streamable_http does not accept "args"`);
    }

    if ('cwd' in runtime) {
      errors.push(`Runtime "${runtimeId}": mcp streamable_http does not accept "cwd"`);
    }

    return;
  }

  if (typeof command === 'string') {
    if (!command.trim()) {
      errors.push(`Runtime "${runtimeId}": mcp command must be a non-empty string`);
    }
  } else if (Array.isArray(command)) {
    if (command.length === 0 || command.some((part) => typeof part !== 'string' || !part.trim())) {
      errors.push(`Runtime "${runtimeId}": mcp command array must contain at least one non-empty string and no empty parts`);
    }
  } else {
    errors.push(`Runtime "${runtimeId}": mcp requires "command" as a string or string array`);
  }

  if ('args' in runtime) {
    if (!Array.isArray(runtime.args) || runtime.args.some((part) => typeof part !== 'string')) {
      errors.push(`Runtime "${runtimeId}": mcp args must be an array of strings`);
    }
  }

  if ('cwd' in runtime && (typeof runtime.cwd !== 'string' || !runtime.cwd.trim())) {
    errors.push(`Runtime "${runtimeId}": mcp cwd must be a non-empty string`);
  }

  if ('url' in runtime) {
    errors.push(`Runtime "${runtimeId}": mcp stdio does not accept "url"`);
  }

  if ('headers' in runtime) {
    errors.push(`Runtime "${runtimeId}": mcp stdio does not accept "headers"`);
  }
}

function validateRemoteAgentRuntime(runtimeId, runtime, errors) {
  // url: required, absolute http(s)
  if (typeof runtime?.url !== 'string' || !runtime.url.trim()) {
    errors.push(`Runtime "${runtimeId}": remote_agent requires "url"`);
  } else {
    try {
      const parsed = new URL(runtime.url);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        errors.push(`Runtime "${runtimeId}": remote_agent url must use http or https`);
      }
    } catch {
      errors.push(`Runtime "${runtimeId}": remote_agent url must be a valid absolute URL`);
    }
  }

  // headers: optional object of string values
  if ('headers' in runtime) {
    if (!runtime.headers || typeof runtime.headers !== 'object' || Array.isArray(runtime.headers)) {
      errors.push(`Runtime "${runtimeId}": remote_agent headers must be an object of string values`);
    } else {
      for (const [key, value] of Object.entries(runtime.headers)) {
        if (typeof value !== 'string') {
          errors.push(`Runtime "${runtimeId}": remote_agent headers["${key}"] must be a string`);
        }
      }
    }
  }

  // timeout_ms: optional positive integer
  if ('timeout_ms' in runtime) {
    if (!Number.isInteger(runtime.timeout_ms) || runtime.timeout_ms <= 0) {
      errors.push(`Runtime "${runtimeId}": remote_agent timeout_ms must be a positive integer`);
    }
  }
}

function validateApiProxyRetryPolicy(runtimeId, retryPolicy, errors) {
  if (!retryPolicy || typeof retryPolicy !== 'object' || Array.isArray(retryPolicy)) {
    errors.push(`Runtime "${runtimeId}": retry_policy must be an object`);
    return;
  }

  for (const key of Object.keys(retryPolicy)) {
    if (!VALID_API_PROXY_RETRY_POLICY_FIELDS.includes(key)) {
      errors.push(`Runtime "${runtimeId}": retry_policy contains unknown field "${key}"`);
    }
  }

  if ('enabled' in retryPolicy && typeof retryPolicy.enabled !== 'boolean') {
    errors.push(`Runtime "${runtimeId}": retry_policy.enabled must be a boolean`);
  }

  if ('max_attempts' in retryPolicy && (!Number.isInteger(retryPolicy.max_attempts) || retryPolicy.max_attempts < 1)) {
    errors.push(`Runtime "${runtimeId}": retry_policy.max_attempts must be an integer >= 1`);
  }

  if ('base_delay_ms' in retryPolicy && (!Number.isFinite(retryPolicy.base_delay_ms) || retryPolicy.base_delay_ms < 0)) {
    errors.push(`Runtime "${runtimeId}": retry_policy.base_delay_ms must be a finite number >= 0`);
  }

  if ('max_delay_ms' in retryPolicy && (!Number.isFinite(retryPolicy.max_delay_ms) || retryPolicy.max_delay_ms < 0)) {
    errors.push(`Runtime "${runtimeId}": retry_policy.max_delay_ms must be a finite number >= 0`);
  }

  if (
    Number.isFinite(retryPolicy.base_delay_ms)
    && Number.isFinite(retryPolicy.max_delay_ms)
    && retryPolicy.max_delay_ms < retryPolicy.base_delay_ms
  ) {
    errors.push(`Runtime "${runtimeId}": retry_policy.max_delay_ms must be >= retry_policy.base_delay_ms`);
  }

  if (
    'backoff_multiplier' in retryPolicy
    && (!Number.isFinite(retryPolicy.backoff_multiplier) || retryPolicy.backoff_multiplier <= 0)
  ) {
    errors.push(`Runtime "${runtimeId}": retry_policy.backoff_multiplier must be a finite number > 0`);
  }

  if ('jitter' in retryPolicy && !VALID_API_PROXY_RETRY_JITTER.includes(retryPolicy.jitter)) {
    errors.push(
      `Runtime "${runtimeId}": retry_policy.jitter must be one of: ${VALID_API_PROXY_RETRY_JITTER.join(', ')}`
    );
  }

  if ('retry_on' in retryPolicy) {
    if (!Array.isArray(retryPolicy.retry_on)) {
      errors.push(`Runtime "${runtimeId}": retry_policy.retry_on must be an array`);
    } else {
      for (const errorClass of retryPolicy.retry_on) {
        if (!VALID_API_PROXY_RETRY_CLASSES.includes(errorClass)) {
          errors.push(
            `Runtime "${runtimeId}": retry_policy.retry_on contains unknown class "${errorClass}"`
          );
        }
      }
    }
  }
}

function validateApiProxyPreflightTokenization(runtimeId, runtime, errors) {
  const preflight = runtime?.preflight_tokenization;

  if ('context_window_tokens' in runtime) {
    if (!Number.isInteger(runtime.context_window_tokens) || runtime.context_window_tokens <= 0) {
      errors.push(`Runtime "${runtimeId}": context_window_tokens must be a positive integer`);
    }
  }

  if (!preflight || typeof preflight !== 'object' || Array.isArray(preflight)) {
    errors.push(`Runtime "${runtimeId}": preflight_tokenization must be an object`);
    return;
  }

  for (const key of Object.keys(preflight)) {
    if (!VALID_API_PROXY_PREFLIGHT_FIELDS.includes(key)) {
      errors.push(`Runtime "${runtimeId}": preflight_tokenization contains unknown field "${key}"`);
    }
  }

  if ('enabled' in preflight && typeof preflight.enabled !== 'boolean') {
    errors.push(`Runtime "${runtimeId}": preflight_tokenization.enabled must be a boolean`);
  }

  if ('tokenizer' in preflight && !VALID_API_PROXY_PREFLIGHT_TOKENIZERS.includes(preflight.tokenizer)) {
    errors.push(
      `Runtime "${runtimeId}": preflight_tokenization.tokenizer must be one of: ${VALID_API_PROXY_PREFLIGHT_TOKENIZERS.join(', ')}`
    );
  }

  if (
    'safety_margin_tokens' in preflight
    && (!Number.isInteger(preflight.safety_margin_tokens) || preflight.safety_margin_tokens < 0)
  ) {
    errors.push(`Runtime "${runtimeId}": preflight_tokenization.safety_margin_tokens must be an integer >= 0`);
  }

  if (preflight.enabled === true) {
    if (!SUPPORTED_TOKEN_COUNTER_PROVIDERS.includes(runtime.provider)) {
      errors.push(
        `Runtime "${runtimeId}": preflight_tokenization tokenizer "provider_local" is not supported for provider "${runtime.provider}". Supported providers: ${SUPPORTED_TOKEN_COUNTER_PROVIDERS.join(', ')}`
      );
    }

    if (!Number.isInteger(runtime.context_window_tokens) || runtime.context_window_tokens <= 0) {
      errors.push(`Runtime "${runtimeId}": context_window_tokens is required when preflight_tokenization.enabled is true`);
      return;
    }

    const maxOutputTokens = Number.isInteger(runtime.max_output_tokens) && runtime.max_output_tokens > 0
      ? runtime.max_output_tokens
      : 4096;
    const safetyMarginTokens = Number.isInteger(preflight.safety_margin_tokens)
      ? preflight.safety_margin_tokens
      : 2048;

    if (runtime.context_window_tokens <= maxOutputTokens + safetyMarginTokens) {
      errors.push(
        `Runtime "${runtimeId}": context_window_tokens must be greater than max_output_tokens + preflight_tokenization.safety_margin_tokens`
      );
    }
  }
}

/**
 * Detect config generation from raw parsed JSON.
 * Returns 3, 4, or null if unrecognizable.
 */
export function detectConfigVersion(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.schema_version === '1.0' || raw.schema_version === 4) return 4;
  if (raw.version === 3) return 3;
  return null;
}

/**
 * Validate a governed config.
 * Returns { ok, errors }.
 */
export function validateV4Config(data, projectRoot) {
  const errors = [];

  if (!data || typeof data !== 'object') {
    return { ok: false, errors: ['Config must be a JSON object'] };
  }

  // Top-level required sections
  if (!data.project || typeof data.project !== 'object') {
    errors.push('project must be an object with id and name');
  } else {
    if (typeof data.project.id !== 'string' || !data.project.id.trim()) errors.push('project.id must be a non-empty string');
    if (typeof data.project.name !== 'string' || !data.project.name.trim()) errors.push('project.name must be a non-empty string');
    // Optional project.goal field
    if (data.project.goal !== undefined && data.project.goal !== null) {
      if (typeof data.project.goal !== 'string') {
        errors.push('project.goal must be a string');
      } else if (!data.project.goal.trim()) {
        errors.push('project.goal must be a non-empty string when provided');
      } else if (data.project.goal.trim().length > 500) {
        errors.push('project.goal must be 500 characters or fewer');
      }
    }
  }

  // Roles
  if (!data.roles || typeof data.roles !== 'object') {
    errors.push('roles must be an object');
  } else {
    for (const [id, role] of Object.entries(data.roles)) {
      if (!/^[a-z0-9_-]+$/.test(id)) errors.push(`Invalid role id: "${id}"`);
      if (!role || typeof role !== 'object') { errors.push(`Role "${id}" must be an object`); continue; }
      if (typeof role.title !== 'string' || !role.title.trim()) errors.push(`Role "${id}": title required`);
      if (typeof role.mandate !== 'string' || !role.mandate.trim()) errors.push(`Role "${id}": mandate required`);
      if (!VALID_WRITE_AUTHORITIES.includes(role.write_authority)) {
        errors.push(`Role "${id}": write_authority must be one of: ${VALID_WRITE_AUTHORITIES.join(', ')}`);
      }
      if (typeof role.runtime !== 'string' || !role.runtime.trim()) errors.push(`Role "${id}": runtime required`);
    }
  }

  // Runtimes
  if (!data.runtimes || typeof data.runtimes !== 'object') {
    errors.push('runtimes must be an object');
  } else {
    for (const [id, rt] of Object.entries(data.runtimes)) {
      if (!rt || typeof rt !== 'object') { errors.push(`Runtime "${id}" must be an object`); continue; }
      if (!VALID_RUNTIME_TYPES.includes(rt.type)) {
        errors.push(`Runtime "${id}": type must be one of: ${VALID_RUNTIME_TYPES.join(', ')}`);
      }
      // Validate prompt_transport for local_cli runtimes
      if (rt.type === 'local_cli' && rt.prompt_transport) {
        if (!VALID_PROMPT_TRANSPORTS.includes(rt.prompt_transport)) {
          errors.push(`Runtime "${id}": prompt_transport must be one of: ${VALID_PROMPT_TRANSPORTS.join(', ')}`);
        }
        if (rt.prompt_transport === 'argv') {
          // Verify {prompt} placeholder exists in command/args
          const parts = Array.isArray(rt.command) ? rt.command : [rt.command, ...(rt.args || [])];
          const hasPlaceholder = parts.some(p => typeof p === 'string' && p.includes('{prompt}'));
          if (!hasPlaceholder) {
            errors.push(`Runtime "${id}": prompt_transport is "argv" but command/args do not contain {prompt} placeholder`);
          }
        }
      }
      // Validate api_proxy required fields (Session #19 freeze)
      if (rt.type === 'api_proxy') {
        if (typeof rt.provider !== 'string' || !rt.provider.trim()) {
          errors.push(`Runtime "${id}": api_proxy requires "provider" (e.g. "anthropic", "openai")`);
        } else if (!VALID_API_PROXY_PROVIDERS.includes(rt.provider)) {
          errors.push(`Runtime "${id}": api_proxy provider must be one of: ${VALID_API_PROXY_PROVIDERS.join(', ')}`);
        }
        if (typeof rt.model !== 'string' || !rt.model.trim()) {
          errors.push(`Runtime "${id}": api_proxy requires "model" (e.g. "claude-sonnet-4-6")`);
        }
        if (typeof rt.auth_env !== 'string' || !rt.auth_env.trim()) {
          if (!AUTH_OPTIONAL_PROVIDERS.includes(rt.provider)) {
            errors.push(`Runtime "${id}": api_proxy requires "auth_env" (environment variable name for API key)`);
          }
        }
        if ('base_url' in rt) {
          if (typeof rt.base_url !== 'string' || !rt.base_url.trim()) {
            errors.push(`Runtime "${id}": api_proxy base_url must be a non-empty string when provided`);
          } else {
            try {
              const parsed = new URL(rt.base_url);
              if (!['http:', 'https:'].includes(parsed.protocol)) {
                errors.push(`Runtime "${id}": api_proxy base_url must use http or https`);
              }
            } catch {
              errors.push(`Runtime "${id}": api_proxy base_url must be a valid absolute URL`);
            }
          }
        }
        if ('retry_policy' in rt) {
          validateApiProxyRetryPolicy(id, rt.retry_policy, errors);
        }
        if ('preflight_tokenization' in rt || 'context_window_tokens' in rt) {
          validateApiProxyPreflightTokenization(id, rt, errors);
        }
      }
      if (rt.type === 'mcp') {
        validateMcpRuntime(id, rt, errors);
      }
      if (rt.type === 'remote_agent') {
        validateRemoteAgentRuntime(id, rt, errors);
      }
    }
  }

  // Cross-references: every role.runtime must reference an existing runtime
  if (data.roles && data.runtimes) {
    for (const [id, role] of Object.entries(data.roles)) {
      if (role.runtime && !data.runtimes[role.runtime]) {
        errors.push(`Role "${id}" references unknown runtime "${role.runtime}"`);
      }
    }
  }

  // Cross-reference: review_only roles should not use authoritative runtimes
  if (data.roles && data.runtimes) {
    for (const [id, role] of Object.entries(data.roles)) {
      if (role.write_authority === 'review_only' && role.runtime && data.runtimes[role.runtime]) {
        const rt = data.runtimes[role.runtime];
        if (rt.type === 'local_cli') {
          errors.push(`Role "${id}" is review_only but uses local_cli runtime "${role.runtime}" — review_only roles should not have authoritative write access`);
        }
      }
      // api_proxy and remote_agent restriction: only review_only and proposed roles may bind.
      // These adapters do not have a proven local workspace mutation path in v1.
      if (role.runtime && data.runtimes[role.runtime]) {
        const rt = data.runtimes[role.runtime];
        if (
          (rt.type === 'api_proxy' || rt.type === 'remote_agent')
          && role.write_authority !== 'review_only'
          && role.write_authority !== 'proposed'
        ) {
          errors.push(
            `Role "${id}" has write_authority "${role.write_authority}" but uses ${rt.type} runtime "${role.runtime}" — ${rt.type} only supports review_only and proposed roles`
          );
        }
      }
    }
  }

  // Routing (optional but validated if present)
  // Phase names are derived from routing keys when present; fall back to defaults
  if (data.routing) {
    for (const [phase, route] of Object.entries(data.routing)) {
      if (!VALID_PHASE_NAME.test(phase)) {
        errors.push(`Routing phase name "${phase}" must be lowercase alphanumeric starting with a letter (hyphens and underscores allowed)`);
      }
      if (route.entry_role && data.roles && !data.roles[route.entry_role]) {
        errors.push(`Routing "${phase}": entry_role "${route.entry_role}" is not a defined role`);
      }
      if (route.allowed_next_roles && Array.isArray(route.allowed_next_roles)) {
        for (const r of route.allowed_next_roles) {
          if (r !== 'human' && data.roles && !data.roles[r]) {
            errors.push(`Routing "${phase}": allowed_next_roles references unknown role "${r}"`);
          }
        }
      }
      if ('max_concurrent_turns' in route) {
        if (!Number.isInteger(route.max_concurrent_turns) || route.max_concurrent_turns < 1 || route.max_concurrent_turns > 4) {
          errors.push(`Routing "${phase}": max_concurrent_turns must be an integer between 1 and 4`);
        }
      }
    }
  }

  // Gates (optional but validated if present)
  if (data.gates) {
    if (data.routing) {
      for (const [, route] of Object.entries(data.routing)) {
        if (route.exit_gate && !data.gates[route.exit_gate]) {
          errors.push(`Routing references unknown gate: "${route.exit_gate}"`);
        }
      }
    }
  }

  // Hooks (optional but validated if present)
  if (data.hooks) {
    const hookValidation = validateHooksConfig(data.hooks, projectRoot || null);
    errors.push(...hookValidation.errors);
  }

  // Notifications (optional but validated if present)
  if (data.notifications) {
    const notificationValidation = validateNotificationsConfig(data.notifications);
    errors.push(...notificationValidation.errors);
  }

  // Schedules (optional but validated if present)
  if (data.schedules !== undefined) {
    const scheduleValidation = validateSchedulesConfig(data.schedules, data.roles);
    errors.push(...scheduleValidation.errors);
  }

  // Workflow Kit (optional but validated if present)
  if (data.workflow_kit !== undefined) {
    const wkValidation = validateWorkflowKitConfig(data.workflow_kit, data.routing, data.roles);
    errors.push(...wkValidation.errors);
  }

  // Policies (optional but validated if present)
  if (data.policies !== undefined) {
    const policyValidation = validatePolicies(data.policies);
    errors.push(...policyValidation.errors);
  }

  // Budget (optional but validated if present)
  if (data.budget !== undefined) {
    const budgetValidation = validateBudgetConfig(data.budget);
    errors.push(...budgetValidation.errors);
  }

  // Approval Policy (optional but validated if present)
  if (data.approval_policy !== undefined) {
    errors.push(...validateApprovalPolicy(data.approval_policy, data.routing));
  }

  // Timeouts (optional but validated if present)
  if (data.timeouts !== undefined) {
    const timeoutValidation = validateTimeoutsConfig(data.timeouts, data.routing);
    errors.push(...timeoutValidation.errors);
  }

  return { ok: errors.length === 0, errors };
}

export function validateBudgetConfig(budget) {
  const errors = [];

  if (budget === null) {
    return { ok: true, errors };
  }

  if (!budget || typeof budget !== 'object' || Array.isArray(budget)) {
    errors.push('budget must be an object');
    return { ok: false, errors };
  }

  validateBudgetUsdLimit('budget.per_turn_max_usd', budget.per_turn_max_usd, errors);
  validateBudgetUsdLimit('budget.per_run_max_usd', budget.per_run_max_usd, errors);

  if (
    Number.isFinite(budget.per_turn_max_usd) &&
    Number.isFinite(budget.per_run_max_usd) &&
    budget.per_turn_max_usd > budget.per_run_max_usd
  ) {
    errors.push('budget.per_turn_max_usd must be less than or equal to budget.per_run_max_usd when both are set');
  }

  if (budget.on_exceed !== undefined) {
    if (typeof budget.on_exceed !== 'string' || !VALID_BUDGET_ON_EXCEED.includes(budget.on_exceed)) {
      errors.push(`budget.on_exceed must be one of: ${VALID_BUDGET_ON_EXCEED.join(', ')} (warn is not implemented)`);
    }
  }

  if (budget.cost_rates !== undefined) {
    if (!budget.cost_rates || typeof budget.cost_rates !== 'object' || Array.isArray(budget.cost_rates)) {
      errors.push('budget.cost_rates must be an object');
    } else {
      for (const [model, rates] of Object.entries(budget.cost_rates)) {
        if (typeof model !== 'string' || !model.trim()) {
          errors.push('budget.cost_rates model keys must be non-empty strings');
          continue;
        }
        if (!rates || typeof rates !== 'object' || Array.isArray(rates)) {
          errors.push(`budget.cost_rates.${model} must be an object`);
          continue;
        }
        validateBudgetCostRate(`budget.cost_rates.${model}.input_per_1m`, rates.input_per_1m, errors);
        validateBudgetCostRate(`budget.cost_rates.${model}.output_per_1m`, rates.output_per_1m, errors);
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

function validateBudgetUsdLimit(path, value, errors) {
  if (value === undefined || value === null) {
    return;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    errors.push(`${path} must be a finite number when provided`);
    return;
  }
  if (value <= 0) {
    errors.push(`${path} must be greater than 0 when provided`);
  }
}

function validateBudgetCostRate(path, value, errors) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    errors.push(`${path} must be a finite number`);
    return;
  }
  if (value < 0) {
    errors.push(`${path} must be greater than or equal to 0`);
  }
}

export function validateSchedulesConfig(schedules, roles) {
  const errors = [];

  if (!schedules || typeof schedules !== 'object' || Array.isArray(schedules)) {
    errors.push('schedules must be an object');
    return { ok: false, errors };
  }

  for (const [scheduleId, schedule] of Object.entries(schedules)) {
    if (!VALID_SCHEDULE_ID.test(scheduleId)) {
      errors.push(`Schedule "${scheduleId}" must use lowercase alphanumeric, underscore, or hyphen characters only`);
      continue;
    }

    if (!schedule || typeof schedule !== 'object' || Array.isArray(schedule)) {
      errors.push(`Schedule "${scheduleId}" must be an object`);
      continue;
    }

    if (!Number.isInteger(schedule.every_minutes) || schedule.every_minutes < 1) {
      errors.push(`Schedule "${scheduleId}": every_minutes must be an integer >= 1`);
    }

    if ('enabled' in schedule && typeof schedule.enabled !== 'boolean') {
      errors.push(`Schedule "${scheduleId}": enabled must be a boolean`);
    }

    if ('auto_approve' in schedule && typeof schedule.auto_approve !== 'boolean') {
      errors.push(`Schedule "${scheduleId}": auto_approve must be a boolean`);
    }

    if ('max_turns' in schedule && (!Number.isInteger(schedule.max_turns) || schedule.max_turns < 1)) {
      errors.push(`Schedule "${scheduleId}": max_turns must be an integer >= 1`);
    }

    if ('trigger_reason' in schedule && (typeof schedule.trigger_reason !== 'string' || !schedule.trigger_reason.trim())) {
      errors.push(`Schedule "${scheduleId}": trigger_reason must be a non-empty string when provided`);
    }

    if ('initial_role' in schedule) {
      if (typeof schedule.initial_role !== 'string' || !schedule.initial_role.trim()) {
        errors.push(`Schedule "${scheduleId}": initial_role must be a non-empty string when provided`);
      } else if (roles && !roles[schedule.initial_role]) {
        errors.push(`Schedule "${scheduleId}": initial_role "${schedule.initial_role}" is not a defined role`);
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Validate the workflow_kit config section.
 * Returns { ok, errors, warnings }.
 */
export function validateWorkflowKitConfig(wk, routing, roles) {
  const errors = [];
  const warnings = [];

  if (wk === null || (typeof wk === 'object' && !Array.isArray(wk) && Object.keys(wk).length === 0)) {
    // Empty workflow_kit is a valid opt-out
    return { ok: true, errors, warnings };
  }

  if (!wk || typeof wk !== 'object' || Array.isArray(wk)) {
    errors.push('workflow_kit must be an object');
    return { ok: false, errors, warnings };
  }

  if (wk.phases !== undefined) {
    if (!wk.phases || typeof wk.phases !== 'object' || Array.isArray(wk.phases)) {
      errors.push('workflow_kit.phases must be an object');
      return { ok: false, errors, warnings };
    }

    const routingPhases = routing ? new Set(Object.keys(routing)) : new Set(DEFAULT_PHASES);

    for (const [phase, phaseConfig] of Object.entries(wk.phases)) {
      if (!VALID_PHASE_NAME.test(phase)) {
        errors.push(`workflow_kit phase name "${phase}" must be lowercase alphanumeric starting with a letter (hyphens and underscores allowed)`);
        continue;
      }

      if (!routingPhases.has(phase)) {
        warnings.push(`workflow_kit declares phase "${phase}" which is not in routing`);
      }

      if (!phaseConfig || typeof phaseConfig !== 'object' || Array.isArray(phaseConfig)) {
        errors.push(`workflow_kit.phases.${phase} must be an object`);
        continue;
      }

      let templateValid = true;
      if (phaseConfig.template !== undefined) {
        if (typeof phaseConfig.template !== 'string' || !phaseConfig.template.trim()) {
          errors.push(`workflow_kit.phases.${phase}.template must be a non-empty string`);
          templateValid = false;
        } else if (!isWorkflowKitPhaseTemplateId(phaseConfig.template)) {
          errors.push(
            `workflow_kit.phases.${phase}.template "${phaseConfig.template}" is unknown; valid values: ${VALID_WORKFLOW_KIT_PHASE_TEMPLATE_IDS.join(', ')}`,
          );
          templateValid = false;
        }
      }

      if (phaseConfig.artifacts !== undefined && !Array.isArray(phaseConfig.artifacts)) {
        errors.push(`workflow_kit.phases.${phase}.artifacts must be an array`);
        continue;
      }

      if (Array.isArray(phaseConfig.artifacts)) {
        const explicitSeenPaths = new Set();
        for (const artifact of phaseConfig.artifacts) {
          if (!artifact || typeof artifact !== 'object') {
            continue;
          }
          if (typeof artifact.path !== 'string' || !artifact.path.trim()) {
            continue;
          }
          if (explicitSeenPaths.has(artifact.path)) {
            errors.push(`duplicate artifact path "${artifact.path}" in phase "${phase}"`);
            continue;
          }
          explicitSeenPaths.add(artifact.path);
        }
      }

      if (phaseConfig.template === undefined && phaseConfig.artifacts === undefined) {
        errors.push(`workflow_kit.phases.${phase} must declare template, artifacts, or both`);
        continue;
      }

      const seenPaths = new Set();
      const expandedArtifacts = templateValid
        ? expandWorkflowKitPhaseArtifacts(phaseConfig)
        : Array.isArray(phaseConfig.artifacts) ? phaseConfig.artifacts : [];
      for (let i = 0; i < expandedArtifacts.length; i++) {
        const artifact = expandedArtifacts[i];
        const prefix = `workflow_kit.phases.${phase}.artifacts[${i}]`;

        if (!artifact || typeof artifact !== 'object') {
          errors.push(`${prefix} must be an object`);
          continue;
        }

        if (typeof artifact.path !== 'string' || !artifact.path.trim()) {
          errors.push(`${prefix} requires a non-empty path`);
          continue;
        }

        if (artifact.path.includes('..')) {
          errors.push(`${prefix} path must not traverse above project root (contains "..")`);
          continue;
        }

        if (seenPaths.has(artifact.path)) {
          errors.push(`duplicate artifact path "${artifact.path}" in phase "${phase}"`);
        }
        seenPaths.add(artifact.path);

        if (artifact.semantics !== null && artifact.semantics !== undefined) {
          if (typeof artifact.semantics !== 'string') {
            errors.push(`${prefix} semantics must be a string or null`);
          } else if (!VALID_SEMANTIC_IDS.includes(artifact.semantics)) {
            errors.push(`${prefix} unknown semantics validator "${artifact.semantics}"; valid values: ${VALID_SEMANTIC_IDS.join(', ')}`);
          } else if (artifact.semantics === 'section_check') {
            if (!artifact.semantics_config || typeof artifact.semantics_config !== 'object') {
              errors.push(`${prefix} section_check requires semantics_config`);
            } else if (!Array.isArray(artifact.semantics_config.required_sections) || artifact.semantics_config.required_sections.length === 0) {
              errors.push(`${prefix} section_check requires semantics_config.required_sections as a non-empty array`);
            } else {
              for (const section of artifact.semantics_config.required_sections) {
                if (typeof section !== 'string' || !section.trim()) {
                  errors.push(`${prefix} section_check required_sections must contain non-empty strings`);
                  break;
                }
              }
            }
          }
        }

        if (artifact.required !== undefined && typeof artifact.required !== 'boolean') {
          errors.push(`${prefix} required must be a boolean`);
        }

        if (artifact.owned_by !== undefined && artifact.owned_by !== null) {
          if (typeof artifact.owned_by !== 'string') {
            errors.push(`${prefix} owned_by must be a string`);
          } else if (!/^[a-z0-9_-]+$/.test(artifact.owned_by)) {
            errors.push(`${prefix} owned_by "${artifact.owned_by}" is not a valid role ID (must be lowercase alphanumeric with hyphens/underscores)`);
          } else if (roles && typeof roles === 'object' && !roles[artifact.owned_by]) {
            errors.push(`${prefix} owned_by "${artifact.owned_by}" does not reference a defined role`);
          } else if (
            artifact.required !== false &&
            roles && typeof roles === 'object' &&
            roles[artifact.owned_by]?.write_authority === 'review_only'
          ) {
            // Check if any authoritative/proposed role exists in this phase's routing
            const phaseRouting = routing?.[phase];
            const phaseRoles = new Set([
              ...(phaseRouting?.allowed_next_roles || []),
              ...(phaseRouting?.entry_role ? [phaseRouting.entry_role] : []),
            ]);
            const hasWriter = [...phaseRoles].some(rid =>
              roles[rid]?.write_authority === 'authoritative' || roles[rid]?.write_authority === 'proposed',
            );
            if (!hasWriter) {
              warnings.push(
                `${prefix} owned_by "${artifact.owned_by}" is a review_only role in phase "${phase}" with no authoritative or proposed role — nobody can write this required artifact`,
              );
            }
          }
        }
      }
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

const VALID_APPROVAL_ACTIONS = ['auto_approve', 'require_human'];

/**
 * Validate the approval_policy config section.
 * Returns an array of error strings.
 */
export function validateApprovalPolicy(ap, routing) {
  const errors = [];
  if (ap === null || ap === undefined) return errors;
  if (typeof ap !== 'object' || Array.isArray(ap)) {
    errors.push('approval_policy must be an object');
    return errors;
  }

  const routingPhases = routing ? Object.keys(routing) : [];

  // phase_transitions
  if (ap.phase_transitions !== undefined) {
    const pt = ap.phase_transitions;
    if (typeof pt !== 'object' || Array.isArray(pt)) {
      errors.push('approval_policy.phase_transitions must be an object');
    } else {
      if (pt.default !== undefined && !VALID_APPROVAL_ACTIONS.includes(pt.default)) {
        errors.push(`approval_policy.phase_transitions.default must be one of: ${VALID_APPROVAL_ACTIONS.join(', ')}`);
      }
      if (pt.rules !== undefined) {
        if (!Array.isArray(pt.rules)) {
          errors.push('approval_policy.phase_transitions.rules must be an array');
        } else {
          for (let i = 0; i < pt.rules.length; i++) {
            const rule = pt.rules[i];
            const prefix = `approval_policy.phase_transitions.rules[${i}]`;
            if (!rule || typeof rule !== 'object') {
              errors.push(`${prefix} must be an object`);
              continue;
            }
            if (!VALID_APPROVAL_ACTIONS.includes(rule.action)) {
              errors.push(`${prefix}.action must be one of: ${VALID_APPROVAL_ACTIONS.join(', ')}`);
            }
            if (rule.from_phase !== undefined) {
              if (typeof rule.from_phase !== 'string') {
                errors.push(`${prefix}.from_phase must be a string`);
              } else if (routingPhases.length > 0 && !routingPhases.includes(rule.from_phase)) {
                errors.push(`${prefix}.from_phase "${rule.from_phase}" does not exist in routing`);
              }
            }
            if (rule.to_phase !== undefined) {
              if (typeof rule.to_phase !== 'string') {
                errors.push(`${prefix}.to_phase must be a string`);
              } else if (routingPhases.length > 0 && !routingPhases.includes(rule.to_phase)) {
                errors.push(`${prefix}.to_phase "${rule.to_phase}" does not exist in routing`);
              }
            }
            if (rule.when !== undefined) {
              errors.push(...validateApprovalWhen(rule.when, prefix));
            }
          }
        }
      }
    }
  }

  // run_completion
  if (ap.run_completion !== undefined) {
    const rc = ap.run_completion;
    if (typeof rc !== 'object' || Array.isArray(rc)) {
      errors.push('approval_policy.run_completion must be an object');
    } else {
      if (rc.action !== undefined && !VALID_APPROVAL_ACTIONS.includes(rc.action)) {
        errors.push(`approval_policy.run_completion.action must be one of: ${VALID_APPROVAL_ACTIONS.join(', ')}`);
      }
      if (rc.when !== undefined) {
        errors.push(...validateApprovalWhen(rc.when, 'approval_policy.run_completion'));
      }
    }
  }

  return errors;
}

function validateApprovalWhen(when, prefix) {
  const errors = [];
  if (typeof when !== 'object' || Array.isArray(when) || when === null) {
    errors.push(`${prefix}.when must be an object`);
    return errors;
  }
  if (when.gate_passed !== undefined && typeof when.gate_passed !== 'boolean') {
    errors.push(`${prefix}.when.gate_passed must be a boolean`);
  }
  if (when.roles_participated !== undefined) {
    if (!Array.isArray(when.roles_participated)) {
      errors.push(`${prefix}.when.roles_participated must be an array of role IDs`);
    } else {
      for (const r of when.roles_participated) {
        if (typeof r !== 'string' || !r.trim()) {
          errors.push(`${prefix}.when.roles_participated entries must be non-empty strings`);
          break;
        }
      }
    }
  }
  if (when.all_phases_visited !== undefined && typeof when.all_phases_visited !== 'boolean') {
    errors.push(`${prefix}.when.all_phases_visited must be a boolean`);
  }
  return errors;
}

/**
 * Normalize a legacy v3 config into the internal shape.
 * Does NOT modify the original file — this is a read-time transformation.
 */
export function normalizeV3(raw) {
  const agents = {};
  if (raw.agents && typeof raw.agents === 'object') {
    for (const [id, agent] of Object.entries(raw.agents)) {
      agents[id] = {
        title: agent.name || id,
        mandate: agent.mandate || '',
        write_authority: inferWriteAuthority(id),
        runtime_class: inferRuntimeClass(id),
        runtime_id: `legacy-${id}`,
      };
    }
  }

  const runtimes = {};
  for (const [id, agent] of Object.entries(agents)) {
    runtimes[agent.runtime_id] = {
      type: agent.runtime_class,
    };
  }

  return {
    schema_version: 3,
    protocol_mode: 'legacy',
    template: null,
    project: {
      id: slugify(raw.project || 'unknown'),
      name: raw.project || 'Unknown Project',
      default_branch: 'main',
    },
    roles: agents,
    runtimes,
    routing: buildLegacyRouting(Object.keys(agents)),
    gates: {},
    hooks: {},
    notifications: {},
    schedules: {},
    budget: null,
    policies: [],
    approval_policy: null,
    timeouts: null,
    workflow_kit: normalizeWorkflowKit(undefined, DEFAULT_PHASES),
    retention: {
      talk_strategy: 'append_only',
      history_strategy: 'jsonl_append_only',
    },
    rules: {
      challenge_required: raw.rules?.require_message ?? true,
      max_turn_retries: 2,
      max_deadlock_cycles: 2,
      max_consecutive_claims: raw.rules?.max_consecutive_claims ?? 2,
      verify_command: raw.rules?.verify_command ?? null,
      compress_after_words: raw.rules?.compress_after_words ?? null,
      ttl_minutes: raw.rules?.ttl_minutes ?? 20,
    },
    files: {
      talk: raw.talk_file || 'TALK.md',
      history: raw.history_file || 'history.jsonl',
      state: raw.state_file || 'state.json',
      log: raw.log || 'log.md',
    },
    compat: {
      next_owner_source: 'talk-md',
      lock_based_coordination: true,
      original_version: 3,
    },
  };
}

/**
 * Normalize a governed config into the internal shape.
 */
export function normalizeV4(raw) {
  const roles = {};
  if (raw.roles) {
    for (const [id, role] of Object.entries(raw.roles)) {
      roles[id] = {
        title: role.title,
        mandate: role.mandate,
        write_authority: role.write_authority,
        runtime_class: raw.runtimes?.[role.runtime]?.type || 'manual',
        runtime_id: role.runtime,
      };
    }
  }

  const routing = raw.routing || {};
  const routingPhases = Object.keys(routing).length > 0 ? Object.keys(routing) : DEFAULT_PHASES;

  return {
    schema_version: 4,
    protocol_mode: 'governed',
    template: raw.template || 'generic',
    project: {
      id: raw.project?.id || 'unknown',
      name: raw.project?.name || 'Unknown',
      ...(typeof raw.project?.goal === 'string' && raw.project.goal.trim() ? { goal: raw.project.goal.trim() } : {}),
      default_branch: raw.project?.default_branch || 'main',
    },
    roles,
    runtimes: raw.runtimes || {},
    routing,
    gates: raw.gates || {},
    hooks: raw.hooks || {},
    notifications: raw.notifications || {},
    schedules: normalizeSchedules(raw.schedules),
    budget: raw.budget || null,
    policies: normalizePolicies(raw.policies),
    approval_policy: raw.approval_policy || null,
    timeouts: raw.timeouts || null,
    workflow_kit: normalizeWorkflowKit(raw.workflow_kit, routingPhases),
    retention: raw.retention || {
      talk_strategy: 'append_only',
      history_strategy: 'jsonl_append_only',
    },
    rules: {
      challenge_required: raw.rules?.challenge_required ?? true,
      max_turn_retries: raw.rules?.max_turn_retries ?? 2,
      max_deadlock_cycles: raw.rules?.max_deadlock_cycles ?? 2,
      max_consecutive_claims: null,
      verify_command: null,
      compress_after_words: null,
      ttl_minutes: null,
    },
    files: {
      talk: 'TALK.md',
      history: '.agentxchain/history.jsonl',
      state: '.agentxchain/state.json',
      log: null,
    },
    compat: {
      next_owner_source: 'state-json',
      lock_based_coordination: false,
      original_version: 4,
    },
  };
}

function normalizeSchedules(rawSchedules) {
  if (!rawSchedules || typeof rawSchedules !== 'object' || Array.isArray(rawSchedules)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(rawSchedules).map(([scheduleId, schedule]) => [
      scheduleId,
      {
        enabled: schedule?.enabled !== false,
        every_minutes: schedule?.every_minutes,
        auto_approve: schedule?.auto_approve !== false,
        max_turns: schedule?.max_turns ?? 50,
        initial_role: schedule?.initial_role || null,
        trigger_reason: schedule?.trigger_reason?.trim() || `schedule:${scheduleId}`,
      },
    ]),
  );
}

/**
 * Load and normalize a config from raw JSON.
 * Returns { ok, normalized, errors, version }.
 */
export function loadNormalizedConfig(raw, projectRoot) {
  const version = detectConfigVersion(raw);

  if (version === null) {
    return {
      ok: false,
      normalized: null,
      errors: ['Unrecognized config format. Expected version: 3 or schema_version: "1.0" / 4'],
      version: null,
    };
  }

  if (version === 3) {
    // Use the existing v3 validator for basic shape checks
    const errors = [];
    if (typeof raw.project !== 'string' || !raw.project.trim()) errors.push('project must be a non-empty string');
    if (!raw.agents || typeof raw.agents !== 'object') {
      errors.push('agents must be an object');
    } else {
      for (const [id, agent] of Object.entries(raw.agents)) {
        if (!/^[a-z0-9_-]+$/.test(id)) errors.push(`Invalid agent id: "${id}"`);
        if (!agent || typeof agent !== 'object') { errors.push(`Agent "${id}" must be an object`); continue; }
        if (typeof agent.name !== 'string' || !agent.name.trim()) errors.push(`Agent "${id}": name required`);
        if (typeof agent.mandate !== 'string' || !agent.mandate.trim()) errors.push(`Agent "${id}": mandate required`);
      }
    }
    if (errors.length > 0) {
      return { ok: false, normalized: null, errors, version: 3 };
    }
    return { ok: true, normalized: normalizeV3(raw), errors: [], version: 3 };
  }

  if (version === 4) {
    const validation = validateV4Config(raw, projectRoot || null);
    if (!validation.ok) {
      return { ok: false, normalized: null, errors: validation.errors, version: 4 };
    }
    return { ok: true, normalized: normalizeV4(raw), errors: [], version: 4 };
  }
}

export function getMaxConcurrentTurns(config, phase) {
  const configured = config?.routing?.[phase]?.max_concurrent_turns;
  if (!Number.isInteger(configured) || configured < 1) {
    return 1;
  }
  return Math.min(configured, 4);
}


/**
 * Normalize workflow_kit config.
 * When absent, builds defaults from routing phases using the built-in phase templates.
 * When present, normalizes artifact entries.
 */
export function normalizeWorkflowKit(raw, routingPhases) {
  if (raw === undefined || raw === null) {
    return buildDefaultWorkflowKit(routingPhases);
  }

  // Empty object is an explicit opt-out — no artifacts
  if (typeof raw === 'object' && !Array.isArray(raw) && Object.keys(raw).length === 0) {
    return { phases: {}, _explicit: true };
  }

  const phases = {};
  if (raw.phases) {
    for (const [phase, phaseConfig] of Object.entries(raw.phases)) {
      phases[phase] = {
        artifacts: expandWorkflowKitPhaseArtifacts(phaseConfig).map(a => ({
          path: a.path,
          semantics: a.semantics || null,
          semantics_config: a.semantics_config || null,
          owned_by: a.owned_by || null,
          required: a.required !== false,
        })),
      };
    }
  }

  return { phases, _explicit: true };
}

function buildDefaultWorkflowKit(routingPhases) {
  const phases = {};
  for (const phase of routingPhases) {
    const templateArtifacts = buildDefaultWorkflowKitArtifactsForPhase(phase);
    if (templateArtifacts) {
      phases[phase] = {
        artifacts: templateArtifacts.map(a => ({ ...a, semantics_config: a.semantics_config || null })),
      };
    }
  }
  return { phases };
}

// --- Internal helpers ---

function inferWriteAuthority(agentId) {
  const id = agentId.toLowerCase();
  if (id.includes('pm') || id.includes('product') || id.includes('manager')) return 'review_only';
  if (id.includes('qa') || id.includes('test') || id.includes('quality')) return 'review_only';
  if (id.includes('ux') || id.includes('design') || id.includes('reviewer')) return 'review_only';
  if (id.includes('director') || id.includes('lead') || id.includes('architect')) return 'review_only';
  return 'authoritative';
}

function inferRuntimeClass(agentId) {
  // In legacy mode, all agents are effectively manual (user pastes prompts)
  return 'manual';
}

function buildLegacyRouting(agentIds) {
  // Legacy doesn't have formal routing — build a simple pass-through
  return {
    default: {
      sequence: agentIds,
      exit_gate: null,
    },
  };
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
