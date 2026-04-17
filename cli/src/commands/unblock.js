import chalk from 'chalk';
import { loadProjectContext, loadProjectState } from '../lib/config.js';
import { findCurrentHumanEscalation, getOpenHumanEscalation } from '../lib/human-escalations.js';
import { resumeCommand } from './resume.js';

export async function unblockCommand(escalationId) {
  const context = loadProjectContext();
  if (!context) {
    console.log(chalk.red('No agentxchain.json found. Run `agentxchain init` first.'));
    process.exit(1);
  }

  const { root, config } = context;

  if (config.protocol_mode !== 'governed') {
    console.log(chalk.red('The unblock command is only available for governed projects.'));
    process.exit(1);
  }

  if (!escalationId || !String(escalationId).trim()) {
    console.log(chalk.red('An escalation id is required. Example: agentxchain unblock hesc_1234'));
    process.exit(1);
  }

  const state = loadProjectState(root, config);
  if (!state) {
    console.log(chalk.red('No governed state.json found. Run `agentxchain init --governed` first.'));
    process.exit(1);
  }

  if (state.status !== 'blocked') {
    console.log(chalk.red(`Cannot unblock run: status is "${state.status}", expected "blocked".`));
    process.exit(1);
  }

  const requested = getOpenHumanEscalation(root, escalationId);
  if (!requested) {
    console.log(chalk.red(`No open human escalation found for ${escalationId}.`));
    process.exit(1);
  }

  const current = findCurrentHumanEscalation(root, state);
  if (!current) {
    console.log(chalk.red('The current blocked run does not have a linked human escalation record.'));
    process.exit(1);
  }

  if (current.escalation_id !== requested.escalation_id) {
    console.log(chalk.red(`Escalation ${escalationId} is not the current blocker for this run.`));
    console.log(chalk.dim(`Current blocker: ${current.escalation_id}`));
    process.exit(1);
  }

  console.log('');
  console.log(chalk.green(`  Unblocking ${requested.escalation_id}`));
  console.log(chalk.dim(`  Type: ${requested.type}${requested.service ? ` (${requested.service})` : ''}`));
  if (requested.detail) {
    console.log(chalk.dim(`  Detail: ${requested.detail}`));
  }
  console.log(chalk.dim('  Continuing governed execution...'));
  console.log('');

  await resumeCommand({
    _via: 'operator_unblock',
    turn: requested.turn_id || undefined,
  });
}
