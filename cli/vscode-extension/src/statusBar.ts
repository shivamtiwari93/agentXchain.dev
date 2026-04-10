import * as vscode from 'vscode';
import { GOVERNED_MODE_NOTICE, getBlockedDetail, getProjectName, getProjectSurface } from './util';
import { loadGovernedStatus, summarizeGovernedStatus } from './governedStatus';

export interface StatusBarController {
  refresh(): void;
  dispose(): void;
}

export function createStatusBar(context: vscode.ExtensionContext, root: string): StatusBarController {
  const item = vscode.window.createStatusBarItem('agentxchain.status', vscode.StatusBarAlignment.Left, 50);
  item.command = 'agentxchain.status';
  item.tooltip = 'AgentXchain — click for status';
  context.subscriptions.push(item);

  async function refreshAsync() {
    const surface = getProjectSurface(root);
    const { config, state, lock, mode } = surface;

    if (!config) {
      item.text = '$(warning) AXC: no project';
      item.tooltip = 'No AgentXchain project detected in this workspace.';
      item.show();
      return;
    }

    if (mode === 'governed') {
      try {
        const payload = await loadGovernedStatus(root);
        const model = summarizeGovernedStatus(payload);
        item.text = model.text;
        item.tooltip = model.tooltip;
        item.backgroundColor = mapToneToBackground(model.tone);
      } catch (error) {
        const fallbackBlocked = getBlockedDetail(state);
        const message = error instanceof Error ? error.message : 'Unable to load governed status.';
        const phase = state?.phase || 'unknown';
        const status = state?.status || 'idle';
        item.text = `$(warning) AXC: governed | ${phase} | ${status}`;
        item.tooltip = `${getProjectName(config)}\n${message}\n${GOVERNED_MODE_NOTICE}`;
        item.backgroundColor = fallbackBlocked
          ? new vscode.ThemeColor('statusBarItem.errorBackground')
          : new vscode.ThemeColor('statusBarItem.warningBackground');
      }
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

  function refresh() {
    void refreshAsync();
  }

  refresh();

  return {
    refresh,
    dispose: () => item.dispose()
  };
}

function mapToneToBackground(tone: 'default' | 'warning' | 'error') {
  if (tone === 'warning') {
    return new vscode.ThemeColor('statusBarItem.warningBackground');
  }
  if (tone === 'error') {
    return new vscode.ThemeColor('statusBarItem.errorBackground');
  }
  return undefined;
}
