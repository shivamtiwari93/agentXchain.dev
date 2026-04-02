import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { readCoordinatorHistory, readBarriers } from './coordinator-state.js';

const CONTEXT_ROOT = '.agentxchain/multirepo/context';

function buildContextRef(workstreamId, targetRepoId) {
  return `ctx_${workstreamId}_${targetRepoId}_${randomBytes(4).toString('hex')}`;
}

function getContextDir(workspacePath, contextRef) {
  return join(workspacePath, CONTEXT_ROOT, contextRef);
}

function isProjectionEntry(entry) {
  return entry && typeof entry === 'object' && entry.type === 'acceptance_projection';
}

function collectUpstreamAcceptances(history, targetRepoId, relevantWorkstreamIds) {
  const relevantIds = new Set(relevantWorkstreamIds);
  return history
    .filter(isProjectionEntry)
    .filter((entry) => relevantIds.has(entry.workstream_id))
    .filter((entry) => entry.repo_id !== targetRepoId)
    .map((entry) => ({
      projection_ref: entry.projection_ref || null,
      workstream_id: entry.workstream_id,
      repo_id: entry.repo_id,
      repo_turn_id: entry.repo_turn_id || null,
      summary: entry.summary || '',
      decisions: Array.isArray(entry.decisions) ? entry.decisions : [],
      files_changed: Array.isArray(entry.files_changed) ? entry.files_changed : [],
      verification: entry.verification || null,
    }));
}

function collectActiveBarriers(barriers, workstreamIds, targetRepoId) {
  const relevantIds = new Set(workstreamIds);
  return Object.entries(barriers)
    .filter(([, barrier]) => barrier && typeof barrier === 'object')
    .filter(([, barrier]) => barrier.type !== 'all_repos_accepted')
    .filter(([, barrier]) => relevantIds.has(barrier.workstream_id))
    .filter(([, barrier]) => barrier.status && barrier.status !== 'satisfied')
    .filter(([, barrier]) => {
      if (Array.isArray(barrier.downstream_repos) && barrier.downstream_repos.includes(targetRepoId)) {
        return true;
      }
      if (Array.isArray(barrier.required_repos) && barrier.required_repos.includes(targetRepoId)) {
        return true;
      }
      if (Array.isArray(barrier.blocked_assignments)) {
        return barrier.blocked_assignments.some((assignment) => assignment === targetRepoId || assignment.startsWith(`${targetRepoId}:`));
      }
      return barrier.workstream_id === workstreamIds[0];
    })
    .map(([barrierId, barrier]) => ({
      barrier_id: barrier.barrier_id || barrierId,
      workstream_id: barrier.workstream_id,
      type: barrier.type || 'unknown',
      status: barrier.status,
      notes: barrier.notes || null,
    }));
}

function buildRequiredFollowups(workstreamId, dependencyIds, upstreamAcceptances, activeBarriers, targetRepoId) {
  const followups = [];

  for (const dependencyId of dependencyIds) {
    followups.push(`Incorporate accepted output from dependency "${dependencyId}" before changing ${targetRepoId}.`);
  }

  for (const acceptance of upstreamAcceptances) {
    followups.push(`Review ${acceptance.repo_id} acceptance${acceptance.summary ? `: ${acceptance.summary}` : ''}`.trim());
  }

  for (const barrier of activeBarriers) {
    if (barrier.notes) {
      followups.push(barrier.notes);
    } else {
      followups.push(`Respect barrier "${barrier.barrier_id}" (${barrier.type}) before proceeding.`);
    }
  }

  return [...new Set(followups)];
}

function renderContextMarkdown(snapshot) {
  const lines = [
    '# Coordinator Context',
    '',
    `- Super Run: ${snapshot.super_run_id}`,
    `- Workstream: ${snapshot.workstream_id}`,
    `- Target Repo: ${snapshot.target_repo_id}`,
    `- Context Ref: ${snapshot.context_ref}`,
    `- Generated At: ${snapshot.generated_at}`,
    '',
    '## Upstream Acceptances',
    '',
  ];

  if (snapshot.upstream_acceptances.length === 0) {
    lines.push('- None');
  } else {
    for (const acceptance of snapshot.upstream_acceptances) {
      const decisionText = acceptance.decisions.length > 0 ? ` Decisions: ${acceptance.decisions.join(', ')}.` : '';
      lines.push(`- ${acceptance.repo_id} (${acceptance.workstream_id}): ${acceptance.summary || 'No summary recorded.'}${decisionText}`);
    }
  }

  lines.push('');
  lines.push('## Active Barriers');
  lines.push('');

  if (snapshot.active_barriers.length === 0) {
    lines.push('- None');
  } else {
    for (const barrier of snapshot.active_barriers) {
      lines.push(`- ${barrier.barrier_id}: ${barrier.type} (${barrier.status})`);
    }
  }

  lines.push('');
  lines.push('## Required Follow-ups');
  lines.push('');

  if (snapshot.required_followups.length === 0) {
    lines.push('- None');
  } else {
    for (const followup of snapshot.required_followups) {
      lines.push(`- ${followup}`);
    }
  }

  lines.push('');
  return lines.join('\n');
}

export function generateCrossRepoContext(workspacePath, state, config, targetRepoId, workstreamId) {
  const workstream = config.workstreams?.[workstreamId];
  if (!workstream) {
    return { ok: false, error: `Unknown workstream "${workstreamId}"` };
  }

  const contextRef = buildContextRef(workstreamId, targetRepoId);
  const generatedAt = new Date().toISOString();
  const history = readCoordinatorHistory(workspacePath);
  const barriers = readBarriers(workspacePath);
  const relevantWorkstreamIds = [workstreamId, ...(Array.isArray(workstream.depends_on) ? workstream.depends_on : [])];
  const upstreamAcceptances = collectUpstreamAcceptances(history, targetRepoId, relevantWorkstreamIds);
  const activeBarriers = collectActiveBarriers(barriers, relevantWorkstreamIds, targetRepoId);
  const snapshot = {
    schema_version: '0.1',
    super_run_id: state.super_run_id,
    workstream_id: workstreamId,
    target_repo_id: targetRepoId,
    context_ref: contextRef,
    generated_at: generatedAt,
    upstream_acceptances: upstreamAcceptances,
    active_barriers: activeBarriers,
    required_followups: buildRequiredFollowups(
      workstreamId,
      Array.isArray(workstream.depends_on) ? workstream.depends_on : [],
      upstreamAcceptances,
      activeBarriers,
      targetRepoId,
    ),
  };

  const contextDir = getContextDir(workspacePath, contextRef);
  const jsonPath = join(contextDir, 'COORDINATOR_CONTEXT.json');
  const mdPath = join(contextDir, 'COORDINATOR_CONTEXT.md');

  mkdirSync(contextDir, { recursive: true });
  writeFileSync(jsonPath, JSON.stringify(snapshot, null, 2) + '\n');
  writeFileSync(mdPath, renderContextMarkdown(snapshot));

  return {
    ok: true,
    contextRef,
    jsonPath,
    mdPath,
    snapshot,
  };
}
