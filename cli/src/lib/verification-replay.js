import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { isOperationalPath } from './repo-observer.js';

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

  const workspaceGuard = createReplayWorkspaceGuard(root);
  try {
    payload.commands = machineEvidence.map((entry, index) => replayEvidenceCommand(root, entry, index, timeoutMs));
    payload.replayed_commands = payload.commands.length;
    payload.matched_commands = payload.commands.filter((entry) => entry.matched).length;
    payload.overall = payload.commands.every((entry) => entry.matched) ? 'match' : 'mismatch';
  } finally {
    payload.workspace_guard = workspaceGuard.cleanup();
  }

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

function createReplayWorkspaceGuard(root) {
  if (!isGitRepo(root)) {
    return {
      cleanup() {
        return { ok: true, restored_files: [], cleanup_error: null };
      },
    };
  }

  const backupDir = mkdtempSync(join(tmpdir(), 'axc-verification-replay-'));
  const beforeState = captureDirtyWorkspaceState(root, backupDir);

  return {
    cleanup() {
      const restoredFiles = new Set();

      try {
        const afterFiles = collectDirtyActorFiles(root);
        const candidateFiles = new Set([...beforeState.files.keys(), ...afterFiles]);

        for (const filePath of candidateFiles) {
          const beforeInfo = beforeState.files.get(filePath);
          const currentMarker = getWorkspaceFileMarker(root, filePath);

          if (beforeInfo) {
            if (currentMarker !== beforeInfo.marker) {
              restorePreReplayPath(root, filePath, beforeInfo);
              restoredFiles.add(filePath);
            }
            continue;
          }

          restoreCleanPath(root, filePath);
          restoredFiles.add(filePath);
        }

        const remainingDrift = detectWorkspaceDrift(root, beforeState.files);
        if (remainingDrift.length > 0) {
          return {
            ok: false,
            restored_files: [...restoredFiles].sort(),
            cleanup_error: `Verification replay left actor-owned workspace drift after cleanup: ${remainingDrift.join(', ')}`,
          };
        }

        return {
          ok: true,
          restored_files: [...restoredFiles].sort(),
          cleanup_error: null,
        };
      } catch (err) {
        return {
          ok: false,
          restored_files: [...restoredFiles].sort(),
          cleanup_error: err?.message || String(err),
        };
      } finally {
        rmSync(backupDir, { recursive: true, force: true });
      }
    },
  };
}

function captureDirtyWorkspaceState(root, backupDir) {
  const files = new Map();
  for (const filePath of collectDirtyActorFiles(root)) {
    const absPath = join(root, filePath);
    const backupPath = join(backupDir, filePath);
    const existed = existsSync(absPath);
    const marker = getWorkspaceFileMarker(root, filePath);

    if (existed) {
      mkdirSync(dirname(backupPath), { recursive: true });
      cpSync(absPath, backupPath, { force: true, recursive: true });
    }

    files.set(filePath, { existed, marker, backupPath });
  }
  return { files };
}

function detectWorkspaceDrift(root, beforeFiles) {
  const afterFiles = collectDirtyActorFiles(root);
  const candidates = new Set([...beforeFiles.keys(), ...afterFiles]);
  const drift = [];

  for (const filePath of candidates) {
    const beforeInfo = beforeFiles.get(filePath);
    const currentMarker = getWorkspaceFileMarker(root, filePath);
    if (beforeInfo) {
      if (currentMarker !== beforeInfo.marker) {
        drift.push(filePath);
      }
      continue;
    }
    drift.push(filePath);
  }

  return drift.sort();
}

function restorePreReplayPath(root, filePath, beforeInfo) {
  const absPath = join(root, filePath);
  if (!beforeInfo.existed) {
    rmSync(absPath, { recursive: true, force: true });
    return;
  }

  rmSync(absPath, { recursive: true, force: true });
  mkdirSync(dirname(absPath), { recursive: true });
  cpSync(beforeInfo.backupPath, absPath, { force: true, recursive: true });
}

function restoreCleanPath(root, filePath) {
  const absPath = join(root, filePath);
  if (isTrackedPath(root, filePath)) {
    execFileSync('git', ['restore', '--source=HEAD', '--staged', '--worktree', '--', filePath], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return;
  }

  rmSync(absPath, { recursive: true, force: true });
}

function collectDirtyActorFiles(root) {
  return [...new Set([
    ...readGitLines(root, ['diff', '--name-only', 'HEAD']),
    ...readGitLines(root, ['diff', '--name-only', '--cached']),
    ...readGitLines(root, ['ls-files', '--others', '--exclude-standard']),
  ])]
    .filter((filePath) => filePath && !isOperationalPath(filePath))
    .sort();
}

function readGitLines(root, args) {
  try {
    const output = execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    return output ? output.split('\n').filter(Boolean) : [];
  } catch {
    return [];
  }
}

function isTrackedPath(root, filePath) {
  try {
    execFileSync('git', ['ls-files', '--error-unmatch', '--', filePath], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return true;
  } catch {
    return false;
  }
}

function isGitRepo(root) {
  try {
    execFileSync('git', ['rev-parse', '--is-inside-work-tree'], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return true;
  } catch {
    return false;
  }
}

function getWorkspaceFileMarker(root, filePath) {
  const absPath = join(root, filePath);
  if (!existsSync(absPath)) {
    return '__deleted__';
  }

  const content = readFileSync(absPath);
  return createHash('sha1').update(content).digest('hex');
}
