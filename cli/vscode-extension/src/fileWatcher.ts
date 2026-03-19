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

  const configWatcher = vscode.workspace.createFileSystemWatcher(
    new vscode.RelativePattern(folder, 'agentxchain.json')
  );

  function handleChange() {
    statusBar.refresh();
    callbacks.forEach(cb => cb());
  }

  lockWatcher.onDidChange(handleChange);
  lockWatcher.onDidCreate(handleChange);
  stateWatcher.onDidChange(handleChange);
  stateWatcher.onDidCreate(handleChange);
  configWatcher.onDidChange(handleChange);

  context.subscriptions.push(lockWatcher, stateWatcher, configWatcher);

  return {
    onStateChange(cb: ChangeCallback) {
      callbacks.push(cb);
    },
    dispose() {
      lockWatcher.dispose();
      stateWatcher.dispose();
      configWatcher.dispose();
    }
  };
}
