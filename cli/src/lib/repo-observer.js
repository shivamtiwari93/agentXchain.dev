/**
 * Repo observation utilities — orchestrator-derived artifact truth.
 *
 * These functions give the orchestrator an independent view of what actually
 * changed in the repo, instead of trusting agent self-reporting.
 *
 * Design rules (§15, Session #15 decision freezes):
 *   - For workspace and review artifacts, the orchestrator is the source
 *     of truth for what actually changed and what ref is accepted.
 *   - Baseline is captured at assignment time; observed diff is computed
 *     at acceptance time.
 *   - accepted_integration_ref is always derived from orchestrator observation.
 */

import { execSync } from 'child_process';
import { createHash } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

// ── Orchestrator-Owned Operational Paths ────────────────────────────────────
// These paths are written by the orchestrator during dispatch/accept cycles.
// They must never be attributed to agents in observation or baseline checks.
// Frozen per Session #19 decision.

const OPERATIONAL_PATH_PREFIXES = [
  '.agentxchain/dispatch/',
  '.agentxchain/staging/',
  '.agentxchain/locks/',
  '.agentxchain/transactions/',
];

// Orchestrator-owned state files that agents must never be blamed for modifying.
// These are written exclusively by the orchestrator (§4.1 State Ownership Rule).
const ORCHESTRATOR_STATE_FILES = [
  '.agentxchain/state.json',
  '.agentxchain/history.jsonl',
  '.agentxchain/decision-ledger.jsonl',
  '.agentxchain/lock.json',
  '.agentxchain/hook-audit.jsonl',
  '.agentxchain/hook-annotations.jsonl',
];

/**
 * Check whether a file path belongs to orchestrator-owned operational state.
 * These paths are excluded from actor-attributed observation.
 */
export function isOperationalPath(filePath) {
  return OPERATIONAL_PATH_PREFIXES.some(prefix => filePath.startsWith(prefix))
    || ORCHESTRATOR_STATE_FILES.includes(filePath);
}

// ── Baseline Capture ────────────────────────────────────────────────────────

/**
 * Capture a baseline snapshot of the repo at turn assignment time.
 * This gives acceptance a stable "before" view.
 *
 * @param {string} root — project root directory
 * @returns {{ kind: string, head_ref: string|null, clean: boolean, captured_at: string }}
 */
export function captureBaseline(root) {
  const now = new Date().toISOString();

  if (!isGitRepo(root)) {
    return {
      kind: 'no_git',
      head_ref: null,
      clean: true,
      captured_at: now,
      dirty_snapshot: {},
    };
  }

  const headRef = getHeadRef(root);
  const clean = isWorkingTreeClean(root);

  return {
    kind: 'git_worktree',
    head_ref: headRef,
    clean,
    captured_at: now,
    dirty_snapshot: clean ? {} : captureDirtyWorkspaceSnapshot(root),
  };
}

// ── Observed Diff ───────────────────────────────────────────────────────────

/**
 * Compute the set of files that actually changed since the baseline.
 * Uses git diff against the baseline HEAD ref, plus any untracked files.
 *
 * @param {string} root — project root directory
 * @param {object} baseline — the baseline captured at assignment time
 * @returns {{ files_changed: string[], head_ref: string|null, diff_summary: string|null }}
 */
export function observeChanges(root, baseline) {
  if (!isGitRepo(root) || (baseline && baseline.kind === 'no_git')) {
    // Non-git project — no observation possible
    return { files_changed: [], head_ref: null, diff_summary: null };
  }

  const currentHead = getHeadRef(root);
  const untrackedFiles = getUntrackedFiles(root);

  // Strategy: compare against baseline head_ref if available,
  // otherwise detect all uncommitted changes (staged + unstaged + untracked)
  let changedFiles = [];
  let diffSummary = null;

  if (baseline?.head_ref && baseline.head_ref === currentHead) {
    // Same commit — changes are in working tree / staging area
    changedFiles = getWorkingTreeChanges(root);
    changedFiles = filterBaselineDirtyFiles(root, changedFiles, baseline);
    diffSummary = buildObservedDiffSummary(getWorkingTreeDiffSummary(root), untrackedFiles);
  } else if (baseline?.head_ref) {
    // New commits exist — get files changed since baseline ref
    changedFiles = getCommittedChanges(root, baseline.head_ref);
    // Also include any uncommitted working tree changes
    const workingChanges = getWorkingTreeChanges(root);
    for (const f of workingChanges) {
      if (!changedFiles.includes(f)) changedFiles.push(f);
    }
    diffSummary = buildObservedDiffSummary(getDiffSummary(root, baseline.head_ref), untrackedFiles);
  } else {
    // No baseline ref — fall back to working tree changes only
    changedFiles = getWorkingTreeChanges(root);
    diffSummary = buildObservedDiffSummary(getWorkingTreeDiffSummary(root), untrackedFiles);
  }

  // Filter out orchestrator-owned operational paths (Session #19 freeze)
  const actorFiles = changedFiles.filter(f => !isOperationalPath(f));

  return {
    files_changed: actorFiles.sort(),
    head_ref: currentHead,
    diff_summary: diffSummary,
  };
}

/**
 * Classify observed file changes into added, modified, and deleted.
 *
 * Uses git diff-filter when a baseline ref is available; falls back to
 * heuristic classification (untracked → added, missing → deleted, else modified)
 * when working from working-tree-only observation.
 *
 * @param {string} root — project root
 * @param {object} observation — from observeChanges()
 * @param {object} baseline — from captureBaseline()
 * @returns {{ added: string[], modified: string[], deleted: string[] }}
 */
export function classifyObservedChanges(root, observation, baseline) {
  const files = observation.files_changed || [];
  if (files.length === 0) {
    return { added: [], modified: [], deleted: [] };
  }

  // If we have a baseline ref, use git diff-filter for accurate classification
  if (baseline?.head_ref && isGitRepo(root)) {
    const added = new Set();
    const modified = new Set();
    const deleted = new Set();

    try {
      const diffAdded = getFilteredChanges(root, baseline.head_ref, 'A');
      const diffModified = getFilteredChanges(root, baseline.head_ref, 'M');
      const diffDeleted = getFilteredChanges(root, baseline.head_ref, 'D');

      for (const f of diffAdded) added.add(f);
      for (const f of diffModified) modified.add(f);
      for (const f of diffDeleted) deleted.add(f);
    } catch {
      // Fall through to heuristic
    }

    // Untracked files are always "added"
    try {
      const untracked = getUntrackedFiles(root);
      for (const f of untracked) {
        if (files.includes(f)) added.add(f);
      }
    } catch {
      // Ignore
    }

    // Working tree changes not in the committed diff — use heuristic
    for (const f of files) {
      if (!added.has(f) && !modified.has(f) && !deleted.has(f)) {
        if (existsSync(join(root, f))) {
          modified.add(f);
        } else {
          deleted.add(f);
        }
      }
    }

    const fileSet = new Set(files);
    return {
      added: [...added].filter(f => fileSet.has(f)).sort(),
      modified: [...modified].filter(f => fileSet.has(f)).sort(),
      deleted: [...deleted].filter(f => fileSet.has(f)).sort(),
    };
  }

  // No baseline ref — heuristic classification
  const added = [];
  const modified = [];
  const deleted = [];

  for (const f of files) {
    if (!existsSync(join(root, f))) {
      deleted.push(f);
    } else {
      try {
        execSync(`git ls-files --error-unmatch -- "${f}"`, {
          cwd: root,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        });
        modified.push(f);
      } catch {
        added.push(f);
      }
    }
  }

  return { added: added.sort(), modified: modified.sort(), deleted: deleted.sort() };
}

/**
 * Get files matching a specific diff-filter from baseline ref to HEAD/working tree.
 */
function getFilteredChanges(root, baseRef, filter) {
  try {
    const result = execSync(`git diff --name-only --diff-filter=${filter} ${baseRef}`, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return result ? result.split('\n').filter(Boolean) : [];
  } catch {
    return [];
  }
}

/**
 * Build the orchestrator-derived observed artifact record.
 * This is what gets stored in history, not the actor's self-report.
 *
 * @param {object} observation — from observeChanges()
 * @param {object} baseline — from captureBaseline()
 * @returns {object}
 */
export function buildObservedArtifact(observation, baseline) {
  return {
    derived_by: 'orchestrator',
    baseline_ref: baseline?.head_ref ? `git:${baseline.head_ref}` : null,
    accepted_ref: observation.head_ref ? `git:${observation.head_ref}` : 'workspace:dirty',
    files_changed: observation.files_changed,
    diff_summary: observation.diff_summary,
  };
}

// ── Verification Normalization ──────────────────────────────────────────────

/**
 * Normalize the actor-supplied verification status based on runtime type
 * and evidence quality.
 *
 * Normalization rules (spec §5.3):
 *   - manual + external pass → attested_pass
 *   - local_cli + pass + machine evidence all zero → pass
 *   - local_cli + pass + no reproducible evidence → not_reproducible
 *   - any external fail → fail
 *   - external skipped → skipped
 *
 * @param {object} verification — the actor-supplied verification object
 * @param {string} runtimeType — 'manual' | 'local_cli' | 'api_proxy'
 * @returns {{ status: string, reason: string, reproducible: boolean }}
 */
export function normalizeVerification(verification, runtimeType) {
  const externalStatus = verification?.status || 'skipped';

  if (externalStatus === 'fail') {
    return { status: 'fail', reason: 'Agent reported verification failure', reproducible: false };
  }

  if (externalStatus === 'skipped') {
    return { status: 'skipped', reason: 'Agent skipped verification', reproducible: false };
  }

  // externalStatus === 'pass'
  if (runtimeType === 'manual') {
    return { status: 'attested_pass', reason: 'Manual runtime — human attested pass', reproducible: false };
  }

  if (runtimeType === 'api_proxy') {
    return { status: 'attested_pass', reason: 'API proxy runtime — no direct execution environment', reproducible: false };
  }

  // local_cli — check for machine evidence
  const evidence = verification?.machine_evidence;
  if (Array.isArray(evidence) && evidence.length > 0) {
    const allZero = evidence.every(e => typeof e.exit_code === 'number' && e.exit_code === 0);
    if (allZero) {
      return { status: 'pass', reason: 'local_cli turn provided machine evidence with zero exit codes', reproducible: true };
    }
    return { status: 'not_reproducible', reason: 'local_cli turn has machine evidence with non-zero exit codes despite claiming pass', reproducible: false };
  }

  // local_cli + pass but no machine evidence
  return { status: 'not_reproducible', reason: 'local_cli turn claimed pass but provided no machine evidence', reproducible: false };
}

// ── Declared vs Observed Comparison ─────────────────────────────────────────

/**
 * Compare declared files_changed against observed files_changed.
 * Returns errors for mismatches.
 *
 * @param {string[]} declared — files_changed from the turn result
 * @param {string[]} observed — files_changed from observeChanges()
 * @param {string} writeAuthority — 'authoritative' | 'proposed' | 'review_only'
 * @returns {{ errors: string[], warnings: string[] }}
 */
export function compareDeclaredVsObserved(declared, observed, writeAuthority) {
  const errors = [];
  const warnings = [];

  const declaredSet = new Set(declared || []);
  const observedSet = new Set(observed || []);

  // Files the agent changed but didn't declare
  const undeclared = [...observedSet].filter(f => !declaredSet.has(f));
  // Files the agent declared but didn't actually change
  const phantom = [...declaredSet].filter(f => !observedSet.has(f));

  if (writeAuthority === 'authoritative') {
    if (undeclared.length > 0) {
      errors.push(`Undeclared file changes detected (observed but not in files_changed): ${undeclared.join(', ')}`);
    }
    if (phantom.length > 0) {
      warnings.push(`Declared files not observed in actual diff: ${phantom.join(', ')}`);
    }
  }

  if (writeAuthority === 'review_only') {
    // Review-only roles must not touch product files, even if undeclared
    const productFileChanges = observed.filter(f => !isAllowedReviewPath(f));
    if (productFileChanges.length > 0) {
      errors.push(`review_only role modified product files (observed in actual diff): ${productFileChanges.join(', ')}`);
    }
  }

  return { errors, warnings };
}

// ── Integration Ref Derivation ──────────────────────────────────────────────

/**
 * Derive the accepted_integration_ref from orchestrator observation.
 * Never copied from actor JSON for workspace or review artifacts.
 *
 * @param {object} observation — from observeChanges()
 * @param {string} artifactType — 'workspace' | 'patch' | 'commit' | 'review'
 * @param {string|null} currentRef — current accepted_integration_ref from state
 * @returns {string}
 */
export function deriveAcceptedRef(observation, artifactType, currentRef) {
  if (artifactType === 'workspace' || artifactType === 'review') {
    // Always derive from observed state
    if (observation.head_ref) {
      return `git:${observation.head_ref}`;
    }
    return 'workspace:dirty';
  }

  // For patch/commit, the ref was validated during artifact application
  // but we still prefer the observed head
  if (observation.head_ref) {
    return `git:${observation.head_ref}`;
  }

  return currentRef || 'unknown';
}

// ── Clean Baseline Check ────────────────────────────────────────────────────

/**
 * Check if the repo is clean enough for a code-writing turn.
 *
 * v1 rule: before assigning an authoritative or proposed turn,
 * the repo must be clean relative to the current accepted integration ref.
 *
 * @param {string} root — project root directory
 * @param {string} writeAuthority — 'authoritative' | 'proposed' | 'review_only'
 * @returns {{ clean: boolean, reason?: string }}
 */
export function checkCleanBaseline(root, writeAuthority) {
  if (writeAuthority === 'review_only') {
    return { clean: true };
  }

  if (!isGitRepo(root)) {
    // Non-git projects skip the clean baseline check
    return { clean: true };
  }

  // Check if all dirty files are orchestrator-owned operational paths.
  // If only operational paths are dirty, the baseline is still clean for actor purposes.
  const dirtyFiles = getWorkingTreeChanges(root);
  const actorDirtyFiles = dirtyFiles.filter(f => !isOperationalPath(f));

  if (actorDirtyFiles.length === 0) return { clean: true };

  return {
    clean: false,
    reason: `Working tree has uncommitted changes in actor-owned files: ${actorDirtyFiles.slice(0, 5).join(', ')}${actorDirtyFiles.length > 5 ? '...' : ''}. Authoritative/proposed turns require a clean baseline in v1. Commit or stash those changes before assigning the next code-writing turn.`,
  };
}

// ── Git Primitives ──────────────────────────────────────────────────────────

function isGitRepo(root) {
  try {
    execSync('git rev-parse --is-inside-work-tree', {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return true;
  } catch {
    return false;
  }
}

function getHeadRef(root) {
  try {
    return execSync('git rev-parse HEAD', {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

function isWorkingTreeClean(root) {
  try {
    const status = execSync('git status --porcelain', {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return status === '';
  } catch {
    return false;
  }
}

function getWorkingTreeChanges(root) {
  try {
    // Staged + unstaged tracked changes
    const tracked = execSync('git diff --name-only HEAD', {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();

    // Staged changes (for files added with git add)
    const staged = execSync('git diff --name-only --cached', {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();

    // Untracked files
    const untracked = execSync('git ls-files --others --exclude-standard', {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();

    const all = new Set();
    for (const line of [tracked, staged, untracked]) {
      for (const f of line.split('\n').filter(Boolean)) {
        all.add(f);
      }
    }
    return [...all];
  } catch {
    return [];
  }
}

function captureDirtyWorkspaceSnapshot(root) {
  const snapshot = {};
  for (const filePath of getWorkingTreeChanges(root).filter((filePath) => !isOperationalPath(filePath))) {
    snapshot[filePath] = getWorkspaceFileMarker(root, filePath);
  }
  return snapshot;
}

function filterBaselineDirtyFiles(root, changedFiles, baseline) {
  const snapshot = baseline?.dirty_snapshot;
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    return changedFiles;
  }

  return changedFiles.filter((filePath) => {
    if (!(filePath in snapshot)) {
      return true;
    }
    return snapshot[filePath] !== getWorkspaceFileMarker(root, filePath);
  });
}

function getWorkspaceFileMarker(root, filePath) {
  const absPath = join(root, filePath);
  if (!existsSync(absPath)) {
    return 'deleted';
  }

  try {
    const content = readFileSync(absPath);
    return `sha256:${createHash('sha256').update(content).digest('hex')}`;
  } catch {
    return 'unreadable';
  }
}

function getUntrackedFiles(root) {
  try {
    const result = execSync('git ls-files --others --exclude-standard', {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return result ? result.split('\n').filter(Boolean) : [];
  } catch {
    return [];
  }
}

function getCommittedChanges(root, baseRef) {
  try {
    const result = execSync(`git diff --name-only ${baseRef}`, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return result ? result.split('\n').filter(Boolean) : [];
  } catch {
    return [];
  }
}

function getWorkingTreeDiffSummary(root) {
  try {
    return execSync('git diff --stat HEAD', {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim() || null;
  } catch {
    return null;
  }
}

function getDiffSummary(root, baseRef) {
  try {
    return execSync(`git diff --stat ${baseRef}`, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim() || null;
  } catch {
    return null;
  }
}

function buildObservedDiffSummary(baseSummary, untrackedFiles) {
  const untrackedSummary = untrackedFiles.length > 0
    ? ['Untracked files:', ...untrackedFiles.map((filePath) => `  - ${filePath}`)].join('\n')
    : null;

  if (baseSummary && untrackedSummary) {
    return `${baseSummary}\n${untrackedSummary}`;
  }

  return baseSummary || untrackedSummary;
}

function isAllowedReviewPath(filePath) {
  return filePath.startsWith('.planning/') || filePath.startsWith('.agentxchain/reviews/') || isOperationalPath(filePath);
}
