import { existsSync } from 'fs';
import { join } from 'path';
import { readSessionCheckpoint } from './session-checkpoint.js';

export const SESSION_RECOVERY_PATH = '.agentxchain/SESSION_RECOVERY.md';

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

  return {
    checkpoint,
    stale_checkpoint: staleCheckpoint,
    recovery_report_path: recoveryReportPath,
    restart_recommended: !!state && !['blocked', 'completed', 'failed'].includes(state.status),
  };
}
