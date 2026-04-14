import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { readCoordinatorHistory, readBarriers } from './coordinator-state.js';
import { listWorkstreamHandoffs } from './intake-handoff.js';

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
      required_decision_ids_by_repo: barrier.required_decision_ids_by_repo || barrier.alignment_decision_ids || null,
      alignment_decision_ids: barrier.alignment_decision_ids || null,
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
    if (
      (barrier.type === 'interface_alignment' || barrier.type === 'named_decisions')
      && barrier.required_decision_ids_by_repo
      && Array.isArray(barrier.required_decision_ids_by_repo[targetRepoId])
      && barrier.required_decision_ids_by_repo[targetRepoId].length > 0
    ) {
      followups.push(
        `Accept declared decision requirements for ${targetRepoId}: ${barrier.required_decision_ids_by_repo[targetRepoId].join(', ')}.`,
      );
    }

    if (barrier.notes) {
      followups.push(barrier.notes);
    } else {
      followups.push(`Respect barrier "${barrier.barrier_id}" (${barrier.type}) before proceeding.`);
    }
  }

  return [...new Set(followups)];
}

function collectIntakeHandoffs(workspacePath, state, workstreamId) {
  return listWorkstreamHandoffs(workspacePath, workstreamId, state.super_run_id).map((handoff) => ({
    intent_id: handoff.intent_id,
    source_repo: handoff.source_repo,
    source_event_id: handoff.source_event_id,
    source_signal_source: handoff.source_signal_source || null,
    source_signal_category: handoff.source_signal_category || null,
    charter: handoff.charter || '',
    acceptance_contract: Array.isArray(handoff.acceptance_contract) ? handoff.acceptance_contract : [],
    source_event_ref: handoff.source_event_ref || null,
    evidence_refs: Array.isArray(handoff.evidence_refs) ? handoff.evidence_refs : [],
    handed_off_at: handoff.handed_off_at || null,
  }));
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
      let suffix = '';
      if (
        (barrier.type === 'interface_alignment' || barrier.type === 'named_decisions')
        && barrier.required_decision_ids_by_repo
        && Array.isArray(barrier.required_decision_ids_by_repo[snapshot.target_repo_id])
        && barrier.required_decision_ids_by_repo[snapshot.target_repo_id].length > 0
      ) {
        suffix = ` Required decision IDs for ${snapshot.target_repo_id}: ${barrier.required_decision_ids_by_repo[snapshot.target_repo_id].join(', ')}.`;
      }
      lines.push(`- ${barrier.barrier_id}: ${barrier.type} (${barrier.status})${suffix}`);
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

  if (snapshot.intake_handoffs.length > 0) {
    lines.push('');
    lines.push('## Intake Handoff');
    lines.push('');

    for (const handoff of snapshot.intake_handoffs) {
      lines.push(`### ${handoff.intent_id}`);
      lines.push('');
      lines.push(`- Source Repo: ${handoff.source_repo}`);
      if (handoff.source_signal_source || handoff.source_signal_category) {
        lines.push(`- Original Signal: ${handoff.source_signal_source || 'unknown'} — ${handoff.source_signal_category || 'unknown'}`);
      }
      if (handoff.charter) {
        lines.push(`- Charter: ${handoff.charter}`);
      }
      if (handoff.source_event_ref) {
        lines.push(`- Evidence: ${handoff.source_repo}/${handoff.source_event_ref}`);
      }
      if (handoff.acceptance_contract.length > 0) {
        lines.push('- Acceptance Contract:');
        for (const requirement of handoff.acceptance_contract) {
          lines.push(`  - ${requirement}`);
        }
      }
      lines.push('');
    }
  }

  lines.push('');
  return lines.join('\n');
}

/**
 * Compute which repos have stale cross-repo context after a turn is accepted in sourceRepoId.
 *
 * Returns an array of invalidation signals:
 *   { target_repo_id, context_ref, workstream_id, reason }
 *
 * A context is invalidated when:
 *   1. It was generated for a target repo (not the source)
 *   2. It included upstream acceptances from the source repo
 *   3. The source repo has since accepted a new turn (the files_changed may affect
 *      decisions/context the target repo relied on)
 *
 * This is informational — the coordinator regenerates context on next dispatch anyway.
 * The signal is for external consumers (notification pipelines, compliance validators).
 */
export function computeContextInvalidations(workspacePath, sourceRepoId, workstreamId, filesChanged) {
  const history = readCoordinatorHistory(workspacePath);

  // Find all context-generation events that included upstream acceptances from sourceRepoId
  const contextEvents = history.filter(
    (e) => e?.type === 'context_generated' && e.target_repo_id !== sourceRepoId
  );

  const invalidations = [];

  for (const ctx of contextEvents) {
    // Check if this context included projections from the source repo
    const includedSourceProjections = (ctx.upstream_repo_ids || []).includes(sourceRepoId);
    const sameWorkstream = ctx.workstream_id === workstreamId ||
      (Array.isArray(ctx.relevant_workstream_ids) && ctx.relevant_workstream_ids.includes(workstreamId));

    if (includedSourceProjections || sameWorkstream) {
      invalidations.push({
        target_repo_id: ctx.target_repo_id,
        context_ref: ctx.context_ref,
        workstream_id: ctx.workstream_id,
        source_repo_id: sourceRepoId,
        files_changed: Array.isArray(filesChanged) ? filesChanged : [],
        reason: includedSourceProjections
          ? `Context ${ctx.context_ref} included projections from ${sourceRepoId} which has a new accepted turn`
          : `Context ${ctx.context_ref} shares workstream "${workstreamId}" with newly accepted turn in ${sourceRepoId}`,
      });
    }
  }

  return invalidations;
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
  const intakeHandoffs = collectIntakeHandoffs(workspacePath, state, workstreamId);
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
    intake_handoffs: intakeHandoffs,
  };

  const contextDir = getContextDir(workspacePath, contextRef);
  const jsonPath = join(contextDir, 'COORDINATOR_CONTEXT.json');
  const mdPath = join(contextDir, 'COORDINATOR_CONTEXT.md');

  mkdirSync(contextDir, { recursive: true });
  writeFileSync(jsonPath, JSON.stringify(snapshot, null, 2) + '\n');
  writeFileSync(mdPath, renderContextMarkdown(snapshot));

  // Record context-generation event in coordinator history for invalidation tracking
  const historyFile = join(workspacePath, '.agentxchain/multirepo/history.jsonl');
  const contextEvent = {
    type: 'context_generated',
    timestamp: generatedAt,
    super_run_id: state.super_run_id,
    context_ref: contextRef,
    workstream_id: workstreamId,
    target_repo_id: targetRepoId,
    relevant_workstream_ids: relevantWorkstreamIds,
    upstream_repo_ids: [...new Set(upstreamAcceptances.map((a) => a.repo_id))],
  };
  appendFileSync(historyFile, JSON.stringify(contextEvent) + '\n');

  return {
    ok: true,
    contextRef,
    jsonPath,
    mdPath,
    snapshot,
  };
}
