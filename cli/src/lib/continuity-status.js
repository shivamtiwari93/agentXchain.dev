import { existsSync } from 'fs';
import { join } from 'path';
import { captureBaselineRef, readSessionCheckpoint } from './session-checkpoint.js';

export const SESSION_RECOVERY_PATH = '.agentxchain/SESSION_RECOVERY.md';

export function deriveRecommendedContinuityAction(state) {
  if (!state) {
    return {
      recommended_command: null,
      recommended_reason: 'no_state',
      recommended_detail: null,
      restart_recommended: false,
    };
  }

  if (state.pending_phase_transition) {
    const pt = state.pending_phase_transition;
    return {
      recommended_command: 'agentxchain approve-transition',
      recommended_reason: 'pending_phase_transition',
      recommended_detail: `${pt.from || 'unknown'} -> ${pt.to || 'unknown'} (gate: ${pt.gate || 'unknown'})`,
      restart_recommended: false,
    };
  }

  if (state.pending_run_completion) {
    const pc = state.pending_run_completion;
    return {
      recommended_command: 'agentxchain approve-completion',
      recommended_reason: 'pending_run_completion',
      recommended_detail: pc.gate ? `gate: ${pc.gate}` : null,
      restart_recommended: false,
    };
  }

  if (state.status === 'failed') {
    return {
      recommended_command: null,
      recommended_reason: 'reserved_terminal_state',
      recommended_detail: 'run-level failed is reserved and not emitted by current governed writers',
      restart_recommended: false,
    };
  }

  if (!['blocked', 'completed'].includes(state.status)) {
    return {
      recommended_command: 'agentxchain restart',
      recommended_reason: 'restart_available',
      recommended_detail: 'rebuild session context from disk',
      restart_recommended: true,
    };
  }

  return {
    recommended_command: null,
    recommended_reason: state.status === 'blocked' ? 'blocked' : 'terminal_state',
    recommended_detail: null,
    restart_recommended: false,
  };
}

function deriveCheckpointDrift(root, checkpoint, staleCheckpoint) {
  if (!checkpoint?.baseline_ref || staleCheckpoint) {
    return {
      drift_detected: null,
      drift_warnings: [],
    };
  }

  const currentBaseline = captureBaselineRef(root);
  const previousBaseline = checkpoint.baseline_ref;

  if (
    currentBaseline.git_head == null
    && currentBaseline.git_branch == null
    && currentBaseline.workspace_dirty == null
  ) {
    return {
      drift_detected: null,
      drift_warnings: [],
    };
  }

  const driftWarnings = [];

  if (
    previousBaseline.git_head
    && currentBaseline.git_head
    && previousBaseline.git_head !== currentBaseline.git_head
  ) {
    driftWarnings.push(
      `Git HEAD has moved since checkpoint: ${previousBaseline.git_head.slice(0, 8)} -> ${currentBaseline.git_head.slice(0, 8)}`
    );
  }

  if (
    previousBaseline.git_branch
    && currentBaseline.git_branch
    && previousBaseline.git_branch !== currentBaseline.git_branch
  ) {
    driftWarnings.push(`Branch changed since checkpoint: ${previousBaseline.git_branch} -> ${currentBaseline.git_branch}`);
  }

  if (
    previousBaseline.workspace_dirty === false
    && currentBaseline.workspace_dirty === true
  ) {
    driftWarnings.push('Workspace was clean at checkpoint but is now dirty');
  }

  return {
    drift_detected: driftWarnings.length > 0,
    drift_warnings: driftWarnings,
  };
}

export function getContinuityStatus(root, state) {
  const checkpoint = readSessionCheckpoint(root);
  const recoveryReportPath = existsSync(join(root, SESSION_RECOVERY_PATH))
    ? SESSION_RECOVERY_PATH
    : null;

  if (!checkpoint && !recoveryReportPath) return null;

  const staleCheckpoint = !!(
    checkpoint?.run_id
    && state?.run_id
    && checkpoint.run_id !== state.run_id
  );

  const action = deriveRecommendedContinuityAction(state);
  const drift = deriveCheckpointDrift(root, checkpoint, staleCheckpoint);

  return {
    checkpoint,
    stale_checkpoint: staleCheckpoint,
    recovery_report_path: recoveryReportPath,
    restart_recommended: action.restart_recommended,
    recommended_command: action.recommended_command,
    recommended_reason: action.recommended_reason,
    recommended_detail: action.recommended_detail,
    drift_detected: drift.drift_detected,
    drift_warnings: drift.drift_warnings,
  };
}
