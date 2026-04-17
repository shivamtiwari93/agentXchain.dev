import chalk from 'chalk';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { findProjectRoot, loadProjectContext } from '../lib/config.js';
import {
  attachChainToMission,
  buildMissionListSummary,
  buildMissionSnapshot,
  createMission,
  loadLatestMissionArtifact,
  loadLatestMissionSnapshot,
  loadMissionArtifact,
  loadMissionSnapshot,
} from '../lib/missions.js';
import {
  approvePlanArtifact,
  createPlanArtifact,
  getReadyWorkstreams,
  getWorkstreamStatusSummary,
  launchWorkstream,
  retryWorkstream,
  markWorkstreamOutcome,
  loadAllPlans,
  loadLatestPlan,
  loadPlan,
  buildPlannerPrompt,
  parsePlannerResponse,
  validatePlannerOutput,
} from '../lib/mission-plans.js';
import { executeChainedRun } from '../lib/run-chain.js';
import { executeGovernedRun } from './run.js';

export async function missionStartCommand(opts) {
  const root = findProjectRoot(opts.dir || process.cwd());
  if (!root) {
    console.error(chalk.red('No AgentXchain project found. Run this inside a governed project.'));
    process.exit(1);
  }

  const title = String(opts.title || '').trim();
  const goal = String(opts.goal || '').trim();
  if (!title) {
    console.error(chalk.red('Mission title is required. Use --title <text>.'));
    process.exit(1);
  }
  if (!goal) {
    console.error(chalk.red('Mission goal is required. Use --goal <text>.'));
    process.exit(1);
  }

  const result = createMission(root, {
    missionId: opts.id,
    title,
    goal,
  });
  if (!result.ok) {
    console.error(chalk.red(result.error));
    process.exit(1);
  }

  const snapshot = buildMissionSnapshot(root, result.mission);
  if (opts.plan) {
    try {
      const plan = await createMissionPlan(root, result.mission, opts);
      if (opts.json) {
        console.log(JSON.stringify({ mission: snapshot, plan }, null, 2));
        return;
      }

      console.log(chalk.green(`Created mission ${snapshot.mission_id}`));
      console.log(chalk.dim(`  Goal: ${snapshot.goal}`));
      console.log(chalk.green(`Created plan ${plan.plan_id} for mission ${snapshot.mission_id}`));
      renderPlan(plan);
      return;
    } catch (error) {
      console.error(chalk.yellow(`Mission ${snapshot.mission_id} was created, but automatic plan generation failed.`));
      renderMissionPlanError(error);
      process.exit(1);
    }
  }

  if (opts.json) {
    console.log(JSON.stringify(snapshot, null, 2));
    return;
  }

  console.log(chalk.green(`Created mission ${snapshot.mission_id}`));
  console.log(chalk.dim(`  Goal: ${snapshot.goal}`));
  renderMissionSnapshot(snapshot);
}

export async function missionListCommand(opts) {
  const root = findProjectRoot(opts.dir || process.cwd());
  if (!root) {
    console.error(chalk.red('No AgentXchain project found. Run this inside a governed project.'));
    process.exit(1);
  }

  const limit = opts.limit ? parseInt(opts.limit, 10) : 20;
  const missions = buildMissionListSummary(root, limit);

  if (opts.json) {
    console.log(JSON.stringify(missions, null, 2));
    return;
  }

  if (missions.length === 0) {
    console.log(chalk.dim('No missions found.'));
    console.log(chalk.dim('  Run `agentxchain mission start --title "..." --goal "..."` to create one.'));
    return;
  }

  const header = [
    pad('#', 4),
    pad('Mission ID', 28),
    pad('Status', 18),
    pad('Chains', 8),
    pad('Runs', 7),
    pad('Turns', 7),
    pad('Decisions', 10),
    pad('Updated', 22),
    'Title',
  ].join(' ');

  console.log(chalk.bold(header));
  console.log(chalk.dim('─'.repeat(header.length)));

  missions.forEach((mission, index) => {
    console.log([
      pad(String(index + 1), 4),
      pad(mission.mission_id || '—', 28),
      pad(formatMissionStatus(mission.derived_status), 18),
      pad(String(mission.chain_count || 0), 8),
      pad(String(mission.total_runs || 0), 7),
      pad(String(mission.total_turns || 0), 7),
      pad(String(mission.active_repo_decisions_count || 0), 10),
      pad(formatTimestamp(mission.updated_at), 22),
      mission.title || '—',
    ].join(' '));
  });

  console.log(chalk.dim(`\n${missions.length} mission(s) shown`));
}

export async function missionShowCommand(missionId, opts) {
  const root = findProjectRoot(opts.dir || process.cwd());
  if (!root) {
    console.error(chalk.red('No AgentXchain project found. Run this inside a governed project.'));
    process.exit(1);
  }

  const snapshot = missionId
    ? loadMissionSnapshot(root, missionId)
    : loadLatestMissionSnapshot(root);
  if (!snapshot) {
    if (missionId) {
      console.error(chalk.red(`Mission not found: ${missionId}`));
      process.exit(1);
    }
    console.log(chalk.dim('No missions found.'));
    console.log(chalk.dim('  Run `agentxchain mission start --title "..." --goal "..."` to create one.'));
    return;
  }

  if (opts.json) {
    console.log(JSON.stringify(snapshot, null, 2));
    return;
  }

  renderMissionSnapshot(snapshot);
}

export async function missionAttachChainCommand(chainId, opts) {
  const root = findProjectRoot(opts.dir || process.cwd());
  if (!root) {
    console.error(chalk.red('No AgentXchain project found. Run this inside a governed project.'));
    process.exit(1);
  }

  const mission = opts.mission
    ? loadMissionArtifact(root, opts.mission)
    : loadLatestMissionArtifact(root);
  if (!mission) {
    console.error(chalk.red('No mission found to attach to.'));
    console.error(chalk.dim('  Use `agentxchain mission start --title "..." --goal "..."` first.'));
    process.exit(1);
  }

  const result = attachChainToMission(root, mission.mission_id, chainId || 'latest');
  if (!result.ok) {
    console.error(chalk.red(result.error));
    process.exit(1);
  }

  const snapshot = buildMissionSnapshot(root, result.mission);
  if (opts.json) {
    console.log(JSON.stringify(snapshot, null, 2));
    return;
  }

  console.log(chalk.green(`Attached ${result.chain.chain_id} to ${snapshot.mission_id}`));
  renderMissionSnapshot(snapshot);
}

// ── Mission Plan Commands ────────────────────────────────────────────────────

/**
 * agentxchain mission plan [mission_id|latest] — generate a decomposition plan.
 *
 * Uses LLM-assisted one-shot generation with schema validation.
 * Falls back to deterministic stub when no LLM is available (for testing).
 */
export async function missionPlanCommand(missionTarget, opts) {
  const root = findProjectRoot(opts.dir || process.cwd());
  if (!root) {
    console.error(chalk.red('No AgentXchain project found. Run this inside a governed project.'));
    process.exit(1);
  }

  // Resolve mission target
  const mission = missionTarget && missionTarget !== 'latest'
    ? loadMissionArtifact(root, missionTarget)
    : loadLatestMissionArtifact(root);

  if (!mission) {
    if (missionTarget && missionTarget !== 'latest') {
      console.error(chalk.red(`Mission not found: ${missionTarget}`));
    } else {
      console.error(chalk.red('No missions found.'));
      console.error(chalk.dim('  Run `agentxchain mission start --title "..." --goal "..."` first.'));
    }
    process.exit(1);
  }

  if (!mission.goal || !mission.goal.trim()) {
    console.error(chalk.red(`Mission "${mission.mission_id}" has no goal text. The planner cannot operate on missing mission intent.`));
    process.exit(1);
  }
  let plan;
  try {
    plan = await createMissionPlan(root, mission, opts);
  } catch (error) {
    renderMissionPlanError(error);
    process.exit(1);
  }

  if (opts.json) {
    console.log(JSON.stringify(plan, null, 2));
    return;
  }

  console.log(chalk.green(`Created plan ${plan.plan_id} for mission ${mission.mission_id}`));
  renderPlan(plan);
}

/**
 * agentxchain mission plan show [plan_id|latest] — show a decomposition plan.
 */
export async function missionPlanShowCommand(planTarget, opts) {
  const root = findProjectRoot(opts.dir || process.cwd());
  if (!root) {
    console.error(chalk.red('No AgentXchain project found. Run this inside a governed project.'));
    process.exit(1);
  }

  // Resolve mission context
  const mission = opts.mission
    ? loadMissionArtifact(root, opts.mission)
    : loadLatestMissionArtifact(root);

  if (!mission) {
    console.error(chalk.red('No mission found.'));
    console.error(chalk.dim('  Use --mission <id> or create a mission first.'));
    process.exit(1);
  }

  // Resolve plan target
  const plan = planTarget && planTarget !== 'latest'
    ? loadPlan(root, mission.mission_id, planTarget)
    : loadLatestPlan(root, mission.mission_id);

  if (!plan) {
    if (planTarget && planTarget !== 'latest') {
      console.error(chalk.red(`Plan not found: ${planTarget}`));
    } else {
      console.log(chalk.dim('No plans found for this mission.'));
      console.log(chalk.dim('  Run `agentxchain mission plan latest` to generate one.'));
    }
    return;
  }

  if (opts.json) {
    console.log(JSON.stringify(plan, null, 2));
    return;
  }

  renderPlan(plan);
}

/**
 * agentxchain mission plan list — list all plans for a mission.
 */
export async function missionPlanListCommand(opts) {
  const root = findProjectRoot(opts.dir || process.cwd());
  if (!root) {
    console.error(chalk.red('No AgentXchain project found. Run this inside a governed project.'));
    process.exit(1);
  }

  const mission = opts.mission
    ? loadMissionArtifact(root, opts.mission)
    : loadLatestMissionArtifact(root);

  if (!mission) {
    console.error(chalk.red('No mission found.'));
    process.exit(1);
  }

  const plans = loadAllPlans(root, mission.mission_id);
  const limit = opts.limit ? parseInt(opts.limit, 10) : 20;
  const limited = plans.slice(0, limit);

  if (opts.json) {
    console.log(JSON.stringify(limited, null, 2));
    return;
  }

  if (limited.length === 0) {
    console.log(chalk.dim('No plans found for this mission.'));
    console.log(chalk.dim('  Run `agentxchain mission plan latest` to generate one.'));
    return;
  }

  const header = [
    pad('#', 4),
    pad('Plan ID', 36),
    pad('Status', 12),
    pad('Workstreams', 12),
    pad('Supersedes', 36),
    pad('Created', 22),
  ].join(' ');

  console.log(chalk.bold(header));
  console.log(chalk.dim('─'.repeat(header.length)));

  limited.forEach((plan, i) => {
    console.log([
      pad(String(i + 1), 4),
      pad(plan.plan_id || '—', 36),
      pad(formatPlanStatus(plan.status), 12),
      pad(String(plan.workstreams?.length || 0), 12),
      pad(plan.supersedes_plan_id || '—', 36),
      pad(formatTimestamp(plan.created_at), 22),
    ].join(' '));
  });

  console.log(chalk.dim(`\n${limited.length} plan(s) shown`));
}

/**
 * agentxchain mission plan approve [plan_id|latest] — approve a decomposition plan.
 */
export async function missionPlanApproveCommand(planTarget, opts) {
  const root = findProjectRoot(opts.dir || process.cwd());
  if (!root) {
    console.error(chalk.red('No AgentXchain project found. Run this inside a governed project.'));
    process.exit(1);
  }

  const mission = opts.mission
    ? loadMissionArtifact(root, opts.mission)
    : loadLatestMissionArtifact(root);

  if (!mission) {
    console.error(chalk.red('No mission found.'));
    console.error(chalk.dim('  Use --mission <id> or create a mission first.'));
    process.exit(1);
  }

  const plan = planTarget && planTarget !== 'latest'
    ? loadPlan(root, mission.mission_id, planTarget)
    : loadLatestPlan(root, mission.mission_id);

  if (!plan) {
    if (planTarget && planTarget !== 'latest') {
      console.error(chalk.red(`Plan not found: ${planTarget}`));
    } else {
      console.error(chalk.red(`No plans found for mission ${mission.mission_id}.`));
      console.error(chalk.dim('  Run `agentxchain mission plan latest` to generate one.'));
    }
    process.exit(1);
  }

  const result = approvePlanArtifact(root, mission.mission_id, plan.plan_id);
  if (!result.ok) {
    console.error(chalk.red(result.error));
    process.exit(1);
  }

  console.log(chalk.green(`Approved plan ${result.plan.plan_id} for mission ${mission.mission_id}`));
  if (result.supersededPlanIds.length > 0) {
    console.log(chalk.dim(`  Superseded: ${result.supersededPlanIds.join(', ')}`));
  }
  renderPlan(result.plan);
}

/**
 * agentxchain mission plan launch [plan_id|latest] --workstream <id> — launch a workstream.
 *
 * Validates plan approval, workstream existence, dependency satisfaction.
 * Records launch_record with workstream_id → chain_id binding.
 */
export async function missionPlanLaunchCommand(planTarget, opts) {
  const context = loadProjectContext(opts.dir || process.cwd());
  if (!context) {
    console.error(chalk.red('No AgentXchain project found. Run this inside a governed project.'));
    process.exit(1);
  }
  const { root } = context;

  // Mutual exclusivity guard
  if (opts.allReady && opts.workstream) {
    console.error(chalk.red('--all-ready and --workstream are mutually exclusive. Use one or the other.'));
    process.exit(1);
  }

  if (opts.retry && !opts.workstream) {
    console.error(chalk.red('--retry requires --workstream <id>. Specify which failed workstream to retry.'));
    process.exit(1);
  }

  if (opts.retry && opts.allReady) {
    console.error(chalk.red('--retry and --all-ready are mutually exclusive. Retry targets a specific workstream.'));
    process.exit(1);
  }

  if (!opts.allReady && !opts.workstream) {
    console.error(chalk.red('--workstream <id> or --all-ready is required. Specify which workstream(s) to launch.'));
    process.exit(1);
  }

  // Dispatch to batch launch if --all-ready
  if (opts.allReady) {
    return missionPlanLaunchAllReady(planTarget, opts, context);
  }

  const mission = opts.mission
    ? loadMissionArtifact(root, opts.mission)
    : loadLatestMissionArtifact(root);

  if (!mission) {
    console.error(chalk.red('No mission found.'));
    console.error(chalk.dim('  Use --mission <id> or create a mission first.'));
    process.exit(1);
  }

  const plan = planTarget && planTarget !== 'latest'
    ? loadPlan(root, mission.mission_id, planTarget)
    : loadLatestPlan(root, mission.mission_id);

  if (!plan) {
    if (planTarget && planTarget !== 'latest') {
      console.error(chalk.red(`Plan not found: ${planTarget}`));
    } else {
      console.error(chalk.red(`No plans found for mission ${mission.mission_id}.`));
      console.error(chalk.dim('  Run `agentxchain mission plan latest` to generate one.'));
    }
    process.exit(1);
  }

  const launch = opts.retry
    ? retryWorkstream(root, mission.mission_id, plan.plan_id, opts.workstream)
    : launchWorkstream(root, mission.mission_id, plan.plan_id, opts.workstream);
  if (!launch.ok) {
    console.error(chalk.red(launch.error));
    process.exit(1);
  }

  const executor = opts._executeGovernedRun || executeGovernedRun;
  const logger = opts._log || console.log;
  const chainOpts = {
    enabled: true,
    maxChains: 0,
    chainOn: ['completed'],
    cooldownSeconds: 0,
    mission: mission.mission_id,
    chainId: launch.chainId,
  };
  const runOpts = {
    autoApprove: !!opts.autoApprove,
    provenance: {
      trigger: 'manual',
      created_by: 'operator',
      trigger_reason: `mission:${mission.mission_id} workstream:${opts.workstream}`,
    },
  };

  let execution;
  try {
    execution = await executeChainedRun(context, runOpts, chainOpts, executor, logger);
  } catch (error) {
    markWorkstreamOutcome(root, mission.mission_id, plan.plan_id, opts.workstream, {
      terminalReason: 'execution_error',
      completedAt: new Date().toISOString(),
    });
    console.error(chalk.red(`Workstream execution failed: ${error.message}`));
    process.exit(1);
  }

  const lastRun = execution?.chainReport?.runs?.[execution.chainReport.runs.length - 1] || null;
  const terminalReason = lastRun?.status === 'completed'
    ? 'completed'
    : (lastRun?.status || execution?.chainReport?.terminal_reason || 'execution_error');
  const outcome = markWorkstreamOutcome(root, mission.mission_id, plan.plan_id, opts.workstream, {
    terminalReason,
    completedAt: execution?.chainReport?.completed_at || new Date().toISOString(),
  });
  if (!outcome.ok) {
    console.error(chalk.red(outcome.error));
    process.exit(1);
  }

  if (opts.json) {
    console.log(JSON.stringify({
      workstream_id: opts.workstream,
      chain_id: launch.chainId,
      plan_id: launch.plan.plan_id,
      mission_id: mission.mission_id,
      launch_record: launch.launchRecord,
      exit_code: execution.exitCode,
      chain_terminal_reason: execution?.chainReport?.terminal_reason || null,
      workstream_status: outcome.workstream.launch_status,
    }, null, 2));
    if (execution.exitCode !== 0) {
      process.exit(execution.exitCode);
    }
    return;
  }

  console.log(chalk.green(`Executed workstream ${chalk.bold(opts.workstream)} → chain ${chalk.bold(launch.chainId)}`));
  console.log('');
  console.log(chalk.dim(`  Mission:   ${mission.mission_id}`));
  console.log(chalk.dim(`  Plan:      ${launch.plan.plan_id}`));
  console.log(chalk.dim(`  Chain ID:  ${launch.chainId}`));
  console.log(chalk.dim(`  Outcome:   ${outcome.workstream.launch_status}`));
  console.log('');
  renderPlan(outcome.plan);
  if (execution.exitCode !== 0) {
    console.error(chalk.red(`Workstream execution ended with exit code ${execution.exitCode}.`));
    process.exit(execution.exitCode);
  }
}

// ── Batch launch (--all-ready) ──────────────────────────────────────────────

async function missionPlanLaunchAllReady(planTarget, opts, context) {
  const { root } = context;

  const mission = opts.mission
    ? loadMissionArtifact(root, opts.mission)
    : loadLatestMissionArtifact(root);

  if (!mission) {
    console.error(chalk.red('No mission found.'));
    console.error(chalk.dim('  Use --mission <id> or create a mission first.'));
    process.exit(1);
  }

  const plan = planTarget && planTarget !== 'latest'
    ? loadPlan(root, mission.mission_id, planTarget)
    : loadLatestPlan(root, mission.mission_id);

  if (!plan) {
    if (planTarget && planTarget !== 'latest') {
      console.error(chalk.red(`Plan not found: ${planTarget}`));
    } else {
      console.error(chalk.red(`No plans found for mission ${mission.mission_id}.`));
      console.error(chalk.dim('  Run `agentxchain mission plan latest` to generate one.'));
    }
    process.exit(1);
  }

  if (plan.status !== 'approved') {
    console.error(chalk.red(`Plan ${plan.plan_id} is not approved (status: "${plan.status}"). Approve the plan before launching workstreams.`));
    process.exit(1);
  }

  const readyWorkstreams = getReadyWorkstreams(plan);
  if (readyWorkstreams.length === 0) {
    const summary = getWorkstreamStatusSummary(plan);
    const parts = Object.entries(summary).map(([status, count]) => `${count} ${status}`);
    console.error(chalk.red(`No ready workstreams to launch. Current distribution: ${parts.join(', ')}.`));
    process.exit(1);
  }

  const executor = opts._executeGovernedRun || executeGovernedRun;
  const logger = opts._log || console.log;
  const results = [];
  let hadFailure = false;

  if (!opts.json) {
    console.log(chalk.bold(`Launching ${readyWorkstreams.length} ready workstream(s) from plan ${plan.plan_id}...\n`));
  }

  for (let i = 0; i < readyWorkstreams.length; i++) {
    const ws = readyWorkstreams[i];
    const prefix = `[${i + 1}/${readyWorkstreams.length}]`;

    // Skip remaining if a prior workstream failed
    if (hadFailure) {
      results.push({
        workstream_id: ws.workstream_id,
        status: 'skipped',
        skip_reason: 'prior workstream failed',
      });
      if (!opts.json) {
        console.log(`${prefix} ${chalk.dim(ws.workstream_id)} — ${chalk.dim('skipped (prior workstream failed)')}`);
      }
      continue;
    }

    // Launch bookkeeping
    const launch = launchWorkstream(root, mission.mission_id, plan.plan_id, ws.workstream_id);
    if (!launch.ok) {
      hadFailure = true;
      results.push({
        workstream_id: ws.workstream_id,
        status: 'launch_error',
        error: launch.error,
      });
      if (!opts.json) {
        console.log(`${prefix} ${chalk.red(ws.workstream_id)} — launch error: ${launch.error}`);
      }
      continue;
    }

    if (!opts.json) {
      process.stdout.write(`${prefix} ${chalk.cyan(ws.workstream_id)} → ${launch.chainId} ... `);
    }

    // Execute
    const chainOpts = {
      enabled: true,
      maxChains: 0,
      chainOn: ['completed'],
      cooldownSeconds: 0,
      mission: mission.mission_id,
      chainId: launch.chainId,
    };
    const runOpts = {
      autoApprove: !!opts.autoApprove,
      provenance: {
        trigger: 'manual',
        created_by: 'operator',
        trigger_reason: `mission:${mission.mission_id} workstream:${ws.workstream_id} batch:all-ready`,
      },
    };

    let execution;
    try {
      execution = await executeChainedRun(context, runOpts, chainOpts, executor, logger);
    } catch (error) {
      markWorkstreamOutcome(root, mission.mission_id, plan.plan_id, ws.workstream_id, {
        terminalReason: 'execution_error',
        completedAt: new Date().toISOString(),
      });
      hadFailure = true;
      results.push({
        workstream_id: ws.workstream_id,
        chain_id: launch.chainId,
        status: 'needs_attention',
        error: error.message,
        exit_code: 1,
      });
      if (!opts.json) {
        console.log(chalk.red(`needs_attention ✗ (${error.message})`));
      }
      continue;
    }

    // Record outcome
    const lastRun = execution?.chainReport?.runs?.[execution.chainReport.runs.length - 1] || null;
    const terminalReason = lastRun?.status === 'completed'
      ? 'completed'
      : (lastRun?.status || execution?.chainReport?.terminal_reason || 'execution_error');

    markWorkstreamOutcome(root, mission.mission_id, plan.plan_id, ws.workstream_id, {
      terminalReason,
      completedAt: execution?.chainReport?.completed_at || new Date().toISOString(),
    });

    const wsStatus = terminalReason === 'completed' ? 'completed' : 'needs_attention';
    if (wsStatus === 'needs_attention') {
      hadFailure = true;
    }

    results.push({
      workstream_id: ws.workstream_id,
      chain_id: launch.chainId,
      status: wsStatus,
      exit_code: execution.exitCode || 0,
    });

    if (!opts.json) {
      if (wsStatus === 'completed') {
        console.log(chalk.green('completed ✓'));
      } else {
        console.log(chalk.red(`needs_attention ✗`));
      }
    }
  }

  // Summary
  const completed = results.filter((r) => r.status === 'completed').length;
  const failed = results.filter((r) => r.status === 'needs_attention' || r.status === 'launch_error').length;
  const skipped = results.filter((r) => r.status === 'skipped').length;

  if (opts.json) {
    console.log(JSON.stringify({
      plan_id: plan.plan_id,
      mission_id: mission.mission_id,
      results,
      summary: {
        total: results.length,
        completed,
        failed,
        skipped,
      },
    }, null, 2));
  } else {
    console.log('');
    console.log(chalk.bold(`Summary: ${completed} completed, ${failed} failed, ${skipped} skipped`));
    if (hadFailure) {
      console.log(chalk.dim('  Inspect plan state with `agentxchain mission plan show latest`'));
    }
  }

  if (hadFailure) {
    process.exit(1);
  }
}

// ── Plan rendering ───────────────────────────────────────────────────────────

function renderPlan(plan) {
  console.log(chalk.bold(`Plan: ${plan.plan_id}`));
  console.log('');
  console.log(`  Mission:      ${plan.mission_id}`);
  console.log(`  Status:       ${formatPlanStatus(plan.status)}`);
  console.log(`  Goal:         ${plan.input?.goal || '—'}`);
  console.log(`  Constraints:  ${plan.input?.constraints?.length ? plan.input.constraints.join('; ') : 'none'}`);
  console.log(`  Role hints:   ${plan.input?.role_hints?.length ? plan.input.role_hints.join(', ') : 'none'}`);
  console.log(`  Supersedes:   ${plan.supersedes_plan_id || '—'}`);
  if (plan.superseded_by_plan_id) {
    console.log(`  Superseded by:${plan.superseded_by_plan_id}`);
  }
  if (plan.approved_at) {
    console.log(`  Approved:     ${plan.approved_at}`);
  }
  console.log(`  Created:      ${plan.created_at || '—'}`);
  console.log('');

  if (!plan.workstreams || plan.workstreams.length === 0) {
    console.log(chalk.dim('  No workstreams.'));
    return;
  }

  const wsHeader = [
    pad('#', 4),
    pad('Workstream', 28),
    pad('Status', 10),
    pad('Roles', 20),
    pad('Phases', 24),
    pad('Depends On', 28),
    'Title',
  ].join(' ');

  console.log(chalk.bold('  Workstreams:'));
  console.log(`  ${chalk.dim(wsHeader)}`);
  console.log(`  ${chalk.dim('─'.repeat(wsHeader.length))}`);

  plan.workstreams.forEach((ws, i) => {
    const deps = Array.isArray(ws.depends_on) && ws.depends_on.length > 0
      ? ws.depends_on.join(', ')
      : '—';

    console.log(`  ${[
      pad(String(i + 1), 4),
      pad(ws.workstream_id || '—', 28),
      pad(formatLaunchStatus(ws.launch_status), 10),
      pad((ws.roles || []).join(', '), 20),
      pad((ws.phases || []).join(', '), 24),
      pad(deps, 28),
      ws.title || '—',
    ].join(' ')}`);
  });

  if (plan.launch_records?.length) {
    console.log('');
    console.log(chalk.bold('  Launch records:'));
    for (const rec of plan.launch_records) {
      const statusTag = rec.status === 'completed' ? chalk.green('completed')
        : rec.status === 'failed' ? chalk.red('failed')
        : chalk.cyan('launched');
      console.log(`    ${chalk.cyan(rec.workstream_id)} → ${rec.chain_id} [${statusTag}]`);
    }
  }

  if (plan.workstreams.some((ws) => ws.acceptance_checks?.length)) {
    console.log('');
    console.log(chalk.bold('  Acceptance checks:'));
    plan.workstreams.forEach((ws) => {
      if (ws.acceptance_checks?.length) {
        console.log(`    ${chalk.cyan(ws.workstream_id)}:`);
        ws.acceptance_checks.forEach((check) => {
          console.log(`      • ${check}`);
        });
      }
    });
  }
}

function formatPlanStatus(status) {
  if (!status) return '—';
  switch (status) {
    case 'proposed': return chalk.blue('proposed');
    case 'approved': return chalk.green('approved');
    case 'superseded': return chalk.dim('superseded');
    case 'needs_attention': return chalk.yellow('needs_attention');
    case 'completed': return chalk.green('completed');
    default: return status;
  }
}

function formatLaunchStatus(status) {
  if (!status) return '—';
  switch (status) {
    case 'ready': return chalk.green('ready');
    case 'blocked': return chalk.yellow('blocked');
    case 'launched': return chalk.cyan('launched');
    case 'completed': return chalk.green('completed');
    case 'needs_attention': return chalk.red('attention');
    default: return status;
  }
}

// ── LLM planner call ─────────────────────────────────────────────────────────

async function callPlannerLLM(config, systemPrompt, userPrompt) {
  const url = `${config.base_url.replace(/\/$/, '')}/chat/completions`;
  const headers = { 'Content-Type': 'application/json' };
  if (config.api_key) {
    headers['Authorization'] = `Bearer ${config.api_key}`;
  }

  const body = {
    model: config.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.3,
    max_tokens: 4096,
  };

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`LLM API returned ${response.status}: ${text.slice(0, 200)}`);
  }

  const json = await response.json();
  const content = json?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('LLM API returned no content in response.');
  }

  return content;
}

async function createMissionPlan(root, mission, opts = {}) {
  const { constraints, roleHints } = normalizePlannerOptions(opts);
  const plannerOutput = await resolvePlannerOutput(root, mission, constraints, roleHints, opts);
  const result = createPlanArtifact(root, mission, {
    constraints,
    roleHints,
    plannerOutput,
  });

  if (!result.ok) {
    const error = new Error('Plan validation failed.');
    error.validationErrors = result.errors;
    throw error;
  }

  return result.plan;
}

function normalizePlannerOptions(opts = {}) {
  return {
    constraints: Array.isArray(opts.constraint) ? opts.constraint : (opts.constraint ? [opts.constraint] : []),
    roleHints: Array.isArray(opts.roleHint) ? opts.roleHint : (opts.roleHint ? [opts.roleHint] : []),
  };
}

async function resolvePlannerOutput(root, mission, constraints, roleHints, opts = {}) {
  const { systemPrompt, userPrompt } = buildPlannerPrompt(mission, constraints, roleHints);

  if (opts._plannerOutput) {
    return opts._plannerOutput;
  }

  if (opts.plannerOutputFile) {
    const plannerOutputPath = resolve(opts.plannerOutputFile);
    let raw;
    try {
      raw = readFileSync(plannerOutputPath, 'utf8');
    } catch (error) {
      throw new Error(`Planner output file read error: ${error.message}`);
    }

    const parsed = parsePlannerResponse(raw);
    if (!parsed.ok) {
      throw new Error(`Planner output file parse error: ${parsed.error}`);
    }
    return parsed.data;
  }

  const { loadConfig } = await import('../lib/config.js');
  const config = loadConfig(root);
  const plannerConfig = config?.mission_planner || config?.api_proxy;

  if (!plannerConfig || !plannerConfig.base_url || !plannerConfig.model) {
    throw new Error('No mission planner or api_proxy configured.\n  Add "mission_planner" or "api_proxy" to agentxchain.json with base_url and model.\n  Or pass planner output via --planner-output-file <path> for offline use.');
  }

  const response = await callPlannerLLM(plannerConfig, systemPrompt, userPrompt);
  const parsed = parsePlannerResponse(response);
  if (!parsed.ok) {
    throw new Error(`Planner response parse error: ${parsed.error}`);
  }
  return parsed.data;
}

function renderMissionPlanError(error) {
  const message = error?.message || 'Mission planning failed.';
  const [firstLine, ...rest] = String(message).split('\n');
  console.error(chalk.red(firstLine));
  for (const line of rest) {
    console.error(chalk.dim(line));
  }
  if (Array.isArray(error?.validationErrors) && error.validationErrors.length > 0) {
    for (const validationError of error.validationErrors) {
      console.error(chalk.red(`  • ${validationError}`));
    }
  }
}

function renderMissionSnapshot(snapshot) {
  console.log(chalk.bold(`Mission: ${snapshot.mission_id}`));
  console.log('');
  console.log(`  Title:                 ${snapshot.title || '—'}`);
  console.log(`  Goal:                  ${snapshot.goal || '—'}`);
  console.log(`  Status:                ${formatMissionStatus(snapshot.derived_status)}`);
  console.log(`  Chains:                ${snapshot.chain_count || 0}`);
  console.log(`  Total runs:            ${snapshot.total_runs || 0}`);
  console.log(`  Total turns:           ${snapshot.total_turns || 0}`);
  console.log(`  Active repo decisions: ${snapshot.active_repo_decisions_count || 0}`);
  console.log(`  Latest chain:          ${snapshot.latest_chain_id || '—'}`);
  console.log(`  Latest terminal:       ${snapshot.latest_terminal_reason || '—'}`);
  console.log(`  Created:               ${snapshot.created_at || '—'}`);
  console.log(`  Updated:               ${snapshot.updated_at || '—'}`);

  if (snapshot.missing_chain_ids?.length) {
    console.log(`  Missing chains:        ${snapshot.missing_chain_ids.join(', ')}`);
  }

  if (!snapshot.chains || snapshot.chains.length === 0) {
    console.log('');
    console.log(chalk.dim('  No chains attached.'));
    console.log(chalk.dim('  Use `agentxchain mission attach-chain latest` after a chained run.'));
    return;
  }

  const header = [
    pad('#', 4),
    pad('Chain ID', 16),
    pad('Runs', 6),
    pad('Turns', 7),
    pad('Terminal', 26),
    pad('Started', 22),
  ].join(' ');

  console.log('');
  console.log(chalk.bold('  Chains:'));
  console.log(`  ${chalk.dim(header)}`);
  console.log(`  ${chalk.dim('─'.repeat(header.length))}`);

  snapshot.chains.forEach((chain, index) => {
    console.log(`  ${[
      pad(String(index + 1), 4),
      pad(chain.chain_id || '—', 16),
      pad(String(chain.runs?.length || 0), 6),
      pad(String(chain.total_turns || 0), 7),
      pad(formatTerminal(chain.terminal_reason), 26),
      pad(formatTimestamp(chain.started_at), 22),
    ].join(' ')}`);
  });
}

function formatTerminal(reason) {
  if (!reason) return '—';
  if (reason === 'chain_limit_reached') return 'chain limit reached';
  if (reason === 'non_chainable_status') return 'non-chainable status';
  return reason.replace(/_/g, ' ');
}

function formatMissionStatus(status) {
  if (!status) return '—';
  switch (status) {
    case 'planned':
      return chalk.blue('planned');
    case 'progressing':
      return chalk.green('progressing');
    case 'needs_attention':
      return chalk.yellow('needs_attention');
    case 'degraded':
      return chalk.red('degraded');
    default:
      return status;
  }
}

function formatTimestamp(value) {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function pad(value, width) {
  return String(value).padEnd(width);
}
