import { pushDetail } from './coordinator-blocker-presentation.js';

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function pickString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value;
    }
  }
  return null;
}

function pickArray(...values) {
  for (const value of values) {
    if (Array.isArray(value) && value.length > 0) {
      return value.map((item) => String(item));
    }
  }
  return [];
}

export function getCoordinatorPendingGateSnapshot({ pendingGate = null, active = null } = {}) {
  const hasPendingGate = isObject(pendingGate);
  const hasActive = isObject(active);
  if (!hasPendingGate && !hasActive) {
    return null;
  }

  const gateType = pickString(pendingGate?.gate_type, active?.gate_type);
  const gateId = pickString(pendingGate?.gate, active?.gate_id);
  if (!gateType && !gateId) {
    return null;
  }

  return {
    gate_type: gateType,
    gate_id: gateId,
    current_phase: pickString(pendingGate?.from, active?.current_phase),
    target_phase: pickString(pendingGate?.to, active?.target_phase),
    required_repos: pickArray(pendingGate?.required_repos, active?.required_repos),
    human_barriers: pickArray(pendingGate?.human_barriers, active?.human_barriers),
    approval_state: 'Awaiting human approval',
  };
}

export function getCoordinatorPendingGateDetails({
  pendingGate = null,
  active = null,
  includeType = true,
  includeApprovalState = true,
  includeHumanBarriers = true,
} = {}) {
  const snapshot = getCoordinatorPendingGateSnapshot({ pendingGate, active });
  if (!snapshot) {
    return [];
  }

  const details = [];
  if (includeType) {
    pushDetail(details, 'Type', snapshot.gate_type);
  }
  pushDetail(details, 'Gate', snapshot.gate_id, { mono: true });
  pushDetail(details, 'Current Phase', snapshot.current_phase);
  pushDetail(details, 'Target Phase', snapshot.target_phase);
  if (snapshot.required_repos.length > 0) {
    pushDetail(details, 'Required Repos', snapshot.required_repos.join(', '));
  }
  if (includeApprovalState) {
    pushDetail(details, 'Approval State', snapshot.approval_state);
  }
  if (includeHumanBarriers && snapshot.human_barriers.length > 0) {
    pushDetail(details, 'Human Barriers', snapshot.human_barriers.join(', '));
  }

  return details;
}
