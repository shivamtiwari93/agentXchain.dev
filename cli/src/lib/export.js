import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { loadProjectContext, loadProjectState } from './config.js';
import { loadCoordinatorConfig, COORDINATOR_CONFIG_FILE } from './coordinator-config.js';
import { loadCoordinatorState } from './coordinator-state.js';
import {
  RUN_CONTINUITY_DIRECTORY_ROOTS,
  RUN_CONTINUITY_STATE_FILES,
} from './repo-observer.js';
import { normalizeRunProvenance } from './run-provenance.js';
import { getDashboardPid, getDashboardSession } from '../commands/dashboard.js';
import { readRepoDecisions, summarizeRepoDecisions } from './repo-decisions.js';
import { RUN_EVENTS_PATH } from './run-events.js';

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

const RUN_EXPORT_ONLY_ROOTS = [
  'agentxchain.json',
  '.agentxchain-dashboard.pid',
  '.agentxchain-dashboard.json',
  '.planning',
];

export const RUN_EXPORT_INCLUDED_ROOTS = [
  'agentxchain.json',
  ...RUN_CONTINUITY_STATE_FILES,
  ...RUN_CONTINUITY_DIRECTORY_ROOTS,
  ...RUN_EXPORT_ONLY_ROOTS.filter((root) => root !== 'agentxchain.json'),
];

export const RUN_RESTORE_ROOTS = [
  'agentxchain.json',
  ...RUN_CONTINUITY_STATE_FILES,
  ...RUN_CONTINUITY_DIRECTORY_ROOTS,
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

function parseJsonlBuffer(relPath, buffer, maxEntries) {
  const shouldWindow = Number.isInteger(maxEntries) && maxEntries > 0;
  const retained = [];
  let totalEntries = 0;
  let physicalLine = 1;
  let lineStart = 0;

  const retainLine = (line, lineNumber) => {
    if (!line.trim()) {
      return;
    }
    totalEntries += 1;
    if (shouldWindow && retained.length >= maxEntries) {
      retained.shift();
    }
    retained.push({ line, lineNumber });
  };

  for (let i = 0; i <= buffer.length; i += 1) {
    if (i !== buffer.length && buffer[i] !== 10) {
      continue;
    }

    let lineEnd = i;
    if (lineEnd > lineStart && buffer[lineEnd - 1] === 13) {
      lineEnd -= 1;
    }
    retainLine(buffer.toString('utf8', lineStart, lineEnd), physicalLine);
    lineStart = i + 1;
    physicalLine += 1;
  }

  const entries = retained.map(({ line, lineNumber }) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`${relPath}: invalid JSONL at line ${lineNumber}: ${error.message}`);
    }
  });

  return {
    entries,
    totalEntries,
    truncated: shouldWindow && totalEntries > maxEntries,
  };
}

function parseFile(root, relPath, opts = {}) {
  const absPath = join(root, relPath);
  const buffer = readFileSync(absPath);

  let format = 'text';
  let data = null;
  let truncated = false;
  let totalEntries = null;

  if (relPath.endsWith('.json')) {
    const raw = buffer.toString('utf8');
    try {
      data = JSON.parse(raw);
      format = 'json';
    } catch (error) {
      throw new Error(`${relPath}: invalid JSON: ${error.message}`);
    }
  } else if (relPath.endsWith('.jsonl')) {
    const maxEntries = opts.maxJsonlEntries;
    const parsed = Number.isInteger(maxEntries) && maxEntries > 0
      ? parseJsonlBuffer(relPath, buffer, maxEntries)
      : { entries: parseJsonl(relPath, buffer.toString('utf8')), totalEntries: null, truncated: false };
    format = 'jsonl';
    data = parsed.entries;
    truncated = parsed.truncated;
    totalEntries = parsed.totalEntries;
  } else {
    data = buffer.toString('utf8');
    if (opts.maxTextDataBytes && typeof data === 'string' && data.length > opts.maxTextDataBytes) {
      data = data.slice(0, opts.maxTextDataBytes);
      truncated = true;
    }
  }

  const skipBase64 = truncated || (opts.maxBase64Bytes && buffer.byteLength > opts.maxBase64Bytes);
  const result = {
    format,
    bytes: buffer.byteLength,
    sha256: sha256(buffer),
    content_base64: skipBase64 ? null : buffer.toString('base64'),
    data,
  };

  if (truncated) {
    result.truncated = true;
    result.total_entries = totalEntries;
    result.retained_entries = data.length;
  }
  if (skipBase64 && !truncated) {
    result.content_base64_skipped = true;
  }

  return result;
}

function countJsonl(files, relPath) {
  return Array.isArray(files[relPath]?.data) ? files[relPath].data.length : 0;
}

function countDirectoryFiles(files, prefix) {
  return Object.keys(files).filter((path) => path.startsWith(`${prefix}/`)).length;
}

function buildDashboardSessionSummary(root) {
  const dashPid = getDashboardPid(root);
  const dashSession = getDashboardSession(root);

  if (dashPid && dashSession) {
    return {
      status: 'running',
      pid: dashPid,
      url: dashSession.url || null,
      started_at: dashSession.started_at || null,
    };
  }

  if (dashPid && !dashSession) {
    return {
      status: 'pid_only',
      pid: dashPid,
      url: null,
      started_at: null,
    };
  }

  if (!dashPid && dashSession) {
    return {
      status: 'stale',
      pid: dashSession.pid || null,
      url: dashSession.url || null,
      started_at: dashSession.started_at || null,
    };
  }

  return {
    status: 'not_running',
    pid: null,
    url: null,
    started_at: null,
  };
}

export function buildRepoDecisionsSummary(root, config = null) {
  return summarizeRepoDecisions(readRepoDecisions(root), config);
}

export function buildDelegationSummary(files) {
  const historyData = files['.agentxchain/history.jsonl']?.data;
  if (!Array.isArray(historyData)) {
    return null;
  }

  // Index history entries by delegation-related fields
  const parentTurns = new Map(); // parent_turn_id -> { role, delegations_issued }
  const childTurns = new Map();  // delegation_id -> { child entry }
  const reviewTurns = new Map(); // parent_turn_id -> { review entry }

  for (const entry of historyData) {
    if (entry.delegations_issued && Array.isArray(entry.delegations_issued)) {
      parentTurns.set(entry.turn_id, {
        role: entry.role,
        delegations_issued: entry.delegations_issued,
      });
    }
    if (entry.delegation_context) {
      childTurns.set(entry.delegation_context.delegation_id, {
        turn_id: entry.turn_id,
        status: entry.status || 'completed',
      });
    }
    if (entry.delegation_review) {
      reviewTurns.set(entry.delegation_review.parent_turn_id, {
        turn_id: entry.turn_id,
        results: entry.delegation_review.results || [],
      });
    }
  }

  let totalDelegationsIssued = 0;
  const delegationChains = [];

  for (const [parentTurnId, parent] of parentTurns) {
    totalDelegationsIssued += parent.delegations_issued.length;

    const review = reviewTurns.get(parentTurnId);
    const reviewResultsByDelegation = new Map();
    if (review) {
      for (const r of review.results) {
        if (r.delegation_id) {
          reviewResultsByDelegation.set(r.delegation_id, r);
        }
      }
    }

    const delegations = parent.delegations_issued.map((del) => {
      const child = childTurns.get(del.id);
      const reviewResult = reviewResultsByDelegation.get(del.id);
      return {
        delegation_id: del.id,
        to_role: del.to_role,
        charter: del.charter,
        required_decision_ids: Array.isArray(del.required_decision_ids) ? del.required_decision_ids : [],
        satisfied_decision_ids: Array.isArray(reviewResult?.satisfied_decision_ids) ? reviewResult.satisfied_decision_ids : [],
        missing_decision_ids: Array.isArray(reviewResult?.missing_decision_ids) ? reviewResult.missing_decision_ids : [],
        status: reviewResult?.status || child?.status || 'pending',
        child_turn_id: child?.turn_id || null,
      };
    });

    let outcome;
    if (!review) {
      outcome = 'pending';
    } else {
      const statuses = delegations.map((d) => d.status);
      const allCompleted = statuses.every((s) => s === 'completed');
      const allFailed = statuses.every((s) => s === 'failed');
      if (allCompleted) outcome = 'completed';
      else if (allFailed) outcome = 'failed';
      else outcome = 'mixed';
    }

    delegationChains.push({
      parent_turn_id: parentTurnId,
      parent_role: parent.role,
      delegations,
      review_turn_id: review?.turn_id || null,
      outcome,
    });
  }

  return {
    total_delegations_issued: totalDelegationsIssued,
    delegation_chains: delegationChains,
  };
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

export function buildRunExport(startDir = process.cwd(), exportOpts = {}) {
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

  const parseOpts = {};
  if (exportOpts.maxJsonlEntries) {
    parseOpts.maxJsonlEntries = exportOpts.maxJsonlEntries;
  }
  if (exportOpts.maxBase64Bytes) {
    parseOpts.maxBase64Bytes = exportOpts.maxBase64Bytes;
  }
  if (exportOpts.maxTextDataBytes) {
    parseOpts.maxTextDataBytes = exportOpts.maxTextDataBytes;
  }

  // BUG-88: apply maxExportFiles cap with priority ordering.
  // Core governance files first, then dispatch/staging, then .planning/ last.
  let boundedPaths = collectedPaths;
  let exportFilesTruncated = false;
  if (exportOpts.maxExportFiles && collectedPaths.length > exportOpts.maxExportFiles) {
    const corePaths = [];
    const runtimePaths = [];
    const planningPaths = [];
    for (const p of collectedPaths) {
      if (p.startsWith('.planning/')) {
        planningPaths.push(p);
      } else if (p.startsWith('.agentxchain/dispatch/') || p.startsWith('.agentxchain/staging/') || p.startsWith('.agentxchain/transactions/')) {
        runtimePaths.push(p);
      } else {
        corePaths.push(p);
      }
    }
    const budget = exportOpts.maxExportFiles;
    boundedPaths = corePaths.slice(0, budget);
    const remaining = budget - boundedPaths.length;
    if (remaining > 0) {
      boundedPaths.push(...runtimePaths.slice(0, remaining));
      const remaining2 = remaining - Math.min(runtimePaths.length, remaining);
      if (remaining2 > 0) {
        boundedPaths.push(...planningPaths.slice(0, remaining2));
      }
    }
    exportFilesTruncated = true;
  }

  const files = {};
  for (const relPath of boundedPaths) {
    files[relPath] = parseFile(root, relPath, parseOpts);
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
        goal: config.project.goal || null,
        template: config.template || 'generic',
        protocol_mode: config.protocol_mode,
        schema_version: version,
      },
      summary: {
        project_goal: config.project.goal || null,
        run_id: state?.run_id || null,
        status: state?.status || null,
        phase: state?.phase || null,
        workflow_phase_order: config.routing && Object.keys(config.routing).length > 0
          ? Object.keys(config.routing)
          : null,
        provenance: normalizeRunProvenance(state?.provenance),
        inherited_context: state?.inherited_context || null,
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
        dashboard_session: buildDashboardSessionSummary(root),
        delegation_summary: buildDelegationSummary(files),
        repo_decisions: buildRepoDecisionsSummary(root, rawConfig),
        export_files_truncated: exportFilesTruncated || false,
        total_collected_files: collectedPaths.length,
        included_files: Object.keys(files).length,
      },
      workspace: buildRunWorkspaceMetadata(root),
      files,
      config: rawConfig,
      state,
    },
  };
}

/**
 * Build aggregated child-repo lifecycle events summary for coordinator exports.
 * Reads events.jsonl from each child repo, tags with repo_id, merges, sorts.
 */
function buildAggregatedEventsSummary(workspaceRoot, repoEntries) {
  let allEvents = [];
  const reposWithEvents = new Set();

  for (const [repoId, repoDef] of repoEntries) {
    const repoPath = resolve(workspaceRoot, repoDef?.path || '');
    const eventsPath = join(repoPath, RUN_EVENTS_PATH);

    if (!existsSync(eventsPath)) continue;

    let raw;
    try {
      raw = readFileSync(eventsPath, 'utf8');
    } catch {
      continue;
    }

    const lines = raw.split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const evt = JSON.parse(line);
        evt.repo_id = repoId;
        allEvents.push(evt);
        reposWithEvents.add(repoId);
      } catch {
        // Skip malformed lines
      }
    }
  }

  // Sort by timestamp ascending, ties broken by event_id
  allEvents.sort((a, b) => {
    const tDiff = new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
    if (tDiff !== 0) return tDiff;
    return (a.event_id || '').localeCompare(b.event_id || '');
  });

  // Count event types
  const eventTypeCounts = {};
  for (const evt of allEvents) {
    const t = evt.event_type || evt.type || 'unknown';
    eventTypeCounts[t] = (eventTypeCounts[t] || 0) + 1;
  }

  return {
    total_events: allEvents.length,
    repos_with_events: [...reposWithEvents].sort(),
    event_type_counts: eventTypeCounts,
    events: allEvents,
  };
}

export function buildCoordinatorExport(startDir = process.cwd(), exportOpts = {}) {
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
      // BUG-88: apply bounding to child exports in coordinator workspaces
      const childExport = buildRunExport(resolvedPath, exportOpts);
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
        workflow_phase_order: rawConfig.routing && typeof rawConfig.routing === 'object'
            && Object.keys(rawConfig.routing).length > 0
          ? Object.keys(rawConfig.routing)
          : null,
        repo_run_statuses: repoRunStatuses,
        barrier_count: barrierCount,
        history_entries: countJsonl(files, '.agentxchain/multirepo/history.jsonl'),
        decision_entries: countJsonl(files, '.agentxchain/multirepo/decision-ledger.jsonl'),
        aggregated_events: buildAggregatedEventsSummary(workspaceRoot, repoEntries),
      },
      files,
      config: rawConfig,
      repos,
    },
  };
}
