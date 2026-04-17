import chalk from 'chalk';
import { findProjectRoot } from '../lib/config.js';
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
