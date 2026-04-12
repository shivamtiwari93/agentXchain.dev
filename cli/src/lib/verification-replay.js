import { spawnSync } from 'node:child_process';

export const DEFAULT_VERIFICATION_REPLAY_TIMEOUT_MS = 30_000;

export function replayVerificationMachineEvidence({ root, verification, timeoutMs = DEFAULT_VERIFICATION_REPLAY_TIMEOUT_MS }) {
  const verifiedAt = new Date().toISOString();
  const machineEvidence = Array.isArray(verification?.machine_evidence)
    ? verification.machine_evidence
    : [];

  const payload = {
    verified_at: verifiedAt,
    timeout_ms: timeoutMs,
    overall: 'not_reproducible',
    replayed_commands: 0,
    matched_commands: 0,
    commands: [],
  };

  if (machineEvidence.length === 0) {
    payload.reason = 'No verification.machine_evidence commands were declared. commands/evidence_summary are not executable proof.';
    return payload;
  }

  payload.commands = machineEvidence.map((entry, index) => replayEvidenceCommand(root, entry, index, timeoutMs));
  payload.replayed_commands = payload.commands.length;
  payload.matched_commands = payload.commands.filter((entry) => entry.matched).length;
  payload.overall = payload.commands.every((entry) => entry.matched) ? 'match' : 'mismatch';

  return payload;
}

export function replayEvidenceCommand(root, entry, index, timeoutMs = DEFAULT_VERIFICATION_REPLAY_TIMEOUT_MS) {
  const result = spawnSync(entry.command, {
    cwd: root,
    encoding: 'utf8',
    shell: true,
    timeout: timeoutMs,
    maxBuffer: 1024 * 1024,
  });

  const timedOut = result.error?.code === 'ETIMEDOUT';
  const actualExitCode = Number.isInteger(result.status) ? result.status : null;
  const errorMessage = result.error?.message || null;

  return {
    index,
    command: entry.command,
    declared_exit_code: entry.exit_code,
    actual_exit_code: actualExitCode,
    matched: actualExitCode === entry.exit_code,
    timed_out: timedOut,
    signal: result.signal || null,
    error: errorMessage,
  };
}

export function summarizeVerificationReplay(payload) {
  if (!payload) {
    return null;
  }

  return {
    verified_at: payload.verified_at || null,
    overall: payload.overall,
    replayed_commands: payload.replayed_commands || 0,
    matched_commands: payload.matched_commands || 0,
    timeout_ms: payload.timeout_ms || DEFAULT_VERIFICATION_REPLAY_TIMEOUT_MS,
    ...(payload.reason ? { reason: payload.reason } : {}),
  };
}
