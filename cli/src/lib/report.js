import { verifyExportArtifact } from './export-verifier.js';

export const GOVERNANCE_REPORT_VERSION = '0.1';

function yesNo(value) {
  return value ? 'yes' : 'no';
}

function summarizeBlockedOn(blockedOn) {
  if (!blockedOn) return 'none';
  if (typeof blockedOn === 'string') return blockedOn;
  if (typeof blockedOn !== 'object' || Array.isArray(blockedOn)) return 'present';
  if (typeof blockedOn.typed_reason === 'string' && blockedOn.typed_reason.length > 0) {
    return blockedOn.typed_reason;
  }
  if (typeof blockedOn.reason === 'string' && blockedOn.reason.length > 0) {
    return blockedOn.reason;
  }
  return 'present';
}

function summarizeBlockedState(run) {
  const blockedReason = run?.blocked_reason;
  if (blockedReason && typeof blockedReason === 'object' && !Array.isArray(blockedReason)) {
    if (typeof blockedReason.recovery?.typed_reason === 'string' && blockedReason.recovery.typed_reason.length > 0) {
      return blockedReason.recovery.typed_reason;
    }
    if (typeof blockedReason.category === 'string' && blockedReason.category.length > 0) {
      return blockedReason.category;
    }
  }
  return summarizeBlockedOn(run?.blocked_on);
}

function normalizeBudgetStatus(budgetStatus) {
  if (!budgetStatus || typeof budgetStatus !== 'object' || Array.isArray(budgetStatus)) {
    return null;
  }

  const normalized = {};
  if (Number.isFinite(budgetStatus.spent_usd)) {
    normalized.spent_usd = budgetStatus.spent_usd;
  }
  if (Number.isFinite(budgetStatus.remaining_usd)) {
    normalized.remaining_usd = budgetStatus.remaining_usd;
  }

  return Object.keys(normalized).length > 0 ? normalized : null;
}

function formatUsd(value) {
  return typeof value === 'number' ? `$${value.toFixed(2)}` : 'n/a';
}

function formatStatusCounts(statusCounts) {
  const entries = Object.entries(statusCounts || {}).sort(([left], [right]) => left.localeCompare(right, 'en'));
  if (entries.length === 0) return 'none';
  return entries.map(([status, count]) => `${status}(${count})`).join(', ');
}

function deriveRepoStatusCounts(repoStatuses) {
  const counts = {};
  for (const status of Object.values(repoStatuses || {})) {
    const key = status || 'unknown';
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function buildRunSubject(artifact) {
  const activeTurns = artifact.summary?.active_turn_ids || [];
  const retainedTurns = artifact.summary?.retained_turn_ids || [];
  const activeRoles = [...new Set(
    Object.values(artifact.state?.active_turns || {})
      .map((turn) => turn?.assigned_role)
      .filter((role) => typeof role === 'string' && role.length > 0),
  )].sort((a, b) => a.localeCompare(b, 'en'));

  return {
    kind: 'governed_run',
    project: {
      id: artifact.project?.id || null,
      name: artifact.project?.name || null,
      template: artifact.project?.template || 'generic',
      protocol_mode: artifact.project?.protocol_mode || null,
      schema_version: artifact.project?.schema_version || null,
    },
    run: {
      run_id: artifact.summary?.run_id || null,
      status: artifact.summary?.status || null,
      phase: artifact.summary?.phase || null,
      blocked_on: artifact.state?.blocked_on || null,
      blocked_reason: artifact.state?.blocked_reason || null,
      active_turn_count: activeTurns.length,
      retained_turn_count: retainedTurns.length,
      active_turn_ids: activeTurns,
      retained_turn_ids: retainedTurns,
      active_roles: activeRoles,
      budget_status: normalizeBudgetStatus(artifact.state?.budget_status),
    },
    artifacts: {
      history_entries: artifact.summary?.history_entries || 0,
      decision_entries: artifact.summary?.decision_entries || 0,
      hook_audit_entries: artifact.summary?.hook_audit_entries || 0,
      notification_audit_entries: artifact.summary?.notification_audit_entries || 0,
      dispatch_artifact_files: artifact.summary?.dispatch_artifact_files || 0,
      staging_artifact_files: artifact.summary?.staging_artifact_files || 0,
      intake_present: Boolean(artifact.summary?.intake_present),
      coordinator_present: Boolean(artifact.summary?.coordinator_present),
    },
  };
}

function buildCoordinatorSubject(artifact) {
  const repoStatuses = artifact.summary?.repo_run_statuses || {};
  const repoStatusCounts = deriveRepoStatusCounts(repoStatuses);
  const repos = Object.entries(artifact.repos || {})
    .sort(([left], [right]) => left.localeCompare(right, 'en'))
    .map(([repoId, repoEntry]) => ({
      repo_id: repoId,
      path: repoEntry?.path || null,
      ok: Boolean(repoEntry?.ok),
      status: repoEntry?.ok ? repoEntry.export?.summary?.status || null : null,
      run_id: repoEntry?.ok ? repoEntry.export?.summary?.run_id || null : null,
      phase: repoEntry?.ok ? repoEntry.export?.summary?.phase || null : null,
      project_id: repoEntry?.ok ? repoEntry.export?.project?.id || null : null,
      project_name: repoEntry?.ok ? repoEntry.export?.project?.name || null : null,
      error: repoEntry?.ok ? null : repoEntry?.error || null,
    }));

  const repoErrorCount = repos.filter((repo) => !repo.ok).length;

  return {
    kind: 'coordinator_workspace',
    coordinator: {
      project_id: artifact.coordinator?.project_id || null,
      project_name: artifact.coordinator?.project_name || null,
      schema_version: artifact.coordinator?.schema_version || null,
      repo_count: artifact.coordinator?.repo_count || 0,
      workstream_count: artifact.coordinator?.workstream_count || 0,
    },
    run: {
      super_run_id: artifact.summary?.super_run_id || null,
      status: artifact.summary?.status || null,
      phase: artifact.summary?.phase || null,
      barrier_count: artifact.summary?.barrier_count || 0,
      repo_status_counts: repoStatusCounts,
      repo_ok_count: repos.length - repoErrorCount,
      repo_error_count: repoErrorCount,
    },
    repos,
    artifacts: {
      history_entries: artifact.summary?.history_entries || 0,
      decision_entries: artifact.summary?.decision_entries || 0,
    },
  };
}

export function buildGovernanceReport(artifact, { input = 'stdin', generatedAt = new Date().toISOString() } = {}) {
  const verification = verifyExportArtifact(artifact);
  if (!verification.ok) {
    return {
      ok: false,
      exitCode: 1,
      report: {
        overall: 'fail',
        input,
        message: 'Cannot build governance report from invalid export artifact.',
        verification: verification.report,
      },
    };
  }

  let subject;
  if (artifact.export_kind === 'agentxchain_run_export') {
    subject = buildRunSubject(artifact);
  } else if (artifact.export_kind === 'agentxchain_coordinator_export') {
    subject = buildCoordinatorSubject(artifact);
  } else {
    return {
      ok: false,
      exitCode: 1,
      report: {
        overall: 'fail',
        input,
        message: 'Cannot build governance report from invalid export artifact.',
        verification: verification.report,
      },
    };
  }

  return {
    ok: true,
    exitCode: 0,
    report: {
      report_version: GOVERNANCE_REPORT_VERSION,
      overall: 'pass',
      generated_at: generatedAt,
      input,
      export_kind: artifact.export_kind,
      verification: verification.report,
      subject,
    },
  };
}

export function formatGovernanceReportText(report) {
  if (report.overall === 'error') {
    return [
      'AgentXchain Governance Report',
      `Input: ${report.input}`,
      'Status: ERROR',
      `Message: ${report.message}`,
    ].join('\n');
  }

  if (report.overall === 'fail') {
    return [
      'AgentXchain Governance Report',
      `Input: ${report.input}`,
      'Verification: FAIL',
      report.message,
      'Errors:',
      ...(report.verification?.errors || []).map((error) => `- ${error}`),
    ].join('\n');
  }

  if (report.subject.kind === 'governed_run') {
    const { project, run, artifacts } = report.subject;
    const lines = [
      'AgentXchain Governance Report',
      `Input: ${report.input}`,
      `Export kind: ${report.export_kind}`,
      'Verification: PASS',
      `Project: ${project.name || 'unknown'} (${project.id || 'unknown'})`,
      `Template: ${project.template}`,
      `Protocol: ${project.protocol_mode || 'unknown'} (config schema ${project.schema_version || 'unknown'})`,
      `Run: ${run.run_id || 'none'}`,
      `Status: ${run.status || 'unknown'}`,
      `Phase: ${run.phase || 'unknown'}`,
      `Blocked on: ${summarizeBlockedState(run)}`,
      `Active turns: ${run.active_turn_count}${run.active_turn_ids.length ? ` (${run.active_turn_ids.join(', ')})` : ''}`,
      `Retained turns: ${run.retained_turn_count}${run.retained_turn_ids.length ? ` (${run.retained_turn_ids.join(', ')})` : ''}`,
      `Active roles: ${run.active_roles.length ? run.active_roles.join(', ') : 'none'}`,
    ];

    if (run.budget_status) {
      lines.push(
        `Budget: spent ${formatUsd(run.budget_status.spent_usd)}, remaining ${formatUsd(run.budget_status.remaining_usd)}`,
      );
    }

    lines.push(
      `History entries: ${artifacts.history_entries}`,
      `Decision entries: ${artifacts.decision_entries}`,
      `Hook audit entries: ${artifacts.hook_audit_entries}`,
      `Notification audit entries: ${artifacts.notification_audit_entries}`,
      `Dispatch files: ${artifacts.dispatch_artifact_files}`,
      `Staging files: ${artifacts.staging_artifact_files}`,
      `Intake artifacts: ${yesNo(artifacts.intake_present)}`,
      `Coordinator artifacts: ${yesNo(artifacts.coordinator_present)}`,
    );

    return lines.join('\n');
  }

  const { coordinator, run, artifacts, repos } = report.subject;
  return [
    'AgentXchain Governance Report',
    `Input: ${report.input}`,
    `Export kind: ${report.export_kind}`,
    'Verification: PASS',
    `Workspace: ${coordinator.project_name || 'unknown'} (${coordinator.project_id || 'unknown'})`,
    `Coordinator schema: ${coordinator.schema_version || 'unknown'}`,
    `Super run: ${run.super_run_id || 'none'}`,
    `Status: ${run.status || 'unknown'}`,
    `Phase: ${run.phase || 'unknown'}`,
    `Repos: ${coordinator.repo_count} total, ${run.repo_ok_count} exported cleanly, ${run.repo_error_count} failed`,
    `Workstreams: ${coordinator.workstream_count}`,
    `Barriers: ${run.barrier_count}`,
    `Repo statuses: ${formatStatusCounts(run.repo_status_counts)}`,
    `History entries: ${artifacts.history_entries}`,
    `Decision entries: ${artifacts.decision_entries}`,
    'Repo details:',
    ...repos.map((repo) => repo.ok
      ? `- ${repo.repo_id}: ok, status ${repo.status || 'unknown'}, run ${repo.run_id || 'none'}, path ${repo.path || 'unknown'}`
      : `- ${repo.repo_id}: failed export, ${repo.error || 'unknown error'}, path ${repo.path || 'unknown'}`),
  ].join('\n');
}

export function formatGovernanceReportMarkdown(report) {
  if (report.overall === 'error') {
    return [
      '# AgentXchain Governance Report',
      '',
      `- Input: \`${report.input}\``,
      '- Status: `error`',
      `- Message: ${report.message}`,
    ].join('\n');
  }

  if (report.overall === 'fail') {
    return [
      '# AgentXchain Governance Report',
      '',
      `- Input: \`${report.input}\``,
      '- Verification: `fail`',
      `- Message: ${report.message}`,
      '',
      '## Verification Errors',
      '',
      ...(report.verification?.errors || []).map((error) => `- ${error}`),
    ].join('\n');
  }

  if (report.subject.kind === 'governed_run') {
    const { project, run, artifacts } = report.subject;
    const lines = [
      '# AgentXchain Governance Report',
      '',
      `- Input: \`${report.input}\``,
      `- Export kind: \`${report.export_kind}\``,
      '- Verification: `pass`',
      `- Project: ${project.name || 'unknown'} (\`${project.id || 'unknown'}\`)`,
      `- Template: \`${project.template}\``,
      `- Protocol: \`${project.protocol_mode || 'unknown'}\` (config schema \`${project.schema_version || 'unknown'}\`)`,
      `- Run: \`${run.run_id || 'none'}\``,
      `- Status: \`${run.status || 'unknown'}\``,
      `- Phase: \`${run.phase || 'unknown'}\``,
      `- Blocked on: \`${summarizeBlockedState(run)}\``,
      `- Active turns: ${run.active_turn_count}${run.active_turn_ids.length ? ` (\`${run.active_turn_ids.join('`, `')}\`)` : ''}`,
      `- Retained turns: ${run.retained_turn_count}${run.retained_turn_ids.length ? ` (\`${run.retained_turn_ids.join('`, `')}\`)` : ''}`,
      `- Active roles: ${run.active_roles.length ? `\`${run.active_roles.join('`, `')}\`` : '`none`'}`,
    ];

    if (run.budget_status) {
      lines.push(`- Budget: spent ${formatUsd(run.budget_status.spent_usd)}, remaining ${formatUsd(run.budget_status.remaining_usd)}`);
    }

    lines.push(
      `- History entries: ${artifacts.history_entries}`,
      `- Decision entries: ${artifacts.decision_entries}`,
      `- Hook audit entries: ${artifacts.hook_audit_entries}`,
      `- Notification audit entries: ${artifacts.notification_audit_entries}`,
      `- Dispatch files: ${artifacts.dispatch_artifact_files}`,
      `- Staging files: ${artifacts.staging_artifact_files}`,
      `- Intake artifacts: \`${yesNo(artifacts.intake_present)}\``,
      `- Coordinator artifacts: \`${yesNo(artifacts.coordinator_present)}\``,
    );

    return lines.join('\n');
  }

  const { coordinator, run, artifacts, repos } = report.subject;
  return [
    '# AgentXchain Governance Report',
    '',
    `- Input: \`${report.input}\``,
    `- Export kind: \`${report.export_kind}\``,
    '- Verification: `pass`',
    `- Workspace: ${coordinator.project_name || 'unknown'} (\`${coordinator.project_id || 'unknown'}\`)`,
    `- Coordinator schema: \`${coordinator.schema_version || 'unknown'}\``,
    `- Super run: \`${run.super_run_id || 'none'}\``,
    `- Status: \`${run.status || 'unknown'}\``,
    `- Phase: \`${run.phase || 'unknown'}\``,
    `- Repos: ${coordinator.repo_count} total, ${run.repo_ok_count} exported cleanly, ${run.repo_error_count} failed`,
    `- Workstreams: ${coordinator.workstream_count}`,
    `- Barriers: ${run.barrier_count}`,
    `- Repo statuses: ${formatStatusCounts(run.repo_status_counts)}`,
    `- History entries: ${artifacts.history_entries}`,
    `- Decision entries: ${artifacts.decision_entries}`,
    '',
    '## Repo Details',
    '',
    ...repos.map((repo) => repo.ok
      ? `- \`${repo.repo_id}\`: ok, status \`${repo.status || 'unknown'}\`, run \`${repo.run_id || 'none'}\`, path \`${repo.path || 'unknown'}\``
      : `- \`${repo.repo_id}\`: failed export, ${repo.error || 'unknown error'}, path \`${repo.path || 'unknown'}\``),
  ].join('\n');
}
