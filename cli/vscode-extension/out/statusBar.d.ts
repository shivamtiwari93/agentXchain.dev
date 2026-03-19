import * as vscode from 'vscode';
export interface StatusBarController {
    refresh(): void;
    dispose(): void;
}
export declare function createStatusBar(context: vscode.ExtensionContext, root: string): StatusBarController;
