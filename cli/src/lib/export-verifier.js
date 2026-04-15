import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

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
