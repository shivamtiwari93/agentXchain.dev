import * as vscode from 'vscode';
import { GOVERNED_MODE_NOTICE, getBlockedDetail, getProjectName, getProjectSurface } from './util';

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
    const surface = getProjectSurface(root);
    const { config, state, lock, mode } = surface;

    if (!config) {
      item.text = '$(warning) AXC: no project';
      item.tooltip = 'No AgentXchain project detected in this workspace.';
      item.show();
      return;
    }

    if (mode === 'governed') {
      const phase = state?.phase || 'unknown';
      const status = state?.status || 'idle';
      const blocked = getBlockedDetail(state);

      item.text = `$(shield) AXC: governed | ${phase} | ${status}`;
      item.tooltip = `${getProjectName(config)}\n${GOVERNED_MODE_NOTICE}`;
      item.backgroundColor = blocked ? new vscode.ThemeColor('statusBarItem.warningBackground') : undefined;
      item.show();
      return;
    }

    if (!lock) {
      item.text = '$(warning) AXC: legacy lock missing';
      item.tooltip = 'Legacy AgentXchain project detected, but lock.json is missing.';
      item.show();
      return;
    }

    if (lock.holder === 'human') {
      item.text = `$(person) AXC: HUMAN Turn ${lock.turn_number}`;
      item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
    } else if (lock.holder) {
      item.text = `$(sync~spin) AXC: ${lock.holder} Turn ${lock.turn_number}`;
      item.backgroundColor = undefined;
    } else {
      item.text = `$(check) AXC: FREE Turn ${lock.turn_number}`;
      item.backgroundColor = undefined;
    }

    if (state?.phase) {
      item.text += ` | ${state.phase}`;
    }

    item.tooltip = `${getProjectName(config)}\nLegacy lock-based coordination mode`;
    item.show();
  }

  refresh();

  return {
    refresh,
    dispose: () => item.dispose()
  };
}
