import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import chalk from 'chalk';
import { loadProjectContext, loadProjectState } from '../lib/config.js';
import { getActiveTurnCount, getActiveTurns } from '../lib/governed-state.js';
import {
  getDispatchAssignmentPath,
  getDispatchContextPath,
  getDispatchManifestPath,
  getDispatchPromptPath,
  getDispatchTurnDir,
} from '../lib/turn-paths.js';

const ARTIFACTS = {
  assignment: {
    label: 'Assignment',
    pathFor: getDispatchAssignmentPath,
    parse: 'json',
  },
  prompt: {
    label: 'Prompt',
    pathFor: getDispatchPromptPath,
    parse: 'text',
  },
  context: {
    label: 'Context',
    pathFor: getDispatchContextPath,
    parse: 'text',
  },
  manifest: {
    label: 'Manifest',
    pathFor: getDispatchManifestPath,
    parse: 'json',
  },
};

export function turnShowCommand(turnId, opts) {
  const context = requireGovernedContext();
  const state = loadProjectState(context.root, context.config);

  if (!state) {
    console.log(chalk.red('  Governed state is missing or invalid.'));
    process.exit(1);
  }

  const activeTurns = getActiveTurns(state);
  const selectedTurnId = resolveTurnId(turnId, activeTurns);
  const turn = activeTurns[selectedTurnId];
  const artifacts = buildArtifactIndex(context.root, selectedTurnId);
  const assignment = readJsonArtifact(artifacts.assignment.absPath);

  if (opts.artifact) {
    return printArtifact(selectedTurnId, turn, artifacts, opts.artifact, opts.json);
  }

  if (opts.json) {
    console.log(JSON.stringify(buildTurnPayload(selectedTurnId, turn, state, artifacts, assignment), null, 2));
    return;
  }

  printTurnSummary(selectedTurnId, turn, state, artifacts, assignment);
}

function requireGovernedContext() {
  const context = loadProjectContext();
  if (!context) {
    console.log(chalk.red('  No agentxchain.json found. Run `agentxchain init` first.'));
    process.exit(1);
  }
  if (context.config.protocol_mode !== 'governed') {
    console.log(chalk.red('  The turn command is only available for governed projects.'));
    process.exit(1);
  }
  return context;
}

function resolveTurnId(requestedTurnId, activeTurns) {
  const turnIds = Object.keys(activeTurns);
  if (requestedTurnId) {
    if (!activeTurns[requestedTurnId]) {
      console.log(chalk.red(`  Unknown active turn: ${requestedTurnId}`));
      if (turnIds.length > 0) {
        console.log(chalk.dim(`  Available: ${turnIds.join(', ')}`));
      }
      process.exit(1);
    }
    return requestedTurnId;
  }

  if (turnIds.length === 0) {
    console.log(chalk.red('  No active turn found.'));
    process.exit(1);
  }

  if (turnIds.length > 1) {
    console.log(chalk.red('  Multiple active turns are present. Re-run with `agentxchain turn show <turn_id>`.'));
    console.log(chalk.dim(`  Available: ${turnIds.join(', ')}`));
    process.exit(1);
  }

  return turnIds[0];
}

function buildArtifactIndex(root, turnId) {
  return Object.fromEntries(
    Object.entries(ARTIFACTS).map(([id, artifact]) => {
      const relPath = artifact.pathFor(turnId);
      const absPath = join(root, relPath);
      return [id, {
        id,
        label: artifact.label,
        relPath,
        absPath,
        exists: existsSync(absPath),
        parse: artifact.parse,
      }];
    }),
  );
}

function buildTurnPayload(turnId, turn, state, artifacts, assignment) {
  return {
    turn_id: turnId,
    run_id: state.run_id || assignment?.run_id || null,
    phase: state.phase || assignment?.phase || null,
    role: turn.assigned_role,
    runtime: turn.runtime_id,
    status: turn.status,
    attempt: turn.attempt,
    dispatch_dir: getDispatchTurnDir(turnId),
    staging_result_path: assignment?.staging_result_path || null,
    active_turn_count: getActiveTurnCount(state),
    artifacts: Object.fromEntries(
      Object.entries(artifacts).map(([id, artifact]) => [id, {
        path: artifact.relPath,
        exists: artifact.exists,
      }]),
    ),
  };
}

function printTurnSummary(turnId, turn, state, artifacts, assignment) {
  console.log('');
  console.log(chalk.bold(`  Turn: ${chalk.cyan(turnId)}`));
  console.log(chalk.dim('  ' + '─'.repeat(44)));
  console.log(`  ${chalk.dim('Run:')}      ${state.run_id || assignment?.run_id || chalk.dim('unknown')}`);
  console.log(`  ${chalk.dim('Phase:')}    ${state.phase || assignment?.phase || chalk.dim('unknown')}`);
  console.log(`  ${chalk.dim('Role:')}     ${chalk.bold(turn.assigned_role)}`);
  console.log(`  ${chalk.dim('Runtime:')}  ${turn.runtime_id}`);
  console.log(`  ${chalk.dim('Status:')}   ${turn.status}`);
  console.log(`  ${chalk.dim('Attempt:')}  ${turn.attempt}`);
  console.log(`  ${chalk.dim('Dispatch:')} ${getDispatchTurnDir(turnId)}`);
  if (assignment?.staging_result_path) {
    console.log(`  ${chalk.dim('Staging:')}  ${assignment.staging_result_path}`);
  }
  console.log('');
  console.log(`  ${chalk.dim('Artifacts:')}`);
  for (const artifact of Object.values(artifacts)) {
    const marker = artifact.exists ? chalk.green('exists') : chalk.red('missing');
    console.log(`    ${artifact.label.padEnd(10)} ${marker}  ${artifact.relPath}`);
  }
  console.log('');
  console.log(chalk.dim(`  View one: agentxchain turn show ${turnId} --artifact prompt`));
  console.log('');
}

function printArtifact(turnId, turn, artifacts, artifactId, jsonMode) {
  const artifact = artifacts[artifactId];
  if (!artifact) {
    console.log(chalk.red(`  Unknown artifact: ${artifactId}`));
    console.log(chalk.dim(`  Allowed: ${Object.keys(ARTIFACTS).join(', ')}`));
    process.exit(1);
  }
  if (!artifact.exists) {
    console.log(chalk.red(`  Missing artifact: ${artifact.relPath}`));
    process.exit(1);
  }

  const raw = readFileSync(artifact.absPath, 'utf8');
  if (!jsonMode) {
    process.stdout.write(raw.endsWith('\n') ? raw : `${raw}\n`);
    return;
  }

  const content = artifact.parse === 'json'
    ? JSON.parse(raw)
    : raw;

  console.log(JSON.stringify({
    turn_id: turnId,
    role: turn.assigned_role,
    runtime: turn.runtime_id,
    artifact: {
      id: artifact.id,
      path: artifact.relPath,
      content,
    },
  }, null, 2));
}

function readJsonArtifact(absPath) {
  if (!existsSync(absPath)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(absPath, 'utf8'));
  } catch {
    return null;
  }
}
