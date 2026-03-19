import * as vscode from 'vscode';
import { readJson, configPath, AgentConfig } from '../util';
import { exec } from 'child_process';

export function runGenerate(root: string) {
  const config = readJson<AgentConfig>(configPath(root));
  if (!config) {
    vscode.window.showErrorMessage('No agentxchain.json found.');
    return;
  }

  const terminal = vscode.window.createTerminal({ name: 'AgentXchain', cwd: root });
  terminal.show();
  terminal.sendText('npx agentxchain generate');
}
