import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import chalk from 'chalk';
import { CONFIG_FILE, findProjectRoot } from '../lib/config.js';
import {
  validateGovernedProjectTemplate,
  validateGovernedTemplateRegistry,
} from '../lib/governed-templates.js';

function loadProjectTemplateValidation() {
  const root = findProjectRoot();
  if (!root) {
    return {
      present: false,
      root: null,
      template: null,
      source: null,
      ok: true,
      errors: [],
      warnings: [],
    };
  }

  const configPath = join(root, CONFIG_FILE);
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(configPath, 'utf8'));
  } catch (err) {
    return {
      present: true,
      root,
      template: null,
      source: 'agentxchain.json',
      ok: false,
      errors: [`Failed to parse ${CONFIG_FILE}: ${err.message}`],
      warnings: [],
    };
  }

  const projectValidation = validateGovernedProjectTemplate(parsed.template);
  return {
    present: true,
    root,
    ...projectValidation,
  };
}

export function templateValidateCommand(opts = {}) {
  const registry = validateGovernedTemplateRegistry();
  const project = loadProjectTemplateValidation();
  const errors = [...registry.errors, ...project.errors];
  const warnings = [...registry.warnings, ...project.warnings];
  const ok = errors.length === 0;

  const payload = {
    ok,
    registry,
    project,
    errors,
    warnings,
  };

  if (opts.json) {
    console.log(JSON.stringify(payload, null, 2));
    if (!ok) process.exit(1);
    return;
  }

  console.log('');
  console.log(chalk.bold('  AgentXchain Template Validate'));
  console.log(chalk.dim('  ' + '─'.repeat(44)));
  console.log('');

  if (ok) {
    console.log(chalk.green('  ✓ Template validation passed.'));
  } else {
    console.log(chalk.red(`  ✗ Template validation failed (${errors.length} errors).`));
  }

  console.log('');
  console.log(`  ${chalk.dim('Registry:')} ${registry.ok ? chalk.green('OK') : chalk.red('FAIL')} (${registry.registered_ids.length} registered, ${registry.manifest_ids.length} manifests)`);

  if (project.present) {
    const sourceLabel = project.source === 'implicit_default'
      ? 'implicit default'
      : project.source;
    console.log(`  ${chalk.dim('Project:')}  ${project.ok ? chalk.green('OK') : chalk.red('FAIL')} (${project.template} via ${sourceLabel})`);
    if (project.root && existsSync(project.root)) {
      console.log(`  ${chalk.dim('Root:')}     ${project.root}`);
    }
  } else {
    console.log(`  ${chalk.dim('Project:')}  ${chalk.dim('No project detected; registry-only validation')}`);
  }

  if (errors.length > 0) {
    console.log('');
    console.log(chalk.red('  Errors:'));
    for (const error of errors) {
      console.log(`    - ${error}`);
    }
  }

  if (warnings.length > 0) {
    console.log('');
    console.log(chalk.yellow('  Warnings:'));
    for (const warning of warnings) {
      console.log(`    - ${warning}`);
    }
  }

  console.log('');
  if (!ok) process.exit(1);
}
