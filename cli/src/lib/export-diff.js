import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { buildCoordinatorRepoStatusEntries } from './coordinator-repo-status-presentation.js';

const FAILED_STATUSES = new Set(['failed', 'error', 'crashed']);
const BLOCKED_OR_FAILED_STATUSES = new Set(['blocked', 'failed', 'error', 'crashed']);

const RUN_EXPORT_SCALAR_FIELDS = [
  ['run_id', 'Run ID'],
  ['status', 'Status'],
  ['phase', 'Phase'],
  ['project_name', 'Project'],
  ['project_goal', 'Goal'],
  ['provenance_trigger', 'Trigger'],
  ['dashboard_status', 'Dashboard'],
];

const RUN_EXPORT_NUMERIC_FIELDS = [
  ['history_entries', 'History entries'],
  ['decision_entries', 'Decision entries'],
  ['hook_audit_entries', 'Hook audit entries'],
  ['notification_audit_entries', 'Notification audit entries'],
  ['dispatch_artifact_files', 'Dispatch artifacts'],
  ['staging_artifact_files', 'Staging artifacts'],
  ['total_delegations_issued', 'Delegations'],
  ['active_repo_decision_count', 'Active repo decisions'],
  ['overridden_repo_decision_count', 'Overridden repo decisions'],
];

const COORDINATOR_EXPORT_SCALAR_FIELDS = [
  ['super_run_id', 'Super run ID'],
  ['status', 'Status'],
  ['phase', 'Phase'],
  ['project_name', 'Project'],
];

const COORDINATOR_EXPORT_NUMERIC_FIELDS = [
  ['barrier_count', 'Barriers'],
  ['history_entries', 'History entries'],
  ['decision_entries', 'Decision entries'],
  ['total_events', 'Aggregated events'],
];

export function resolveExportArtifact(ref) {
  const exportPath = resolve(ref);
  if (!existsSync(exportPath)) {
    return {
      ok: false,
      error: `Export file not found: ${exportPath}`,
    };
  }

  let artifact;
  try {
    artifact = JSON.parse(readFileSync(exportPath, 'utf8'));
  } catch (error) {
    return {
      ok: false,
      error: `Failed to parse export file ${exportPath}: ${error.message}`,
    };
  }

  if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) {
    return {
      ok: false,
      error: `Export file ${exportPath} must contain a JSON object.`,
    };
  }

  if (typeof artifact.export_kind !== 'string' || !artifact.export_kind.trim()) {
    return {
      ok: false,
      error: `Export file ${exportPath} is missing export_kind.`,
    };
  }

  return {
    ok: true,
    artifact,
    resolved_ref: exportPath,
  };
}

export function buildExportDiff(leftArtifact, rightArtifact, refs = {}) {
  if (leftArtifact.export_kind !== rightArtifact.export_kind) {
    return {
      ok: false,
      error: `Export kinds do not match: ${leftArtifact.export_kind} vs ${rightArtifact.export_kind}`,
    };
  }

  if (leftArtifact.export_kind === 'agentxchain_run_export') {
    return {
      ok: true,
      diff: buildRunExportDiff(leftArtifact, rightArtifact, refs),
    };
  }

  if (leftArtifact.export_kind === 'agentxchain_coordinator_export') {
    return {
      ok: true,
      diff: buildCoordinatorExportDiff(leftArtifact, rightArtifact, refs),
    };
  }

  return {
    ok: false,
    error: `Unsupported export kind for diff: ${leftArtifact.export_kind}`,
  };
}

function buildRunExportDiff(leftArtifact, rightArtifact, refs) {
  const left = normalizeRunExport(leftArtifact);
  const right = normalizeRunExport(rightArtifact);

  const scalar_changes = buildFieldChanges(left, right, RUN_EXPORT_SCALAR_FIELDS);
  const numeric_changes = buildNumericChanges(left, right, RUN_EXPORT_NUMERIC_FIELDS);
  const list_changes = {
    active_turn_ids: buildListChange('Active turns', left.active_turn_ids, right.active_turn_ids),
    retained_turn_ids: buildListChange('Retained turns', left.retained_turn_ids, right.retained_turn_ids),
    active_repo_decision_ids: buildListChange('Active repo decisions', left.active_repo_decision_ids, right.active_repo_decision_ids),
    overridden_repo_decision_ids: buildListChange('Overridden repo decisions', left.overridden_repo_decision_ids, right.overridden_repo_decision_ids),
  };

  const changed = hasChanged(scalar_changes, numeric_changes, list_changes);
  const regressions = detectRunRegressions(left, right);

  return {
    comparison_mode: 'export',
    subject_kind: 'run',
    export_kind: leftArtifact.export_kind,
    left_ref: refs.left_ref || null,
    right_ref: refs.right_ref || null,
    changed,
    left,
    right,
    scalar_changes,
    numeric_changes,
    list_changes,
    regressions,
    regression_count: regressions.length,
    has_regressions: regressions.length > 0,
  };
}

function buildCoordinatorExportDiff(leftArtifact, rightArtifact, refs) {
  const left = normalizeCoordinatorExport(leftArtifact);
  const right = normalizeCoordinatorExport(rightArtifact);

  const scalar_changes = buildFieldChanges(left, right, COORDINATOR_EXPORT_SCALAR_FIELDS);
  const numeric_changes = buildNumericChanges(left, right, COORDINATOR_EXPORT_NUMERIC_FIELDS);
  const list_changes = {
    repo_ids: buildListChange('Repos', left.repo_ids, right.repo_ids),
    repos_with_events: buildListChange('Repos with events', left.repos_with_events, right.repos_with_events),
  };
  const repo_status_changes = buildMapChanges('Repo status', left.repo_statuses, right.repo_statuses);
  const repo_export_changes = buildBooleanMapChanges('Repo export ok', left.repo_export_status, right.repo_export_status);
  const event_type_changes = buildNumericMapChanges('Event type', left.event_type_counts, right.event_type_counts);

  const changed = hasChanged(scalar_changes, numeric_changes, list_changes)
    || repo_status_changes.some((entry) => entry.changed)
    || repo_export_changes.some((entry) => entry.changed)
    || event_type_changes.some((entry) => entry.changed);
  const regressions = detectCoordinatorRegressions(left, right);

  return {
    comparison_mode: 'export',
    subject_kind: 'coordinator',
    export_kind: leftArtifact.export_kind,
    left_ref: refs.left_ref || null,
    right_ref: refs.right_ref || null,
    changed,
    left,
    right,
    scalar_changes,
    numeric_changes,
    list_changes,
    repo_status_changes,
    repo_export_changes,
    event_type_changes,
    regressions,
    regression_count: regressions.length,
    has_regressions: regressions.length > 0,
  };
}

function normalizeRunExport(artifact) {
  const summary = artifact.summary || {};
  const repoDecisions = summary.repo_decisions || {};
  const state = artifact.state || {};
  const budgetStatus = state.budget_status || {};
  const phaseGateStatus = state.phase_gate_status || {};
  return {
    export_kind: artifact.export_kind,
    run_id: summary.run_id || null,
    status: summary.status || null,
    phase: summary.phase || null,
    workflow_phase_order: Array.isArray(summary.workflow_phase_order) ? summary.workflow_phase_order : null,
    project_name: artifact.project?.name || null,
    project_goal: summary.project_goal || artifact.project?.goal || null,
    provenance_trigger: summary.provenance?.trigger || null,
    dashboard_status: summary.dashboard_session?.status || null,
    history_entries: toNumber(summary.history_entries),
    decision_entries: toNumber(summary.decision_entries),
    hook_audit_entries: toNumber(summary.hook_audit_entries),
    notification_audit_entries: toNumber(summary.notification_audit_entries),
    dispatch_artifact_files: toNumber(summary.dispatch_artifact_files),
    staging_artifact_files: toNumber(summary.staging_artifact_files),
    total_delegations_issued: toNumber(summary.delegation_summary?.total_delegations_issued),
    active_repo_decision_count: toNumber(repoDecisions.active_count),
    overridden_repo_decision_count: toNumber(repoDecisions.overridden_count),
    active_turn_ids: normalizeStringArray(summary.active_turn_ids),
    retained_turn_ids: normalizeStringArray(summary.retained_turn_ids),
    active_repo_decision_ids: normalizeStringArray((repoDecisions.active || []).map((entry) => entry?.id)),
    overridden_repo_decision_ids: normalizeStringArray((repoDecisions.overridden || []).map((entry) => entry?.id)),
    budget_warn_mode: budgetStatus.warn_mode === true,
    budget_exhausted: budgetStatus.exhausted === true,
    phase_gate_status: normalizeGateStatusMap(phaseGateStatus),
    delegation_missing_decisions: normalizeDelegationMissingMap(summary.delegation_summary),
  };
}

function normalizeCoordinatorExport(artifact) {
  const summary = artifact.summary || {};
  const aggregatedEvents = summary.aggregated_events || {};
  const repos = artifact.repos || {};
  const repoStatusEntries = buildCoordinatorExportRepoStatusEntries(artifact);

  return {
    export_kind: artifact.export_kind,
    super_run_id: summary.super_run_id || null,
    status: summary.status || null,
    phase: summary.phase || null,
    workflow_phase_order: Array.isArray(summary.workflow_phase_order) ? summary.workflow_phase_order : null,
    project_name: artifact.coordinator?.project_name || null,
    barrier_count: toNumber(summary.barrier_count),
    history_entries: toNumber(summary.history_entries),
    decision_entries: toNumber(summary.decision_entries),
    total_events: toNumber(aggregatedEvents.total_events),
    repo_ids: normalizeStringArray(repoStatusEntries.map((entry) => entry.repo_id)),
    repos_with_events: normalizeStringArray(aggregatedEvents.repos_with_events),
    repo_statuses: normalizeStringMap(Object.fromEntries(
      repoStatusEntries.map((entry) => [entry.repo_id, entry.status]),
    )),
    coordinator_repo_statuses: normalizeStringMap(Object.fromEntries(
      repoStatusEntries
        .filter((entry) => entry.coordinator_status != null)
        .map((entry) => [entry.repo_id, entry.coordinator_status]),
    )),
    repo_export_status: normalizeBooleanMap(Object.fromEntries(
      Object.entries(repos).map(([repoId, repoEntry]) => [repoId, repoEntry?.ok === true]),
    )),
    event_type_counts: normalizeNumericMap(aggregatedEvents.event_type_counts),
  };
}

function buildCoordinatorExportRepoStatusEntries(artifact) {
  const summaryRepoStatuses = artifact.summary?.repo_run_statuses || {};
  const coordinatorRepoRuns = Object.fromEntries(
    Object.entries(summaryRepoStatuses).map(([repoId, status]) => [repoId, { status: status || null }]),
  );
  const repoSnapshots = Object.entries(artifact.repos || {}).map(([repoId, repoEntry]) => ({
    repo_id: repoId,
    ok: repoEntry?.ok === true,
    status: repoEntry?.ok ? (repoEntry.export?.summary?.status ?? null) : null,
    run_id: repoEntry?.ok ? (repoEntry.export?.summary?.run_id ?? null) : null,
    phase: repoEntry?.ok ? (repoEntry.export?.summary?.phase ?? null) : null,
  }));

  return buildCoordinatorRepoStatusEntries({
    config: artifact.config,
    coordinatorRepoRuns,
    repoSnapshots,
  });
}

function buildFieldChanges(left, right, fields) {
  return Object.fromEntries(
    fields.map(([field, label]) => [field, {
      label,
      left: left[field],
      right: right[field],
      changed: !isEqual(left[field], right[field]),
    }]),
  );
}

function buildNumericChanges(left, right, fields) {
  return Object.fromEntries(
    fields.map(([field, label]) => [field, {
      label,
      left: left[field],
      right: right[field],
      changed: !isEqual(left[field], right[field]),
      delta: typeof left[field] === 'number' && typeof right[field] === 'number'
        ? right[field] - left[field]
        : null,
    }]),
  );
}

function buildListChange(label, left, right) {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  return {
    label,
    left,
    right,
    added: right.filter((value) => !leftSet.has(value)),
    removed: left.filter((value) => !rightSet.has(value)),
    changed: left.length !== right.length || left.some((value, index) => value !== right[index]),
  };
}

function buildMapChanges(label, leftMap, rightMap) {
  const keys = normalizeStringArray([...Object.keys(leftMap), ...Object.keys(rightMap)]);
  return keys.map((key) => ({
    label,
    key,
    left: leftMap[key] ?? null,
    right: rightMap[key] ?? null,
    changed: !isEqual(leftMap[key] ?? null, rightMap[key] ?? null),
  }));
}

function buildBooleanMapChanges(label, leftMap, rightMap) {
  return buildMapChanges(label, leftMap, rightMap);
}

function buildNumericMapChanges(label, leftMap, rightMap) {
  const keys = normalizeStringArray([...Object.keys(leftMap), ...Object.keys(rightMap)]);
  return keys.map((key) => {
    const left = typeof leftMap[key] === 'number' ? leftMap[key] : null;
    const right = typeof rightMap[key] === 'number' ? rightMap[key] : null;
    return {
      label,
      key,
      left,
      right,
      changed: !isEqual(left, right),
      delta: typeof left === 'number' && typeof right === 'number' ? right - left : null,
    };
  });
}

function hasChanged(scalarChanges, numericChanges, listChanges) {
  return [
    ...Object.values(scalarChanges),
    ...Object.values(numericChanges),
  ].some((entry) => entry.changed)
    || Object.values(listChanges).some((entry) => entry.changed);
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .filter((item) => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim()))]
    .sort((a, b) => a.localeCompare(b, 'en'));
}

function normalizeStringMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => typeof key === 'string' && key.trim().length > 0)
      .map(([key, mapValue]) => [key.trim(), typeof mapValue === 'string' && mapValue.trim() ? mapValue.trim() : null]),
  );
}

function normalizeBooleanMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => typeof key === 'string' && key.trim().length > 0)
      .map(([key, mapValue]) => [key.trim(), mapValue === true]),
  );
}

function normalizeNumericMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key, mapValue]) => typeof key === 'string' && key.trim().length > 0 && typeof mapValue === 'number')
      .map(([key, mapValue]) => [key.trim(), mapValue]),
  );
}

function normalizeDelegationMissingMap(summary) {
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) return {};
  const chains = Array.isArray(summary.delegation_chains) ? summary.delegation_chains : [];
  const entries = [];
  for (const chain of chains) {
    const delegations = Array.isArray(chain?.delegations) ? chain.delegations : [];
    for (const delegation of delegations) {
      if (!delegation || typeof delegation !== 'object' || Array.isArray(delegation)) continue;
      const delegationId = typeof delegation.delegation_id === 'string' && delegation.delegation_id.trim()
        ? delegation.delegation_id.trim()
        : null;
      if (!delegationId) continue;
      entries.push([
        delegationId,
        normalizeStringArray(delegation.missing_decision_ids),
      ]);
    }
  }
  return Object.fromEntries(entries.sort(([left], [right]) => left.localeCompare(right, 'en')));
}

function toNumber(value) {
  return typeof value === 'number' ? value : null;
}

function isEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function normalizeGateStatusMap(gateStatus) {
  if (!gateStatus || typeof gateStatus !== 'object' || Array.isArray(gateStatus)) return {};
  return Object.fromEntries(
    Object.entries(gateStatus)
      .filter(([key]) => typeof key === 'string' && key.trim().length > 0)
      .map(([key, value]) => [key.trim(), typeof value === 'string' ? value.trim() : String(value)]),
  );
}

const GATE_PASSED_STATES = new Set(['passed', 'approved', 'satisfied']);
const GATE_FAILED_STATES = new Set(['failed', 'blocked', 'rejected']);

function detectRunRegressions(left, right) {
  const regressions = [];
  let counter = 0;

  // Status regression: successful/non-terminal -> blocked/failed/error/crashed
  if (left.status && right.status && !BLOCKED_OR_FAILED_STATUSES.has(left.status) && BLOCKED_OR_FAILED_STATUSES.has(right.status)) {
    regressions.push({
      id: `REG-STATUS-${String(++counter).padStart(3, '0')}`,
      category: 'status',
      severity: 'error',
      message: `Run status regressed from ${left.status} to ${right.status}`,
      field: 'status',
      left: left.status,
      right: right.status,
    });
  }

  const leftHasPhaseOrder = Array.isArray(left.workflow_phase_order) && left.workflow_phase_order.length > 0;
  const rightHasPhaseOrder = Array.isArray(right.workflow_phase_order) && right.workflow_phase_order.length > 0;
  const phaseOrderDrift = leftHasPhaseOrder && rightHasPhaseOrder && !isEqual(left.workflow_phase_order, right.workflow_phase_order);

  if (phaseOrderDrift) {
    regressions.push({
      id: `REG-PHASE-ORDER-${String(++counter).padStart(3, '0')}`,
      category: 'phase',
      severity: 'warning',
      message: 'Workflow phase order changed between exports; directional phase comparison skipped',
      field: 'workflow_phase_order',
      left: left.workflow_phase_order,
      right: right.workflow_phase_order,
    });
  }

  // Phase regression: backward movement in workflow phase order
  if (left.phase && right.phase === null) {
    // Phase disappeared — information loss
    regressions.push({
      id: `REG-PHASE-${String(++counter).padStart(3, '0')}`,
      category: 'phase',
      severity: 'warning',
      message: `Phase regressed from "${left.phase}" to null (phase information lost)`,
      field: 'phase',
      left: left.phase,
      right: null,
    });
  } else if (left.phase && right.phase && left.phase !== right.phase) {
    const canCompareDirection = leftHasPhaseOrder && rightHasPhaseOrder && !phaseOrderDrift;
    if (canCompareDirection) {
      const phaseOrder = right.workflow_phase_order;
      const leftIndex = phaseOrder.indexOf(left.phase);
      const rightIndex = phaseOrder.indexOf(right.phase);
      // Only flag when both phases are known and right is earlier than left
      if (leftIndex !== -1 && rightIndex !== -1 && rightIndex < leftIndex) {
        regressions.push({
          id: `REG-PHASE-${String(++counter).padStart(3, '0')}`,
          category: 'phase',
          severity: 'warning',
          message: `Phase moved backward from "${left.phase}" (position ${leftIndex}) to "${right.phase}" (position ${rightIndex})`,
          field: 'phase',
          left: left.phase,
          right: right.phase,
        });
      }
    }
  }

  // Budget warn_mode regression
  if (left.budget_warn_mode === false && right.budget_warn_mode === true) {
    regressions.push({
      id: `REG-BUDGET-WARN-${String(++counter).padStart(3, '0')}`,
      category: 'budget',
      severity: 'warning',
      message: 'Budget entered warn mode (over budget)',
      field: 'budget_warn_mode',
      left: false,
      right: true,
    });
  }

  // Budget exhausted regression
  if (left.budget_exhausted === false && right.budget_exhausted === true) {
    regressions.push({
      id: `REG-BUDGET-EXHAUST-${String(++counter).padStart(3, '0')}`,
      category: 'budget',
      severity: 'error',
      message: 'Budget exhausted',
      field: 'budget_exhausted',
      left: false,
      right: true,
    });
  }

  // Decision override count increase
  const leftOverrides = typeof left.overridden_repo_decision_count === 'number' ? left.overridden_repo_decision_count : 0;
  const rightOverrides = typeof right.overridden_repo_decision_count === 'number' ? right.overridden_repo_decision_count : 0;
  if (rightOverrides > leftOverrides) {
    regressions.push({
      id: `REG-DECISION-OVERRIDE-${String(++counter).padStart(3, '0')}`,
      category: 'decisions',
      severity: 'warning',
      message: `Repo decision overrides increased from ${leftOverrides} to ${rightOverrides}`,
      field: 'overridden_repo_decision_count',
      left: leftOverrides,
      right: rightOverrides,
    });
  }

  // Delegation contract regressions: newly missing required decisions.
  const allDelegationIds = new Set([
    ...Object.keys(left.delegation_missing_decisions || {}),
    ...Object.keys(right.delegation_missing_decisions || {}),
  ]);
  for (const delegationId of allDelegationIds) {
    const leftMissing = normalizeStringArray((left.delegation_missing_decisions || {})[delegationId]);
    const rightMissing = normalizeStringArray((right.delegation_missing_decisions || {})[delegationId]);
    const leftSet = new Set(leftMissing);
    const newlyMissing = rightMissing.filter((decisionId) => !leftSet.has(decisionId));
    if (newlyMissing.length > 0) {
      regressions.push({
        id: `REG-DELEGATION-MISSING-${String(++counter).padStart(3, '0')}`,
        category: 'delegation',
        severity: 'error',
        message: `Delegation "${delegationId}" is now missing required decisions: ${newlyMissing.join(', ')}`,
        field: `delegation_summary.${delegationId}.missing_decision_ids`,
        left: leftMissing,
        right: rightMissing,
      });
    }
  }

  // Gate regressions: passed/approved -> failed/blocked
  const allGateIds = new Set([...Object.keys(left.phase_gate_status || {}), ...Object.keys(right.phase_gate_status || {})]);
  for (const gateId of allGateIds) {
    const leftGate = (left.phase_gate_status || {})[gateId] || null;
    const rightGate = (right.phase_gate_status || {})[gateId] || null;
    if (leftGate && rightGate && GATE_PASSED_STATES.has(leftGate) && GATE_FAILED_STATES.has(rightGate)) {
      regressions.push({
        id: `REG-GATE-${String(++counter).padStart(3, '0')}`,
        category: 'gate',
        severity: 'error',
        message: `Gate "${gateId}" regressed from ${leftGate} to ${rightGate}`,
        field: `phase_gate_status.${gateId}`,
        left: leftGate,
        right: rightGate,
      });
    }
  }

  return regressions;
}

function detectCoordinatorRegressions(left, right) {
  // Start with the run-level regressions that apply to coordinator summaries
  const regressions = detectRunRegressions(left, right);
  let counter = regressions.length;
  const terminalComparison = left.status === 'completed' && right.status === 'completed';

  // Repo status regressions: child repo success/non-terminal -> blocked/failed
  if (!terminalComparison) {
    const allRepoIds = new Set([...Object.keys(left.repo_statuses || {}), ...Object.keys(right.repo_statuses || {})]);
    for (const repoId of allRepoIds) {
      const leftStatus = (left.repo_statuses || {})[repoId] || null;
      const rightStatus = (right.repo_statuses || {})[repoId] || null;
      if (leftStatus && rightStatus && !BLOCKED_OR_FAILED_STATUSES.has(leftStatus) && BLOCKED_OR_FAILED_STATUSES.has(rightStatus)) {
        regressions.push({
          id: `REG-REPO-STATUS-${String(++counter).padStart(3, '0')}`,
          category: 'repo_status',
          severity: 'error',
          message: `Child repo "${repoId}" status regressed from ${leftStatus} to ${rightStatus}`,
          field: `repo_statuses.${repoId}`,
          left: leftStatus,
          right: rightStatus,
        });
      }
    }

    // Repo export regressions: ok true -> false
    const allExportRepoIds = new Set([...Object.keys(left.repo_export_status || {}), ...Object.keys(right.repo_export_status || {})]);
    for (const repoId of allExportRepoIds) {
      const leftOk = (left.repo_export_status || {})[repoId];
      const rightOk = (right.repo_export_status || {})[repoId];
      if (leftOk === true && rightOk === false) {
        regressions.push({
          id: `REG-REPO-EXPORT-${String(++counter).padStart(3, '0')}`,
          category: 'repo_export',
          severity: 'error',
          message: `Child repo "${repoId}" export regressed from ok to failed`,
          field: `repo_export_status.${repoId}`,
          left: true,
          right: false,
        });
      }
    }
  }

  // Barrier count decrease
  const leftBarriers = typeof left.barrier_count === 'number' ? left.barrier_count : 0;
  const rightBarriers = typeof right.barrier_count === 'number' ? right.barrier_count : 0;
  if (leftBarriers > 0 && rightBarriers < leftBarriers) {
    regressions.push({
      id: `REG-BARRIER-${String(++counter).padStart(3, '0')}`,
      category: 'barrier',
      severity: 'warning',
      message: `Barrier count decreased from ${leftBarriers} to ${rightBarriers}`,
      field: 'barrier_count',
      left: leftBarriers,
      right: rightBarriers,
    });
  }

  // Event loss: total_events decreased
  const leftEvents = typeof left.total_events === 'number' ? left.total_events : 0;
  const rightEvents = typeof right.total_events === 'number' ? right.total_events : 0;
  if (leftEvents > 0 && rightEvents < leftEvents) {
    regressions.push({
      id: `REG-EVENT-LOSS-${String(++counter).padStart(3, '0')}`,
      category: 'events',
      severity: 'warning',
      message: `Aggregated event count decreased from ${leftEvents} to ${rightEvents}`,
      field: 'total_events',
      left: leftEvents,
      right: rightEvents,
    });
  }

  return regressions;
}
