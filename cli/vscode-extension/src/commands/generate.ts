import * as vscode from 'vscode';
import { getProjectSurface, GOVERNED_MODE_NOTICE } from '../util';

export function runGenerate(root: string) {
  const surface = getProjectSurface(root);
  if (!surface.config) {
    vscode.window.showErrorMessage('No agentxchain.json found.');
    return;
  }
  if (surface.mode === 'governed') {
    vscode.window.showWarningMessage(
      `${GOVERNED_MODE_NOTICE} The Generate command only scaffolds legacy IDE agent files.`
    );
    return;
  }

  const terminal = vscode.window.createTerminal({ name: 'AgentXchain', cwd: root });
  terminal.show();
  terminal.sendText('npx --yes -p agentxchain@latest -c "agentxchain generate"');
}
