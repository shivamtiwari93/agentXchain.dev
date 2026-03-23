import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import chalk from 'chalk';
import { loadConfig, loadLock, LOCK_FILE } from '../lib/config.js';
import { safeWriteJson } from '../lib/safe-write.js';
import { resolveExpectedClaimer } from '../lib/next-owner.js';
import { runConfiguredVerify } from '../lib/verify-command.js';

export async function claimCommand(opts) {
  const result = loadConfig();
  if (!result) { console.log(chalk.red('  No agentxchain.json found.')); process.exit(1); }

  const { root, config } = result;
  const lock = loadLock(root);
  if (!lock) { console.log(chalk.red('  lock.json not found.')); process.exit(1); }

  if (opts.agent) {
    return claimAsAgent({ opts, root, config, lock });
  }

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
  safeWriteJson(lockPath, newLock);
  const verify = loadLock(root);
  if (verify?.holder !== 'human') {
    console.log(chalk.red(`  Claim race: expected holder=human, got ${verify?.holder}. Another process won.`));
    process.exit(1);
  }
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

  if (opts.agent) {
    return releaseAsAgent({ opts, root, config, lock });
  }

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
  const verifyResult = runConfiguredVerify(config, root);
  if (!verifyResult.ok) {
    console.log(chalk.red(`  Verification failed: ${verifyResult.command}`));
    process.exit(1);
  }
  const lockPath = join(root, LOCK_FILE);
  const newLock = {
    holder: null,
    last_released_by: who,
    turn_number: who === 'human' ? lock.turn_number : lock.turn_number + 1,
    claimed_at: null
  };
  safeWriteJson(lockPath, newLock);
  const verify = loadLock(root);
  if (verify?.holder !== null || verify?.last_released_by !== who || verify?.turn_number !== newLock.turn_number) {
    console.log(chalk.red('  Release race: lock.json changed unexpectedly after release attempt.'));
    process.exit(1);
  }
  if (who === 'human') {
    clearBlockedState(root);
  }

  console.log('');
  console.log(chalk.green(`  ✓ Lock released by ${chalk.bold(who)} (turn ${newLock.turn_number})`));
  console.log(chalk.dim('  Next turn will be coordinated by the VS Code Stop hook or watch/supervise.'));
  console.log('');
}

function claimAsAgent({ opts, root, config, lock }) {
  const agentId = opts.agent;
  if (!config.agents?.[agentId]) {
    console.log(chalk.red(`  Agent "${agentId}" is not defined in agentxchain.json.`));
    process.exit(1);
  }

  if (lock.holder && !opts.force) {
    console.log(chalk.red(`  Lock is currently held by "${lock.holder}".`));
    console.log(chalk.dim('  Use --force only for recovery scenarios.'));
    process.exit(1);
  }

  const expected = pickNextAgent(root, lock, config);
  if (!opts.force && config.rules?.strict_next_owner && (expected === null || expected === undefined)) {
    console.log(chalk.red('  No next owner resolved. Add a valid `Next owner: <agent_id>` line to TALK.md, or set rules.strict_next_owner to false.'));
    process.exit(1);
  }
  if (!opts.force && expected && expected !== agentId) {
    console.log(chalk.red(`  Out-of-turn claim blocked. Expected: ${expected}, got: ${agentId}.`));
    process.exit(1);
  }

  const maxClaims = Number(config.rules?.max_consecutive_claims || 0);
  if (!opts.force && maxClaims > 0 && lock.last_released_by === agentId) {
    const consecutiveTurns = countRecentTurnsByAgent(root, config, agentId);
    if (consecutiveTurns >= maxClaims) {
      console.log(chalk.red(`  Consecutive-claim limit reached for "${agentId}" (${consecutiveTurns}/${maxClaims}).`));
      console.log(chalk.dim('  Hand off to another agent or use --force for recovery only.'));
      process.exit(1);
    }
  }

  const lockPath = join(root, LOCK_FILE);
  const next = {
    holder: agentId,
    last_released_by: lock.last_released_by,
    turn_number: lock.turn_number,
    claimed_at: new Date().toISOString()
  };
  safeWriteJson(lockPath, next);

  const verify = loadLock(root);
  if (verify?.holder !== agentId) {
    console.log(chalk.red(`  Claim race: expected holder=${agentId}, got ${verify?.holder}. Another process won.`));
    process.exit(1);
  }

  console.log(chalk.green(`  ✓ Lock claimed by ${agentId} (turn ${next.turn_number})`));
}

function releaseAsAgent({ opts, root, config, lock }) {
  const agentId = opts.agent;
  if (!config.agents?.[agentId]) {
    console.log(chalk.red(`  Agent "${agentId}" is not defined in agentxchain.json.`));
    process.exit(1);
  }
  if (lock.holder !== agentId && !opts.force) {
    console.log(chalk.red(`  Lock is held by "${lock.holder}", not "${agentId}".`));
    process.exit(1);
  }

  const verifyResult = runConfiguredVerify(config, root);
  if (!verifyResult.ok) {
    console.log(chalk.red(`  Verification failed: ${verifyResult.command}`));
    process.exit(1);
  }

  const lockPath = join(root, LOCK_FILE);
  const next = {
    holder: null,
    last_released_by: agentId,
    turn_number: lock.turn_number + 1,
    claimed_at: null
  };
  safeWriteJson(lockPath, next);
  const verifyRelease = loadLock(root);
  if (
    verifyRelease?.holder !== null ||
    verifyRelease?.last_released_by !== agentId ||
    verifyRelease?.turn_number !== next.turn_number
  ) {
    console.log(chalk.red('  Release race: lock.json changed unexpectedly after release attempt.'));
    process.exit(1);
  }
  console.log(chalk.green(`  ✓ Lock released by ${agentId} (turn ${next.turn_number})`));
}

function pickNextAgent(root, lock, config) {
  return resolveExpectedClaimer(root, config, lock).next;
}

function clearBlockedState(root) {
  const statePath = join(root, 'state.json');
  if (!existsSync(statePath)) return;
  try {
    const state = JSON.parse(readFileSync(statePath, 'utf8'));
    if (state.blocked || state.blocked_on) {
      const next = { ...state, blocked: false, blocked_on: null };
      safeWriteJson(statePath, next);
    }
  } catch {}
}

function countRecentTurnsByAgent(root, config, agentId) {
  const historyPath = join(root, config.history_file || 'history.jsonl');
  if (!existsSync(historyPath)) return 0;

  try {
    const lines = readFileSync(historyPath, 'utf8')
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean);

    let count = 0;
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      const entry = JSON.parse(lines[i]);
      if (entry?.agent !== agentId) break;
      count += 1;
    }
    return count;
  } catch {
    return 0;
  }
}
