import chalk from 'chalk';
import { loadProjectContext } from '../lib/config.js';
import { checkpointAcceptedTurn } from '../lib/turn-checkpoint.js';

export async function checkpointTurnCommand(opts = {}) {
  const context = loadProjectContext();
  if (!context) {
    console.log(chalk.red('No agentxchain.json found. Run `agentxchain init` first.'));
    process.exit(1);
  }

  const { root, config } = context;
  if (config.protocol_mode !== 'governed') {
    console.log(chalk.red('The checkpoint-turn command is only available for governed projects.'));
    process.exit(1);
  }

  const result = checkpointAcceptedTurn(root, { turnId: opts.turn });
  if (!result.ok) {
    console.log(chalk.red(result.error || 'Failed to checkpoint accepted turn.'));
    process.exit(1);
  }

  if (result.already_checkpointed) {
    console.log(chalk.yellow(`Turn ${result.turn.turn_id} already has checkpoint ${result.checkpoint_sha}.`));
    return;
  }

  if (result.skipped) {
    console.log(chalk.dim(result.reason));
    return;
  }

  console.log(chalk.green(`Checkpointed ${result.turn.turn_id} at ${result.checkpoint_sha}.`));
}
