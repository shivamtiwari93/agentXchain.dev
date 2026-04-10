import * as vscode from 'vscode';
import { getProjectSurface } from '../util';
import { execCliCommand, loadGovernedStatus } from '../governedStatus';

export async function approveRunCompletion(root: string) {
  const surface = getProjectSurface(root);
  if (surface.mode !== 'governed') {
    vscode.window.showWarningMessage('Run completion approval is only available in governed mode.');
    return;
  }

  // Check current status for pending completion before prompting
  let payload;
  try {
    payload = await loadGovernedStatus(root);
  } catch (error) {
    vscode.window.showErrorMessage(error instanceof Error ? error.message : 'Failed to load governed status.');
    return;
  }

  const pending = payload.state?.pending_run_completion;
  if (!pending) {
    vscode.window.showInformationMessage('No pending run completion to approve.');
    return;
  }

  const gate = pending.gate || 'unknown gate';
  const phase = payload.state?.phase || 'unknown';

  const confirm = await vscode.window.showWarningMessage(
    `Approve run completion? Phase: ${phase}, gate: ${gate}`,
    { modal: true },
    'Approve'
  );

  if (confirm !== 'Approve') {
    return;
  }

  try {
    const { stdout } = await execCliCommand(root, ['approve-completion'], 120_000);
    vscode.window.showInformationMessage('Run completion approved.');

    const channel = vscode.window.createOutputChannel('AgentXchain');
    channel.clear();
    channel.appendLine('Run Completion Approved');
    channel.appendLine('\u2500'.repeat(40));
    channel.appendLine(stdout.trim());
    channel.show(true);
  } catch (error) {
    vscode.window.showErrorMessage(error instanceof Error ? error.message : 'Run completion approval failed.');
  }
}
