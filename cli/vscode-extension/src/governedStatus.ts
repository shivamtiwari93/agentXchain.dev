import { execFile } from 'child_process';
import { promisify } from 'util';
import { AgentConfig, getProjectName } from './util';

const execFileAsync = promisify(execFile);

export interface GovernedTurnState {
  turn_id?: string;
  assigned_role?: string;
  runtime_id?: string;
  status?: string;
  attempt?: number;
}

export interface GovernedPendingTransition {
  from?: string;
  to?: string;
  gate?: string;
}

export interface GovernedPendingCompletion {
  gate?: string;
}

export interface GovernedState {
  phase?: string;
  status?: string;
  blocked?: boolean;
  blocked_on?: string | null;
  blocked_reason?: string | null;
  escalation_active?: boolean;
  accepted_integration_ref?: string | null;
  turn_sequence?: number;
  current_turn?: GovernedTurnState | null;
  pending_phase_transition?: GovernedPendingTransition | null;
  pending_run_completion?: GovernedPendingCompletion | null;
  completed_at?: string | null;
}

export interface ContinuityCheckpoint {
  session_id?: string | null;
  last_checkpoint_at?: string | null;
  checkpoint_reason?: string | null;
  last_turn_id?: string | null;
  last_role?: string | null;
}

export interface GovernedContinuity {
  checkpoint?: ContinuityCheckpoint | null;
  recommended_command?: string | null;
  recommended_reason?: string | null;
  recommended_detail?: string | null;
  recovery_report_path?: string | null;
  drift_warnings?: string[] | null;
}

export interface WorkflowKitArtifact {
  path: string;
  exists: boolean;
  required: boolean;
  owned_by?: string | null;
}

export interface WorkflowKitArtifacts {
  phase?: string | null;
  artifacts?: WorkflowKitArtifact[] | null;
}

export interface GovernedStatusPayload {
  version?: string | number;
  protocol_mode?: string;
  template?: string;
  config?: AgentConfig | null;
  state?: GovernedState | null;
  continuity?: GovernedContinuity | null;
  workflow_kit_artifacts?: WorkflowKitArtifacts | null;
}

export interface GovernedStatusBarModel {
  text: string;
  tooltip: string;
  tone: 'default' | 'warning' | 'error';
}

export interface GovernedStepAction {
  cliArgs: string[];
  label: 'Dispatch Step' | 'Resume Step';
}

export async function loadGovernedStatus(root: string): Promise<GovernedStatusPayload> {
  const { stdout, stderr } = await execCliCommand(root, ['status', '--json']);
  return parseGovernedStatus(stdout, stderr);
}

export function parseGovernedStatus(stdout: string, stderr = ''): GovernedStatusPayload {
  let payload;
  try {
    payload = JSON.parse(stdout) as GovernedStatusPayload;
  } catch {
    throw new Error(`AgentXchain CLI returned unreadable JSON.${formatStderr(stderr)}`);
  }

  if (payload?.protocol_mode !== 'governed') {
    throw new Error('AgentXchain CLI status did not report governed mode.');
  }

  return payload;
}

export function renderGovernedStatusLines(payload: GovernedStatusPayload): string[] {
  const config = payload.config ?? null;
  const state = payload.state ?? null;
  const continuity = payload.continuity ?? null;
  const artifacts = payload.workflow_kit_artifacts?.artifacts ?? [];
  const projectName = getProjectName(config);
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
    lines.push(
      `Pending phase transition: ${(pending.from || 'unknown')} -> ${(pending.to || 'unknown')} (${pending.gate || 'unknown gate'})`
    );
  }

  if (state?.pending_run_completion) {
    lines.push(`Pending run completion: ${state.pending_run_completion.gate || 'awaiting approval'}`);
  }

  if (continuity?.checkpoint) {
    lines.push('');
    lines.push('Continuity:');
    lines.push(`  Session: ${continuity.checkpoint.session_id || 'unknown'}`);
    lines.push(
      `  Checkpoint: ${formatCheckpoint(continuity.checkpoint.checkpoint_reason, continuity.checkpoint.last_checkpoint_at)}`
    );
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

export function renderGovernedStatusHtml(payload: GovernedStatusPayload, notice: string): string {
  const config = payload.config ?? null;
  const state = payload.state ?? null;
  const continuity = payload.continuity ?? null;
  const artifacts = payload.workflow_kit_artifacts?.artifacts ?? [];
  const projectName = getProjectName(config);
  const blocked = formatBlockedState(state);
  const pendingTransition = state?.pending_phase_transition;
  const pendingCompletion = state?.pending_run_completion;
  const stepAction = getGovernedStepAction(payload);

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
    ? `<div class="section"><div class="label">Pending phase transition</div><div class="warning">${escapeHtml(
      `${pendingTransition.from || 'unknown'} \u2192 ${pendingTransition.to || 'unknown'} (${pendingTransition.gate || 'unknown gate'})`
    )}</div><div style="margin-top:8px;"><a class="btn btn-primary" href="command:agentxchain.approveTransition">Approve Transition</a></div></div>`
    : ''}
  ${pendingCompletion
    ? `<div class="section"><div class="label">Pending run completion</div><div class="warning">${escapeHtml(
      pendingCompletion.gate || 'awaiting approval'
    )}</div><div style="margin-top:8px;"><a class="btn btn-primary" href="command:agentxchain.approveCompletion">Approve Completion</a></div></div>`
    : ''}
  ${stepAction
    ? `<div class="section"><div class="label">${stepAction.label === 'Resume Step' ? 'Recovery action' : 'Next action'}</div><div style="margin-top:8px;"><a class="btn btn-secondary" href="command:agentxchain.step">${escapeHtml(stepAction.label)}</a></div></div>`
    : ''}
  ${state?.blocked || state?.status === 'blocked'
    ? `<div class="section"><div class="blocked">Blocked reason: ${escapeHtml(state?.blocked_reason || state?.blocked_on || 'unknown')}</div></div>`
    : ''}

  ${continuity?.checkpoint
    ? `<div class="section">
      <div class="label">Continuity</div>
      <div class="card">
        <div><strong>Session:</strong> ${escapeHtml(continuity.checkpoint.session_id || 'unknown')}</div>
        <div><strong>Checkpoint:</strong> ${escapeHtml(formatCheckpoint(
          continuity.checkpoint.checkpoint_reason,
          continuity.checkpoint.last_checkpoint_at
        ))}</div>
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
      <ul>${artifacts.map((artifact) => `<li>${escapeHtml(
        `${artifact.path} — ${artifact.exists ? 'present' : 'missing'}${artifact.required ? ', required' : ', optional'}${artifact.owned_by ? `, ${artifact.owned_by}` : ''}`
      )}</li>`).join('')}</ul>
    </div>`
    : ''}

  <div class="section">
    <div class="label">Boundary</div>
    <div class="note">${escapeHtml(notice)}</div>
  </div>
</body>
</html>`;
}

export function summarizeGovernedStatus(payload: GovernedStatusPayload): GovernedStatusBarModel {
  const config = payload.config ?? null;
  const state = payload.state ?? null;
  const projectName = getProjectName(config);
  const phase = state?.phase || 'unknown';
  const status = state?.status || 'idle';

  let tone: GovernedStatusBarModel['tone'] = 'default';
  if (state?.blocked || state?.status === 'blocked' || state?.escalation_active) {
    tone = 'error';
  } else if (state?.pending_phase_transition || state?.pending_run_completion) {
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

export function getGovernedStepAction(payload: GovernedStatusPayload): GovernedStepAction | null {
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

export function buildCliShellCommand(cliArgs: string[]): string {
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
export async function execCliCommand(root: string, cliArgs: string[], timeoutMs = 60_000): Promise<{ stdout: string; stderr: string }> {
  const cliPath = process.env.AGENTXCHAIN_CLI_PATH?.trim();
  const invocation = resolveCliInvocation(cliPath);

  try {
    return await execFileAsync(invocation.command, [...invocation.args, ...cliArgs], {
      cwd: root,
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024,
      env: { ...process.env, NO_COLOR: '1' },
    });
  } catch (error) {
    const message = formatCliFailure(error);
    throw new Error(message);
  }
}

function resolveCliInvocation(cliPath: string | undefined): { command: string; args: string[] } {
  if (!cliPath) {
    return { command: 'agentxchain', args: [] };
  }

  if (cliPath.endsWith('.js')) {
    return { command: process.execPath, args: [cliPath] };
  }

  return { command: cliPath, args: [] };
}

function parseRecommendedStepArgs(command: string | null | undefined): string[] | null {
  if (!command) {
    return null;
  }

  const tokens = command.trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 2 || tokens[0] !== 'agentxchain' || tokens[1] !== 'step') {
    return null;
  }

  return tokens.slice(1);
}

function formatCliFailure(error: unknown): string {
  const failure = error as NodeJS.ErrnoException & { stderr?: string; stdout?: string };
  if (failure.code === 'ENOENT') {
    return 'AgentXchain CLI not found on PATH. Install it with `npm install -g agentxchain`, or set AGENTXCHAIN_CLI_PATH for local testing.';
  }

  const stderr = typeof failure.stderr === 'string' ? failure.stderr.trim() : '';
  const stdout = typeof failure.stdout === 'string' ? failure.stdout.trim() : '';
  const detail = stderr || stdout || failure.message || 'unknown CLI failure';
  return `AgentXchain CLI status failed: ${detail}`;
}

function formatBlockedState(state: GovernedState | null): string {
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

function formatCheckpoint(reason?: string | null, timestamp?: string | null): string {
  if (reason && timestamp) {
    return `${reason} at ${timestamp}`;
  }
  return reason || timestamp || 'unknown';
}

function formatStderr(stderr: string): string {
  const trimmed = stderr.trim();
  return trimmed ? ` ${trimmed}` : '';
}

function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function quoteShellArg(value: string): string {
  if (/^[A-Za-z0-9_./:=+-]+$/.test(value)) {
    return value;
  }

  return JSON.stringify(value);
}
