import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { queryAcceptedTurnHistory, resolveAcceptedTurnHistoryReference } from './accepted-turn-history.js';
import { emitRunEvent } from './run-events.js';
import { safeWriteJson } from './safe-write.js';
import { checkCleanBaseline, normalizeCheckpointableFiles } from './repo-observer.js';

const STATE_PATH = '.agentxchain/state.json';
const HISTORY_PATH = '.agentxchain/history.jsonl';

function readState(root) {
  const filePath = join(root, STATE_PATH);
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function writeState(root, state) {
  safeWriteJson(join(root, STATE_PATH), state);
}

function readHistoryEntries(root) {
  const filePath = join(root, HISTORY_PATH);
  if (!existsSync(filePath)) return [];
  const raw = readFileSync(filePath, 'utf8').trim();
  if (!raw) return [];
  return raw.split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

function writeHistoryEntries(root, entries) {
  const filePath = join(root, HISTORY_PATH);
  const content = entries.map((entry) => JSON.stringify(entry)).join('\n');
  writeFileSync(filePath, content ? `${content}\n` : '');
}

function git(root, args) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function isGitRepo(root) {
  try {
    return git(root, ['rev-parse', '--is-inside-work-tree']) === 'true';
  } catch {
    return false;
  }
}

function normalizeFilesChanged(filesChanged) {
  return normalizeCheckpointableFiles(filesChanged);
}

function supportsLegacyFilesChangedRecovery(entry) {
  const artifactType = entry?.artifact?.type;
  return artifactType === 'workspace' || artifactType === 'patch';
}

function getActorDirtyFiles(root, dirtyFiles = null) {
  if (Array.isArray(dirtyFiles)) {
    return normalizeFilesChanged(dirtyFiles);
  }
  const cleanCheck = checkCleanBaseline(root, 'authoritative');
  return cleanCheck.clean ? [] : normalizeFilesChanged(cleanCheck.dirty_files);
}

function recoverLegacyCheckpointFiles(root, entry, opts = {}) {
  if (!supportsLegacyFilesChangedRecovery(entry) || entry?.checkpoint_sha) {
    return [];
  }

  const state = readState(root);
  if (state && Object.keys(state.active_turns || {}).length > 0) {
    return [];
  }

  const acceptedHistory = queryAcceptedTurnHistory(root);
  if (acceptedHistory[0]?.turn_id !== entry?.turn_id) {
    return [];
  }

  return getActorDirtyFiles(root, opts.dirtyFiles);
}

function persistRecoveredFilesChanged(root, turnId, recoveredFiles) {
  const normalizedRecoveredFiles = normalizeFilesChanged(recoveredFiles);
  if (normalizedRecoveredFiles.length === 0) return;

  const recoveredAt = new Date().toISOString();
  const nextEntries = readHistoryEntries(root).map((historyEntry) => {
    if (historyEntry.turn_id !== turnId) {
      return historyEntry;
    }

    const observedArtifact = historyEntry?.observed_artifact && typeof historyEntry.observed_artifact === 'object'
      ? historyEntry.observed_artifact
      : null;

    return {
      ...historyEntry,
      files_changed: normalizedRecoveredFiles,
      files_changed_recovered_at: recoveredAt,
      files_changed_recovery_source: 'legacy_dirty_worktree',
      observed_artifact: observedArtifact
        ? {
            ...observedArtifact,
            files_changed: normalizedRecoveredFiles,
          }
        : observedArtifact,
    };
  });

  writeHistoryEntries(root, nextEntries);
}

function extractGitError(err) {
  const stderr = typeof err?.stderr === 'string' ? err.stderr.trim() : '';
  const stdout = typeof err?.stdout === 'string' ? err.stdout.trim() : '';
  return stderr || stdout || err?.message || 'git command failed';
}

function buildCheckpointCommit(entry) {
  const subject = `checkpoint: ${entry.turn_id} (role=${entry.role}, phase=${entry.phase})`;
  const bodyLines = [
    `Summary: ${entry.summary || '(none)'}`,
    `Turn-ID: ${entry.turn_id}`,
    `Role: ${entry.role || '(unknown)'}`,
    `Phase: ${entry.phase || '(unknown)'}`,
    `Runtime: ${entry.runtime_id || '(unknown)'}`,
  ];
  if (entry.intent_id) bodyLines.push(`Intent-ID: ${entry.intent_id}`);
  if (entry.accepted_at) bodyLines.push(`Accepted-At: ${entry.accepted_at}`);
  return { subject, body: bodyLines.join('\n') };
}

function diffMissingDeclaredPaths(declaredFiles, stagedFiles) {
  const stagedSet = new Set((Array.isArray(stagedFiles) ? stagedFiles : []).map((value) => value.trim()).filter(Boolean));
  return (Array.isArray(declaredFiles) ? declaredFiles : []).filter((filePath) => !stagedSet.has(filePath));
}

export function detectPendingCheckpoint(root, dirtyFiles = []) {
  const actorDirtyFiles = normalizeFilesChanged(dirtyFiles);
  if (actorDirtyFiles.length === 0) return { required: false };

  const resolved = resolveAcceptedTurnHistoryReference(root, null);
  if (!resolved.ok || !resolved.entry) return { required: false };

  const entry = resolved.entry;
  if (entry.checkpoint_sha) return { required: false };

  const turnFiles = normalizeFilesChanged(entry.files_changed);
  const recoveredFiles = turnFiles.length === 0
    ? recoverLegacyCheckpointFiles(root, entry, { dirtyFiles: actorDirtyFiles })
    : [];
  const effectiveTurnFiles = turnFiles.length > 0 ? turnFiles : recoveredFiles;
  if (effectiveTurnFiles.length === 0) return { required: false };

  const dirtyOutsideTurn = actorDirtyFiles.filter((file) => !effectiveTurnFiles.includes(file));
  if (dirtyOutsideTurn.length > 0) return { required: false };

  return {
    required: true,
    turn_id: entry.turn_id,
    recovered_files_changed: recoveredFiles.length > 0 ? recoveredFiles : undefined,
    message: recoveredFiles.length > 0
      ? `Accepted turn ${entry.turn_id} has legacy-empty files_changed history but still owns ${recoveredFiles.length} dirty actor file(s). Run agentxchain checkpoint-turn --turn ${entry.turn_id} to recover and checkpoint them.`
      : `Accepted turn ${entry.turn_id} is not checkpointed yet. Run agentxchain checkpoint-turn --turn ${entry.turn_id} before assigning the next code-writing turn.`,
  };
}

export function checkpointAcceptedTurn(root, opts = {}) {
  if (!isGitRepo(root)) {
    return { ok: false, error: 'checkpoint-turn requires a git repository.' };
  }

  const resolved = resolveAcceptedTurnHistoryReference(root, opts.turnId || opts.turn || null);
  if (!resolved.ok || !resolved.entry) {
    return { ok: false, error: resolved.error || 'Accepted turn not found.' };
  }

  const entry = resolved.entry;
  if (entry.checkpoint_sha) {
    return {
      ok: true,
      already_checkpointed: true,
      turn: entry,
      checkpoint_sha: entry.checkpoint_sha,
    };
  }

  const declaredFilesChanged = normalizeFilesChanged(entry.files_changed);
  const recoveredFilesChanged = declaredFilesChanged.length === 0
    ? recoverLegacyCheckpointFiles(root, entry)
    : [];
  const filesChanged = declaredFilesChanged.length > 0
    ? declaredFilesChanged
    : recoveredFilesChanged;
  if (recoveredFilesChanged.length > 0) {
    persistRecoveredFilesChanged(root, entry.turn_id, recoveredFilesChanged);
  }

  if (filesChanged.length === 0) {
    return {
      ok: true,
      skipped: true,
      turn: entry,
      reason: 'Accepted turn has no writable files_changed paths to checkpoint.',
    };
  }

  try {
    git(root, ['add', '-A', '--', ...filesChanged]);
  } catch (err) {
    return {
      ok: false,
      turn: entry,
      error: `Failed to stage accepted files for checkpoint: ${extractGitError(err)}`,
    };
  }

  let staged = [];
  try {
    staged = git(root, ['diff', '--cached', '--name-only', '--', ...filesChanged])
      .split('\n')
      .map((value) => value.trim())
      .filter(Boolean);
  } catch (err) {
    return {
      ok: false,
      turn: entry,
      error: `Failed to inspect staged checkpoint diff: ${extractGitError(err)}`,
    };
  }

  const missingDeclaredPaths = diffMissingDeclaredPaths(filesChanged, staged);
  if (missingDeclaredPaths.length > 0) {
    return {
      ok: false,
      turn: entry,
      error: `Checkpoint completeness failure: accepted turn ${entry.turn_id} declared ${filesChanged.length} checkpointable file(s), but Git staged only ${staged.length}. Missing from checkpoint: ${missingDeclaredPaths.join(', ')}.`,
      missing_declared_paths: missingDeclaredPaths,
      staged_paths: staged,
    };
  }

  if (staged.length === 0) {
    return {
      ok: true,
      skipped: true,
      turn: entry,
      reason: `Accepted turn ${entry.turn_id} has no staged repo changes to checkpoint.`,
    };
  }

  const commit = buildCheckpointCommit(entry);
  try {
    git(root, ['commit', '-m', commit.subject, '-m', commit.body]);
  } catch (err) {
    return {
      ok: false,
      turn: entry,
      error: `Checkpoint commit failed: ${extractGitError(err)}`,
    };
  }

  const checkpointSha = git(root, ['rev-parse', 'HEAD']);
  const checkpointedAt = new Date().toISOString();

  const historyEntries = readHistoryEntries(root).map((historyEntry) => (
    historyEntry.turn_id === entry.turn_id
      ? { ...historyEntry, checkpoint_sha: checkpointSha, checkpointed_at: checkpointedAt }
      : historyEntry
  ));
  writeHistoryEntries(root, historyEntries);

  const state = readState(root);
  if (state) {
    writeState(root, {
      ...state,
      // BUG-49: advance accepted_integration_ref to the new checkpoint SHA
      // so drift detection compares against the current checkpoint, not a
      // stale ref from the parent run or the pre-checkpoint state.
      accepted_integration_ref: `git:${checkpointSha}`,
      last_completed_turn: {
        turn_id: entry.turn_id,
        role: entry.role || null,
        phase: entry.phase || null,
        checkpoint_sha: checkpointSha,
        checkpointed_at: checkpointedAt,
        intent_id: entry.intent_id || null,
      },
    });

    emitRunEvent(root, 'turn_checkpointed', {
      run_id: state.run_id || null,
      phase: state.phase || null,
      status: state.status || null,
      turn: { turn_id: entry.turn_id, role_id: entry.role || null },
      intent_id: entry.intent_id || null,
      payload: { checkpoint_sha: checkpointSha, checkpointed_at: checkpointedAt },
    });
  }

  return {
    ok: true,
    turn: entry,
    checkpoint_sha: checkpointSha,
    checkpointed_at: checkpointedAt,
  };
}
