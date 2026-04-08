/**
 * Proposal operations: list, diff, apply, reject.
 *
 * Proposals live at .agentxchain/proposed/<turn_id>/ and are created during
 * acceptGovernedTurn() for api_proxy turns with proposed write authority.
 * This module provides the operator surface for acting on those proposals.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, unlinkSync, statSync } from 'fs';
import { join, dirname, relative } from 'path';
import { execFileSync } from 'child_process';
import { createHash } from 'crypto';
import { LEDGER_PATH } from './governed-state.js';

const PROPOSED_DIR = '.agentxchain/proposed';
const HISTORY_PATH = '.agentxchain/history.jsonl';
const SOURCE_SNAPSHOT_FILE = 'SOURCE_SNAPSHOT.json';

function appendLedgerEntry(root, entry) {
  const filePath = join(root, LEDGER_PATH);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(entry) + '\n', { flag: 'a' });
}

/**
 * List all proposals with their status.
 * Returns: { ok, proposals: [{ turn_id, role, file_count, status, summary }] }
 */
export function listProposals(root) {
  const proposedDir = join(root, PROPOSED_DIR);
  if (!existsSync(proposedDir)) {
    return { ok: true, proposals: [] };
  }

  const entries = readdirSync(proposedDir, { withFileTypes: true })
    .filter((d) => d.isDirectory());

  const proposals = [];
  for (const entry of entries) {
    const turnDir = join(proposedDir, entry.name);
    const proposalMd = join(turnDir, 'PROPOSAL.md');
    if (!existsSync(proposalMd)) continue;

    const content = readFileSync(proposalMd, 'utf8');
    const role = extractField(content, 'Role') || '(unknown)';
    const fileActions = extractFileActions(content);

    let status = 'pending';
    if (existsSync(join(turnDir, 'APPLIED.json'))) status = 'applied';
    else if (existsSync(join(turnDir, 'REJECTED.json'))) status = 'rejected';

    proposals.push({
      turn_id: entry.name,
      role,
      file_count: fileActions.length,
      status,
      files: fileActions,
    });
  }

  return { ok: true, proposals };
}

/**
 * Compute diff between proposed files and current workspace.
 * Returns: { ok, diffs: [{ path, action, has_workspace, preview }] }
 */
export function diffProposal(root, turnId, filterFile) {
  const validation = validateProposalDir(root, turnId);
  if (!validation.ok) return validation;

  const { turnDir, fileActions } = validation;
  const targets = filterFile
    ? fileActions.filter((f) => f.path === filterFile)
    : fileActions;

  if (filterFile && targets.length === 0) {
    return { ok: false, error: `File ${filterFile} is not part of proposal ${turnId}` };
  }

  const diffs = [];
  for (const file of targets) {
    const workspacePath = join(root, file.path);
    const proposedPath = join(turnDir, file.path);
    const hasWorkspace = existsSync(workspacePath);

    let preview = '';
    if (file.action === 'delete') {
      preview = hasWorkspace ? `--- ${file.path}\n+++ /dev/null\n(file would be deleted)` : '(file already absent)';
    } else {
      const proposedContent = existsSync(proposedPath) ? readFileSync(proposedPath, 'utf8') : '';
      if (!hasWorkspace) {
        preview = `--- /dev/null\n+++ ${file.path}\n(new file, ${proposedContent.split('\n').length} lines)`;
      } else {
        const currentContent = readFileSync(workspacePath, 'utf8');
        if (currentContent === proposedContent) {
          preview = '(no changes — contents identical)';
        } else {
          preview = buildSimpleDiff(file.path, currentContent, proposedContent);
        }
      }
    }

    diffs.push({ path: file.path, action: file.action, has_workspace: hasWorkspace, preview });
  }

  return { ok: true, diffs };
}

/**
 * Apply a proposal to the workspace.
 * Returns: { ok, applied_files, skipped_files, dry_run }
 */
export function applyProposal(root, turnId, opts = {}) {
  const validation = validateProposalDir(root, turnId);
  if (!validation.ok) return validation;

  const { turnDir, fileActions } = validation;

  if (existsSync(join(turnDir, 'APPLIED.json'))) {
    return { ok: false, error: `Proposal ${turnId} has already been applied` };
  }
  if (existsSync(join(turnDir, 'REJECTED.json'))) {
    return { ok: false, error: `Proposal ${turnId} has already been rejected` };
  }

  const targets = opts.file
    ? fileActions.filter((f) => f.path === opts.file)
    : fileActions;

  if (opts.file && targets.length === 0) {
    return { ok: false, error: `File ${opts.file} is not part of proposal ${turnId}` };
  }

  const conflictCheck = detectProposalApplyConflicts(root, turnId, turnDir, targets);
  if (!conflictCheck.ok) {
    return conflictCheck;
  }
  if (conflictCheck.conflicts.length > 0 && !opts.force) {
    const conflictedPaths = conflictCheck.conflicts.map((conflict) => conflict.path);
    return {
      ok: false,
      error: `Proposal ${turnId} conflicts with the current workspace for: ${conflictedPaths.join(', ')}. Re-run with --force to override.`,
      error_code: 'proposal_conflict',
      conflicts: conflictCheck.conflicts,
    };
  }

  if (opts.dryRun) {
    return {
      ok: true,
      applied_files: targets.map((f) => f.path),
      skipped_files: [],
      dry_run: true,
      forced: Boolean(opts.force),
      overridden_conflicts: conflictCheck.conflicts,
    };
  }

  const applied = [];
  const skipped = [];

  for (const file of targets) {
    const workspacePath = join(root, file.path);
    const proposedPath = join(turnDir, file.path);

    if (file.action === 'delete') {
      if (existsSync(workspacePath)) {
        unlinkSync(workspacePath);
        applied.push(file.path);
      } else {
        skipped.push(file.path);
      }
    } else {
      if (!existsSync(proposedPath)) {
        skipped.push(file.path);
        continue;
      }
      mkdirSync(dirname(workspacePath), { recursive: true });
      writeFileSync(workspacePath, readFileSync(proposedPath));
      applied.push(file.path);
    }
  }

  const appliedRecord = {
    applied_at: new Date().toISOString(),
    files: applied,
    selective: Boolean(opts.file),
    forced: Boolean(opts.force),
    overridden_conflicts: conflictCheck.conflicts,
  };
  writeFileSync(join(turnDir, 'APPLIED.json'), JSON.stringify(appliedRecord, null, 2) + '\n');

  appendLedgerEntry(root, {
    id: `DEC-PROP-APPLY-${turnId}`,
    category: 'proposal',
    action: 'applied',
    turn_id: turnId,
    files: applied,
    selective: Boolean(opts.file),
    forced: Boolean(opts.force),
    overridden_conflicts: conflictCheck.conflicts,
    timestamp: appliedRecord.applied_at,
  });

  return {
    ok: true,
    applied_files: applied,
    skipped_files: skipped,
    dry_run: false,
    forced: Boolean(opts.force),
    overridden_conflicts: conflictCheck.conflicts,
  };
}

/**
 * Reject a proposal.
 * Returns: { ok }
 */
export function rejectProposal(root, turnId, reason) {
  const validation = validateProposalDir(root, turnId);
  if (!validation.ok) return validation;

  const { turnDir } = validation;

  if (existsSync(join(turnDir, 'APPLIED.json'))) {
    return { ok: false, error: `Proposal ${turnId} has already been applied` };
  }
  if (existsSync(join(turnDir, 'REJECTED.json'))) {
    return { ok: false, error: `Proposal ${turnId} has already been rejected` };
  }
  if (!reason || !reason.trim()) {
    return { ok: false, error: '--reason is required to reject a proposal' };
  }

  const now = new Date().toISOString();
  const rejectedRecord = {
    rejected_at: now,
    reason: reason.trim(),
  };
  writeFileSync(join(turnDir, 'REJECTED.json'), JSON.stringify(rejectedRecord, null, 2) + '\n');

  appendLedgerEntry(root, {
    id: `DEC-PROP-REJECT-${turnId}`,
    category: 'proposal',
    action: 'rejected',
    turn_id: turnId,
    reason: reason.trim(),
    timestamp: now,
  });

  return { ok: true };
}

// --- Internal helpers ---

function validateProposalDir(root, turnId) {
  const turnDir = join(root, PROPOSED_DIR, turnId);
  if (!existsSync(turnDir)) {
    return { ok: false, error: `No proposal found for turn ${turnId}` };
  }
  const proposalMd = join(turnDir, 'PROPOSAL.md');
  if (!existsSync(proposalMd)) {
    return { ok: false, error: `Proposal ${turnId} is malformed (missing PROPOSAL.md)` };
  }
  const content = readFileSync(proposalMd, 'utf8');
  const fileActions = extractFileActions(content);
  return { ok: true, turnDir, fileActions, content };
}

function detectProposalApplyConflicts(root, turnId, turnDir, targets) {
  const sourceSnapshots = loadProposalSourceSnapshots(root, turnId, turnDir, targets);
  const conflicts = [];

  for (const file of targets) {
    const source = sourceSnapshots.get(file.path);
    if (!source) {
      conflicts.push({
        path: file.path,
        action: file.action,
        reason: 'missing_source_snapshot',
      });
      continue;
    }

    const current = getWorkspaceFingerprint(root, file.path);
    if (file.action === 'delete') {
      if (!current.exists || fingerprintsMatch(current, source)) {
        continue;
      }
      conflicts.push({
        path: file.path,
        action: file.action,
        reason: 'workspace_diverged',
      });
      continue;
    }

    const proposed = getProposedFingerprint(turnDir, file.path);
    if (fingerprintsMatch(current, proposed) || fingerprintsMatch(current, source)) {
      continue;
    }
    conflicts.push({
      path: file.path,
      action: file.action,
      reason: 'workspace_diverged',
    });
  }

  return { ok: true, conflicts };
}

function loadProposalSourceSnapshots(root, turnId, turnDir, targets) {
  const snapshotPath = join(turnDir, SOURCE_SNAPSHOT_FILE);
  if (existsSync(snapshotPath)) {
    try {
      const parsed = JSON.parse(readFileSync(snapshotPath, 'utf8'));
      return new Map((parsed.files || []).map((entry) => [entry.path, entry]));
    } catch {
      return new Map();
    }
  }

  return deriveLegacySourceSnapshots(root, turnId, targets);
}

function deriveLegacySourceSnapshots(root, turnId, targets) {
  const historyPath = join(root, HISTORY_PATH);
  if (!existsSync(historyPath)) {
    return new Map();
  }

  const historyEntry = readFileSync(historyPath, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .find((entry) => entry.turn_id === turnId);
  const baselineRef = historyEntry?.observed_artifact?.baseline_ref;
  if (!baselineRef || !baselineRef.startsWith('git:')) {
    return new Map();
  }

  const gitRef = baselineRef.slice(4);
  return new Map(targets.map((file) => [file.path, {
    path: file.path,
    action: file.action,
    ...getGitFingerprint(root, gitRef, file.path),
  }]));
}

function getWorkspaceFingerprint(root, filePath) {
  const absPath = join(root, filePath);
  if (!existsSync(absPath)) {
    return { existed: false, sha256: null };
  }
  return {
    existed: true,
    sha256: hashContent(readFileSync(absPath)),
  };
}

function getProposedFingerprint(turnDir, filePath) {
  const proposedPath = join(turnDir, filePath);
  if (!existsSync(proposedPath)) {
    return { existed: false, sha256: null };
  }
  return {
    existed: true,
    sha256: hashContent(readFileSync(proposedPath)),
  };
}

function getGitFingerprint(root, gitRef, filePath) {
  try {
    const content = execFileSync('git', ['show', `${gitRef}:${filePath}`], {
      cwd: root,
      encoding: 'buffer',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return {
      existed: true,
      sha256: hashContent(content),
    };
  } catch {
    return {
      existed: false,
      sha256: null,
    };
  }
}

function fingerprintsMatch(left, right) {
  return Boolean(left && right)
    && Boolean(left.existed) === Boolean(right.existed)
    && (left.sha256 || null) === (right.sha256 || null);
}

function hashContent(content) {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`;
}

function extractField(content, fieldName) {
  const match = content.match(new RegExp(`\\*\\*${fieldName}:\\*\\*\\s*(.+)`));
  return match ? match[1].trim() : null;
}

function extractFileActions(content) {
  const actions = [];
  const regex = /^- `([^`]+)` — (create|modify|delete)/gm;
  let match;
  while ((match = regex.exec(content)) !== null) {
    actions.push({ path: match[1], action: match[2] });
  }
  return actions;
}

function buildSimpleDiff(filePath, current, proposed) {
  const currentLines = current.split('\n');
  const proposedLines = proposed.split('\n');
  const lines = [`--- a/${filePath}`, `+++ b/${filePath}`];

  // Simple line-by-line diff (not a full Myers diff, but useful for review)
  const maxLen = Math.max(currentLines.length, proposedLines.length);
  let changeCount = 0;
  const MAX_DIFF_LINES = 80;

  for (let i = 0; i < maxLen && changeCount < MAX_DIFF_LINES; i++) {
    const cur = currentLines[i];
    const prop = proposedLines[i];
    if (cur === prop) continue;
    if (cur !== undefined && prop !== undefined) {
      lines.push(`@@ line ${i + 1} @@`);
      lines.push(`-${cur}`);
      lines.push(`+${prop}`);
      changeCount += 3;
    } else if (cur === undefined) {
      lines.push(`@@ line ${i + 1} (added) @@`);
      lines.push(`+${prop}`);
      changeCount += 2;
    } else {
      lines.push(`@@ line ${i + 1} (removed) @@`);
      lines.push(`-${cur}`);
      changeCount += 2;
    }
  }

  if (changeCount >= MAX_DIFF_LINES) {
    lines.push(`... (diff truncated, ${maxLen - currentLines.length} more lines differ)`);
  }

  return lines.join('\n');
}
