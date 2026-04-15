import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

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
  const repo_status_changes = buildMapChanges('Repo status', left.repo_run_statuses, right.repo_run_statuses);
  const repo_export_changes = buildBooleanMapChanges('Repo export ok', left.repo_export_status, right.repo_export_status);
  const event_type_changes = buildNumericMapChanges('Event type', left.event_type_counts, right.event_type_counts);

  const changed = hasChanged(scalar_changes, numeric_changes, list_changes)
    || repo_status_changes.some((entry) => entry.changed)
    || repo_export_changes.some((entry) => entry.changed)
    || event_type_changes.some((entry) => entry.changed);

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
  };
}

function normalizeRunExport(artifact) {
  const summary = artifact.summary || {};
  const repoDecisions = summary.repo_decisions || {};
  return {
    export_kind: artifact.export_kind,
    run_id: summary.run_id || null,
    status: summary.status || null,
    phase: summary.phase || null,
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
  };
}

function normalizeCoordinatorExport(artifact) {
  const summary = artifact.summary || {};
  const aggregatedEvents = summary.aggregated_events || {};
  const repoRunStatuses = summary.repo_run_statuses || {};
  const repos = artifact.repos || {};

  return {
    export_kind: artifact.export_kind,
    super_run_id: summary.super_run_id || null,
    status: summary.status || null,
    phase: summary.phase || null,
    project_name: artifact.coordinator?.project_name || null,
    barrier_count: toNumber(summary.barrier_count),
    history_entries: toNumber(summary.history_entries),
    decision_entries: toNumber(summary.decision_entries),
    total_events: toNumber(aggregatedEvents.total_events),
    repo_ids: normalizeStringArray(Object.keys(repos)),
    repos_with_events: normalizeStringArray(aggregatedEvents.repos_with_events),
    repo_run_statuses: normalizeStringMap(repoRunStatuses),
    repo_export_status: normalizeBooleanMap(Object.fromEntries(
      Object.entries(repos).map(([repoId, repoEntry]) => [repoId, repoEntry?.ok === true]),
    )),
    event_type_counts: normalizeNumericMap(aggregatedEvents.event_type_counts),
  };
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

function toNumber(value) {
  return typeof value === 'number' ? value : null;
}

function isEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}
