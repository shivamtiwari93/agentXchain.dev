import * as vscode from 'vscode';
import { StatusBarController } from './statusBar';
type ChangeCallback = () => void;
export interface WatcherController {
    onStateChange(cb: ChangeCallback): void;
    dispose(): void;
}
export declare function createFileWatchers(context: vscode.ExtensionContext, root: string, statusBar: StatusBarController): WatcherController;
export {};
