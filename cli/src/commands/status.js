import { existsSync } from 'fs';
import { join } from 'path';
import chalk from 'chalk';
import { loadConfig, loadLock, loadProjectContext, loadProjectState, loadState } from '../lib/config.js';
import { deriveRecoveryDescriptor } from '../lib/blocked-state.js';
import { getActiveTurn, getActiveTurnCount, getActiveTurns } from '../lib/governed-state.js';
import { readSessionCheckpoint } from '../lib/session-checkpoint.js';

const SESSION_RECOVERY_PATH = '.agentxchain/SESSION_RECOVERY.md';

export async function statusCommand(opts) {
  const context = loadProjectContext();
  if (!context) {
    console.log(chalk.red('No agentxchain.json found. Run `agentxchain init` first.'));
    process.exit(1);
  }

  if (context.config.protocol_mode === 'governed') {
    return renderGovernedStatus(context, opts);
  }

  const result = loadConfig();
  const { root, config } = result;
  const lock = loadLock(root);
  const state = loadState(root);

  if (opts.json) {
    console.log(JSON.stringify({ config, lock, state }, null, 2));
    return;
  }

  console.log('');
  console.log(chalk.bold('  AgentXchain Status'));
  console.log(chalk.dim('  ' + '─'.repeat(44)));
  console.log('');

  console.log(`  ${chalk.dim('Project:')}  ${config.project}`);
  console.log(`  ${chalk.dim('Phase:')}    ${state ? formatPhase(state.phase) : chalk.dim('unknown')}`);
  if (state?.blocked) {
    console.log(`  ${chalk.dim('Blocked:')}  ${chalk.red('YES')} — ${state.blocked_on || 'unknown reason'}`);
  }
  console.log('');

  if (lock) {
    if (lock.holder === 'human') {
      console.log(`  ${chalk.dim('Lock:')}     ${chalk.magenta('HUMAN')} — you hold the lock`);
    } else if (lock.holder) {
      const agentName = config.agents[lock.holder]?.name || lock.holder;
      console.log(`  ${chalk.dim('Lock:')}     ${chalk.yellow('CLAIMED')} by ${chalk.bold(lock.holder)} (${agentName})`);
      if (lock.claimed_at) {
        console.log(`  ${chalk.dim('Claimed:')}  ${timeSince(lock.claimed_at)} ago`);
      }
    } else {
      console.log(`  ${chalk.dim('Lock:')}     ${chalk.green('FREE')} — any agent can claim`);
    }
    console.log(`  ${chalk.dim('Turn:')}     ${lock.turn_number}`);
    if (lock.last_released_by) {
      console.log(`  ${chalk.dim('Last:')}     ${lock.last_released_by}`);
    }
  }
  console.log('');

  console.log(`  ${chalk.dim('Agents:')}   ${Object.keys(config.agents).length}`);

  for (const [id, agent] of Object.entries(config.agents)) {
    const isHolder = lock?.holder === id;
    const marker = isHolder ? chalk.yellow('●') : chalk.dim('○');
    const label = isHolder ? chalk.bold(id) : id;
    console.log(`    ${marker} ${label} — ${agent.name}`);
  }

  if (lock?.holder === 'human') {
    console.log(`    ${chalk.magenta('●')} ${chalk.bold('human')} — You`);
  }

  console.log('');
}

function renderGovernedStatus(context, opts) {
  const { root, config, version } = context;
  const state = loadProjectState(root, config);
  const continuity = getContinuityStatus(root, state);

  if (opts.json) {
    console.log(JSON.stringify({
      version,
      protocol_mode: config.protocol_mode,
      template: config.template || 'generic',
      config,
      state,
      continuity,
    }, null, 2));
    return;
  }

  console.log('');
  console.log(chalk.bold('  AgentXchain Status'));
  console.log(chalk.dim('  ' + '─'.repeat(44)));
  console.log('');

  console.log(`  ${chalk.dim('Project:')}  ${config.project.name}`);
  console.log(`  ${chalk.dim('Protocol:')} ${chalk.cyan(`governed (v${version})`)}`);
  console.log(`  ${chalk.dim('Template:')} ${config.template || 'generic'}`);
  console.log(`  ${chalk.dim('Phase:')}    ${state?.phase ? formatGovernedPhase(state.phase) : chalk.dim('unknown')}`);
  console.log(`  ${chalk.dim('Run:')}      ${formatRunStatus(state?.status)}`);
  if (state?.accepted_integration_ref) {
    console.log(`  ${chalk.dim('Accepted:')} ${state.accepted_integration_ref}`);
  }
  console.log('');

  renderContinuityStatus(continuity, state);

  const activeTurnCount = getActiveTurnCount(state);
  const activeTurns = getActiveTurns(state);
  const singleActiveTurn = getActiveTurn(state);
  if (activeTurnCount > 1) {
    console.log(`  ${chalk.dim('Turns:')}    ${activeTurnCount} active`);
    for (const turn of Object.values(activeTurns)) {
      const marker = turn.status === 'conflicted'
        ? chalk.red('✗')
        : chalk.yellow('●');
      const statusLabel = turn.status === 'conflicted'
        ? chalk.red('conflicted')
        : turn.status;
      console.log(`    ${marker} ${turn.turn_id} — ${chalk.bold(turn.assigned_role)} (${statusLabel}) [attempt ${turn.attempt}]`);
      if (turn.status === 'conflicted' && turn.conflict_state) {
        const cs = turn.conflict_state;
        const files = cs.conflict_error?.conflicting_files || [];
        const count = cs.detection_count || 1;
        console.log(`      ${chalk.dim('Conflict:')}  ${files.length} file(s) — detection #${count}`);
        if (cs.conflict_error?.overlap_ratio != null) {
          console.log(`      ${chalk.dim('Overlap:')}   ${(cs.conflict_error.overlap_ratio * 100).toFixed(0)}%`);
        }
        const suggestion = cs.conflict_error?.suggested_resolution || 'reject_and_reassign';
        console.log(`      ${chalk.dim('Suggested:')} ${suggestion}`);
        console.log(`      ${chalk.dim('Resolve:')}   ${chalk.cyan(`agentxchain reject-turn --turn ${turn.turn_id} --reassign`)}`);
        console.log(`      ${chalk.dim('     or:')}   ${chalk.cyan(`agentxchain accept-turn --turn ${turn.turn_id} --resolution human_merge`)}`);
      }
    }
  } else if (singleActiveTurn) {
    console.log(`  ${chalk.dim('Turn:')}     ${singleActiveTurn.turn_id}`);
    console.log(`  ${chalk.dim('Role:')}     ${chalk.bold(singleActiveTurn.assigned_role)} (${singleActiveTurn.status})`);
    console.log(`  ${chalk.dim('Runtime:')}  ${singleActiveTurn.runtime_id}`);
    console.log(`  ${chalk.dim('Attempt:')}  ${singleActiveTurn.attempt}`);
    if (singleActiveTurn.status === 'conflicted' && singleActiveTurn.conflict_state) {
      const cs = singleActiveTurn.conflict_state;
      const files = cs.conflict_error?.conflicting_files || [];
      console.log(`  ${chalk.dim('Conflict:')} ${chalk.red(`${files.length} file(s) conflicting`)} — detection #${cs.detection_count || 1}`);
      console.log(`  ${chalk.dim('Resolve:')}  ${chalk.cyan('agentxchain reject-turn --reassign')}`);
      console.log(`  ${chalk.dim('     or:')}  ${chalk.cyan('agentxchain accept-turn --resolution human_merge')}`);
    }
  } else {
    console.log(`  ${chalk.dim('Turn:')}     ${chalk.yellow('No active turn')}`);
  }

  // Queued phase/completion requests
  if (state?.queued_phase_transition) {
    const qt = state.queued_phase_transition;
    console.log('');
    console.log(`  ${chalk.dim('Queued:')}   Phase transition ${formatGovernedPhase(qt.from)} → ${formatGovernedPhase(qt.to)} (awaiting drain)`);
  }
  if (state?.queued_run_completion) {
    console.log('');
    console.log(`  ${chalk.dim('Queued:')}   Run completion (awaiting drain)`);
  }

  // Per-turn budget reservations
  if (state?.budget_reservations && Object.keys(state.budget_reservations).length > 0) {
    console.log('');
    console.log(`  ${chalk.dim('Budget reservations:')}`);
    for (const [turnId, reservation] of Object.entries(state.budget_reservations)) {
      const amt = reservation.reserved_usd != null ? `$${formatUsd(reservation.reserved_usd)}` : '(unknown)';
      console.log(`    ${chalk.dim('●')} ${turnId}: ${amt}`);
    }
  }

  if (state?.blocked_on) {
    console.log('');
    if (state.status === 'blocked') {
      const recovery = deriveRecoveryDescriptor(state, config);
      const detail = recovery?.detail || state.blocked_on;
      console.log(`  ${chalk.dim('Blocked:')}  ${chalk.red.bold('BLOCKED')} — ${detail}`);
    } else if (state.blocked_on.startsWith('human_approval:')) {
      const gate = state.blocked_on.replace('human_approval:', '');
      console.log(`  ${chalk.dim('Blocked:')}  ${chalk.yellow('AWAITING HUMAN APPROVAL')} — gate: ${chalk.bold(gate)}`);
    } else {
      console.log(`  ${chalk.dim('Blocked:')}  ${chalk.red(state.blocked_on)}`);
    }
  }

  const recovery = deriveRecoveryDescriptor(state, config);
  if (recovery) {
    console.log('');
    console.log(`  ${chalk.dim('Reason:')}   ${recovery.typed_reason}`);
    console.log(`  ${chalk.dim('Owner:')}    ${recovery.owner}`);
    console.log(`  ${chalk.dim('Action:')}   ${recovery.recovery_action}`);
    console.log(`  ${chalk.dim('Turn:')}     ${recovery.turn_retained ? 'retained' : 'cleared'}`);
    if (recovery.detail) {
      console.log(`  ${chalk.dim('Detail:')}   ${recovery.detail}`);
    }
  }

  if (state?.pending_phase_transition) {
    const pt = state.pending_phase_transition;
    console.log(`  ${chalk.dim('Pending:')}  ${formatGovernedPhase(pt.from)} → ${formatGovernedPhase(pt.to)}`);
    console.log(`  ${chalk.dim('Gate:')}     ${pt.gate} (requires human approval)`);
    console.log(`  ${chalk.dim('Action:')}   Run ${chalk.cyan('agentxchain approve-transition')} to advance`);
  }

  if (state?.pending_run_completion) {
    const pc = state.pending_run_completion;
    console.log(`  ${chalk.dim('Pending:')}  ${chalk.bold('Run Completion')}`);
    console.log(`  ${chalk.dim('Gate:')}     ${pc.gate} (requires human approval)`);
    console.log(`  ${chalk.dim('Action:')}   Run ${chalk.cyan('agentxchain approve-completion')} to finalize`);
  }

  if (state?.status === 'completed') {
    console.log('');
    console.log(`  ${chalk.green.bold('✓ Run completed')}`);
    if (state.completed_at) {
      console.log(`  ${chalk.dim('Completed:')} ${state.completed_at}`);
    }
  }

  if (state?.phase_gate_status) {
    console.log('');
    console.log(`  ${chalk.dim('Gates:')}`);
    for (const [gate, status] of Object.entries(state.phase_gate_status)) {
      const icon = status === 'passed' ? chalk.green('✓') : chalk.dim('○');
      console.log(`    ${icon} ${gate}: ${status}`);
    }
  }

  if (state?.budget_status) {
    console.log('');
    console.log(`  ${chalk.dim('Budget:')}   spent $${formatUsd(state.budget_status.spent_usd)} / remaining $${formatUsd(state.budget_status.remaining_usd)}`);
  }

  console.log('');
  console.log(`  ${chalk.dim('Roles:')}    ${Object.keys(config.roles).length}`);
  for (const [id, role] of Object.entries(config.roles)) {
    const isAssigned = Object.values(getActiveTurns(state)).some(turn => turn.assigned_role === id);
    const marker = isAssigned ? chalk.yellow('●') : chalk.dim('○');
    const label = isAssigned ? chalk.bold(id) : id;
    console.log(`    ${marker} ${label} — ${role.title} [${role.write_authority}]`);
  }
  console.log('');
}

function getContinuityStatus(root, state) {
  const checkpoint = readSessionCheckpoint(root);
  const recoveryReportPath = existsSync(join(root, SESSION_RECOVERY_PATH))
    ? SESSION_RECOVERY_PATH
    : null;

  if (!checkpoint && !recoveryReportPath) return null;

  const staleCheckpoint = !!(
    checkpoint?.run_id
    && state?.run_id
    && checkpoint.run_id !== state.run_id
  );

  return {
    checkpoint,
    stale_checkpoint: staleCheckpoint,
    recovery_report_path: recoveryReportPath,
    restart_recommended: !!state && !['blocked', 'completed', 'failed'].includes(state.status),
  };
}

function renderContinuityStatus(continuity, state) {
  if (!continuity) return;

  console.log(`  ${chalk.dim('Continuity:')}`);

  if (continuity.checkpoint) {
    const checkpoint = continuity.checkpoint;
    const checkpointSummary = checkpoint.last_checkpoint_at
      ? `${checkpoint.checkpoint_reason || 'unknown'} at ${checkpoint.last_checkpoint_at}`
      : (checkpoint.checkpoint_reason || 'unknown');
    console.log(`  ${chalk.dim('Session:')}  ${checkpoint.session_id || chalk.dim('unknown')}`);
    console.log(`  ${chalk.dim('Checkpoint:')} ${checkpointSummary}`);
    console.log(`  ${chalk.dim('Last turn:')} ${checkpoint.last_turn_id || chalk.dim('none')}`);
    console.log(`  ${chalk.dim('Last role:')} ${checkpoint.last_role || chalk.dim('unknown')}`);
    if (continuity.stale_checkpoint) {
      console.log(
        `  ${chalk.dim('Warning:')} ${chalk.yellow(
          `session checkpoint tracks ${checkpoint.run_id}, but state.json tracks ${state?.run_id || 'unknown'}; state.json remains source of truth`
        )}`
      );
    }
  } else {
    console.log(`  ${chalk.dim('Checkpoint:')} ${chalk.yellow('No session checkpoint recorded')}`);
  }

  if (continuity.restart_recommended) {
    console.log(`  ${chalk.dim('Restart:')} ${chalk.cyan('agentxchain restart')} (rebuild session context from disk)`);
  }

  if (continuity.recovery_report_path) {
    console.log(`  ${chalk.dim('Report:')}   ${continuity.recovery_report_path}`);
  }

  console.log('');
}

function formatPhase(phase) {
  const colors = { discovery: chalk.blue, build: chalk.green, qa: chalk.yellow, deploy: chalk.magenta, blocked: chalk.red };
  return (colors[phase] || chalk.white)(phase);
}

function formatGovernedPhase(phase) {
  const colors = { planning: chalk.blue, implementation: chalk.green, qa: chalk.yellow, paused: chalk.magenta, failed: chalk.red };
  return (colors[phase] || chalk.white)(phase);
}

function formatRunStatus(status) {
  if (status === 'blocked') return chalk.red.bold('BLOCKED');
  if (status === 'paused') return chalk.yellow.bold('PAUSED');
  if (status === 'completed') return chalk.green.bold('COMPLETED');
  if (status === 'active') return chalk.cyan('active');
  if (status === 'idle') return chalk.dim('idle');
  return status || chalk.dim('unknown');
}

function timeSince(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  return `${hr}h ${min % 60}m`;
}

function formatUsd(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '0.00';
  return value.toFixed(2);
}
