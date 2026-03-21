import chalk from 'chalk';
import inquirer from 'inquirer';
import { loadConfig } from '../lib/config.js';
import { validateProject } from '../lib/validation.js';
import { startCommand } from './start.js';
import { releaseCommand } from './claim.js';
import { superviseCommand } from './supervise.js';

export async function kickoffCommand(opts) {
  const result = loadConfig();
  if (!result) {
    console.log(chalk.red('No agentxchain.json found. Run `agentxchain init` first.'));
    process.exit(1);
  }

  const { root, config } = result;
  const pmId = pickPmAgentId(config);
  const ide = opts.ide || 'cursor';

  if (!pmId) {
    console.log(chalk.red('No agents configured.'));
    process.exit(1);
  }

  console.log('');
  console.log(chalk.bold('  AgentXchain Kickoff Wizard'));
  console.log(chalk.dim(`  Project: ${config.project}`));
  console.log(chalk.dim(`  PM agent: ${pmId}`));
  console.log(chalk.dim(`  IDE: ${ide}`));
  console.log('');

  await startCommand({ ide, agent: pmId, remaining: false, dryRun: false });

  console.log(chalk.cyan('  PM kickoff launched.'));
  console.log(chalk.dim('  Discuss product scope with PM, then mark .planning/PM_SIGNOFF.md as Approved: YES.'));
  console.log('');

  const { readyForValidation } = await inquirer.prompt([{
    type: 'confirm',
    name: 'readyForValidation',
    message: 'Is PM kickoff complete and signoff updated?',
    default: false
  }]);

  if (!readyForValidation) {
    console.log('');
    console.log(chalk.yellow('  Kickoff paused.'));
    console.log(chalk.dim('  Resume later with: agentxchain validate --mode kickoff && agentxchain start --remaining'));
    console.log('');
    return;
  }

  const validation = validateProject(root, config, { mode: 'kickoff' });
  if (!validation.ok) {
    console.log('');
    console.log(chalk.red('  Kickoff validation failed.'));
    for (const err of validation.errors) {
      console.log(chalk.dim(`   - ${err}`));
    }
    if (validation.warnings.length > 0) {
      console.log(chalk.yellow('  Warnings:'));
      for (const warn of validation.warnings) {
        console.log(chalk.dim(`   - ${warn}`));
      }
    }
    console.log('');
    console.log(chalk.bold('  Run: agentxchain validate --mode kickoff'));
    console.log('');
    process.exit(1);
  }

  console.log(chalk.green('  ✓ Kickoff validation passed.'));
  console.log('');

  await startCommand({ ide, remaining: true, agent: undefined, dryRun: false });

  const { doRelease } = await inquirer.prompt([{
    type: 'confirm',
    name: 'doRelease',
    message: 'Release human lock now so agents can start?',
    default: true
  }]);

  if (doRelease) {
    await releaseCommand({ force: false });
  } else {
    console.log(chalk.dim('  Lock remains with human. Run `agentxchain release` when ready.'));
  }

  if (ide === 'cursor' && opts.autonudge !== false) {
    const { startSupervisor } = await inquirer.prompt([{
      type: 'confirm',
      name: 'startSupervisor',
      message: 'Start supervisor with auto-nudge now?',
      default: true
    }]);

    if (startSupervisor) {
      await superviseCommand({
        autonudge: true,
        send: !!opts.send,
        interval: opts.interval || '3'
      });
    } else {
      console.log('');
      console.log(chalk.dim('  Start later with: agentxchain supervise --autonudge'));
      console.log('');
    }
  }
}

function pickPmAgentId(config) {
  if (config.agents?.pm) return 'pm';
  for (const [id, def] of Object.entries(config.agents || {})) {
    const name = String(def?.name || '').toLowerCase();
    if (name.includes('product manager')) return id;
  }
  return Object.keys(config.agents || {})[0] || null;
}
