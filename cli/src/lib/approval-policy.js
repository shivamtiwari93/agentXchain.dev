/**
 * Approval Policy evaluator — pure library for conditional auto-approval.
 *
 * Sits between the gate evaluator and the state machine. When a gate returns
 * 'awaiting_human_approval', this module evaluates the configured approval_policy
 * to determine whether the gate should auto-approve or pause for human approval.
 *
 * Invariants:
 *   - Only evaluates when gateResult.action === 'awaiting_human_approval'
 *   - Can only relax the human-approval requirement, never override gate failures
 *   - --auto-approve on run overrides this entirely (handled in run.js)
 *   - Absent approval_policy → always require_human (backwards compatible)
 */

/**
 * Evaluate approval policy for a gate result.
 *
 * @param {object} params
 * @param {object} params.gateResult - from evaluatePhaseExit or evaluateRunCompletion
 * @param {'phase_transition'|'run_completion'} params.gateType
 * @param {object} params.state - current run state
 * @param {object} params.config - normalized config
 * @returns {{ action: 'auto_approve'|'require_human', matched_rule: object|null, reason: string }}
 */
export function evaluateApprovalPolicy({ gateResult, gateType, state, config }) {
  const policy = config?.approval_policy;

  // No policy configured → always require human
  if (!policy) {
    return { action: 'require_human', matched_rule: null, reason: 'no approval_policy configured' };
  }

  if (gateType === 'run_completion') {
    return evaluateRunCompletionPolicy({ gateResult, state, config, policy });
  }

  return evaluatePhaseTransitionPolicy({ gateResult, state, config, policy });
}

// BUG-59 (DEC-BUG59-CREDENTIALED-GATE-HARD-STOP-001): gate definitions may
// carry `credentialed: true` to mark gates protecting external, irreversible,
// or operator-owned credentialed actions. Credentialed gates are never
// auto-approvable by policy, even under a catch-all `default: auto_approve`
// rule. The guard runs before any rule evaluation so a missing `when` block
// cannot bypass it.
function isCredentialedGate(config, gateId) {
  if (!gateId) return false;
  return config?.gates?.[gateId]?.credentialed === true;
}

function evaluateRunCompletionPolicy({ gateResult, state, config, policy }) {
  if (isCredentialedGate(config, gateResult?.gate_id)) {
    return {
      action: 'require_human',
      matched_rule: null,
      reason: 'credentialed gate — policy auto-approval forbidden',
    };
  }

  const rc = policy.run_completion;
  if (!rc || !rc.action) {
    return { action: 'require_human', matched_rule: null, reason: 'no run_completion policy' };
  }

  if (rc.action === 'require_human') {
    return { action: 'require_human', matched_rule: rc, reason: 'run_completion policy requires human approval' };
  }

  // action === 'auto_approve' — check conditions
  if (rc.when) {
    const conditionResult = checkConditions(rc.when, { gateResult, state, config });
    if (!conditionResult.ok) {
      return { action: 'require_human', matched_rule: rc, reason: conditionResult.reason };
    }
  }

  return { action: 'auto_approve', matched_rule: rc, reason: 'run_completion policy auto-approved' };
}

function evaluatePhaseTransitionPolicy({ gateResult, state, config, policy }) {
  if (isCredentialedGate(config, gateResult?.gate_id)) {
    return {
      action: 'require_human',
      matched_rule: null,
      reason: 'credentialed gate — policy auto-approval forbidden',
    };
  }

  const pt = policy.phase_transitions;
  if (!pt) {
    return { action: 'require_human', matched_rule: null, reason: 'no phase_transitions policy' };
  }

  const fromPhase = state.phase;
  const toPhase = gateResult.next_phase;

  // Check rules (first match wins)
  if (Array.isArray(pt.rules)) {
    for (const rule of pt.rules) {
      if (ruleMatches(rule, fromPhase, toPhase)) {
        if (rule.action === 'require_human') {
          return { action: 'require_human', matched_rule: rule, reason: `rule matched: ${fromPhase} → ${toPhase} requires human` };
        }
        // action === 'auto_approve' — check conditions
        if (rule.when) {
          const conditionResult = checkConditions(rule.when, { gateResult, state, config });
          if (!conditionResult.ok) {
            return { action: 'require_human', matched_rule: rule, reason: conditionResult.reason };
          }
        }
        return { action: 'auto_approve', matched_rule: rule, reason: `rule matched: ${fromPhase} → ${toPhase} auto-approved` };
      }
    }
  }

  // No rule matched → use default
  const defaultAction = pt.default || 'require_human';
  return { action: defaultAction, matched_rule: null, reason: `default: ${defaultAction}` };
}

function ruleMatches(rule, fromPhase, toPhase) {
  if (rule.from_phase && rule.from_phase !== fromPhase) return false;
  if (rule.to_phase && rule.to_phase !== toPhase) return false;
  return true;
}

/**
 * Check when conditions. Returns { ok, reason }.
 */
function checkConditions(when, { gateResult, state, config }) {
  // gate_passed: gate structural predicates must have passed
  if (when.gate_passed === true && !gateResult.passed) {
    return { ok: false, reason: 'condition gate_passed not met: gate did not pass structural predicates' };
  }

  // roles_participated: specified roles must have accepted turns in the current phase
  if (Array.isArray(when.roles_participated) && when.roles_participated.length > 0) {
    const phase = state.phase;
    const history = Array.isArray(state.history) ? state.history : [];
    for (const roleId of when.roles_participated) {
      const participated = history.some(
        turn => turn.phase === phase && turn.role === roleId,
      );
      if (!participated) {
        return { ok: false, reason: `condition roles_participated not met: role "${roleId}" has no accepted turn in phase "${phase}"` };
      }
    }
  }

  // credentialed_gate (BUG-59, DEC-BUG59-CREDENTIALED-GATE-PREDICATE-NEGATIVE-ONLY-001):
  // only `false` is a valid runtime value — asserts the gate is NOT credentialed
  // as a defensive precondition. Credentialed gates are hard-stopped upstream so
  // this predicate never sees them when value is `false` (matches → condition ok).
  // Value `true` is treated as unmet because the hard-stop prevents credentialed
  // gates from reaching condition evaluation anyway; schema validation (slice 2)
  // will reject `true` at config load time for unambiguous intent.
  if (Object.prototype.hasOwnProperty.call(when, 'credentialed_gate')) {
    const gateIsCredentialed = config?.gates?.[gateResult?.gate_id]?.credentialed === true;
    if (when.credentialed_gate === false && gateIsCredentialed) {
      return { ok: false, reason: 'condition credentialed_gate: false not met — gate is credentialed' };
    }
    if (when.credentialed_gate === true) {
      return { ok: false, reason: 'condition credentialed_gate: true not supported — credentialed gates are hard-stopped upstream' };
    }
  }

  // all_phases_visited: every routing phase must appear in history
  if (when.all_phases_visited === true) {
    const routingPhases = Object.keys(config.routing || {});
    const visitedPhases = new Set(
      (Array.isArray(state.history) ? state.history : []).map(t => t.phase),
    );
    // Also include current phase
    visitedPhases.add(state.phase);
    for (const phase of routingPhases) {
      if (!visitedPhases.has(phase)) {
        return { ok: false, reason: `condition all_phases_visited not met: phase "${phase}" never visited` };
      }
    }
  }

  return { ok: true, reason: 'all conditions met' };
}
