import * as vscode from 'vscode';
import { buildCliShellCommand } from './governedStatus';

const GOVERNED_DASHBOARD_TERMINAL_NAME = 'AgentXchain Dashboard';

export function launchGovernedDashboardTerminal(root: string): 'launched' | 'reused' {
  const existing = findActiveGovernedDashboardTerminal();
  if (existing) {
    existing.show();
    return 'reused';
  }

  const terminal = vscode.window.createTerminal({
    name: GOVERNED_DASHBOARD_TERMINAL_NAME,
    cwd: root,
    env: { NO_COLOR: '1' },
  });
  terminal.show();
  terminal.sendText(buildCliShellCommand(['dashboard']), true);
  return 'launched';
}

function findActiveGovernedDashboardTerminal(): vscode.Terminal | null {
  for (const terminal of vscode.window.terminals) {
    if (terminal.name === GOVERNED_DASHBOARD_TERMINAL_NAME && terminal.exitStatus == null) {
      return terminal;
    }
  }

  return null;
}
