import * as vscode from 'vscode';
import { getProjectSurface } from '../util';
import { buildCliShellCommand, getGovernedStepAction, loadGovernedStatus } from '../governedStatus';

export async function runGovernedStep(root: string) {
  const surface = getProjectSurface(root);
  if (surface.mode !== 'governed') {
    vscode.window.showWarningMessage('Governed step dispatch is only available in governed mode.');
    return;
  }

  let payload;
  try {
    payload = await loadGovernedStatus(root);
  } catch (error) {
    vscode.window.showErrorMessage(error instanceof Error ? error.message : 'Failed to load governed status.');
    return;
  }

  const stepAction = getGovernedStepAction(payload);
  if (!stepAction) {
    if (payload.state?.pending_phase_transition || payload.state?.pending_run_completion) {
      vscode.window.showInformationMessage(
        'Approve the pending governed gate before dispatching another step.'
      );
      return;
    }

    const recommended = payload.continuity?.recommended_command;
    if (recommended) {
      vscode.window.showWarningMessage(
        `The current governed recovery action is "${recommended}". Use the CLI or dashboard if you need a non-step recovery flow.`
      );
      return;
    }

    vscode.window.showInformationMessage('No governed step is currently available for this run.');
    return;
  }

  const terminal = vscode.window.createTerminal({
    name: stepAction.label === 'Resume Step' ? 'AgentXchain Resume' : 'AgentXchain Step',
    cwd: root,
    env: { NO_COLOR: '1' },
  });
  terminal.show();
  terminal.sendText(buildCliShellCommand(stepAction.cliArgs), true);

  vscode.window.showInformationMessage(
    `${stepAction.label} launched in the integrated terminal.`
  );
}
