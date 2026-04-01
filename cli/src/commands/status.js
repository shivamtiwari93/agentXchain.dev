import chalk from 'chalk';
import { loadConfig, loadLock, loadProjectContext, loadProjectState, loadState } from '../lib/config.js';
import { deriveRecoveryDescriptor } from '../lib/blocked-state.js';

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

  if (opts.json) {
    console.log(JSON.stringify({
      version,
      protocol_mode: config.protocol_mode,
      config,
      state,
    }, null, 2));
    return;
  }

  console.log('');
  console.log(chalk.bold('  AgentXchain Status'));
  console.log(chalk.dim('  ' + '─'.repeat(44)));
  console.log('');

  console.log(`  ${chalk.dim('Project:')}  ${config.project.name}`);
  console.log(`  ${chalk.dim('Protocol:')} ${chalk.cyan(`governed (v${version})`)}`);
  console.log(`  ${chalk.dim('Phase:')}    ${state?.phase ? formatGovernedPhase(state.phase) : chalk.dim('unknown')}`);
  console.log(`  ${chalk.dim('Run:')}      ${state?.status || chalk.dim('unknown')}`);
  if (state?.accepted_integration_ref) {
    console.log(`  ${chalk.dim('Accepted:')} ${state.accepted_integration_ref}`);
  }
  console.log('');

  if (state?.current_turn) {
    console.log(`  ${chalk.dim('Turn:')}     ${state.current_turn.turn_id}`);
    console.log(`  ${chalk.dim('Role:')}     ${chalk.bold(state.current_turn.assigned_role)} (${state.current_turn.status})`);
    console.log(`  ${chalk.dim('Runtime:')}  ${state.current_turn.runtime_id}`);
    console.log(`  ${chalk.dim('Attempt:')}  ${state.current_turn.attempt}`);
  } else {
    console.log(`  ${chalk.dim('Turn:')}     ${chalk.yellow('No active turn')}`);
  }

  if (state?.blocked_on) {
    console.log('');
    if (state.blocked_on.startsWith('human_approval:')) {
      const gate = state.blocked_on.replace('human_approval:', '');
      console.log(`  ${chalk.dim('Blocked:')}  ${chalk.yellow('AWAITING HUMAN APPROVAL')} — gate: ${chalk.bold(gate)}`);
    } else {
      console.log(`  ${chalk.dim('Blocked:')}  ${chalk.red(state.blocked_on)}`);
    }
  }

  const recovery = deriveRecoveryDescriptor(state);
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
    const isAssigned = state?.current_turn?.assigned_role === id;
    const marker = isAssigned ? chalk.yellow('●') : chalk.dim('○');
    const label = isAssigned ? chalk.bold(id) : id;
    console.log(`    ${marker} ${label} — ${role.title} [${role.write_authority}]`);
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
