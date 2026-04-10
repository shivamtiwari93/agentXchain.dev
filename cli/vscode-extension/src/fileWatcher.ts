import * as vscode from 'vscode';
import { StatusBarController } from './statusBar';

type ChangeCallback = () => void;

export interface WatcherController {
  onStateChange(cb: ChangeCallback): void;
  dispose(): void;
}

export function createFileWatchers(
  context: vscode.ExtensionContext,
  root: string,
  statusBar: StatusBarController
): WatcherController {
  const callbacks: ChangeCallback[] = [];

  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    return { onStateChange: () => {}, dispose: () => {} };
  }

  const lockWatcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(folder, 'lock.json')
  );

  const stateWatcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(folder, 'state.json')
  );

  const governedStateWatcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(folder, '.agentxchain/state.json')
  );

  const governedSessionWatcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(folder, '.agentxchain/session.json')
  );

  const governedStagingWatcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(folder, '.agentxchain/staging/**')
  );

  const configWatcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(folder, 'agentxchain.json')
  );

  let debounceTimer: NodeJS.Timeout | undefined;

  function handleChange() {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
      statusBar.refresh();
      callbacks.forEach(cb => cb());
    }, 500);
  }

  lockWatcher.onDidChange(handleChange);
  lockWatcher.onDidCreate(handleChange);
  stateWatcher.onDidChange(handleChange);
  stateWatcher.onDidCreate(handleChange);
  governedStateWatcher.onDidChange(handleChange);
  governedStateWatcher.onDidCreate(handleChange);
  governedSessionWatcher.onDidChange(handleChange);
  governedSessionWatcher.onDidCreate(handleChange);
  governedStagingWatcher.onDidChange(handleChange);
  governedStagingWatcher.onDidCreate(handleChange);
  configWatcher.onDidChange(handleChange);

  context.subscriptions.push(
    lockWatcher,
    stateWatcher,
    governedStateWatcher,
    governedSessionWatcher,
    governedStagingWatcher,
    configWatcher
  );

  return {
    onStateChange(cb: ChangeCallback) {
      callbacks.push(cb);
    },
    dispose() {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
      lockWatcher.dispose();
      stateWatcher.dispose();
      governedStateWatcher.dispose();
      governedSessionWatcher.dispose();
      governedStagingWatcher.dispose();
      configWatcher.dispose();
    }
  };
}
