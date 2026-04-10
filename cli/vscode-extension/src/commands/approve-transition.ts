import * as vscode from 'vscode';
import { getProjectSurface } from '../util';
import { execCliCommand, loadGovernedStatus } from '../governedStatus';

export async function approvePhaseTransition(root: string) {
  const surface = getProjectSurface(root);
  if (surface.mode !== 'governed') {
    vscode.window.showWarningMessage('Phase transition approval is only available in governed mode.');
    return;
  }

  // Check current status for pending transition before prompting
  let payload;
  try {
    payload = await loadGovernedStatus(root);
  } catch (error) {
    vscode.window.showErrorMessage(error instanceof Error ? error.message : 'Failed to load governed status.');
    return;
  }

  const pending = payload.state?.pending_phase_transition;
  if (!pending) {
    vscode.window.showInformationMessage('No pending phase transition to approve.');
    return;
  }

  const from = pending.from || 'unknown';
  const to = pending.to || 'unknown';
  const gate = pending.gate || 'unknown gate';

  const confirm = await vscode.window.showWarningMessage(
    `Approve phase transition: ${from} \u2192 ${to} (gate: ${gate})?`,
    { modal: true },
    'Approve'
  );

  if (confirm !== 'Approve') {
    return;
  }

  try {
    const { stdout } = await execCliCommand(root, ['approve-transition'], 120_000);
    vscode.window.showInformationMessage(`Phase transition approved: ${from} \u2192 ${to}`);

    const channel = vscode.window.createOutputChannel('AgentXchain');
    channel.clear();
    channel.appendLine('Phase Transition Approved');
    channel.appendLine('\u2500'.repeat(40));
    channel.appendLine(stdout.trim());
    channel.show(true);
  } catch (error) {
    vscode.window.showErrorMessage(error instanceof Error ? error.message : 'Phase transition approval failed.');
  }
}
