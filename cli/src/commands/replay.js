import chalk from 'chalk';

import { loadProjectContext } from '../lib/config.js';
import { normalizeVerification } from '../lib/repo-observer.js';
import { resolveAcceptedTurnHistoryReference } from '../lib/accepted-turn-history.js';
import {
  DEFAULT_VERIFICATION_REPLAY_TIMEOUT_MS,
  replayVerificationMachineEvidence,
} from '../lib/verification-replay.js';

export async function replayTurnCommand(turnId, opts = {}) {
  const context = loadProjectContext();
  if (!context) {
    console.log(chalk.red('No agentxchain.json found. Run `agentxchain init` first.'));
    process.exit(2);
  }

  if (context.config.protocol_mode !== 'governed' || context.version !== 4) {
    console.log(chalk.red('replay turn is only available in governed v4 projects.'));
    process.exit(2);
  }

  const timeoutMs = Number.parseInt(String(opts.timeout || String(DEFAULT_VERIFICATION_REPLAY_TIMEOUT_MS)), 10);
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    console.log(chalk.red('replay turn requires a positive integer --timeout in milliseconds.'));
    process.exit(2);
  }

  const { root, config } = context;
  const resolved = resolveAcceptedTurnHistoryReference(root, turnId);
  if (!resolved.ok) {
    console.log(chalk.red(resolved.error));
    process.exit(2);
  }

  const entry = resolved.entry;
  const runtimeType = config.runtimes?.[entry.runtime_id]?.type || 'unknown';
  const payload = {
    source: 'history',
    match_kind: resolved.match_kind,
    turn_id: entry.turn_id,
    resolved_turn_id: resolved.resolved_ref,
    run_id: entry.run_id || null,
    role: entry.role || null,
    phase: entry.phase || null,
    runtime_id: entry.runtime_id || null,
    runtime_type: runtimeType,
    accepted_at: entry.accepted_at || null,
    declared_status: entry.verification?.status || 'skipped',
    normalized_status: normalizeVerification(entry.verification, runtimeType).status,
    timeout_ms: timeoutMs,
    prior_verification_replay: entry.verification_replay || null,
    ...replayVerificationMachineEvidence({
      root,
      verification: entry.verification,
      timeoutMs,
    }),
  };

  emitReplayTurn(payload, opts.json);
  process.exit(payload.overall === 'match' ? 0 : 1);
}

function emitReplayTurn(payload, jsonMode) {
  if (jsonMode) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log('');
  console.log(chalk.bold(`  Replay Turn: ${chalk.cyan(payload.turn_id)}`));
  console.log(chalk.dim('  ' + '─'.repeat(44)));
  console.log(`  ${chalk.dim('Source:')}     accepted history (${payload.match_kind})`);
  console.log(`  ${chalk.dim('Run:')}        ${payload.run_id || '—'}`);
  console.log(`  ${chalk.dim('Role:')}       ${payload.role || '—'}`);
  console.log(`  ${chalk.dim('Phase:')}      ${payload.phase || '—'}`);
  console.log(`  ${chalk.dim('Runtime:')}    ${payload.runtime_id || '—'} (${payload.runtime_type})`);
  console.log(`  ${chalk.dim('Accepted:')}   ${payload.accepted_at || '—'}`);
  console.log(`  ${chalk.dim('Declared:')}   ${payload.declared_status}`);
  console.log(`  ${chalk.dim('Normalized:')} ${payload.normalized_status}`);
  if (payload.prior_verification_replay) {
    const prior = payload.prior_verification_replay;
    const verifiedAt = prior.verified_at ? ` at ${prior.verified_at}` : '';
    console.log(`  ${chalk.dim('Prior replay:')} ${prior.overall} (${prior.matched_commands || 0}/${prior.replayed_commands || 0})${verifiedAt}`);
  }
  console.log(`  ${chalk.dim('Outcome:')}    ${formatOutcome(payload.overall)}`);

  if (payload.reason) {
    console.log(`  ${chalk.dim('Reason:')}     ${payload.reason}`);
    console.log('');
    return;
  }

  console.log('');
  for (const command of payload.commands || []) {
    const marker = command.matched ? chalk.green('match') : chalk.red('mismatch');
    console.log(`  [${marker}] ${command.command}`);
    console.log(`    declared=${command.declared_exit_code} actual=${command.actual_exit_code == null ? 'null' : command.actual_exit_code}`);
    if (command.signal) {
      console.log(`    signal=${command.signal}`);
    }
    if (command.timed_out) {
      console.log('    timed_out=true');
    }
    if (command.error) {
      console.log(`    error=${command.error}`);
    }
  }

  console.log('');
  console.log(chalk.dim('  Replay uses the current workspace and shell environment. It verifies declared exit-code reproducibility, not historical stdout/stderr identity.'));
  console.log('');
}

function formatOutcome(outcome) {
  if (outcome === 'match') return chalk.green('match');
  if (outcome === 'mismatch') return chalk.red('mismatch');
  return chalk.yellow('not_reproducible');
}

