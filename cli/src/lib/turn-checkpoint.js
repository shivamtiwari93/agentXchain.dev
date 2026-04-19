import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveAcceptedTurnHistoryReference } from './accepted-turn-history.js';
import { emitRunEvent } from './run-events.js';
import { safeWriteJson } from './safe-write.js';
import { normalizeCheckpointableFiles } from './repo-observer.js';

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

export function detectPendingCheckpoint(root, dirtyFiles = []) {
  const actorDirtyFiles = normalizeFilesChanged(dirtyFiles);
  if (actorDirtyFiles.length === 0) return { required: false };

  const resolved = resolveAcceptedTurnHistoryReference(root, null);
  if (!resolved.ok || !resolved.entry) return { required: false };

  const entry = resolved.entry;
  if (entry.checkpoint_sha) return { required: false };

  const turnFiles = normalizeFilesChanged(entry.files_changed);
  if (turnFiles.length === 0) return { required: false };

  const dirtyOutsideTurn = actorDirtyFiles.filter((file) => !turnFiles.includes(file));
  if (dirtyOutsideTurn.length > 0) return { required: false };

  return {
    required: true,
    turn_id: entry.turn_id,
    message: `Accepted turn ${entry.turn_id} is not checkpointed yet. Run agentxchain checkpoint-turn --turn ${entry.turn_id} before assigning the next code-writing turn.`,
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

  const filesChanged = normalizeFilesChanged(entry.files_changed);
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
