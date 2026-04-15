import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import chalk from 'chalk';
import { loadConfig, loadProjectContext } from '../lib/config.js';
import { generateVSCodeFiles } from '../lib/generate-vscode.js';
import { loadGovernedTemplate } from '../lib/governed-templates.js';
import { buildGovernedPlanningArtifacts } from '../lib/planning-artifacts.js';

export async function generateCommand() {
  const result = loadConfig();
  if (!result) {
    console.log(chalk.red('  No agentxchain.json found. Run `agentxchain init` first.'));
    process.exit(1);
  }

  const { root, config } = result;
  const agentIds = Object.keys(config.agents || {});

  if (agentIds.length === 0) {
    console.log(chalk.red('  No agents configured in agentxchain.json.'));
    process.exit(1);
  }

  console.log('');
  console.log(chalk.bold('  Generating VS Code agent files...'));
  console.log(chalk.dim(`  Project: ${config.project}`));
  console.log('');

  const vsResult = generateVSCodeFiles(root, config);

  console.log(chalk.green(`  ✓ Generated ${vsResult.agentCount} agent files`));
  console.log('');

  for (const id of agentIds) {
    const name = config.agents[id].name;
    console.log(`    ${chalk.cyan(id)}.agent.md — ${name}`);
  }

  console.log('');
  console.log(chalk.dim('  Files written:'));
  console.log(`    .github/agents/  ${chalk.dim(`(${vsResult.agentCount} .agent.md files)`)}`);
  console.log(`    .github/hooks/   ${chalk.dim('agentxchain.json')}`);
  console.log(`    scripts/         ${chalk.dim('session-start, stop, pre-tool hooks')}`);
  console.log('');
  console.log(chalk.dim('  VS Code will auto-discover agents from .github/agents/.'));
  console.log(chalk.dim('  Select an agent from the Chat dropdown to start a turn.'));
  console.log('');
}

function failPlanningGenerate(message, opts = {}) {
  if (opts.json) {
    console.log(JSON.stringify({ ok: false, error: message }, null, 2));
  } else {
    console.log(chalk.red(`  ${message}`));
  }
  process.exit(1);
}

export async function generatePlanningCommand(opts = {}) {
  const context = loadProjectContext();
  if (!context) {
    failPlanningGenerate('No valid agentxchain.json found. Run `agentxchain init --governed` first.', opts);
  }

  if (context.version !== 4) {
    failPlanningGenerate('`generate planning` only works in governed repos.', opts);
  }

  const templateId = context.rawConfig.template || 'generic';
  let template;
  try {
    template = loadGovernedTemplate(templateId);
  } catch (err) {
    failPlanningGenerate(err.message, opts);
  }

  const projectName = context.config?.project?.name || context.rawConfig?.project?.name || 'AgentXchain Project';
  const artifacts = buildGovernedPlanningArtifacts({
    projectName,
    routing: context.config.routing || {},
    roles: context.config.roles || {},
    template,
    workflowKitConfig: context.config.workflow_kit || null,
  });

  const created = [];
  const overwritten = [];
  const skippedExisting = [];

  for (const artifact of artifacts) {
    const absPath = join(context.root, artifact.path);
    if (existsSync(absPath)) {
      if (opts.force) {
        overwritten.push(artifact.path);
      } else {
        skippedExisting.push(artifact.path);
        continue;
      }
    } else {
      created.push(artifact.path);
    }

    if (opts.dryRun) {
      continue;
    }

    const parentDir = dirname(absPath);
    if (!existsSync(parentDir)) {
      mkdirSync(parentDir, { recursive: true });
    }
    writeFileSync(absPath, artifact.content);
  }

  const payload = {
    ok: true,
    mode: 'planning',
    dry_run: Boolean(opts.dryRun),
    force: Boolean(opts.force),
    template: template.id,
    project: projectName,
    total_artifacts: artifacts.length,
    created,
    overwritten,
    skipped_existing: skippedExisting,
  };

  if (opts.json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log('');
  console.log(chalk.bold('  Generating governed planning artifacts...'));
  console.log(chalk.dim(`  Project: ${projectName}`));
  console.log(chalk.dim(`  Template: ${template.id}`));
  console.log('');

  if (created.length > 0) {
    console.log(chalk.green(`  ${opts.dryRun ? 'Would create' : 'Created'} ${created.length} artifact${created.length === 1 ? '' : 's'}:`));
    for (const path of created) {
      console.log(chalk.green(`    ${path}`));
    }
  }

  if (overwritten.length > 0) {
    console.log(chalk.yellow(`  ${opts.dryRun ? 'Would overwrite' : 'Overwrote'} ${overwritten.length} artifact${overwritten.length === 1 ? '' : 's'}:`));
    for (const path of overwritten) {
      console.log(chalk.yellow(`    ${path}`));
    }
  }

  if (skippedExisting.length > 0) {
    console.log(chalk.dim(`  Preserved ${skippedExisting.length} existing artifact${skippedExisting.length === 1 ? '' : 's'}:`));
    for (const path of skippedExisting) {
      console.log(chalk.dim(`    ${path}`));
    }
  }

  if (created.length === 0 && overwritten.length === 0) {
    console.log(chalk.dim(`  ${opts.force ? 'Nothing to overwrite.' : 'All scaffold-owned planning artifacts already exist.'}`));
  }

  if (opts.dryRun) {
    console.log('');
    console.log(chalk.dim('  No files were written. Re-run without `--dry-run` to apply.'));
  }

  console.log('');
}
