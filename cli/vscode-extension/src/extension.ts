import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { registerCommands } from './commands/index';
import { createStatusBar } from './statusBar';
import { createFileWatchers } from './fileWatcher';
import { DashboardViewProvider } from './sidebar';
import { GovernedNotificationService } from './notifications';

export function activate(context: vscode.ExtensionContext) {
  const root = findProjectRoot();
  if (!root) {
    return;
  }

  registerCommands(context, root);

  const statusBar = createStatusBar(context, root);
  const watchers = createFileWatchers(context, root, statusBar);

  const dashboardProvider = new DashboardViewProvider(context.extensionUri, root);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('agentxchain.dashboard', dashboardProvider)
  );

  const notificationService = new GovernedNotificationService(root);
  context.subscriptions.push({ dispose: () => notificationService.dispose() });

  // Seed notification baseline from current state (no notifications on activation)
  void notificationService.check();

  watchers.onStateChange(() => {
    dashboardProvider.refresh();
    void notificationService.check();
  });

  statusBar.refresh();
}

export function deactivate() {}

function findProjectRoot(): string | null {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) return null;

  for (const folder of folders) {
    const cfgPath = path.join(folder.uri.fsPath, 'agentxchain.json');
    if (fs.existsSync(cfgPath)) {
      return folder.uri.fsPath;
    }
  }

  return folders[0].uri.fsPath;
}
