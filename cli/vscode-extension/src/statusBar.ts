import * as vscode from 'vscode';
import { readJson, lockPath, statePath, configPath, LockState, ProjectState, AgentConfig } from './util';

export interface StatusBarController {
  refresh(): void;
  dispose(): void;
}

export function createStatusBar(context: vscode.ExtensionContext, root: string): StatusBarController {
  const item = vscode.window.createStatusBarItem('agentxchain.status', vscode.StatusBarAlignment.Left, 50);
  item.command = 'agentxchain.status';
  item.tooltip = 'AgentXchain — click for status';
  context.subscriptions.push(item);

  function refresh() {
    const lock = readJson<LockState>(lockPath(root));
    const state = readJson<ProjectState>(statePath(root));
    const config = readJson<AgentConfig>(configPath(root));

    if (!lock || !config) {
      item.text = '$(warning) AXC: no project';
      item.show();
      return;
    }

    const turn = lock.turn_number;

    if (lock.holder === 'human') {
      item.text = `$(person) AXC: HUMAN Turn ${turn}`;
      item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    } else if (lock.holder) {
      const name = config.agents[lock.holder]?.name || lock.holder;
      item.text = `$(sync~spin) AXC: ${lock.holder} Turn ${turn}`;
      item.backgroundColor = undefined;
    } else {
      item.text = `$(check) AXC: FREE Turn ${turn}`;
      item.backgroundColor = undefined;
    }

    if (state?.phase) {
      item.text += ` | ${state.phase}`;
    }

    item.show();
  }

  refresh();

  return {
    refresh,
    dispose: () => item.dispose()
  };
}
