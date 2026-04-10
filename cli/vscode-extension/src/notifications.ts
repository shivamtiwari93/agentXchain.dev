import * as vscode from 'vscode';
import { GovernedStatusPayload, loadGovernedStatus } from './governedStatus';
import { detectProjectMode } from './util';
import { GovernedSnapshot, snapshotFromPayload, diffRequiresNotification } from './notificationState';
import { hasActiveGovernedRunTerminal } from './runTerminal';

export class GovernedNotificationService {
  private previous: GovernedSnapshot | null = null;
  private root: string;
  private disposed = false;

  constructor(root: string) {
    this.root = root;
  }

  async check(): Promise<void> {
    if (this.disposed) return;

    const mode = detectProjectMode(this.root);
    if (mode !== 'governed') {
      this.previous = null;
      return;
    }

    let payload: GovernedStatusPayload;
    try {
      payload = await loadGovernedStatus(this.root);
    } catch {
      return;
    }

    const current = snapshotFromPayload(payload);
    const prev = this.previous;
    this.previous = current;

    if (!prev) return;

    const diff = diffRequiresNotification(prev, current);

    if (diff.pendingTransition) {
      const transition = payload.state?.pending_phase_transition;
      const from = transition?.from || 'unknown';
      const to = transition?.to || 'unknown';
      const gate = transition?.gate || 'unknown gate';
      const choice = await vscode.window.showWarningMessage(
        `Phase transition pending: ${from} \u2192 ${to} (gate: ${gate})`,
        'Approve'
      );
      if (choice === 'Approve') {
        await vscode.commands.executeCommand('agentxchain.approveTransition');
      }
    }

    if (diff.pendingCompletion) {
      const gate = payload.state?.pending_run_completion?.gate || 'awaiting approval';
      const choice = await vscode.window.showWarningMessage(
        `Run completion pending (gate: ${gate})`,
        'Approve'
      );
      if (choice === 'Approve') {
        await vscode.commands.executeCommand('agentxchain.approveCompletion');
      }
    }

    if (diff.blocked) {
      const reason = current.blockedReason || 'unknown reason';
      vscode.window.showErrorMessage(`Governed run blocked: ${reason}`);
    }

    if (diff.turnCompleted && !hasActiveGovernedRunTerminal()) {
      const phase = payload.state?.phase || 'unknown';
      vscode.window.showInformationMessage(
        `Turn ${current.turnSequence} completed (phase: ${phase})`
      );
    }
  }

  dispose(): void {
    this.disposed = true;
    this.previous = null;
  }
}
