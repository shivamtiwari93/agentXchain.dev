import chalk from 'chalk';
import { loadConfig } from '../lib/config.js';
import { validateProject } from '../lib/validation.js';

export async function validateCommand(opts) {
  const result = loadConfig();
  if (!result) {
    console.log(chalk.red('No agentxchain.json found. Run `agentxchain init` first.'));
    process.exit(1);
  }

  const { root, config } = result;
  const mode = opts.mode || 'full';
  const validation = validateProject(root, config, {
    mode,
    expectedAgent: opts.agent || null
  });

  if (opts.json) {
    console.log(JSON.stringify(validation, null, 2));
  } else {
    console.log('');
    console.log(chalk.bold(`  AgentXchain Validate (${mode})`));
    console.log(chalk.dim('  ' + '─'.repeat(44)));
    console.log(chalk.dim(`  Root: ${root}`));
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
