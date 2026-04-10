import * as vscode from 'vscode';

export function runInit() {
  const terminal = vscode.window.createTerminal({ name: 'AgentXchain Init' });
  terminal.show();
  terminal.sendText('npx --yes -p agentxchain@latest -c "agentxchain init"');
}
