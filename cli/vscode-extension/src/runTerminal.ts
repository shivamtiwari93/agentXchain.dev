import * as vscode from 'vscode';
import { buildCliShellCommand, GovernedRunAction } from './governedStatus';

const GOVERNED_RUN_TERMINAL_NAMES = new Set(['AgentXchain Run', 'AgentXchain Resume']);

export function hasActiveGovernedRunTerminal(): boolean {
  return findActiveGovernedRunTerminal() !== null;
}

export function launchGovernedRunTerminal(root: string, action: GovernedRunAction): 'launched' | 'reused' {
  const existing = findActiveGovernedRunTerminal();
  if (existing) {
    existing.show();
    return 'reused';
  }

  const terminal = vscode.window.createTerminal({
    name: action.label === 'Start Run' ? 'AgentXchain Run' : 'AgentXchain Resume',
    cwd: root,
    env: { NO_COLOR: '1' },
  });
  terminal.show();
  terminal.sendText(buildCliShellCommand(action.cliArgs), true);
  return 'launched';
}

function findActiveGovernedRunTerminal(): vscode.Terminal | null {
  for (const terminal of vscode.window.terminals) {
    if (GOVERNED_RUN_TERMINAL_NAMES.has(terminal.name) && terminal.exitStatus == null) {
      return terminal;
    }
  }

  return null;
}
