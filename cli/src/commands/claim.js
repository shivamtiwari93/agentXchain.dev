import { writeFileSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import chalk from 'chalk';
import { loadConfig, loadLock, LOCK_FILE } from '../lib/config.js';

export async function claimCommand(opts) {
  const result = loadConfig();
  if (!result) { console.log(chalk.red('  No agentxchain.json found.')); process.exit(1); }

  const { root, config } = result;
  const lock = loadLock(root);
  if (!lock) { console.log(chalk.red('  lock.json not found.')); process.exit(1); }

  if (lock.holder === 'human') {
    console.log('');
    console.log(chalk.yellow('  You already hold the lock.'));
    console.log(`  ${chalk.dim('Release with:')} ${chalk.bold('agentxchain release')}`);
    console.log('');
    return;
  }

  if (lock.holder && !opts.force) {
    const name = config.agents[lock.holder]?.name || lock.holder;
    console.log('');
    console.log(chalk.yellow(`  Lock held by ${chalk.bold(lock.holder)} (${name}).`));
    console.log(chalk.dim('  Use --force to override.'));
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
  clearBlockedState(root);

  console.log('');
  console.log(chalk.green(`  ✓ Lock claimed by ${chalk.bold('human')} (turn ${lock.turn_number})`));
  console.log(`  ${chalk.dim('Do your work, then:')} ${chalk.bold('agentxchain release')}`);
  console.log('');
}

export async function releaseCommand(opts) {
  const result = loadConfig();
  if (!result) { console.log(chalk.red('  No agentxchain.json found.')); process.exit(1); }

  const { root, config } = result;
  const lock = loadLock(root);
  if (!lock) { console.log(chalk.red('  lock.json not found.')); process.exit(1); }

  if (!lock.holder) {
    console.log(chalk.yellow('  Lock is already free.'));
    return;
  }

  if (lock.holder !== 'human' && !opts.force) {
    const name = config.agents[lock.holder]?.name || lock.holder;
    console.log('');
    console.log(chalk.red(`  Lock is held by ${chalk.bold(lock.holder)} (${name}), not human.`));
    console.log(chalk.dim('  Use `agentxchain release --force` to break this lock.'));
    console.log('');
    process.exit(1);
  }

  const who = lock.holder;
  const lockPath = join(root, LOCK_FILE);
  const newLock = {
    holder: null,
    last_released_by: who,
    turn_number: who === 'human' ? lock.turn_number : lock.turn_number + 1,
    claimed_at: null
  };
  writeFileSync(lockPath, JSON.stringify(newLock, null, 2) + '\n');
  if (who === 'human') {
    clearBlockedState(root);
  }

  console.log('');
  console.log(chalk.green(`  ✓ Lock released by ${chalk.bold(who)} (turn ${newLock.turn_number})`));
  console.log(chalk.dim('  The Stop hook will coordinate the next agent turn in VS Code.'));
  console.log('');
}

function clearBlockedState(root) {
  const statePath = join(root, 'state.json');
  if (!existsSync(statePath)) return;
  try {
    const state = JSON.parse(readFileSync(statePath, 'utf8'));
    if (state.blocked || state.blocked_on) {
      const next = { ...state, blocked: false, blocked_on: null };
      writeFileSync(statePath, JSON.stringify(next, null, 2) + '\n');
    }
  } catch {}
}
