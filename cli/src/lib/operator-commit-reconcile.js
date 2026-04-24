import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { emitRunEvent } from './run-events.js';
import { captureBaselineRef, readSessionCheckpoint, SESSION_PATH } from './session-checkpoint.js';
import { safeWriteJson } from './safe-write.js';

const STATE_PATH = '.agentxchain/state.json';
const CRITICAL_DELETION_PATHS = new Set([
  '.planning/acceptance-matrix.md',
]);

// Files under .agentxchain/ that are documentation or operator-customizable
// configuration, NOT core governed state. Modifications to these should not
// block operator-commit reconciliation.
const RECONCILE_SAFE_AGENTXCHAIN_PATHS = new Set([
  '.agentxchain/SESSION_RECOVERY.md',
]);
const RECONCILE_SAFE_AGENTXCHAIN_PREFIXES = [
  '.agentxchain/prompts/',
];

function git(root, args) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function gitOk(root, args) {
  try {
    execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return true;
  } catch {
    return false;
  }
}

function extractGitError(err) {
  const stderr = typeof err?.stderr === 'string' ? err.stderr.trim() : '';
  const stdout = typeof err?.stdout === 'string' ? err.stdout.trim() : '';
  return stderr || stdout || err?.message || 'git command failed';
}

function readState(root) {
  const statePath = join(root, STATE_PATH);
  if (!existsSync(statePath)) return null;
  try {
    return JSON.parse(readFileSync(statePath, 'utf8'));
  } catch {
    return null;
  }
}

function normalizeGitRef(ref) {
  if (typeof ref !== 'string') return null;
  const trimmed = ref.trim();
  if (!trimmed) return null;
  return trimmed.startsWith('git:') ? trimmed.slice(4).trim() || null : trimmed;
}

function resolvePreviousBaseline(state, session) {
  return (
    normalizeGitRef(session?.baseline_ref?.git_head)
    || normalizeGitRef(state?.accepted_integration_ref)
    || normalizeGitRef(state?.last_completed_turn?.checkpoint_sha)
    || null
  );
}

function parseNameStatus(raw) {
  if (!raw.trim()) return [];
  return raw.split('\n').filter(Boolean).map((line) => {
    const parts = line.split('\t');
    const status = parts[0] || '';
    const paths = parts.slice(1).filter(Boolean);
    return { status, paths };
  });
}

function listCommitPaths(root, sha) {
  const raw = git(root, ['diff-tree', '--no-commit-id', '--name-status', '-r', sha]);
  return parseNameStatus(raw);
}

function summarizeCommit(root, sha) {
  const subject = git(root, ['log', '-1', '--format=%s', sha]);
  const entries = listCommitPaths(root, sha);
  const paths = [...new Set(entries.flatMap((entry) => entry.paths))].sort();
  return {
    sha,
    subject,
    paths_touched: paths,
    name_status: entries,
  };
}

function isReconcileSafeAgentxchainPath(pathName) {
  if (RECONCILE_SAFE_AGENTXCHAIN_PATHS.has(pathName)) return true;
  for (const prefix of RECONCILE_SAFE_AGENTXCHAIN_PREFIXES) {
    if (pathName.startsWith(prefix)) return true;
  }
  return false;
}

function classifyUnsafeCommit(commit) {
  for (const entry of commit.name_status) {
    for (const pathName of entry.paths) {
      if (pathName === '.agentxchain' || pathName.startsWith('.agentxchain/')) {
        if (!isReconcileSafeAgentxchainPath(pathName)) {
          return {
            error_class: 'governance_state_modified',
            message: `Commit ${commit.sha.slice(0, 8)} modifies governed state path ${pathName}; reconcile cannot auto-accept .agentxchain edits.`,
            commit: commit.sha,
            path: pathName,
          };
        }
      }
      if (entry.status.startsWith('D') && CRITICAL_DELETION_PATHS.has(pathName)) {
        return {
          error_class: 'critical_artifact_deleted',
          message: `Commit ${commit.sha.slice(0, 8)} deletes critical governed evidence ${pathName}; restore the artifact or restart from an explicit recovery point.`,
          commit: commit.sha,
          path: pathName,
        };
      }
    }
  }
  return null;
}

function writeSessionBaseline(root, state, previousBaseline, acceptedHead, acceptedCommits) {
  const existing = readSessionCheckpoint(root) || {};
  const checkpoint = {
    ...existing,
    run_id: state?.run_id || existing.run_id || null,
    last_checkpoint_at: new Date().toISOString(),
    checkpoint_reason: 'operator_commit_reconciled',
    run_status: state?.status || existing.run_status || null,
    phase: state?.phase || state?.current_phase || existing.phase || null,
    last_phase: state?.phase || state?.current_phase || existing.last_phase || null,
    last_completed_turn_id: state?.last_completed_turn_id || existing.last_completed_turn_id || null,
    baseline_ref: captureBaselineRef(root),
    operator_commit_reconciliation: {
      previous_baseline: previousBaseline,
      accepted_head: acceptedHead,
      commit_count: acceptedCommits.length,
    },
  };
  writeFileSync(join(root, SESSION_PATH), JSON.stringify(checkpoint, null, 2) + '\n');
}

export function reconcileOperatorHead(root, opts = {}) {
  let currentHead;
  try {
    if (git(root, ['rev-parse', '--is-inside-work-tree']) !== 'true') {
      return { ok: false, error_class: 'not_git_repo', error: 'reconcile-state requires a git repository.' };
    }
    currentHead = git(root, ['rev-parse', 'HEAD']);
  } catch (err) {
    return { ok: false, error_class: 'git_unavailable', error: `Unable to inspect git HEAD: ${extractGitError(err)}` };
  }

  const state = readState(root);
  const session = readSessionCheckpoint(root);
  const previousBaseline = resolvePreviousBaseline(state, session);
  if (!previousBaseline) {
    return {
      ok: false,
      error_class: 'missing_baseline',
      error: 'No prior checkpoint baseline found in session.json, state.accepted_integration_ref, or last_completed_turn.checkpoint_sha.',
    };
  }

  if (previousBaseline === currentHead) {
    return {
      ok: true,
      no_op: true,
      previous_baseline: previousBaseline,
      accepted_head: currentHead,
      accepted_commits: [],
    };
  }

  if (!gitOk(root, ['merge-base', '--is-ancestor', previousBaseline, currentHead])) {
    return {
      ok: false,
      error_class: 'history_rewrite',
      error: `Cannot reconcile operator HEAD: baseline ${previousBaseline.slice(0, 8)} is not an ancestor of current HEAD ${currentHead.slice(0, 8)}.`,
      previous_baseline: previousBaseline,
      current_head: currentHead,
    };
  }

  let shas;
  try {
    shas = git(root, ['rev-list', '--reverse', `${previousBaseline}..${currentHead}`])
      .split('\n')
      .map((value) => value.trim())
      .filter(Boolean);
  } catch (err) {
    return { ok: false, error_class: 'commit_walk_failed', error: `Failed to inspect operator commits: ${extractGitError(err)}` };
  }

  const commits = shas.map((sha) => summarizeCommit(root, sha));
  for (const commit of commits) {
    const unsafe = classifyUnsafeCommit(commit);
    if (unsafe) {
      return {
        ok: false,
        error_class: unsafe.error_class,
        error: unsafe.message,
        offending_commit: unsafe.commit,
        offending_path: unsafe.path,
        previous_baseline: previousBaseline,
        current_head: currentHead,
      };
    }
  }

  const acceptedAt = new Date().toISOString();
  const pathsTouched = [...new Set(commits.flatMap((commit) => commit.paths_touched))].sort();
  const nextState = state
    ? {
        ...state,
        accepted_integration_ref: `git:${currentHead}`,
        operator_commit_reconciliation: {
          reconciled_at: acceptedAt,
          previous_baseline: previousBaseline,
          accepted_head: currentHead,
          commit_count: commits.length,
          safety_mode: opts.safetyMode || 'manual_safe_only',
        },
      }
    : null;

  if (nextState) {
    safeWriteJson(join(root, STATE_PATH), nextState);
  }

  emitRunEvent(root, 'state_reconciled_operator_commits', {
    run_id: state?.run_id || null,
    phase: state?.phase || state?.current_phase || null,
    status: state?.status || null,
    payload: {
      previous_baseline: previousBaseline,
      accepted_head: currentHead,
      accepted_commits: commits.map((commit) => ({
        sha: commit.sha,
        subject: commit.subject,
        paths_touched: commit.paths_touched,
      })),
      paths_touched: pathsTouched,
      safety_checks: {
        baseline_is_ancestor: true,
        rejected_state_paths: ['.agentxchain/'],
        reconcile_safe_paths: [...RECONCILE_SAFE_AGENTXCHAIN_PATHS],
        reconcile_safe_prefixes: [...RECONCILE_SAFE_AGENTXCHAIN_PREFIXES],
        rejected_deletions: [...CRITICAL_DELETION_PATHS],
      },
    },
  });

  writeSessionBaseline(root, nextState || state, previousBaseline, currentHead, commits);

  return {
    ok: true,
    previous_baseline: previousBaseline,
    accepted_head: currentHead,
    accepted_commits: commits.map((commit) => ({
      sha: commit.sha,
      subject: commit.subject,
      paths_touched: commit.paths_touched,
    })),
    paths_touched: pathsTouched,
  };
}
