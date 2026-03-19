import * as vscode from 'vscode';
import { readJson, lockPath, statePath, configPath, LockState, ProjectState, AgentConfig } from '../util';

export function showStatus(root: string) {
  const lock = readJson<LockState>(lockPath(root));
  const state = readJson<ProjectState>(statePath(root));
  const config = readJson<AgentConfig>(configPath(root));

  if (!lock || !config) {
    vscode.window.showErrorMessage('AgentXchain project files not found.');
    return;
  }

  const agentIds = Object.keys(config.agents);
  const holderDisplay = lock.holder
    ? lock.holder === 'human'
      ? 'HUMAN (you)'
      : `${lock.holder} (${config.agents[lock.holder]?.name || lock.holder})`
    : 'FREE';

  const lines = [
    `Project: ${config.project}`,
    `Phase: ${state?.phase || 'unknown'}`,
    `Lock: ${holderDisplay}`,
    `Turn: ${lock.turn_number}`,
    `Last released by: ${lock.last_released_by || 'none'}`,
    `Blocked: ${state?.blocked ? `YES — ${state.blocked_on}` : 'No'}`,
    '',
    `Agents (${agentIds.length}):`,
    ...agentIds.map(id => {
      const marker = lock.holder === id ? '● ' : '○ ';
      return `  ${marker}${id} — ${config.agents[id].name}`;
    })
  ];

  const channel = vscode.window.createOutputChannel('AgentXchain');
  channel.clear();
  channel.appendLine('AgentXchain Status');
  channel.appendLine('─'.repeat(40));
  lines.forEach(l => channel.appendLine(l));
  channel.show();
}
