/**
 * agentxchain run — drive a governed run to completion.
 *
 * Thin CLI surface over the runLoop library. Wires runLoop callbacks to:
 *   - Existing adapter system (api_proxy, local_cli, mcp, remote_agent)
 *   - Interactive gate prompting (stdin) or auto-approve mode
 *   - Terminal output via chalk
 *
 * Does NOT support manual adapter — use `agentxchain step` for that.
 * Does NOT call assignTurn/acceptTurn/rejectTurn directly — runLoop owns the state machine.
 *
 * See .planning/AGENTXCHAIN_RUN_SPEC.md for the full specification.
 */

import chalk from 'chalk';
import { createInterface } from 'readline';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { loadProjectContext, loadProjectState } from '../lib/config.js';
import { runLoop } from '../lib/run-loop.js';
import { buildRunExport } from '../lib/export.js';
import { buildGovernanceReport, formatGovernanceReportMarkdown } from '../lib/report.js';
import { validateParentRun } from '../lib/run-history.js';
import { dispatchApiProxy } from '../lib/adapters/api-proxy-adapter.js';
import {
  dispatchLocalCli,
  saveDispatchLogs,
  resolvePromptTransport,
} from '../lib/adapters/local-cli-adapter.js';
import { dispatchMcp, resolveMcpTransport, describeMcpRuntimeTarget } from '../lib/adapters/mcp-adapter.js';
import { dispatchRemoteAgent, describeRemoteAgentTarget } from '../lib/adapters/remote-agent-adapter.js';
import { runHooks } from '../lib/hook-runner.js';
import { finalizeDispatchManifest } from '../lib/dispatch-manifest.js';
import { deriveRecoveryDescriptor } from '../lib/blocked-state.js';
import { resolveGovernedRole } from '../lib/role-resolution.js';
import {
  getDispatchAssignmentPath,
  getDispatchContextPath,
  getDispatchEffectiveContextPath,
  getDispatchPromptPath,
  getDispatchTurnDir,
  getTurnStagingResultPath,
} from '../lib/turn-paths.js';

export async function runCommand(opts) {
  const context = loadProjectContext();
  if (!context) {
    console.log(chalk.red('No agentxchain.json found. Run `agentxchain init` first.'));
    process.exit(1);
  }

  const { root, config, rawConfig } = context;

  if (config.protocol_mode !== 'governed') {
    console.log(chalk.red('The run command is only available for governed projects.'));
    console.log(chalk.dim('Legacy projects use: agentxchain start'));
    process.exit(1);
  }

  // ── Provenance flag validation ──────────────────────────────────────────
  const continueFrom = opts.continueFrom;
  const recoverFrom = opts.recoverFrom;

  if (continueFrom && recoverFrom) {
    console.log(chalk.red('Cannot specify both --continue-from and --recover-from'));
    process.exit(1);
  }

  let provenance = undefined;
  if (continueFrom || recoverFrom) {
    const parentId = continueFrom || recoverFrom;
    const validation = validateParentRun(root, parentId);
    if (!validation.ok) {
      console.log(chalk.red(validation.error));
      process.exit(1);
    }
    provenance = {
      trigger: continueFrom ? 'continuation' : 'recovery',
      parent_run_id: parentId,
      created_by: 'operator',
    };
  }

  const maxTurns = opts.maxTurns || 50;
  const autoApprove = !!opts.autoApprove;
  const verbose = !!opts.verbose;
  const overrideResolution = opts.role
    ? resolveGovernedRole({ override: opts.role, state: null, config })
    : null;

  if (overrideResolution?.error) {
    console.log(chalk.red(overrideResolution.error));
    if (overrideResolution.availableRoles.length) {
      console.log(chalk.dim(`Available roles: ${overrideResolution.availableRoles.join(', ')}`));
    }
    process.exit(1);
  }

  // ── Dry run ───────────────────────────────────────────────────────────────
  if (opts.dryRun) {
    const dryRunState = loadProjectState(root, config);
    const roleId = overrideResolution?.roleId || resolveRole(null, dryRunState, config);
    console.log(chalk.cyan('Dry run — no execution'));
    console.log(`  First role:   ${roleId || chalk.dim('(unresolved)')}`);
    console.log(`  Max turns:    ${maxTurns}`);
    console.log(`  Gate mode:    ${autoApprove ? 'auto-approve' : 'interactive'}`);
    const roleIds = Object.keys(config.roles || {});
    for (const rid of roleIds) {
      const role = config.roles[rid];
      const rtId = role.runtime;
      const rt = config.runtimes?.[rtId];
      const rtType = rt?.type || role.runtime_class || 'manual';
      const supported = rtType !== 'manual';
      console.log(`  ${supported ? chalk.green('✓') : chalk.red('✗')} ${rid} → ${rtType}${supported ? '' : ' (not supported in run mode)'}`);
    }
    process.exit(0);
  }

  // ── SIGINT handling ─────────────────────────────────────────────────────
  let aborted = false;
  let sigintCount = 0;
  const controller = new AbortController();

  process.on('SIGINT', () => {
    sigintCount++;
    if (sigintCount >= 2) {
      process.exit(130);
    }
    aborted = true;
    controller.abort();
    console.log(chalk.yellow('\nSIGINT received — finishing current turn, then stopping.'));
  });

  // ── Run header ──────────────────────────────────────────────────────────
  console.log(chalk.cyan.bold('agentxchain run'));
  console.log(chalk.dim(`  Max turns: ${maxTurns}  Gate mode: ${autoApprove ? 'auto-approve' : 'interactive'}`));
  console.log('');

  // ── Track first-call for --role override ────────────────────────────────
  let firstSelectRole = true;
  let qaMissingCredentialsFallback = null;

  // ── Callbacks ───────────────────────────────────────────────────────────
  const callbacks = {
    selectRole(state, cfg) {
      if (aborted) return null;

      if (firstSelectRole && opts.role) {
        firstSelectRole = false;
        return overrideResolution.roleId;
      }
      firstSelectRole = false;
      return resolveRole(null, state, cfg);
    },

    async dispatch(ctx) {
      const { turn, state, config: cfg, root: projectRoot } = ctx;
      const roleId = turn.assigned_role;
      const role = cfg.roles?.[roleId];
      const runtimeId = turn.runtime_id;
      const runtime = cfg.runtimes?.[runtimeId];
      const runtimeType = runtime?.type || role?.runtime_class || 'manual';
      const hooksConfig = cfg.hooks || {};
      qaMissingCredentialsFallback = null;

      // Manual adapter is not supported in run mode
      if (runtimeType === 'manual') {
        console.log(chalk.yellow(`Skipping manual role "${roleId}" — use agentxchain step for manual dispatch.`));
        return { accept: false, reason: 'manual adapter is not supported in run mode — use agentxchain step' };
      }

      // ── after_dispatch hooks ──────────────────────────────────────────
      if (hooksConfig.after_dispatch?.length > 0) {
        const hookResult = runHooks(projectRoot, hooksConfig, 'after_dispatch', {
          turn_id: turn.turn_id,
          role_id: roleId,
          bundle_path: getDispatchTurnDir(turn.turn_id),
          bundle_files: ['ASSIGNMENT.json', 'PROMPT.md', 'CONTEXT.md'],
        }, {
          run_id: state.run_id,
          turn_id: turn.turn_id,
          protectedPaths: [
            getDispatchAssignmentPath(turn.turn_id),
            getDispatchPromptPath(turn.turn_id),
            getDispatchContextPath(turn.turn_id),
            getDispatchEffectiveContextPath(turn.turn_id),
          ],
        });

        if (!hookResult.ok) {
          return { accept: false, reason: `after_dispatch hook blocked: ${hookResult.error || 'hook failure'}` };
        }
      }

      // ── Finalize dispatch manifest ────────────────────────────────────
      const manifestResult = finalizeDispatchManifest(projectRoot, turn.turn_id, {
        run_id: state.run_id,
        role: roleId,
      });
      if (!manifestResult.ok) {
        return { accept: false, reason: `dispatch manifest failed: ${manifestResult.error}` };
      }

      // ── Route to adapter ──────────────────────────────────────────────
      const adapterOpts = {
        signal: controller.signal,
        onStatus: (msg) => console.log(chalk.dim(`  ${msg}`)),
        verifyManifest: true,
      };

      if (verbose) {
        adapterOpts.onStdout = (text) => process.stdout.write(chalk.dim(text));
        adapterOpts.onStderr = (text) => process.stderr.write(chalk.yellow(text));
      }

      let adapterResult;

      if (runtimeType === 'api_proxy') {
        console.log(chalk.dim(`  Dispatching to API proxy: ${runtime?.provider || '?'} / ${runtime?.model || '?'}`));
        adapterResult = await dispatchApiProxy(projectRoot, state, cfg, adapterOpts);
      } else if (runtimeType === 'mcp') {
        const transport = resolveMcpTransport(runtime);
        console.log(chalk.dim(`  Dispatching to MCP ${transport}: ${describeMcpRuntimeTarget(runtime)}`));
        adapterResult = await dispatchMcp(projectRoot, state, cfg, adapterOpts);
      } else if (runtimeType === 'local_cli') {
        const transport = runtime ? resolvePromptTransport(runtime) : 'dispatch_bundle_only';
        console.log(chalk.dim(`  Dispatching to local CLI: ${runtime?.command || '(default)'}  transport: ${transport}`));
        adapterResult = await dispatchLocalCli(projectRoot, state, cfg, adapterOpts);
      } else if (runtimeType === 'remote_agent') {
        console.log(chalk.dim(`  Dispatching to remote agent: ${describeRemoteAgentTarget(runtime)}`));
        adapterResult = await dispatchRemoteAgent(projectRoot, state, cfg, adapterOpts);
      } else {
        return { accept: false, reason: `unknown runtime type "${runtimeType}"` };
      }

      // Save adapter logs
      if (adapterResult.logs?.length) {
        saveDispatchLogs(projectRoot, turn.turn_id, adapterResult.logs);
      }

      // Aborted
      if (adapterResult.aborted) {
        return { accept: false, reason: 'dispatch aborted by operator' };
      }

      // Timed out
      if (adapterResult.timedOut) {
        return { accept: false, reason: 'dispatch timed out' };
      }

      // Adapter failure
      if (!adapterResult.ok) {
        if (shouldPrintManualQaFallback({
          roleId,
          runtimeId,
          classified: adapterResult.classified,
          rawConfig,
        })) {
          qaMissingCredentialsFallback = {
            roleId,
            runtimeId,
            errorClass: adapterResult.classified.error_class,
          };
        }
        const errorDetail = adapterResult.classified
          ? `${adapterResult.classified.error_class}: ${adapterResult.classified.recovery}`
          : adapterResult.error;
        return { accept: false, reason: errorDetail || 'adapter dispatch failed' };
      }

      // ── Read staged result ────────────────────────────────────────────
      const stagingFile = join(projectRoot, getTurnStagingResultPath(turn.turn_id));
      if (!existsSync(stagingFile)) {
        return { accept: false, reason: 'adapter completed but no staged result found' };
      }

      let turnResult;
      try {
        turnResult = JSON.parse(readFileSync(stagingFile, 'utf8'));
      } catch (err) {
        return { accept: false, reason: `failed to parse staged result: ${err.message}` };
      }

      return { accept: true, turnResult };
    },

    async approveGate(gateType, state) {
      if (autoApprove) {
        console.log(chalk.yellow(`  Auto-approved ${gateType} gate`));
        return true;
      }

      // Non-TTY → fail-closed
      if (!process.stdin.isTTY) {
        console.log(chalk.yellow(`  Gate pause: ${gateType} — stdin is not a TTY, failing closed.`));
        console.log(chalk.dim('  Use --auto-approve for non-interactive mode.'));
        return false;
      }

      const target = gateType === 'phase_transition'
        ? state.pending_phase_transition?.target || '(next phase)'
        : 'run completion';

      console.log('');
      console.log(chalk.yellow.bold(`Gate pause: ${gateType}`));
      console.log(chalk.dim(`  Phase: ${state.phase} → ${target}`));

      const answer = await promptUser(`  Approve? [y/N] `);
      const approved = /^y(es)?$/i.test(answer.trim());
      return approved;
    },

    onEvent(event) {
      switch (event.type) {
        case 'turn_assigned':
          console.log(chalk.cyan(`Turn assigned: ${event.turn?.turn_id} → ${event.role}`));
          break;
        case 'turn_accepted':
          console.log(chalk.green(`Turn accepted: ${event.turn?.turn_id}`));
          break;
        case 'turn_rejected':
          console.log(chalk.yellow(`Turn rejected: ${event.turn?.turn_id} — ${event.reason || 'no reason'}`));
          break;
        case 'gate_paused':
          console.log(chalk.yellow(`Gate paused: ${event.gateType}`));
          break;
        case 'gate_approved':
          console.log(chalk.green(`Gate approved: ${event.gateType}`));
          break;
        case 'gate_held':
          console.log(chalk.yellow(`Gate held: ${event.gateType} — run paused`));
          break;
        case 'blocked':
          console.log(chalk.red(`Run blocked`));
          break;
        case 'completed':
          console.log(chalk.green.bold('Run completed'));
          break;
        case 'caller_stopped':
          console.log(chalk.yellow('Run stopped by caller'));
          break;
      }
    },
  };

  // ── Execute ─────────────────────────────────────────────────────────────
  const runLoopOpts = { maxTurns };
  if (provenance) runLoopOpts.provenance = provenance;
  const result = await runLoop(root, config, callbacks, runLoopOpts);

  // ── Summary ─────────────────────────────────────────────────────────────
  console.log('');
  console.log(chalk.dim('─── Run Summary ───'));
  console.log(`  Status:  ${result.ok ? chalk.green('completed') : chalk.yellow(result.stop_reason)}`);
  console.log(`  Turns:   ${result.turns_executed}`);
  console.log(`  Gates:   ${result.gates_approved} approved`);
  console.log(`  Errors:  ${result.errors.length ? chalk.red(result.errors.length) : 'none'}`);

  if (result.errors.length) {
    for (const err of result.errors) {
      console.log(chalk.red(`    ${err}`));
    }
  }

  if (qaMissingCredentialsFallback) {
    printManualQaFallback();
  }

  // Recovery guidance for blocked/rejected states
  if (result.state && (result.stop_reason === 'blocked' || result.stop_reason === 'reject_exhausted' || result.stop_reason === 'dispatch_error')) {
    const recovery = deriveRecoveryDescriptor(result.state);
    if (recovery) {
      console.log('');
      console.log(chalk.yellow(`  Recovery: ${recovery.typed_reason}`));
      console.log(chalk.dim(`  Action:   ${recovery.recovery_action}`));
      if (recovery.detail) {
        console.log(chalk.dim(`  Detail:   ${recovery.detail}`));
      }
    }
  }

  // ── Auto governance report ──────────────────────────────────────────────
  if (opts.report !== false && result.state) {
    try {
      const reportsDir = join(root, '.agentxchain', 'reports');
      mkdirSync(reportsDir, { recursive: true });

      const exportResult = buildRunExport(root);
      if (exportResult.ok) {
        const runId = result.state.run_id || 'unknown';
        const exportPath = join(reportsDir, `export-${runId}.json`);
        writeFileSync(exportPath, JSON.stringify(exportResult.export, null, 2));

        const reportResult = buildGovernanceReport(exportResult.export, { input: exportPath });
        const reportPath = join(reportsDir, `report-${runId}.md`);
        writeFileSync(reportPath, formatGovernanceReportMarkdown(reportResult.report));

        console.log('');
        console.log(chalk.dim(`  Governance report: .agentxchain/reports/report-${runId}.md`));
      } else {
        console.log(chalk.dim(`  Governance report skipped: ${exportResult.error}`));
      }
    } catch (err) {
      console.log(chalk.dim(`  Governance report failed: ${err.message}`));
    }
  }

  // ── Exit code ───────────────────────────────────────────────────────────
  const successReasons = new Set(['completed', 'gate_held', 'caller_stopped', 'max_turns_reached']);
  if (result.ok || successReasons.has(result.stop_reason)) {
    process.exit(0);
  }
  process.exit(1);
}

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Resolve the target role for the next turn.
 * Same routing contract as step.js resolveTargetRole, minus interactive logging.
 */
function resolveRole(override, state, config) {
  const resolved = resolveGovernedRole({ override, state, config });
  return resolved.error ? null : resolved.roleId;
}

/**
 * Prompt the user via stdin readline.
 */
function promptUser(question) {
  return new Promise((resolve) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
    rl.on('close', () => resolve(''));
  });
}

function shouldPrintManualQaFallback({ roleId, runtimeId, classified, rawConfig }) {
  return classified?.error_class === 'missing_credentials'
    && roleId === 'qa'
    && runtimeId === 'api-qa'
    && rawConfig?.runtimes?.['manual-qa']?.type === 'manual';
}

function printManualQaFallback() {
  console.log('');
  console.log(chalk.dim('  No-key QA fallback:'));
  console.log(chalk.dim('  - Edit agentxchain.json and change roles.qa.runtime from "api-qa" to "manual-qa"'));
  console.log(chalk.dim('  - Then recover the retained QA turn with: agentxchain step --resume'));
  console.log(chalk.dim('  - Guide: https://agentxchain.dev/docs/getting-started'));
}
