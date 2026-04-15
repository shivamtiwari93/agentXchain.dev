import { isInheritable, queryRunHistory } from './run-history.js';
import { getRunTriggerLabel } from './run-provenance.js';

const SCALAR_FIELDS = [
  ['status', 'Status'],
  ['trigger', 'Trigger'],
  ['template', 'Template'],
  ['connector_used', 'Connector'],
  ['model_used', 'Model'],
  ['blocked_reason', 'Blocked reason'],
  ['next_action', 'Next action'],
  ['headline', 'Headline'],
  ['inheritable', 'Inheritance snapshot'],
];

const NUMERIC_FIELDS = [
  ['total_turns', 'Turns'],
  ['decisions_count', 'Decisions'],
  ['total_cost_usd', 'Cost'],
  ['budget_limit_usd', 'Budget'],
  ['duration_ms', 'Duration'],
];

export function resolveRunHistoryReference(root, ref) {
  const entries = queryRunHistory(root, {});

  if (entries.length === 0) {
    return {
      ok: false,
      error: 'No run history found. Run at least one governed run first.',
    };
  }

  const exact = entries.find((entry) => entry.run_id === ref);
  if (exact) {
    return { ok: true, entry: exact, resolved_ref: exact.run_id, match_kind: 'exact' };
  }

  const prefixMatches = entries.filter((entry) => typeof entry.run_id === 'string' && entry.run_id.startsWith(ref));
  if (prefixMatches.length === 1) {
    return {
      ok: true,
      entry: prefixMatches[0],
      resolved_ref: prefixMatches[0].run_id,
      match_kind: 'prefix',
    };
  }

  if (prefixMatches.length > 1) {
    return {
      ok: false,
      error: `Run reference "${ref}" is ambiguous. Matches: ${prefixMatches.map((entry) => entry.run_id).join(', ')}`,
    };
  }

  return {
    ok: false,
    error: `Run ${ref} not found in run history.`,
  };
}

export function buildRunDiff(leftEntry, rightEntry) {
  const left = normalizeRunEntry(leftEntry);
  const right = normalizeRunEntry(rightEntry);

  const scalar_changes = Object.fromEntries(
    SCALAR_FIELDS.map(([field, label]) => {
      const leftValue = left[field];
      const rightValue = right[field];
      return [field, {
        label,
        left: leftValue,
        right: rightValue,
        changed: !isEqual(leftValue, rightValue),
      }];
    }),
  );

  const numeric_changes = Object.fromEntries(
    NUMERIC_FIELDS.map(([field, label]) => {
      const leftValue = left[field];
      const rightValue = right[field];
      return [field, {
        label,
        left: leftValue,
        right: rightValue,
        changed: !isEqual(leftValue, rightValue),
        delta: typeof leftValue === 'number' && typeof rightValue === 'number'
          ? rightValue - leftValue
          : null,
      }];
    }),
  );

  const list_changes = {
    phases_completed: buildListChange('Phases', left.phases_completed, right.phases_completed),
    roles_used: buildListChange('Roles', left.roles_used, right.roles_used),
  };

  const gate_changes = buildGateChanges(left.gate_results, right.gate_results);

  const changed = [
    ...Object.values(scalar_changes),
    ...Object.values(numeric_changes),
  ].some((entry) => entry.changed)
    || Object.values(list_changes).some((entry) => entry.changed)
    || gate_changes.some((entry) => entry.changed);

  return {
    changed,
    left,
    right,
    scalar_changes,
    numeric_changes,
    list_changes,
    gate_changes,
  };
}

function normalizeRunEntry(entry) {
  return {
    run_id: entry.run_id || null,
    status: entry.status || null,
    trigger: getRunTriggerLabel(entry.provenance),
    template: entry.template || null,
    connector_used: entry.connector_used || null,
    model_used: entry.model_used || null,
    blocked_reason: entry.blocked_reason || null,
    next_action: entry.retrospective?.next_operator_action
      || entry.retrospective?.follow_on_hint
      || null,
    headline: entry.retrospective?.headline || null,
    inheritable: isInheritable(entry),
    total_turns: typeof entry.total_turns === 'number' ? entry.total_turns : null,
    decisions_count: typeof entry.decisions_count === 'number' ? entry.decisions_count : null,
    total_cost_usd: typeof entry.total_cost_usd === 'number' ? entry.total_cost_usd : null,
    budget_limit_usd: typeof entry.budget_limit_usd === 'number' ? entry.budget_limit_usd : null,
    duration_ms: typeof entry.duration_ms === 'number' ? entry.duration_ms : null,
    phases_completed: normalizeStringArray(entry.phases_completed),
    roles_used: normalizeStringArray(entry.roles_used),
    gate_results: normalizeGateResults(entry.gate_results),
    recorded_at: entry.recorded_at || null,
  };
}

function buildListChange(label, left, right) {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  const added = right.filter((value) => !leftSet.has(value));
  const removed = left.filter((value) => !rightSet.has(value));
  return {
    label,
    left,
    right,
    added,
    removed,
    changed: added.length > 0 || removed.length > 0,
  };
}

function buildGateChanges(leftGateResults, rightGateResults) {
  const gateIds = [...new Set([
    ...Object.keys(leftGateResults),
    ...Object.keys(rightGateResults),
  ])].sort((a, b) => a.localeCompare(b, 'en'));

  return gateIds.map((gateId) => {
    const left = gateId in leftGateResults ? leftGateResults[gateId] : null;
    const right = gateId in rightGateResults ? rightGateResults[gateId] : null;
    return {
      gate_id: gateId,
      left,
      right,
      changed: !isEqual(left, right),
    };
  });
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .filter((item) => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim()))]
    .sort((a, b) => a.localeCompare(b, 'en'));
}

function normalizeGateResults(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(([gateId]) => typeof gateId === 'string' && gateId.trim().length > 0)
      .map(([gateId, result]) => [gateId.trim(), result ?? null]),
  );
}

function isEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}
