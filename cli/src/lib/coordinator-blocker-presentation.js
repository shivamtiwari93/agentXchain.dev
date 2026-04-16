import { pushDetail } from './coordinator-presentation-detail.js';
import { getCoordinatorPendingGateDetails } from './coordinator-pending-gate-presentation.js';

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeMessage(value) {
  if (typeof value === 'string') {
    return value;
  }
  if (value == null) {
    return null;
  }
  return JSON.stringify(value);
}

export function getCoordinatorBlockerDetails(blocker) {
  if (!isObject(blocker)) {
    return [];
  }

  const details = [];
  switch (blocker.code) {
    case 'repo_run_id_mismatch':
      pushDetail(details, 'Repo', blocker.repo_id, { mono: true });
      pushDetail(details, 'Expected', blocker.expected_run_id, { mono: true });
      pushDetail(details, 'Actual', blocker.actual_run_id, { mono: true });
      break;
    case 'repo_not_ready':
      pushDetail(details, 'Repo', blocker.repo_id, { mono: true });
      pushDetail(details, 'Current Phase', blocker.current_phase);
      pushDetail(details, 'Required Phase', blocker.required_phase);
      break;
    default:
      break;
  }

  return details;
}

export function summarizeCoordinatorAttention(coordinatorBlockers) {
  if (!isObject(coordinatorBlockers) || coordinatorBlockers.ok === false) {
    return null;
  }

  const active = isObject(coordinatorBlockers.active) ? coordinatorBlockers.active : {};
  const blockers = Array.isArray(active.blockers)
    ? active.blockers.filter((blocker) => isObject(blocker) && blocker.code !== 'no_next_phase')
    : [];
  const nextActions = Array.isArray(coordinatorBlockers.next_actions)
    ? coordinatorBlockers.next_actions.filter((action) => isObject(action))
    : [];

  return {
    title: coordinatorBlockers.mode === 'pending_gate' ? 'Approval Snapshot' : 'Blocker Snapshot',
    active,
    blockers,
    nextActions,
    primaryBlocker: blockers[0] || null,
    primaryAction: nextActions[0] || null,
    additionalBlockerCount: Math.max(0, blockers.length - 1),
    additionalActionCount: Math.max(0, nextActions.length - 1),
  };
}

export function buildCoordinatorAttentionSnapshotPresentation(coordinatorBlockers) {
  const summary = summarizeCoordinatorAttention(coordinatorBlockers);
  if (!summary) {
    return null;
  }

  const details = [];
  pushDetail(details, 'Mode', coordinatorBlockers?.mode);
  if (summary.title === 'Approval Snapshot') {
    details.push(
      ...getCoordinatorPendingGateDetails({
        pendingGate: coordinatorBlockers?.pending_gate,
        active: summary.active,
      }),
    );
  } else {
    pushDetail(details, 'Type', summary.active?.gate_type);
    pushDetail(details, 'Gate', summary.active?.gate_id, { mono: true });
    pushDetail(details, 'Current Phase', summary.active?.current_phase);
    pushDetail(details, 'Target Phase', summary.active?.target_phase);
  }
  if (summary.blockers.length > 0) {
    pushDetail(details, 'Blockers', summary.blockers.length);
  }
  pushDetail(details, 'Primary Blocker', summary.primaryBlocker?.code, { mono: true });

  return {
    title: summary.title,
    subtitle: 'First-glance coordinator attention only. Full blocker diagnostics stay in the Blockers view.',
    details,
    summaryMessage: summary.primaryBlocker
      ? null
      : summary.title === 'Approval Snapshot'
        ? 'All coordinator prerequisites are satisfied. Human approval is the remaining action.'
        : normalizeMessage(coordinatorBlockers?.blocked_reason),
    primaryBlocker: summary.primaryBlocker,
    primaryBlockerDetails: getCoordinatorBlockerDetails(summary.primaryBlocker),
    primaryAction: summary.primaryAction,
    additionalBlockerCount: summary.additionalBlockerCount,
    additionalActionCount: summary.additionalActionCount,
  };
}

export function getCoordinatorAttentionStatusCard(coordinatorBlockers) {
  const summary = summarizeCoordinatorAttention(coordinatorBlockers);
  if (!summary || summary.blockers.length > 0) {
    return null;
  }

  if (summary.title === 'Approval Snapshot') {
    return {
      title: 'Approval Snapshot',
      message: 'All coordinator prerequisites are satisfied. Human approval is the remaining action.',
    };
  }

  return {
    title: 'Gate Clear',
    message: 'The coordinator gate has no outstanding blockers.',
  };
}
