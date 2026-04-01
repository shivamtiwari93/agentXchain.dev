import chalk from 'chalk';
import { loadConfig, loadProjectContext } from '../lib/config.js';
import { validateGovernedProject, validateProject } from '../lib/validation.js';

export async function validateCommand(opts) {
  const context = loadProjectContext();
  if (!context) {
    console.log(chalk.red('No agentxchain.json found. Run `agentxchain init` first.'));
    process.exit(1);
  }

  const mode = opts.mode || 'full';
  const validation = context.config.protocol_mode === 'governed'
    ? validateGovernedProject(context.root, context.rawConfig, context.config, {
        mode,
        expectedAgent: opts.agent || null,
      })
    : validateProject(context.root, loadConfig()?.config || context.rawConfig, {
        mode,
        expectedAgent: opts.agent || null,
      });

  if (opts.json) {
    console.log(JSON.stringify({
      ...validation,
      protocol_mode: context.config.protocol_mode,
      version: context.version,
    }, null, 2));
  } else {
    console.log('');
    console.log(chalk.bold(`  AgentXchain Validate (${mode})`));
    console.log(chalk.dim('  ' + '─'.repeat(44)));
    console.log(chalk.dim(`  Root: ${context.root}`));
    console.log(chalk.dim(`  Protocol: ${context.config.protocol_mode} (v${context.version})`));
    console.log('');

    if (validation.ok) {
      console.log(chalk.green('  ✓ Validation passed.'));
    } else {
      console.log(chalk.red(`  ✗ Validation failed (${validation.errors.length} errors).`));
    }

    if (validation.errors.length > 0) {
      console.log('');
      console.log(chalk.red('  Errors:'));
      for (const e of validation.errors) console.log(`    - ${e}`);
    }

    if (validation.warnings.length > 0) {
      console.log('');
      console.log(chalk.yellow('  Warnings:'));
      for (const w of validation.warnings) console.log(`    - ${w}`);
    }
    console.log('');
  }

  if (!validation.ok) process.exit(1);
}
