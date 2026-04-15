function normalizeSingleLine(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > 0 ? normalized : null;
}

export function buildRunOutcomeSummary(entry) {
  const status = typeof entry?.status === 'string' ? entry.status : 'unknown';
  const nextAction = normalizeSingleLine(
    entry?.retrospective?.next_operator_action
    || entry?.retrospective?.follow_on_hint
    || null,
  );

  if (status === 'blocked' && nextAction) {
    return { label: 'operator', status, next_action: nextAction };
  }
  if (status === 'blocked') {
    return { label: 'blocked', status, next_action: null };
  }
  if (status === 'completed' && nextAction) {
    return { label: 'follow-on', status, next_action: nextAction };
  }
  if (status === 'completed') {
    return { label: 'clean', status, next_action: null };
  }
  return { label: 'unknown', status, next_action: nextAction };
}

export function buildRunDiffSummary(diff) {
  if (!diff?.changed) {
    return {
      outcome: 'unchanged',
      risk_level: 'none',
      highlights: [],
      changed_field_count: 0,
    };
  }

  const regressionSignals = [];
  const improvementSignals = [];
  const changeSignals = [];

  const statusChange = diff.scalar_changes?.status;
  if (statusChange?.changed) {
    const leftRank = getRunStatusRank(statusChange.left);
    const rightRank = getRunStatusRank(statusChange.right);
    if (rightRank < leftRank) {
      regressionSignals.push(`status worsened to ${statusChange.right}`);
    } else if (rightRank > leftRank) {
      improvementSignals.push(`status improved to ${statusChange.right}`);
    } else {
      changeSignals.push(`status changed to ${statusChange.right}`);
    }
  }

  const blockedReason = diff.scalar_changes?.blocked_reason;
  if (blockedReason?.changed && blockedReason.right) {
    regressionSignals.push(`blocked reason: ${blockedReason.right}`);
  }

  const nextAction = diff.scalar_changes?.next_action;
  if (nextAction?.changed) {
    if (nextAction.right) {
      changeSignals.push(`next action: ${nextAction.right}`);
    } else {
      improvementSignals.push('operator follow-up cleared');
    }
  }

  for (const gateChange of diff.gate_changes || []) {
    if (!gateChange.changed) continue;
    if (isBlockingGateState(gateChange.right) && !isBlockingGateState(gateChange.left)) {
      regressionSignals.push(`gate ${gateChange.gate_id} is ${gateChange.right}`);
    } else if (isPassingGateState(gateChange.right) && isBlockingGateState(gateChange.left)) {
      improvementSignals.push(`gate ${gateChange.gate_id} recovered to ${gateChange.right}`);
    } else {
      changeSignals.push(`gate ${gateChange.gate_id}: ${gateChange.left ?? '—'} -> ${gateChange.right ?? '—'}`);
    }
  }

  const phases = diff.list_changes?.phases_completed;
  if (phases?.changed) {
    if (phases.added.length > 0) {
      changeSignals.push(`phases added: ${phases.added.join(', ')}`);
    }
    if (phases.removed.length > 0) {
      regressionSignals.push(`phases removed: ${phases.removed.join(', ')}`);
    }
  }

  const roles = diff.list_changes?.roles_used;
  if (roles?.changed) {
    if (roles.added.length > 0) {
      changeSignals.push(`roles added: ${roles.added.join(', ')}`);
    }
    if (roles.removed.length > 0) {
      changeSignals.push(`roles removed: ${roles.removed.join(', ')}`);
    }
  }

  const cost = diff.numeric_changes?.total_cost_usd;
  if (cost?.changed) {
    changeSignals.push(`cost ${formatSignedNumber(cost.delta, 4, '$')}`);
  }

  const duration = diff.numeric_changes?.duration_ms;
  if (duration?.changed) {
    changeSignals.push(`duration ${formatDurationDelta(duration.delta)}`);
  }

  let outcome = 'changed';
  let riskLevel = 'low';
  if (regressionSignals.length > 0 && improvementSignals.length > 0) {
    outcome = 'mixed';
    riskLevel = regressionSignals.some((signal) => signal.startsWith('status worsened') || signal.startsWith('gate '))
      ? 'high'
      : 'medium';
  } else if (regressionSignals.length > 0) {
    outcome = 'regressed';
    riskLevel = regressionSignals.some((signal) => signal.startsWith('status worsened') || signal.startsWith('gate '))
      ? 'high'
      : 'medium';
  } else if (improvementSignals.length > 0) {
    outcome = 'improved';
    riskLevel = changeSignals.length > 0 ? 'low' : 'none';
  }

  return {
    outcome,
    risk_level: riskLevel,
    highlights: [...regressionSignals, ...improvementSignals, ...changeSignals].slice(0, 3),
    changed_field_count: countChangedFields(diff),
  };
}

export function buildExportDiffSummary(diff) {
  if (!diff?.changed) {
    return {
      outcome: 'unchanged',
      risk_level: 'none',
      highlights: [],
      changed_field_count: 0,
    };
  }

  const regressions = Array.isArray(diff.regressions) ? diff.regressions : [];
  const highlights = [];

  if (regressions.length > 0) {
    for (const reg of regressions.slice(0, 3)) {
      highlights.push(`${reg.id}: ${reg.message}`);
    }
    return {
      outcome: 'regressed',
      risk_level: regressions.some((reg) => reg.severity === 'error') ? 'high' : 'medium',
      highlights,
      changed_field_count: countChangedFields(diff),
    };
  }

  pushFirstChangeHighlights(diff, highlights);

  return {
    outcome: 'changed',
    risk_level: 'low',
    highlights: highlights.slice(0, 3),
    changed_field_count: countChangedFields(diff),
  };
}

function pushFirstChangeHighlights(diff, highlights) {
  const scalarChanges = Object.values(diff.scalar_changes || {}).filter((entry) => entry.changed);
  for (const entry of scalarChanges) {
    if (highlights.length >= 3) return;
    highlights.push(`${entry.label}: ${entry.left ?? '—'} -> ${entry.right ?? '—'}`);
  }

  const numericChanges = Object.values(diff.numeric_changes || {}).filter((entry) => entry.changed);
  for (const entry of numericChanges) {
    if (highlights.length >= 3) return;
    highlights.push(`${entry.label}: ${entry.left ?? '—'} -> ${entry.right ?? '—'}`);
  }

  const listChanges = Object.values(diff.list_changes || {}).filter((entry) => entry.changed);
  for (const entry of listChanges) {
    if (highlights.length >= 3) return;
    if (entry.added?.length > 0) {
      highlights.push(`${entry.label} added: ${entry.added.join(', ')}`);
    } else if (entry.removed?.length > 0) {
      highlights.push(`${entry.label} removed: ${entry.removed.join(', ')}`);
    }
  }
}

function countChangedFields(diff) {
  const scalar = Object.values(diff.scalar_changes || {}).filter((entry) => entry.changed).length;
  const numeric = Object.values(diff.numeric_changes || {}).filter((entry) => entry.changed).length;
  const lists = Object.values(diff.list_changes || {}).filter((entry) => entry.changed).length;
  const gates = Array.isArray(diff.gate_changes)
    ? diff.gate_changes.filter((entry) => entry.changed).length
    : 0;
  const repoStatuses = Array.isArray(diff.repo_status_changes)
    ? diff.repo_status_changes.filter((entry) => entry.changed).length
    : 0;
  const repoExports = Array.isArray(diff.repo_export_changes)
    ? diff.repo_export_changes.filter((entry) => entry.changed).length
    : 0;
  const eventTypes = Array.isArray(diff.event_type_changes)
    ? diff.event_type_changes.filter((entry) => entry.changed).length
    : 0;
  return scalar + numeric + lists + gates + repoStatuses + repoExports + eventTypes;
}

function getRunStatusRank(status) {
  if (status === 'completed') return 3;
  if (status === 'blocked') return 2;
  if (status === 'failed') return 1;
  return 0;
}

function isBlockingGateState(value) {
  return value === 'failed' || value === 'blocked' || value === 'pending';
}

function isPassingGateState(value) {
  return value === 'passed' || value === 'approved';
}

function formatSignedNumber(value, digits, prefix = '') {
  if (typeof value !== 'number' || Number.isNaN(value) || value === 0) return 'unchanged';
  const sign = value > 0 ? '+' : '';
  return `${sign}${prefix}${Math.abs(value).toFixed(digits)}`;
}

function formatDurationDelta(ms) {
  if (typeof ms !== 'number' || Number.isNaN(ms) || ms === 0) return 'unchanged';
  const sign = ms > 0 ? '+' : '-';
  const absolute = Math.abs(ms);
  if (absolute < 1000) return `${sign}${absolute}ms`;
  const secs = Math.floor(absolute / 1000);
  if (secs < 60) return `${sign}${secs}s`;
  const mins = Math.floor(secs / 60);
  const remainSecs = secs % 60;
  if (mins < 60) return `${sign}${mins}m ${remainSecs}s`;
  const hrs = Math.floor(mins / 60);
  const remainMins = mins % 60;
  return `${sign}${hrs}h ${remainMins}m`;
}
