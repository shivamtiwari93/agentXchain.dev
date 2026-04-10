import * as vscode from 'vscode';
import {
  getBlockedDetail,
  getProjectActors,
  getProjectName,
  getProjectSurface,
  GOVERNED_MODE_NOTICE,
} from '../util';

export function showStatus(root: string) {
  const surface = getProjectSurface(root);
  const { config, lock, state, mode } = surface;

  if (!config) {
    vscode.window.showErrorMessage('AgentXchain project files not found.');
    return;
  }

  const actors = getProjectActors(config);
  const channel = vscode.window.createOutputChannel('AgentXchain');
  channel.clear();
  channel.appendLine('AgentXchain Status');
  channel.appendLine('─'.repeat(40));

  if (mode === 'governed') {
    const blocked = getBlockedDetail(state);
    const lines = [
      `Project: ${getProjectName(config)}`,
      'Mode: Governed',
      `Run status: ${state?.status || 'idle'}`,
      `Phase: ${state?.phase || 'unknown'}`,
      `Blocked: ${blocked ? `YES — ${blocked}` : 'No'}`,
      '',
      GOVERNED_MODE_NOTICE,
      '',
      `Roles (${actors.length}):`,
      ...actors.map(actor => `  ○ ${actor.id} — ${actor.name}`),
    ];
    lines.forEach(l => channel.appendLine(l));
    channel.show();
    return;
  }

  if (!lock) {
    vscode.window.showErrorMessage('Legacy AgentXchain lock.json not found.');
    return;
  }

  const holderDisplay = lock.holder
    ? lock.holder === 'human'
      ? 'HUMAN (you)'
      : `${lock.holder} (${actors.find(actor => actor.id === lock.holder)?.name || lock.holder})`
    : 'FREE';

  const lines = [
    `Project: ${getProjectName(config)}`,
    'Mode: Legacy lock-based coordination',
    `Phase: ${state?.phase || 'unknown'}`,
    `Lock: ${holderDisplay}`,
    `Turn: ${lock.turn_number}`,
    `Last released by: ${lock.last_released_by || 'none'}`,
    `Blocked: ${state?.blocked ? `YES — ${state.blocked_on}` : 'No'}`,
    '',
    `Agents (${actors.length}):`,
    ...actors.map(actor => {
      const marker = lock.holder === actor.id ? '● ' : '○ ';
      return `  ${marker}${actor.id} — ${actor.name}`;
    })
  ];

  lines.forEach(l => channel.appendLine(l));
  channel.show();
}
