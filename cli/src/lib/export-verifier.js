import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { summarizeRepoDecisions } from './repo-decisions.js';

const SUPPORTED_EXPORT_SCHEMA_VERSIONS = new Set(['0.2', '0.3']);
const VALID_FILE_FORMATS = new Set(['json', 'jsonl', 'text']);

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function parseJsonl(raw, relPath) {
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

function addError(errors, path, message) {
  errors.push(`${path}: ${message}`);
}

function verifyWorkflowPhaseOrder(summary, errors, summaryPath = 'summary') {
  const phaseOrder = summary?.workflow_phase_order;
  if (phaseOrder === undefined || phaseOrder === null) {
    return;
  }

  const path = `${summaryPath}.workflow_phase_order`;
  if (!Array.isArray(phaseOrder)) {
    addError(errors, path, 'must be an array or null');
    return;
  }

  if (phaseOrder.length === 0) {
    addError(errors, path, 'must not be empty when present');
    return;
  }

  const seen = new Set();
  for (let index = 0; index < phaseOrder.length; index += 1) {
    const entry = phaseOrder[index];
    const entryPath = `${path}[${index}]`;
    if (typeof entry !== 'string') {
      addError(errors, entryPath, 'must be a string');
      continue;
    }
    const trimmed = entry.trim();
    if (!trimmed) {
      addError(errors, entryPath, 'must not be blank');
      continue;
    }
    if (trimmed !== entry) {
      addError(errors, entryPath, 'must be trimmed');
      continue;
    }
    if (seen.has(entry)) {
      addError(errors, path, `must not contain duplicate phase "${entry}"`);
      continue;
    }
    seen.add(entry);
  }

  if (summary.phase !== null && summary.phase !== undefined && !seen.has(summary.phase)) {
    addError(errors, `${summaryPath}.phase`, 'must appear in summary.workflow_phase_order when workflow_phase_order is present');
  }
}

function verifyFileEntry(relPath, entry, errors) {
  const path = `files.${relPath}`;
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    addError(errors, path, 'file entry must be an object');
    return;
  }

  if (!VALID_FILE_FORMATS.has(entry.format)) {
    addError(errors, path, `unsupported format "${entry.format}"`);
    return;
  }

  if (!Number.isInteger(entry.bytes) || entry.bytes < 0) {
    addError(errors, path, 'bytes must be a non-negative integer');
  }

  if (typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sha256)) {
    addError(errors, path, 'sha256 must be a 64-character lowercase hex digest');
  }

  if (typeof entry.content_base64 !== 'string') {
    addError(errors, path, 'content_base64 must be a string');
    return;
  }

  let buffer;
  try {
    buffer = Buffer.from(entry.content_base64, 'base64');
  } catch (error) {
    addError(errors, path, `content_base64 is not valid base64: ${error.message}`);
    return;
  }

  if (buffer.byteLength !== entry.bytes) {
    addError(errors, path, `bytes mismatch: expected ${entry.bytes}, got ${buffer.byteLength}`);
  }

  if (sha256(buffer) !== entry.sha256) {
    addError(errors, path, 'sha256 does not match content_base64');
  }

  const raw = buffer.toString('utf8');

  try {
    if (entry.format === 'json') {
      const parsed = JSON.parse(raw);
      if (!isDeepStrictEqual(parsed, entry.data)) {
        addError(errors, path, 'data does not match decoded JSON content');
      }
      return;
    }

    if (entry.format === 'jsonl') {
      const parsed = parseJsonl(raw, relPath);
      if (!isDeepStrictEqual(parsed, entry.data)) {
        addError(errors, path, 'data does not match decoded JSONL content');
      }
      return;
    }

    if (raw !== entry.data) {
      addError(errors, path, 'data does not match decoded text content');
    }
  } catch (error) {
    addError(errors, path, error.message);
  }
}

function verifyFilesMap(files, errors) {
  if (!files || typeof files !== 'object' || Array.isArray(files)) {
    addError(errors, 'files', 'must be an object keyed by relative path');
    return;
  }

  for (const [relPath, entry] of Object.entries(files)) {
    verifyFileEntry(relPath, entry, errors);
  }
}

function compareEventOrder(a, b) {
  const left = Date.parse(a?.timestamp || '');
  const right = Date.parse(b?.timestamp || '');
  const leftTime = Number.isNaN(left) ? Number.POSITIVE_INFINITY : left;
  const rightTime = Number.isNaN(right) ? Number.POSITIVE_INFINITY : right;
  if (leftTime !== rightTime) {
    return leftTime - rightTime;
  }
  return String(a?.event_id || '').localeCompare(String(b?.event_id || ''));
}

function buildExpectedAggregatedEventsSummary(repos) {
  const events = [];
  const reposWithEvents = new Set();

  for (const [repoId, repoEntry] of Object.entries(repos || {})) {
    if (!repoEntry?.ok || !repoEntry.export || typeof repoEntry.export !== 'object' || Array.isArray(repoEntry.export)) {
      continue;
    }

    const repoEvents = repoEntry.export.files?.['.agentxchain/events.jsonl']?.data;
    if (!Array.isArray(repoEvents)) {
      continue;
    }

    for (const event of repoEvents) {
      if (!event || typeof event !== 'object' || Array.isArray(event)) {
        continue;
      }
      events.push({
        ...event,
        repo_id: repoId,
      });
      reposWithEvents.add(repoId);
    }
  }

  events.sort(compareEventOrder);

  const eventTypeCounts = {};
  for (const event of events) {
    const type = event.event_type || event.type || 'unknown';
    eventTypeCounts[type] = (eventTypeCounts[type] || 0) + 1;
  }

  return {
    total_events: events.length,
    repos_with_events: [...reposWithEvents].sort(),
    event_type_counts: eventTypeCounts,
    events,
  };
}

function verifyAggregatedEventsSummary(artifact, errors) {
  const summary = artifact.summary?.aggregated_events;
  if (summary === undefined || summary === null) {
    return;
  }

  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) {
    addError(errors, 'summary.aggregated_events', 'must be an object when present');
    return;
  }

  const failedRepoIds = Object.entries(artifact.repos || {})
    .filter(([, repoEntry]) => repoEntry && typeof repoEntry === 'object' && !Array.isArray(repoEntry) && repoEntry.ok === false)
    .map(([repoId]) => repoId);

  for (const repoId of failedRepoIds) {
    if (summary.repos_with_events?.includes(repoId)) {
      addError(
        errors,
        'summary.aggregated_events.repos_with_events',
        `cannot include repo "${repoId}" when repos.${repoId}.ok is false because no nested export proof is available`,
      );
    }
  }

  const expected = buildExpectedAggregatedEventsSummary(artifact.repos);

  if (summary.total_events !== expected.total_events) {
    addError(errors, 'summary.aggregated_events.total_events', 'must match reconstructed aggregated event count');
  }
  if (!isDeepStrictEqual(summary.repos_with_events, expected.repos_with_events)) {
    addError(errors, 'summary.aggregated_events.repos_with_events', 'must match reconstructed contributing repo ids');
  }
  if (!isDeepStrictEqual(summary.event_type_counts, expected.event_type_counts)) {
    addError(errors, 'summary.aggregated_events.event_type_counts', 'must match reconstructed event type counts');
  }
  if (!isDeepStrictEqual(summary.events, expected.events)) {
    addError(errors, 'summary.aggregated_events.events', 'must match reconstructed sorted aggregated event list');
  }
}

function buildExpectedDelegationSummary(files) {
  const historyData = files?.['.agentxchain/history.jsonl']?.data;
  if (!Array.isArray(historyData)) {
    return null;
  }

  const parentTurns = new Map();
  const childTurns = new Map();
  const reviewTurns = new Map();

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

function verifyDelegationSummary(artifact, errors) {
  const summary = artifact.summary?.delegation_summary;
  const expected = buildExpectedDelegationSummary(artifact.files);

  // Both absent — valid
  if (summary == null && expected == null) {
    return;
  }

  // One present, one absent — mismatch
  if (summary == null && expected != null) {
    if (expected.total_delegations_issued > 0) {
      addError(errors, 'summary.delegation_summary', 'is null but history.jsonl contains delegation entries');
    }
    return;
  }
  if (summary != null && expected == null) {
    addError(errors, 'summary.delegation_summary', 'claims delegations but no history.jsonl in export');
    return;
  }

  if (summary.total_delegations_issued !== expected.total_delegations_issued) {
    addError(errors, 'summary.delegation_summary.total_delegations_issued', 'must match reconstructed delegation count');
  }

  if (!isDeepStrictEqual(summary.delegation_chains, expected.delegation_chains)) {
    addError(errors, 'summary.delegation_summary.delegation_chains', 'must match reconstructed delegation chains from history.jsonl');
  }
}

function buildExpectedRepoDecisionsSummary(files, config = null) {
  const repoDecisionsData = files?.['.agentxchain/repo-decisions.jsonl']?.data;
  if (!Array.isArray(repoDecisionsData) || repoDecisionsData.length === 0) {
    return null;
  }
  return summarizeRepoDecisions(repoDecisionsData, config);
}

function verifyRepoDecisionsSummary(artifact, errors) {
  const summary = artifact.summary?.repo_decisions;
  const hasFile = '.agentxchain/repo-decisions.jsonl' in (artifact.files || {});
  const expected = buildExpectedRepoDecisionsSummary(artifact.files, artifact.config || null);

  if (summary === null && expected === null) {
    return;
  }
  if (summary === undefined && expected === null) {
    return;
  }

  if (summary !== null && summary !== undefined && !hasFile && expected === null) {
    addError(errors, 'summary.repo_decisions', 'claims repo decisions but no .agentxchain/repo-decisions.jsonl in export');
    return;
  }

  if (summary === null && expected !== null) {
    addError(errors, 'summary.repo_decisions', 'is null but repo-decisions.jsonl contains entries');
    return;
  }

  if (summary !== null && expected === null) {
    addError(errors, 'summary.repo_decisions', 'claims repo decisions but repo-decisions.jsonl is empty');
    return;
  }

  if (summary.total !== expected.total) {
    addError(errors, 'summary.repo_decisions.total', 'must match reconstructed repo decision count');
  }
  if (summary.active_count !== expected.active_count) {
    addError(errors, 'summary.repo_decisions.active_count', 'must match reconstructed active count');
  }
  if (summary.overridden_count !== expected.overridden_count) {
    addError(errors, 'summary.repo_decisions.overridden_count', 'must match reconstructed overridden count');
  }
  if (!isDeepStrictEqual(summary.active, expected.active)) {
    addError(errors, 'summary.repo_decisions.active', 'must match reconstructed active decisions from repo-decisions.jsonl');
  }
  if (!isDeepStrictEqual(summary.overridden, expected.overridden)) {
    addError(errors, 'summary.repo_decisions.overridden', 'must match reconstructed overridden decisions from repo-decisions.jsonl');
  }
}

const VALID_DASHBOARD_STATUSES = new Set(['running', 'pid_only', 'stale', 'not_running']);

function verifyDashboardSessionSummary(artifact, errors) {
  const session = artifact.summary?.dashboard_session;
  if (session === undefined) {
    return;
  }

  if (session === null || typeof session !== 'object' || Array.isArray(session)) {
    addError(errors, 'summary.dashboard_session', 'must be an object when present');
    return;
  }

  if (!VALID_DASHBOARD_STATUSES.has(session.status)) {
    addError(errors, 'summary.dashboard_session.status', `must be one of: ${[...VALID_DASHBOARD_STATUSES].join(', ')}`);
    return;
  }

  if (session.pid !== null && (!Number.isInteger(session.pid) || session.pid <= 0)) {
    addError(errors, 'summary.dashboard_session.pid', 'must be a positive integer or null');
  }

  if (session.url !== null && typeof session.url !== 'string') {
    addError(errors, 'summary.dashboard_session.url', 'must be a string or null');
  }

  if (session.started_at !== null && (typeof session.started_at !== 'string' || Number.isNaN(Date.parse(session.started_at)))) {
    addError(errors, 'summary.dashboard_session.started_at', 'must be a valid ISO timestamp or null');
  }

  if (session.status === 'not_running') {
    if (session.pid !== null) {
      addError(errors, 'summary.dashboard_session.pid', 'must be null when status is not_running');
    }
    if (session.url !== null) {
      addError(errors, 'summary.dashboard_session.url', 'must be null when status is not_running');
    }
    if (session.started_at !== null) {
      addError(errors, 'summary.dashboard_session.started_at', 'must be null when status is not_running');
    }
  }

  if (session.status === 'running' && (session.pid === null || !Number.isInteger(session.pid) || session.pid <= 0)) {
    addError(errors, 'summary.dashboard_session.pid', 'must be a positive integer when status is running');
  }
}

function countJsonl(files, relPath) {
  return Array.isArray(files?.[relPath]?.data) ? files[relPath].data.length : 0;
}

function countDirectoryFiles(files, prefix) {
  return Object.keys(files || {}).filter((path) => path.startsWith(`${prefix}/`)).length;
}

function verifyRunExport(artifact, errors) {
  if (typeof artifact.project_root !== 'string' || artifact.project_root.length === 0) {
    addError(errors, 'project_root', 'must be a non-empty string');
  }

  if (!artifact.project || typeof artifact.project !== 'object' || Array.isArray(artifact.project)) {
    addError(errors, 'project', 'must be an object');
  } else {
    const expectedProtocolMode = artifact.config?.protocol_mode
      || artifact.state?.protocol_mode
      || 'governed';
    if (artifact.project.id !== artifact.config?.project?.id) {
      addError(errors, 'project.id', 'must match config.project.id');
    }
    if (artifact.project.name !== artifact.config?.project?.name) {
      addError(errors, 'project.name', 'must match config.project.name');
    }
    if (artifact.project.template !== (artifact.config?.template || 'generic')) {
      addError(errors, 'project.template', 'must match config.template or implicit generic');
    }
    if (artifact.project.protocol_mode !== expectedProtocolMode) {
      addError(errors, 'project.protocol_mode', 'must match exported protocol mode');
    }
  }

  if (!artifact.summary || typeof artifact.summary !== 'object' || Array.isArray(artifact.summary)) {
    addError(errors, 'summary', 'must be an object');
    return;
  }

  if (!artifact.state || typeof artifact.state !== 'object' || Array.isArray(artifact.state)) {
    addError(errors, 'state', 'must be an object');
    return;
  }

  if (!isDeepStrictEqual(artifact.config, artifact.files?.['agentxchain.json']?.data)) {
    addError(errors, 'config', 'must match files.agentxchain.json.data');
  }

  if (!isDeepStrictEqual(artifact.state, artifact.files?.['.agentxchain/state.json']?.data)) {
    addError(errors, 'state', 'must match files..agentxchain/state.json.data');
  }

  if ('workspace' in artifact) {
    if (!artifact.workspace || typeof artifact.workspace !== 'object' || Array.isArray(artifact.workspace)) {
      addError(errors, 'workspace', 'must be an object');
    } else {
      const git = artifact.workspace.git;
      if (!git || typeof git !== 'object' || Array.isArray(git)) {
        addError(errors, 'workspace.git', 'must be an object');
      } else {
        if (typeof git.is_repo !== 'boolean') addError(errors, 'workspace.git.is_repo', 'must be a boolean');
        if (git.head_sha !== null && (typeof git.head_sha !== 'string' || git.head_sha.length === 0)) {
          addError(errors, 'workspace.git.head_sha', 'must be a string or null');
        }
        if (!Array.isArray(git.dirty_paths) || git.dirty_paths.some((entry) => typeof entry !== 'string' || entry.length === 0)) {
          addError(errors, 'workspace.git.dirty_paths', 'must be an array of non-empty strings');
        }
        if (typeof git.restore_supported !== 'boolean') addError(errors, 'workspace.git.restore_supported', 'must be a boolean');
        if (!Array.isArray(git.restore_blockers) || git.restore_blockers.some((entry) => typeof entry !== 'string' || entry.length === 0)) {
          addError(errors, 'workspace.git.restore_blockers', 'must be an array of non-empty strings');
        }
      }
    }
  }

  const activeTurnIds = Object.keys(artifact.state.active_turns || {}).sort((a, b) => a.localeCompare(b, 'en'));
  const retainedTurnIds = Object.keys(artifact.state.retained_turns || {}).sort((a, b) => a.localeCompare(b, 'en'));

  if (!isDeepStrictEqual(artifact.summary.active_turn_ids, activeTurnIds)) {
    addError(errors, 'summary.active_turn_ids', 'must match sorted state.active_turns keys');
  }

  if (!isDeepStrictEqual(artifact.summary.retained_turn_ids, retainedTurnIds)) {
    addError(errors, 'summary.retained_turn_ids', 'must match sorted state.retained_turns keys');
  }

  if (artifact.summary.run_id !== (artifact.state.run_id || null)) {
    addError(errors, 'summary.run_id', 'must match state.run_id');
  }

  if (artifact.summary.status !== (artifact.state.status || null)) {
    addError(errors, 'summary.status', 'must match state.status');
  }

  if (artifact.summary.phase !== (artifact.state.phase || null)) {
    addError(errors, 'summary.phase', 'must match state.phase');
  }

  verifyWorkflowPhaseOrder(artifact.summary, errors);

  const expectedHistoryEntries = countJsonl(artifact.files, '.agentxchain/history.jsonl');
  const expectedDecisionEntries = countJsonl(artifact.files, '.agentxchain/decision-ledger.jsonl');
  const expectedHookAuditEntries = countJsonl(artifact.files, '.agentxchain/hook-audit.jsonl');
  const expectedNotificationAuditEntries = countJsonl(artifact.files, '.agentxchain/notification-audit.jsonl');
  const expectedDispatchFiles = countDirectoryFiles(artifact.files, '.agentxchain/dispatch');
  const expectedStagingFiles = countDirectoryFiles(artifact.files, '.agentxchain/staging');
  const expectedIntakePresent = Object.keys(artifact.files).some((path) => path.startsWith('.agentxchain/intake/'));
  const expectedCoordinatorPresent = Object.keys(artifact.files).some((path) => path.startsWith('.agentxchain/multirepo/'));

  if (artifact.summary.history_entries !== expectedHistoryEntries) {
    addError(errors, 'summary.history_entries', 'must match .agentxchain/history.jsonl entry count');
  }
  if (artifact.summary.decision_entries !== expectedDecisionEntries) {
    addError(errors, 'summary.decision_entries', 'must match .agentxchain/decision-ledger.jsonl entry count');
  }
  if (artifact.summary.hook_audit_entries !== expectedHookAuditEntries) {
    addError(errors, 'summary.hook_audit_entries', 'must match .agentxchain/hook-audit.jsonl entry count');
  }
  if (artifact.summary.notification_audit_entries !== expectedNotificationAuditEntries) {
    addError(errors, 'summary.notification_audit_entries', 'must match .agentxchain/notification-audit.jsonl entry count');
  }
  if (artifact.summary.dispatch_artifact_files !== expectedDispatchFiles) {
    addError(errors, 'summary.dispatch_artifact_files', 'must match .agentxchain/dispatch file count');
  }
  if (artifact.summary.staging_artifact_files !== expectedStagingFiles) {
    addError(errors, 'summary.staging_artifact_files', 'must match .agentxchain/staging file count');
  }
  if (artifact.summary.intake_present !== expectedIntakePresent) {
    addError(errors, 'summary.intake_present', 'must match intake file presence');
  }
  if (artifact.summary.coordinator_present !== expectedCoordinatorPresent) {
    addError(errors, 'summary.coordinator_present', 'must match multirepo file presence');
  }

  verifyDelegationSummary(artifact, errors);
  verifyRepoDecisionsSummary(artifact, errors);
  verifyDashboardSessionSummary(artifact, errors);
}

function verifyCoordinatorExport(artifact, errors) {
  if (typeof artifact.workspace_root !== 'string' || artifact.workspace_root.length === 0) {
    addError(errors, 'workspace_root', 'must be a non-empty string');
  }

  if (!artifact.coordinator || typeof artifact.coordinator !== 'object' || Array.isArray(artifact.coordinator)) {
    addError(errors, 'coordinator', 'must be an object');
  } else {
    if (artifact.coordinator.project_id !== (artifact.config?.project?.id || null)) {
      addError(errors, 'coordinator.project_id', 'must match config.project.id');
    }
    if (artifact.coordinator.project_name !== (artifact.config?.project?.name || null)) {
      addError(errors, 'coordinator.project_name', 'must match config.project.name');
    }

    const expectedRepoCount = Object.keys(artifact.config?.repos || {}).length;
    const expectedWorkstreamCount = Object.keys(artifact.config?.workstreams || {}).length;
    if (artifact.coordinator.repo_count !== expectedRepoCount) {
      addError(errors, 'coordinator.repo_count', 'must match config.repos size');
    }
    if (artifact.coordinator.workstream_count !== expectedWorkstreamCount) {
      addError(errors, 'coordinator.workstream_count', 'must match config.workstreams size');
    }
  }

  if (!artifact.summary || typeof artifact.summary !== 'object' || Array.isArray(artifact.summary)) {
    addError(errors, 'summary', 'must be an object');
  } else {
    const coordinatorState = artifact.files?.['.agentxchain/multirepo/state.json']?.data || null;
    const expectedStatuses = {};
    if (coordinatorState?.repo_runs && typeof coordinatorState.repo_runs === 'object') {
      for (const [repoId, repoRun] of Object.entries(coordinatorState.repo_runs)) {
        expectedStatuses[repoId] = repoRun.status || 'unknown';
      }
    }

    const barriers = artifact.files?.['.agentxchain/multirepo/barriers.json']?.data;
    const expectedBarrierCount = barriers && typeof barriers === 'object' && !Array.isArray(barriers)
      ? Object.keys(barriers).length
      : 0;

    if (artifact.summary.super_run_id !== (coordinatorState?.super_run_id || null)) {
      addError(errors, 'summary.super_run_id', 'must match coordinator state super_run_id');
    }
    if (artifact.summary.status !== (coordinatorState?.status || null)) {
      addError(errors, 'summary.status', 'must match coordinator state status');
    }
    if (artifact.summary.phase !== (coordinatorState?.phase || null)) {
      addError(errors, 'summary.phase', 'must match coordinator state phase');
    }
    verifyWorkflowPhaseOrder(artifact.summary, errors);
    if (!isDeepStrictEqual(artifact.summary.repo_run_statuses, expectedStatuses)) {
      addError(errors, 'summary.repo_run_statuses', 'must match coordinator state repo run statuses');
    }
    if (artifact.summary.barrier_count !== expectedBarrierCount) {
      addError(errors, 'summary.barrier_count', 'must match barriers.json object size');
    }
    if (artifact.summary.history_entries !== countJsonl(artifact.files, '.agentxchain/multirepo/history.jsonl')) {
      addError(errors, 'summary.history_entries', 'must match multirepo history entry count');
    }
    if (artifact.summary.decision_entries !== countJsonl(artifact.files, '.agentxchain/multirepo/decision-ledger.jsonl')) {
      addError(errors, 'summary.decision_entries', 'must match multirepo decision entry count');
    }
  }

  if (!isDeepStrictEqual(artifact.config, artifact.files?.['agentxchain-multi.json']?.data)) {
    addError(errors, 'config', 'must match files.agentxchain-multi.json.data');
  }

  if (!artifact.repos || typeof artifact.repos !== 'object' || Array.isArray(artifact.repos)) {
    addError(errors, 'repos', 'must be an object');
    return;
  }

  for (const [repoId, repoEntry] of Object.entries(artifact.repos)) {
    const repoPath = `repos.${repoId}`;
    if (!repoEntry || typeof repoEntry !== 'object' || Array.isArray(repoEntry)) {
      addError(errors, repoPath, 'must be an object');
      continue;
    }
    if (typeof repoEntry.path !== 'string' || repoEntry.path.length === 0) {
      addError(errors, `${repoPath}.path`, 'must be a non-empty string');
    }
    if (typeof repoEntry.ok !== 'boolean') {
      addError(errors, `${repoPath}.ok`, 'must be a boolean');
      continue;
    }
    if (!repoEntry.ok) {
      if (typeof repoEntry.error !== 'string' || repoEntry.error.length === 0) {
        addError(errors, `${repoPath}.error`, 'must be a non-empty string when ok is false');
      }
      continue;
    }
    if (!repoEntry.export || typeof repoEntry.export !== 'object' || Array.isArray(repoEntry.export)) {
      addError(errors, `${repoPath}.export`, 'must be an object when ok is true');
      continue;
    }
    const nested = verifyExportArtifact(repoEntry.export);
    for (const nestedError of nested.errors) {
      addError(errors, `${repoPath}.export`, nestedError);
    }
  }

  verifyAggregatedEventsSummary(artifact, errors);
}

export function verifyExportArtifact(artifact) {
  const errors = [];

  if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) {
    addError(errors, 'artifact', 'must be a JSON object');
    return {
      ok: false,
      errors,
      report: {
        overall: 'fail',
        schema_version: null,
        export_kind: null,
        file_count: 0,
        errors,
      },
    };
  }

  if (!SUPPORTED_EXPORT_SCHEMA_VERSIONS.has(artifact.schema_version)) {
    addError(errors, 'schema_version', `must be one of ${[...SUPPORTED_EXPORT_SCHEMA_VERSIONS].map((v) => `"${v}"`).join(', ')}`);
  }

  if (typeof artifact.export_kind !== 'string') {
    addError(errors, 'export_kind', 'must be a string');
  }

  if (typeof artifact.exported_at !== 'string' || Number.isNaN(Date.parse(artifact.exported_at))) {
    addError(errors, 'exported_at', 'must be a valid ISO timestamp');
  }

  if (!artifact.config || typeof artifact.config !== 'object' || Array.isArray(artifact.config)) {
    addError(errors, 'config', 'must be an object');
  }

  verifyFilesMap(artifact.files, errors);

  if (artifact.export_kind === 'agentxchain_run_export') {
    verifyRunExport(artifact, errors);
  } else if (artifact.export_kind === 'agentxchain_coordinator_export') {
    verifyCoordinatorExport(artifact, errors);
  } else {
    addError(errors, 'export_kind', `unsupported export kind "${artifact.export_kind}"`);
  }

  return {
    ok: errors.length === 0,
    errors,
    report: {
      overall: errors.length === 0 ? 'pass' : 'fail',
      schema_version: artifact.schema_version || null,
      export_kind: artifact.export_kind || null,
      file_count: artifact.files && typeof artifact.files === 'object' && !Array.isArray(artifact.files)
        ? Object.keys(artifact.files).length
        : 0,
      repo_count: artifact.repos && typeof artifact.repos === 'object' && !Array.isArray(artifact.repos)
        ? Object.keys(artifact.repos).length
        : 0,
      errors,
    },
  };
}

export function loadExportArtifact(input, cwd = process.cwd()) {
  const source = input || '-';
  let raw;

  try {
    if (source === '-') {
      if (process.stdin.isTTY) {
        return {
          ok: false,
          input: 'stdin',
          error: 'No export input provided. Pass --input <path> or pipe JSON on stdin.',
        };
      }
      raw = readFileSync(0, 'utf8');
    } else {
      const resolved = resolve(cwd, source);
      raw = readFileSync(resolved, 'utf8');
    }
  } catch (error) {
    return {
      ok: false,
      input: source === '-' ? 'stdin' : resolve(cwd, source),
      error: error.message,
    };
  }

  try {
    return {
      ok: true,
      input: source === '-' ? 'stdin' : resolve(cwd, source),
      artifact: JSON.parse(raw),
    };
  } catch (error) {
    return {
      ok: false,
      input: source === '-' ? 'stdin' : resolve(cwd, source),
      error: `Invalid JSON export artifact: ${error.message}`,
    };
  }
}
