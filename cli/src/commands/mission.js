import chalk from 'chalk';
import { readFileSync } from 'fs';
import { join, resolve } from 'path';
import { findProjectRoot, loadProjectContext } from '../lib/config.js';
import {
  attachChainToMission,
  bindCoordinatorToMission,
  buildMissionListSummary,
  buildMissionSnapshot,
  createMission,
  loadLatestMissionArtifact,
  loadLatestMissionSnapshot,
  loadMissionArtifact,
  loadMissionSnapshot,
} from '../lib/missions.js';
import { loadCoordinatorConfig } from '../lib/coordinator-config.js';
import { initializeCoordinatorRun } from '../lib/coordinator-state.js';
import {
  approvePlanArtifact,
  createPlanArtifact,
  getReadyWorkstreams,
  getWorkstreamStatusSummary,
  launchCoordinatorWorkstream,
  launchWorkstream,
  retryCoordinatorWorkstream,
  retryWorkstream,
  markWorkstreamOutcome,
  loadAllPlans,
  loadLatestPlan,
  loadPlan,
  buildPlannerPrompt,
  parsePlannerResponse,
  synchronizeCoordinatorPlanState,
  validatePlannerOutput,
} from '../lib/mission-plans.js';
import { executeChainedRun } from '../lib/run-chain.js';
import { executeGovernedRun } from './run.js';
import { dispatchCoordinatorTurn, selectAssignmentForWorkstream } from '../lib/coordinator-dispatch.js';
import { loadCoordinatorState } from '../lib/coordinator-state.js';
import { projectRepoAcceptance } from '../lib/coordinator-acceptance.js';

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

  // Multi-repo: validate coordinator config before creating mission (fail-fast)
  let coordinatorConfig = null;
  let coordinatorWorkspacePath = null;
  if (opts.multi) {
    coordinatorWorkspacePath = resolve(opts.coordinatorWorkspace || opts.coordinatorConfig || root);
    coordinatorConfig = loadCoordinatorConfig(coordinatorWorkspacePath);
    if (!coordinatorConfig.ok) {
      console.error(chalk.red('Coordinator config validation failed:'));
      console.error(chalk.dim(`  Expected agentxchain-multi.json at: ${coordinatorWorkspacePath}`));
      for (const err of coordinatorConfig.errors || []) {
        console.error(chalk.red(`  ${err}`));
      }
      process.exit(1);
    }
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

  // Multi-repo: initialize coordinator and bind to mission
  if (opts.multi && coordinatorConfig) {
    const initResult = initializeCoordinatorRun(coordinatorWorkspacePath, coordinatorConfig.config);
    if (!initResult.ok) {
      // Atomic rollback: delete the mission artifact
      const { getMissionsDir } = await import('../lib/missions.js');
      const { unlinkSync, existsSync: fileExists } = await import('fs');
      const { join: joinPath } = await import('path');
      const missionFile = joinPath(getMissionsDir(root), `${result.mission.mission_id}.json`);
      if (fileExists(missionFile)) {
        try { unlinkSync(missionFile); } catch { /* best effort */ }
      }
      console.error(chalk.red('Coordinator initialization failed:'));
      for (const err of initResult.errors || []) {
        console.error(chalk.red(`  ${err}`));
      }
      process.exit(1);
    }

    const bindResult = bindCoordinatorToMission(root, result.mission.mission_id, {
      super_run_id: initResult.super_run_id,
      config_path: opts.coordinatorConfig || null,
      workspace_path: coordinatorWorkspacePath,
    });
    if (!bindResult.ok) {
      console.error(chalk.yellow(`Mission created but coordinator binding failed: ${bindResult.error}`));
    } else {
      result.mission = bindResult.mission;
    }
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

function loadAcceptedRepoTurn(repoPath, turnId) {
  try {
    const historyPath = join(repoPath, '.agentxchain', 'history.jsonl');
    const content = readFileSync(historyPath, 'utf8').trim();
    if (!content) return null;
    const entries = content
      .split('\n')
      .map((line) => JSON.parse(line))
      .filter((entry) => entry?.turn_id === turnId)
      .filter((entry) => Boolean(entry?.accepted_at) || entry?.status === 'accepted' || entry?.status === 'completed');
    return entries.at(-1) || null;
  } catch {
    return null;
  }
}

function projectAcceptedCoordinatorTurn(workspacePath, coordinatorConfig, repoId, turnId, workstreamId, fallbackState) {
  const acceptedTurn = loadAcceptedRepoTurn(coordinatorConfig.repos?.[repoId]?.resolved_path, turnId);
  if (!acceptedTurn) {
    return { ok: false, error: `Accepted turn ${turnId} not found in repo-local history for ${repoId}.` };
  }

  const currentState = loadCoordinatorState(workspacePath) || fallbackState;
  if (!currentState) {
    return { ok: false, error: `Coordinator state not found at ${workspacePath}.` };
  }

  return projectRepoAcceptance(
    workspacePath,
    currentState,
    coordinatorConfig,
    repoId,
    acceptedTurn,
    workstreamId,
  );
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
  let plan = planTarget && planTarget !== 'latest'
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

  if (mission.coordinator && plan.coordinator_scope) {
    const synced = synchronizeCoordinatorPlanState(root, mission, plan);
    if (!synced.ok) {
      console.error(chalk.red(synced.error));
      process.exit(1);
    }
    plan = synced.plan;
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

  let plan = planTarget && planTarget !== 'latest'
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

  if (mission.coordinator && plan.coordinator_scope) {
    const synced = synchronizeCoordinatorPlanState(root, mission, plan);
    if (!synced.ok) {
      console.error(chalk.red(synced.error));
      process.exit(1);
    }
    plan = synced.plan;
  }

  if (mission.coordinator && plan.coordinator_scope) {
    const coordinatorConfigResult = loadCoordinatorConfig(mission.coordinator.workspace_path);
    if (!coordinatorConfigResult.ok) {
      console.error(chalk.red('Coordinator config validation failed:'));
      for (const err of coordinatorConfigResult.errors || []) {
        console.error(chalk.red(`  ${err}`));
      }
      process.exit(1);
    }

    const coordinatorState = loadCoordinatorState(mission.coordinator.workspace_path);
    if (!coordinatorState) {
      console.error(chalk.red(`Coordinator state not found at ${mission.coordinator.workspace_path}.`));
      process.exit(1);
    }
    if (coordinatorState.status !== 'active') {
      console.error(chalk.red(`Coordinator run ${coordinatorState.super_run_id} is not active (status: "${coordinatorState.status}").`));
      process.exit(1);
    }

    if (opts.retry) {
      const retry = retryCoordinatorWorkstream(
        root,
        mission,
        plan.plan_id,
        opts.workstream,
        coordinatorConfigResult.config,
        {
          reason: `mission plan retry ${opts.workstream}`,
        },
      );
      if (!retry.ok) {
        console.error(chalk.red(retry.error));
        process.exit(1);
      }

      const executor = opts._executeGovernedRun || executeGovernedRun;
      const childLog = opts.json ? noop : (opts._log || console.log);
      const repoContext = loadProjectContext(retry.retryResult.repo_path);
      if (!repoContext) {
        console.error(chalk.red(`Cannot load project context for retried repo at ${retry.retryResult.repo_path}.`));
        process.exit(1);
      }

      const runOpts = {
        autoApprove: !!opts.autoApprove,
        log: childLog,
        provenance: {
          trigger: 'manual',
          created_by: 'operator',
          trigger_reason: `mission:${mission.mission_id} workstream:${opts.workstream} coordinator-retry:${retry.retryResult.repo_id}`,
        },
      };

      let execution;
      try {
        execution = await executor(repoContext, runOpts);
      } catch (error) {
        const syncedRetryFailure = synchronizeCoordinatorPlanState(root, mission, retry.plan);
        console.error(chalk.red(`Coordinator retry execution failed: ${error.message}`));
        if (opts.json) {
          console.log(JSON.stringify({
            dispatch_mode: 'coordinator',
            retry: true,
            mission_id: mission.mission_id,
            plan_id: retry.plan.plan_id,
            workstream_id: opts.workstream,
            repo_id: retry.retryResult.repo_id,
            retried_repo_turn_id: retry.retryResult.failed_turn_id,
            repo_turn_id: retry.retryResult.reissued_turn_id,
            workstream_status: syncedRetryFailure.ok
              ? syncedRetryFailure.plan.workstreams.find((ws) => ws.workstream_id === opts.workstream)?.launch_status || 'needs_attention'
              : 'needs_attention',
            launch_record: retry.launchRecord,
            error: error.message,
          }, null, 2));
        }
        process.exit(1);
      }

      if ((execution?.exitCode ?? 0) === 0) {
        const projection = projectAcceptedCoordinatorTurn(
          mission.coordinator.workspace_path,
          coordinatorConfigResult.config,
          retry.retryResult.repo_id,
          retry.retryResult.reissued_turn_id,
          opts.workstream,
          loadCoordinatorState(mission.coordinator.workspace_path),
        );
        if (!projection.ok) {
          console.error(chalk.red(`Coordinator retry projection failed: ${projection.error}`));
          process.exit(1);
        }
      }

      const syncedRetry = synchronizeCoordinatorPlanState(root, mission, retry.plan);
      const retriedPlan = syncedRetry.ok ? syncedRetry.plan : retry.plan;
      const retriedWorkstream = retriedPlan.workstreams.find((ws) => ws.workstream_id === opts.workstream);
      const retriedLaunchRecord = retriedPlan.launch_records.find(
        (record) => record.workstream_id === opts.workstream && record.dispatch_mode === 'coordinator',
      ) || retry.launchRecord;

      if (opts.json) {
        console.log(JSON.stringify({
          dispatch_mode: 'coordinator',
          retry: true,
          mission_id: mission.mission_id,
          plan_id: retriedPlan.plan_id,
          workstream_id: opts.workstream,
          super_run_id: mission.coordinator.super_run_id,
          repo_id: retry.retryResult.repo_id,
          retried_repo_turn_id: retry.retryResult.failed_turn_id,
          repo_turn_id: retry.retryResult.reissued_turn_id,
          role: retry.retryResult.role,
          bundle_path: retry.retryResult.bundle_path,
          context_ref: retry.retryResult.context_ref,
          workstream_status: retriedWorkstream?.launch_status || 'launched',
          launch_record: retriedLaunchRecord,
          exit_code: execution?.exitCode ?? 0,
        }, null, 2));
        if ((execution?.exitCode ?? 0) !== 0) {
          process.exit(execution.exitCode);
        }
        return;
      }

      console.log(chalk.green(`Retried coordinator workstream ${chalk.bold(opts.workstream)} in ${chalk.bold(retry.retryResult.repo_id)}`));
      console.log('');
      console.log(chalk.dim(`  Mission:      ${mission.mission_id}`));
      console.log(chalk.dim(`  Plan:         ${retriedPlan.plan_id}`));
      console.log(chalk.dim(`  Super Run:    ${mission.coordinator.super_run_id}`));
      console.log(chalk.dim(`  Repo:         ${retry.retryResult.repo_id}`));
      console.log(chalk.dim(`  Old Turn:     ${retry.retryResult.failed_turn_id}`));
      console.log(chalk.dim(`  New Turn:     ${retry.retryResult.reissued_turn_id}`));
      console.log(chalk.dim(`  Workstream:   ${retriedWorkstream?.launch_status || 'launched'}`));
      console.log('');
      renderPlan(retriedPlan);
      if ((execution?.exitCode ?? 0) !== 0) {
        console.error(chalk.red(`Coordinator retry execution ended with exit code ${execution.exitCode}.`));
        process.exit(execution.exitCode);
      }
      return;
    }

    const assignment = selectAssignmentForWorkstream(
      mission.coordinator.workspace_path,
      coordinatorState,
      coordinatorConfigResult.config,
      opts.workstream,
    );
    if (!assignment.ok) {
      console.error(chalk.red(`Coordinator launch blocked: ${assignment.detail || assignment.reason}`));
      process.exit(1);
    }

    const dispatch = dispatchCoordinatorTurn(
      mission.coordinator.workspace_path,
      coordinatorState,
      coordinatorConfigResult.config,
      assignment,
    );
    if (!dispatch.ok) {
      console.error(chalk.red(`Coordinator dispatch failed: ${dispatch.error}`));
      process.exit(1);
    }

    const launch = launchCoordinatorWorkstream(
      root,
      mission,
      plan.plan_id,
      opts.workstream,
      {
        ...dispatch,
        role: assignment.role,
      },
      coordinatorConfigResult.config,
    );
    if (!launch.ok) {
      console.error(chalk.red(launch.error));
      process.exit(1);
    }

    const syncedWorkstream = launch.plan.workstreams.find((ws) => ws.workstream_id === opts.workstream);
    const jsonPayload = {
      dispatch_mode: 'coordinator',
      mission_id: mission.mission_id,
      plan_id: launch.plan.plan_id,
      workstream_id: opts.workstream,
      super_run_id: mission.coordinator.super_run_id,
      repo_id: dispatch.repo_id,
      repo_turn_id: dispatch.turn_id,
      role: assignment.role,
      bundle_path: dispatch.bundle_path,
      context_ref: dispatch.context_ref || null,
      workstream_status: syncedWorkstream?.launch_status || 'launched',
      launch_record: launch.launchRecord,
    };

    if (opts.json) {
      console.log(JSON.stringify(jsonPayload, null, 2));
      return;
    }

    console.log(chalk.green(`Dispatched coordinator workstream ${chalk.bold(opts.workstream)} to ${chalk.bold(dispatch.repo_id)}`));
    console.log('');
    console.log(chalk.dim(`  Mission:      ${mission.mission_id}`));
    console.log(chalk.dim(`  Plan:         ${launch.plan.plan_id}`));
    console.log(chalk.dim(`  Super Run:    ${mission.coordinator.super_run_id}`));
    console.log(chalk.dim(`  Repo:         ${dispatch.repo_id}`));
    console.log(chalk.dim(`  Repo Turn:    ${dispatch.turn_id}`));
    console.log(chalk.dim(`  Role:         ${assignment.role}`));
    console.log(chalk.dim(`  Workstream:   ${syncedWorkstream?.launch_status || 'launched'}`));
    console.log('');
    renderPlan(launch.plan);
    return;
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

  if (mission.coordinator) {
    return coordinatorLaunchAllReady(planTarget, opts, context, mission);
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

// ── Autopilot (unattended wave execution) ───────────────────────────────────

export async function missionPlanAutopilotCommand(planTarget, opts) {
  const context = loadProjectContext(opts.dir || process.cwd());
  if (!context) {
    console.error(chalk.red('No AgentXchain project found. Run this inside a governed project.'));
    process.exit(1);
  }
  const { root } = context;

  const mission = opts.mission
    ? loadMissionArtifact(root, opts.mission)
    : loadLatestMissionArtifact(root);

  if (!mission) {
    console.error(chalk.red('No mission found.'));
    console.error(chalk.dim('  Use --mission <id> or create a mission first.'));
    process.exit(1);
  }

  if (mission.coordinator) {
    return coordinatorAutopilot(planTarget, opts, context, mission);
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

  const continueOnFailure = !!opts.continueOnFailure;

  if (plan.status === 'completed') {
    if (opts.json) {
      console.log(JSON.stringify({
        plan_id: plan.plan_id,
        mission_id: mission.mission_id,
        waves: [],
        summary: { total_waves: 0, total_launched: 0, completed: 0, failed: 0, terminal_reason: 'plan_completed' },
      }, null, 2));
    } else {
      console.log(chalk.green(`Plan ${plan.plan_id} is already completed. Nothing to do.`));
    }
    return;
  }

  if (plan.status !== 'approved' && !(plan.status === 'needs_attention' && continueOnFailure)) {
    console.error(chalk.red(`Plan ${plan.plan_id} status is "${plan.status}". Autopilot requires an approved plan${continueOnFailure ? ' (or needs_attention with --continue-on-failure)' : ''}.`));
    process.exit(1);
  }

  const maxWaves = Math.max(1, parseInt(opts.maxWaves, 10) || 10);
  const cooldownSeconds = Math.max(0, parseInt(opts.cooldown, 10) || 5);
  const executor = opts._executeGovernedRun || executeGovernedRun;
  const logger = opts._log || console.log;
  const sleep = opts._sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));

  const waves = [];
  let totalLaunched = 0;
  let totalCompleted = 0;
  let totalFailed = 0;
  let terminalReason = null;
  let interrupted = false;

  // SIGINT handler
  const onSigint = () => { interrupted = true; };
  process.on('SIGINT', onSigint);

  try {
    for (let waveNum = 1; waveNum <= maxWaves; waveNum++) {
      if (interrupted) {
        terminalReason = 'interrupted';
        break;
      }

      // Reload plan from disk to pick up outcomes from previous waves
      const currentPlan = loadPlan(root, mission.mission_id, plan.plan_id);
      if (!currentPlan) {
        terminalReason = 'plan_read_error';
        break;
      }

      if (currentPlan.status === 'completed') {
        terminalReason = 'plan_completed';
        break;
      }

      const readyWorkstreams = getReadyWorkstreams(currentPlan);
      if (readyWorkstreams.length === 0) {
        terminalReason = deriveAutopilotIdleOutcome(currentPlan, continueOnFailure);
        break;
      }

      if (!opts.json) {
        console.log(chalk.bold(`\n━━━ Wave ${waveNum} — launching ${readyWorkstreams.length} workstream(s) ━━━\n`));
      }

      const waveResults = [];
      let waveHadFailure = false;

      for (let i = 0; i < readyWorkstreams.length; i++) {
        if (interrupted) break;

        const ws = readyWorkstreams[i];
        const prefix = `[${i + 1}/${readyWorkstreams.length}]`;

        // Skip remaining in wave if failure and not continue-on-failure
        if (waveHadFailure && !continueOnFailure) {
          waveResults.push({ workstream_id: ws.workstream_id, status: 'skipped', skip_reason: 'prior workstream failed' });
          if (!opts.json) {
            console.log(`${prefix} ${chalk.dim(ws.workstream_id)} — ${chalk.dim('skipped (prior workstream failed)')}`);
          }
          continue;
        }

        const launch = launchWorkstream(root, mission.mission_id, plan.plan_id, ws.workstream_id, {
          allowNeedsAttention: continueOnFailure,
        });
        if (!launch.ok) {
          waveHadFailure = true;
          totalFailed++;
          waveResults.push({ workstream_id: ws.workstream_id, status: 'launch_error', error: launch.error });
          if (!opts.json) {
            console.log(`${prefix} ${chalk.red(ws.workstream_id)} — launch error: ${launch.error}`);
          }
          continue;
        }

        totalLaunched++;
        if (!opts.json) {
          process.stdout.write(`${prefix} ${chalk.cyan(ws.workstream_id)} → ${launch.chainId} ... `);
        }

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
            trigger: 'autopilot',
            created_by: 'operator',
            trigger_reason: `mission:${mission.mission_id} workstream:${ws.workstream_id} autopilot:wave-${waveNum}`,
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
          waveHadFailure = true;
          totalFailed++;
          waveResults.push({ workstream_id: ws.workstream_id, chain_id: launch.chainId, status: 'needs_attention', error: error.message });
          if (!opts.json) {
            console.log(chalk.red(`needs_attention ✗ (${error.message})`));
          }
          continue;
        }

        const lastRun = execution?.chainReport?.runs?.[execution.chainReport.runs.length - 1] || null;
        const wsTerminalReason = lastRun?.status === 'completed'
          ? 'completed'
          : (lastRun?.status || execution?.chainReport?.terminal_reason || 'execution_error');

        markWorkstreamOutcome(root, mission.mission_id, plan.plan_id, ws.workstream_id, {
          terminalReason: wsTerminalReason,
          completedAt: execution?.chainReport?.completed_at || new Date().toISOString(),
        });

        const wsStatus = wsTerminalReason === 'completed' ? 'completed' : 'needs_attention';
        if (wsStatus === 'completed') {
          totalCompleted++;
        } else {
          totalFailed++;
          waveHadFailure = true;
        }

        waveResults.push({ workstream_id: ws.workstream_id, chain_id: launch.chainId, status: wsStatus });

        if (!opts.json) {
          if (wsStatus === 'completed') {
            console.log(chalk.green('completed ✓'));
          } else {
            console.log(chalk.red('needs_attention ✗'));
          }
        }
      }

      waves.push({ wave: waveNum, launched: waveResults.filter((r) => r.chain_id).map((r) => r.workstream_id), results: waveResults });

      if (interrupted) {
        terminalReason = 'interrupted';
        break;
      }

      // Check if plan is now complete after this wave
      const afterWavePlan = loadPlan(root, mission.mission_id, plan.plan_id);
      if (afterWavePlan?.status === 'completed') {
        terminalReason = 'plan_completed';
        break;
      }

      const remainingReadyWorkstreams = getReadyWorkstreams(afterWavePlan);
      if (remainingReadyWorkstreams.length === 0) {
        terminalReason = deriveAutopilotIdleOutcome(afterWavePlan, continueOnFailure);
        break;
      }

      if (waveHadFailure && !continueOnFailure) {
        terminalReason = 'failure_stopped';
        break;
      }

      if (waveNum === maxWaves) {
        terminalReason = 'wave_limit_reached';
        break;
      }

      // Cooldown between waves
      if (cooldownSeconds > 0 && !interrupted) {
        if (!opts.json) {
          console.log(chalk.dim(`\nCooldown: ${cooldownSeconds}s before next wave...\n`));
        }
        await sleep(cooldownSeconds * 1000);
      }
    }
  } finally {
    process.removeListener('SIGINT', onSigint);
  }

  if (!terminalReason) {
    terminalReason = totalFailed > 0
      ? (continueOnFailure ? 'plan_incomplete' : 'failure_stopped')
      : 'plan_completed';
  }

  const jsonOutput = {
    plan_id: plan.plan_id,
    mission_id: mission.mission_id,
    waves,
    summary: {
      total_waves: waves.length,
      total_launched: totalLaunched,
      completed: totalCompleted,
      failed: totalFailed,
      terminal_reason: terminalReason,
    },
  };

  if (opts.json) {
    console.log(JSON.stringify(jsonOutput, null, 2));
  } else {
    console.log('');
    console.log(chalk.bold('━━━ Autopilot Summary ━━━'));
    console.log(`  Waves:      ${waves.length}`);
    console.log(`  Launched:   ${totalLaunched}`);
    console.log(`  Completed:  ${totalCompleted}`);
    console.log(`  Failed:     ${totalFailed}`);
    console.log(`  Outcome:    ${formatTerminalReason(terminalReason)}`);
    if (terminalReason === 'plan_completed') {
      console.log(chalk.green('\n  Plan completed successfully.'));
    } else if (terminalReason === 'deadlock') {
      console.log(chalk.red('\n  Deadlock: remaining workstreams are blocked with unsatisfiable dependencies.'));
      console.log(chalk.dim('  Inspect with `agentxchain mission plan show latest`.'));
    } else if (terminalReason === 'wave_limit_reached') {
      console.log(chalk.yellow(`\n  Wave limit reached. Run autopilot again to continue.`));
    } else if (terminalReason === 'failure_stopped') {
      console.log(chalk.red('\n  Stopped due to workstream failure.'));
      console.log(chalk.dim('  Use --continue-on-failure to skip failures, or retry with `mission plan launch --workstream <id> --retry`.'));
    } else if (terminalReason === 'plan_incomplete') {
      console.log(chalk.yellow('\n  Autopilot exhausted all launchable work, but failed workstreams still need attention.'));
      console.log(chalk.dim('  Retry the failed workstream or inspect the plan before running autopilot again.'));
    } else if (terminalReason === 'interrupted') {
      console.log(chalk.yellow('\n  Interrupted by operator.'));
    }
  }

  if (terminalReason !== 'plan_completed') {
    process.exit(1);
  }
}

function formatTerminalReason(reason) {
  switch (reason) {
    case 'plan_completed': return chalk.green('plan completed');
    case 'failure_stopped': return chalk.red('stopped on failure');
    case 'plan_incomplete': return chalk.yellow('incomplete after failures');
    case 'deadlock': return chalk.red('deadlock');
    case 'wave_limit_reached': return chalk.yellow('wave limit reached');
    case 'interrupted': return chalk.yellow('interrupted');
    case 'no_ready_workstreams': return chalk.yellow('no ready workstreams');
    default: return reason || '—';
  }
}

function deriveAutopilotIdleOutcome(plan, continueOnFailure) {
  const summary = getWorkstreamStatusSummary(plan);
  const allCompleted = plan.workstreams.every((ws) => ws.launch_status === 'completed');
  if (allCompleted) {
    return 'plan_completed';
  }

  const hasNeedsAttention = (summary.needs_attention || 0) > 0;
  const hasBlocked = (summary.blocked || 0) > 0;
  const hasLaunched = (summary.launched || 0) > 0;

  if (hasNeedsAttention) {
    return continueOnFailure ? 'plan_incomplete' : 'failure_stopped';
  }
  if (hasBlocked && !hasLaunched) {
    return 'deadlock';
  }
  return 'no_ready_workstreams';
}

function getCoordinatorWaveWorkstreams(plan) {
  if (!plan || !Array.isArray(plan.workstreams)) {
    return [];
  }

  return plan.workstreams.filter((ws) => {
    if (ws.launch_status === 'ready') {
      return true;
    }

    if (ws.launch_status !== 'launched') {
      return false;
    }

    const progress = ws.coordinator_progress;
    if (!progress || !Array.isArray(progress.pending_repo_ids) || progress.pending_repo_ids.length === 0) {
      return false;
    }

    if ((progress.repo_failure_count || 0) > 0) {
      return false;
    }

    return true;
  });
}

// ── Coordinator wave execution ──────────────────────────────────────────────

/**
 * Dispatch a single coordinator workstream, execute the repo-local turn,
 * and synchronize plan state. Returns { ok, status, repo_id, turn_id, error }.
 */
async function dispatchAndExecuteCoordinatorWorkstream(
  root, mission, plan, workstreamId, coordinatorConfig, coordinatorState, opts,
) {
  const executor = opts._executeGovernedRun || executeGovernedRun;
  const logger = opts.json ? noop : (opts._log || console.log);

  // 1. Select assignment
  const assignment = selectAssignmentForWorkstream(
    mission.coordinator.workspace_path,
    coordinatorState,
    coordinatorConfig,
    workstreamId,
  );
  if (!assignment.ok) {
    return { ok: false, status: 'assignment_blocked', error: assignment.detail || assignment.reason };
  }

  // 2. Dispatch coordinator turn (writes bundle, does not execute)
  const dispatch = dispatchCoordinatorTurn(
    mission.coordinator.workspace_path,
    coordinatorState,
    coordinatorConfig,
    assignment,
  );
  if (!dispatch.ok) {
    return { ok: false, status: 'dispatch_error', error: dispatch.error };
  }

  // 3. Record launch in plan
  const launch = launchCoordinatorWorkstream(
    root,
    mission,
    plan.plan_id,
    workstreamId,
    { ...dispatch, role: assignment.role },
    coordinatorConfig,
  );
  if (!launch.ok) {
    return { ok: false, status: 'launch_record_error', error: launch.error };
  }

  // 4. Execute the repo-local turn in the target repo
  const repoPath = coordinatorConfig.repos?.[dispatch.repo_id]?.resolved_path;
  if (!repoPath) {
    return { ok: false, status: 'repo_path_error', error: `No resolved_path for repo "${dispatch.repo_id}"` };
  }

  const repoContext = loadProjectContext(repoPath);
  if (!repoContext) {
    return { ok: false, status: 'repo_context_error', error: `Cannot load project context for repo "${dispatch.repo_id}" at "${repoPath}"` };
  }

  const runOpts = {
    autoApprove: !!opts.autoApprove,
    log: logger,
    provenance: {
      trigger: opts.trigger || 'manual',
      created_by: 'operator',
      trigger_reason: `mission:${mission.mission_id} workstream:${workstreamId} coordinator:${mission.coordinator.super_run_id} repo:${dispatch.repo_id}`,
    },
  };

  let execution;
  try {
    execution = await executor(repoContext, runOpts);
  } catch (error) {
    return {
      ok: false,
      status: 'needs_attention',
      repo_id: dispatch.repo_id,
      turn_id: dispatch.turn_id,
      error: error.message,
    };
  }

  if ((execution?.exitCode ?? 0) === 0) {
    const projection = projectAcceptedCoordinatorTurn(
      mission.coordinator.workspace_path,
      coordinatorConfig,
      dispatch.repo_id,
      dispatch.turn_id,
      workstreamId,
      loadCoordinatorState(mission.coordinator.workspace_path) || coordinatorState,
    );
    if (!projection.ok) {
      return {
        ok: false,
        status: 'projection_error',
        repo_id: dispatch.repo_id,
        turn_id: dispatch.turn_id,
        error: projection.error,
      };
    }
  }

  // 5. Sync plan state from coordinator (updates barriers, accepted repos, failures)
  const synced = synchronizeCoordinatorPlanState(root, mission, launch.plan);

  const exitCode = execution?.exitCode || 0;
  const wsStatus = exitCode === 0 ? 'dispatched' : 'needs_attention';

  return {
    ok: true,
    status: wsStatus,
    repo_id: dispatch.repo_id,
    turn_id: dispatch.turn_id,
    exit_code: exitCode,
    plan: synced.ok ? synced.plan : launch.plan,
  };
}

/**
 * Load coordinator config and state for a mission. Returns { ok, config, state, error }.
 */
function loadCoordinatorForMission(mission) {
  const coordinatorConfigResult = loadCoordinatorConfig(mission.coordinator.workspace_path);
  if (!coordinatorConfigResult.ok) {
    return { ok: false, error: `Coordinator config validation failed: ${(coordinatorConfigResult.errors || []).join(', ')}` };
  }

  const coordinatorState = loadCoordinatorState(mission.coordinator.workspace_path);
  if (!coordinatorState) {
    return { ok: false, error: `Coordinator state not found at ${mission.coordinator.workspace_path}` };
  }
  if (coordinatorState.status !== 'active') {
    return { ok: false, error: `Coordinator run ${coordinatorState.super_run_id} is not active (status: "${coordinatorState.status}")` };
  }

  return { ok: true, config: coordinatorConfigResult.config, state: coordinatorState };
}

/**
 * Coordinator-aware --all-ready: dispatches all ready workstreams sequentially,
 * executing each repo-local turn and syncing barrier state between dispatches.
 */
async function coordinatorLaunchAllReady(planTarget, opts, context, mission) {
  const { root } = context;

  let plan = planTarget && planTarget !== 'latest'
    ? loadPlan(root, mission.mission_id, planTarget)
    : loadLatestPlan(root, mission.mission_id);

  if (!plan) {
    console.error(chalk.red('No plan found.'));
    process.exit(1);
  }

  // Sync plan state first
  const synced = synchronizeCoordinatorPlanState(root, mission, plan);
  if (synced.ok) plan = synced.plan;

  if (plan.status !== 'approved') {
    console.error(chalk.red(`Plan ${plan.plan_id} is not approved (status: "${plan.status}").`));
    process.exit(1);
  }

  const coord = loadCoordinatorForMission(mission);
  if (!coord.ok) {
    console.error(chalk.red(coord.error));
    process.exit(1);
  }

  const readyWorkstreams = getReadyWorkstreams(plan);
  if (readyWorkstreams.length === 0) {
    const summary = getWorkstreamStatusSummary(plan);
    const parts = Object.entries(summary).map(([status, count]) => `${count} ${status}`);
    console.error(chalk.red(`No ready workstreams. Distribution: ${parts.join(', ')}.`));
    process.exit(1);
  }

  if (!opts.json) {
    console.log(chalk.bold(`Coordinator --all-ready: launching ${readyWorkstreams.length} workstream(s) from plan ${plan.plan_id}...\n`));
  }

  const results = [];
  let hadFailure = false;

  for (let i = 0; i < readyWorkstreams.length; i++) {
    const ws = readyWorkstreams[i];
    const prefix = `[${i + 1}/${readyWorkstreams.length}]`;

    if (hadFailure) {
      results.push({ workstream_id: ws.workstream_id, status: 'skipped', skip_reason: 'prior workstream failed' });
      if (!opts.json) {
        console.log(`${prefix} ${chalk.dim(ws.workstream_id)} — ${chalk.dim('skipped (prior workstream failed)')}`);
      }
      continue;
    }

    if (!opts.json) {
      process.stdout.write(`${prefix} ${chalk.cyan(ws.workstream_id)} ... `);
    }

    const result = await dispatchAndExecuteCoordinatorWorkstream(
      root, mission, plan, ws.workstream_id, coord.config, coord.state, { ...opts, trigger: 'manual' },
    );

    if (!result.ok) {
      hadFailure = true;
      results.push({ workstream_id: ws.workstream_id, status: 'needs_attention', error: result.error });
      if (!opts.json) {
        console.log(chalk.red(`needs_attention ✗ (${result.error})`));
      }
      continue;
    }

    // Update plan reference for subsequent dispatches
    if (result.plan) plan = result.plan;

    const wsStatus = result.status === 'needs_attention' ? 'needs_attention' : 'dispatched';
    if (wsStatus === 'needs_attention') hadFailure = true;

    results.push({
      workstream_id: ws.workstream_id,
      status: wsStatus,
      repo_id: result.repo_id,
      turn_id: result.turn_id,
      exit_code: result.exit_code,
    });

    if (!opts.json) {
      if (wsStatus === 'needs_attention') {
        console.log(chalk.red('needs_attention ✗'));
      } else {
        console.log(chalk.green(`→ ${result.repo_id} ✓`));
      }
    }
  }

  // Summary
  const dispatched = results.filter((r) => r.status === 'dispatched').length;
  const failed = results.filter((r) => r.status === 'needs_attention').length;
  const skipped = results.filter((r) => r.status === 'skipped').length;

  if (opts.json) {
    console.log(JSON.stringify({
      plan_id: plan.plan_id,
      mission_id: mission.mission_id,
      dispatch_mode: 'coordinator',
      results,
      summary: { total: results.length, dispatched, failed, skipped },
    }, null, 2));
  } else {
    console.log('');
    console.log(chalk.bold(`Summary: ${dispatched} dispatched, ${failed} failed, ${skipped} skipped`));
    if (hadFailure) {
      console.log(chalk.dim('  Inspect plan state with `agentxchain mission plan show latest`'));
    }
  }

  if (hadFailure) process.exit(1);
}

/**
 * Coordinator-aware autopilot: wave-based unattended execution for coordinator-bound missions.
 * Each wave dispatches all ready workstreams, executes repo-local turns, and syncs barrier state.
 */
async function coordinatorAutopilot(planTarget, opts, context, mission) {
  const { root } = context;

  let plan = planTarget && planTarget !== 'latest'
    ? loadPlan(root, mission.mission_id, planTarget)
    : loadLatestPlan(root, mission.mission_id);

  if (!plan) {
    console.error(chalk.red('No plan found.'));
    process.exit(1);
  }

  const continueOnFailure = !!opts.continueOnFailure;

  // Sync plan state
  const initialSync = synchronizeCoordinatorPlanState(root, mission, plan);
  if (initialSync.ok) plan = initialSync.plan;

  if (plan.status === 'completed') {
    if (opts.json) {
      console.log(JSON.stringify({
        plan_id: plan.plan_id,
        mission_id: mission.mission_id,
        dispatch_mode: 'coordinator',
        waves: [],
        summary: { total_waves: 0, total_launched: 0, completed: 0, failed: 0, terminal_reason: 'plan_completed' },
      }, null, 2));
    } else {
      console.log(chalk.green(`Plan ${plan.plan_id} is already completed. Nothing to do.`));
    }
    return;
  }

  if (plan.status !== 'approved' && !(plan.status === 'needs_attention' && continueOnFailure)) {
    console.error(chalk.red(`Plan ${plan.plan_id} status is "${plan.status}". Autopilot requires an approved plan${continueOnFailure ? ' (or needs_attention with --continue-on-failure)' : ''}.`));
    process.exit(1);
  }

  const coord = loadCoordinatorForMission(mission);
  if (!coord.ok) {
    console.error(chalk.red(coord.error));
    process.exit(1);
  }

  const maxWaves = Math.max(1, parseInt(opts.maxWaves, 10) || 10);
  const cooldownSeconds = Math.max(0, parseInt(opts.cooldown, 10) || 5);
  const sleep = opts._sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));

  const waves = [];
  let totalLaunched = 0;
  let totalCompleted = 0;
  let totalFailed = 0;
  let terminalReason = null;
  let interrupted = false;

  const onSigint = () => { interrupted = true; };
  process.on('SIGINT', onSigint);

  try {
    for (let waveNum = 1; waveNum <= maxWaves; waveNum++) {
      if (interrupted) {
        terminalReason = 'interrupted';
        break;
      }

      // Re-sync plan from disk + coordinator state
      const currentPlan = loadPlan(root, mission.mission_id, plan.plan_id);
      if (!currentPlan) {
        terminalReason = 'plan_read_error';
        break;
      }
      const coordSync = synchronizeCoordinatorPlanState(root, mission, currentPlan);
      plan = coordSync.ok ? coordSync.plan : currentPlan;

      if (plan.status === 'completed') {
        terminalReason = 'plan_completed';
        break;
      }

      const readyWorkstreams = getCoordinatorWaveWorkstreams(plan);
      if (readyWorkstreams.length === 0) {
        terminalReason = deriveAutopilotIdleOutcome(plan, continueOnFailure);
        break;
      }

      if (!opts.json) {
        console.log(chalk.bold(`\n━━━ Wave ${waveNum} — coordinator: ${readyWorkstreams.length} workstream(s) ━━━\n`));
      }

      const waveResults = [];
      let waveHadFailure = false;

      for (let i = 0; i < readyWorkstreams.length; i++) {
        if (interrupted) break;

        const ws = readyWorkstreams[i];
        const prefix = `[${i + 1}/${readyWorkstreams.length}]`;

        if (waveHadFailure && !continueOnFailure) {
          waveResults.push({ workstream_id: ws.workstream_id, status: 'skipped', skip_reason: 'prior workstream failed' });
          if (!opts.json) {
            console.log(`${prefix} ${chalk.dim(ws.workstream_id)} — ${chalk.dim('skipped (prior workstream failed)')}`);
          }
          continue;
        }

        if (!opts.json) {
          process.stdout.write(`${prefix} ${chalk.cyan(ws.workstream_id)} ... `);
        }

        const result = await dispatchAndExecuteCoordinatorWorkstream(
          root, mission, plan, ws.workstream_id, coord.config, coord.state, { ...opts, trigger: 'autopilot' },
        );

        if (!result.ok) {
          waveHadFailure = true;
          totalFailed++;
          waveResults.push({ workstream_id: ws.workstream_id, status: 'needs_attention', error: result.error });
          if (!opts.json) {
            console.log(chalk.red(`needs_attention ✗ (${result.error})`));
          }
          continue;
        }

        if (result.plan) plan = result.plan;
        totalLaunched++;

        if (result.status === 'needs_attention') {
          waveHadFailure = true;
          totalFailed++;
          waveResults.push({ workstream_id: ws.workstream_id, status: 'needs_attention', repo_id: result.repo_id, turn_id: result.turn_id });
          if (!opts.json) {
            console.log(chalk.red(`→ ${result.repo_id} needs_attention ✗`));
          }
        } else {
          totalCompleted++;
          waveResults.push({ workstream_id: ws.workstream_id, status: 'dispatched', repo_id: result.repo_id, turn_id: result.turn_id });
          if (!opts.json) {
            console.log(chalk.green(`→ ${result.repo_id} ✓`));
          }
        }
      }

      waves.push({ wave: waveNum, results: waveResults });

      if (interrupted) {
        terminalReason = 'interrupted';
        break;
      }

      // Re-sync and check plan completion
      const afterSync = synchronizeCoordinatorPlanState(root, mission, plan);
      if (afterSync.ok) plan = afterSync.plan;

      if (plan.status === 'completed') {
        terminalReason = 'plan_completed';
        break;
      }

      if (waveHadFailure && !continueOnFailure) {
        terminalReason = 'failure_stopped';
        break;
      }

      if (waveNum === maxWaves) {
        terminalReason = 'wave_limit_reached';
        break;
      }

      // Cooldown between waves
      if (cooldownSeconds > 0 && !interrupted) {
        if (!opts.json) {
          console.log(chalk.dim(`\nCooldown: ${cooldownSeconds}s before next wave...\n`));
        }
        await sleep(cooldownSeconds * 1000);
      }
    }
  } finally {
    process.removeListener('SIGINT', onSigint);
  }

  if (!terminalReason) {
    terminalReason = totalFailed > 0
      ? (continueOnFailure ? 'plan_incomplete' : 'failure_stopped')
      : 'plan_completed';
  }

  const jsonOutput = {
    plan_id: plan.plan_id,
    mission_id: mission.mission_id,
    dispatch_mode: 'coordinator',
    waves,
    summary: {
      total_waves: waves.length,
      total_launched: totalLaunched,
      completed: totalCompleted,
      failed: totalFailed,
      terminal_reason: terminalReason,
    },
  };

  if (opts.json) {
    console.log(JSON.stringify(jsonOutput, null, 2));
  } else {
    console.log('');
    console.log(chalk.bold('━━━ Coordinator Autopilot Summary ━━━'));
    console.log(`  Waves:      ${waves.length}`);
    console.log(`  Launched:   ${totalLaunched}`);
    console.log(`  Completed:  ${totalCompleted}`);
    console.log(`  Failed:     ${totalFailed}`);
    console.log(`  Outcome:    ${formatTerminalReason(terminalReason)}`);
    if (terminalReason === 'plan_completed') {
      console.log(chalk.green('\n  Plan completed successfully.'));
    } else if (terminalReason === 'deadlock') {
      console.log(chalk.red('\n  Deadlock: remaining workstreams are blocked with unsatisfiable dependencies.'));
      console.log(chalk.dim('  Inspect with `agentxchain mission plan show latest`.'));
    } else if (terminalReason === 'wave_limit_reached') {
      console.log(chalk.yellow(`\n  Wave limit reached. Run autopilot again to continue.`));
    } else if (terminalReason === 'failure_stopped') {
      console.log(chalk.red('\n  Stopped due to workstream failure.'));
      console.log(chalk.dim('  Use --continue-on-failure to skip failures, or resolve the issue and rerun autopilot.'));
    } else if (terminalReason === 'plan_incomplete') {
      console.log(chalk.yellow('\n  Autopilot exhausted all launchable work, but failed workstreams still need attention.'));
    } else if (terminalReason === 'interrupted') {
      console.log(chalk.yellow('\n  Interrupted by operator.'));
    }
  }

  if (terminalReason !== 'plan_completed') {
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
  if (plan.coordinator_scope) {
    const cs = plan.coordinator_scope;
    console.log(`  Coordinator:  ${chalk.cyan('bound')} (${(cs.repo_ids || []).length} repos, phases: ${(cs.phases || []).join(', ')})`);
  }
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
        : (rec.status === 'failed' || rec.status === 'needs_attention') ? chalk.red('needs_attention')
        : chalk.cyan('launched');
      if (rec.dispatch_mode === 'coordinator') {
        const dispatchCount = rec.repo_dispatches?.length || 0;
        const progress = rec.coordinator_progress;
        const accepted = progress ? `${progress.accepted_repo_count}/${progress.repo_count}` : '—';
        const failures = rec.repo_failures?.length || progress?.repo_failure_count || 0;
        console.log(`    ${chalk.cyan(rec.workstream_id)} → coordinator ${rec.super_run_id || '—'} [${statusTag}] dispatches=${dispatchCount} accepted=${accepted} failed=${failures}`);
      } else {
        console.log(`    ${chalk.cyan(rec.workstream_id)} → ${rec.chain_id} [${statusTag}]`);
      }
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

  // Load coordinator config when mission is coordinator-bound
  let coordinatorConfig = null;
  if (mission.coordinator && mission.coordinator.workspace_path) {
    const coordResult = loadCoordinatorConfig(mission.coordinator.workspace_path);
    if (coordResult.ok) {
      coordinatorConfig = coordResult.config;
    }
  }

  const plannerOutput = await resolvePlannerOutput(root, mission, constraints, roleHints, opts, coordinatorConfig);
  const result = createPlanArtifact(root, mission, {
    constraints,
    roleHints,
    plannerOutput,
    coordinatorConfig,
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

async function resolvePlannerOutput(root, mission, constraints, roleHints, opts = {}, coordinatorConfig = null) {
  const { systemPrompt, userPrompt } = buildPlannerPrompt(mission, constraints, roleHints, coordinatorConfig);

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

// ── Mission Bind-Coordinator Command ───────────────────────────────────────

export async function missionBindCoordinatorCommand(missionId, opts) {
  const root = findProjectRoot(opts.dir || process.cwd());
  if (!root) {
    console.error(chalk.red('No AgentXchain project found. Run this inside a governed project.'));
    process.exit(1);
  }

  const superRunId = String(opts.superRunId || '').trim();
  const configPath = String(opts.coordinatorConfig || '').trim();
  if (!superRunId) {
    console.error(chalk.red('--super-run-id is required.'));
    process.exit(1);
  }

  const mission = missionId
    ? loadMissionArtifact(root, missionId)
    : loadLatestMissionArtifact(root);
  if (!mission) {
    console.error(chalk.red(missionId ? `Mission not found: ${missionId}` : 'No mission found.'));
    process.exit(1);
  }

  const workspacePath = resolve(opts.coordinatorWorkspace || root);
  const result = bindCoordinatorToMission(root, mission.mission_id, {
    super_run_id: superRunId,
    config_path: configPath || null,
    workspace_path: workspacePath,
  });

  if (!result.ok) {
    console.error(chalk.red(result.error));
    process.exit(1);
  }

  const snapshot = buildMissionSnapshot(root, result.mission);
  if (opts.json) {
    console.log(JSON.stringify(snapshot, null, 2));
    return;
  }

  console.log(chalk.green(`Bound coordinator ${superRunId} to ${snapshot.mission_id}`));
  renderMissionSnapshot(snapshot);
}

// ── Rendering ──────────────────────────────────────────────────────────────

function renderMissionSnapshot(snapshot) {
  const latestPlan = snapshot.latest_plan || null;

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

  // Coordinator (multi-repo) section
  if (snapshot.coordinator_status) {
    const cs = snapshot.coordinator_status;
    console.log('');
    console.log(chalk.bold('  Coordinator (multi-repo):'));
    if (cs.unreachable) {
      console.log(`    Super Run:           ${cs.super_run_id || '—'}`);
      console.log(`    Status:              ${chalk.red('unreachable')}`);
    } else {
      console.log(`    Super Run:           ${cs.super_run_id || '—'}`);
      console.log(`    Status:              ${formatCoordinatorStatus(cs.status)}`);
      console.log(`    Phase:               ${cs.phase || '—'}`);
      if (cs.repo_runs && Object.keys(cs.repo_runs).length > 0) {
        console.log('    Repos:');
        for (const [repoId, repo] of Object.entries(cs.repo_runs)) {
          console.log(`      ${pad(repoId, 16)} ${pad(repo.status || '—', 14)} ${pad(repo.phase || '—', 18)} ${repo.run_id || '—'}`);
        }
      }
      if (cs.pending_barriers && cs.pending_barriers.length > 0) {
        console.log('    Barriers:');
        for (const barrier of cs.pending_barriers) {
          console.log(`      ${pad(barrier.id, 28)} ${pad(barrier.type || '—', 24)} ${barrier.status || '—'}`);
        }
      }
      if (cs.blocked_reason) {
        console.log(`    Blocked:             ${chalk.yellow(cs.blocked_reason)}`);
      }
    }
  }

  if (latestPlan) {
    console.log('');
    console.log(chalk.bold('  Latest plan:'));
    console.log(`    Plan ID:             ${latestPlan.plan_id || '—'}`);
    console.log(`    Status:              ${formatPlanStatus(latestPlan.status)}`);
    console.log(`    Completion:          ${latestPlan.completion_percentage}% (${latestPlan.completed_count}/${latestPlan.workstream_count} completed)`);
    console.log(`    Workstream summary:  ready ${latestPlan.ready_count}, blocked ${latestPlan.blocked_count}, launched ${latestPlan.launched_count}, completed ${latestPlan.completed_count}, needs_attention ${latestPlan.needs_attention_count}`);
  }

  if (!snapshot.chains || snapshot.chains.length === 0) {
    console.log('');
    console.log(chalk.dim('  No chains attached.'));
    console.log(chalk.dim('  Use `agentxchain run --chain --mission latest` for new work, or `agentxchain mission attach-chain latest` to repair an unbound chain.'));
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

function formatCoordinatorStatus(status) {
  if (!status) return '—';
  switch (status) {
    case 'active':
      return chalk.green('active');
    case 'blocked':
      return chalk.red('blocked');
    case 'completed':
      return chalk.cyan('completed');
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

function noop() {}
