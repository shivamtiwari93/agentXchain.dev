import { join } from 'path';
import chalk from 'chalk';
import { loadConfig, CONFIG_FILE } from '../lib/config.js';
import { safeWriteJson } from '../lib/safe-write.js';
import { getCurrentBranch } from '../lib/repo.js';

export async function branchCommand(name, opts) {
  const result = loadConfig();
  if (!result) {
    console.log(chalk.red('  No agentxchain.json found. Run `agentxchain init` first.'));
    process.exit(1);
  }

  const { root, config } = result;
  const configPath = join(root, CONFIG_FILE);
  const currentGitBranch = getCurrentBranch(root) || 'main';
  const hasOverride = !!config.cursor?.ref;
  const overrideBranch = hasOverride ? config.cursor.ref : null;

  if (opts.unset && (name || opts.useCurrent)) {
    console.log(chalk.red('  Use either --unset OR a branch value, not both.'));
    process.exit(1);
  }

  if (name && opts.useCurrent) {
    console.log(chalk.red('  Use either --use-current OR a branch value, not both.'));
    process.exit(1);
  }

  if (opts.unset) {
    if (config.cursor?.ref) {
      delete config.cursor.ref;
      if (config.cursor && Object.keys(config.cursor).length === 0) delete config.cursor;
      saveConfig(configPath, config);
    }

    console.log('');
    console.log(chalk.green('  ✓ Cleared branch override.'));
    console.log(chalk.dim(`  Effective branch now follows git: ${currentGitBranch}`));
    console.log('');
    return;
  }

  if (opts.useCurrent) {
    setBranchOverride(config, configPath, currentGitBranch);
    console.log('');
    console.log(chalk.green(`  ✓ Set Cursor branch override to current git branch: ${chalk.bold(currentGitBranch)}`));
    console.log('');
    return;
  }

  if (name) {
    const branch = String(name).trim();
    if (!branch) {
      console.log(chalk.red('  Branch cannot be empty.'));
      process.exit(1);
    }
    if (!/^[A-Za-z0-9._/-]+$/.test(branch)) {
      console.log(chalk.red('  Invalid branch name. Use letters, numbers, ., _, -, /.'));
      process.exit(1);
    }

    setBranchOverride(config, configPath, branch);
    console.log('');
    console.log(chalk.green(`  ✓ Set Cursor branch override: ${chalk.bold(branch)}`));
    if (branch !== currentGitBranch) {
      console.log(chalk.dim(`    (current git branch is ${currentGitBranch})`));
    }
    console.log('');
    return;
  }

  const effective = overrideBranch || currentGitBranch;
  console.log('');
  console.log(chalk.bold('  AgentXchain Branch'));
  console.log(chalk.dim('  ' + '─'.repeat(36)));
  console.log('');
  console.log(`  ${chalk.dim('Current git branch:')} ${currentGitBranch}`);
  console.log(`  ${chalk.dim('Cursor override:')}    ${overrideBranch || chalk.dim('none')}`);
  console.log(`  ${chalk.dim('Effective branch:')}   ${chalk.bold(effective)}`);
  console.log('');
  console.log(chalk.dim('  Commands:'));
  console.log(`    ${chalk.bold('agentxchain branch')}               Show effective branch`);
  console.log(`    ${chalk.bold('agentxchain branch <name>')}        Set branch override`);
  console.log(`    ${chalk.bold('agentxchain branch --use-current')} Set override to current git branch`);
  console.log(`    ${chalk.bold('agentxchain branch --unset')}       Follow git branch automatically`);
  console.log('');
}

function setBranchOverride(config, configPath, branch) {
  if (!config.cursor) config.cursor = {};
  config.cursor.ref = branch;
  saveConfig(configPath, config);
}

function saveConfig(configPath, config) {
  safeWriteJson(configPath, config);
}
