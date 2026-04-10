import * as vscode from 'vscode';
import { getProjectSurface } from '../util';
import { getGovernedRunAction, loadGovernedStatus } from '../governedStatus';
import { launchGovernedRunTerminal } from '../runTerminal';

export async function runGovernedRun(root: string) {
  const surface = getProjectSurface(root);
  if (surface.mode !== 'governed') {
    vscode.window.showWarningMessage('Governed run launch is only available in governed mode.');
    return;
  }

  let payload;
  try {
    payload = await loadGovernedStatus(root);
  } catch (error) {
    vscode.window.showErrorMessage(error instanceof Error ? error.message : 'Failed to load governed status.');
    return;
  }

  const runAction = getGovernedRunAction(payload);
  if (!runAction) {
    if (payload.state?.pending_phase_transition || payload.state?.pending_run_completion) {
      vscode.window.showInformationMessage(
        'Approve the pending governed gate before starting or resuming the run loop.'
      );
      return;
    }

    if (payload.state?.blocked || payload.state?.status === 'blocked') {
      const recommended = payload.continuity?.recommended_command;
      const detail = recommended ? ` Use ${recommended} or the browser dashboard recovery flow first.` : '';
      vscode.window.showWarningMessage(`The governed run is blocked.${detail}`);
      return;
    }

    if (payload.state?.status === 'completed' || payload.state?.status === 'failed') {
      vscode.window.showInformationMessage(
        `No governed run loop is available while the run status is "${payload.state.status}".`
      );
      return;
    }

    vscode.window.showInformationMessage('No governed run loop is currently available for this project.');
    return;
  }

  const result = launchGovernedRunTerminal(root, runAction);
  if (result === 'reused') {
    vscode.window.showInformationMessage('Governed run terminal is already active. Focused the existing terminal.');
    return;
  }

  vscode.window.showInformationMessage(
    `${runAction.label} launched in the integrated terminal. Turn-completion notifications are suppressed while that terminal stays active.`
  );
}
