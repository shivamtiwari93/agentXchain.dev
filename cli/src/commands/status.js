import chalk from 'chalk';
import { loadConfig, loadLock, loadProjectContext, loadProjectState, loadState } from '../lib/config.js';
import { deriveRecoveryDescriptor } from '../lib/blocked-state.js';
import { getActiveTurn, getActiveTurnCount, getActiveTurns } from '../lib/governed-state.js';
import { getContinuityStatus } from '../lib/continuity-status.js';
import { getConnectorHealth } from '../lib/connector-health.js';
import { deriveWorkflowKitArtifacts } from '../lib/workflow-kit-artifacts.js';

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
  const connectorHealth = getConnectorHealth(root, config, state);

  const workflowKitArtifacts = deriveWorkflowKitArtifacts(root, config, state);

  if (opts.json) {
    console.log(JSON.stringify({
      version,
      protocol_mode: config.protocol_mode,
      template: config.template || 'generic',
      config,
      state,
      continuity,
      connector_health: connectorHealth,
      workflow_kit_artifacts: workflowKitArtifacts,
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
  renderConnectorHealthStatus(connectorHealth);

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

  if (state?.last_gate_failure) {
    renderLastGateFailure(state.last_gate_failure, config);
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

  renderWorkflowKitArtifactsSection(workflowKitArtifacts);

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

function renderConnectorHealthStatus(connectorHealth) {
  const connectors = Array.isArray(connectorHealth?.connectors)
    ? connectorHealth.connectors
    : [];
  if (connectors.length === 0) {
    return;
  }

  console.log(`  ${chalk.dim('Connectors:')}`);
  for (const connector of connectors) {
    const stateLabel = formatConnectorState(connector.state);
    console.log(`    ${stateLabel} ${chalk.bold(connector.runtime_id)} — ${connector.type} (${connector.target})`);

    if (connector.active_turn_ids.length > 0) {
      console.log(`      ${chalk.dim('Active turns:')} ${connector.active_turn_ids.join(', ')}`);
    }

    if (connector.last_error) {
      console.log(`      ${chalk.dim('Last error:')} ${connector.last_error}`);
    } else if (connector.last_success_at) {
      console.log(`      ${chalk.dim('Last success:')} ${connector.last_success_at}`);
    } else if (connector.last_attempt_at) {
      console.log(`      ${chalk.dim('Last attempt:')} ${connector.last_attempt_at}`);
    }
  }
  console.log('');
}

function formatConnectorState(state) {
  switch (state) {
    case 'healthy':
      return chalk.green('● healthy');
    case 'failing':
      return chalk.red('✗ failing');
    case 'active':
      return chalk.yellow('● active');
    case 'never_used':
    default:
      return chalk.dim('○ never_used');
  }
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

  if (continuity.drift_detected === true) {
    const [firstWarning, ...remainingWarnings] = continuity.drift_warnings || [];
    if (firstWarning) {
      console.log(`  ${chalk.dim('Drift:')}    ${chalk.yellow(firstWarning)}`);
    }
    for (const warning of remainingWarnings) {
      console.log(`  ${chalk.dim('         ')} ${chalk.yellow(warning)}`);
    }
  } else if (continuity.drift_detected === false) {
    console.log(`  ${chalk.dim('Drift:')}    ${chalk.green('none detected since checkpoint')}`);
  }

  if (continuity.recommended_command) {
    const detail = continuity.recommended_detail ? ` (${continuity.recommended_detail})` : '';
    console.log(`  ${chalk.dim('Action:')}   ${chalk.cyan(continuity.recommended_command)}${chalk.dim(detail)}`);
  }

  if (continuity.recovery_report_path) {
    console.log(`  ${chalk.dim('Report:')}   ${continuity.recovery_report_path}`);
  }

  console.log('');
}

function renderWorkflowKitArtifactsSection(wkData) {
  if (!wkData || !wkData.artifacts || wkData.artifacts.length === 0) return;

  const artifacts = wkData.artifacts;
  console.log('');
  console.log(`  ${chalk.dim('Artifacts:')} (${wkData.phase})`);
  for (const a of artifacts) {
    const icon = a.exists ? chalk.green('✓') : (a.required ? chalk.red('✗') : chalk.yellow('○'));
    const reqLabel = a.required ? '' : chalk.dim(' (optional)');
    const ownerLabel = a.owned_by
      ? chalk.dim(` [${a.owned_by}${a.owner_resolution === 'entry_role' ? '*' : ''}]`)
      : '';
    console.log(`    ${icon} ${a.path}${ownerLabel}${reqLabel}`);
  }
  if (artifacts.some(a => a.owner_resolution === 'entry_role')) {
    console.log(`    ${chalk.dim('* = ownership inferred from entry_role')}`);
  }
}

function renderLastGateFailure(failure, config) {
  const entryRole = config?.routing?.[failure.phase]?.entry_role || null;
  const suggestedCommand = entryRole ? `agentxchain assign ${entryRole}` : 'agentxchain assign <role>';
  const requestLabel = failure.gate_type === 'run_completion'
    ? 'Run completion'
    : `${failure.from_phase || failure.phase} -> ${failure.to_phase || 'unknown'}`;

  console.log('');
  console.log(`  ${chalk.dim('Gate fail:')} ${chalk.red.bold(failure.gate_type === 'run_completion' ? 'RUN COMPLETION' : 'PHASE TRANSITION')}`);
  console.log(`  ${chalk.dim('Gate:')}     ${failure.gate_id || 'unknown'}`);
  console.log(`  ${chalk.dim('Request:')}  ${requestLabel}`);
  console.log(`  ${chalk.dim('Source:')}   ${failure.queued_request ? 'queued drain request' : 'direct request'}`);
  console.log(`  ${chalk.dim('When:')}     ${failure.failed_at || 'unknown'}`);
  if (failure.requested_by_turn) {
    console.log(`  ${chalk.dim('Turn:')}     ${failure.requested_by_turn}`);
  }
  if (Array.isArray(failure.reasons) && failure.reasons.length > 0) {
    console.log(`  ${chalk.dim('Reasons:')}`);
    for (const reason of failure.reasons) {
      console.log(`    ${chalk.red('•')} ${reason}`);
    }
  }
  console.log(`  ${chalk.dim('Action:')}   ${chalk.cyan(suggestedCommand)} to keep working in ${failure.phase}`);
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
