import { mkdirSync } from 'fs';
import { join } from 'path';
import { safeWriteJson } from './safe-write.js';

export function normalizeWatchEvent(input) {
  const event = unwrapEvent(input);

  if (isPullRequestEvent(event)) {
    return normalizePullRequestEvent(event);
  }

  if (isIssueLabeledEvent(event)) {
    return normalizeIssueLabeledEvent(event);
  }

  if (isWorkflowFailureEvent(event)) {
    return normalizeWorkflowFailureEvent(event);
  }

  if (isScheduleEvent(event)) {
    return normalizeScheduleEvent(event);
  }

  throw new Error('unsupported watch event: supported events are GitHub pull_request, issues.labeled, failed workflow_run, and schedule');
}

function unwrapEvent(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('watch event must be a JSON object');
  }

  if (input.provider === 'github' && typeof input.event === 'string') {
    return {
      provider: 'github',
      event: input.event,
      ...(input.payload && typeof input.payload === 'object' && !Array.isArray(input.payload) ? input.payload : input),
    };
  }

  return {
    provider: input.provider || 'github',
    event: inferGitHubEvent(input),
    ...input,
  };
}

function inferGitHubEvent(event) {
  if (event.pull_request) return 'pull_request';
  if (event.issue) return 'issues';
  if (event.workflow_run) return 'workflow_run';
  if (event.schedule || event.event === 'schedule') return 'schedule';
  return event.event || 'unknown';
}

function isPullRequestEvent(event) {
  return event.provider === 'github' && event.event === 'pull_request' && event.pull_request;
}

function isIssueLabeledEvent(event) {
  return event.provider === 'github' && event.event === 'issues' && event.action === 'labeled' && event.issue;
}

function isWorkflowFailureEvent(event) {
  if (event.provider !== 'github' || event.event !== 'workflow_run' || !event.workflow_run) return false;
  const conclusion = event.workflow_run.conclusion;
  return typeof conclusion === 'string' && !['success', 'skipped', 'cancelled'].includes(conclusion);
}

function isScheduleEvent(event) {
  return event.provider === 'github' && event.event === 'schedule';
}

function normalizePullRequestEvent(event) {
  const pr = event.pull_request;
  const repo = repositoryName(event);
  const action = normalizeToken(event.action || 'unknown');
  const signal = removeNullish({
    provider: 'github',
    event: 'pull_request',
    action,
    repository: repo,
    number: pr.number,
    title: pr.title,
    url: pr.html_url,
    head_ref: pr.head?.ref,
    head_sha: pr.head?.sha,
    base_ref: pr.base?.ref,
    draft: pr.draft,
  });

  return {
    source: 'git_ref_change',
    category: `github_pull_request_${action}`,
    repo,
    ref: pr.head?.ref || null,
    signal,
    evidence: evidenceFor(pr.html_url, pr.title || `Pull request ${pr.number || ''}`.trim()),
  };
}

function normalizeIssueLabeledEvent(event) {
  const issue = event.issue;
  const repo = repositoryName(event);
  const labelName = typeof event.label?.name === 'string' ? event.label.name : null;
  const signal = removeNullish({
    provider: 'github',
    event: 'issues',
    action: 'labeled',
    repository: repo,
    number: issue.number,
    title: issue.title,
    url: issue.html_url,
    label: labelName,
  });

  return {
    source: 'manual',
    category: 'github_issue_labeled',
    repo,
    ref: null,
    signal,
    evidence: evidenceFor(issue.html_url, issue.title || `Issue ${issue.number || ''}`.trim()),
  };
}

function normalizeWorkflowFailureEvent(event) {
  const workflowRun = event.workflow_run;
  const repo = repositoryName(event);
  const signal = removeNullish({
    provider: 'github',
    event: 'workflow_run',
    action: normalizeToken(event.action || 'completed'),
    repository: repo,
    workflow_name: workflowRun.name,
    conclusion: workflowRun.conclusion,
    status: workflowRun.status,
    run_id: workflowRun.id,
    run_number: workflowRun.run_number,
    url: workflowRun.html_url,
    head_branch: workflowRun.head_branch,
    head_sha: workflowRun.head_sha,
  });

  return {
    source: 'ci_failure',
    category: 'github_workflow_run_failed',
    repo,
    ref: workflowRun.head_branch || null,
    signal,
    evidence: evidenceFor(workflowRun.html_url, `${workflowRun.name || 'GitHub workflow'} ${workflowRun.conclusion || 'failed'}`),
  };
}

function normalizeScheduleEvent(event) {
  const repo = repositoryName(event);
  const signal = removeNullish({
    provider: 'github',
    event: 'schedule',
    repository: repo,
    schedule: event.schedule,
    workflow: event.workflow,
    ref: event.ref,
    sha: event.sha,
  });

  return {
    source: 'schedule',
    category: 'github_schedule',
    repo,
    ref: event.ref || null,
    signal,
    evidence: [{ type: 'text', value: `GitHub schedule event${event.schedule ? `: ${event.schedule}` : ''}` }],
  };
}

function repositoryName(event) {
  if (typeof event.repository === 'string') return event.repository;
  if (typeof event.repository?.full_name === 'string') return event.repository.full_name;
  if (typeof event.repository?.name === 'string') return event.repository.name;
  return null;
}

function evidenceFor(url, text) {
  if (typeof url === 'string' && url.trim()) {
    return [{ type: 'url', value: url }];
  }
  return [{ type: 'text', value: text || 'GitHub event' }];
}

function normalizeToken(value) {
  return String(value || 'unknown').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'unknown';
}

function removeNullish(input) {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== null && value !== undefined && value !== ''));
}

// ---------------------------------------------------------------------------
// Route resolution
// ---------------------------------------------------------------------------

export function resolveWatchRoute(payload, routes) {
  if (!Array.isArray(routes) || routes.length === 0) return null;

  for (const route of routes) {
    if (!route.match || !route.triage) continue;

    const match = route.match;
    if (match.source && match.source !== payload.source) continue;
    if (match.category) {
      if (match.category.includes('*')) {
        const escaped = match.category.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
        if (!new RegExp(`^${escaped}$`).test(payload.category)) continue;
      } else if (match.category !== payload.category) {
        continue;
      }
    }

    const charter = interpolateCharter(route.triage.charter, payload.signal);

    return {
      triage: {
        priority: route.triage.priority || 'p2',
        template: route.triage.template || 'generic',
        charter,
        acceptance_contract: Array.isArray(route.triage.acceptance_contract) && route.triage.acceptance_contract.length > 0
          ? route.triage.acceptance_contract
          : ['Watch event processed under governance'],
      },
      auto_approve: route.auto_approve === true,
      auto_start: route.auto_start === true,
      overwrite_planning_artifacts: route.overwrite_planning_artifacts === true,
      preferred_role: route.preferred_role || null,
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Watch result persistence
// ---------------------------------------------------------------------------

/**
 * Write a durable watch result file to `.agentxchain/watch-results/`.
 *
 * Every non-dry-run `watch --event-file` invocation writes exactly one result
 * file containing the full pipeline trace: event, intent, route match,
 * triage/approve/plan/start statuses, errors, and timestamps.
 *
 * @param {string} root - project root
 * @param {object} pipelineResult - the result object from ingestWatchEvent
 * @param {object} payload - the normalized watch event payload
 * @returns {{ result_id: string, result_path: string }}
 */
export function writeWatchResult(root, pipelineResult, payload, metadata = {}) {
  const ts = Date.now();
  const suffix = Math.random().toString(16).slice(2, 10);
  const resultId = `wr_${ts}_${suffix}`;

  const routed = pipelineResult.routed || null;
  const errors = [];

  if (routed?.auto_start_error) errors.push(routed.auto_start_error);
  if (routed?.auto_start_skipped) errors.push(`auto_start_skipped: ${routed.auto_start_skipped}`);

  const record = {
    result_id: resultId,
    timestamp: new Date(ts).toISOString(),
    event_id: pipelineResult.event?.event_id || null,
    intent_id: pipelineResult.intent?.intent_id || null,
    intent_status: pipelineResult.intent?.status || null,
    deduplicated: pipelineResult.deduplicated === true,
    delivery_id: metadata.delivery_id || null,
    payload: {
      source: payload.source,
      category: payload.category,
      repo: payload.repo || null,
      ref: payload.ref || null,
    },
    route: routed
      ? {
          matched: true,
          triaged: routed.triaged === true,
          approved: routed.approved === true,
          planned: routed.planned === true,
          started: routed.started === true,
          auto_start: routed.auto_start === true || routed.started === true,
          preferred_role: routed.preferred_role || null,
          run_id: routed.run_id || null,
          role: routed.role || null,
        }
      : { matched: false },
    errors: errors.length > 0 ? errors : [],
  };

  const dir = join(root, '.agentxchain', 'watch-results');
  mkdirSync(dir, { recursive: true });
  const resultPath = join(dir, `${resultId}.json`);
  safeWriteJson(resultPath, record);

  return { result_id: resultId, result_path: resultPath };
}

function interpolateCharter(template, signal) {
  if (!template || typeof template !== 'string') return template || 'Watch event intake';
  if (!signal || typeof signal !== 'object') return template;
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const value = signal[key];
    return value !== undefined && value !== null ? String(value) : `{{${key}}}`;
  });
}
