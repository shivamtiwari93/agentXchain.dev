import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { loadProjectContext, loadProjectState } from './config.js';
import { loadCoordinatorConfig, COORDINATOR_CONFIG_FILE } from './coordinator-config.js';
import { loadCoordinatorState } from './coordinator-state.js';

const EXPORT_SCHEMA_VERSION = '0.3';

const COORDINATOR_INCLUDED_ROOTS = [
  'agentxchain-multi.json',
  '.agentxchain/multirepo/state.json',
  '.agentxchain/multirepo/history.jsonl',
  '.agentxchain/multirepo/barriers.json',
  '.agentxchain/multirepo/decision-ledger.jsonl',
  '.agentxchain/multirepo/barrier-ledger.jsonl',
  '.agentxchain/multirepo/RECOVERY_REPORT.md',
];

export const RUN_EXPORT_INCLUDED_ROOTS = [
  'agentxchain.json',
  'TALK.md',
  '.agentxchain/state.json',
  '.agentxchain/session.json',
  '.agentxchain/history.jsonl',
  '.agentxchain/decision-ledger.jsonl',
  '.agentxchain/hook-audit.jsonl',
  '.agentxchain/hook-annotations.jsonl',
  '.agentxchain/notification-audit.jsonl',
  '.agentxchain/dispatch',
  '.agentxchain/staging',
  '.agentxchain/transactions/accept',
  '.agentxchain/intake',
  '.agentxchain/multirepo',
  '.agentxchain/reviews',
  '.agentxchain/proposed',
  '.agentxchain/reports',
  '.planning',
];

export const RUN_RESTORE_ROOTS = [
  'agentxchain.json',
  'TALK.md',
  '.agentxchain/state.json',
  '.agentxchain/session.json',
  '.agentxchain/history.jsonl',
  '.agentxchain/decision-ledger.jsonl',
  '.agentxchain/hook-audit.jsonl',
  '.agentxchain/hook-annotations.jsonl',
  '.agentxchain/notification-audit.jsonl',
  '.agentxchain/dispatch',
  '.agentxchain/staging',
  '.agentxchain/transactions/accept',
  '.agentxchain/intake',
  '.agentxchain/multirepo',
  '.agentxchain/reviews',
  '.agentxchain/proposed',
  '.agentxchain/reports',
  '.planning',
];

function pathWithinRoots(relPath, roots) {
  return roots.some((root) => relPath === root || relPath.startsWith(`${root}/`));
}

export function isRunRestorePath(relPath) {
  return pathWithinRoots(relPath, RUN_RESTORE_ROOTS);
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function collectPaths(root, relPath) {
  const absPath = join(root, relPath);
  if (!existsSync(absPath)) {
    return [];
  }

  const stats = statSync(absPath);
  if (stats.isFile()) {
    return [relPath];
  }

  if (!stats.isDirectory()) {
    return [];
  }

  const entries = readdirSync(absPath, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name, 'en'));

  const files = [];
  for (const entry of entries) {
    const childRelPath = `${relPath}/${entry.name}`;
    if (entry.isDirectory()) {
      files.push(...collectPaths(root, childRelPath));
    } else if (entry.isFile()) {
      files.push(childRelPath);
    }
  }
  return files;
}

function parseJsonl(relPath, raw) {
  if (!raw.trim()) {
    return [];
  }

  return raw
    .split('\n')
    .filter((line) => line.trim())
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`${relPath}: invalid JSONL at line ${index + 1}: ${error.message}`);
      }
    });
}

function parseFile(root, relPath) {
  const absPath = join(root, relPath);
  const buffer = readFileSync(absPath);
  const raw = buffer.toString('utf8');

  let format = 'text';
  let data = raw;

  if (relPath.endsWith('.json')) {
    try {
      data = JSON.parse(raw);
      format = 'json';
    } catch (error) {
      throw new Error(`${relPath}: invalid JSON: ${error.message}`);
    }
  } else if (relPath.endsWith('.jsonl')) {
    data = parseJsonl(relPath, raw);
    format = 'jsonl';
  }

  return {
    format,
    bytes: buffer.byteLength,
    sha256: sha256(buffer),
    content_base64: buffer.toString('base64'),
    data,
  };
}

function countJsonl(files, relPath) {
  return Array.isArray(files[relPath]?.data) ? files[relPath].data.length : 0;
}

function countDirectoryFiles(files, prefix) {
  return Object.keys(files).filter((path) => path.startsWith(`${prefix}/`)).length;
}

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

function getGitHeadSha(root) {
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
      .flatMap((chunk) => chunk.split('\n').filter(Boolean)))]
      .sort((a, b) => a.localeCompare(b, 'en'));
  } catch {
    return [];
  }
}

export function buildRunWorkspaceMetadata(root) {
  if (!isGitRepo(root)) {
    return {
      git: {
        is_repo: false,
        head_sha: null,
        dirty_paths: [],
        restore_supported: false,
        restore_blockers: ['Export restore requires a git-backed checkout on the source machine.'],
      },
    };
  }

  const headSha = getGitHeadSha(root);
  const dirtyPaths = getWorkingTreeChanges(root);
  const restoreBlockers = [];

  if (!headSha) {
    restoreBlockers.push('Export restore requires a stable git HEAD in the source checkout.');
  }

  for (const dirtyPath of dirtyPaths) {
    if (!isRunRestorePath(dirtyPath)) {
      restoreBlockers.push(`Dirty path outside governed continuity roots: ${dirtyPath}`);
    }
  }

  return {
    git: {
      is_repo: true,
      head_sha: headSha,
      dirty_paths: dirtyPaths,
      restore_supported: restoreBlockers.length === 0,
      restore_blockers: restoreBlockers,
    },
  };
}

export function buildRunExport(startDir = process.cwd()) {
  const context = loadProjectContext(startDir);
  if (!context) {
    return {
      ok: false,
      error: 'No governed project found. Run this inside an AgentXchain governed project.',
    };
  }

  if (context.config.protocol_mode !== 'governed') {
    return {
      ok: false,
      error: 'Run export only supports governed projects in this slice.',
    };
  }

  const { root, rawConfig, config, version } = context;
  const state = loadProjectState(root, config);

  const collectedPaths = [...new Set(RUN_EXPORT_INCLUDED_ROOTS.flatMap((relPath) => collectPaths(root, relPath)))]
    .sort((a, b) => a.localeCompare(b, 'en'));

  const files = {};
  for (const relPath of collectedPaths) {
    files[relPath] = parseFile(root, relPath);
  }

  const activeTurns = Object.keys(state?.active_turns || {}).sort((a, b) => a.localeCompare(b, 'en'));
  const retainedTurns = Object.keys(state?.retained_turns || {}).sort((a, b) => a.localeCompare(b, 'en'));

  return {
    ok: true,
    export: {
      schema_version: EXPORT_SCHEMA_VERSION,
      export_kind: 'agentxchain_run_export',
      exported_at: new Date().toISOString(),
      project_root: relative(process.cwd(), root) || '.',
      project: {
        id: config.project.id,
        name: config.project.name,
        template: config.template || 'generic',
        protocol_mode: config.protocol_mode,
        schema_version: version,
      },
      summary: {
        run_id: state?.run_id || null,
        status: state?.status || null,
        phase: state?.phase || null,
        active_turn_ids: activeTurns,
        retained_turn_ids: retainedTurns,
        history_entries: countJsonl(files, '.agentxchain/history.jsonl'),
        decision_entries: countJsonl(files, '.agentxchain/decision-ledger.jsonl'),
        hook_audit_entries: countJsonl(files, '.agentxchain/hook-audit.jsonl'),
        notification_audit_entries: countJsonl(files, '.agentxchain/notification-audit.jsonl'),
        dispatch_artifact_files: countDirectoryFiles(files, '.agentxchain/dispatch'),
        staging_artifact_files: countDirectoryFiles(files, '.agentxchain/staging'),
        intake_present: Object.keys(files).some((path) => path.startsWith('.agentxchain/intake/')),
        coordinator_present: Object.keys(files).some((path) => path.startsWith('.agentxchain/multirepo/')),
      },
      workspace: buildRunWorkspaceMetadata(root),
      files,
      config: rawConfig,
      state,
    },
  };
}

export function buildCoordinatorExport(startDir = process.cwd()) {
  const workspaceRoot = resolve(startDir);
  const configPath = join(workspaceRoot, COORDINATOR_CONFIG_FILE);

  if (!existsSync(configPath)) {
    return {
      ok: false,
      error: `No ${COORDINATOR_CONFIG_FILE} found at ${workspaceRoot}.`,
    };
  }

  let rawConfig;
  try {
    rawConfig = JSON.parse(readFileSync(configPath, 'utf8'));
  } catch (err) {
    return {
      ok: false,
      error: `Invalid JSON in ${COORDINATOR_CONFIG_FILE}: ${err.message}`,
    };
  }

  const configResult = loadCoordinatorConfig(workspaceRoot);
  const normalizedConfig = configResult.ok ? configResult.config : null;

  // Collect coordinator-level files
  const collectedPaths = [...new Set(
    COORDINATOR_INCLUDED_ROOTS.flatMap((relPath) => collectPaths(workspaceRoot, relPath)),
  )].sort((a, b) => a.localeCompare(b, 'en'));

  const files = {};
  for (const relPath of collectedPaths) {
    files[relPath] = parseFile(workspaceRoot, relPath);
  }

  // Load coordinator state for summary
  const coordState = loadCoordinatorState(workspaceRoot);

  // Build repo run statuses from coordinator state
  const repoRunStatuses = {};
  if (coordState?.repo_runs) {
    for (const [repoId, repoRun] of Object.entries(coordState.repo_runs)) {
      repoRunStatuses[repoId] = repoRun.status || 'unknown';
    }
  }

  // Count barriers from barriers.json
  let barrierCount = 0;
  const barriersKey = '.agentxchain/multirepo/barriers.json';
  if (files[barriersKey]?.format === 'json' && files[barriersKey]?.data) {
    barrierCount = Object.keys(files[barriersKey].data).length;
  }

  // Determine repos from config
  const repos = {};
  const repoEntries = rawConfig.repos && typeof rawConfig.repos === 'object'
    ? Object.entries(rawConfig.repos)
    : [];

  for (const [repoId, repoDef] of repoEntries) {
    const repoPath = repoDef?.path || '';
    const resolvedPath = resolve(workspaceRoot, repoPath);

    try {
      const childExport = buildRunExport(resolvedPath);
      if (childExport.ok) {
        repos[repoId] = {
          ok: true,
          path: repoPath,
          export: childExport.export,
        };
      } else {
        repos[repoId] = {
          ok: false,
          path: repoPath,
          error: childExport.error,
        };
      }
    } catch (err) {
      repos[repoId] = {
        ok: false,
        path: repoPath,
        error: err.message || String(err),
      };
    }
  }

  return {
    ok: true,
    export: {
      schema_version: EXPORT_SCHEMA_VERSION,
      export_kind: 'agentxchain_coordinator_export',
      exported_at: new Date().toISOString(),
      workspace_root: relative(process.cwd(), workspaceRoot) || '.',
      coordinator: {
        project_id: rawConfig.project?.id || null,
        project_name: rawConfig.project?.name || null,
        schema_version: rawConfig.schema_version || null,
        repo_count: repoEntries.length,
        workstream_count: rawConfig.workstreams
          ? Object.keys(rawConfig.workstreams).length
          : 0,
      },
      summary: {
        super_run_id: coordState?.super_run_id || null,
        status: coordState?.status || null,
        phase: coordState?.phase || null,
        repo_run_statuses: repoRunStatuses,
        barrier_count: barrierCount,
        history_entries: countJsonl(files, '.agentxchain/multirepo/history.jsonl'),
        decision_entries: countJsonl(files, '.agentxchain/multirepo/decision-ledger.jsonl'),
      },
      files,
      config: rawConfig,
      repos,
    },
  };
}
