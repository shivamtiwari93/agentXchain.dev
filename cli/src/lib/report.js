import { verifyExportArtifact } from './export-verifier.js';

export const GOVERNANCE_REPORT_VERSION = '0.1';

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

  return Object.keys(normalized).length > 0 ? normalized : null;
}

function formatUsd(value) {
  return typeof value === 'number' ? `$${value.toFixed(2)}` : 'n/a';
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
      decisions: Array.isArray(e.decisions) ? e.decisions.map((d) => d?.id || d).filter(Boolean) : [],
      objections: Array.isArray(e.objections) ? e.objections.map((o) => o?.id || o).filter(Boolean) : [],
      cost_usd: typeof e.cost?.total_usd === 'number' ? e.cost.total_usd : null,
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
  return {
    category: blockedReason.category || null,
    typed_reason: recovery.typed_reason || null,
    owner: recovery.owner || null,
    recovery_action: recovery.recovery_action || null,
    detail: recovery.detail || null,
    turn_retained: typeof recovery.turn_retained === 'boolean' ? recovery.turn_retained : null,
    blocked_at: blockedReason.blocked_at || null,
    turn_id: blockedReason.turn_id || null,
  };
}

function summarizeCoordinatorEvent(entry) {
  const type = entry?.type || 'unknown';
  const ts = entry?.timestamp || '';
  switch (type) {
    case 'run_initialized': {
      const repoCount = entry.repo_runs ? Object.keys(entry.repo_runs).length : 0;
      return `Coordinator run initialized with ${repoCount} repo${repoCount !== 1 ? 's' : ''}`;
    }
    case 'turn_dispatched':
      return `Dispatched turn to ${entry.repo_id || 'unknown'} (${entry.role || '?'}) in workstream ${entry.workstream_id || 'unknown'}`;
    case 'acceptance_projection': {
      const turnRef = entry.repo_turn_id ? ` (turn ${entry.repo_turn_id})` : '';
      const summaryText = entry.summary ? ` — ${entry.summary}` : '';
      return `Projected acceptance from ${entry.repo_id || 'unknown'}${turnRef}${summaryText}`;
    }
    case 'context_generated': {
      const upstreamCount = Array.isArray(entry.upstream_repo_ids) ? entry.upstream_repo_ids.length : 0;
      return `Generated cross-repo context for ${entry.target_repo_id || 'unknown'} from ${upstreamCount} upstream repo${upstreamCount !== 1 ? 's' : ''}`;
    }
    case 'phase_transition_requested':
      return `Requested phase transition: ${entry.from || '?'} → ${entry.to || '?'}`;
    case 'phase_transition_approved':
      return `Phase transition approved: ${entry.from || '?'} → ${entry.to || '?'}`;
    case 'run_completion_requested':
      return `Requested run completion (gate: ${entry.gate || 'unknown'})`;
    case 'run_completed':
      return 'Coordinator run completed';
    case 'state_resynced': {
      const resynced = Array.isArray(entry.resynced_repos) ? entry.resynced_repos.length : 0;
      const barrierChanges = Array.isArray(entry.barrier_changes) ? entry.barrier_changes.length : 0;
      return `Resynced state for ${resynced} repo${resynced !== 1 ? 's' : ''}, ${barrierChanges} barrier change${barrierChanges !== 1 ? 's' : ''}`;
    }
    case 'blocked_resolved':
      return `Blocked state resolved: ${entry.from || '?'} → ${entry.to || '?'}`;
    default:
      return `${type} event${ts ? ` at ${ts}` : ''}`;
  }
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

function detectRunIdMismatches(repos, coordinatorRepoRuns) {
  const mismatches = [];
  for (const repo of repos) {
    if (!repo.ok || !repo.run_id) continue;
    const expected = coordinatorRepoRuns[repo.repo_id]?.run_id;
    if (!expected) continue;
    if (expected !== repo.run_id) {
      mismatches.push({
        repo_id: repo.repo_id,
        expected_run_id: expected,
        actual_run_id: repo.run_id,
      });
    }
  }
  return mismatches;
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

function deriveCoordinatorNextActions({ status, blockedReason, pendingGate, repos, coordinatorRepoRuns, runIdMismatches }) {
  const nextActions = [];

  if (status === 'blocked') {
    nextActions.push({
      command: 'agentxchain multi resume',
      reason: `Coordinator is blocked${blockedReason ? `: ${blockedReason}` : ''}. Resume after fixing the underlying issue.`,
    });
    if (runIdMismatches && runIdMismatches.length > 0) {
      for (const m of runIdMismatches) {
        nextActions.push({
          command: `# repo_run_id_mismatch: ${m.repo_id}`,
          reason: `Repo "${m.repo_id}" run identity drifted: coordinator expects "${m.expected_run_id}" but repo has "${m.actual_run_id}". Re-initialize the child repo with the correct run or use multi resume after investigation.`,
        });
      }
    }
    if (pendingGate) {
      nextActions.push({
        command: 'agentxchain multi approve-gate',
        reason: `After resume, approve pending gate "${pendingGate.gate}" (${pendingGate.gate_type}).`,
      });
    }
    return nextActions;
  }

  const driftedRepos = repos
    .filter((repo) => repo.ok)
    .filter((repo) => {
      const coordinatorStatus = coordinatorRepoRuns?.[repo.repo_id]?.status || null;
      return coordinatorStatus && repo.status && coordinatorStatus !== repo.status;
    })
    .map((repo) => repo.repo_id);

  if (driftedRepos.length > 0) {
    nextActions.push({
      command: 'agentxchain multi resync',
      reason: `Coordinator state disagrees with child repo status for: ${driftedRepos.join(', ')}.`,
    });
    return nextActions;
  }

  if (pendingGate) {
    nextActions.push({
      command: 'agentxchain multi approve-gate',
      reason: `Coordinator is waiting on pending gate "${pendingGate.gate}" (${pendingGate.gate_type}).`,
    });
    return nextActions;
  }

  if (status === 'active' || status === 'paused') {
    nextActions.push({
      command: 'agentxchain multi step',
      reason: 'Coordinator has no blocked state or pending gate and can continue.',
    });
  }

  return nextActions;
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
    .map(([barrierId, b]) => ({
      barrier_id: barrierId,
      workstream_id: b.workstream_id || null,
      type: b.type || 'unknown',
      status: b.status || 'unknown',
      required_repos: Array.isArray(b.required_repos) ? b.required_repos : [],
      satisfied_repos: Array.isArray(b.satisfied_repos) ? b.satisfied_repos : [],
    }));
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
  for (const status of Object.values(repoStatuses || {})) {
    const key = status || 'unknown';
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
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
  const hookSummary = extractHookSummary(artifact);
  const timing = computeTiming(artifact, turns);
  const gateSummary = extractGateSummary(artifact);
  const intakeLinks = extractIntakeLinks(artifact);
  const recoverySummary = extractRecoverySummary(artifact);
  const continuity = extractContinuityMetadata(artifact);

  return {
    kind: 'governed_run',
    project: {
      id: artifact.project?.id || null,
      name: artifact.project?.name || null,
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
      active_turn_count: activeTurns.length,
      retained_turn_count: retainedTurns.length,
      active_turn_ids: activeTurns,
      retained_turn_ids: retainedTurns,
      active_roles: activeRoles,
      budget_status: normalizeBudgetStatus(artifact.state?.budget_status),
      created_at: timing.created_at,
      completed_at: timing.completed_at,
      duration_seconds: timing.duration_seconds,
      turns,
      decisions,
      approval_policy_events: approvalPolicyEvents,
      hook_summary: hookSummary,
      gate_summary: gateSummary,
      intake_links: intakeLinks,
      recovery_summary: recoverySummary,
      continuity,
      workflow_kit_artifacts: extractWorkflowKitArtifacts(artifact),
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
  const repoStatuses = artifact.summary?.repo_run_statuses || {};
  const repoStatusCounts = deriveRepoStatusCounts(repoStatuses);
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
  const timing = computeCoordinatorTiming(artifact, coordinatorTimeline);
  const blockedReason = normalizeCoordinatorBlockedReason(coordinatorState.blocked_reason);
  const pendingGate = normalizePendingGate(coordinatorState.pending_gate);
  const runIdMismatches = detectRunIdMismatches(repos, coordinatorState.repo_runs || {});
  const nextActions = deriveCoordinatorNextActions({
    status: artifact.summary?.status || null,
    blockedReason,
    pendingGate,
    repos,
    coordinatorRepoRuns: coordinatorState.repo_runs || {},
    runIdMismatches,
  });

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
      super_run_id: artifact.summary?.super_run_id || null,
      status: artifact.summary?.status || null,
      phase: artifact.summary?.phase || null,
      blocked_reason: blockedReason,
      pending_gate: pendingGate,
      run_id_mismatches: runIdMismatches,
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
    barrier_summary: barrierSummary,
    barrier_ledger_timeline: barrierLedgerTimeline,
    decision_digest: decisionDigest,
    approval_policy_events: coordinatorApprovalPolicyEvents,
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
      lines.push(
        `Budget: spent ${formatUsd(run.budget_status.spent_usd)}, remaining ${formatUsd(run.budget_status.remaining_usd)}`,
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

    if (run.turns && run.turns.length > 0) {
      lines.push('', 'Turn Timeline:');
      for (let i = 0; i < run.turns.length; i++) {
        const t = run.turns[i];
        const cost = t.cost_usd != null ? formatUsd(t.cost_usd) : 'n/a';
        const phase = t.phase_transition ? `${t.phase || '?'} -> ${t.phase_transition}` : (t.phase || '?');
        lines.push(`  ${i + 1}. [${t.role}] ${t.summary || '(no summary)'} | phase: ${phase} | files: ${t.files_changed_count} | cost: ${cost} | ${t.accepted_at || 'n/a'}`);
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

  const { coordinator, run, artifacts, repos, coordinator_timeline, barrier_summary, barrier_ledger_timeline, decision_digest, recovery_report } = report.subject;
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

  if (barrier_summary && barrier_summary.length > 0) {
    lines.push('', 'Barrier Summary:');
    for (const b of barrier_summary) {
      const satisfied = b.satisfied_repos.length;
      const required = b.required_repos.length;
      lines.push(`  - ${b.barrier_id}: ${b.status} (${b.type}, ${satisfied}/${required} repos satisfied, workstream ${b.workstream_id || 'unknown'})`);
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
          repoLines.push(`    ${i + 1}. [${t.role}] ${t.summary || '(no summary)'} | phase: ${phase} | files: ${t.files_changed_count} | cost: ${cost} | ${t.accepted_at || 'n/a'}`);
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
      lines.push(`- Budget: spent ${formatUsd(run.budget_status.spent_usd)}, remaining ${formatUsd(run.budget_status.remaining_usd)}`);
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

    if (run.turns && run.turns.length > 0) {
      lines.push('', '## Turn Timeline', '', '| # | Role | Phase | Summary | Files | Cost | Time |', '|---|------|-------|---------|-------|------|------|');
      for (let i = 0; i < run.turns.length; i++) {
        const t = run.turns[i];
        const cost = t.cost_usd != null ? formatUsd(t.cost_usd) : 'n/a';
        const phase = t.phase_transition ? `${t.phase || '?'} → ${t.phase_transition}` : (t.phase || '?');
        const summary = (t.summary || '(no summary)').replace(/\|/g, '\\|');
        lines.push(`| ${i + 1} | ${t.role} | ${phase} | ${summary} | ${t.files_changed_count} | ${cost} | ${t.accepted_at || 'n/a'} |`);
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

  const { coordinator, run, artifacts, repos, coordinator_timeline, barrier_summary, barrier_ledger_timeline, decision_digest, recovery_report: coordRecoveryReport } = report.subject;
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

  if (barrier_summary && barrier_summary.length > 0) {
    mdLines.push('', '## Barrier Summary', '', '| Barrier | Workstream | Type | Status | Satisfied |', '|---------|------------|------|--------|-----------|');
    for (const b of barrier_summary) {
      mdLines.push(`| \`${b.barrier_id}\` | \`${b.workstream_id || 'unknown'}\` | \`${b.type}\` | \`${b.status}\` | ${b.satisfied_repos.length}/${b.required_repos.length} repos |`);
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
        repoLines.push(`| ${i + 1} | ${t.role} | ${phase} | ${summary} | ${t.files_changed_count} | ${cost} | ${t.accepted_at || 'n/a'} |`);
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
