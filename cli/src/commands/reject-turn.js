import chalk from 'chalk';
import { existsSync } from 'fs';
import { join } from 'path';
import { loadProjectContext, loadProjectState } from '../lib/config.js';
import { getActiveTurns, rejectGovernedTurn, transitionActiveTurnLifecycle } from '../lib/governed-state.js';
import { validateStagedTurnResult } from '../lib/turn-result-validator.js';
import { writeDispatchBundle } from '../lib/dispatch-bundle.js';
import { deriveRecoveryDescriptor } from '../lib/blocked-state.js';
import { getDispatchTurnDir, getTurnStagingResultPath } from '../lib/turn-paths.js';

export async function rejectTurnCommand(opts) {
  const context = loadProjectContext();
  if (!context) {
    console.log(chalk.red('No agentxchain.json found. Run `agentxchain init` first.'));
    process.exit(1);
  }

  const { root, config } = context;

  if (config.protocol_mode !== 'governed') {
    console.log(chalk.red('The reject-turn command is only available for governed projects.'));
    console.log(chalk.dim('Legacy projects use: agentxchain claim / release'));
    process.exit(1);
  }

  const state = loadProjectState(root, config);
  if (!state) {
    console.log(chalk.red('No governed state.json found. Run `agentxchain init --governed` first.'));
    process.exit(1);
  }

  const validation = buildRejectionValidation(root, state, config, opts);
  if (!validation.ok) {
    console.log(chalk.red(validation.error));
    process.exit(1);
  }

  const result = rejectGovernedTurn(root, config, validation.validationResult, {
    turnId: validation.turn.turn_id,
    reason: opts.reason,
    reassign: Boolean(opts.reassign),
  });
  if (!result.ok) {
    console.log(chalk.red(`Failed to reject turn: ${result.error}`));
    process.exit(1);
  }

  if (!result.escalated) {
    const bundleResult = writeDispatchBundle(root, result.state, config, { turnId: validation.turn.turn_id });
    if (!bundleResult.ok) {
      console.log(chalk.red(`Turn rejected but dispatch bundle rewrite failed: ${bundleResult.error}`));
      process.exit(1);
    }
    transitionActiveTurnLifecycle(root, validation.turn.turn_id, 'dispatched');
    printDispatchBundleWarnings(bundleResult);
  }

  const turn = result.turn || result.state?.active_turns?.[validation.turn.turn_id] || result.state?.current_turn;

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
  if (validation.validationResult.errors?.length && !opts.reassign) {
    console.log(`  ${chalk.dim('Reason:')}       ${validation.validationResult.errors[0]}`);
  }
  if (opts.reason) {
    console.log(`  ${chalk.dim('Operator note:')} ${opts.reason}`);
  }
  console.log('');

  if (result.escalated) {
    const recovery = deriveRecoveryDescriptor(result.state, config);
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
    console.log(`  ${chalk.dim('Dispatch:')}     ${getDispatchTurnDir(turn?.turn_id || validation.turn.turn_id)}/`);
    if (opts.reassign) {
      console.log(chalk.dim('  The turn was rejected for conflict and immediately re-dispatched with conflict context.'));
    } else {
      console.log(chalk.dim('  The retry bundle has been rewritten for the same assigned turn.'));
    }
  }
  console.log('');
}

function buildRejectionValidation(root, state, config, opts) {
  const resolution = resolveTargetTurn(state, opts.turn);
  if (!resolution.ok) {
    return resolution;
  }

  // BUG-9 fix: --reassign should work for any rejected turn, not just conflicted ones.
  // For drift-induced failures with no conflict_state, redirect to reissue-turn.
  if (opts.reassign && !resolution.turn.conflict_state) {
    // Detect if baseline drift exists
    const currentHead = (() => {
      try {
        return require('child_process').execSync('git rev-parse HEAD', {
          cwd: root, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
        }).trim();
      } catch { return null; }
    })();
    const turnHead = resolution.turn.baseline?.head_ref;
    const hasDrift = currentHead && turnHead && currentHead !== turnHead;

    if (hasDrift) {
      console.log(chalk.yellow(`Baseline drift detected: HEAD moved from ${turnHead?.slice(0, 12)} to ${currentHead?.slice(0, 12)}.`));
      console.log(chalk.dim(`Use: agentxchain reissue-turn --turn ${resolution.turn.turn_id} --reason "baseline drift"`));
      return {
        ok: false,
        error: `--reassign detected baseline drift. Use reissue-turn instead for a clean reissue from current HEAD.`,
      };
    }

    // No drift, no conflict_state — just do a normal reject + reassign
    // (treat it as a fresh retry with refreshed baseline, which BUG-8 now handles)
  }

  if (resolution.turn.conflict_state) {
    return {
      ok: true,
      turn: resolution.turn,
      validationResult: {
        errors: resolution.turn.conflict_state.conflict_error?.conflicting_files?.length
          ? [`File conflict detected: ${resolution.turn.conflict_state.conflict_error.conflicting_files.join(', ')}`]
          : ['File conflict detected'],
        failed_stage: 'conflict',
      },
    };
  }

  const projectedState = {
    ...state,
    active_turns: {
      [resolution.turn.turn_id]: resolution.turn,
    },
  };
  const stagingPath = resolveStagingPath(root, resolution.turn.turn_id);
  // BUG-22: If resolveStagingPath returns null, a stale result from another turn
  // was detected. Reject with a clear diagnostic instead of consuming it.
  if (stagingPath === null) {
    return {
      ok: true,
      turn: resolution.turn,
      validationResult: {
        errors: [`Stale staging data: .agentxchain/staging/turn-result.json belongs to a different turn. Clean up with: rm .agentxchain/staging/turn-result.json`],
        failed_stage: 'stale_staging',
      },
    };
  }
  const validation = validateStagedTurnResult(root, projectedState, config, {
    stagingPath,
  });
  if (!validation.ok) {
    return {
      ok: true,
      turn: resolution.turn,
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
    turn: resolution.turn,
    validationResult: {
      errors: [opts.reason.trim()],
      failed_stage: 'human_review',
    },
  };
}

function resolveTargetTurn(state, turnId) {
  const activeTurns = getActiveTurns(state);

  if (turnId) {
    const turn = activeTurns[turnId];
    if (!turn) {
      return {
        ok: false,
        error: `No active turn found for --turn ${turnId}`,
      };
    }
    return { ok: true, turn };
  }

  const turns = Object.values(activeTurns);
  if (turns.length === 0) {
    return { ok: false, error: 'No active turn to reject' };
  }
  if (turns.length > 1) {
    return {
      ok: false,
      error: 'Multiple active turns are present. Re-run reject-turn with --turn <turn_id>.',
    };
  }

  return { ok: true, turn: turns[0] };
}

function resolveStagingPath(root, turnId) {
  // BUG-22: Prefer turn-scoped staging path. Only fall back to legacy global
  // staging if the global result's turn_id matches the active turn.
  const turnScopedPath = getTurnStagingResultPath(turnId);
  if (existsSync(join(root, turnScopedPath))) {
    return turnScopedPath;
  }

  const legacyPath = '.agentxchain/staging/turn-result.json';
  const legacyAbs = join(root, legacyPath);
  if (existsSync(legacyAbs)) {
    try {
      const raw = JSON.parse(require('fs').readFileSync(legacyAbs, 'utf8'));
      if (raw.turn_id && raw.turn_id !== turnId) {
        // Stale result from a different turn — do not consume
        return null;
      }
    } catch {
      // Parse error — let the validator handle it
    }
    return legacyPath;
  }

  return legacyPath; // File doesn't exist — validator will report "not found"
}

function printDispatchBundleWarnings(bundleResult) {
  for (const warning of bundleResult.warnings || []) {
    console.log(chalk.yellow(`Dispatch bundle warning: ${warning}`));
  }
}
