import { verifyExportArtifact } from './export-verifier.js';
import { buildDelegationSummary } from './export.js';
import { normalizeRunProvenance, summarizeRunProvenance } from './run-provenance.js';
import { deriveGovernedRunNextActions, deriveRuntimeBlockedGuidance } from './blocked-state.js';
import {
  buildRecentEventSummary,
  formatRecentEventSummaryLine,
} from './recent-event-summary.js';
import {
  deriveCoordinatorNextActions,
} from './coordinator-next-actions.js';
import { buildCoordinatorRepoStatusEntries } from './coordinator-repo-status-presentation.js';
import { summarizeCoordinatorEvent } from './coordinator-event-narrative.js';

export const GOVERNANCE_REPORT_VERSION = '0.1';

const VALID_DELEGATION_OUTCOMES = new Set(['completed', 'failed', 'mixed', 'pending']);
const VALID_DASHBOARD_SESSION_STATUSES = new Set(['running', 'pid_only', 'stale', 'not_running']);

function normalizeDelegationSummary(summary) {
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) return null;
  if (!Number.isInteger(summary.total_delegations_issued) || summary.total_delegations_issued < 0) return null;
  if (!Array.isArray(summary.delegation_chains)) return null;

  const chains = [];
  for (const chain of summary.delegation_chains) {
    if (!chain || typeof chain !== 'object' || Array.isArray(chain)) return null;
    if (typeof chain.parent_turn_id !== 'string' || chain.parent_turn_id.length === 0) return null;
    if (typeof chain.parent_role !== 'string' || chain.parent_role.length === 0) return null;
    if (!Array.isArray(chain.delegations)) return null;
    if (chain.review_turn_id !== null && (typeof chain.review_turn_id !== 'string' || chain.review_turn_id.length === 0)) return null;
    if (!VALID_DELEGATION_OUTCOMES.has(chain.outcome)) return null;

    const delegations = [];
    for (const delegation of chain.delegations) {
      if (!delegation || typeof delegation !== 'object' || Array.isArray(delegation)) return null;
      if (typeof delegation.delegation_id !== 'string' || delegation.delegation_id.length === 0) return null;
      if (typeof delegation.to_role !== 'string' || delegation.to_role.length === 0) return null;
      if (typeof delegation.charter !== 'string') return null;
      if (!['completed', 'failed', 'pending'].includes(delegation.status)) return null;
      if (delegation.child_turn_id !== null && (typeof delegation.child_turn_id !== 'string' || delegation.child_turn_id.length === 0)) return null;
      delegations.push({
        delegation_id: delegation.delegation_id,
        to_role: delegation.to_role,
        charter: delegation.charter,
        required_decision_ids: Array.isArray(delegation.required_decision_ids) ? delegation.required_decision_ids : [],
        satisfied_decision_ids: Array.isArray(delegation.satisfied_decision_ids) ? delegation.satisfied_decision_ids : [],
        missing_decision_ids: Array.isArray(delegation.missing_decision_ids) ? delegation.missing_decision_ids : [],
        status: delegation.status,
        child_turn_id: delegation.child_turn_id,
      });
    }

    chains.push({
      parent_turn_id: chain.parent_turn_id,
      parent_role: chain.parent_role,
      delegations,
      review_turn_id: chain.review_turn_id,
      outcome: chain.outcome,
    });
  }

  return {
    total_delegations_issued: summary.total_delegations_issued,
    delegation_chains: chains,
  };
}

function extractDelegationSummary(artifact) {
  const fromSummary = normalizeDelegationSummary(artifact.summary?.delegation_summary);
  if (fromSummary) return fromSummary;
  return normalizeDelegationSummary(buildDelegationSummary(artifact.files || {}));
}

function normalizeDashboardSessionSummary(summary) {
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) return null;
  if (!VALID_DASHBOARD_SESSION_STATUSES.has(summary.status)) return null;
  return {
    status: summary.status,
    pid: Number.isInteger(summary.pid) ? summary.pid : null,
    url: typeof summary.url === 'string' && summary.url.length > 0 ? summary.url : null,
    started_at: typeof summary.started_at === 'string' && summary.started_at.length > 0 ? summary.started_at : null,
  };
}

function extractDashboardSessionSummary(artifact) {
  return normalizeDashboardSessionSummary(artifact.summary?.dashboard_session);
}

function extractRunEventTimeline(artifact) {
  const data = extractFileData(artifact, '.agentxchain/events.jsonl');
  if (!Array.isArray(data)) return [];
  return data.filter((entry) => entry && typeof entry === 'object' && !Array.isArray(entry));
}

function formatRecentEventDetail(summary) {
  if (!summary?.latest_event) return 'No event recorded';
  const latest = summary.latest_event;
  return `${latest.summary || latest.event_type || 'unknown_event'} at ${latest.timestamp || 'unknown'}`;
}

function formatDashboardSessionLine(session) {
  if (!session) return null;
  switch (session.status) {
    case 'running':
      return `running at ${session.url || 'unknown url'} (PID: ${session.pid || '?'})`;
    case 'pid_only':
      return `pid_only (PID: ${session.pid || '?'}, session metadata missing)`;
    case 'stale':
      return `stale session files${session.pid ? ` (PID: ${session.pid})` : ''}${session.url ? ` at ${session.url}` : ''}`;
    case 'not_running':
      return 'not_running';
    default:
      return null;
  }
}

function yesNo(value) {
  return value ? 'yes' : 'no';
}

function summarizeBlockedOn(blockedOn) {
  if (!blockedOn) return 'none';
  if (typeof blockedOn === 'string') return blockedOn;
  if (typeof blockedOn !== 'object' || Array.isArray(blockedOn)) return 'present';
  if (typeof blockedOn.typed_reason === 'string' && blockedOn.typed_reason.length > 0) {
    return blockedOn.typed_reason;
  }
  if (typeof blockedOn.reason === 'string' && blockedOn.reason.length > 0) {
    return blockedOn.reason;
  }
  return 'present';
}

function renderGovernanceEventDetailText(lines, evt, indent) {
  switch (evt.type) {
    case 'policy_escalation':
      for (const v of evt.violations || []) {
        lines.push(`${indent}violation: ${v.policy_id || '?'} / ${v.rule || '?'} — ${v.message || 'n/a'}`);
      }
      break;
    case 'conflict_detected':
      if (evt.conflicting_files?.length > 0) {
        lines.push(`${indent}files: ${evt.conflicting_files.join(', ')}`);
      }
      if (evt.overlap_ratio != null) {
        lines.push(`${indent}overlap: ${(evt.overlap_ratio * 100).toFixed(0)}%`);
      }
      break;
    case 'conflict_rejected':
      if (evt.conflicting_files?.length > 0) {
        lines.push(`${indent}files: ${evt.conflicting_files.join(', ')}`);
      }
      break;
    case 'conflict_resolution_selected':
      if (evt.resolution_method) {
        lines.push(`${indent}resolution: ${evt.resolution_method}`);
      }
      break;
    case 'operator_escalated':
      if (evt.reason) lines.push(`${indent}reason: ${evt.reason}`);
      if (evt.blocked_on) lines.push(`${indent}blocked_on: ${evt.blocked_on}`);
      break;
    case 'escalation_resolved':
      if (evt.resolved_via) lines.push(`${indent}resolved via: ${evt.resolved_via}`);
      if (evt.previous_blocked_on) lines.push(`${indent}was blocked on: ${evt.previous_blocked_on}`);
      break;
  }
}

function renderGovernanceEventDetailMarkdown(lines, evt) {
  switch (evt.type) {
    case 'policy_escalation':
      for (const v of evt.violations || []) {
        lines.push(`  - Violation: \`${v.policy_id || '?'}\` / \`${v.rule || '?'}\` — ${v.message || 'n/a'}`);
      }
      break;
    case 'conflict_detected':
      if (evt.conflicting_files?.length > 0) {
        lines.push(`  - Files: ${evt.conflicting_files.map((f) => `\`${f}\``).join(', ')}`);
      }
      if (evt.overlap_ratio != null) {
        lines.push(`  - Overlap: ${(evt.overlap_ratio * 100).toFixed(0)}%`);
      }
      break;
    case 'conflict_rejected':
      if (evt.conflicting_files?.length > 0) {
        lines.push(`  - Files: ${evt.conflicting_files.map((f) => `\`${f}\``).join(', ')}`);
      }
      break;
    case 'conflict_resolution_selected':
      if (evt.resolution_method) lines.push(`  - Resolution: \`${evt.resolution_method}\``);
      break;
    case 'operator_escalated':
      if (evt.reason) lines.push(`  - Reason: ${evt.reason}`);
      if (evt.blocked_on) lines.push(`  - Blocked on: \`${evt.blocked_on}\``);
      break;
    case 'escalation_resolved':
      if (evt.resolved_via) lines.push(`  - Resolved via: \`${evt.resolved_via}\``);
      if (evt.previous_blocked_on) lines.push(`  - Was blocked on: \`${evt.previous_blocked_on}\``);
      break;
  }
}

function summarizeBlockedState(run) {
  const blockedReason = run?.blocked_reason;
  if (blockedReason && typeof blockedReason === 'object' && !Array.isArray(blockedReason)) {
    if (typeof blockedReason.recovery?.typed_reason === 'string' && blockedReason.recovery.typed_reason.length > 0) {
      return blockedReason.recovery.typed_reason;
    }
    if (typeof blockedReason.category === 'string' && blockedReason.category.length > 0) {
      return blockedReason.category;
    }
  }
  return summarizeBlockedOn(run?.blocked_on);
}

function normalizeBudgetStatus(budgetStatus) {
  if (!budgetStatus || typeof budgetStatus !== 'object' || Array.isArray(budgetStatus)) {
    return null;
  }

  const normalized = {};
  if (Number.isFinite(budgetStatus.spent_usd)) {
    normalized.spent_usd = budgetStatus.spent_usd;
  }
  if (Number.isFinite(budgetStatus.remaining_usd)) {
    normalized.remaining_usd = budgetStatus.remaining_usd;
  }
  // DEC-BUDGET-WARN-004: preserve warn-mode and exhaustion fields
  if (budgetStatus.warn_mode === true) {
    normalized.warn_mode = true;
  }
  if (budgetStatus.exhausted === true) {
    normalized.exhausted = true;
  }
  if (budgetStatus.exhausted_at) {
    normalized.exhausted_at = budgetStatus.exhausted_at;
  }
  if (budgetStatus.exhausted_after_turn) {
    normalized.exhausted_after_turn = budgetStatus.exhausted_after_turn;
  }

  return Object.keys(normalized).length > 0 ? normalized : null;
}

function formatUsd(value) {
  return typeof value === 'number' ? `$${value.toFixed(2)}` : 'n/a';
}

function formatDurationCompact(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return null;
  if (ms < 1000) return `${ms}ms`;
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remainSecs = secs % 60;
  if (mins < 60) return `${mins}m ${remainSecs}s`;
  const hrs = Math.floor(mins / 60);
  const remainMins = mins % 60;
  return `${hrs}h ${remainMins}m`;
}

function formatTokenCount(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'n/a';
  return value.toLocaleString('en-US');
}

function formatRepoDecisionAuthority(level, role, source) {
  if (typeof level !== 'number') return null;
  const roleLabel = role || 'unknown';
  if (source === 'human_default') return `${level} (${roleLabel}, human default)`;
  if (source === 'unknown_role') return `${level} (${roleLabel}, role missing from config)`;
  return `${level} (${roleLabel})`;
}

function buildRepoDecisionSummaryLines(summary) {
  if (!summary) return [];
  const operatorSummary = summary.operator_summary || {};
  const categories = Array.isArray(operatorSummary.active_categories) && operatorSummary.active_categories.length > 0
    ? operatorSummary.active_categories.join(', ')
    : 'none active';
  const authority = formatRepoDecisionAuthority(
    operatorSummary.highest_active_authority_level,
    operatorSummary.highest_active_authority_role,
    operatorSummary.highest_active_authority_source,
  ) || '—';
  const superseding = operatorSummary.superseding_active_count || 0;
  const overridden = operatorSummary.overridden_with_successor_count || 0;

  return [
    `Categories: ${categories}`,
    `Highest authority: ${authority}`,
    `Lineage: ${superseding} active superseding earlier decision${superseding === 1 ? '' : 's'} | ${overridden} overridden with recorded successor${overridden === 1 ? '' : 's'}`,
  ];
}

export function computeCostSummary(turns) {
  if (!Array.isArray(turns) || turns.length === 0) return null;

  let totalUsd = 0;
  let costedTurnCount = 0;
  let hasAnyTokens = false;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  const roleMap = new Map();
  const phaseMap = new Map();

  for (const t of turns) {
    const costUsd = typeof t.cost_usd === 'number' && Number.isFinite(t.cost_usd) ? t.cost_usd : 0;
    const hasFiniteCost = typeof t.cost_usd === 'number' && Number.isFinite(t.cost_usd);
    if (hasFiniteCost) {
      totalUsd += costUsd;
      costedTurnCount++;
    }

    const inTok = typeof t.input_tokens === 'number' && Number.isFinite(t.input_tokens) ? t.input_tokens : 0;
    const outTok = typeof t.output_tokens === 'number' && Number.isFinite(t.output_tokens) ? t.output_tokens : 0;
    if (t.input_tokens != null || t.output_tokens != null) hasAnyTokens = true;
    totalInputTokens += inTok;
    totalOutputTokens += outTok;

    // Aggregate by role
    const role = t.role || 'unknown';
    if (!roleMap.has(role)) roleMap.set(role, { role, usd: 0, turns: 0, input_tokens: 0, output_tokens: 0 });
    const roleEntry = roleMap.get(role);
    roleEntry.usd += costUsd;
    roleEntry.turns++;
    roleEntry.input_tokens += inTok;
    roleEntry.output_tokens += outTok;

    // Aggregate by phase
    const phase = t.phase || 'unknown';
    if (!phaseMap.has(phase)) phaseMap.set(phase, { phase, usd: 0, turns: 0 });
    const phaseEntry = phaseMap.get(phase);
    phaseEntry.usd += costUsd;
    phaseEntry.turns++;
  }

  const byRole = [...roleMap.values()].sort((a, b) => a.role.localeCompare(b.role, 'en'));
  const byPhase = [...phaseMap.values()].sort((a, b) => a.phase.localeCompare(b.phase, 'en'));

  return {
    total_usd: totalUsd,
    total_input_tokens: hasAnyTokens ? totalInputTokens : null,
    total_output_tokens: hasAnyTokens ? totalOutputTokens : null,
    turn_count: turns.length,
    costed_turn_count: costedTurnCount,
    by_role: byRole,
    by_phase: byPhase,
  };
}

function formatTurnTimelineTime(turn) {
  const acceptedAt = turn.accepted_at || 'n/a';
  const duration = formatDurationCompact(turn.duration_ms);
  return duration ? `${acceptedAt} (${duration})` : acceptedAt;
}

function formatStatusCounts(statusCounts) {
  const entries = Object.entries(statusCounts || {}).sort(([left], [right]) => left.localeCompare(right, 'en'));
  if (entries.length === 0) return 'none';
  return entries.map(([status, count]) => `${status}(${count})`).join(', ');
}

function extractFileData(artifact, relPath) {
  const entry = artifact.files?.[relPath];
  if (!entry) return null;
  return entry.data ?? null;
}

function extractHistoryTimeline(artifact) {
  const data = extractFileData(artifact, '.agentxchain/history.jsonl');
  if (!Array.isArray(data) || data.length === 0) return [];
  return data
    .filter((e) => typeof e?.turn_id === 'string' && typeof e?.role === 'string')
    .sort((a, b) => (a.accepted_sequence || 0) - (b.accepted_sequence || 0))
    .map((e) => ({
      turn_id: e.turn_id,
      role: e.role,
      status: e.status || 'unknown',
      summary: e.summary || '',
      phase: e.phase || null,
      phase_transition: e.phase_transition_request || null,
      files_changed_count: Array.isArray(e.files_changed) ? e.files_changed.length : 0,
      concurrent_with: Array.isArray(e.concurrent_with) && e.concurrent_with.length > 0 ? e.concurrent_with : undefined,
      sibling_attributed_files: Array.isArray(e.observed_artifact?.attributed_to_concurrent_siblings) && e.observed_artifact.attributed_to_concurrent_siblings.length > 0
        ? e.observed_artifact.attributed_to_concurrent_siblings
        : undefined,
      decisions: Array.isArray(e.decisions) ? e.decisions.map((d) => d?.id || d).filter(Boolean) : [],
      objections: Array.isArray(e.objections) ? e.objections.map((o) => o?.id || o).filter(Boolean) : [],
      cost_usd: typeof e.cost?.total_usd === 'number' ? e.cost.total_usd : null,
      input_tokens: typeof e.cost?.input_tokens === 'number' && Number.isFinite(e.cost.input_tokens) ? e.cost.input_tokens : null,
      output_tokens: typeof e.cost?.output_tokens === 'number' && Number.isFinite(e.cost.output_tokens) ? e.cost.output_tokens : null,
      started_at: e.started_at || null,
      duration_ms: typeof e.duration_ms === 'number' ? e.duration_ms : null,
      accepted_at: e.accepted_at || null,
    }));
}

function extractDecisionDigest(artifact) {
  const data = extractFileData(artifact, '.agentxchain/decision-ledger.jsonl');
  if (!Array.isArray(data) || data.length === 0) return [];
  return data
    .filter((d) => typeof d?.id === 'string')
    .map((d) => ({
      id: d.id,
      turn_id: d.turn_id || null,
      role: d.role || null,
      phase: d.phase || null,
      statement: d.statement || '',
    }));
}

function extractApprovalPolicyDigest(artifact) {
  const data = extractFileData(artifact, '.agentxchain/decision-ledger.jsonl');
  if (!Array.isArray(data) || data.length === 0) return [];
  return data
    .filter((d) => d?.type === 'approval_policy')
    .map((d) => ({
      gate_type: d.gate_type || null,
      action: d.action || null,
      matched_rule: d.matched_rule || null,
      from_phase: d.from_phase || null,
      to_phase: d.to_phase || null,
      reason: d.reason || '',
      gate_id: d.gate_id || null,
      timestamp: d.timestamp || null,
    }));
}

function extractGateFailureDigest(artifact) {
  const data = extractFileData(artifact, '.agentxchain/decision-ledger.jsonl');
  if (!Array.isArray(data) || data.length === 0) return [];
  return data
    .filter((d) => d?.type === 'gate_failure')
    .map((d) => ({
      gate_type: d.gate_type || null,
      gate_id: d.gate_id || null,
      phase: d.phase || null,
      from_phase: d.from_phase || null,
      to_phase: d.to_phase || null,
      requested_by_turn: d.requested_by_turn || null,
      failed_at: d.failed_at || null,
      queued_request: d.queued_request === true,
      reasons: Array.isArray(d.reasons) ? d.reasons : [],
      missing_files: Array.isArray(d.missing_files) ? d.missing_files : [],
      missing_verification: d.missing_verification === true,
    }));
}

const GOVERNANCE_EVENT_TYPES = new Set([
  'policy_escalation',
  'conflict_detected',
  'conflict_rejected',
  'conflict_resolution_selected',
  'operator_escalated',
  'escalation_resolved',
]);

function extractGovernanceEventDigest(artifact, relPath = '.agentxchain/decision-ledger.jsonl') {
  const data = extractFileData(artifact, relPath);
  if (!Array.isArray(data) || data.length === 0) return [];
  return data
    .filter((d) => typeof d?.decision === 'string' && GOVERNANCE_EVENT_TYPES.has(d.decision))
    .map((d) => {
      const base = {
        type: d.decision,
        timestamp: d.timestamp || null,
        turn_id: d.turn_id || null,
        role: d.role || null,
        phase: d.phase || null,
      };
      switch (d.decision) {
        case 'policy_escalation':
          base.violations = Array.isArray(d.violations) ? d.violations.map((v) => ({
            policy_id: v.policy_id || null,
            rule: v.rule || null,
            message: v.message || null,
          })) : [];
          break;
        case 'conflict_detected':
          base.conflicting_files = Array.isArray(d.conflict?.files) ? d.conflict.files : [];
          base.overlap_ratio = typeof d.conflict?.overlap_ratio === 'number' ? d.conflict.overlap_ratio : null;
          break;
        case 'conflict_rejected':
          base.conflicting_files = Array.isArray(d.conflict?.files) ? d.conflict.files : [];
          break;
        case 'conflict_resolution_selected':
          base.resolution_method = d.conflict?.resolution || null;
          break;
        case 'operator_escalated':
          base.blocked_on = d.blocked_on || null;
          base.reason = d.escalation?.reason || null;
          break;
        case 'escalation_resolved':
          base.resolved_via = d.resolved_via || null;
          base.previous_blocked_on = d.blocked_on || null;
          break;
      }
      return base;
    })
    .sort((a, b) => (a.timestamp || '').localeCompare(b.timestamp || ''));
}

function extractTimeoutEventDigest(artifact, relPath = '.agentxchain/decision-ledger.jsonl') {
  const data = extractFileData(artifact, relPath);
  if (!Array.isArray(data) || data.length === 0) return [];
  return data
    .filter((d) => typeof d?.type === 'string' && d.type.startsWith('timeout'))
    .map((d) => ({
      type: d.type,
      scope: d.scope || null,
      phase: d.phase || null,
      turn_id: d.turn_id || null,
      limit_minutes: typeof d.limit_minutes === 'number' ? d.limit_minutes : null,
      elapsed_minutes: typeof d.elapsed_minutes === 'number' ? d.elapsed_minutes : null,
      exceeded_by_minutes: typeof d.exceeded_by_minutes === 'number' ? d.exceeded_by_minutes : null,
      action: d.action || null,
      timestamp: d.timestamp || null,
    }));
}

function extractHookSummary(artifact) {
  const data = extractFileData(artifact, '.agentxchain/hook-audit.jsonl');
  if (!Array.isArray(data) || data.length === 0) return null;
  const events = {};
  let blocked = 0;
  for (const entry of data) {
    const event = entry?.event || 'unknown';
    events[event] = (events[event] || 0) + 1;
    if (entry?.blocked || entry?.result === 'blocked') blocked++;
  }
  return { total: data.length, blocked, events };
}

function computeTiming(artifact, turns) {
  const createdAt = artifact.state?.created_at || null;
  let completedAt = null;
  if (artifact.summary?.status === 'completed' && turns.length > 0) {
    completedAt = turns[turns.length - 1].accepted_at || null;
  }
  let durationSeconds = null;
  if (createdAt && completedAt) {
    const start = new Date(createdAt).getTime();
    const end = new Date(completedAt).getTime();
    if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
      durationSeconds = Math.round((end - start) / 1000);
    }
  }
  return { created_at: createdAt, completed_at: completedAt, duration_seconds: durationSeconds };
}

function isValidTimestamp(value) {
  if (typeof value !== 'string' || value.length === 0) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed);
}

function computeDurationSeconds(createdAt, completedAt) {
  if (!isValidTimestamp(createdAt) || !isValidTimestamp(completedAt)) return null;
  const start = Date.parse(createdAt);
  const end = Date.parse(completedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return Math.round((end - start) / 1000);
}

function extractGateSummary(artifact) {
  const phaseGateStatus = artifact.state?.phase_gate_status;
  if (!phaseGateStatus || typeof phaseGateStatus !== 'object' || Array.isArray(phaseGateStatus)) return [];
  return Object.entries(phaseGateStatus)
    .sort(([left], [right]) => left.localeCompare(right, 'en'))
    .map(([gate_id, status]) => ({
      gate_id,
      status: typeof status === 'string' && status.length > 0 ? status : 'unknown',
    }));
}

function extractIntakeLinks(artifact) {
  const runId = artifact.summary?.run_id;
  if (typeof runId !== 'string' || runId.length === 0) return [];
  return Object.entries(artifact.files || {})
    .filter(([relPath, entry]) => relPath.startsWith('.agentxchain/intake/intents/') && entry?.format === 'json')
    .map(([, entry]) => entry.data)
    .filter((intent) => intent && typeof intent === 'object' && intent.target_run === runId && typeof intent.intent_id === 'string')
    .sort((left, right) => {
      const leftTime = Date.parse(left.updated_at || left.started_at || left.created_at || 0);
      const rightTime = Date.parse(right.updated_at || right.started_at || right.created_at || 0);
      return leftTime - rightTime;
    })
    .map((intent) => ({
      intent_id: intent.intent_id,
      event_id: intent.event_id || null,
      status: intent.status || null,
      priority: intent.priority || null,
      template: intent.template || null,
      target_turn: intent.target_turn || null,
      started_at: intent.started_at || null,
      updated_at: intent.updated_at || null,
    }));
}

function extractRecoverySummary(artifact) {
  const blockedReason = artifact.state?.blocked_reason;
  if (!blockedReason || typeof blockedReason !== 'object' || Array.isArray(blockedReason)) return null;
  const recovery = blockedReason.recovery;
  if (!recovery || typeof recovery !== 'object' || Array.isArray(recovery)) return null;
  const runtimeGuidance = deriveRuntimeBlockedGuidance(artifact.state, artifact.config);
  return {
    category: blockedReason.category || null,
    typed_reason: recovery.typed_reason || null,
    owner: recovery.owner || null,
    recovery_action: recovery.recovery_action || null,
    detail: recovery.detail || null,
    turn_retained: typeof recovery.turn_retained === 'boolean' ? recovery.turn_retained : null,
    blocked_at: blockedReason.blocked_at || null,
    turn_id: blockedReason.turn_id || null,
    runtime_guidance: runtimeGuidance,
  };
}

function extractCoordinatorTimeline(artifact) {
  const data = extractFileData(artifact, '.agentxchain/multirepo/history.jsonl');
  if (!Array.isArray(data) || data.length === 0) return [];
  return data
    .filter((e) => e && typeof e === 'object' && !Array.isArray(e))
    .map((e) => {
      const details = {};
      if (e.gate) details.gate = e.gate;
      if (e.projection_ref) details.projection_ref = e.projection_ref;
      if (e.context_ref) details.context_ref = e.context_ref;
      if (Array.isArray(e.barrier_changes) && e.barrier_changes.length > 0) details.barrier_changes = e.barrier_changes;
      if (e.blocked_reason) details.blocked_reason = e.blocked_reason;
      return {
        type: e.type || 'unknown',
        timestamp: e.timestamp || null,
        summary: summarizeCoordinatorEvent(e),
        repo_id: e.repo_id || e.target_repo_id || null,
        workstream_id: e.workstream_id || null,
        details: Object.keys(details).length > 0 ? details : null,
      };
    });
}

function extractAggregatedEventTimeline(artifact) {
  const aggEvents = artifact.summary?.aggregated_events;
  if (!aggEvents || !Array.isArray(aggEvents.events) || aggEvents.events.length === 0) return [];
  return aggEvents.events.map((evt) => ({
    repo_id: evt.repo_id || null,
    type: evt.event_type || evt.type || 'unknown',
    timestamp: evt.timestamp || null,
    run_id: evt.run_id || null,
    event_id: evt.event_id || null,
    summary: `[${evt.repo_id || '?'}] ${evt.event_type || evt.type || 'unknown'} at ${evt.timestamp || '?'}`,
  }));
}

function computeCoordinatorTiming(artifact, coordinatorTimeline) {
  const coordinatorState = extractFileData(artifact, '.agentxchain/multirepo/state.json');
  const createdAtFromHistory = coordinatorTimeline
    .find((entry) => entry.type === 'run_initialized' && isValidTimestamp(entry.timestamp))
    ?.timestamp || null;
  const completedAtFromHistory = [...coordinatorTimeline]
    .reverse()
    .find((entry) => entry.type === 'run_completed' && isValidTimestamp(entry.timestamp))
    ?.timestamp || null;

  const createdAt = createdAtFromHistory
    || (isValidTimestamp(coordinatorState?.created_at) ? coordinatorState.created_at : null);

  let completedAt = null;
  const completedState = artifact.summary?.status === 'completed' || coordinatorState?.status === 'completed';
  if (completedState) {
    completedAt = completedAtFromHistory
      || (isValidTimestamp(coordinatorState?.updated_at) ? coordinatorState.updated_at : null);
  }

  return {
    created_at: createdAt,
    completed_at: completedAt,
    duration_seconds: computeDurationSeconds(createdAt, completedAt),
  };
}

function normalizeCoordinatorBlockedReason(blockedReason) {
  if (typeof blockedReason === 'string' && blockedReason.trim().length > 0) {
    return blockedReason;
  }
  if (blockedReason && typeof blockedReason === 'object' && !Array.isArray(blockedReason)) {
    if (typeof blockedReason.reason === 'string' && blockedReason.reason.trim().length > 0) {
      return blockedReason.reason;
    }
    if (typeof blockedReason.category === 'string' && blockedReason.category.trim().length > 0) {
      return blockedReason.category;
    }
  }
  return null;
}

function normalizePendingGate(pendingGate) {
  if (!pendingGate || typeof pendingGate !== 'object' || Array.isArray(pendingGate)) return null;
  if (typeof pendingGate.gate !== 'string' || pendingGate.gate.length === 0) return null;
  if (typeof pendingGate.gate_type !== 'string' || pendingGate.gate_type.length === 0) return null;
  const normalized = {
    gate: pendingGate.gate,
    gate_type: pendingGate.gate_type,
  };
  if (typeof pendingGate.from === 'string' && pendingGate.from.length > 0) normalized.from = pendingGate.from;
  if (typeof pendingGate.to === 'string' && pendingGate.to.length > 0) normalized.to = pendingGate.to;
  if (Array.isArray(pendingGate.required_repos)) normalized.required_repos = pendingGate.required_repos;
  if (Array.isArray(pendingGate.human_barriers)) normalized.human_barriers = pendingGate.human_barriers;
  if (typeof pendingGate.requested_at === 'string' && pendingGate.requested_at.length > 0) {
    normalized.requested_at = pendingGate.requested_at;
  }
  return normalized;
}

function extractCoordinatorDecisionDigest(artifact) {
  const data = extractFileData(artifact, '.agentxchain/multirepo/decision-ledger.jsonl');
  if (!Array.isArray(data) || data.length === 0) return [];
  return data
    .filter((d) => typeof d?.id === 'string')
    .map((d) => ({
      id: d.id,
      turn_id: d.turn_id || null,
      role: d.role || null,
      phase: d.phase || null,
      category: d.category || null,
      statement: d.statement || '',
    }));
}

function extractCoordinatorApprovalPolicyDigest(artifact) {
  const data = extractFileData(artifact, '.agentxchain/multirepo/decision-ledger.jsonl');
  if (!Array.isArray(data) || data.length === 0) return [];
  return data
    .filter((d) => d?.type === 'approval_policy')
    .map((d) => ({
      gate_type: d.gate_type || null,
      action: d.action || null,
      matched_rule: d.matched_rule || null,
      from_phase: d.from_phase || null,
      to_phase: d.to_phase || null,
      reason: d.reason || '',
      gate_id: d.gate_id || null,
      timestamp: d.timestamp || null,
    }));
}

function extractBarrierSummary(artifact) {
  const data = extractFileData(artifact, '.agentxchain/multirepo/barriers.json');
  if (!data || typeof data !== 'object' || Array.isArray(data)) return [];
  return Object.entries(data)
    .filter(([, b]) => b && typeof b === 'object' && !Array.isArray(b))
    .sort(([a], [b]) => a.localeCompare(b, 'en'))
    .map(([barrierId, b]) => {
      const entry = {
        barrier_id: barrierId,
        workstream_id: b.workstream_id || null,
        type: b.type || 'unknown',
        status: b.status || 'unknown',
        required_repos: Array.isArray(b.required_repos) ? b.required_repos : [],
        satisfied_repos: Array.isArray(b.satisfied_repos) ? b.satisfied_repos : [],
      };
      const decisionIds =
        b.required_decision_ids_by_repo || b.alignment_decision_ids || null;
      if (decisionIds && typeof decisionIds === 'object' && !Array.isArray(decisionIds)) {
        entry.required_decision_ids_by_repo = decisionIds;
        const satisfiedSet = new Set(entry.satisfied_repos);
        const satisfiedByRepo = {};
        for (const [repo, ids] of Object.entries(decisionIds)) {
          satisfiedByRepo[repo] = satisfiedSet.has(repo) ? [...ids] : [];
        }
        entry.satisfied_decision_ids_by_repo = satisfiedByRepo;
      }
      return entry;
    });
}

function summarizeBarrierTransition(entry) {
  const bid = entry.barrier_id || '?';
  const prev = entry.previous_status || '?';
  const next = entry.new_status || '?';
  const repo = entry.causation?.repo_id || null;

  if (prev === 'pending' && next === 'partially_satisfied') {
    return `Barrier ${bid}: first repo satisfied${repo ? ` (${repo})` : ''}`;
  }
  if (prev === 'partially_satisfied' && next === 'satisfied') {
    return `Barrier ${bid}: all repos satisfied${repo ? ` (${repo} completed the set)` : ''}`;
  }
  if (prev === 'pending' && next === 'satisfied') {
    return `Barrier ${bid}: satisfied${repo ? ` (single-repo barrier, ${repo})` : ''}`;
  }
  if (next === 'completed') {
    return `Barrier ${bid}: completed`;
  }
  return `Barrier ${bid}: ${prev} → ${next}`;
}

function extractBarrierLedgerTimeline(artifact) {
  const data = extractFileData(artifact, '.agentxchain/multirepo/barrier-ledger.jsonl');
  if (!Array.isArray(data) || data.length === 0) return [];
  return data
    .filter((e) => e && typeof e === 'object' && !Array.isArray(e) && e.type === 'barrier_transition')
    .map((e) => ({
      barrier_id: e.barrier_id || 'unknown',
      timestamp: e.timestamp || null,
      previous_status: e.previous_status || 'unknown',
      new_status: e.new_status || 'unknown',
      summary: summarizeBarrierTransition(e),
      workstream_id: e.causation?.workstream_id || null,
      repo_id: e.causation?.repo_id || null,
      trigger: e.causation?.trigger || null,
    }));
}

function deriveRepoStatusCounts(repoStatuses) {
  const counts = {};
  const statuses = Array.isArray(repoStatuses)
    ? repoStatuses
    : Object.values(repoStatuses || {});
  for (const status of statuses) {
    const key = status || 'unknown';
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function deriveCoordinatorStatusDrifts(repoStatusEntries) {
  return repoStatusEntries
    .filter((entry) => entry?.status_drift)
    .map((entry) => entry.status_drift);
}

function deriveCoordinatorTerminalObservabilityNote(status, runIdMismatches, repoStatusDrifts) {
  if (status !== 'completed') return null;
  const driftKinds = [];
  if (Array.isArray(runIdMismatches) && runIdMismatches.length > 0) {
    driftKinds.push('run-id drift');
  }
  if (Array.isArray(repoStatusDrifts) && repoStatusDrifts.length > 0) {
    driftKinds.push('status drift');
  }
  if (driftKinds.length === 0) return null;

  const verb = driftKinds.length > 1 ? 'remain' : 'remains';
  return `Child repo ${driftKinds.join(' and ')} ${verb} visible for audit, but this coordinator is already completed, so no recovery command is emitted.`;
}

export function extractWorkflowKitArtifacts(artifact) {
  const config = artifact.config;
  if (!config || typeof config !== 'object' || !config.workflow_kit) return null;

  const phase = artifact.summary?.phase || artifact.state?.phase;
  if (!phase) return null;

  const phaseConfig = config.workflow_kit.phases?.[phase];
  if (!phaseConfig) return [];

  const artifacts = Array.isArray(phaseConfig.artifacts) ? phaseConfig.artifacts : [];
  if (artifacts.length === 0) return [];

  const entryRole = config.routing?.[phase]?.entry_role || null;
  const fileKeys = new Set(Object.keys(artifact.files || {}));

  return artifacts
    .filter((a) => a && typeof a.path === 'string')
    .map((a) => {
      const hasExplicitOwner = typeof a.owned_by === 'string' && a.owned_by.length > 0;
      return {
        path: a.path,
        required: a.required !== false,
        semantics: a.semantics || null,
        owned_by: hasExplicitOwner ? a.owned_by : entryRole,
        owner_resolution: hasExplicitOwner ? 'explicit' : 'entry_role',
        exists: fileKeys.has(a.path),
      };
    })
    .sort((a, b) => a.path.localeCompare(b.path, 'en'));
}

function extractContinuityMetadata(artifact) {
  const checkpoint = extractFileData(artifact, '.agentxchain/session.json');
  if (!checkpoint || typeof checkpoint !== 'object') return null;

  const runId = artifact.summary?.run_id || artifact.state?.run_id || null;
  const staleCheckpoint = !!(
    checkpoint.run_id
    && runId
    && checkpoint.run_id !== runId
  );

  return {
    session_id: checkpoint.session_id || null,
    run_id: checkpoint.run_id || null,
    started_at: checkpoint.started_at || null,
    last_checkpoint_at: checkpoint.last_checkpoint_at || null,
    last_turn_id: checkpoint.last_turn_id || null,
    last_phase: checkpoint.last_phase || null,
    last_role: checkpoint.last_role || null,
    checkpoint_reason: checkpoint.checkpoint_reason || null,
    stale_checkpoint: staleCheckpoint,
  };
}

function buildRunSubject(artifact) {
  const activeTurns = artifact.summary?.active_turn_ids || [];
  const retainedTurns = artifact.summary?.retained_turn_ids || [];
  const activeRoles = [...new Set(
    Object.values(artifact.state?.active_turns || {})
      .map((turn) => turn?.assigned_role)
      .filter((role) => typeof role === 'string' && role.length > 0),
  )].sort((a, b) => a.localeCompare(b, 'en'));

  const turns = extractHistoryTimeline(artifact);
  const decisions = extractDecisionDigest(artifact);
  const approvalPolicyEvents = extractApprovalPolicyDigest(artifact);
  const gateFailures = extractGateFailureDigest(artifact);
  const timeoutEvents = extractTimeoutEventDigest(artifact);
  const hookSummary = extractHookSummary(artifact);
  const timing = computeTiming(artifact, turns);
  const gateSummary = extractGateSummary(artifact);
  const intakeLinks = extractIntakeLinks(artifact);
  const recoverySummary = extractRecoverySummary(artifact);
  const nextActions = deriveGovernedRunNextActions(artifact.state, artifact.config);
  const continuity = extractContinuityMetadata(artifact);
  const governanceEvents = extractGovernanceEventDigest(artifact);
  const delegationSummary = extractDelegationSummary(artifact);
  const dashboardSession = extractDashboardSessionSummary(artifact);
  const recentEventSummary = buildRecentEventSummary(extractRunEventTimeline(artifact));

  return {
    kind: 'governed_run',
    project: {
      id: artifact.project?.id || null,
      name: artifact.project?.name || null,
      goal: artifact.project?.goal || null,
      template: artifact.project?.template || 'generic',
      protocol_mode: artifact.project?.protocol_mode || null,
      schema_version: artifact.project?.schema_version || null,
    },
    run: {
      run_id: artifact.summary?.run_id || null,
      status: artifact.summary?.status || null,
      phase: artifact.summary?.phase || null,
      blocked_on: artifact.state?.blocked_on || null,
      blocked_reason: artifact.state?.blocked_reason || null,
      provenance: normalizeRunProvenance(artifact.summary?.provenance || artifact.state?.provenance),
      inherited_context: artifact.summary?.inherited_context || artifact.state?.inherited_context || null,
      active_turn_count: activeTurns.length,
      retained_turn_count: retainedTurns.length,
      active_turn_ids: activeTurns,
      retained_turn_ids: retainedTurns,
      active_roles: activeRoles,
      budget_status: normalizeBudgetStatus(artifact.state?.budget_status),
      cost_summary: computeCostSummary(turns),
      dashboard_session: dashboardSession,
      recent_event_summary: recentEventSummary,
      created_at: timing.created_at,
      completed_at: timing.completed_at,
      duration_seconds: timing.duration_seconds,
      turns,
      decisions,
      approval_policy_events: approvalPolicyEvents,
      governance_events: governanceEvents,
      gate_failures: gateFailures,
      timeout_events: timeoutEvents,
      delegation_summary: delegationSummary,
      hook_summary: hookSummary,
      gate_summary: gateSummary,
      intake_links: intakeLinks,
      recovery_summary: recoverySummary,
      next_actions: nextActions,
      continuity,
      workflow_kit_artifacts: extractWorkflowKitArtifacts(artifact),
      repo_decisions: artifact.summary?.repo_decisions || null,
    },
    artifacts: {
      history_entries: artifact.summary?.history_entries || 0,
      decision_entries: artifact.summary?.decision_entries || 0,
      hook_audit_entries: artifact.summary?.hook_audit_entries || 0,
      notification_audit_entries: artifact.summary?.notification_audit_entries || 0,
      dispatch_artifact_files: artifact.summary?.dispatch_artifact_files || 0,
      staging_artifact_files: artifact.summary?.staging_artifact_files || 0,
      intake_present: Boolean(artifact.summary?.intake_present),
      coordinator_present: Boolean(artifact.summary?.coordinator_present),
    },
  };
}

function extractRecoveryReportSection(content, heading) {
  const pattern = new RegExp(`^${heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'm');
  const match = content.match(pattern);
  if (!match) return null;
  const start = match.index + match[0].length;
  const nextHeading = content.slice(start).match(/^## /m);
  const sectionText = nextHeading
    ? content.slice(start, start + nextHeading.index).trim()
    : content.slice(start).trim();
  if (!sectionText || /^\(.*\)$/.test(sectionText)) return null;
  return sectionText;
}

function extractRecoveryReportSummary(artifact) {
  const entry = artifact.files?.['.agentxchain/multirepo/RECOVERY_REPORT.md'];
  if (!entry) return null;
  const content = typeof entry.data === 'string'
    ? entry.data
    : (entry.content_base64 ? Buffer.from(entry.content_base64, 'base64').toString('utf8') : null);
  if (!content) return null;
  return {
    present: true,
    trigger: extractRecoveryReportSection(content, '## Trigger'),
    impact: extractRecoveryReportSection(content, '## Impact'),
    mitigation: extractRecoveryReportSection(content, '## Mitigation'),
    owner: extractRecoveryReportSection(content, '## Owner'),
    exit_condition: extractRecoveryReportSection(content, '## Exit Condition'),
  };
}

function buildCoordinatorSubject(artifact) {
  const coordinatorState = extractFileData(artifact, '.agentxchain/multirepo/state.json') || {};
  const coordinatorStatus = coordinatorState?.status || artifact.summary?.status || null;
  const coordinatorPhase = coordinatorState?.phase || artifact.summary?.phase || null;
  const repos = Object.entries(artifact.repos || {})
    .sort(([left], [right]) => left.localeCompare(right, 'en'))
    .map(([repoId, repoEntry]) => {
      const base = {
        repo_id: repoId,
        path: repoEntry?.path || null,
        ok: Boolean(repoEntry?.ok),
        status: repoEntry?.ok ? repoEntry.export?.summary?.status || null : null,
        run_id: repoEntry?.ok ? repoEntry.export?.summary?.run_id || null : null,
        phase: repoEntry?.ok ? repoEntry.export?.summary?.phase || null : null,
        project_id: repoEntry?.ok ? repoEntry.export?.project?.id || null : null,
        project_name: repoEntry?.ok ? repoEntry.export?.project?.name || null : null,
        error: repoEntry?.ok ? null : repoEntry?.error || null,
      };
      if (!repoEntry?.ok || !repoEntry?.export) return base;
      const childExport = repoEntry.export;
      base.turns = extractHistoryTimeline(childExport);
      base.decisions = extractDecisionDigest(childExport);
      base.approval_policy_events = extractApprovalPolicyDigest(childExport);
      base.governance_events = extractGovernanceEventDigest(childExport);
      base.gate_failures = extractGateFailureDigest(childExport);
      base.timeout_events = extractTimeoutEventDigest(childExport);
      base.hook_summary = extractHookSummary(childExport);
      base.gate_summary = extractGateSummary(childExport);
      base.recovery_summary = extractRecoverySummary(childExport);
      base.continuity = extractContinuityMetadata(childExport);
      base.blocked_on = childExport.state?.blocked_on || null;
      return base;
    });

  const repoErrorCount = repos.filter((repo) => !repo.ok).length;
  const coordinatorTimeline = extractCoordinatorTimeline(artifact);
  const barrierSummary = extractBarrierSummary(artifact);
  const barrierLedgerTimeline = extractBarrierLedgerTimeline(artifact);
  const decisionDigest = extractCoordinatorDecisionDigest(artifact);
  const coordinatorApprovalPolicyEvents = extractCoordinatorApprovalPolicyDigest(artifact);
  const coordinatorGovernanceEvents = extractGovernanceEventDigest(artifact, '.agentxchain/multirepo/decision-ledger.jsonl');
  const coordinatorTimeoutEvents = extractTimeoutEventDigest(artifact, '.agentxchain/multirepo/decision-ledger.jsonl');
  const timing = computeCoordinatorTiming(artifact, coordinatorTimeline);
  const blockedReason = normalizeCoordinatorBlockedReason(coordinatorState.blocked_reason);
  const pendingGate = normalizePendingGate(coordinatorState.pending_gate);
  const repoStatusEntries = buildCoordinatorRepoStatusEntries({
    config: artifact.config,
    coordinatorRepoRuns: coordinatorState.repo_runs || {},
    repoSnapshots: repos,
  });
  const repoStatusCounts = deriveRepoStatusCounts(repoStatusEntries.map((entry) => entry.status));
  const runIdMismatches = repoStatusEntries
    .filter((entry) => entry?.run_id_mismatch)
    .map((entry) => entry.run_id_mismatch);
  const repoStatusDrifts = deriveCoordinatorStatusDrifts(repoStatusEntries);
  const recentCoordinatorEvents = buildRecentEventSummary(coordinatorTimeline);
  const recentChildRepoEvents = buildRecentEventSummary(extractAggregatedEventTimeline(artifact));
  const nextActions = deriveCoordinatorNextActions({
    status: coordinatorStatus,
    blockedReason,
    pendingGate,
    repos,
    coordinatorRepoRuns: coordinatorState.repo_runs || {},
    runIdMismatches,
  });
  const terminalObservabilityNote = deriveCoordinatorTerminalObservabilityNote(
    coordinatorStatus,
    runIdMismatches,
    repoStatusDrifts,
  );

  return {
    kind: 'coordinator_workspace',
    coordinator: {
      project_id: artifact.coordinator?.project_id || null,
      project_name: artifact.coordinator?.project_name || null,
      schema_version: artifact.coordinator?.schema_version || null,
      repo_count: artifact.coordinator?.repo_count || 0,
      workstream_count: artifact.coordinator?.workstream_count || 0,
    },
    run: {
      super_run_id: coordinatorState?.super_run_id || artifact.summary?.super_run_id || null,
      status: coordinatorStatus,
      phase: coordinatorPhase,
      blocked_reason: blockedReason,
      pending_gate: pendingGate,
      run_id_mismatches: runIdMismatches,
      repo_status_drifts: repoStatusDrifts,
      terminal_observability_note: terminalObservabilityNote,
      recent_coordinator_events: recentCoordinatorEvents,
      recent_child_repo_events: recentChildRepoEvents,
      next_actions: nextActions,
      created_at: timing.created_at,
      completed_at: timing.completed_at,
      duration_seconds: timing.duration_seconds,
      barrier_count: artifact.summary?.barrier_count || 0,
      repo_status_counts: repoStatusCounts,
      repo_ok_count: repos.length - repoErrorCount,
      repo_error_count: repoErrorCount,
    },
    coordinator_timeline: coordinatorTimeline,
    aggregated_event_timeline: extractAggregatedEventTimeline(artifact),
    barrier_summary: barrierSummary,
    barrier_ledger_timeline: barrierLedgerTimeline,
    decision_digest: decisionDigest,
    approval_policy_events: coordinatorApprovalPolicyEvents,
    governance_events: coordinatorGovernanceEvents,
    timeout_events: coordinatorTimeoutEvents,
    recovery_report: extractRecoveryReportSummary(artifact),
    repos,
    artifacts: {
      history_entries: artifact.summary?.history_entries || 0,
      decision_entries: artifact.summary?.decision_entries || 0,
    },
  };
}

export function buildGovernanceReport(artifact, { input = 'stdin', generatedAt = new Date().toISOString() } = {}) {
  const verification = verifyExportArtifact(artifact);
  if (!verification.ok) {
    return {
      ok: false,
      exitCode: 1,
      report: {
        overall: 'fail',
        input,
        message: 'Cannot build governance report from invalid export artifact.',
        verification: verification.report,
      },
    };
  }

  let subject;
  if (artifact.export_kind === 'agentxchain_run_export') {
    subject = buildRunSubject(artifact);
  } else if (artifact.export_kind === 'agentxchain_coordinator_export') {
    subject = buildCoordinatorSubject(artifact);
  } else {
    return {
      ok: false,
      exitCode: 1,
      report: {
        overall: 'fail',
        input,
        message: 'Cannot build governance report from invalid export artifact.',
        verification: verification.report,
      },
    };
  }

  return {
    ok: true,
    exitCode: 0,
    report: {
      report_version: GOVERNANCE_REPORT_VERSION,
      overall: 'pass',
      generated_at: generatedAt,
      input,
      export_kind: artifact.export_kind,
      verification: verification.report,
      subject,
    },
  };
}

export function formatGovernanceReportText(report) {
  if (report.overall === 'error') {
    return [
      'AgentXchain Governance Report',
      `Input: ${report.input}`,
      'Status: ERROR',
      `Message: ${report.message}`,
    ].join('\n');
  }

  if (report.overall === 'fail') {
    return [
      'AgentXchain Governance Report',
      `Input: ${report.input}`,
      'Verification: FAIL',
      report.message,
      'Errors:',
      ...(report.verification?.errors || []).map((error) => `- ${error}`),
    ].join('\n');
  }

  if (report.subject.kind === 'governed_run') {
    const { project, run, artifacts } = report.subject;
    const lines = [
      'AgentXchain Governance Report',
      `Input: ${report.input}`,
      `Export kind: ${report.export_kind}`,
      'Verification: PASS',
      `Project: ${project.name || 'unknown'} (${project.id || 'unknown'})`,
      ...(project.goal ? [`Goal: ${project.goal}`] : []),
      `Template: ${project.template}`,
      `Protocol: ${project.protocol_mode || 'unknown'} (config schema ${project.schema_version || 'unknown'})`,
      `Run: ${run.run_id || 'none'}`,
      `Status: ${run.status || 'unknown'}`,
      `Phase: ${run.phase || 'unknown'}`,
      `Blocked on: ${summarizeBlockedState(run)}`,
      `Active turns: ${run.active_turn_count}${run.active_turn_ids.length ? ` (${run.active_turn_ids.join(', ')})` : ''}`,
      `Retained turns: ${run.retained_turn_count}${run.retained_turn_ids.length ? ` (${run.retained_turn_ids.join(', ')})` : ''}`,
      `Active roles: ${run.active_roles.length ? run.active_roles.join(', ') : 'none'}`,
    ];

    if (run.budget_status) {
      const warnTag = run.budget_status.warn_mode ? ' [OVER BUDGET]' : '';
      lines.push(
        `Budget: spent ${formatUsd(run.budget_status.spent_usd)}, remaining ${formatUsd(run.budget_status.remaining_usd)}${warnTag}`,
      );
    }

    if (run.created_at) {
      lines.push(`Started: ${run.created_at}`);
    }
    if (run.completed_at) {
      lines.push(`Completed: ${run.completed_at}`);
    }
    if (run.duration_seconds != null) {
      lines.push(`Duration: ${run.duration_seconds}s`);
    }
    if (summarizeRunProvenance(run.provenance)) {
      lines.push(`Provenance: ${summarizeRunProvenance(run.provenance)}`);
    }
    if (run.inherited_context?.parent_run_id) {
      lines.push(`Inherited from: ${run.inherited_context.parent_run_id} (${run.inherited_context.parent_status || 'unknown'})`);
    }
    if (run.dashboard_session) {
      lines.push(`Dashboard session: ${formatDashboardSessionLine(run.dashboard_session)}`);
    }
    if (run.recent_event_summary) {
      lines.push(`Recent events: ${formatRecentEventSummaryLine(run.recent_event_summary)}`);
      lines.push(`Latest event: ${formatRecentEventDetail(run.recent_event_summary)}`);
    }

    lines.push(
      `History entries: ${artifacts.history_entries}`,
      `Decision entries: ${artifacts.decision_entries}`,
      `Hook audit entries: ${artifacts.hook_audit_entries}`,
      `Notification audit entries: ${artifacts.notification_audit_entries}`,
      `Dispatch files: ${artifacts.dispatch_artifact_files}`,
      `Staging files: ${artifacts.staging_artifact_files}`,
      `Intake artifacts: ${yesNo(artifacts.intake_present)}`,
      `Coordinator artifacts: ${yesNo(artifacts.coordinator_present)}`,
    );

    if (run.cost_summary) {
      const cs = run.cost_summary;
      lines.push('', 'Cost Summary:');
      lines.push(`  Total: ${formatUsd(cs.total_usd)} across ${cs.turn_count} turn${cs.turn_count !== 1 ? 's' : ''} (${cs.costed_turn_count} with cost data)`);
      if (cs.total_input_tokens != null || cs.total_output_tokens != null) {
        lines.push(`  Tokens: ${formatTokenCount(cs.total_input_tokens)} input / ${formatTokenCount(cs.total_output_tokens)} output`);
      }
      if (cs.by_role.length > 0) {
        lines.push('  By role:');
        for (const r of cs.by_role) {
          const tokens = r.input_tokens || r.output_tokens
            ? `, ${formatTokenCount(r.input_tokens)} in / ${formatTokenCount(r.output_tokens)} out`
            : '';
          lines.push(`    ${r.role}: ${formatUsd(r.usd)} (${r.turns} turn${r.turns !== 1 ? 's' : ''}${tokens})`);
        }
      }
      if (cs.by_phase.length > 0) {
        lines.push('  By phase:');
        for (const p of cs.by_phase) {
          lines.push(`    ${p.phase}: ${formatUsd(p.usd)} (${p.turns} turn${p.turns !== 1 ? 's' : ''})`);
        }
      }
    }

    if (run.delegation_summary?.delegation_chains?.length > 0) {
      lines.push('', 'Delegation Summary:');
      lines.push(`  Total delegations issued: ${run.delegation_summary.total_delegations_issued}`);
      for (const chain of run.delegation_summary.delegation_chains) {
        lines.push(`  - ${chain.parent_role} (${chain.parent_turn_id}) | outcome: ${chain.outcome} | review: ${chain.review_turn_id || 'pending'}`);
        for (const delegation of chain.delegations) {
          lines.push(`      ${delegation.delegation_id} -> ${delegation.to_role} | ${delegation.status} | child: ${delegation.child_turn_id || 'pending'} | ${delegation.charter}`);
          if (delegation.required_decision_ids?.length > 0) {
            lines.push(`        required decisions: ${delegation.required_decision_ids.join(', ')}`);
            lines.push(`        satisfied decisions: ${delegation.satisfied_decision_ids.join(', ') || 'none'}`);
            lines.push(`        missing decisions: ${delegation.missing_decision_ids.join(', ') || 'none'}`);
          }
        }
      }
    }

    if (run.repo_decisions) {
      lines.push('', 'Repo Decisions:');
      lines.push(`  Active: ${run.repo_decisions.active_count}  Overridden: ${run.repo_decisions.overridden_count}`);
      for (const summaryLine of buildRepoDecisionSummaryLines(run.repo_decisions)) {
        lines.push(`  ${summaryLine}`);
      }
      for (const d of run.repo_decisions.active) {
        const supersedes = d.overrides ? ` | supersedes ${d.overrides}` : '';
        const authority = d.authority_level == null ? '' : ` | authority ${d.authority_level}${d.authority_source === 'human_default' ? ' (human default)' : ''}`;
        lines.push(`  - ${d.id} (${d.category}): ${d.statement}${supersedes}${authority}`);
      }
      for (const d of run.repo_decisions.overridden || []) {
        const authority = d.authority_level == null ? '' : ` | authority ${d.authority_level}${d.authority_source === 'human_default' ? ' (human default)' : ''}`;
        lines.push(`  - ${d.id} (overridden by ${d.overridden_by || 'unknown'}${authority})`);
      }
    }

    if (run.turns && run.turns.length > 0) {
      lines.push('', 'Turn Timeline:');
      for (let i = 0; i < run.turns.length; i++) {
        const t = run.turns[i];
        const cost = t.cost_usd != null ? formatUsd(t.cost_usd) : 'n/a';
        const phase = t.phase_transition ? `${t.phase || '?'} -> ${t.phase_transition}` : (t.phase || '?');
        const siblingNote = Array.isArray(t.sibling_attributed_files) ? ` (${t.sibling_attributed_files.length} sibling-attributed)` : '';
        lines.push(`  ${i + 1}. [${t.role}] ${t.summary || '(no summary)'} | phase: ${phase} | files: ${t.files_changed_count}${siblingNote} | cost: ${cost} | ${formatTurnTimelineTime(t)}`);
      }
    }

    if (run.decisions && run.decisions.length > 0) {
      lines.push('', 'Decisions:');
      for (const d of run.decisions) {
        lines.push(`  - ${d.id} (${d.role || '?'}, ${d.phase || '?'}): ${d.statement}`);
      }
    }

    if (run.gate_summary && run.gate_summary.length > 0) {
      lines.push('', 'Gate Outcomes:');
      for (const gate of run.gate_summary) {
        lines.push(`  - ${gate.gate_id}: ${gate.status}`);
      }
    }

    if (run.gate_failures && run.gate_failures.length > 0) {
      lines.push('', 'Gate Failures:');
      for (const failure of run.gate_failures) {
        const request = failure.gate_type === 'run_completion'
          ? 'run completion'
          : `${failure.from_phase || failure.phase || '?'} -> ${failure.to_phase || '?'}`;
        const source = failure.queued_request ? 'queued drain' : 'direct';
        lines.push(`  - ${failure.gate_id || 'unknown'} | ${failure.gate_type || 'unknown'} | request: ${request} | source: ${source} | at: ${failure.failed_at || 'n/a'}`);
        for (const reason of failure.reasons || []) {
          lines.push(`      reason: ${reason}`);
        }
      }
    }

    if (run.approval_policy_events && run.approval_policy_events.length > 0) {
      lines.push('', 'Approval Policy:');
      for (const evt of run.approval_policy_events) {
        const transition = evt.gate_type === 'run_completion'
          ? 'run completion'
          : `${evt.from_phase || '?'} -> ${evt.to_phase || '?'}`;
        const rule = evt.matched_rule ? ` | rule: ${typeof evt.matched_rule === 'object' ? JSON.stringify(evt.matched_rule) : evt.matched_rule}` : '';
        lines.push(`  - ${evt.action || 'unknown'} | ${evt.gate_type || 'unknown'} | ${transition}${rule} | at: ${evt.timestamp || 'n/a'}`);
        if (evt.reason) lines.push(`      reason: ${evt.reason}`);
      }
    }

    if (run.governance_events && run.governance_events.length > 0) {
      lines.push('', 'Governance Events:');
      for (const evt of run.governance_events) {
        lines.push(`  - ${evt.type} | ${evt.role || '?'} | ${evt.phase || '?'} | at: ${evt.timestamp || 'n/a'}`);
        renderGovernanceEventDetailText(lines, evt, '      ');
      }
    }

    if (run.timeout_events && run.timeout_events.length > 0) {
      lines.push('', 'Timeout Events:');
      for (const evt of run.timeout_events) {
        const label = evt.type === 'timeout_warning' ? 'warning'
          : evt.type === 'timeout_skip' ? 'skip'
          : evt.type === 'timeout_skip_failed' ? 'skip failed'
          : 'escalation';
        const elapsed = evt.elapsed_minutes != null ? `${evt.elapsed_minutes}m` : '?';
        const limit = evt.limit_minutes != null ? `${evt.limit_minutes}m` : '?';
        const exceeded = evt.exceeded_by_minutes != null ? `+${evt.exceeded_by_minutes}m` : '';
        lines.push(`  - ${label} | ${evt.scope || '?'} scope | ${elapsed}/${limit}${exceeded ? ` (${exceeded})` : ''} | action: ${evt.action || 'n/a'} | phase: ${evt.phase || 'n/a'} | at: ${evt.timestamp || 'n/a'}`);
      }
    }

    if (run.intake_links && run.intake_links.length > 0) {
      lines.push('', 'Intake Linkage:');
      for (const intake of run.intake_links) {
        lines.push(`  - ${intake.intent_id} | status: ${intake.status || 'unknown'} | event: ${intake.event_id || 'n/a'} | target turn: ${intake.target_turn || 'n/a'} | started: ${intake.started_at || 'n/a'}`);
      }
    }

    if (run.hook_summary) {
      lines.push('', 'Hook Activity:');
      lines.push(`  Total: ${run.hook_summary.total}, Blocked: ${run.hook_summary.blocked}`);
      const eventList = Object.entries(run.hook_summary.events).sort(([a], [b]) => a.localeCompare(b, 'en')).map(([e, c]) => `${e}(${c})`).join(', ');
      if (eventList) lines.push(`  Events: ${eventList}`);
    }

    if (run.recovery_summary) {
      lines.push('', 'Recovery:');
      lines.push(`  Category: ${run.recovery_summary.category || 'unknown'}`);
      lines.push(`  Typed reason: ${run.recovery_summary.typed_reason || 'unknown'}`);
      lines.push(`  Owner: ${run.recovery_summary.owner || 'unknown'}`);
      lines.push(`  Action: ${run.recovery_summary.recovery_action || 'n/a'}`);
      lines.push(`  Detail: ${run.recovery_summary.detail || 'n/a'}`);
      lines.push(`  Turn retained: ${run.recovery_summary.turn_retained == null ? 'n/a' : yesNo(run.recovery_summary.turn_retained)}`);
      if (Array.isArray(run.recovery_summary.runtime_guidance) && run.recovery_summary.runtime_guidance.length > 0) {
        lines.push('  Runtime guidance:');
        for (const entry of run.recovery_summary.runtime_guidance) {
          lines.push(`    - ${entry.code} | ${entry.command} | ${entry.reason}`);
        }
      }
    }

    if (run.next_actions && run.next_actions.length > 0) {
      lines.push('', 'Next Actions:');
      for (let i = 0; i < run.next_actions.length; i++) {
        const action = run.next_actions[i];
        lines.push(`  ${i + 1}. ${action.command} | ${action.reason}`);
      }
    }

    if (run.continuity) {
      lines.push('', 'Continuity:');
      lines.push(`  Session: ${run.continuity.session_id || 'unknown'}`);
      lines.push(`  Checkpoint: ${run.continuity.checkpoint_reason || 'unknown'} at ${run.continuity.last_checkpoint_at || 'n/a'}`);
      lines.push(`  Last turn: ${run.continuity.last_turn_id || 'none'}`);
      lines.push(`  Last role: ${run.continuity.last_role || 'unknown'}`);
      lines.push(`  Last phase: ${run.continuity.last_phase || 'unknown'}`);
      if (run.continuity.stale_checkpoint) {
        lines.push(`  WARNING: checkpoint tracks run ${run.continuity.run_id}, but export tracks ${run.run_id}`);
      }
    }

    if (Array.isArray(run.workflow_kit_artifacts) && run.workflow_kit_artifacts.length > 0) {
      lines.push('', `Workflow Artifacts (${run.phase || 'unknown'} phase):`);
      for (const art of run.workflow_kit_artifacts) {
        const req = art.required ? 'required' : 'optional';
        const sem = art.semantics || 'none';
        const owner = art.owned_by ? `${art.owned_by} (${art.owner_resolution})` : 'none';
        const status = art.exists ? 'exists' : 'missing';
        lines.push(`  ${art.path} | ${req} | ${sem} | owner: ${owner} | ${status}`);
      }
    }

    return lines.join('\n');
  }

  const {
    coordinator,
    run,
    artifacts,
    repos,
    coordinator_timeline,
    barrier_summary,
    barrier_ledger_timeline,
    decision_digest,
    approval_policy_events,
    governance_events,
    timeout_events,
    recovery_report,
  } = report.subject;
  const lines = [
    'AgentXchain Governance Report',
    `Input: ${report.input}`,
    `Export kind: ${report.export_kind}`,
    'Verification: PASS',
    `Workspace: ${coordinator.project_name || 'unknown'} (${coordinator.project_id || 'unknown'})`,
    `Coordinator schema: ${coordinator.schema_version || 'unknown'}`,
    `Super run: ${run.super_run_id || 'none'}`,
    `Status: ${run.status || 'unknown'}`,
    `Phase: ${run.phase || 'unknown'}`,
    `Blocked reason: ${run.blocked_reason || 'none'}`,
  ];

  if (run.run_id_mismatches && run.run_id_mismatches.length > 0) {
    lines.push(`Run ID mismatches: ${run.run_id_mismatches.length}`);
    for (const m of run.run_id_mismatches) {
      lines.push(`  - ${m.repo_id}: expected ${m.expected_run_id}, actual ${m.actual_run_id}`);
    }
  }
  if (run.repo_status_drifts && run.repo_status_drifts.length > 0) {
    lines.push(`Repo status drift: ${run.repo_status_drifts.length}`);
    for (const drift of run.repo_status_drifts) {
      lines.push(`  - ${drift.repo_id}: coordinator ${drift.coordinator_status || 'unknown'}, repo ${drift.repo_status || 'unknown'}`);
    }
  }

  lines.push(
    `Started: ${run.created_at || 'n/a'}`,
    `Repos: ${coordinator.repo_count} total, ${run.repo_ok_count} exported cleanly, ${run.repo_error_count} failed`,
    `Workstreams: ${coordinator.workstream_count}`,
    `Barriers: ${run.barrier_count}`,
    `Repo statuses: ${formatStatusCounts(run.repo_status_counts)}`,
    `History entries: ${artifacts.history_entries}`,
    `Decision entries: ${artifacts.decision_entries}`,
  );

  if (run.completed_at) {
    lines.push(`Completed: ${run.completed_at}`);
  }
  if (run.duration_seconds != null) {
    lines.push(`Duration: ${run.duration_seconds}s`);
  }
  if (run.pending_gate) {
    lines.push(`Pending gate: ${run.pending_gate.gate} (${run.pending_gate.gate_type})`);
  }
  if (run.recent_coordinator_events) {
    lines.push(`Recent coordinator events: ${formatRecentEventSummaryLine(run.recent_coordinator_events)}`);
    lines.push(`Latest coordinator event: ${formatRecentEventDetail(run.recent_coordinator_events)}`);
  }
  if (run.recent_child_repo_events) {
    lines.push(`Recent child repo events: ${formatRecentEventSummaryLine(run.recent_child_repo_events)}`);
    lines.push(`Latest child repo event: ${formatRecentEventDetail(run.recent_child_repo_events)}`);
  }
  if (run.terminal_observability_note) {
    lines.push(`Terminal drift note: ${run.terminal_observability_note}`);
  }

  if (run.next_actions && run.next_actions.length > 0) {
    lines.push('', 'Next Actions:');
    for (let i = 0; i < run.next_actions.length; i++) {
      const action = run.next_actions[i];
      lines.push(`  ${i + 1}. ${action.command} | ${action.reason}`);
    }
  }

  if (coordinator_timeline && coordinator_timeline.length > 0) {
    lines.push('', 'Coordinator Timeline:');
    for (let i = 0; i < coordinator_timeline.length; i++) {
      const ev = coordinator_timeline[i];
      const ts = ev.timestamp ? ` [${ev.timestamp}]` : '';
      lines.push(`  ${i + 1}. [${ev.type}]${ts} ${ev.summary}`);
    }
  }

  const aggregated_event_timeline = report.subject.aggregated_event_timeline;
  if (aggregated_event_timeline && aggregated_event_timeline.length > 0) {
    lines.push('', 'Aggregated Child Repo Events:');
    for (const evt of aggregated_event_timeline) {
      const ts = evt.timestamp ? ` [${evt.timestamp}]` : '';
      lines.push(`  [${evt.repo_id || '?'}] ${evt.type}${ts}`);
    }
  } else {
    lines.push('', 'Aggregated Child Repo Events:', '  No child repo events.');
  }

  if (barrier_summary && barrier_summary.length > 0) {
    lines.push('', 'Barrier Summary:');
    for (const b of barrier_summary) {
      const satisfied = b.satisfied_repos.length;
      const required = b.required_repos.length;
      lines.push(`  - ${b.barrier_id}: ${b.status} (${b.type}, ${satisfied}/${required} repos satisfied, workstream ${b.workstream_id || 'unknown'})`);
      if (b.required_decision_ids_by_repo) {
        lines.push('    Decision requirements:');
        for (const [repo, ids] of Object.entries(b.required_decision_ids_by_repo)) {
          if (!Array.isArray(ids) || ids.length === 0) continue;
          const satisfiedIds = new Set(
            Array.isArray(b.satisfied_decision_ids_by_repo?.[repo]) ? b.satisfied_decision_ids_by_repo[repo] : []
          );
          const labels = ids.map((id) => `${id} (${satisfiedIds.has(id) ? 'satisfied' : 'pending'})`);
          lines.push(`      ${repo}: ${labels.join(', ')}`);
        }
      }
    }
  }

  if (barrier_ledger_timeline && barrier_ledger_timeline.length > 0) {
    lines.push('', 'Barrier Transitions:');
    for (let i = 0; i < barrier_ledger_timeline.length; i++) {
      const t = barrier_ledger_timeline[i];
      const ts = t.timestamp ? ` [${t.timestamp}]` : '';
      lines.push(`  ${i + 1}.${ts} ${t.summary}`);
    }
  }

  if (decision_digest && decision_digest.length > 0) {
    lines.push('', 'Coordinator Decisions:');
    for (const d of decision_digest) {
      lines.push(`  - ${d.id} (${d.role || '?'}, ${d.phase || '?'}): ${d.statement}`);
    }
  }

  if (approval_policy_events && approval_policy_events.length > 0) {
    lines.push('', 'Approval Policy:');
    for (const evt of approval_policy_events) {
      const transition = evt.gate_type === 'run_completion'
        ? 'run completion'
        : `${evt.from_phase || '?'} -> ${evt.to_phase || '?'}`;
      const rule = evt.matched_rule ? ` | rule: ${typeof evt.matched_rule === 'object' ? JSON.stringify(evt.matched_rule) : evt.matched_rule}` : '';
      lines.push(`  - ${evt.action || 'unknown'} | ${evt.gate_type || 'unknown'} | ${transition}${rule} | at: ${evt.timestamp || 'n/a'}`);
      if (evt.reason) lines.push(`      reason: ${evt.reason}`);
    }
  }

  if (governance_events && governance_events.length > 0) {
    lines.push('', 'Governance Events:');
    for (const evt of governance_events) {
      lines.push(`  - ${evt.type} | ${evt.role || '?'} | ${evt.phase || '?'} | at: ${evt.timestamp || 'n/a'}`);
      renderGovernanceEventDetailText(lines, evt, '      ');
    }
  }

  if (timeout_events && timeout_events.length > 0) {
    lines.push('', 'Timeout Events:');
    for (const evt of timeout_events) {
      const label = evt.type === 'timeout_warning' ? 'warning'
        : evt.type === 'timeout_skip' ? 'skip'
        : evt.type === 'timeout_skip_failed' ? 'skip failed'
        : 'escalation';
      const elapsed = evt.elapsed_minutes != null ? `${evt.elapsed_minutes}m` : '?';
      const limit = evt.limit_minutes != null ? `${evt.limit_minutes}m` : '?';
      const exceeded = evt.exceeded_by_minutes != null ? `+${evt.exceeded_by_minutes}m` : '';
      lines.push(`  - ${label} | ${evt.scope || '?'} scope | ${elapsed}/${limit}${exceeded ? ` (${exceeded})` : ''} | action: ${evt.action || 'n/a'} | phase: ${evt.phase || 'n/a'} | at: ${evt.timestamp || 'n/a'}`);
    }
  }

  if (recovery_report) {
    lines.push('', 'Recovery Report:');
    lines.push(`  Trigger: ${recovery_report.trigger || 'n/a'}`);
    lines.push(`  Impact: ${recovery_report.impact || 'n/a'}`);
    lines.push(`  Mitigation: ${recovery_report.mitigation || 'n/a'}`);
    lines.push(`  Owner: ${recovery_report.owner || 'n/a'}`);
    lines.push(`  Exit Condition: ${recovery_report.exit_condition || 'n/a'}`);
  }

  lines.push('Repo details:');
  lines.push(...repos.flatMap((repo) => {
      if (!repo.ok) {
        return [`- ${repo.repo_id}: failed export, ${repo.error || 'unknown error'}, path ${repo.path || 'unknown'}`];
      }
      const repoLines = [`- ${repo.repo_id}: ok, status ${repo.status || 'unknown'}, run ${repo.run_id || 'none'}, path ${repo.path || 'unknown'}`];
      if (repo.blocked_on) {
        repoLines.push(`  Blocked on: ${summarizeBlockedOn(repo.blocked_on)}`);
      }
      if (repo.turns && repo.turns.length > 0) {
        repoLines.push('  Turn Timeline:');
        for (let i = 0; i < repo.turns.length; i++) {
          const t = repo.turns[i];
          const cost = t.cost_usd != null ? formatUsd(t.cost_usd) : 'n/a';
          const phase = t.phase_transition ? `${t.phase || '?'} -> ${t.phase_transition}` : (t.phase || '?');
          const siblingNote = Array.isArray(t.sibling_attributed_files) ? ` (${t.sibling_attributed_files.length} sibling-attributed)` : '';
          repoLines.push(`    ${i + 1}. [${t.role}] ${t.summary || '(no summary)'} | phase: ${phase} | files: ${t.files_changed_count}${siblingNote} | cost: ${cost} | ${t.accepted_at || 'n/a'}`);
        }
      }
      if (repo.decisions && repo.decisions.length > 0) {
        repoLines.push('  Decisions:');
        for (const d of repo.decisions) {
          repoLines.push(`    - ${d.id} (${d.role || '?'}, ${d.phase || '?'}): ${d.statement}`);
        }
      }
      if (repo.gate_summary && repo.gate_summary.length > 0) {
        repoLines.push('  Gate Outcomes:');
        for (const gate of repo.gate_summary) {
          repoLines.push(`    - ${gate.gate_id}: ${gate.status}`);
        }
      }
      if (repo.gate_failures && repo.gate_failures.length > 0) {
        repoLines.push('  Gate Failures:');
        for (const failure of repo.gate_failures) {
          const request = failure.gate_type === 'run_completion'
            ? 'run completion'
            : `${failure.from_phase || failure.phase || '?'} -> ${failure.to_phase || '?'}`;
          repoLines.push(`    - ${failure.gate_id || 'unknown'}: ${failure.gate_type || 'unknown'} | ${request} | ${failure.queued_request ? 'queued drain' : 'direct'} | ${failure.failed_at || 'n/a'}`);
          for (const reason of failure.reasons || []) {
            repoLines.push(`      reason: ${reason}`);
          }
        }
      }
      if (repo.approval_policy_events && repo.approval_policy_events.length > 0) {
        repoLines.push('  Approval Policy:');
        for (const evt of repo.approval_policy_events) {
          const transition = evt.gate_type === 'run_completion'
            ? 'run completion'
            : `${evt.from_phase || '?'} -> ${evt.to_phase || '?'}`;
          repoLines.push(`    - ${evt.action || 'unknown'}: ${evt.gate_type || 'unknown'} | ${transition} | ${evt.timestamp || 'n/a'}`);
        }
      }
      if (repo.governance_events && repo.governance_events.length > 0) {
        repoLines.push('  Governance Events:');
        for (const evt of repo.governance_events) {
          repoLines.push(`    - ${evt.type} | ${evt.role || '?'} | ${evt.phase || '?'} | at: ${evt.timestamp || 'n/a'}`);
          renderGovernanceEventDetailText(repoLines, evt, '        ');
        }
      }
      if (repo.timeout_events && repo.timeout_events.length > 0) {
        repoLines.push('  Timeout Events:');
        for (const evt of repo.timeout_events) {
          const label = evt.type === 'timeout_warning' ? 'warning'
            : evt.type === 'timeout_skip' ? 'skip'
            : evt.type === 'timeout_skip_failed' ? 'skip failed'
            : 'escalation';
          const elapsed = evt.elapsed_minutes != null ? `${evt.elapsed_minutes}m` : '?';
          const limit = evt.limit_minutes != null ? `${evt.limit_minutes}m` : '?';
          repoLines.push(`    - ${label}: ${evt.scope || '?'} scope | ${elapsed}/${limit} | action: ${evt.action || 'n/a'} | ${evt.timestamp || 'n/a'}`);
        }
      }
      if (repo.hook_summary) {
        repoLines.push(`  Hook Activity: ${repo.hook_summary.total} total, ${repo.hook_summary.blocked} blocked`);
      }
      if (repo.recovery_summary) {
        repoLines.push(`  Recovery: ${repo.recovery_summary.category || 'unknown'} — ${repo.recovery_summary.typed_reason || 'unknown'} (owner: ${repo.recovery_summary.owner || 'unknown'})`);
      }
      if (repo.continuity) {
        repoLines.push('  Continuity:');
        repoLines.push(`    Session: ${repo.continuity.session_id || 'unknown'}`);
        repoLines.push(`    Checkpoint: ${repo.continuity.checkpoint_reason || 'unknown'} at ${repo.continuity.last_checkpoint_at || 'n/a'}`);
        repoLines.push(`    Last turn: ${repo.continuity.last_turn_id || 'none'}`);
        repoLines.push(`    Last role: ${repo.continuity.last_role || 'unknown'}`);
        repoLines.push(`    Last phase: ${repo.continuity.last_phase || 'unknown'}`);
        if (repo.continuity.stale_checkpoint) {
          repoLines.push(`    WARNING: checkpoint tracks run ${repo.continuity.run_id}, but repo export tracks ${repo.run_id}`);
        }
      }
      return repoLines;
    }));
  return lines.join('\n');
}

export function formatGovernanceReportMarkdown(report) {
  if (report.overall === 'error') {
    return [
      '# AgentXchain Governance Report',
      '',
      `- Input: \`${report.input}\``,
      '- Status: `error`',
      `- Message: ${report.message}`,
    ].join('\n');
  }

  if (report.overall === 'fail') {
    return [
      '# AgentXchain Governance Report',
      '',
      `- Input: \`${report.input}\``,
      '- Verification: `fail`',
      `- Message: ${report.message}`,
      '',
      '## Verification Errors',
      '',
      ...(report.verification?.errors || []).map((error) => `- ${error}`),
    ].join('\n');
  }

  if (report.subject.kind === 'governed_run') {
    const { project, run, artifacts } = report.subject;
    const lines = [
      '# AgentXchain Governance Report',
      '',
      `- Input: \`${report.input}\``,
      `- Export kind: \`${report.export_kind}\``,
      '- Verification: `pass`',
      `- Project: ${project.name || 'unknown'} (\`${project.id || 'unknown'}\`)`,
      ...(project.goal ? [`- Goal: ${project.goal}`] : []),
      `- Template: \`${project.template}\``,
      `- Protocol: \`${project.protocol_mode || 'unknown'}\` (config schema \`${project.schema_version || 'unknown'}\`)`,
      `- Run: \`${run.run_id || 'none'}\``,
      `- Status: \`${run.status || 'unknown'}\``,
      `- Phase: \`${run.phase || 'unknown'}\``,
      `- Blocked on: \`${summarizeBlockedState(run)}\``,
      `- Active turns: ${run.active_turn_count}${run.active_turn_ids.length ? ` (\`${run.active_turn_ids.join('`, `')}\`)` : ''}`,
      `- Retained turns: ${run.retained_turn_count}${run.retained_turn_ids.length ? ` (\`${run.retained_turn_ids.join('`, `')}\`)` : ''}`,
      `- Active roles: ${run.active_roles.length ? `\`${run.active_roles.join('`, `')}\`` : '`none`'}`,
    ];

    if (run.budget_status) {
      const warnTag = run.budget_status.warn_mode ? ' **[OVER BUDGET]**' : '';
      lines.push(`- Budget: spent ${formatUsd(run.budget_status.spent_usd)}, remaining ${formatUsd(run.budget_status.remaining_usd)}${warnTag}`);
    }

    if (run.created_at) {
      lines.push(`- Started: \`${run.created_at}\``);
    }
    if (run.completed_at) {
      lines.push(`- Completed: \`${run.completed_at}\``);
    }
    if (run.duration_seconds != null) {
      lines.push(`- Duration: \`${run.duration_seconds}s\``);
    }
    if (summarizeRunProvenance(run.provenance)) {
      lines.push(`- Provenance: \`${summarizeRunProvenance(run.provenance)}\``);
    }
    if (run.inherited_context?.parent_run_id) {
      lines.push(`- Inherited from: \`${run.inherited_context.parent_run_id}\` (${run.inherited_context.parent_status || 'unknown'})`);
    }
    if (run.dashboard_session) {
      lines.push(`- Dashboard session: \`${formatDashboardSessionLine(run.dashboard_session)}\``);
    }
    if (run.recent_event_summary) {
      lines.push(`- Recent events: \`${formatRecentEventSummaryLine(run.recent_event_summary)}\``);
      lines.push(`- Latest event: ${formatRecentEventDetail(run.recent_event_summary)}`);
    }

    lines.push(
      `- History entries: ${artifacts.history_entries}`,
      `- Decision entries: ${artifacts.decision_entries}`,
      `- Hook audit entries: ${artifacts.hook_audit_entries}`,
      `- Notification audit entries: ${artifacts.notification_audit_entries}`,
      `- Dispatch files: ${artifacts.dispatch_artifact_files}`,
      `- Staging files: ${artifacts.staging_artifact_files}`,
      `- Intake artifacts: \`${yesNo(artifacts.intake_present)}\``,
      `- Coordinator artifacts: \`${yesNo(artifacts.coordinator_present)}\``,
    );

    if (run.cost_summary) {
      const cs = run.cost_summary;
      lines.push('', '## Cost Summary', '');
      lines.push(`**Total:** ${formatUsd(cs.total_usd)} across ${cs.turn_count} turn${cs.turn_count !== 1 ? 's' : ''} (${cs.costed_turn_count} with cost data)`);
      if (cs.total_input_tokens != null || cs.total_output_tokens != null) {
        lines.push(`**Tokens:** ${formatTokenCount(cs.total_input_tokens)} input / ${formatTokenCount(cs.total_output_tokens)} output`);
      }
      if (cs.by_role.length > 0) {
        lines.push('', '| Role | Cost | Turns | Input Tokens | Output Tokens |', '|------|------|-------|--------------|---------------|');
        for (const r of cs.by_role) {
          lines.push(`| ${r.role} | ${formatUsd(r.usd)} | ${r.turns} | ${formatTokenCount(r.input_tokens)} | ${formatTokenCount(r.output_tokens)} |`);
        }
      }
      if (cs.by_phase.length > 0) {
        lines.push('', '| Phase | Cost | Turns |', '|-------|------|-------|');
        for (const p of cs.by_phase) {
          lines.push(`| ${p.phase} | ${formatUsd(p.usd)} | ${p.turns} |`);
        }
      }
    }

    if (run.delegation_summary?.delegation_chains?.length > 0) {
      lines.push('', '## Delegation Summary', '');
      lines.push(`- Total delegations issued: ${run.delegation_summary.total_delegations_issued}`, '');
      lines.push('| Parent Role | Parent Turn | Outcome | Review Turn | Delegation | Child Turn | Status | Required Decisions | Missing Decisions | Charter |', '|-------------|-------------|---------|-------------|------------|------------|--------|--------------------|-------------------|---------|');
      for (const chain of run.delegation_summary.delegation_chains) {
        for (let i = 0; i < chain.delegations.length; i++) {
          const delegation = chain.delegations[i];
          const parentRole = i === 0 ? chain.parent_role : '';
          const parentTurn = i === 0 ? `\`${chain.parent_turn_id}\`` : '';
          const outcome = i === 0 ? `\`${chain.outcome}\`` : '';
          const reviewTurn = i === 0 ? `\`${chain.review_turn_id || 'pending'}\`` : '';
          const charter = delegation.charter.replace(/\|/g, '\\|');
          const requiredDecisions = (delegation.required_decision_ids || []).join(', ').replace(/\|/g, '\\|') || '—';
          const missingDecisions = (delegation.missing_decision_ids || []).join(', ').replace(/\|/g, '\\|') || '—';
          lines.push(`| ${parentRole} | ${parentTurn} | ${outcome} | ${reviewTurn} | \`${delegation.delegation_id}\` → \`${delegation.to_role}\` | \`${delegation.child_turn_id || 'pending'}\` | \`${delegation.status}\` | ${requiredDecisions} | ${missingDecisions} | ${charter} |`);
        }
      }
    }

    if (run.repo_decisions) {
      lines.push('', '## Repo Decisions', '');
      lines.push(`Active: ${run.repo_decisions.active_count} | Overridden: ${run.repo_decisions.overridden_count}`, '');
      for (const summaryLine of buildRepoDecisionSummaryLines(run.repo_decisions)) {
        lines.push(`${summaryLine}`, '');
      }
      if (run.repo_decisions.active.length > 0) {
        lines.push('| ID | Category | Statement | Role | Authority | Run | Supersedes |', '|----|----------|-----------|------|-----------|-----|------------|');
        for (const d of run.repo_decisions.active) {
          const stmt = (d.statement || '').replace(/\|/g, '\\|');
          const authority = d.authority_level == null ? '—' : `${d.authority_level}${d.authority_source === 'human_default' ? ' (human default)' : ''}`;
          lines.push(`| ${d.id} | ${d.category} | ${stmt} | ${d.role || '—'} | ${authority} | \`${(d.run_id || '').slice(0, 12)}\` | ${d.overrides || '—'} |`);
        }
      }
      if (run.repo_decisions.overridden?.length > 0) {
        lines.push('', 'Overridden decisions:', '');
        lines.push('| ID | Statement | Authority | Overridden By |', '|----|-----------|-----------|---------------|');
        for (const d of run.repo_decisions.overridden) {
          const stmt = (d.statement || '').replace(/\|/g, '\\|');
          const authority = d.authority_level == null ? '—' : `${d.authority_level}${d.authority_source === 'human_default' ? ' (human default)' : ''}`;
          lines.push(`| ${d.id} | ${stmt} | ${authority} | ${d.overridden_by || '—'} |`);
        }
      }
    }

    if (run.turns && run.turns.length > 0) {
      lines.push('', '## Turn Timeline', '', '| # | Role | Phase | Summary | Files | Cost | Time |', '|---|------|-------|---------|-------|------|------|');
      for (let i = 0; i < run.turns.length; i++) {
        const t = run.turns[i];
        const cost = t.cost_usd != null ? formatUsd(t.cost_usd) : 'n/a';
        const phase = t.phase_transition ? `${t.phase || '?'} → ${t.phase_transition}` : (t.phase || '?');
        const summary = (t.summary || '(no summary)').replace(/\|/g, '\\|');
        const siblingNote = Array.isArray(t.sibling_attributed_files) ? ` (${t.sibling_attributed_files.length} sibling)` : '';
        lines.push(`| ${i + 1} | ${t.role} | ${phase} | ${summary} | ${t.files_changed_count}${siblingNote} | ${cost} | ${formatTurnTimelineTime(t).replace(/\|/g, '\\|')} |`);
      }
    }

    if (run.decisions && run.decisions.length > 0) {
      lines.push('', '## Decisions', '');
      for (const d of run.decisions) {
        lines.push(`- **${d.id}** (${d.role || '?'}, ${d.phase || '?'} phase): ${d.statement}`);
      }
    }

    if (run.gate_summary && run.gate_summary.length > 0) {
      lines.push('', '## Gate Outcomes', '');
      for (const gate of run.gate_summary) {
        lines.push(`- \`${gate.gate_id}\`: \`${gate.status}\``);
      }
    }

    if (run.gate_failures && run.gate_failures.length > 0) {
      lines.push('', '## Gate Failures', '');
      for (const failure of run.gate_failures) {
        const request = failure.gate_type === 'run_completion'
          ? 'run completion'
          : `${failure.from_phase || failure.phase || '?'} → ${failure.to_phase || '?'}`;
        lines.push(`- \`${failure.gate_id || 'unknown'}\` (${failure.gate_type || 'unknown'}) at \`${failure.failed_at || 'n/a'}\` via ${failure.queued_request ? 'queued drain' : 'direct'} request: ${request}`);
        for (const reason of failure.reasons || []) {
          lines.push(`  - ${reason}`);
        }
      }
    }

    if (run.approval_policy_events && run.approval_policy_events.length > 0) {
      lines.push('', '## Approval Policy', '');
      for (const evt of run.approval_policy_events) {
        const transition = evt.gate_type === 'run_completion'
          ? 'run completion'
          : `${evt.from_phase || '?'} → ${evt.to_phase || '?'}`;
        const rule = evt.matched_rule ? ` — rule: \`${typeof evt.matched_rule === 'object' ? JSON.stringify(evt.matched_rule) : evt.matched_rule}\`` : '';
        lines.push(`- **${evt.action || 'unknown'}** (${evt.gate_type || 'unknown'}) ${transition}${rule} at \`${evt.timestamp || 'n/a'}\``);
        if (evt.reason) lines.push(`  - ${evt.reason}`);
      }
    }

    if (run.governance_events && run.governance_events.length > 0) {
      lines.push('', '## Governance Events', '');
      for (const evt of run.governance_events) {
        lines.push(`- **${evt.type}** (\`${evt.role || '?'}\`, \`${evt.phase || '?'}\` phase) at \`${evt.timestamp || 'n/a'}\``);
        renderGovernanceEventDetailMarkdown(lines, evt);
      }
    }

    if (run.timeout_events && run.timeout_events.length > 0) {
      lines.push('', '## Timeout Events', '');
      for (const evt of run.timeout_events) {
        const label = evt.type === 'timeout_warning' ? 'Warning'
          : evt.type === 'timeout_skip' ? 'Skip'
          : evt.type === 'timeout_skip_failed' ? 'Skip Failed'
          : 'Escalation';
        const elapsed = evt.elapsed_minutes != null ? `${evt.elapsed_minutes}m` : '?';
        const limit = evt.limit_minutes != null ? `${evt.limit_minutes}m` : '?';
        const exceeded = evt.exceeded_by_minutes != null ? ` (+${evt.exceeded_by_minutes}m)` : '';
        lines.push(`- **${label}** (\`${evt.scope || '?'}\` scope) — ${elapsed}/${limit}${exceeded}, action: \`${evt.action || 'n/a'}\`, phase: \`${evt.phase || 'n/a'}\` at \`${evt.timestamp || 'n/a'}\``);
      }
    }

    if (run.intake_links && run.intake_links.length > 0) {
      lines.push('', '## Intake Linkage', '');
      for (const intake of run.intake_links) {
        lines.push(`- \`${intake.intent_id}\` (${intake.status || 'unknown'}) from event \`${intake.event_id || 'n/a'}\`, target turn \`${intake.target_turn || 'n/a'}\`, started \`${intake.started_at || 'n/a'}\``);
      }
    }

    if (run.hook_summary) {
      lines.push('', '## Hook Activity', '');
      lines.push(`- Total hook executions: ${run.hook_summary.total}`);
      lines.push(`- Blocked: ${run.hook_summary.blocked}`);
      const eventList = Object.entries(run.hook_summary.events).sort(([a], [b]) => a.localeCompare(b, 'en')).map(([e, c]) => `${e}(${c})`).join(', ');
      if (eventList) lines.push(`- Events: ${eventList}`);
    }

    if (run.recovery_summary) {
      lines.push('', '## Recovery', '');
      lines.push(`- Category: \`${run.recovery_summary.category || 'unknown'}\``);
      lines.push(`- Typed reason: \`${run.recovery_summary.typed_reason || 'unknown'}\``);
      lines.push(`- Owner: \`${run.recovery_summary.owner || 'unknown'}\``);
      lines.push(`- Action: \`${run.recovery_summary.recovery_action || 'n/a'}\``);
      lines.push(`- Detail: ${run.recovery_summary.detail || 'n/a'}`);
      lines.push(`- Turn retained: \`${run.recovery_summary.turn_retained == null ? 'n/a' : yesNo(run.recovery_summary.turn_retained)}\``);
      if (Array.isArray(run.recovery_summary.runtime_guidance) && run.recovery_summary.runtime_guidance.length > 0) {
        lines.push('- Runtime guidance:');
        for (const entry of run.recovery_summary.runtime_guidance) {
          lines.push(`  - \`${entry.code}\` — \`${entry.command}\`: ${entry.reason}`);
        }
      }
    }

    if (run.next_actions && run.next_actions.length > 0) {
      lines.push('', '## Next Actions', '');
      for (let i = 0; i < run.next_actions.length; i++) {
        const action = run.next_actions[i];
        lines.push(`${i + 1}. \`${action.command}\`: ${action.reason}`);
      }
    }

    if (run.continuity) {
      lines.push('', '## Continuity', '');
      lines.push(`- Session: \`${run.continuity.session_id || 'unknown'}\``);
      lines.push(`- Checkpoint: \`${run.continuity.checkpoint_reason || 'unknown'}\` at \`${run.continuity.last_checkpoint_at || 'n/a'}\``);
      lines.push(`- Last turn: \`${run.continuity.last_turn_id || 'none'}\``);
      lines.push(`- Last role: \`${run.continuity.last_role || 'unknown'}\``);
      lines.push(`- Last phase: \`${run.continuity.last_phase || 'unknown'}\``);
      if (run.continuity.stale_checkpoint) {
        lines.push(`- **Warning:** checkpoint tracks run \`${run.continuity.run_id}\`, but export tracks \`${run.run_id}\``);
      }
    }

    if (Array.isArray(run.workflow_kit_artifacts) && run.workflow_kit_artifacts.length > 0) {
      lines.push('', '## Workflow Artifacts', '');
      lines.push(`Phase: \`${run.phase || 'unknown'}\``, '');
      lines.push('| Artifact | Required | Semantics | Owner | Resolution | Status |', '|----------|----------|-----------|-------|------------|--------|');
      for (const art of run.workflow_kit_artifacts) {
        const req = art.required ? 'yes' : 'no';
        const sem = art.semantics ? `\`${art.semantics}\`` : 'none';
        const owner = art.owned_by ? `\`${art.owned_by}\`` : 'none';
        const status = art.exists ? 'exists' : '**missing**';
        lines.push(`| \`${art.path}\` | ${req} | ${sem} | ${owner} | ${art.owner_resolution} | ${status} |`);
      }
    }

    return lines.join('\n');
  }

  const {
    coordinator,
    run,
    artifacts,
    repos,
    coordinator_timeline,
    barrier_summary,
    barrier_ledger_timeline,
    decision_digest,
    approval_policy_events,
    governance_events,
    timeout_events,
    recovery_report: coordRecoveryReport,
  } = report.subject;
  const mdLines = [
    '# AgentXchain Governance Report',
    '',
    `- Input: \`${report.input}\``,
    `- Export kind: \`${report.export_kind}\``,
    '- Verification: `pass`',
    `- Workspace: ${coordinator.project_name || 'unknown'} (\`${coordinator.project_id || 'unknown'}\`)`,
    `- Coordinator schema: \`${coordinator.schema_version || 'unknown'}\``,
    `- Super run: \`${run.super_run_id || 'none'}\``,
    `- Status: \`${run.status || 'unknown'}\``,
    `- Phase: \`${run.phase || 'unknown'}\``,
    `- Blocked reason: \`${run.blocked_reason || 'none'}\``,
  ];

  if (run.run_id_mismatches && run.run_id_mismatches.length > 0) {
    mdLines.push(`- **Run ID mismatches: ${run.run_id_mismatches.length}**`);
    for (const m of run.run_id_mismatches) {
      mdLines.push(`  - \`${m.repo_id}\`: expected \`${m.expected_run_id}\`, actual \`${m.actual_run_id}\``);
    }
  }
  if (run.repo_status_drifts && run.repo_status_drifts.length > 0) {
    mdLines.push(`- **Repo status drift: ${run.repo_status_drifts.length}**`);
    for (const drift of run.repo_status_drifts) {
      mdLines.push(`  - \`${drift.repo_id}\`: coordinator \`${drift.coordinator_status || 'unknown'}\`, repo \`${drift.repo_status || 'unknown'}\``);
    }
  }

  mdLines.push(
    `- Started: \`${run.created_at || 'n/a'}\``,
    `- Repos: ${coordinator.repo_count} total, ${run.repo_ok_count} exported cleanly, ${run.repo_error_count} failed`,
    `- Workstreams: ${coordinator.workstream_count}`,
    `- Barriers: ${run.barrier_count}`,
    `- Repo statuses: ${formatStatusCounts(run.repo_status_counts)}`,
    `- History entries: ${artifacts.history_entries}`,
    `- Decision entries: ${artifacts.decision_entries}`,
  );

  if (run.completed_at) {
    mdLines.push(`- Completed: \`${run.completed_at}\``);
  }
  if (run.duration_seconds != null) {
    mdLines.push(`- Duration: \`${run.duration_seconds}s\``);
  }
  if (run.pending_gate) {
    mdLines.push(`- Pending gate: \`${run.pending_gate.gate}\` (\`${run.pending_gate.gate_type}\`)`);
  }
  if (run.recent_coordinator_events) {
    mdLines.push(`- Recent coordinator events: \`${formatRecentEventSummaryLine(run.recent_coordinator_events)}\``);
    mdLines.push(`- Latest coordinator event: ${formatRecentEventDetail(run.recent_coordinator_events)}`);
  }
  if (run.recent_child_repo_events) {
    mdLines.push(`- Recent child repo events: \`${formatRecentEventSummaryLine(run.recent_child_repo_events)}\``);
    mdLines.push(`- Latest child repo event: ${formatRecentEventDetail(run.recent_child_repo_events)}`);
  }
  if (run.terminal_observability_note) {
    mdLines.push(`- Terminal drift note: ${run.terminal_observability_note}`);
  }

  if (run.next_actions && run.next_actions.length > 0) {
    mdLines.push('', '## Next Actions', '');
    for (let i = 0; i < run.next_actions.length; i++) {
      const action = run.next_actions[i];
      mdLines.push(`${i + 1}. \`${action.command}\`: ${action.reason}`);
    }
  }

  if (coordinator_timeline && coordinator_timeline.length > 0) {
    mdLines.push('', '## Coordinator Timeline', '', '| # | Type | Time | Summary |', '|---|------|------|---------|');
    for (let i = 0; i < coordinator_timeline.length; i++) {
      const ev = coordinator_timeline[i];
      const ts = ev.timestamp ? `\`${ev.timestamp}\`` : 'n/a';
      const escapedSummary = ev.summary.replace(/\|/g, '\\|');
      mdLines.push(`| ${i + 1} | \`${ev.type}\` | ${ts} | ${escapedSummary} |`);
    }
  }

  const aggregated_event_timeline = report.subject.aggregated_event_timeline;
  if (aggregated_event_timeline && aggregated_event_timeline.length > 0) {
    mdLines.push('', '## Aggregated Child Repo Events', '', '| Timestamp | Repo | Event Type | Summary |', '|-----------|------|------------|---------|');
    for (const evt of aggregated_event_timeline) {
      const ts = evt.timestamp ? `\`${evt.timestamp}\`` : 'n/a';
      const escapedSummary = evt.summary.replace(/\|/g, '\\|');
      mdLines.push(`| ${ts} | \`${evt.repo_id || '?'}\` | \`${evt.type}\` | ${escapedSummary} |`);
    }
  } else {
    mdLines.push('', '## Aggregated Child Repo Events', '', 'No child repo events.');
  }

  if (barrier_summary && barrier_summary.length > 0) {
    mdLines.push('', '## Barrier Summary', '', '| Barrier | Workstream | Type | Status | Satisfied |', '|---------|------------|------|--------|-----------|');
    for (const b of barrier_summary) {
      mdLines.push(`| \`${b.barrier_id}\` | \`${b.workstream_id || 'unknown'}\` | \`${b.type}\` | \`${b.status}\` | ${b.satisfied_repos.length}/${b.required_repos.length} repos |`);
    }
    const barriersWithDecisions = barrier_summary.filter((b) => b.required_decision_ids_by_repo);
    if (barriersWithDecisions.length > 0) {
      mdLines.push('', '### Decision Requirements');
      for (const b of barriersWithDecisions) {
        mdLines.push('', `**\`${b.barrier_id}\`** decision requirements:`, '', '| Repo | Required | Satisfied |', '|------|----------|-----------|');
        for (const [repo, ids] of Object.entries(b.required_decision_ids_by_repo)) {
          if (!Array.isArray(ids) || ids.length === 0) continue;
          const satisfiedIds = Array.isArray(b.satisfied_decision_ids_by_repo?.[repo]) ? b.satisfied_decision_ids_by_repo[repo] : [];
          const reqStr = ids.map((id) => `\`${id}\``).join(', ');
          const satStr = satisfiedIds.length > 0 ? satisfiedIds.map((id) => `\`${id}\``).join(', ') : '—';
          mdLines.push(`| \`${repo}\` | ${reqStr} | ${satStr} |`);
        }
      }
    }
  }

  if (barrier_ledger_timeline && barrier_ledger_timeline.length > 0) {
    mdLines.push('', '## Barrier Transitions', '', '| # | Time | Barrier | From | To | Summary |', '|---|------|---------|------|----|---------|');
    for (let i = 0; i < barrier_ledger_timeline.length; i++) {
      const t = barrier_ledger_timeline[i];
      const ts = t.timestamp ? `\`${t.timestamp}\`` : 'n/a';
      const escapedSummary = t.summary.replace(/\|/g, '\\|');
      mdLines.push(`| ${i + 1} | ${ts} | \`${t.barrier_id}\` | \`${t.previous_status}\` | \`${t.new_status}\` | ${escapedSummary} |`);
    }
  }

  if (decision_digest && decision_digest.length > 0) {
    mdLines.push('', '## Coordinator Decisions', '');
    for (const d of decision_digest) {
      mdLines.push(`- **${d.id}** (${d.role || '?'}, ${d.phase || '?'} phase): ${d.statement}`);
    }
  }

  if (approval_policy_events && approval_policy_events.length > 0) {
    mdLines.push('', '## Approval Policy', '');
    for (const evt of approval_policy_events) {
      const transition = evt.gate_type === 'run_completion'
        ? 'run completion'
        : `${evt.from_phase || '?'} → ${evt.to_phase || '?'}`;
      const rule = evt.matched_rule ? ` — rule: \`${typeof evt.matched_rule === 'object' ? JSON.stringify(evt.matched_rule) : evt.matched_rule}\`` : '';
      mdLines.push(`- **${evt.action || 'unknown'}** (${evt.gate_type || 'unknown'}) ${transition}${rule} at \`${evt.timestamp || 'n/a'}\``);
      if (evt.reason) mdLines.push(`  - ${evt.reason}`);
    }
  }

  if (governance_events && governance_events.length > 0) {
    mdLines.push('', '## Governance Events', '');
    for (const evt of governance_events) {
      mdLines.push(`- **${evt.type}** (\`${evt.role || '?'}\`, \`${evt.phase || '?'}\` phase) at \`${evt.timestamp || 'n/a'}\``);
      renderGovernanceEventDetailMarkdown(mdLines, evt);
    }
  }

  if (timeout_events && timeout_events.length > 0) {
    mdLines.push('', '## Timeout Events', '');
    for (const evt of timeout_events) {
      const label = evt.type === 'timeout_warning' ? 'Warning'
        : evt.type === 'timeout_skip' ? 'Skip'
        : evt.type === 'timeout_skip_failed' ? 'Skip Failed'
        : 'Escalation';
      const elapsed = evt.elapsed_minutes != null ? `${evt.elapsed_minutes}m` : '?';
      const limit = evt.limit_minutes != null ? `${evt.limit_minutes}m` : '?';
      const exceeded = evt.exceeded_by_minutes != null ? ` (+${evt.exceeded_by_minutes}m)` : '';
      mdLines.push(`- **${label}** (\`${evt.scope || '?'}\` scope) — ${elapsed}/${limit}${exceeded}, action: \`${evt.action || 'n/a'}\`, phase: \`${evt.phase || 'n/a'}\` at \`${evt.timestamp || 'n/a'}\``);
    }
  }

  if (coordRecoveryReport) {
    mdLines.push('', '## Recovery Report', '');
    mdLines.push(`- **Trigger:** ${coordRecoveryReport.trigger || 'n/a'}`);
    mdLines.push(`- **Impact:** ${coordRecoveryReport.impact || 'n/a'}`);
    mdLines.push(`- **Mitigation:** ${coordRecoveryReport.mitigation || 'n/a'}`);
    mdLines.push(`- **Owner:** ${coordRecoveryReport.owner || 'n/a'}`);
    mdLines.push(`- **Exit Condition:** ${coordRecoveryReport.exit_condition || 'n/a'}`);
  }

  mdLines.push('', '## Repo Details', '');
  mdLines.push(...repos.flatMap((repo) => {
    if (!repo.ok) {
      return [`- \`${repo.repo_id}\`: failed export, ${repo.error || 'unknown error'}, path \`${repo.path || 'unknown'}\``];
    }
    const repoLines = [`### ${repo.repo_id}`, '', `- Status: \`${repo.status || 'unknown'}\``, `- Run: \`${repo.run_id || 'none'}\``, `- Phase: \`${repo.phase || 'unknown'}\``, `- Path: \`${repo.path || 'unknown'}\``];
    if (repo.blocked_on) {
      repoLines.push(`- Blocked on: \`${summarizeBlockedOn(repo.blocked_on)}\``);
    }
    if (repo.turns && repo.turns.length > 0) {
      repoLines.push('', '#### Turn Timeline', '', '| # | Role | Phase | Summary | Files | Cost | Time |', '|---|------|-------|---------|-------|------|------|');
      for (let i = 0; i < repo.turns.length; i++) {
        const t = repo.turns[i];
        const cost = t.cost_usd != null ? formatUsd(t.cost_usd) : 'n/a';
        const phase = t.phase_transition ? `${t.phase || '?'} → ${t.phase_transition}` : (t.phase || '?');
        const summary = (t.summary || '(no summary)').replace(/\|/g, '\\|');
        const siblingNote = Array.isArray(t.sibling_attributed_files) ? ` (${t.sibling_attributed_files.length} sibling)` : '';
        repoLines.push(`| ${i + 1} | ${t.role} | ${phase} | ${summary} | ${t.files_changed_count}${siblingNote} | ${cost} | ${formatTurnTimelineTime(t).replace(/\|/g, '\\|')} |`);
      }
    }
    if (repo.decisions && repo.decisions.length > 0) {
      repoLines.push('', '#### Decisions', '');
      for (const d of repo.decisions) {
        repoLines.push(`- **${d.id}** (${d.role || '?'}, ${d.phase || '?'} phase): ${d.statement}`);
      }
    }
    if (repo.gate_summary && repo.gate_summary.length > 0) {
      repoLines.push('', '#### Gate Outcomes', '');
      for (const gate of repo.gate_summary) {
        repoLines.push(`- \`${gate.gate_id}\`: \`${gate.status}\``);
      }
    }
    if (repo.gate_failures && repo.gate_failures.length > 0) {
      repoLines.push('', '#### Gate Failures', '');
      for (const failure of repo.gate_failures) {
        const request = failure.gate_type === 'run_completion'
          ? 'run completion'
          : `${failure.from_phase || failure.phase || '?'} → ${failure.to_phase || '?'}`;
        repoLines.push(`- \`${failure.gate_id || 'unknown'}\` (${failure.gate_type || 'unknown'}) at \`${failure.failed_at || 'n/a'}\` via ${failure.queued_request ? 'queued drain' : 'direct'} request: ${request}`);
        for (const reason of failure.reasons || []) {
          repoLines.push(`  - ${reason}`);
        }
      }
    }
    if (repo.approval_policy_events && repo.approval_policy_events.length > 0) {
      repoLines.push('', '#### Approval Policy', '');
      for (const evt of repo.approval_policy_events) {
        const transition = evt.gate_type === 'run_completion'
          ? 'run completion'
          : `${evt.from_phase || '?'} → ${evt.to_phase || '?'}`;
        const rule = evt.matched_rule ? ` — rule: \`${typeof evt.matched_rule === 'object' ? JSON.stringify(evt.matched_rule) : evt.matched_rule}\`` : '';
        repoLines.push(`- **${evt.action || 'unknown'}** (${evt.gate_type || 'unknown'}) ${transition}${rule} at \`${evt.timestamp || 'n/a'}\``);
        if (evt.reason) repoLines.push(`  - ${evt.reason}`);
      }
    }
    if (repo.governance_events && repo.governance_events.length > 0) {
      repoLines.push('', '#### Governance Events', '');
      for (const evt of repo.governance_events) {
        repoLines.push(`- **${evt.type}** (\`${evt.role || '?'}\`, \`${evt.phase || '?'}\` phase) at \`${evt.timestamp || 'n/a'}\``);
        renderGovernanceEventDetailMarkdown(repoLines, evt);
      }
    }
    if (repo.timeout_events && repo.timeout_events.length > 0) {
      repoLines.push('', '#### Timeout Events', '');
      for (const evt of repo.timeout_events) {
        const label = evt.type === 'timeout_warning' ? 'Warning'
          : evt.type === 'timeout_skip' ? 'Skip'
          : evt.type === 'timeout_skip_failed' ? 'Skip Failed'
          : 'Escalation';
        const elapsed = evt.elapsed_minutes != null ? `${evt.elapsed_minutes}m` : '?';
        const limit = evt.limit_minutes != null ? `${evt.limit_minutes}m` : '?';
        const exceeded = evt.exceeded_by_minutes != null ? ` (+${evt.exceeded_by_minutes}m)` : '';
        repoLines.push(`- **${label}** (\`${evt.scope || '?'}\` scope) — ${elapsed}/${limit}${exceeded}, action: \`${evt.action || 'n/a'}\`, phase: \`${evt.phase || 'n/a'}\` at \`${evt.timestamp || 'n/a'}\``);
      }
    }
    if (repo.hook_summary) {
      repoLines.push('', '#### Hook Activity', '', `- Total: ${repo.hook_summary.total}`, `- Blocked: ${repo.hook_summary.blocked}`);
      const eventList = Object.entries(repo.hook_summary.events).sort(([a], [b]) => a.localeCompare(b, 'en')).map(([e, c]) => `${e}(${c})`).join(', ');
      if (eventList) repoLines.push(`- Events: ${eventList}`);
    }
    if (repo.recovery_summary) {
      repoLines.push('', '#### Recovery', '', `- Category: \`${repo.recovery_summary.category || 'unknown'}\``, `- Typed reason: \`${repo.recovery_summary.typed_reason || 'unknown'}\``, `- Owner: \`${repo.recovery_summary.owner || 'unknown'}\``, `- Action: \`${repo.recovery_summary.recovery_action || 'n/a'}\``);
    }
    if (repo.continuity) {
      repoLines.push('', '#### Continuity', '');
      repoLines.push(`- Session: \`${repo.continuity.session_id || 'unknown'}\``);
      repoLines.push(`- Checkpoint: \`${repo.continuity.checkpoint_reason || 'unknown'}\` at \`${repo.continuity.last_checkpoint_at || 'n/a'}\``);
      repoLines.push(`- Last turn: \`${repo.continuity.last_turn_id || 'none'}\``);
      repoLines.push(`- Last role: \`${repo.continuity.last_role || 'unknown'}\``);
      repoLines.push(`- Last phase: \`${repo.continuity.last_phase || 'unknown'}\``);
      if (repo.continuity.stale_checkpoint) {
        repoLines.push(`- **Warning:** checkpoint tracks run \`${repo.continuity.run_id}\`, but repo export tracks \`${repo.run_id}\``);
      }
    }
    repoLines.push('');
    return repoLines;
  }));
  return mdLines.join('\n');
}

// --- HTML governance report formatter ---

function esc(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function badge(status) {
  const colors = {
    pass: '#22c55e', running: '#3b82f6', completed: '#22c55e',
    failed: '#ef4444', error: '#ef4444', fail: '#ef4444',
    blocked: '#f59e0b', pending: '#a855f7', mixed: '#f59e0b',
    paused: '#6b7280', not_running: '#6b7280', stale: '#f59e0b',
    pid_only: '#f59e0b',
  };
  const color = colors[status] || '#6b7280';
  return `<span style="display:inline-block;padding:2px 8px;border-radius:4px;font-size:0.85em;font-weight:600;color:#fff;background:${color}">${esc(String(status))}</span>`;
}

function htmlTable(headers, rows) {
  const lines = ['<table>', '<thead><tr>'];
  for (const h of headers) lines.push(`<th>${esc(h)}</th>`);
  lines.push('</tr></thead>', '<tbody>');
  for (const row of rows) {
    lines.push('<tr>');
    for (const cell of row) lines.push(`<td>${cell}</td>`);
    lines.push('</tr>');
  }
  lines.push('</tbody>', '</table>');
  return lines.join('');
}

function htmlSection(title, content, level = 2) {
  const tag = `h${level}`;
  return `<${tag}>${esc(title)}</${tag}>\n${content}`;
}

function htmlDl(pairs) {
  const lines = ['<dl>'];
  for (const [label, value] of pairs) {
    lines.push(`<dt>${esc(label)}</dt><dd>${value}</dd>`);
  }
  lines.push('</dl>');
  return lines.join('');
}

const HTML_STYLES = `
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;line-height:1.6;color:#1a1a2e;background:#f8fafc;padding:2rem;max-width:1100px;margin:0 auto}
h1{font-size:1.6rem;margin-bottom:0.5rem;border-bottom:2px solid #e2e8f0;padding-bottom:0.5rem}
h2{font-size:1.2rem;margin-top:2rem;margin-bottom:0.75rem;color:#334155}
h3{font-size:1.05rem;margin-top:1.5rem;margin-bottom:0.5rem;color:#475569}
h4{font-size:0.95rem;margin-top:1rem;margin-bottom:0.4rem;color:#64748b}
dl{display:grid;grid-template-columns:max-content 1fr;gap:0.3rem 1rem;margin-bottom:1rem}
dt{font-weight:600;color:#475569;white-space:nowrap}
dd{color:#1e293b}
table{width:100%;border-collapse:collapse;margin:0.75rem 0 1.5rem;font-size:0.9rem}
th{background:#f1f5f9;font-weight:600;text-align:left;padding:0.5rem 0.75rem;border-bottom:2px solid #cbd5e1;color:#334155}
td{padding:0.4rem 0.75rem;border-bottom:1px solid #e2e8f0}
tr:hover td{background:#f8fafc}
code{font-family:"SF Mono",Menlo,monospace;font-size:0.85em;background:#f1f5f9;padding:1px 4px;border-radius:3px}
.header{display:flex;align-items:center;gap:0.75rem;margin-bottom:1rem}
.header-brand{font-size:0.85rem;color:#64748b}
.meta{background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:1.25rem;margin-bottom:1.5rem}
.section{background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:1.25rem;margin-bottom:1rem}
ul{margin:0.5rem 0;padding-left:1.5rem}
li{margin-bottom:0.25rem}
.warn{color:#d97706;font-weight:600}
@media(prefers-color-scheme:dark){
  body{background:#0f172a;color:#e2e8f0}
  h1{border-bottom-color:#334155}
  h2,h3,h4{color:#94a3b8}
  dt{color:#94a3b8}dd{color:#e2e8f0}
  th{background:#1e293b;border-bottom-color:#475569;color:#cbd5e1}
  td{border-bottom-color:#334155}
  tr:hover td{background:#1e293b}
  code{background:#1e293b}
  .meta,.section{background:#1e293b;border-color:#334155}
  .header-brand{color:#94a3b8}
}
@media print{
  body{background:#fff;color:#000;padding:1rem}
  .meta,.section{border:1px solid #ccc}
  th{background:#eee}
}
`;

function wrapHtml(title, bodyContent) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>${HTML_STYLES}</style>
</head>
<body>
<div class="header">
<h1>AgentXchain Governance Report</h1>
<span class="header-brand">agentxchain.dev</span>
</div>
${bodyContent}
</body>
</html>`;
}

function renderHtmlGovEventDetail(evt) {
  const parts = [];
  switch (evt.type) {
    case 'policy_escalation':
      for (const v of evt.violations || []) {
        parts.push(`<li>Violation: <code>${esc(v.policy_id || '?')}</code> / <code>${esc(v.rule || '?')}</code> — ${esc(v.message || 'n/a')}</li>`);
      }
      break;
    case 'conflict_detected':
      if (evt.conflicting_files?.length > 0) parts.push(`<li>Files: ${evt.conflicting_files.map((f) => `<code>${esc(f)}</code>`).join(', ')}</li>`);
      if (evt.overlap_ratio != null) parts.push(`<li>Overlap: ${(evt.overlap_ratio * 100).toFixed(0)}%</li>`);
      break;
    case 'operator_escalated':
      if (evt.reason) parts.push(`<li>Reason: ${esc(evt.reason)}</li>`);
      if (evt.blocked_on) parts.push(`<li>Blocked on: <code>${esc(evt.blocked_on)}</code></li>`);
      break;
    case 'escalation_resolved':
      if (evt.resolved_via) parts.push(`<li>Resolved via: <code>${esc(evt.resolved_via)}</code></li>`);
      break;
  }
  return parts.length ? `<ul>${parts.join('')}</ul>` : '';
}

function renderRunHtml(report) {
  const { project, run, artifacts } = report.subject;
  const sections = [];

  // Meta section
  const metaPairs = [
    ['Input', `<code>${esc(report.input)}</code>`],
    ['Export kind', `<code>${esc(report.export_kind)}</code>`],
    ['Verification', badge('pass')],
    ['Project', `${esc(project.name || 'unknown')} (<code>${esc(project.id || 'unknown')}</code>)`],
  ];
  if (project.goal) metaPairs.push(['Goal', esc(project.goal)]);
  metaPairs.push(
    ['Template', `<code>${esc(project.template)}</code>`],
    ['Protocol', `<code>${esc(project.protocol_mode || 'unknown')}</code> (schema <code>${esc(project.schema_version || 'unknown')}</code>)`],
    ['Run ID', `<code>${esc(run.run_id || 'none')}</code>`],
    ['Status', badge(run.status || 'unknown')],
    ['Phase', `<code>${esc(run.phase || 'unknown')}</code>`],
    ['Blocked on', `<code>${esc(summarizeBlockedState(run))}</code>`],
    ['Active turns', `${run.active_turn_count}${run.active_turn_ids.length ? ` (${run.active_turn_ids.map((id) => `<code>${esc(id)}</code>`).join(', ')})` : ''}`],
    ['Retained turns', `${run.retained_turn_count}${run.retained_turn_ids.length ? ` (${run.retained_turn_ids.map((id) => `<code>${esc(id)}</code>`).join(', ')})` : ''}`],
    ['Active roles', run.active_roles.length ? run.active_roles.map((r) => `<code>${esc(r)}</code>`).join(', ') : '<code>none</code>'],
  );

  if (run.budget_status) {
    const warnTag = run.budget_status.warn_mode ? ' <span class="warn">[OVER BUDGET]</span>' : '';
    metaPairs.push(['Budget', `spent ${formatUsd(run.budget_status.spent_usd)}, remaining ${formatUsd(run.budget_status.remaining_usd)}${warnTag}`]);
  }
  if (run.created_at) metaPairs.push(['Started', `<code>${esc(run.created_at)}</code>`]);
  if (run.completed_at) metaPairs.push(['Completed', `<code>${esc(run.completed_at)}</code>`]);
  if (run.duration_seconds != null) metaPairs.push(['Duration', `<code>${run.duration_seconds}s</code>`]);
  if (summarizeRunProvenance(run.provenance)) metaPairs.push(['Provenance', `<code>${esc(summarizeRunProvenance(run.provenance))}</code>`]);
  if (run.inherited_context?.parent_run_id) metaPairs.push(['Inherited from', `<code>${esc(run.inherited_context.parent_run_id)}</code> (${esc(run.inherited_context.parent_status || 'unknown')})`]);
  if (run.dashboard_session) metaPairs.push(['Dashboard', `<code>${esc(formatDashboardSessionLine(run.dashboard_session))}</code>`]);
  if (run.recent_event_summary) {
    metaPairs.push(['Recent events', esc(formatRecentEventSummaryLine(run.recent_event_summary))]);
    metaPairs.push(['Latest event', esc(formatRecentEventDetail(run.recent_event_summary))]);
  }

  metaPairs.push(
    ['History entries', String(artifacts.history_entries)],
    ['Decision entries', String(artifacts.decision_entries)],
    ['Hook audit entries', String(artifacts.hook_audit_entries)],
    ['Notification entries', String(artifacts.notification_audit_entries)],
    ['Dispatch files', String(artifacts.dispatch_artifact_files)],
    ['Staging files', String(artifacts.staging_artifact_files)],
    ['Intake artifacts', artifacts.intake_present ? 'yes' : 'no'],
    ['Coordinator artifacts', artifacts.coordinator_present ? 'yes' : 'no'],
  );

  sections.push(`<div class="meta">${htmlDl(metaPairs)}</div>`);

  // Cost Summary
  if (run.cost_summary) {
    const cs = run.cost_summary;
    let costHtml = `<p><strong>Total:</strong> ${formatUsd(cs.total_usd)} across ${cs.turn_count} turn${cs.turn_count !== 1 ? 's' : ''} (${cs.costed_turn_count} with cost data)</p>`;
    if (cs.total_input_tokens != null || cs.total_output_tokens != null) {
      costHtml += `<p><strong>Tokens:</strong> ${formatTokenCount(cs.total_input_tokens)} input / ${formatTokenCount(cs.total_output_tokens)} output</p>`;
    }
    if (cs.by_role.length > 0) {
      costHtml += htmlTable(
        ['Role', 'Cost', 'Turns', 'Input Tokens', 'Output Tokens'],
        cs.by_role.map((r) => [esc(r.role), formatUsd(r.usd), String(r.turns), formatTokenCount(r.input_tokens), formatTokenCount(r.output_tokens)]),
      );
    }
    if (cs.by_phase.length > 0) {
      costHtml += htmlTable(
        ['Phase', 'Cost', 'Turns'],
        cs.by_phase.map((p) => [esc(p.phase), formatUsd(p.usd), String(p.turns)]),
      );
    }
    sections.push(`<div class="section">${htmlSection('Cost Summary', costHtml)}</div>`);
  }

  // Delegation Summary
  if (run.delegation_summary?.delegation_chains?.length > 0) {
    const ds = run.delegation_summary;
    let delHtml = `<p>Total delegations issued: ${ds.total_delegations_issued}</p>`;
    const rows = [];
    for (const chain of ds.delegation_chains) {
      for (let i = 0; i < chain.delegations.length; i++) {
        const d = chain.delegations[i];
        rows.push([
          i === 0 ? esc(chain.parent_role) : '',
          i === 0 ? `<code>${esc(chain.parent_turn_id)}</code>` : '',
          i === 0 ? badge(chain.outcome) : '',
          i === 0 ? `<code>${esc(chain.review_turn_id || 'pending')}</code>` : '',
          `<code>${esc(d.delegation_id)}</code> &rarr; <code>${esc(d.to_role)}</code>`,
          `<code>${esc(d.child_turn_id || 'pending')}</code>`,
          badge(d.status),
          esc((d.required_decision_ids || []).join(', ') || '\u2014'),
          esc((d.missing_decision_ids || []).join(', ') || '\u2014'),
          esc(d.charter),
        ]);
      }
    }
    delHtml += htmlTable(['Parent Role', 'Parent Turn', 'Outcome', 'Review Turn', 'Delegation', 'Child Turn', 'Status', 'Required Decisions', 'Missing Decisions', 'Charter'], rows);
    sections.push(`<div class="section">${htmlSection('Delegation Summary', delHtml)}</div>`);
  }

  // Repo Decisions
  if (run.repo_decisions) {
    let rdHtml = `<p>Active: ${run.repo_decisions.active_count} | Overridden: ${run.repo_decisions.overridden_count}</p>`;
    rdHtml += buildRepoDecisionSummaryLines(run.repo_decisions)
      .map((line) => `<p>${esc(line)}</p>`)
      .join('');
    if (run.repo_decisions.active.length > 0) {
      rdHtml += htmlTable(
        ['ID', 'Category', 'Statement', 'Role', 'Authority', 'Run', 'Supersedes'],
        run.repo_decisions.active.map((d) => [
          esc(d.id),
          esc(d.category),
          esc(d.statement || ''),
          esc(d.role || '\u2014'),
          esc(d.authority_level == null ? '\u2014' : `${d.authority_level}${d.authority_source === 'human_default' ? ' (human default)' : ''}`),
          `<code>${esc((d.run_id || '').slice(0, 12))}</code>`,
          esc(d.overrides || '\u2014'),
        ]),
      );
    }
    if (run.repo_decisions.overridden?.length > 0) {
      rdHtml += htmlTable(
        ['ID', 'Statement', 'Authority', 'Overridden By'],
        run.repo_decisions.overridden.map((d) => [
          esc(d.id),
          esc(d.statement || ''),
          esc(d.authority_level == null ? '\u2014' : `${d.authority_level}${d.authority_source === 'human_default' ? ' (human default)' : ''}`),
          esc(d.overridden_by || '\u2014'),
        ]),
      );
    }
    sections.push(`<div class="section">${htmlSection('Repo Decisions', rdHtml)}</div>`);
  }

  // Turn Timeline
  if (run.turns && run.turns.length > 0) {
    const turnRows = run.turns.map((t, i) => {
      const cost = t.cost_usd != null ? formatUsd(t.cost_usd) : 'n/a';
      const phase = t.phase_transition ? `${esc(t.phase || '?')} &rarr; ${esc(t.phase_transition)}` : esc(t.phase || '?');
      const sibNote = Array.isArray(t.sibling_attributed_files) ? ` (${t.sibling_attributed_files.length} sibling)` : '';
      return [String(i + 1), esc(t.role), phase, esc(t.summary || '(no summary)'), `${t.files_changed_count}${sibNote}`, cost, esc(formatTurnTimelineTime(t))];
    });
    sections.push(`<div class="section">${htmlSection('Turn Timeline', htmlTable(['#', 'Role', 'Phase', 'Summary', 'Files', 'Cost', 'Time'], turnRows))}</div>`);
  }

  // Decisions
  if (run.decisions && run.decisions.length > 0) {
    const decList = run.decisions.map((d) => `<li><strong>${esc(d.id)}</strong> (${esc(d.role || '?')}, ${esc(d.phase || '?')} phase): ${esc(d.statement)}</li>`).join('');
    sections.push(`<div class="section">${htmlSection('Decisions', `<ul>${decList}</ul>`)}</div>`);
  }

  // Gate Outcomes
  if (run.gate_summary && run.gate_summary.length > 0) {
    const gateList = run.gate_summary.map((g) => `<li><code>${esc(g.gate_id)}</code>: ${badge(g.status)}</li>`).join('');
    sections.push(`<div class="section">${htmlSection('Gate Outcomes', `<ul>${gateList}</ul>`)}</div>`);
  }

  // Gate Failures
  if (run.gate_failures && run.gate_failures.length > 0) {
    let gfHtml = '<ul>';
    for (const failure of run.gate_failures) {
      const request = failure.gate_type === 'run_completion' ? 'run completion' : `${esc(failure.from_phase || failure.phase || '?')} &rarr; ${esc(failure.to_phase || '?')}`;
      gfHtml += `<li><code>${esc(failure.gate_id || 'unknown')}</code> (${esc(failure.gate_type || 'unknown')}) at <code>${esc(failure.failed_at || 'n/a')}</code>: ${request}`;
      if (failure.reasons?.length) {
        gfHtml += '<ul>' + failure.reasons.map((r) => `<li>${esc(r)}</li>`).join('') + '</ul>';
      }
      gfHtml += '</li>';
    }
    gfHtml += '</ul>';
    sections.push(`<div class="section">${htmlSection('Gate Failures', gfHtml)}</div>`);
  }

  // Approval Policy
  if (run.approval_policy_events && run.approval_policy_events.length > 0) {
    let apHtml = '<ul>';
    for (const evt of run.approval_policy_events) {
      const transition = evt.gate_type === 'run_completion' ? 'run completion' : `${esc(evt.from_phase || '?')} &rarr; ${esc(evt.to_phase || '?')}`;
      apHtml += `<li><strong>${esc(evt.action || 'unknown')}</strong> (${esc(evt.gate_type || 'unknown')}) ${transition} at <code>${esc(evt.timestamp || 'n/a')}</code>`;
      if (evt.reason) apHtml += `<br>${esc(evt.reason)}`;
      apHtml += '</li>';
    }
    apHtml += '</ul>';
    sections.push(`<div class="section">${htmlSection('Approval Policy', apHtml)}</div>`);
  }

  // Governance Events
  if (run.governance_events && run.governance_events.length > 0) {
    let geHtml = '<ul>';
    for (const evt of run.governance_events) {
      geHtml += `<li><strong>${esc(evt.type)}</strong> (<code>${esc(evt.role || '?')}</code>, <code>${esc(evt.phase || '?')}</code> phase) at <code>${esc(evt.timestamp || 'n/a')}</code>${renderHtmlGovEventDetail(evt)}</li>`;
    }
    geHtml += '</ul>';
    sections.push(`<div class="section">${htmlSection('Governance Events', geHtml)}</div>`);
  }

  // Timeout Events
  if (run.timeout_events && run.timeout_events.length > 0) {
    let teHtml = '<ul>';
    for (const evt of run.timeout_events) {
      const label = evt.type === 'timeout_warning' ? 'Warning' : evt.type === 'timeout_skip' ? 'Skip' : evt.type === 'timeout_skip_failed' ? 'Skip Failed' : 'Escalation';
      const elapsed = evt.elapsed_minutes != null ? `${evt.elapsed_minutes}m` : '?';
      const limit = evt.limit_minutes != null ? `${evt.limit_minutes}m` : '?';
      const exceeded = evt.exceeded_by_minutes != null ? ` (+${evt.exceeded_by_minutes}m)` : '';
      teHtml += `<li><strong>${label}</strong> (<code>${esc(evt.scope || '?')}</code> scope) \u2014 ${elapsed}/${limit}${exceeded}, action: <code>${esc(evt.action || 'n/a')}</code>, phase: <code>${esc(evt.phase || 'n/a')}</code> at <code>${esc(evt.timestamp || 'n/a')}</code></li>`;
    }
    teHtml += '</ul>';
    sections.push(`<div class="section">${htmlSection('Timeout Events', teHtml)}</div>`);
  }

  // Intake Linkage
  if (run.intake_links && run.intake_links.length > 0) {
    const ilRows = run.intake_links.map((intake) => [
      `<code>${esc(intake.intent_id)}</code>`,
      badge(intake.status || 'unknown'),
      `<code>${esc(intake.event_id || 'n/a')}</code>`,
      `<code>${esc(intake.target_turn || 'n/a')}</code>`,
      `<code>${esc(intake.started_at || 'n/a')}</code>`,
    ]);
    sections.push(`<div class="section">${htmlSection('Intake Linkage', htmlTable(['Intent', 'Status', 'Event', 'Target Turn', 'Started'], ilRows))}</div>`);
  }

  // Hook Activity
  if (run.hook_summary) {
    const eventList = Object.entries(run.hook_summary.events).sort(([a], [b]) => a.localeCompare(b, 'en')).map(([e, c]) => `${esc(e)}(${c})`).join(', ');
    const hookHtml = htmlDl([
      ['Total executions', String(run.hook_summary.total)],
      ['Blocked', String(run.hook_summary.blocked)],
      ...(eventList ? [['Events', eventList]] : []),
    ]);
    sections.push(`<div class="section">${htmlSection('Hook Activity', hookHtml)}</div>`);
  }

  // Recovery
  if (run.recovery_summary) {
    const rs = run.recovery_summary;
    let recoveryHtml = htmlDl([
      ['Category', `<code>${esc(rs.category || 'unknown')}</code>`],
      ['Typed reason', `<code>${esc(rs.typed_reason || 'unknown')}</code>`],
      ['Owner', `<code>${esc(rs.owner || 'unknown')}</code>`],
      ['Action', `<code>${esc(rs.recovery_action || 'n/a')}</code>`],
      ['Detail', esc(rs.detail || 'n/a')],
      ['Turn retained', rs.turn_retained == null ? 'n/a' : (rs.turn_retained ? 'yes' : 'no')],
    ]);
    if (Array.isArray(rs.runtime_guidance) && rs.runtime_guidance.length > 0) {
      const items = '<ul>' + rs.runtime_guidance.map((entry) =>
        `<li><code>${esc(entry.code)}</code> — <code>${esc(entry.command)}</code>: ${esc(entry.reason)}</li>`
      ).join('') + '</ul>';
      recoveryHtml += htmlSection('Runtime Guidance', items);
    }
    sections.push(`<div class="section">${htmlSection('Recovery', recoveryHtml)}</div>`);
  }

  if (run.next_actions?.length > 0) {
    const nextHtml = '<ol>' + run.next_actions.map((action) =>
      `<li><code>${esc(action.command)}</code>: ${esc(action.reason)}</li>`
    ).join('') + '</ol>';
    sections.push(`<div class="section">${htmlSection('Next Actions', nextHtml)}</div>`);
  }

  // Continuity
  if (run.continuity) {
    const pairs = [
      ['Session', `<code>${esc(run.continuity.session_id || 'unknown')}</code>`],
      ['Checkpoint', `<code>${esc(run.continuity.checkpoint_reason || 'unknown')}</code> at <code>${esc(run.continuity.last_checkpoint_at || 'n/a')}</code>`],
      ['Last turn', `<code>${esc(run.continuity.last_turn_id || 'none')}</code>`],
      ['Last role', `<code>${esc(run.continuity.last_role || 'unknown')}</code>`],
      ['Last phase', `<code>${esc(run.continuity.last_phase || 'unknown')}</code>`],
    ];
    if (run.continuity.stale_checkpoint) {
      pairs.push(['Warning', `<span class="warn">checkpoint tracks run <code>${esc(run.continuity.run_id)}</code>, but export tracks <code>${esc(run.run_id)}</code></span>`]);
    }
    sections.push(`<div class="section">${htmlSection('Continuity', htmlDl(pairs))}</div>`);
  }

  // Workflow Artifacts
  if (Array.isArray(run.workflow_kit_artifacts) && run.workflow_kit_artifacts.length > 0) {
    let waHtml = `<p>Phase: <code>${esc(run.phase || 'unknown')}</code></p>`;
    waHtml += htmlTable(
      ['Artifact', 'Required', 'Semantics', 'Owner', 'Resolution', 'Status'],
      run.workflow_kit_artifacts.map((art) => [
        `<code>${esc(art.path)}</code>`,
        art.required ? 'yes' : 'no',
        art.semantics ? `<code>${esc(art.semantics)}</code>` : 'none',
        art.owned_by ? `<code>${esc(art.owned_by)}</code>` : 'none',
        esc(art.owner_resolution),
        art.exists ? 'exists' : '<strong class="warn">missing</strong>',
      ]),
    );
    sections.push(`<div class="section">${htmlSection('Workflow Artifacts', waHtml)}</div>`);
  }

  return wrapHtml('AgentXchain Governance Report', sections.join('\n'));
}

function renderCoordinatorHtml(report) {
  const { coordinator, run, artifacts, repos, coordinator_timeline, barrier_summary, barrier_ledger_timeline, decision_digest, approval_policy_events, governance_events, timeout_events, recovery_report: coordRecoveryReport } = report.subject;
  const sections = [];

  const metaPairs = [
    ['Input', `<code>${esc(report.input)}</code>`],
    ['Export kind', `<code>${esc(report.export_kind)}</code>`],
    ['Verification', badge('pass')],
    ['Workspace', `${esc(coordinator.project_name || 'unknown')} (<code>${esc(coordinator.project_id || 'unknown')}</code>)`],
    ['Schema', `<code>${esc(coordinator.schema_version || 'unknown')}</code>`],
    ['Super run', `<code>${esc(run.super_run_id || 'none')}</code>`],
    ['Status', badge(run.status || 'unknown')],
    ['Phase', `<code>${esc(run.phase || 'unknown')}</code>`],
    ['Blocked reason', `<code>${esc(run.blocked_reason || 'none')}</code>`],
  ];

  if (run.run_id_mismatches?.length > 0) {
    metaPairs.push(['Run ID mismatches', `<strong class="warn">${run.run_id_mismatches.length}</strong>`]);
  }
  if (run.repo_status_drifts?.length > 0) {
    metaPairs.push(['Repo status drift', `<strong class="warn">${run.repo_status_drifts.length}</strong>`]);
  }

  metaPairs.push(
    ['Started', `<code>${esc(run.created_at || 'n/a')}</code>`],
    ['Repos', `${coordinator.repo_count} total, ${run.repo_ok_count} exported, ${run.repo_error_count} failed`],
    ['Workstreams', String(coordinator.workstream_count)],
    ['Barriers', String(run.barrier_count)],
    ['Repo statuses', formatStatusCounts(run.repo_status_counts)],
    ['History entries', String(artifacts.history_entries)],
    ['Decision entries', String(artifacts.decision_entries)],
  );
  if (run.completed_at) metaPairs.push(['Completed', `<code>${esc(run.completed_at)}</code>`]);
  if (run.duration_seconds != null) metaPairs.push(['Duration', `<code>${run.duration_seconds}s</code>`]);
  if (run.pending_gate) metaPairs.push(['Pending gate', `<code>${esc(run.pending_gate.gate)}</code> (<code>${esc(run.pending_gate.gate_type)}</code>)`]);
  if (run.recent_coordinator_events) {
    metaPairs.push(['Recent coordinator events', esc(formatRecentEventSummaryLine(run.recent_coordinator_events))]);
    metaPairs.push(['Latest coordinator event', esc(formatRecentEventDetail(run.recent_coordinator_events))]);
  }
  if (run.recent_child_repo_events) {
    metaPairs.push(['Recent child repo events', esc(formatRecentEventSummaryLine(run.recent_child_repo_events))]);
    metaPairs.push(['Latest child repo event', esc(formatRecentEventDetail(run.recent_child_repo_events))]);
  }
  if (run.terminal_observability_note) {
    metaPairs.push(['Terminal drift note', esc(run.terminal_observability_note)]);
  }

  sections.push(`<div class="meta">${htmlDl(metaPairs)}</div>`);

  // Next Actions
  if (run.next_actions?.length > 0) {
    const naHtml = '<ol>' + run.next_actions.map((a) => `<li><code>${esc(a.command)}</code>: ${esc(a.reason)}</li>`).join('') + '</ol>';
    sections.push(`<div class="section">${htmlSection('Next Actions', naHtml)}</div>`);
  }

  if (run.repo_status_drifts?.length > 0) {
    const driftRows = run.repo_status_drifts.map((drift) => [
      `<code>${esc(drift.repo_id)}</code>`,
      `<code>${esc(drift.coordinator_status || 'unknown')}</code>`,
      `<code>${esc(drift.repo_status || 'unknown')}</code>`,
    ]);
    sections.push(
      `<div class="section">${htmlSection('Repo Status Drift', htmlTable(['Repo', 'Coordinator', 'Repo Authority'], driftRows))}</div>`,
    );
  }

  // Coordinator Timeline
  if (coordinator_timeline?.length > 0) {
    const tlRows = coordinator_timeline.map((ev, i) => [String(i + 1), `<code>${esc(ev.type)}</code>`, `<code>${esc(ev.timestamp || 'n/a')}</code>`, esc(ev.summary)]);
    sections.push(`<div class="section">${htmlSection('Coordinator Timeline', htmlTable(['#', 'Type', 'Time', 'Summary'], tlRows))}</div>`);
  }

  // Aggregated Child Repo Events
  {
    const aggTimeline = report.subject.aggregated_event_timeline;
    if (aggTimeline?.length > 0) {
      const aggRows = aggTimeline.map((evt) => [
        `<code>${esc(evt.timestamp || 'n/a')}</code>`,
        `<span class="badge" style="background:#4a90d9">${esc(evt.repo_id || '?')}</span>`,
        `<code>${esc(evt.type)}</code>`,
        esc(evt.summary),
      ]);
      sections.push(`<div class="section">${htmlSection('Aggregated Child Repo Events', htmlTable(['Timestamp', 'Repo', 'Event Type', 'Summary'], aggRows))}</div>`);
    } else {
      sections.push(`<div class="section">${htmlSection('Aggregated Child Repo Events', '<p>No child repo events.</p>')}</div>`);
    }
  }

  // Barrier Summary
  if (barrier_summary?.length > 0) {
    const bRows = barrier_summary.map((b) => [
      `<code>${esc(b.barrier_id)}</code>`,
      `<code>${esc(b.workstream_id || 'unknown')}</code>`,
      `<code>${esc(b.type)}</code>`,
      badge(b.status),
      `${b.satisfied_repos.length}/${b.required_repos.length} repos`,
    ]);
    sections.push(`<div class="section">${htmlSection('Barrier Summary', htmlTable(['Barrier', 'Workstream', 'Type', 'Status', 'Satisfied'], bRows))}</div>`);
  }

  // Barrier Transitions
  if (barrier_ledger_timeline?.length > 0) {
    const btRows = barrier_ledger_timeline.map((t, i) => [String(i + 1), `<code>${esc(t.timestamp || 'n/a')}</code>`, `<code>${esc(t.barrier_id)}</code>`, `<code>${esc(t.previous_status)}</code>`, `<code>${esc(t.new_status)}</code>`, esc(t.summary)]);
    sections.push(`<div class="section">${htmlSection('Barrier Transitions', htmlTable(['#', 'Time', 'Barrier', 'From', 'To', 'Summary'], btRows))}</div>`);
  }

  // Coordinator Decisions
  if (decision_digest?.length > 0) {
    const ddList = decision_digest.map((d) => `<li><strong>${esc(d.id)}</strong> (${esc(d.role || '?')}, ${esc(d.phase || '?')} phase): ${esc(d.statement)}</li>`).join('');
    sections.push(`<div class="section">${htmlSection('Coordinator Decisions', `<ul>${ddList}</ul>`)}</div>`);
  }

  // Approval Policy
  if (approval_policy_events?.length > 0) {
    let apHtml = '<ul>';
    for (const evt of approval_policy_events) {
      const transition = evt.gate_type === 'run_completion' ? 'run completion' : `${esc(evt.from_phase || '?')} &rarr; ${esc(evt.to_phase || '?')}`;
      apHtml += `<li><strong>${esc(evt.action || 'unknown')}</strong> (${esc(evt.gate_type || 'unknown')}) ${transition} at <code>${esc(evt.timestamp || 'n/a')}</code>`;
      if (evt.reason) apHtml += `<br>${esc(evt.reason)}`;
      apHtml += '</li>';
    }
    apHtml += '</ul>';
    sections.push(`<div class="section">${htmlSection('Approval Policy', apHtml)}</div>`);
  }

  // Governance Events
  if (governance_events?.length > 0) {
    let geHtml = '<ul>';
    for (const evt of governance_events) {
      geHtml += `<li><strong>${esc(evt.type)}</strong> (<code>${esc(evt.role || '?')}</code>, <code>${esc(evt.phase || '?')}</code> phase) at <code>${esc(evt.timestamp || 'n/a')}</code>${renderHtmlGovEventDetail(evt)}</li>`;
    }
    geHtml += '</ul>';
    sections.push(`<div class="section">${htmlSection('Governance Events', geHtml)}</div>`);
  }

  // Timeout Events
  if (timeout_events?.length > 0) {
    let teHtml = '<ul>';
    for (const evt of timeout_events) {
      const label = evt.type === 'timeout_warning' ? 'Warning' : evt.type === 'timeout_skip' ? 'Skip' : 'Escalation';
      const elapsed = evt.elapsed_minutes != null ? `${evt.elapsed_minutes}m` : '?';
      const limit = evt.limit_minutes != null ? `${evt.limit_minutes}m` : '?';
      teHtml += `<li><strong>${label}</strong> (<code>${esc(evt.scope || '?')}</code>) \u2014 ${elapsed}/${limit}, action: <code>${esc(evt.action || 'n/a')}</code> at <code>${esc(evt.timestamp || 'n/a')}</code></li>`;
    }
    teHtml += '</ul>';
    sections.push(`<div class="section">${htmlSection('Timeout Events', teHtml)}</div>`);
  }

  // Recovery Report
  if (coordRecoveryReport) {
    sections.push(`<div class="section">${htmlSection('Recovery Report', htmlDl([
      ['Trigger', esc(coordRecoveryReport.trigger || 'n/a')],
      ['Impact', esc(coordRecoveryReport.impact || 'n/a')],
      ['Mitigation', esc(coordRecoveryReport.mitigation || 'n/a')],
      ['Owner', esc(coordRecoveryReport.owner || 'n/a')],
      ['Exit Condition', esc(coordRecoveryReport.exit_condition || 'n/a')],
    ]))}</div>`);
  }

  // Repo Details
  if (repos?.length > 0) {
    let repoHtml = '';
    for (const repo of repos) {
      if (!repo.ok) {
        repoHtml += `<h3>${esc(repo.repo_id)}</h3><p>Failed export: ${esc(repo.error || 'unknown error')}, path <code>${esc(repo.path || 'unknown')}</code></p>`;
        continue;
      }
      const repoPairs = [
        ['Status', badge(repo.status || 'unknown')],
        ['Run', `<code>${esc(repo.run_id || 'none')}</code>`],
        ['Phase', `<code>${esc(repo.phase || 'unknown')}</code>`],
        ['Path', `<code>${esc(repo.path || 'unknown')}</code>`],
      ];
      if (repo.blocked_on) repoPairs.push(['Blocked on', `<code>${esc(summarizeBlockedOn(repo.blocked_on))}</code>`]);
      repoHtml += `<h3>${esc(repo.repo_id)}</h3>${htmlDl(repoPairs)}`;

      if (repo.turns?.length > 0) {
        const turnRows = repo.turns.map((t, i) => {
          const cost = t.cost_usd != null ? formatUsd(t.cost_usd) : 'n/a';
          const phase = t.phase_transition ? `${esc(t.phase || '?')} &rarr; ${esc(t.phase_transition)}` : esc(t.phase || '?');
          return [String(i + 1), esc(t.role), phase, esc(t.summary || '(no summary)'), String(t.files_changed_count), cost, esc(formatTurnTimelineTime(t))];
        });
        repoHtml += htmlSection('Turn Timeline', htmlTable(['#', 'Role', 'Phase', 'Summary', 'Files', 'Cost', 'Time'], turnRows), 4);
      }
      if (repo.decisions?.length > 0) {
        repoHtml += htmlSection('Decisions', '<ul>' + repo.decisions.map((d) => `<li><strong>${esc(d.id)}</strong> (${esc(d.role || '?')}, ${esc(d.phase || '?')} phase): ${esc(d.statement)}</li>`).join('') + '</ul>', 4);
      }
      if (repo.gate_summary?.length > 0) {
        repoHtml += htmlSection('Gate Outcomes', '<ul>' + repo.gate_summary.map((g) => `<li><code>${esc(g.gate_id)}</code>: ${badge(g.status)}</li>`).join('') + '</ul>', 4);
      }
      if (repo.gate_failures?.length > 0) {
        let gateFailureHtml = '<ul>';
        for (const failure of repo.gate_failures) {
          const request = failure.gate_type === 'run_completion'
            ? 'run completion'
            : `${esc(failure.from_phase || '?')} &rarr; ${esc(failure.to_phase || '?')}`;
          gateFailureHtml += `<li><code>${esc(failure.gate_id || 'unknown')}</code> (<code>${esc(failure.gate_type || 'unknown')}</code>) at <code>${esc(failure.failed_at || 'n/a')}</code> via ${failure.queued_request ? 'queued drain' : 'direct'} request: ${request}`;
          if (failure.reasons?.length > 0) {
            gateFailureHtml += '<ul>' + failure.reasons.map((reason) => `<li>${esc(reason)}</li>`).join('') + '</ul>';
          }
          gateFailureHtml += '</li>';
        }
        gateFailureHtml += '</ul>';
        repoHtml += htmlSection('Gate Failures', gateFailureHtml, 4);
      }
      if (repo.approval_policy_events?.length > 0) {
        let approvalHtml = '<ul>';
        for (const evt of repo.approval_policy_events) {
          const transition = evt.gate_type === 'run_completion'
            ? 'run completion'
            : `${esc(evt.from_phase || '?')} &rarr; ${esc(evt.to_phase || '?')}`;
          const rule = evt.matched_rule
            ? ` — rule: <code>${esc(typeof evt.matched_rule === 'object' ? JSON.stringify(evt.matched_rule) : evt.matched_rule)}</code>`
            : '';
          approvalHtml += `<li><strong>${esc(evt.action || 'unknown')}</strong> (${esc(evt.gate_type || 'unknown')}) ${transition}${rule} at <code>${esc(evt.timestamp || 'n/a')}</code>`;
          if (evt.reason) approvalHtml += `<br>${esc(evt.reason)}`;
          approvalHtml += '</li>';
        }
        approvalHtml += '</ul>';
        repoHtml += htmlSection('Approval Policy', approvalHtml, 4);
      }
      if (repo.governance_events?.length > 0) {
        let governanceHtml = '<ul>';
        for (const evt of repo.governance_events) {
          governanceHtml += `<li><strong>${esc(evt.type)}</strong> (<code>${esc(evt.role || '?')}</code>, <code>${esc(evt.phase || '?')}</code> phase) at <code>${esc(evt.timestamp || 'n/a')}</code>${renderHtmlGovEventDetail(evt)}</li>`;
        }
        governanceHtml += '</ul>';
        repoHtml += htmlSection('Governance Events', governanceHtml, 4);
      }
      if (repo.timeout_events?.length > 0) {
        let timeoutHtml = '<ul>';
        for (const evt of repo.timeout_events) {
          const label = evt.type === 'timeout_warning' ? 'Warning'
            : evt.type === 'timeout_skip' ? 'Skip'
            : evt.type === 'timeout_skip_failed' ? 'Skip Failed'
            : 'Escalation';
          const elapsed = evt.elapsed_minutes != null ? `${evt.elapsed_minutes}m` : '?';
          const limit = evt.limit_minutes != null ? `${evt.limit_minutes}m` : '?';
          const exceeded = evt.exceeded_by_minutes != null ? ` (+${evt.exceeded_by_minutes}m)` : '';
          timeoutHtml += `<li><strong>${label}</strong> (<code>${esc(evt.scope || '?')}</code> scope) — ${elapsed}/${limit}${exceeded}, action: <code>${esc(evt.action || 'n/a')}</code>, phase: <code>${esc(evt.phase || 'n/a')}</code> at <code>${esc(evt.timestamp || 'n/a')}</code></li>`;
        }
        timeoutHtml += '</ul>';
        repoHtml += htmlSection('Timeout Events', timeoutHtml, 4);
      }
      if (repo.hook_summary) {
        const eventList = Object.entries(repo.hook_summary.events)
          .sort(([left], [right]) => left.localeCompare(right, 'en'))
          .map(([event, count]) => `${esc(event)}(${count})`)
          .join(', ');
        const hookHtml = htmlDl([
          ['Total executions', String(repo.hook_summary.total)],
          ['Blocked', String(repo.hook_summary.blocked)],
          ...(eventList ? [['Events', eventList]] : []),
        ]);
        repoHtml += htmlSection('Hook Activity', hookHtml, 4);
      }
      if (repo.recovery_summary) {
        const recovery = repo.recovery_summary;
        let recoveryHtml = htmlDl([
          ['Category', `<code>${esc(recovery.category || 'unknown')}</code>`],
          ['Typed reason', `<code>${esc(recovery.typed_reason || 'unknown')}</code>`],
          ['Owner', `<code>${esc(recovery.owner || 'unknown')}</code>`],
          ['Action', `<code>${esc(recovery.recovery_action || 'n/a')}</code>`],
          ['Detail', esc(recovery.detail || 'n/a')],
          ['Turn retained', recovery.turn_retained == null ? 'n/a' : (recovery.turn_retained ? 'yes' : 'no')],
        ]);
        if (Array.isArray(recovery.runtime_guidance) && recovery.runtime_guidance.length > 0) {
          recoveryHtml += htmlSection('Runtime Guidance', '<ul>' + recovery.runtime_guidance.map((entry) =>
            `<li><code>${esc(entry.code)}</code> — <code>${esc(entry.command)}</code>: ${esc(entry.reason)}</li>`
          ).join('') + '</ul>', 5);
        }
        repoHtml += htmlSection('Recovery', recoveryHtml, 4);
      }
      if (repo.continuity) {
        const continuityPairs = [
          ['Session', `<code>${esc(repo.continuity.session_id || 'unknown')}</code>`],
          ['Checkpoint', `<code>${esc(repo.continuity.checkpoint_reason || 'unknown')}</code> at <code>${esc(repo.continuity.last_checkpoint_at || 'n/a')}</code>`],
          ['Last turn', `<code>${esc(repo.continuity.last_turn_id || 'none')}</code>`],
          ['Last role', `<code>${esc(repo.continuity.last_role || 'unknown')}</code>`],
          ['Last phase', `<code>${esc(repo.continuity.last_phase || 'unknown')}</code>`],
        ];
        if (repo.continuity.stale_checkpoint) {
          continuityPairs.push(['Warning', `<span class="warn">checkpoint tracks run <code>${esc(repo.continuity.run_id)}</code>, but repo export tracks <code>${esc(repo.run_id)}</code></span>`]);
        }
        repoHtml += htmlSection('Continuity', htmlDl(continuityPairs), 4);
      }
    }
    sections.push(`<div class="section">${htmlSection('Repo Details', repoHtml)}</div>`);
  }

  return wrapHtml('AgentXchain Governance Report — Coordinator', sections.join('\n'));
}

export function formatGovernanceReportHtml(report) {
  if (report.overall === 'error') {
    return wrapHtml('AgentXchain Governance Report — Error', `
      <div class="meta">
        ${htmlDl([['Input', `<code>${esc(report.input)}</code>`], ['Status', badge('error')], ['Message', esc(report.message)]])}
      </div>`);
  }

  if (report.overall === 'fail') {
    const errorList = (report.verification?.errors || []).map((e) => `<li>${esc(e)}</li>`).join('');
    return wrapHtml('AgentXchain Governance Report — Fail', `
      <div class="meta">
        ${htmlDl([['Input', `<code>${esc(report.input)}</code>`], ['Verification', badge('fail')], ['Message', esc(report.message)]])}
      </div>
      ${errorList ? `<div class="section"><h2>Verification Errors</h2><ul>${errorList}</ul></div>` : ''}`);
  }

  if (report.subject?.kind === 'governed_run') {
    return renderRunHtml(report);
  }

  return renderCoordinatorHtml(report);
}
