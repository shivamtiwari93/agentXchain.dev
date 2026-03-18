import { writeFileSync } from 'fs';
import { join } from 'path';
import chalk from 'chalk';
import { loadConfig, loadLock, LOCK_FILE } from '../lib/config.js';
import { stopAgent, sendFollowup, loadSession } from '../adapters/cursor.js';

export async function claimCommand(opts) {
  const result = loadConfig();
  if (!result) { console.log(chalk.red('  No agentxchain.json found.')); process.exit(1); }

  const { root, config } = result;
  const lock = loadLock(root);
  if (!lock) { console.log(chalk.red('  lock.json not found.')); process.exit(1); }

  const apiKey = process.env.CURSOR_API_KEY;
  const session = loadSession(root);
  const hasCursor = session?.ide === 'cursor' && apiKey;

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

  // Pause all Cursor agents when human claims
  if (hasCursor && session.launched.length > 0) {
    console.log(chalk.dim('  Pausing Cursor agents...'));
    for (const agent of session.launched) {
      try {
        await stopAgent(apiKey, agent.cloudId);
        console.log(chalk.dim(`    Paused ${agent.id}`));
      } catch {
        console.log(chalk.dim(`    Could not pause ${agent.id}`));
      }
    }
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
  if (hasCursor) console.log(chalk.dim('    All Cursor agents paused.'));
  console.log(`  ${chalk.dim('Do your work, then:')} ${chalk.bold('agentxchain release')}`);
  console.log('');
}

export async function releaseCommand() {
  const result = loadConfig();
  if (!result) { console.log(chalk.red('  No agentxchain.json found.')); process.exit(1); }

  const { root, config } = result;
  const lock = loadLock(root);
  if (!lock) { console.log(chalk.red('  lock.json not found.')); process.exit(1); }

  if (!lock.holder) {
    console.log(chalk.yellow('  Lock is already free.'));
    return;
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

  console.log('');
  console.log(chalk.green(`  ✓ Lock released by ${chalk.bold(who)} (turn ${newLock.turn_number})`));

  // If releasing from human and Cursor session exists, wake the next agent
  if (who === 'human') {
    const apiKey = process.env.CURSOR_API_KEY;
    const session = loadSession(root);

    if (session?.ide === 'cursor' && apiKey) {
      const agentIds = Object.keys(config.agents);
      const next = agentIds[0];
      const cloudAgent = session.launched.find(a => a.id === next);

      if (cloudAgent) {
        try {
          const name = config.agents[next]?.name || next;
          await sendFollowup(apiKey, cloudAgent.cloudId,
            `Human released the lock. It's your turn. Read lock.json, claim it, and do your work as ${name}.`
          );
          console.log(chalk.cyan(`  Woke ${chalk.bold(next)} via Cursor followup.`));
        } catch (err) {
          console.log(chalk.dim(`  Could not wake ${next}: ${err.message}`));
        }
      }
      console.log(chalk.dim('  The watch process will coordinate from here.'));
    }
  }

  console.log('');
}
