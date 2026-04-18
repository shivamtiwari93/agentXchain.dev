import { readFileSync } from 'fs';
import { join } from 'path';
import chalk from 'chalk';
import { findProjectRoot, loadConfig, loadProjectContext } from '../lib/config.js';
import { validateGovernedProject, validateProject } from '../lib/validation.js';
import { getGovernedVersionSurface, formatGovernedVersionLabel } from '../lib/protocol-version.js';
import { detectConfigVersion, loadNormalizedConfig } from '../lib/normalized-config.js';

export async function validateCommand(opts) {
  const root = findProjectRoot(process.cwd());
  if (!root) {
    console.log(chalk.red('No agentxchain.json found. Run `agentxchain init` first.'));
    process.exit(1);
  }

  const mode = opts.mode || 'full';
  let rawConfig;
  try {
    rawConfig = JSON.parse(readFileSync(join(root, 'agentxchain.json'), 'utf8'));
  } catch (err) {
    console.log(chalk.red(`agentxchain.json is invalid JSON: ${err.message}`));
    process.exit(1);
  }

  if (detectConfigVersion(rawConfig) === 4) {
    const normalized = loadNormalizedConfig(rawConfig, root);
    const validation = normalized.ok
      ? validateGovernedProject(root, rawConfig, normalized.normalized, {
          mode,
          expectedAgent: opts.agent || null,
        })
      : {
          ok: false,
          mode,
          errors: normalized.errors,
          warnings: normalized.warnings || [],
        };
    const governedVersionSurface = getGovernedVersionSurface(rawConfig);

    if (opts.json) {
      console.log(JSON.stringify({
        ...validation,
        protocol_mode: 'governed',
        ...governedVersionSurface,
        version: 4,
      }, null, 2));
    } else {
      console.log('');
      console.log(chalk.bold(`  AgentXchain Validate (${mode})`));
      console.log(chalk.dim('  ' + '─'.repeat(44)));
      console.log(chalk.dim(`  Root: ${root}`));
      console.log(chalk.dim(`  Protocol: governed (${formatGovernedVersionLabel(rawConfig)})`));
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
    return;
  }

  const context = loadProjectContext();
  if (!context) {
    console.log(chalk.red('No agentxchain.json found. Run `agentxchain init` first.'));
    process.exit(1);
  }

  const validation = validateProject(context.root, loadConfig()?.config || context.rawConfig, {
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
