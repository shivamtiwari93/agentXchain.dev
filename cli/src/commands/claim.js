import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import chalk from 'chalk';
import { loadConfig, loadLock, LOCK_FILE } from '../lib/config.js';

export async function claimCommand(opts) {
  const result = loadConfig();
  if (!result) {
    console.log(chalk.red('  No agentxchain.json found.'));
    process.exit(1);
  }

  const { root, config } = result;
  const lock = loadLock(root);

  if (!lock) {
    console.log(chalk.red('  lock.json not found.'));
    process.exit(1);
  }

  if (lock.holder && lock.holder !== 'human') {
    const name = config.agents[lock.holder]?.name || lock.holder;
    console.log('');
    console.log(chalk.yellow(`  Lock is held by ${chalk.bold(lock.holder)} (${name}).`));
    console.log(chalk.dim('  Wait for them to release, or force with: agentxchain claim --force'));

    if (!opts.force) {
      console.log('');
      return;
    }

    console.log(chalk.yellow('  Force-claiming...'));
  }

  if (lock.holder === 'human') {
    console.log('');
    console.log(chalk.yellow('  You already hold the lock.'));
    console.log(`  ${chalk.dim('Release with:')} ${chalk.bold('agentxchain release')}`);
    console.log('');
    return;
  }

  const lockPath = join(root, LOCK_FILE);
  const newLock = {
    holder: 'human',
    last_released_by: lock.last_released_by,
    turn_number: lock.turn_number,
    claimed_at: new Date().toISOString()
  };
  writeFileSync(lockPath, JSON.stringify(newLock, null, 2) + '\n');

  console.log('');
  console.log(chalk.green(`  ✓ Lock claimed by ${chalk.bold('human')} (turn ${lock.turn_number})`));
  console.log(`  ${chalk.dim('Do your work, then release:')} ${chalk.bold('agentxchain release')}`);
  console.log('');
}

export async function releaseCommand() {
  const result = loadConfig();
  if (!result) {
    console.log(chalk.red('  No agentxchain.json found.'));
    process.exit(1);
  }

  const { root } = result;
  const lock = loadLock(root);

  if (!lock) {
    console.log(chalk.red('  lock.json not found.'));
    process.exit(1);
  }

  if (!lock.holder) {
    console.log(chalk.yellow('  Lock is already free.'));
    return;
  }

  const lockPath = join(root, LOCK_FILE);
  const who = lock.holder;
  const newLock = {
    holder: null,
    last_released_by: who,
    turn_number: who === 'human' ? lock.turn_number : lock.turn_number + 1,
    claimed_at: null
  };
  writeFileSync(lockPath, JSON.stringify(newLock, null, 2) + '\n');

  console.log('');
  console.log(chalk.green(`  ✓ Lock released by ${chalk.bold(who)} (turn ${newLock.turn_number})`));
  console.log(chalk.dim('  The watch process will wake the next agent.'));
  console.log('');
}
