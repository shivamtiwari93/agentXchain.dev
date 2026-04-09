import { execSync } from 'node:child_process';
import { Buffer } from 'node:buffer';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { loadProjectContext } from './config.js';
import { RUN_RESTORE_ROOTS, isRunRestorePath } from './export.js';

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

function getHeadSha(root) {
  try {
    return execSync('git rev-parse HEAD', {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim() || null;
  } catch {
    return null;
  }
}

function getWorkingTreeChanges(root) {
  try {
    const tracked = execSync('git diff --name-only HEAD', {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const staged = execSync('git diff --name-only --cached', {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const untracked = execSync('git ls-files --others --exclude-standard', {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();

    return [...new Set([tracked, staged, untracked]
      .flatMap((chunk) => chunk.split('\n').filter(Boolean)))];
  } catch {
    return [];
  }
}

function clearRestoreRoots(root) {
  for (const relPath of RUN_RESTORE_ROOTS) {
    rmSync(join(root, relPath), { recursive: true, force: true });
  }
}

function writeRestoredFiles(root, files) {
  const relPaths = Object.keys(files).sort((a, b) => a.localeCompare(b, 'en'));

  for (const relPath of relPaths) {
    if (!isRunRestorePath(relPath)) {
      throw new Error(`Export contains non-restorable file "${relPath}"`);
    }
    const entry = files[relPath];
    if (!entry || typeof entry.content_base64 !== 'string') {
      throw new Error(`Export file "${relPath}" is missing content_base64`);
    }
    const absPath = join(root, relPath);
    mkdirSync(dirname(absPath), { recursive: true });
    writeFileSync(absPath, Buffer.from(entry.content_base64, 'base64'));
  }
}

export function restoreRunExport(targetDir, artifact) {
  if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) {
    return { ok: false, error: 'Restore input must be a JSON export artifact.' };
  }

  if (artifact.export_kind !== 'agentxchain_run_export') {
    return { ok: false, error: `Restore only supports run exports in this slice. Got "${artifact.export_kind || 'unknown'}".` };
  }

  const workspaceGit = artifact.workspace?.git;
  if (!workspaceGit || typeof workspaceGit !== 'object') {
    return { ok: false, error: 'Export is missing workspace.git metadata required for restore.' };
  }

  if (workspaceGit.restore_supported !== true) {
    const blockers = Array.isArray(workspaceGit.restore_blockers) ? workspaceGit.restore_blockers : [];
    return {
      ok: false,
      error: blockers.length > 0
        ? `Export cannot be restored safely:\n- ${blockers.join('\n- ')}`
        : 'Export cannot be restored safely because restore_supported is false.',
    };
  }

  const context = loadProjectContext(targetDir);
  if (!context || context.config?.protocol_mode !== 'governed') {
    return { ok: false, error: 'Restore target must be a governed project rooted by agentxchain.json.' };
  }

  if (context.config?.project?.id !== artifact.project?.id) {
    return {
      ok: false,
      error: `Project mismatch: export is "${artifact.project?.id || 'unknown'}" but target is "${context.config?.project?.id || 'unknown'}".`,
    };
  }

  if (!isGitRepo(context.root)) {
    return { ok: false, error: 'Restore target must be a git-backed checkout.' };
  }

  const targetHead = getHeadSha(context.root);
  if (!targetHead || targetHead !== workspaceGit.head_sha) {
    return {
      ok: false,
      error: `Target HEAD mismatch: export expects "${workspaceGit.head_sha || 'unknown'}" but target is "${targetHead || 'unknown'}".`,
    };
  }

  const dirtyPaths = getWorkingTreeChanges(context.root);
  if (dirtyPaths.length > 0) {
    return {
      ok: false,
      error: `Restore target must be clean before applying continuity state. Dirty paths: ${dirtyPaths.slice(0, 10).join(', ')}${dirtyPaths.length > 10 ? '...' : ''}`,
    };
  }

  const files = artifact.files;
  if (!files || typeof files !== 'object' || Array.isArray(files) || Object.keys(files).length === 0) {
    return { ok: false, error: 'Export is missing restorable files.' };
  }

  clearRestoreRoots(context.root);
  writeRestoredFiles(context.root, files);

  return {
    ok: true,
    root: resolve(context.root),
    run_id: artifact.summary?.run_id || null,
    status: artifact.summary?.status || null,
    restored_files: Object.keys(files).length,
  };
}
