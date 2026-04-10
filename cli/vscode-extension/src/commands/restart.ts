import * as vscode from 'vscode';
import { getProjectSurface } from '../util';
import { execCliCommand, loadGovernedStatus, parseRecommendedRestartArgs } from '../governedStatus';

export async function restartGovernedRun(root: string) {
  const surface = getProjectSurface(root);
  if (surface.mode !== 'governed') {
    vscode.window.showWarningMessage('Governed restart is only available in governed mode.');
    return;
  }

  let recommendedDetail = 'This will reconnect or reactivate the governed run from durable checkpoint state.';
  let cliArgs = ['restart'];

  try {
    const payload = await loadGovernedStatus(root);
    const recommendedArgs = parseRecommendedRestartArgs(payload.continuity?.recommended_command);
    if (recommendedArgs) {
      cliArgs = recommendedArgs;
    }
    if (payload.continuity?.recommended_detail) {
      recommendedDetail = payload.continuity.recommended_detail;
    }
  } catch {
    // Restart remains available even when status loading fails.
  }

  const confirm = await vscode.window.showWarningMessage(
    `Restart the governed session? ${recommendedDetail}`,
    { modal: true },
    'Restart'
  );

  if (confirm !== 'Restart') {
    return;
  }

  try {
    const { stdout } = await execCliCommand(root, cliArgs, 120_000);
    const channel = vscode.window.createOutputChannel('AgentXchain Restart');
    channel.clear();
    channel.appendLine('Governed Restart');
    channel.appendLine('─'.repeat(40));
    channel.appendLine(stdout.trim());
    channel.show(true);

    vscode.window.showInformationMessage('Governed restart completed. Review the recovery output for the next action.');
  } catch (error) {
    vscode.window.showErrorMessage(error instanceof Error ? error.message : 'Governed restart failed.');
  }
}
