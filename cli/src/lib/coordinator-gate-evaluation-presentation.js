function formatList(values) {
  return values.join(', ');
}

export function buildCoordinatorGateEvaluationPresentation({
  gateType,
  evaluation,
  includeReady = false,
  includeBlockerCount = true,
} = {}) {
  const normalizedGateType = gateType === 'run_completion' ? 'run_completion' : 'phase_transition';
  const data = evaluation && typeof evaluation === 'object' ? evaluation : {};
  const blockers = Array.isArray(data.blockers) ? data.blockers : [];
  const details = [];

  if (typeof data.gate_id === 'string' && data.gate_id.length > 0) {
    details.push({ label: 'Gate', value: data.gate_id, mono: true });
  }

  if (typeof data.current_phase === 'string' && data.current_phase.length > 0) {
    details.push({ label: 'Current Phase', value: data.current_phase });
  }

  if (typeof data.target_phase === 'string' && data.target_phase.length > 0) {
    details.push({ label: 'Target Phase', value: data.target_phase });
  }

  if (Array.isArray(data.required_repos) && data.required_repos.length > 0) {
    details.push({ label: 'Required Repos', value: formatList(data.required_repos) });
  }

  if (Array.isArray(data.human_barriers) && data.human_barriers.length > 0) {
    details.push({ label: 'Human Barriers', value: formatList(data.human_barriers) });
  }

  if (normalizedGateType === 'run_completion' && typeof data.requires_human_approval === 'boolean') {
    details.push({
      label: 'Human Approval',
      value: data.requires_human_approval ? 'Required' : 'Not required',
    });
  }

  if (includeReady && typeof data.ready === 'boolean') {
    details.push({ label: 'Ready', value: data.ready ? 'Yes' : 'No' });
  }

  if (includeBlockerCount) {
    details.push({ label: 'Blockers', value: String(blockers.length) });
  }

  return {
    title: normalizedGateType === 'run_completion' ? 'Run Completion' : 'Phase Transition',
    statusLabel: data.ready ? 'ready' : 'not ready',
    details,
    blockers,
  };
}
