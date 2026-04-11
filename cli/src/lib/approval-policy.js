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

function evaluateRunCompletionPolicy({ gateResult, state, config, policy }) {
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
