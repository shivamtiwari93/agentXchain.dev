const TURN_RUNNING_PROOF_STREAMS = new Set(['stdout', 'request', 'staged_result']);

export function isKnownTurnRunningProofStream(stream) {
  return typeof stream === 'string' && TURN_RUNNING_PROOF_STREAMS.has(stream);
}

export function isPersistedTurnStartupProofStream(stream) {
  if (stream == null) {
    // Legacy states may have first_output_at without a tagged stream.
    return true;
  }
  return isKnownTurnRunningProofStream(stream);
}

export function isDispatchProgressProofOutputStream(stream) {
  return stream === 'stdout';
}

export function isDispatchProgressDiagnosticStream(stream) {
  return stream === 'stderr';
}
