/**
 * reissue-turn command — unified turn invalidation + reissue against current state.
 *
 * Covers all drift recovery scenarios:
 *   - Baseline drift (HEAD changed after dispatch)
 *   - Runtime drift (agentxchain.json rebinding after dispatch)
 *   - Authority drift (write_authority changed on assigned role)
 *   - Operator-initiated (explicit redo from current state)
 *
 * BUG-7 fix: single command, multiple trigger reasons.
 */

import chalk from 'chalk';
import { readFileSync } from 'fs';
import { join } from 'path';
import { loadProjectContext, loadProjectState } from '../lib/config.js';
import {
  getActiveTurns,
  getActiveTurn,
  reissueTurn,
} from '../lib/governed-state.js';
import { writeDispatchBundle } from '../lib/dispatch-bundle.js';

export async function reissueTurnCommand(opts) {
  const context = loadProjectContext();
  if (!context) {
    console.log(chalk.red('No agentxchain.json found. Run `agentxchain init` first.'));
    process.exit(1);
  }

  const { root, config } = context;

  if (config.protocol_mode !== 'governed') {
    console.log(chalk.red('The reissue-turn command is only available for governed projects.'));
    process.exit(1);
  }

  let state = loadProjectState(root, config);
  if (!state) {
    console.log(chalk.red('No governed state.json found.'));
    process.exit(1);
  }

  // Resolve target turn
  const activeTurns = getActiveTurns(state);
  const activeCount = Object.keys(activeTurns).length;

  if (activeCount === 0) {
    console.log(chalk.red('No active turns to reissue.'));
    process.exit(1);
  }

  let targetTurn;
  if (opts.turn) {
    targetTurn = activeTurns[opts.turn];
    if (!targetTurn) {
      console.log(chalk.red(`No active turn found for --turn ${opts.turn}`));
      process.exit(1);
    }
  } else if (activeCount === 1) {
    targetTurn = Object.values(activeTurns)[0];
  } else {
    console.log(chalk.red('Multiple active turns exist. Use --turn <id> to specify which to reissue.'));
    for (const turn of Object.values(activeTurns)) {
      console.log(`  ${chalk.yellow('●')} ${turn.turn_id} — ${chalk.bold(turn.assigned_role)} (${turn.status})`);
    }
    process.exit(1);
  }

  const reason = opts.reason || 'operator-initiated reissue';

  console.log(chalk.cyan(`Reissuing turn: ${targetTurn.turn_id} (${targetTurn.assigned_role})`));
  console.log(chalk.dim(`Reason: ${reason}`));

  const result = reissueTurn(root, config, {
    turnId: targetTurn.turn_id,
    reason,
  });

  if (!result.ok) {
    console.log(chalk.red(`Failed to reissue turn: ${result.error}`));
    process.exit(1);
  }

  // Write dispatch bundle for the reissued turn
  const bundleResult = writeDispatchBundle(root, result.state, config, {
    turnId: result.newTurn.turn_id,
  });

  if (!bundleResult.ok) {
    console.log(chalk.red(`Turn reissued but dispatch bundle failed: ${bundleResult.error}`));
    process.exit(1);
  }

  // Print summary
  console.log('');
  console.log(chalk.green('  Turn Reissued'));
  console.log(chalk.dim('  ' + '─'.repeat(44)));
  console.log('');
  console.log(`  ${chalk.dim('Old turn:')}     ${targetTurn.turn_id}`);
  console.log(`  ${chalk.dim('New turn:')}     ${result.newTurn.turn_id}`);
  console.log(`  ${chalk.dim('Role:')}         ${result.newTurn.assigned_role}`);
  console.log(`  ${chalk.dim('Attempt:')}      ${result.newTurn.attempt}`);
  console.log(`  ${chalk.dim('Reason:')}       ${reason}`);

  // Show baseline delta
  if (result.baselineDelta) {
    const delta = result.baselineDelta;
    if (delta.head_changed) {
      console.log(`  ${chalk.dim('HEAD:')}         ${chalk.yellow(delta.old_head?.slice(0, 12) || '?')} → ${chalk.green(delta.new_head?.slice(0, 12) || '?')}`);
    }
    if (delta.runtime_changed) {
      console.log(`  ${chalk.dim('Runtime:')}      ${chalk.yellow(delta.old_runtime || '?')} → ${chalk.green(delta.new_runtime || '?')}`);
    }
    if (delta.dirty_files_changed) {
      console.log(`  ${chalk.dim('Workspace:')}    ${delta.added_dirty_files?.length || 0} new dirty file(s), ${delta.removed_dirty_files?.length || 0} resolved`);
    }
  }

  console.log('');
  console.log(chalk.dim('Run: agentxchain step --resume to dispatch the reissued turn.'));
}
