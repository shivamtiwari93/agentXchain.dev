function isProjectionEntry(entry, workstreamId) {
  return entry?.type === 'acceptance_projection' && entry.workstream_id === workstreamId;
}

function normalizeDecisionId(decision) {
  if (typeof decision === 'string') return decision;
  if (decision && typeof decision === 'object' && typeof decision.id === 'string') return decision.id;
  return null;
}

function collectAcceptedDecisionIds(history, workstreamId, requiredRepos = []) {
  const required = new Set(requiredRepos);
  const repoDecisionIds = {};
  const acceptedRepos = new Set();

  for (const entry of history) {
    if (!isProjectionEntry(entry, workstreamId)) continue;
    if (required.size > 0 && !required.has(entry.repo_id)) continue;

    acceptedRepos.add(entry.repo_id);
    if (!repoDecisionIds[entry.repo_id]) {
      repoDecisionIds[entry.repo_id] = new Set();
    }

    for (const decision of Array.isArray(entry.decisions) ? entry.decisions : []) {
      const id = normalizeDecisionId(decision);
      if (id) {
        repoDecisionIds[entry.repo_id].add(id);
      }
    }
  }

  return { acceptedRepos, repoDecisionIds };
}

export function getAcceptedReposForWorkstream(history, workstreamId, requiredRepos = []) {
  return [
    ...collectAcceptedDecisionIds(history, workstreamId, requiredRepos).acceptedRepos,
  ];
}

export function getAlignedReposForBarrier(barrier, history) {
  const requiredRepos = Array.isArray(barrier.required_repos) ? barrier.required_repos : [];
  const alignmentDecisionIds = barrier.alignment_decision_ids || {};
  const { repoDecisionIds } = collectAcceptedDecisionIds(history, barrier.workstream_id, requiredRepos);
  const alignedRepos = [];

  for (const repoId of requiredRepos) {
    const requiredIds = Array.isArray(alignmentDecisionIds[repoId]) ? alignmentDecisionIds[repoId] : [];
    if (requiredIds.length === 0) continue;

    const acceptedIds = repoDecisionIds[repoId] || new Set();
    if (requiredIds.every((decisionId) => acceptedIds.has(decisionId))) {
      alignedRepos.push(repoId);
    }
  }

  return alignedRepos;
}

export function computeAllReposAcceptedStatus(barrier, history) {
  const requiredRepos = Array.isArray(barrier.required_repos) ? barrier.required_repos : [];
  const acceptedRepos = getAcceptedReposForWorkstream(history, barrier.workstream_id, requiredRepos);

  if (acceptedRepos.length === requiredRepos.length && requiredRepos.length > 0) return 'satisfied';
  if (acceptedRepos.length > 0) return 'partially_satisfied';
  return 'pending';
}

export function computeOrderedRepoSequenceStatus(barrier, history, config) {
  const workstream = config.workstreams?.[barrier.workstream_id];
  if (!workstream) return barrier.status;

  const entryRepo = workstream.entry_repo;
  const hasUpstreamAcceptance = history.some(
    (entry) => isProjectionEntry(entry, barrier.workstream_id) && entry.repo_id === entryRepo,
  );

  if (hasUpstreamAcceptance) return 'satisfied';

  const anyDownstreamAccepted = history.some(
    (entry) => isProjectionEntry(entry, barrier.workstream_id) && entry.repo_id !== entryRepo,
  );

  if (anyDownstreamAccepted) return 'partially_satisfied';
  return 'pending';
}

export function computeInterfaceAlignmentStatus(barrier, history) {
  const requiredRepos = Array.isArray(barrier.required_repos) ? barrier.required_repos : [];
  const alignedRepos = getAlignedReposForBarrier(barrier, history);
  const acceptedRepos = getAcceptedReposForWorkstream(history, barrier.workstream_id, requiredRepos);

  if (alignedRepos.length === requiredRepos.length && requiredRepos.length > 0) return 'satisfied';
  if (acceptedRepos.length > 0) return 'partially_satisfied';
  return 'pending';
}

export function computeBarrierStatus(barrier, history, config) {
  switch (barrier.type) {
    case 'all_repos_accepted':
      return computeAllReposAcceptedStatus(barrier, history);

    case 'ordered_repo_sequence':
      return computeOrderedRepoSequenceStatus(barrier, history, config);

    case 'interface_alignment':
      return computeInterfaceAlignmentStatus(barrier, history);

    case 'shared_human_gate':
      return barrier.status;

    default:
      return barrier.status;
  }
}
