import chalk from 'chalk';
import { findProjectRoot } from '../lib/config.js';
import { planIntent } from '../lib/intake.js';
import { basename } from 'node:path';

export async function intakePlanCommand(opts) {
  const root = findProjectRoot(process.cwd());
  if (!root) {
    if (opts.json) {
      console.log(JSON.stringify({ ok: false, error: 'agentxchain.json not found' }, null, 2));
    } else {
      console.log(chalk.red('agentxchain.json not found'));
    }
    process.exit(2);
  }

  if (!opts.intent) {
    const msg = '--intent <id> is required';
    if (opts.json) {
      console.log(JSON.stringify({ ok: false, error: msg }, null, 2));
    } else {
      console.log(chalk.red(msg));
    }
    process.exit(1);
  }

  const result = planIntent(root, opts.intent, {
    projectName: opts.projectName || undefined,
    force: opts.force || false,
  });

  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.ok) {
    console.log('');
    console.log(chalk.green(`  Planned intent ${result.intent.intent_id}`));
    console.log(chalk.dim(`  Template: ${result.intent.template}`));
    if (result.artifacts_generated.length > 0) {
      console.log(chalk.dim('  Generated planning artifacts:'));
      for (const a of result.artifacts_generated) {
        console.log(chalk.dim(`    ${a}`));
      }
    } else {
      console.log(chalk.dim('  No template-specific planning artifacts to generate.'));
    }
    console.log(chalk.dim(`  Status: approved → planned`));
    console.log('');
  } else if (result.conflicts) {
    console.log('');
    console.log(chalk.red(`  Cannot plan intent ${opts.intent}`));
    console.log(chalk.red('  Existing planning artifacts would be overwritten:'));
    for (const c of result.conflicts) {
      console.log(chalk.red(`    ${c}`));
    }
    console.log(chalk.yellow('  Use --force to overwrite, or remove the existing files first.'));
    console.log('');
  } else {
    console.log(chalk.red(`  ${result.error}`));
  }

  process.exit(result.exitCode);
}
