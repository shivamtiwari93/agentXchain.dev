import * as vscode from 'vscode';
export declare class DashboardViewProvider implements vscode.WebviewViewProvider {
    private view?;
    private root;
    private extensionUri;
    constructor(extensionUri: vscode.Uri, root: string);
    resolveWebviewView(webviewView: vscode.WebviewView): void;
    refresh(): void;
    private updateContent;
    private getHtml;
    private getGovernedHtml;
    private getLegacyHtml;
}
