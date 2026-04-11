/**
 * Policy evaluator — declarative governance rules for turn acceptance.
 *
 * Policies are config-driven rules that evaluate on every turn acceptance.
 * Gates evaluate at phase boundaries. Hooks run external commands.
 * Policies evaluate built-in governance rules on every accepted turn.
 *
 * Pure functions only — no I/O, no side effects.
 */

/**
 * Registry of built-in rule evaluators.
 * Each evaluator: (params, context) → { triggered: boolean, message: string }
 */
const RULE_EVALUATORS = {
  max_turns_per_phase: (params, ctx) => {
    const count = ctx.history.filter(
      (entry) => entry.phase === ctx.currentPhase,
    ).length;
    if (count >= params.limit) {
      return {
        triggered: true,
        message: `phase "${ctx.currentPhase}" has reached ${count}/${params.limit} accepted turns`,
      };
    }
    return { triggered: false, message: '' };
  },

  max_total_turns: (params, ctx) => {
    const count = ctx.history.length;
    if (count >= params.limit) {
      return {
        triggered: true,
        message: `run has reached ${count}/${params.limit} total accepted turns`,
      };
    }
    return { triggered: false, message: '' };
  },

  max_consecutive_same_role: (params, ctx) => {
    const role = ctx.turnRole;
    let consecutive = 0;
    for (let i = ctx.history.length - 1; i >= 0; i--) {
      if (ctx.history[i].role === role) {
        consecutive++;
      } else {
        break;
      }
    }
    // The current turn (not yet in history) adds one more
    consecutive += 1;
    if (consecutive > params.limit) {
      return {
        triggered: true,
        message: `role "${role}" has ${consecutive} consecutive turns (limit: ${params.limit})`,
      };
    }
    return { triggered: false, message: '' };
  },

  max_cost_per_turn: (params, ctx) => {
    const cost = ctx.turnCostUsd;
    if (cost != null && cost > params.limit_usd) {
      return {
        triggered: true,
        message: `turn cost $${cost.toFixed(2)} exceeds limit $${params.limit_usd.toFixed(2)}`,
      };
    }
    return { triggered: false, message: '' };
  },

  require_status: (params, ctx) => {
    if (!params.allowed.includes(ctx.turnStatus)) {
      return {
        triggered: true,
        message: `status "${ctx.turnStatus}" is not in allowed set [${params.allowed.join(', ')}]`,
      };
    }
    return { triggered: false, message: '' };
  },
};

export const VALID_POLICY_RULES = Object.keys(RULE_EVALUATORS);
export const VALID_POLICY_ACTIONS = ['block', 'warn', 'escalate'];
export const VALID_POLICY_TURN_STATUSES = [
  'completed',
  'blocked',
  'needs_human',
  'failed',
];
const VALID_ID_PATTERN = /^[a-z][a-z0-9_-]*$/;

/**
 * Validate a single policy definition at config load time.
 * Returns an array of error strings (empty if valid).
 */
export function validatePolicy(policy, index) {
  const errors = [];
  const prefix = `policies[${index}]`;

  if (!policy || typeof policy !== 'object') {
    return [`${prefix}: must be an object`];
  }

  if (typeof policy.id !== 'string' || !VALID_ID_PATTERN.test(policy.id)) {
    errors.push(`${prefix}: id must be a lowercase kebab-case string`);
  }

  if (!VALID_POLICY_RULES.includes(policy.rule)) {
    errors.push(
      `${prefix}: unknown rule "${policy.rule}"; valid rules: ${VALID_POLICY_RULES.join(', ')}`,
    );
  }

  if (!VALID_POLICY_ACTIONS.includes(policy.action)) {
    errors.push(
      `${prefix}: action must be one of ${VALID_POLICY_ACTIONS.join(', ')}`,
    );
  }

  // Rule-specific param validation
  if (VALID_POLICY_RULES.includes(policy.rule)) {
    const paramErrors = validatePolicyParams(policy.rule, policy.params, prefix);
    errors.push(...paramErrors);
  }

  // Scope validation (optional)
  if (policy.scope != null) {
    if (typeof policy.scope !== 'object') {
      errors.push(`${prefix}: scope must be an object`);
    } else {
      if (policy.scope.phases != null && !Array.isArray(policy.scope.phases)) {
        errors.push(`${prefix}: scope.phases must be an array`);
      }
      if (policy.scope.roles != null && !Array.isArray(policy.scope.roles)) {
        errors.push(`${prefix}: scope.roles must be an array`);
      }
    }
  }

  return errors;
}

function validatePolicyParams(rule, params, prefix) {
  const errors = [];

  switch (rule) {
    case 'max_turns_per_phase':
    case 'max_total_turns':
      if (!params || typeof params.limit !== 'number' || params.limit < 1) {
        errors.push(`${prefix}: params.limit must be a number >= 1`);
      }
      break;

    case 'max_consecutive_same_role':
      if (!params || typeof params.limit !== 'number' || params.limit < 1) {
        errors.push(`${prefix}: params.limit must be a number >= 1`);
      }
      break;

    case 'max_cost_per_turn':
      if (
        !params ||
        typeof params.limit_usd !== 'number' ||
        params.limit_usd <= 0
      ) {
        errors.push(`${prefix}: params.limit_usd must be a number > 0`);
      }
      break;

    case 'require_status':
      if (
        !params ||
        !Array.isArray(params.allowed) ||
        params.allowed.length === 0
      ) {
        errors.push(`${prefix}: params.allowed must be a non-empty array`);
      } else {
        for (const status of params.allowed) {
          if (!VALID_POLICY_TURN_STATUSES.includes(status)) {
            errors.push(
              `${prefix}: params.allowed contains invalid status "${status}"; valid statuses: ${VALID_POLICY_TURN_STATUSES.join(', ')}`,
            );
          }
        }
      }
      break;
  }

  return errors;
}

/**
 * Validate the full policies array at config load time.
 * Returns { ok: boolean, errors: string[] }.
 */
export function validatePolicies(policies) {
  if (policies == null) {
    return { ok: true, errors: [] };
  }

  if (!Array.isArray(policies)) {
    return { ok: false, errors: ['policies must be an array'] };
  }

  const errors = [];
  const ids = new Set();

  for (let i = 0; i < policies.length; i++) {
    const policyErrors = validatePolicy(policies[i], i);
    errors.push(...policyErrors);

    if (policies[i]?.id) {
      if (ids.has(policies[i].id)) {
        errors.push(`policies[${i}]: duplicate id "${policies[i].id}"`);
      }
      ids.add(policies[i].id);
    }
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Evaluate all policies against the current turn context.
 *
 * @param {Array} policies - normalized policies from config
 * @param {object} context
 * @param {string} context.currentPhase
 * @param {string} context.turnRole - role of the turn being accepted
 * @param {string} context.turnStatus - status from turn result
 * @param {number|null} context.turnCostUsd - cost from turn result
 * @param {Array} context.history - accepted history entries
 * @returns {PolicyEvaluationResult}
 *
 * @typedef {object} PolicyEvaluationResult
 * @property {boolean} ok - true if no block/escalate violations
 * @property {PolicyViolation[]} violations - all triggered policies
 * @property {PolicyViolation[]} blocks - violations with action "block"
 * @property {PolicyViolation[]} escalations - violations with action "escalate"
 * @property {PolicyViolation[]} warnings - violations with action "warn"
 *
 * @typedef {object} PolicyViolation
 * @property {string} policy_id
 * @property {string} rule
 * @property {string} action
 * @property {string} message
 */
export function evaluatePolicies(policies, context) {
  const result = {
    ok: true,
    violations: [],
    blocks: [],
    escalations: [],
    warnings: [],
  };

  if (!Array.isArray(policies) || policies.length === 0) {
    return result;
  }

  for (const policy of policies) {
    // Scope check: skip if out of scope
    if (policy.scope) {
      if (
        Array.isArray(policy.scope.phases) &&
        policy.scope.phases.length > 0 &&
        !policy.scope.phases.includes(context.currentPhase)
      ) {
        continue;
      }
      if (
        Array.isArray(policy.scope.roles) &&
        policy.scope.roles.length > 0 &&
        !policy.scope.roles.includes(context.turnRole)
      ) {
        continue;
      }
    }

    const evaluator = RULE_EVALUATORS[policy.rule];
    if (!evaluator) {
      continue; // Unknown rules caught at config validation
    }

    const evaluation = evaluator(policy.params || {}, context);
    if (!evaluation.triggered) {
      continue;
    }

    const violation = {
      policy_id: policy.id,
      rule: policy.rule,
      action: policy.action,
      message:
        policy.message ||
        `Policy "${policy.id}": ${evaluation.message}`,
    };

    result.violations.push(violation);

    switch (policy.action) {
      case 'block':
        result.blocks.push(violation);
        break;
      case 'escalate':
        result.escalations.push(violation);
        break;
      case 'warn':
        result.warnings.push(violation);
        break;
    }
  }

  result.ok = result.blocks.length === 0 && result.escalations.length === 0;
  return result;
}

/**
 * Normalize policies config: null/undefined → [], validate, return.
 */
export function normalizePolicies(raw) {
  if (raw == null) {
    return [];
  }
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw;
}
