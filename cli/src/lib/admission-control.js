/**
 * Admission Control — pre-run static analysis that rejects governed configs
 * which cannot possibly reach completion.
 *
 * Pure function: no filesystem access, no state reads.
 *
 * Checks:
 *   ADM-001  No file producer for gated phase
 *   ADM-002  Authoritative writer unreachable for owned artifacts
 *   ADM-003  Impossible human approval topology (warning only)
 *   ADM-004  Owned artifact owner cannot write
 *
 * See .planning/ADMISSION_CONTROL_SPEC.md for full spec.
 */

import { getEffectiveGateArtifacts } from './gate-evaluator.js';

/**
 * Run all admission control checks against a governed config.
 *
 * @param {object} config - normalized governed config
 * @param {object} rawConfig - raw agentxchain.json (for workflow_kit, gates, approval_policy)
 * @returns {{ ok: boolean, errors: string[], warnings: string[] }}
 */
export function runAdmissionControl(config, rawConfig) {
  const errors = [];
  const warnings = [];

  const routing = config?.routing;
  const gates = config?.gates || rawConfig?.gates;
  const roles = config?.roles;
  const runtimes = config?.runtimes || rawConfig?.runtimes;

  if (!routing) {
    return { ok: true, errors, warnings };
  }

  // ADM-001 + ADM-002 + ADM-004: per-phase gate analysis
  if (gates) {
    for (const [phase, route] of Object.entries(routing)) {
      const exitGateId = route?.exit_gate;
      if (!exitGateId || !gates[exitGateId]) continue;

      const gateDef = gates[exitGateId];
      const effectiveArtifacts = getEffectiveGateArtifacts(config, gateDef, phase);
      const requiredArtifacts = effectiveArtifacts.filter(a => a.required);

      if (requiredArtifacts.length === 0) continue;

      // Collect all roles routed to this phase
      const candidateRoleIds = [
        route?.entry_role,
        ...(Array.isArray(route?.allowed_next_roles) ? route.allowed_next_roles : []),
      ].filter(Boolean);

      const uniqueRoleIds = [...new Set(candidateRoleIds)];

      // ADM-001: check if any role can produce files
      // Manual runtime roles are excluded — human operators can produce files
      // outside the governed turn mechanism regardless of write_authority.
      // Note: normalized config uses runtime_id, raw config uses runtime.
      const rolesWithAuthority = uniqueRoleIds
        .map(id => {
          const role = roles?.[id];
          const rtKey = role?.runtime_id || role?.runtime;
          return { id, role, runtime: runtimes?.[rtKey] };
        })
        .filter(({ role }) => role);

      const hasFileProducer = rolesWithAuthority.some(({ role, runtime }) =>
        canRoleProduceFiles(role, runtime));

      // Only flag non-manual roles as review_only dead-ends
      const nonManualRoles = rolesWithAuthority.filter(({ runtime }) => runtime?.type !== 'manual');
      if (!hasFileProducer && nonManualRoles.length > 0) {
        const roleSummary = nonManualRoles
          .map(({ id, role }) => `${id}:${role.write_authority}`)
          .join(', ');
        const fileSummary = requiredArtifacts.map(a => a.path).join(', ');
        errors.push(
          `ADM-001: Phase "${phase}" gate "${exitGateId}" requires files (${fileSummary}) but all routed roles are review_only (${roleSummary}). No agent can produce the required artifacts.`
        );
      }

      // ADM-002: check owned_by roles are reachable in this phase
      for (const artifact of requiredArtifacts) {
        if (!artifact.owned_by) continue;
        if (!uniqueRoleIds.includes(artifact.owned_by)) {
          errors.push(
            `ADM-002: Phase "${phase}" artifact "${artifact.path}" is owned_by "${artifact.owned_by}" but that role is not in the phase routing (entry_role or allowed_next_roles). The ownership predicate can never be satisfied.`
          );
          continue;
        }

        const ownerRole = roles?.[artifact.owned_by];
        if (!ownerRole) continue;
        const ownerRuntimeKey = ownerRole.runtime_id || ownerRole.runtime;
        const ownerRuntime = runtimes?.[ownerRuntimeKey];

        if (!canRoleProduceFiles(ownerRole, ownerRuntime)) {
          errors.push(
            `ADM-004: Phase "${phase}" artifact "${artifact.path}" is owned_by "${artifact.owned_by}" but that role is ${ownerRole.write_authority} on runtime type "${ownerRuntime?.type || 'unknown'}". The owner can participate in the phase but cannot produce the required artifact.`
          );
        }
      }
    }
  }

  // ADM-003: impossible human approval topology
  checkHumanApprovalTopology(config, rawConfig, routing, gates, roles, runtimes, warnings);

  return {
    ok: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * ADM-003: Check whether human approval requirements are reachable.
 * Emits warnings (not errors) because external approval paths are legitimate.
 */
function checkHumanApprovalTopology(config, rawConfig, routing, gates, roles, runtimes, warnings) {
  // Determine if any manual runtime exists
  const hasManualRuntime = runtimes
    ? Object.values(runtimes).some(rt => rt?.type === 'manual')
    : false;

  // If there's a manual runtime, human approval is always reachable
  if (hasManualRuntime) return;

  const approvalPolicy = config?.approval_policy || rawConfig?.approval_policy;

  // Collect phases/gates that require human approval
  const humanApprovalPoints = [];

  for (const [phase, route] of Object.entries(routing)) {
    const exitGateId = route?.exit_gate;
    if (!exitGateId || !gates?.[exitGateId]) continue;

    const gateDef = gates[exitGateId];
    if (gateDef.requires_human_approval) {
      // Check if approval_policy overrides to auto_approve for this transition
      if (!isAutoApprovedByPolicy(approvalPolicy, 'phase_transitions', phase)) {
        humanApprovalPoints.push({ type: 'phase_transition', phase, gate: exitGateId });
      }
    }
  }

  // Check run_completion gates
  const completionGateId = config?.completion_gate || rawConfig?.completion_gate;
  if (completionGateId && gates?.[completionGateId]) {
    const gateDef = gates[completionGateId];
    if (gateDef.requires_human_approval) {
      if (!isAutoApprovedByPolicy(approvalPolicy, 'run_completion', null)) {
        humanApprovalPoints.push({ type: 'run_completion', gate: completionGateId });
      }
    }
  }

  // Also check approval_policy for explicit require_human actions
  if (approvalPolicy?.phase_transitions) {
    const pt = approvalPolicy.phase_transitions;
    if (pt.default === 'require_human') {
      // Every phase transition defaults to human approval
      for (const phase of Object.keys(routing)) {
        const hasAutoOverride = (pt.rules || []).some(rule =>
          rule.action === 'auto_approve' && matchesPhaseRule(rule, phase));
        if (!hasAutoOverride) {
          const already = humanApprovalPoints.some(p => p.type === 'phase_transition' && p.phase === phase);
          if (!already) {
            humanApprovalPoints.push({ type: 'phase_transition', phase, gate: routing[phase]?.exit_gate || '(policy)' });
          }
        }
      }
    }
    if (Array.isArray(pt.rules)) {
      for (const rule of pt.rules) {
        if (rule.action === 'require_human' && rule.from_phase) {
          const already = humanApprovalPoints.some(p => p.type === 'phase_transition' && p.phase === rule.from_phase);
          if (!already) {
            humanApprovalPoints.push({ type: 'phase_transition', phase: rule.from_phase, gate: '(policy)' });
          }
        }
      }
    }
  }

  if (approvalPolicy?.run_completion?.action === 'require_human') {
    const already = humanApprovalPoints.some(p => p.type === 'run_completion');
    if (!already) {
      humanApprovalPoints.push({ type: 'run_completion', gate: '(policy)' });
    }
  }

  for (const point of humanApprovalPoints) {
    if (point.type === 'phase_transition') {
      warnings.push(
        `ADM-003: Phase "${point.phase}" requires human approval (gate "${point.gate}") but no role uses runtime type "manual". The run will pause at pending_phase_transition and require external approval (CLI, dashboard, or webhook).`
      );
    } else {
      warnings.push(
        `ADM-003: Run completion requires human approval (gate "${point.gate}") but no role uses runtime type "manual". The run will pause at pending_run_completion and require external approval.`
      );
    }
  }
}

function isAutoApprovedByPolicy(approvalPolicy, section, phase) {
  if (!approvalPolicy) return false;

  if (section === 'phase_transitions') {
    const pt = approvalPolicy.phase_transitions;
    if (!pt) return false;

    // Check specific rules first
    if (Array.isArray(pt.rules)) {
      for (const rule of pt.rules) {
        if (rule.action === 'auto_approve' && matchesPhaseRule(rule, phase)) {
          return true;
        }
      }
    }

    // Fall back to default
    return pt.default === 'auto_approve';
  }

  if (section === 'run_completion') {
    return approvalPolicy.run_completion?.action === 'auto_approve';
  }

  return false;
}

function matchesPhaseRule(rule, phase) {
  // A rule matches if from_phase is unset or matches the phase
  if (rule.from_phase && rule.from_phase !== phase) return false;
  return true;
}

function canRoleProduceFiles(role, runtime) {
  if (!role) return false;
  return runtime?.type === 'manual'
    || role.write_authority === 'authoritative'
    || role.write_authority === 'proposed';
}
