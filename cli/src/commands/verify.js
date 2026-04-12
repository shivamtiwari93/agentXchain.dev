import chalk from 'chalk';
import { loadProjectContext, loadProjectState } from '../lib/config.js';
import { getActiveTurns } from '../lib/governed-state.js';
import { normalizeVerification } from '../lib/repo-observer.js';
import { validateStagedTurnResult } from '../lib/turn-result-validator.js';
import { getTurnStagingResultPath } from '../lib/turn-paths.js';
import { resolve } from 'node:path';
import { loadExportArtifact, verifyExportArtifact } from '../lib/export-verifier.js';
import { verifyProtocolConformance } from '../lib/protocol-conformance.js';
import {
  DEFAULT_VERIFICATION_REPLAY_TIMEOUT_MS,
  replayVerificationMachineEvidence,
} from '../lib/verification-replay.js';

export async function verifyProtocolCommand(opts, command) {
  const requestedTier = Number.parseInt(String(opts.tier || '1'), 10);
  const timeout = Number.parseInt(String(opts.timeout || '30000'), 10);
  const format = opts.format || 'text';
  const targetSource = command?.getOptionValueSource?.('target');
  const timeoutSource = command?.getOptionValueSource?.('timeout');
  const hasExplicitTarget = targetSource && targetSource !== 'default';
  const remote = opts.remote || null;

  if (remote && hasExplicitTarget) {
    emitProtocolVerifyError(format, 'Cannot specify both --target and --remote');
    process.exit(2);
  }

  if (!remote && opts.token) {
    emitProtocolVerifyError(format, 'Cannot specify --token without --remote');
    process.exit(2);
  }

  if (!remote && timeoutSource && timeoutSource !== 'default') {
    emitProtocolVerifyError(format, 'Cannot specify --timeout without --remote');
    process.exit(2);
  }

  let result;
  try {
    result = await verifyProtocolConformance({
      targetRoot: remote ? null : resolve(opts.target || process.cwd()),
      remote,
      token: opts.token || null,
      timeout,
      requestedTier,
      surface: opts.surface || null,
    });
  } catch (error) {
    emitProtocolVerifyError(format, error.message);
    process.exit(2);
  }

  if (format === 'json') {
    console.log(JSON.stringify(result.report, null, 2));
  } else {
    printProtocolReport(result.report);
  }

  process.exit(result.exitCode);
}

function emitProtocolVerifyError(format, message) {
  if (format === 'json') {
    console.log(JSON.stringify({
      overall: 'error',
      message,
    }, null, 2));
    return;
  }

  console.log(chalk.red(`Protocol verification failed: ${message}`));
}

export async function verifyExportCommand(opts) {
  const format = opts.format || 'text';
  const loaded = loadExportArtifact(opts.input || '-', process.cwd());

  if (!loaded.ok) {
    if (format === 'json') {
      console.log(JSON.stringify({
        overall: 'error',
        input: loaded.input,
        message: loaded.error,
      }, null, 2));
    } else {
      console.log(chalk.red(`Export verification failed: ${loaded.error}`));
    }
    process.exit(2);
  }

  const result = verifyExportArtifact(loaded.artifact);
  const report = {
    ...result.report,
    input: loaded.input,
  };

  if (format === 'json') {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printExportReport(report);
  }

  process.exit(result.ok ? 0 : 1);
}

export async function verifyTurnCommand(turnId, opts = {}) {
  const context = loadProjectContext();
  if (!context) {
    console.log(chalk.red('No agentxchain.json found. Run `agentxchain init` first.'));
    process.exit(2);
  }

  if (context.config.protocol_mode !== 'governed' || context.version !== 4) {
    console.log(chalk.red('verify turn is only available in governed v4 projects.'));
    process.exit(2);
  }

  const timeoutMs = Number.parseInt(String(opts.timeout || String(DEFAULT_VERIFICATION_REPLAY_TIMEOUT_MS)), 10);
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    console.log(chalk.red('verify turn requires a positive integer --timeout in milliseconds.'));
    process.exit(2);
  }

  const { root, config } = context;
  const state = loadProjectState(root, config);
  const activeTurns = getActiveTurns(state);
  const selectedTurnId = resolveTargetTurnId(turnId, activeTurns);
  const selectedTurn = activeTurns[selectedTurnId];
  const stagingPath = getTurnStagingResultPath(selectedTurnId);
  const validationState = {
    ...state,
    active_turns: {
      [selectedTurnId]: selectedTurn,
    },
  };
  const validation = validateStagedTurnResult(root, validationState, config, { stagingPath });

  if (!validation.ok) {
    emitTurnValidationFailure(validation, opts.json);
    process.exit(1);
  }

  const turnResult = validation.turnResult;
  const runtimeType = config.runtimes?.[selectedTurn.runtime_id]?.type || 'manual';
  const declaredStatus = turnResult.verification?.status || 'skipped';
  const normalizedStatus = normalizeVerification(turnResult.verification, runtimeType).status;
  const payload = {
    turn_id: selectedTurnId,
    role: selectedTurn.assigned_role,
    runtime_id: selectedTurn.runtime_id,
    runtime_type: runtimeType,
    staging_path: stagingPath,
    declared_status: declaredStatus,
    normalized_status: normalizedStatus,
    validation: {
      ok: true,
      warnings: validation.warnings || [],
    },
    timeout_ms: timeoutMs,
    ...replayVerificationMachineEvidence({
      root,
      verification: turnResult.verification,
      timeoutMs,
    }),
  };

  emitTurnVerification(payload, opts.json);
  process.exit(payload.overall === 'match' ? 0 : 1);
}

function printProtocolReport(report) {
  console.log('');
  console.log(chalk.bold('  AgentXchain Protocol Conformance'));
  console.log(chalk.dim('  ' + '─'.repeat(44)));
  const targetLabel = report.remote || report.target_root;
  console.log(chalk.dim(`  Target: ${targetLabel}`));
  console.log(chalk.dim(`  Implementation: ${report.implementation}`));
  console.log(chalk.dim(`  Tier requested: ${report.tier_requested}`));
  console.log('');

  const overallLabel = report.overall === 'pass'
    ? chalk.green('PASS')
    : report.overall === 'fail'
      ? chalk.red('FAIL')
      : chalk.red('ERROR');
  console.log(`  Overall: ${overallLabel}`);

  for (const [tierKey, tier] of Object.entries(report.results)) {
    const label = tier.status === 'pass'
      ? chalk.green('pass')
      : tier.status === 'skipped'
        ? chalk.yellow('skipped')
        : chalk.red(tier.status);
    const niCount = tier.fixtures_not_implemented || 0;
    const niSuffix = niCount > 0 ? chalk.yellow(`, ${niCount} not implemented`) : '';
    console.log(`  ${tierKey}: ${label} (${tier.fixtures_passed}/${tier.fixtures_run} passed${niSuffix})`);

    for (const ni of tier.not_implemented || []) {
      console.log(chalk.yellow(`    ○ ${ni.fixture_id}: ${ni.message}`));
    }
    for (const failure of tier.failures || []) {
      console.log(chalk.red(`    ✗ ${failure.fixture_id}: ${failure.message}`));
    }
    for (const error of tier.errors || []) {
      console.log(chalk.red(`    ✗ ${error.fixture_id}: ${error.message}`));
    }
  }

  console.log('');
}

function printExportReport(report) {
  console.log('');
  console.log(chalk.bold('  AgentXchain Export Verification'));
  console.log(chalk.dim('  ' + '─'.repeat(43)));
  console.log(chalk.dim(`  Input: ${report.input}`));
  console.log(chalk.dim(`  Export kind: ${report.export_kind || 'unknown'}`));
  console.log(chalk.dim(`  Schema: ${report.schema_version || 'unknown'}`));
  console.log('');

  const overallLabel = report.overall === 'pass'
    ? chalk.green('PASS')
    : report.overall === 'fail'
      ? chalk.red('FAIL')
      : chalk.red('ERROR');
  console.log(`  Overall: ${overallLabel}`);
  console.log(chalk.dim(`  Files verified: ${report.file_count}`));
  if (report.repo_count) {
    console.log(chalk.dim(`  Embedded repos: ${report.repo_count}`));
  }

  for (const error of report.errors || []) {
    console.log(chalk.red(`    ✗ ${error}`));
  }

  console.log('');
}

function resolveTargetTurnId(requestedTurnId, activeTurns) {
  const turnIds = Object.keys(activeTurns);

  if (requestedTurnId) {
    if (!activeTurns[requestedTurnId]) {
      console.log(chalk.red(`Unknown active turn: ${requestedTurnId}`));
      if (turnIds.length > 0) {
        console.log(chalk.dim(`  Available: ${turnIds.join(', ')}`));
      }
      process.exit(2);
    }
    return requestedTurnId;
  }

  if (turnIds.length === 0) {
    console.log(chalk.red('No active turn found.'));
    process.exit(2);
  }

  if (turnIds.length > 1) {
    console.log(chalk.red('Multiple active turns are present. Re-run with `agentxchain verify turn <turn_id>`.'));
    console.log(chalk.dim(`  Available: ${turnIds.join(', ')}`));
    process.exit(2);
  }

  return turnIds[0];
}

function emitTurnValidationFailure(validation, jsonMode) {
  const payload = {
    overall: 'validation_failed',
    validation: {
      ok: false,
      stage: validation.stage,
      error_class: validation.error_class,
      errors: validation.errors || [],
      warnings: validation.warnings || [],
    },
  };

  if (jsonMode) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log('');
  console.log(chalk.red('  Turn Verification Blocked By Validation'));
  console.log(chalk.dim('  ' + '─'.repeat(44)));
  console.log(`  ${chalk.dim('Stage:')}    ${validation.stage || 'unknown'}`);
  console.log(`  ${chalk.dim('Reason:')}   ${validation.error_class || 'validation_error'}`);
  for (const error of validation.errors || []) {
    console.log(`  ${chalk.dim('Error:')}    ${error}`);
  }
  if ((validation.warnings || []).length > 0) {
    console.log('');
    for (const warning of validation.warnings || []) {
      console.log(`  ${chalk.dim('Warning:')}  ${warning}`);
    }
  }
  console.log('');
}

function emitTurnVerification(payload, jsonMode) {
  if (jsonMode) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log('');
  console.log(chalk.bold(`  Verify Turn: ${chalk.cyan(payload.turn_id)}`));
  console.log(chalk.dim('  ' + '─'.repeat(44)));
  console.log(`  ${chalk.dim('Role:')}       ${payload.role}`);
  console.log(`  ${chalk.dim('Runtime:')}    ${payload.runtime_id} (${payload.runtime_type})`);
  console.log(`  ${chalk.dim('Staging:')}    ${payload.staging_path}`);
  console.log(`  ${chalk.dim('Declared:')}   ${payload.declared_status}`);
  console.log(`  ${chalk.dim('Normalized:')} ${payload.normalized_status}`);
  console.log(`  ${chalk.dim('Outcome:')}    ${formatOutcome(payload.overall)}`);

  for (const warning of payload.validation?.warnings || []) {
    console.log(`  ${chalk.dim('Warning:')}    ${warning}`);
  }

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
