import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import chalk from 'chalk';
import { CONFIG_FILE, findProjectRoot } from '../lib/config.js';
import {
  validateGovernedProjectTemplate,
  validateGovernedTemplateRegistry,
  validateProjectPlanningArtifacts,
  validateAcceptanceHintCompletion,
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

  // Planning artifact completeness check
  let planningArtifacts = null;
  if (project.present && project.ok && project.root) {
    planningArtifacts = validateProjectPlanningArtifacts(project.root, project.template);
  }

  // Acceptance hint completion check
  let acceptanceHints = null;
  if (project.present && project.ok && project.root) {
    acceptanceHints = validateAcceptanceHintCompletion(project.root, project.template);
  }

  const errors = [
    ...registry.errors,
    ...project.errors,
    ...(planningArtifacts?.errors || []),
  ];
  const warnings = [
    ...registry.warnings,
    ...project.warnings,
    ...(planningArtifacts?.warnings || []),
    ...(acceptanceHints?.warnings || []),
  ];
  const ok = errors.length === 0;

  const payload = {
    ok,
    registry,
    project,
    planning_artifacts: planningArtifacts,
    acceptance_hints: acceptanceHints,
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
    if (planningArtifacts) {
      const total = planningArtifacts.expected.length;
      const found = planningArtifacts.present.length;
      if (total === 0) {
        console.log(`  ${chalk.dim('Planning:')}   ${chalk.green('OK')} (no template artifacts required)`);
      } else if (planningArtifacts.ok) {
        console.log(`  ${chalk.dim('Planning:')}   ${chalk.green('OK')} (${found}/${total} present)`);
      } else {
        console.log(`  ${chalk.dim('Planning:')}   ${chalk.red('FAIL')} (${planningArtifacts.missing.length}/${total} missing: ${planningArtifacts.missing.join(', ')})`);
      }
    }
    if (acceptanceHints) {
      if (acceptanceHints.total === 0) {
        console.log(`  ${chalk.dim('Acceptance:')} ${chalk.green('OK')} (no template hints defined)`);
      } else if (acceptanceHints.unchecked === 0) {
        console.log(`  ${chalk.dim('Acceptance:')} ${chalk.green('OK')} (${acceptanceHints.checked}/${acceptanceHints.total} checked)`);
      } else {
        console.log(`  ${chalk.dim('Acceptance:')} ${chalk.yellow('WARN')} (${acceptanceHints.unchecked}/${acceptanceHints.total} unchecked)`);
      }
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
