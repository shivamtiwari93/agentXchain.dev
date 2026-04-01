import chalk from 'chalk';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { loadProjectContext } from '../lib/config.js';
import { rejectGovernedTurn, STATE_PATH } from '../lib/governed-state.js';
import { validateStagedTurnResult } from '../lib/turn-result-validator.js';
import { writeDispatchBundle } from '../lib/dispatch-bundle.js';
import { deriveRecoveryDescriptor } from '../lib/blocked-state.js';

export async function rejectTurnCommand(opts) {
  const context = loadProjectContext();
  if (!context) {
    console.log(chalk.red('No agentxchain.json found. Run `agentxchain init` first.'));
    process.exit(1);
  }

  const { root, config } = context;

  if (config.protocol_mode !== 'governed') {
    console.log(chalk.red('The reject-turn command is only available for governed (v4) projects.'));
    console.log(chalk.dim('Legacy projects use: agentxchain claim / release'));
    process.exit(1);
  }

  const state = readGovernedState(root);
  if (!state) {
    console.log(chalk.red('No governed state.json found. Run `agentxchain init --governed` first.'));
    process.exit(1);
  }

  const validation = buildRejectionValidation(root, state, config, opts);
  if (!validation.ok) {
    console.log(chalk.red(validation.error));
    process.exit(1);
  }

  const result = rejectGovernedTurn(root, config, validation.validationResult, opts.reason);
  if (!result.ok) {
    console.log(chalk.red(`Failed to reject turn: ${result.error}`));
    process.exit(1);
  }

  if (!result.escalated) {
    const bundleResult = writeDispatchBundle(root, result.state, config);
    if (!bundleResult.ok) {
      console.log(chalk.red(`Turn rejected but dispatch bundle rewrite failed: ${bundleResult.error}`));
      process.exit(1);
    }
    printDispatchBundleWarnings(bundleResult);
  }

  const turn = result.state?.current_turn;

  console.log('');
  if (result.escalated) {
    console.log(chalk.yellow('  Turn Rejected And Escalated'));
  } else {
    console.log(chalk.yellow('  Turn Rejected For Retry'));
  }
  console.log(chalk.dim('  ' + '─'.repeat(44)));
  console.log('');
  console.log(`  ${chalk.dim('Turn:')}         ${turn?.turn_id || '(unknown)'}`);
  console.log(`  ${chalk.dim('Role:')}         ${turn?.assigned_role || '(unknown)'}`);
  console.log(`  ${chalk.dim('Failed stage:')} ${validation.validationResult.failed_stage || 'unknown'}`);
  if (validation.validationResult.errors?.length) {
    console.log(`  ${chalk.dim('Reason:')}       ${validation.validationResult.errors[0]}`);
  }
  if (opts.reason) {
    console.log(`  ${chalk.dim('Operator note:')} ${opts.reason}`);
  }
  console.log('');

  if (result.escalated) {
    const recovery = deriveRecoveryDescriptor(result.state);
    if (recovery) {
      console.log(`  ${chalk.dim('Reason:')}       ${recovery.typed_reason}`);
      console.log(`  ${chalk.dim('Owner:')}        ${recovery.owner}`);
      console.log(`  ${chalk.dim('Action:')}       ${recovery.recovery_action}`);
      console.log(`  ${chalk.dim('Turn:')}         ${recovery.turn_retained ? 'retained' : 'cleared'}`);
      if (recovery.detail) {
        console.log(`  ${chalk.dim('Detail:')}       ${recovery.detail}`);
      }
    } else {
      console.log(`  ${chalk.dim('Blocked on:')}   ${result.state.blocked_on}`);
      console.log(chalk.dim('  Resolve the escalation, then run agentxchain step to re-dispatch the failed turn.'));
    }
  } else {
    console.log(`  ${chalk.dim('Attempt:')}      ${turn?.attempt || '(unknown)'}`);
    console.log(`  ${chalk.dim('Dispatch:')}     .agentxchain/dispatch/current/`);
    console.log(chalk.dim('  The retry bundle has been rewritten for the same assigned turn.'));
  }
  console.log('');
}

function readGovernedState(root) {
  const statePath = join(root, STATE_PATH);
  if (!existsSync(statePath)) return null;

  try {
    return JSON.parse(readFileSync(statePath, 'utf8'));
  } catch {
    return null;
  }
}

function buildRejectionValidation(root, state, config, opts) {
  const validation = validateStagedTurnResult(root, state, config);
  if (!validation.ok) {
    return {
      ok: true,
      validationResult: {
        errors: validation.errors,
        failed_stage: validation.stage || 'unknown',
      },
    };
  }

  if (!opts.reason || !opts.reason.trim()) {
    return {
      ok: false,
      error: 'Staged turn result validates successfully. Supply --reason to reject it anyway.',
    };
  }

  return {
    ok: true,
    validationResult: {
      errors: [opts.reason.trim()],
      failed_stage: 'human_review',
    },
  };
}

function printDispatchBundleWarnings(bundleResult) {
  for (const warning of bundleResult.warnings || []) {
    console.log(chalk.yellow(`Dispatch bundle warning: ${warning}`));
  }
}
