import * as vscode from 'vscode';
import { claimLock } from './claim';
import { releaseLock } from './release';
import { showStatus } from './status';
import { runGenerate } from './generate';
import { runInit } from './init';
import { approvePhaseTransition } from './approve-transition';
import { approveRunCompletion } from './approve-completion';

export function registerCommands(context: vscode.ExtensionContext, root: string) {
  context.subscriptions.push(
    vscode.commands.registerCommand('agentxchain.init', () => runInit()),
    vscode.commands.registerCommand('agentxchain.generate', () => runGenerate(root)),
    vscode.commands.registerCommand('agentxchain.claim', () => claimLock(root)),
    vscode.commands.registerCommand('agentxchain.release', () => releaseLock(root)),
    vscode.commands.registerCommand('agentxchain.status', () => showStatus(root)),
    vscode.commands.registerCommand('agentxchain.approveTransition', () => approvePhaseTransition(root)),
    vscode.commands.registerCommand('agentxchain.approveCompletion', () => approveRunCompletion(root))
  );
}
