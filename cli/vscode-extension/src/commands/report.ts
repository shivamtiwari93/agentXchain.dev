import * as vscode from 'vscode';
import { getProjectSurface } from '../util';
import { loadGovernedReport, renderReportLines } from '../governedStatus';

export async function showReport(root: string) {
  const surface = getProjectSurface(root);
  if (surface.mode !== 'governed') {
    vscode.window.showWarningMessage('Governance report is only available in governed mode.');
    return;
  }

  const channel = vscode.window.createOutputChannel('AgentXchain Report');
  channel.clear();
  channel.appendLine('AgentXchain Governance Report');
  channel.appendLine('─'.repeat(50));
  channel.appendLine('Loading report from CLI...');
  channel.show();

  let report;
  try {
    report = await loadGovernedReport(root);
  } catch (error) {
    channel.appendLine('');
    channel.appendLine(`Error: ${error instanceof Error ? error.message : 'Failed to load governance report.'}`);
    vscode.window.showErrorMessage(error instanceof Error ? error.message : 'Failed to load governance report.');
    return;
  }

  channel.clear();
  channel.appendLine('AgentXchain Governance Report');
  channel.appendLine('─'.repeat(50));

  for (const line of renderReportLines(report)) {
    channel.appendLine(line);
  }
  channel.show();
}
