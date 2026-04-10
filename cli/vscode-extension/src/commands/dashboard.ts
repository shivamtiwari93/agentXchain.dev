import * as vscode from 'vscode';
import { getProjectSurface } from '../util';
import { launchGovernedDashboardTerminal } from '../dashboardTerminal';

export async function openGovernedDashboard(root: string) {
  const surface = getProjectSurface(root);
  if (surface.mode !== 'governed') {
    vscode.window.showWarningMessage('Dashboard launch is only available in governed mode.');
    return;
  }

  const result = launchGovernedDashboardTerminal(root);
  if (result === 'reused') {
    vscode.window.showInformationMessage(
      'Governed dashboard terminal is already active. Focused the existing terminal.'
    );
    return;
  }

  vscode.window.showInformationMessage(
    'Governed dashboard launched in the integrated terminal. The CLI will open the browser dashboard when the bridge is ready.'
  );
}
