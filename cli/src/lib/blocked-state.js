import {
  deriveConflictLoopRecoveryAction,
  deriveDispatchRecoveryAction,
  deriveEscalationRecoveryAction,
  deriveHookTamperRecoveryAction,
  deriveNeedsHumanRecoveryAction,
  derivePolicyEscalationDetail,
  derivePolicyEscalationRecoveryAction,
  getActiveTurnCount,
} from './governed-state.js';
import { getEffectiveGateArtifacts } from './gate-evaluator.js';
import { getRoleRuntimeCapabilityContract } from './runtime-capabilities.js';

const RUNTIME_GUIDANCE_PRIORITY = new Map([
  ['invalid_binding', 1],
  ['review_only_remote_dead_end', 2],
  ['proposal_apply_required', 3],
  ['tool_defined_proof_not_strong_enough', 4],
]);

function isLegacyEscalationRecoveryAction(action) {
  return action === 'Resolve the escalation, then run agentxchain step --resume'
    || action === 'Resolve the escalation, then run agentxchain step';
}

function isLegacyNeedsHumanRecoveryAction(action) {
  return action === 'Resolve the stated issue, then run agentxchain step --resume';
}

function isLegacyHookTamperRecoveryAction(action) {
  return action === 'Disable or fix the hook, verify protected files, then run agentxchain step --resume';
}

function isLegacyConflictLoopRecoveryAction(action) {
  return typeof action === 'string' && action.startsWith('Serialize the conflicting work, then run agentxchain step --resume');
}

function maybeRefreshRecoveryAction(state, config, persistedRecovery, turnRetained) {
  if (!config || !persistedRecovery || typeof persistedRecovery !== 'object') {
    return null;
  }

  const typedReason = persistedRecovery.typed_reason;
  const currentAction = persistedRecovery.recovery_action || null;
  const turnId = state?.blocked_reason?.turn_id ?? state?.escalation?.from_turn_id ?? null;
  if (typedReason === 'retries_exhausted' || ((typedReason === 'operator_escalation') && isLegacyEscalationRecoveryAction(currentAction))) {
    return deriveEscalationRecoveryAction(state, config, {
      turnRetained,
      turnId,
    });
  }

  if (typedReason === 'needs_human' && isLegacyNeedsHumanRecoveryAction(currentAction)) {
    return deriveNeedsHumanRecoveryAction(state, config, {
      turnRetained,
      turnId,
    });
  }

  if (typedReason === 'hook_tamper' && isLegacyHookTamperRecoveryAction(currentAction)) {
    return deriveHookTamperRecoveryAction(state, config, {
      turnRetained,
      turnId,
    });
  }

  if (typedReason === 'policy_escalation') {
    return derivePolicyEscalationRecoveryAction(state, config, {
      turnRetained,
      turnId,
    });
  }

  if (typedReason === 'conflict_loop' && isLegacyConflictLoopRecoveryAction(currentAction)) {
    return deriveConflictLoopRecoveryAction(turnId);
  }

  return null;
}

export function deriveRuntimeBlockedGuidance(state, config) {
  if (!state || !config || typeof state !== 'object' || typeof config !== 'object') {
    return [];
  }

  const failure = state.last_gate_failure;
  if (!failure || typeof failure !== 'object') {
    return [];
  }

  const phase = typeof failure.phase === 'string' && failure.phase
    ? failure.phase
    : state.phase;
  const gateId = typeof failure.gate_id === 'string' && failure.gate_id
    ? failure.gate_id
    : config.routing?.[phase]?.exit_gate || null;
  const missingFiles = Array.isArray(failure.missing_files)
    ? failure.missing_files.filter((path) => typeof path === 'string' && path.length > 0)
    : [];

  if (!phase || !gateId || missingFiles.length === 0 || !config.gates?.[gateId]) {
    return [];
  }

  const requiredArtifacts = getEffectiveGateArtifacts(config, config.gates[gateId], phase)
    .filter((artifact) => artifact?.required !== false)
    .filter((artifact) => missingFiles.includes(artifact.path));

  if (requiredArtifacts.length === 0) {
    return [];
  }

  const entryRole = config.routing?.[phase]?.entry_role || null;
  const guidance = [];

  for (const artifact of requiredArtifacts) {
    const roleId = artifact.owned_by || entryRole;
    if (!roleId) continue;

    const role = config.roles?.[roleId];
    if (!role) continue;

    const runtimeId = role.runtime_id || role.runtime;
    const runtime = config.runtimes?.[runtimeId];
    if (!runtime) continue;

    const contract = getRoleRuntimeCapabilityContract(roleId, role, runtime);
    const invalidBinding = contract.effective_write_path.startsWith('invalid_')
      || contract.workflow_artifact_ownership === 'invalid';

    let code = null;
    let command = null;
    let reason = null;

    if (invalidBinding) {
      code = 'invalid_binding';
      command = `Edit agentxchain.json for role "${roleId}", then run agentxchain validate`;
      reason = `Artifact "${artifact.path}" is owned by "${roleId}", but ${role.write_authority}/${runtime.type} resolves to ${contract.effective_write_path}.`;
    } else if (contract.workflow_artifact_ownership === 'no') {
      code = 'review_only_remote_dead_end';
      command = `Edit agentxchain.json for role "${roleId}", then run agentxchain validate`;
      reason = `Artifact "${artifact.path}" is owned by "${roleId}", but ${role.write_authority}/${runtime.type} can only return review artifacts and cannot satisfy workflow ownership.`;
    } else if (contract.workflow_artifact_ownership === 'proposal_apply_required') {
      const turnId = failure.requested_by_turn || state.last_completed_turn_id || null;
      code = 'proposal_apply_required';
      command = turnId ? `agentxchain proposal apply ${turnId}` : 'agentxchain proposal list';
      reason = `Artifact "${artifact.path}" is owned by "${roleId}", and ${role.write_authority}/${runtime.type} stages required files behind proposal apply.`;
    } else if (contract.workflow_artifact_ownership === 'tool_defined') {
      code = 'tool_defined_proof_not_strong_enough';
      command = `agentxchain role show ${roleId}`;
      reason = `Artifact "${artifact.path}" is owned by "${roleId}", but ${runtime.type} leaves the file-write contract tool-defined and not statically provable.`;
    }

    if (!code) continue;
    guidance.push({
      code,
      phase,
      gate_id: gateId,
      role_id: roleId,
      artifact_path: artifact.path,
      command,
      reason,
    });
  }

  const seen = new Set();
  return guidance
    .sort((left, right) => {
      const priority = (RUNTIME_GUIDANCE_PRIORITY.get(left.code) || 99)
        - (RUNTIME_GUIDANCE_PRIORITY.get(right.code) || 99);
      if (priority !== 0) return priority;
      const commandCmp = left.command.localeCompare(right.command, 'en');
      if (commandCmp !== 0) return commandCmp;
      return left.artifact_path.localeCompare(right.artifact_path, 'en');
    })
    .filter((entry) => {
      const key = `${entry.code}|${entry.role_id}|${entry.command}|${entry.artifact_path}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function deriveGovernedRunNextActions(state, config = null) {
  const recovery = deriveRecoveryDescriptor(state, config);
  const runtimeGuidance = recovery?.runtime_guidance || deriveRuntimeBlockedGuidance(state, config);
  const nextActions = [];
  const seen = new Set();

  const pushAction = (command, reason) => {
    if (typeof command !== 'string' || !command.trim() || typeof reason !== 'string' || !reason.trim()) {
      return;
    }
    const key = `${command}|${reason}`;
    if (seen.has(key)) return;
    seen.add(key);
    nextActions.push({ command, reason });
  };

  for (const entry of runtimeGuidance) {
    pushAction(entry.command, entry.reason);
  }

  if (recovery?.recovery_action) {
    const reason = runtimeGuidance.length > 0
      ? `After resolving the ${runtimeGuidance[0].code} blocker, continue the run.`
      : `Run is blocked: ${recovery.typed_reason}.`;
    pushAction(recovery.recovery_action, reason);
  }

  return nextActions;
}

export function deriveRecoveryDescriptor(state, config = null) {
  if (!state || typeof state !== 'object') {
    return null;
  }

  if (state.pending_run_completion) {
    return {
      typed_reason: 'pending_run_completion',
      owner: 'human',
      recovery_action: 'agentxchain approve-completion',
      turn_retained: false,
      detail: state.pending_run_completion.gate || null,
    };
  }

  if (state.pending_phase_transition) {
    return {
      typed_reason: 'pending_phase_transition',
      owner: 'human',
      recovery_action: 'agentxchain approve-transition',
      turn_retained: false,
      detail: state.pending_phase_transition.gate || null,
    };
  }

  const turnRetained = getActiveTurnCount(state) > 0;

  const persistedRecovery = state.blocked_reason?.recovery;
  if (persistedRecovery && typeof persistedRecovery === 'object') {
    const refreshedRecoveryAction = maybeRefreshRecoveryAction(state, config, persistedRecovery, turnRetained);
    const runtimeGuidance = deriveRuntimeBlockedGuidance(state, config);
    return {
      typed_reason: persistedRecovery.typed_reason || 'unknown_block',
      owner: persistedRecovery.owner || 'human',
      recovery_action: refreshedRecoveryAction
        || persistedRecovery.recovery_action
        || 'Inspect state.json and resolve manually before rerunning agentxchain step',
      turn_retained: typeof persistedRecovery.turn_retained === 'boolean'
        ? persistedRecovery.turn_retained
        : turnRetained,
      detail: persistedRecovery.detail ?? state.blocked_on ?? null,
      runtime_guidance: runtimeGuidance,
    };
  }

  if (typeof state.blocked_on !== 'string' || !state.blocked_on.trim()) {
    return null;
  }

  if (state.blocked_on.startsWith('human:')) {
    return {
      typed_reason: 'needs_human',
      owner: 'human',
      recovery_action: deriveNeedsHumanRecoveryAction(state, config, {
        turnRetained,
        turnId: state.blocked_reason?.turn_id ?? null,
      }),
      turn_retained: turnRetained,
      detail: state.blocked_on.slice('human:'.length) || null,
      runtime_guidance: deriveRuntimeBlockedGuidance(state, config),
    };
  }

  if (state.blocked_on.startsWith('human_approval:')) {
    return {
      typed_reason: 'pending_phase_transition',
      owner: 'human',
      recovery_action: 'agentxchain approve-transition',
      turn_retained: false,
      detail: state.blocked_on.slice('human_approval:'.length) || null,
    };
  }

  if (state.blocked_on.startsWith('escalation:')) {
    const isOperatorEscalation = state.blocked_on.startsWith('escalation:operator:') || state.escalation?.source === 'operator';
    const recoveryAction = deriveEscalationRecoveryAction(state, config, {
      turnRetained,
      turnId: state.blocked_reason?.turn_id ?? state.escalation?.from_turn_id ?? null,
    });
    return {
      typed_reason: isOperatorEscalation ? 'operator_escalation' : 'retries_exhausted',
      owner: 'human',
      recovery_action: recoveryAction,
      turn_retained: turnRetained,
      detail: state.escalation?.detail || state.escalation?.reason || state.blocked_on,
      runtime_guidance: deriveRuntimeBlockedGuidance(state, config),
    };
  }

  if (state.blocked_on.startsWith('dispatch:')) {
    return {
      typed_reason: 'dispatch_error',
      owner: 'human',
      recovery_action: deriveDispatchRecoveryAction(state, config, {
        turnRetained,
        turnId: state.blocked_reason?.turn_id ?? null,
      }),
      turn_retained: turnRetained,
      detail: state.blocked_on.slice('dispatch:'.length) || state.blocked_on,
      runtime_guidance: deriveRuntimeBlockedGuidance(state, config),
    };
  }

  if (state.blocked_on.startsWith('policy:')) {
    const policyId = state.blocked_on.slice('policy:'.length).trim() || null;
    return {
      typed_reason: 'policy_escalation',
      owner: 'human',
      recovery_action: derivePolicyEscalationRecoveryAction(state, config, {
        turnRetained,
        turnId: state.blocked_reason?.turn_id ?? null,
        policyId,
      }),
      turn_retained: turnRetained,
      detail: derivePolicyEscalationDetail(state, { policyId }),
      runtime_guidance: deriveRuntimeBlockedGuidance(state, config),
    };
  }

  if (state.blocked_on.startsWith('timeout:')) {
    const scope = state.blocked_on.slice('timeout:'.length).trim() || 'unknown';
    return {
      typed_reason: 'timeout',
      owner: 'operator',
      recovery_action: 'agentxchain resume',
      turn_retained: false,
      detail: `${scope} timeout exceeded`,
      runtime_guidance: deriveRuntimeBlockedGuidance(state, config),
    };
  }

  return {
    typed_reason: 'unknown_block',
    owner: 'human',
    recovery_action: 'Inspect state.json and resolve manually before rerunning agentxchain step',
    turn_retained: turnRetained,
    detail: state.blocked_on,
    runtime_guidance: deriveRuntimeBlockedGuidance(state, config),
  };
}
