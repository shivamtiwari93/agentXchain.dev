import { existsSync } from 'fs';
import { join } from 'path';
import chalk from 'chalk';
import { loadProjectContext, loadProjectState } from '../lib/config.js';
import { getNextPhase } from '../lib/gate-evaluator.js';
import { getMaxConcurrentTurns } from '../lib/normalized-config.js';

export function phaseCommand(subcommand, phaseId, opts) {
  const context = loadProjectContext();
  if (!context) {
    console.log(chalk.red('  No agentxchain.json found. Run `agentxchain init` first.'));
    process.exit(1);
  }

  const { root, config, rawConfig, version } = context;
  if (version !== 4 || config.protocol_mode !== 'governed') {
    console.log(chalk.red('  Not a governed AgentXchain project (requires v4 config).'));
    process.exit(1);
  }

  const phaseIds = Object.keys(config.routing || {});
  if (phaseIds.length === 0) {
    console.log(chalk.red('  No governed phases are defined in routing.'));
    process.exit(1);
  }

  const state = loadProjectState(root, config);

  if (subcommand === 'show') {
    return showPhase(phaseId, { root, config, rawConfig, state, phaseIds, opts });
  }

  return listPhases({ root, config, rawConfig, state, phaseIds, opts });
}

function listPhases({ root, config, rawConfig, state, phaseIds, opts }) {
  const phases = phaseIds.map((phaseId) => buildPhaseRecord(root, config, rawConfig, state, phaseId));

  if (opts.json) {
    console.log(JSON.stringify({
      current_phase: state?.phase || null,
      phases,
    }, null, 2));
    return;
  }

  console.log(chalk.bold(`\n  Phases (${phases.length}):\n`));
  for (const phase of phases) {
    const current = phase.is_current ? chalk.green(' [current]') : '';
    const entry = phase.entry_role || 'none';
    const gate = phase.exit_gate || 'open';
    const next = phase.next_phase || 'final';
    console.log(`  ${chalk.cyan(phase.id)}${current} — entry ${chalk.bold(entry)}, gate ${gate}, next ${next}, artifacts ${phase.workflow_kit.artifacts.length}`);
  }
  console.log('');
  console.log(chalk.dim('  Usage: agentxchain phase show <phase>\n'));
}

function showPhase(requestedPhaseId, { root, config, rawConfig, state, phaseIds, opts }) {
  const phaseId = requestedPhaseId || state?.phase || phaseIds[0];
  if (!config.routing?.[phaseId]) {
    console.log(chalk.red(`  Unknown phase: ${phaseId}`));
    console.log(chalk.dim(`  Available: ${phaseIds.join(', ')}`));
    process.exit(1);
  }

  const phase = buildPhaseRecord(root, config, rawConfig, state, phaseId);

  if (opts.json) {
    console.log(JSON.stringify(phase, null, 2));
    return;
  }

  console.log(chalk.bold(`\n  Phase: ${chalk.cyan(phase.id)}${phase.is_current ? chalk.green(' [current]') : ''}\n`));
  console.log(`  Entry role:        ${phase.entry_role || chalk.dim('none')}`);
  console.log(`  Exit gate:         ${phase.exit_gate || chalk.dim('open')}`);
  if (phase.exit_gate_status) {
    console.log(`  Gate status:       ${phase.exit_gate_status}`);
  }
  console.log(`  Next phase:        ${phase.next_phase || chalk.dim('final')}`);
  console.log(`  Next roles:        ${phase.allowed_next_roles.length > 0 ? phase.allowed_next_roles.join(', ') : chalk.dim('none')}`);
  console.log(`  Max turns:         ${phase.max_concurrent_turns}`);
  if (phase.timeout_minutes != null || phase.timeout_action) {
    console.log(`  Timeout override:  ${phase.timeout_minutes != null ? `${phase.timeout_minutes}m` : chalk.dim('default')} / ${phase.timeout_action || chalk.dim('default')}`);
  }
  console.log(`  Workflow source:   ${phase.workflow_kit.source}`);
  if (phase.workflow_kit.template) {
    console.log(`  Workflow template: ${phase.workflow_kit.template}`);
  }
  console.log('');

  if (phase.workflow_kit.artifacts.length === 0) {
    console.log(`  ${chalk.dim('Artifacts:')} none declared\n`);
    return;
  }

  console.log(`  ${chalk.dim('Artifacts:')}`);
  for (const artifact of phase.workflow_kit.artifacts) {
    const icon = artifact.exists ? chalk.green('✓') : (artifact.required ? chalk.red('✗') : chalk.yellow('○'));
    const ownerLabel = artifact.owner_resolution === 'explicit'
      ? artifact.owned_by
      : artifact.owner_resolution === 'entry_role'
        ? `${chalk.dim(artifact.owned_by + ' (hint, not enforced)')}`
        : 'none';
    const semantics = artifact.semantics || 'none';
    const required = artifact.required ? 'required' : 'optional';
    console.log(`    ${icon} ${artifact.path} [${required}] [owner: ${ownerLabel}] [semantics: ${semantics}]`);
  }
  if (phase.workflow_kit.artifacts.some((artifact) => artifact.owner_resolution === 'entry_role')) {
    console.log(`    ${chalk.dim('Hint: inferred ownership from entry_role is display-only. Only explicit owned_by is enforced at gate evaluation.')}`);
  }
  console.log('');
}

function buildPhaseRecord(root, config, rawConfig, state, phaseId) {
  const route = config.routing?.[phaseId] || {};
  const normalizedPhaseKit = config.workflow_kit?.phases?.[phaseId] || null;
  const rawWorkflowKit = rawConfig.workflow_kit;
  const rawPhaseKit = rawWorkflowKit?.phases?.[phaseId] || null;
  const hasExplicitWorkflowKit = rawWorkflowKit !== undefined && rawWorkflowKit !== null;

  const workflowSource = !hasExplicitWorkflowKit
    ? 'default'
    : rawPhaseKit
      ? 'explicit'
      : 'not_declared';

  const artifacts = (normalizedPhaseKit?.artifacts || []).map((artifact) => {
    const hasExplicitOwner = typeof artifact.owned_by === 'string' && artifact.owned_by.length > 0;
    const ownedBy = hasExplicitOwner ? artifact.owned_by : (route.entry_role || null);
    return {
      path: artifact.path,
      required: artifact.required !== false,
      semantics: artifact.semantics || null,
      owned_by: ownedBy,
      owner_resolution: hasExplicitOwner ? 'explicit' : (ownedBy ? 'entry_role' : 'unowned'),
      ownership_enforced: hasExplicitOwner,
      exists: existsSync(join(root, artifact.path)),
    };
  });

  return {
    id: phaseId,
    is_current: state?.phase === phaseId,
    entry_role: route.entry_role || null,
    exit_gate: route.exit_gate || null,
    exit_gate_status: route.exit_gate ? (state?.phase_gate_status?.[route.exit_gate] || null) : null,
    next_phase: getNextPhase(phaseId, config.routing || {}),
    allowed_next_roles: Array.isArray(route.allowed_next_roles) ? route.allowed_next_roles : [],
    timeout_minutes: typeof route.timeout_minutes === 'number' ? route.timeout_minutes : null,
    timeout_action: typeof route.timeout_action === 'string' ? route.timeout_action : null,
    max_concurrent_turns: getMaxConcurrentTurns(config, phaseId),
    workflow_kit: {
      source: workflowSource,
      template: typeof rawPhaseKit?.template === 'string' ? rawPhaseKit.template : null,
      artifacts,
    },
  };
}
