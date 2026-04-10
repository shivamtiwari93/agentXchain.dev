"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadGovernedStatus = loadGovernedStatus;
exports.parseGovernedStatus = parseGovernedStatus;
exports.renderGovernedStatusLines = renderGovernedStatusLines;
exports.renderGovernedStatusHtml = renderGovernedStatusHtml;
exports.summarizeGovernedStatus = summarizeGovernedStatus;
exports.getGovernedStepAction = getGovernedStepAction;
exports.getGovernedRunAction = getGovernedRunAction;
exports.buildCliShellCommand = buildCliShellCommand;
exports.execCliCommand = execCliCommand;
exports.loadGovernedReport = loadGovernedReport;
exports.renderReportLines = renderReportLines;
const child_process_1 = require("child_process");
const util_1 = require("util");
const util_2 = require("./util");
const execFileAsync = (0, util_1.promisify)(child_process_1.execFile);
async function loadGovernedStatus(root) {
    const { stdout, stderr } = await execCliCommand(root, ['status', '--json']);
    return parseGovernedStatus(stdout, stderr);
}
function parseGovernedStatus(stdout, stderr = '') {
    let payload;
    try {
        payload = JSON.parse(stdout);
    }
    catch {
        throw new Error(`AgentXchain CLI returned unreadable JSON.${formatStderr(stderr)}`);
    }
    if (payload?.protocol_mode !== 'governed') {
        throw new Error('AgentXchain CLI status did not report governed mode.');
    }
    return payload;
}
function renderGovernedStatusLines(payload) {
    const config = payload.config ?? null;
    const state = payload.state ?? null;
    const continuity = payload.continuity ?? null;
    const artifacts = payload.workflow_kit_artifacts?.artifacts ?? [];
    const projectName = (0, util_2.getProjectName)(config);
    const lines = [
        `Project: ${projectName}`,
        `Mode: Governed (${payload.version ?? 'unknown'})`,
        `Template: ${payload.template || 'generic'}`,
        `Run status: ${state?.status || 'idle'}`,
        `Phase: ${state?.phase || 'unknown'}`,
        `Turn count: ${state?.turn_sequence ?? 0}`,
    ];
    if (state?.current_turn?.turn_id) {
        lines.push(`Current turn: ${state.current_turn.turn_id}`);
    }
    if (state?.accepted_integration_ref) {
        lines.push(`Accepted integration: ${state.accepted_integration_ref}`);
    }
    lines.push(`Blocked: ${formatBlockedState(state)}`);
    if (state?.pending_phase_transition) {
        const pending = state.pending_phase_transition;
        lines.push(`Pending phase transition: ${(pending.from || 'unknown')} -> ${(pending.to || 'unknown')} (${pending.gate || 'unknown gate'})`);
    }
    if (state?.pending_run_completion) {
        lines.push(`Pending run completion: ${state.pending_run_completion.gate || 'awaiting approval'}`);
    }
    if (continuity?.checkpoint) {
        lines.push('');
        lines.push('Continuity:');
        lines.push(`  Session: ${continuity.checkpoint.session_id || 'unknown'}`);
        lines.push(`  Checkpoint: ${formatCheckpoint(continuity.checkpoint.checkpoint_reason, continuity.checkpoint.last_checkpoint_at)}`);
        lines.push(`  Last turn: ${continuity.checkpoint.last_turn_id || 'none'}`);
        lines.push(`  Last role: ${continuity.checkpoint.last_role || 'unknown'}`);
    }
    if (continuity?.recommended_command) {
        lines.push(`  Action: ${continuity.recommended_command}`);
        if (continuity.recommended_detail) {
            lines.push(`  Detail: ${continuity.recommended_detail}`);
        }
    }
    if (continuity?.recovery_report_path) {
        lines.push(`  Recovery report: ${continuity.recovery_report_path}`);
    }
    const driftWarnings = continuity?.drift_warnings ?? [];
    if (driftWarnings.length > 0) {
        lines.push('  Drift:');
        for (const warning of driftWarnings) {
            lines.push(`    - ${warning}`);
        }
    }
    if (artifacts.length > 0) {
        lines.push('');
        lines.push(`Workflow-kit artifacts (${payload.workflow_kit_artifacts?.phase || state?.phase || 'unknown'}):`);
        for (const artifact of artifacts) {
            const indicator = artifact.exists ? 'present' : 'missing';
            const required = artifact.required ? 'required' : 'optional';
            const owner = artifact.owned_by ? ` (${artifact.owned_by})` : '';
            lines.push(`  - ${artifact.path}: ${indicator}, ${required}${owner}`);
        }
    }
    return lines;
}
function renderGovernedStatusHtml(payload, notice) {
    const config = payload.config ?? null;
    const state = payload.state ?? null;
    const continuity = payload.continuity ?? null;
    const artifacts = payload.workflow_kit_artifacts?.artifacts ?? [];
    const projectName = (0, util_2.getProjectName)(config);
    const blocked = formatBlockedState(state);
    const pendingTransition = state?.pending_phase_transition;
    const pendingCompletion = state?.pending_run_completion;
    const stepAction = getGovernedStepAction(payload);
    const runAction = getGovernedRunAction(payload);
    return `<!DOCTYPE html>
<html>
<head><style>
  body { font-family: var(--vscode-font-family); padding: 12px; color: var(--vscode-foreground); background: var(--vscode-sideBar-background); font-size: 13px; }
  h2 { font-size: 14px; margin: 0 0 12px 0; font-weight: 600; }
  .section { margin-bottom: 16px; }
  .label { color: var(--vscode-descriptionForeground); font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px; }
  .value { font-size: 14px; font-weight: 600; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .card { background: var(--vscode-editor-background); border: 1px solid var(--vscode-widget-border); border-radius: 6px; padding: 8px 10px; }
  .tone-governed { color: #3a9ad9; }
  .note { background: rgba(58,154,217,0.12); border: 1px solid rgba(58,154,217,0.25); color: var(--vscode-foreground); padding: 8px 10px; border-radius: 6px; line-height: 1.45; }
  .warning { background: rgba(232,190,64,0.12); border: 1px solid rgba(232,190,64,0.28); color: var(--vscode-foreground); padding: 8px 10px; border-radius: 6px; line-height: 1.45; }
  .blocked { background: rgba(232,117,42,0.15); border: 1px solid rgba(232,117,42,0.3); color: #e8752a; padding: 8px 10px; border-radius: 6px; font-weight: 600; }
  ul { margin: 6px 0 0 18px; padding: 0; }
  li { margin: 4px 0; }
  .btn { display: inline-block; padding: 4px 12px; border-radius: 4px; cursor: pointer; font-size: 12px; font-weight: 600; border: 1px solid var(--vscode-button-border); margin-right: 6px; text-decoration: none; }
  .btn-primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  .btn-secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
</style></head>
<body>
  <h2>AgentXchain</h2>

  <div class="section">
    <div class="label">Project</div>
    <div class="value">${escapeHtml(projectName)}</div>
  </div>

  <div class="grid">
    <div class="card">
      <div class="label">Mode</div>
      <div class="value tone-governed">Governed</div>
    </div>
    <div class="card">
      <div class="label">Run status</div>
      <div class="value">${escapeHtml(state?.status || 'idle')}</div>
    </div>
    <div class="card">
      <div class="label">Phase</div>
      <div class="value">${escapeHtml(state?.phase || 'unknown')}</div>
    </div>
    <div class="card">
      <div class="label">Turn count</div>
      <div class="value">${String(state?.turn_sequence ?? 0)}</div>
    </div>
  </div>

  <div class="section" style="margin-top:16px;">
    <div class="label">Blocked</div>
    <div class="value">${escapeHtml(blocked)}</div>
  </div>

  ${pendingTransition
        ? `<div class="section"><div class="label">Pending phase transition</div><div class="warning">${escapeHtml(`${pendingTransition.from || 'unknown'} \u2192 ${pendingTransition.to || 'unknown'} (${pendingTransition.gate || 'unknown gate'})`)}</div><div style="margin-top:8px;"><a class="btn btn-primary" href="command:agentxchain.approveTransition">Approve Transition</a></div></div>`
        : ''}
  ${pendingCompletion
        ? `<div class="section"><div class="label">Pending run completion</div><div class="warning">${escapeHtml(pendingCompletion.gate || 'awaiting approval')}</div><div style="margin-top:8px;"><a class="btn btn-primary" href="command:agentxchain.approveCompletion">Approve Completion</a></div></div>`
        : ''}
  ${stepAction
        ? `<div class="section"><div class="label">${stepAction.label === 'Resume Step' ? 'Recovery action' : 'Next action'}</div><div style="margin-top:8px;"><a class="btn btn-secondary" href="command:agentxchain.step">${escapeHtml(stepAction.label)}</a></div></div>`
        : ''}
  ${runAction
        ? `<div class="section"><div class="label">Run loop</div><div style="margin-top:8px;"><a class="btn btn-secondary" href="command:agentxchain.run">${escapeHtml(runAction.label)}</a></div></div>`
        : ''}
  ${state?.blocked || state?.status === 'blocked'
        ? `<div class="section"><div class="blocked">Blocked reason: ${escapeHtml(state?.blocked_reason || state?.blocked_on || 'unknown')}</div></div>`
        : ''}

  ${continuity?.checkpoint
        ? `<div class="section">
      <div class="label">Continuity</div>
      <div class="card">
        <div><strong>Session:</strong> ${escapeHtml(continuity.checkpoint.session_id || 'unknown')}</div>
        <div><strong>Checkpoint:</strong> ${escapeHtml(formatCheckpoint(continuity.checkpoint.checkpoint_reason, continuity.checkpoint.last_checkpoint_at))}</div>
        <div><strong>Last turn:</strong> ${escapeHtml(continuity.checkpoint.last_turn_id || 'none')}</div>
        <div><strong>Last role:</strong> ${escapeHtml(continuity.checkpoint.last_role || 'unknown')}</div>
        ${continuity.recommended_command
            ? `<div><strong>Action:</strong> ${escapeHtml(continuity.recommended_command)}</div>`
            : ''}
        ${continuity.recommended_detail
            ? `<div><strong>Detail:</strong> ${escapeHtml(continuity.recommended_detail)}</div>`
            : ''}
        ${continuity.recovery_report_path
            ? `<div><strong>Recovery report:</strong> ${escapeHtml(continuity.recovery_report_path)}</div>`
            : ''}
      </div>
    </div>`
        : ''}

  ${artifacts.length > 0
        ? `<div class="section">
      <div class="label">Workflow-kit artifacts</div>
      <ul>${artifacts.map((artifact) => `<li>${escapeHtml(`${artifact.path} — ${artifact.exists ? 'present' : 'missing'}${artifact.required ? ', required' : ', optional'}${artifact.owned_by ? `, ${artifact.owned_by}` : ''}`)}</li>`).join('')}</ul>
    </div>`
        : ''}

  <div class="section">
    <div class="label">Boundary</div>
    <div class="note">${escapeHtml(notice)}</div>
  </div>
</body>
</html>`;
}
function summarizeGovernedStatus(payload) {
    const config = payload.config ?? null;
    const state = payload.state ?? null;
    const projectName = (0, util_2.getProjectName)(config);
    const phase = state?.phase || 'unknown';
    const status = state?.status || 'idle';
    let tone = 'default';
    if (state?.blocked || state?.status === 'blocked' || state?.escalation_active) {
        tone = 'error';
    }
    else if (state?.pending_phase_transition || state?.pending_run_completion) {
        tone = 'warning';
    }
    const tooltipLines = [
        projectName,
        `Phase: ${phase}`,
        `Run: ${status}`,
    ];
    const blocked = formatBlockedState(state);
    if (blocked !== 'No') {
        tooltipLines.push(`Blocked: ${blocked}`);
    }
    if (payload.continuity?.recommended_command) {
        tooltipLines.push(`Action: ${payload.continuity.recommended_command}`);
    }
    return {
        text: `$(shield) AXC: governed | ${phase} | ${status}`,
        tooltip: tooltipLines.join('\n'),
        tone,
    };
}
function getGovernedStepAction(payload) {
    const state = payload.state ?? null;
    if (!state) {
        return null;
    }
    if (state.pending_phase_transition || state.pending_run_completion) {
        return null;
    }
    const recommendedStepArgs = parseRecommendedStepArgs(payload.continuity?.recommended_command);
    if (recommendedStepArgs) {
        return {
            cliArgs: recommendedStepArgs,
            label: recommendedStepArgs.includes('--resume') ? 'Resume Step' : 'Dispatch Step',
        };
    }
    if (state.blocked || state.status === 'blocked' || state.status === 'completed' || state.status === 'failed') {
        return null;
    }
    return {
        cliArgs: ['step'],
        label: 'Dispatch Step',
    };
}
function getGovernedRunAction(payload) {
    const state = payload.state ?? null;
    if (!state) {
        return {
            cliArgs: ['run'],
            label: 'Start Run',
        };
    }
    if (state.pending_phase_transition || state.pending_run_completion) {
        return null;
    }
    if (state.blocked || state.status === 'blocked' || state.status === 'completed' || state.status === 'failed') {
        return null;
    }
    return {
        cliArgs: ['run'],
        label: state.status === 'idle' ? 'Start Run' : 'Resume Run',
    };
}
function buildCliShellCommand(cliArgs) {
    const cliPath = process.env.AGENTXCHAIN_CLI_PATH?.trim();
    const invocation = resolveCliInvocation(cliPath);
    return [...invocation.command ? [invocation.command] : [], ...invocation.args, ...cliArgs]
        .map(quoteShellArg)
        .join(' ');
}
/**
 * Execute an agentxchain CLI command as a subprocess.
 * Used by governed status, approval commands, and future operator actions.
 */
async function execCliCommand(root, cliArgs, timeoutMs = 60_000) {
    const cliPath = process.env.AGENTXCHAIN_CLI_PATH?.trim();
    const invocation = resolveCliInvocation(cliPath);
    try {
        return await execFileAsync(invocation.command, [...invocation.args, ...cliArgs], {
            cwd: root,
            timeout: timeoutMs,
            maxBuffer: 1024 * 1024,
            env: { ...process.env, NO_COLOR: '1' },
        });
    }
    catch (error) {
        const message = formatCliFailure(error);
        throw new Error(message);
    }
}
function resolveCliInvocation(cliPath) {
    if (!cliPath) {
        return { command: 'agentxchain', args: [] };
    }
    if (cliPath.endsWith('.js')) {
        return { command: process.execPath, args: [cliPath] };
    }
    return { command: cliPath, args: [] };
}
function parseRecommendedStepArgs(command) {
    if (!command) {
        return null;
    }
    const tokens = command.trim().split(/\s+/).filter(Boolean);
    if (tokens.length < 2 || tokens[0] !== 'agentxchain' || tokens[1] !== 'step') {
        return null;
    }
    return tokens.slice(1);
}
function formatCliFailure(error) {
    const failure = error;
    if (failure.code === 'ENOENT') {
        return 'AgentXchain CLI not found on PATH. Install it with `npm install -g agentxchain`, or set AGENTXCHAIN_CLI_PATH for local testing.';
    }
    const stderr = typeof failure.stderr === 'string' ? failure.stderr.trim() : '';
    const stdout = typeof failure.stdout === 'string' ? failure.stdout.trim() : '';
    const detail = stderr || stdout || failure.message || 'unknown CLI failure';
    return `AgentXchain CLI status failed: ${detail}`;
}
function formatBlockedState(state) {
    if (!state) {
        return 'No';
    }
    if (state.blocked || state.status === 'blocked') {
        return state.blocked_reason || state.blocked_on || 'YES';
    }
    if (state.blocked_on) {
        return state.blocked_on;
    }
    return 'No';
}
function formatCheckpoint(reason, timestamp) {
    if (reason && timestamp) {
        return `${reason} at ${timestamp}`;
    }
    return reason || timestamp || 'unknown';
}
async function loadGovernedReport(root) {
    // Step 1: Export the governed run artifact
    const exportResult = await execCliCommand(root, ['export'], 120_000);
    const exportJson = exportResult.stdout.trim();
    if (!exportJson) {
        throw new Error('AgentXchain export returned empty output. Is a governed run active?');
    }
    // Step 2: Write export to temp file, then run report --input <tmpfile> --format json
    const os = await import('os');
    const path = await import('path');
    const fs = await import('fs');
    const tmpFile = path.join(os.tmpdir(), `axc-report-${Date.now()}.json`);
    try {
        fs.writeFileSync(tmpFile, exportJson);
        const reportResult = await execCliCommand(root, ['report', '--input', tmpFile, '--format', 'json'], 120_000);
        const parsed = JSON.parse(reportResult.stdout);
        return parsed;
    }
    finally {
        try {
            fs.unlinkSync(tmpFile);
        }
        catch { /* ignore cleanup failure */ }
    }
}
function renderReportLines(report) {
    const lines = [];
    const subject = report.subject;
    const run = subject?.run;
    lines.push(`Overall: ${report.overall ?? 'unknown'}`);
    lines.push(`Generated: ${report.generated_at ?? 'unknown'}`);
    lines.push(`Export kind: ${report.export_kind ?? 'unknown'}`);
    lines.push('');
    if (report.verification) {
        lines.push(`Verification: ${report.verification.ok ? 'PASS' : 'FAIL'}`);
        if (report.verification.errors?.length) {
            for (const err of report.verification.errors) {
                lines.push(`  ! ${err}`);
            }
        }
        lines.push('');
    }
    if (subject?.project) {
        lines.push('Project');
        lines.push(`  Name: ${subject.project.name ?? 'unknown'}`);
        lines.push(`  ID: ${subject.project.id ?? 'unknown'}`);
        lines.push(`  Template: ${subject.project.template ?? 'generic'}`);
        lines.push(`  Schema: ${subject.project.schema_version ?? 'unknown'}`);
        lines.push('');
    }
    if (run) {
        lines.push('Run');
        lines.push(`  Run ID: ${run.run_id ?? 'unknown'}`);
        lines.push(`  Status: ${run.status ?? 'unknown'}`);
        lines.push(`  Phase: ${run.phase ?? 'unknown'}`);
        lines.push(`  Active turns: ${run.active_turn_count ?? 0}`);
        lines.push(`  Retained turns: ${run.retained_turn_count ?? 0}`);
        if (run.active_roles?.length) {
            lines.push(`  Roles: ${run.active_roles.join(', ')}`);
        }
        if (run.budget_status) {
            lines.push(`  Budget: $${(run.budget_status.spent_usd ?? 0).toFixed(4)} spent, $${(run.budget_status.remaining_usd ?? 0).toFixed(4)} remaining`);
        }
        if (run.created_at) {
            lines.push(`  Created: ${run.created_at}`);
        }
        if (run.completed_at) {
            lines.push(`  Completed: ${run.completed_at}`);
        }
        if (run.duration_seconds != null) {
            lines.push(`  Duration: ${run.duration_seconds}s`);
        }
        if (run.blocked_on || run.blocked_reason) {
            lines.push(`  Blocked: ${run.blocked_reason || run.blocked_on || 'YES'}`);
        }
        lines.push('');
        if (run.turns?.length) {
            lines.push('Turn Timeline');
            for (const turn of run.turns) {
                const phase = turn.phase ?? '';
                const transition = turn.phase_transition ? ` [${turn.phase_transition}]` : '';
                const cost = turn.cost_usd != null ? ` ($${turn.cost_usd.toFixed(4)})` : '';
                const files = turn.files_changed_count ? ` ${turn.files_changed_count} files` : '';
                lines.push(`  ${turn.turn_id ?? '?'} | ${turn.role ?? '?'} | ${turn.status ?? '?'} | ${phase}${transition}${files}${cost}`);
                if (turn.summary) {
                    lines.push(`    ${turn.summary}`);
                }
                if (turn.decisions?.length) {
                    for (const d of turn.decisions) {
                        lines.push(`    DEC: ${d}`);
                    }
                }
                if (turn.objections?.length) {
                    for (const o of turn.objections) {
                        lines.push(`    OBJ: ${o}`);
                    }
                }
            }
            lines.push('');
        }
        if (run.decisions?.length) {
            lines.push('Decision Ledger');
            for (const dec of run.decisions) {
                lines.push(`  ${dec.id ?? '?'} (${dec.role ?? '?'}, ${dec.phase ?? '?'}): ${dec.statement ?? ''}`);
            }
            lines.push('');
        }
        if (run.workflow_kit_artifacts?.length) {
            lines.push('Workflow-Kit Artifacts');
            for (const artifact of run.workflow_kit_artifacts) {
                const indicator = artifact.exists ? 'present' : 'MISSING';
                const required = artifact.required ? 'required' : 'optional';
                const owner = artifact.owned_by ? ` (${artifact.owned_by})` : '';
                lines.push(`  ${artifact.path ?? '?'}: ${indicator}, ${required}${owner}`);
            }
            lines.push('');
        }
    }
    if (subject?.artifacts) {
        lines.push('Artifact Counts');
        lines.push(`  History entries: ${subject.artifacts.history_entries ?? 0}`);
        lines.push(`  Decision entries: ${subject.artifacts.decision_entries ?? 0}`);
        lines.push(`  Hook audit entries: ${subject.artifacts.hook_audit_entries ?? 0}`);
        lines.push(`  Dispatch files: ${subject.artifacts.dispatch_artifact_files ?? 0}`);
        lines.push(`  Staging files: ${subject.artifacts.staging_artifact_files ?? 0}`);
    }
    return lines;
}
function formatStderr(stderr) {
    const trimmed = stderr.trim();
    return trimmed ? ` ${trimmed}` : '';
}
function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
function quoteShellArg(value) {
    if (/^[A-Za-z0-9_./:=+-]+$/.test(value)) {
        return value;
    }
    return JSON.stringify(value);
}
//# sourceMappingURL=governedStatus.js.map