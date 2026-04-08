import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import chalk from 'chalk';
import { CONFIG_FILE } from '../lib/config.js';
import { loadGovernedTemplate, VALID_GOVERNED_TEMPLATE_IDS, SYSTEM_SPEC_OVERLAY_SEPARATOR } from '../lib/governed-templates.js';

const LEDGER_PATH = '.agentxchain/decision-ledger.jsonl';
const PROMPT_OVERRIDE_SEPARATOR = '## Project-Type-Specific Guidance';
const ACCEPTANCE_HINTS_SEPARATOR = '## Template Guidance';

function interpolateTemplateContent(contentTemplate, projectName) {
  return contentTemplate.replaceAll('{{project_name}}', projectName);
}

function appendJsonl(root, relPath, entry) {
  const filePath = join(root, relPath);
  mkdirSync(dirname(filePath), { recursive: true });
  const line = JSON.stringify(entry) + '\n';
  writeFileSync(filePath, line, { flag: 'a' });
}

export async function templateSetCommand(templateId, opts) {
  const root = process.cwd();
  const governedWorkspacePath = join(root, '.agentxchain');

  // ── Validate governed project ──────────────────────────────────────────
  const configPath = join(root, CONFIG_FILE);
  if (!existsSync(configPath)) {
    console.error(chalk.red('  Error: No agentxchain.json found.'));
    process.exit(1);
  }

  let config;
  try {
    config = JSON.parse(readFileSync(configPath, 'utf8'));
  } catch (err) {
    console.error(chalk.red(`  Error: Failed to read agentxchain.json: ${err.message}`));
    process.exit(1);
  }

  if (config.schema_version !== '1.0' && config.schema_version !== '1.1') {
    console.error(chalk.red('  Error: This is not a governed project. template set requires a governed project (schema_version 1.0 or 1.1).'));
    process.exit(1);
  }

  if (!existsSync(governedWorkspacePath)) {
    console.error(chalk.red('  Error: Governed workspace missing. template set requires an existing .agentxchain/ directory.'));
    process.exit(1);
  }

  // ── Validate template ID ──────────────────────────────────────────────
  if (!VALID_GOVERNED_TEMPLATE_IDS.includes(templateId)) {
    console.error(chalk.red(`  Error: Unknown template "${templateId}".`));
    console.error(`  Available templates: ${VALID_GOVERNED_TEMPLATE_IDS.join(', ')}`);
    process.exit(1);
  }

  // ── Same template = no-op ─────────────────────────────────────────────
  const previousTemplate = config.template || 'generic';
  if (previousTemplate === templateId) {
    console.log(chalk.green(`  Already set to "${templateId}". No changes.`));
    process.exit(0);
  }

  // ── Load manifest ─────────────────────────────────────────────────────
  const manifest = loadGovernedTemplate(templateId);
  if (manifest.scaffold_blueprint) {
    console.error(chalk.red(`  Error: Template "${templateId}" defines a custom governed team blueprint.`));
    console.error(chalk.yellow(`  Use ${chalk.bold(`agentxchain init --governed --template ${templateId}`)} for new repos.`));
    console.error(chalk.yellow('  Retrofitting an existing repo to a blueprint-backed team is deferred until a dedicated migrator exists.'));
    process.exit(1);
  }
  const projectName = config.project?.name || 'Untitled';

  // ── Build mutation plan ───────────────────────────────────────────────
  const plan = {
    config_update: true,
    files_created: [],
    files_skipped: [],
    prompts_appended: [],
    prompts_existing_guidance: [],
    prompts_missing_paths: [],
    prompts_missing_files: [],
    acceptance_hints_status: 'none',
    system_spec_overlay_status: 'none',
  };

  // Planning artifacts
  for (const artifact of manifest.planning_artifacts || []) {
    const artifactPath = join(root, '.planning', artifact.filename);
    if (existsSync(artifactPath)) {
      plan.files_skipped.push(artifact.filename);
    } else {
      plan.files_created.push(artifact.filename);
    }
  }

  // Prompt overrides
  const promptOverrides = manifest.prompt_overrides || {};
  for (const roleId of Object.keys(promptOverrides)) {
    const promptRelPath = config.prompts?.[roleId];
    if (!promptRelPath) {
      plan.prompts_missing_paths.push(roleId);
      continue;
    }
    const promptPath = join(root, promptRelPath);
    if (!existsSync(promptPath)) {
      plan.prompts_missing_files.push({
        role_id: roleId,
        path: promptRelPath,
      });
      continue;
    }
    const content = readFileSync(promptPath, 'utf8');
    if (content.includes(PROMPT_OVERRIDE_SEPARATOR)) {
      plan.prompts_existing_guidance.push(roleId);
    } else {
      plan.prompts_appended.push(roleId);
    }
  }

  // Acceptance hints
  const acceptanceMatrixPath = join(root, '.planning', 'acceptance-matrix.md');
  if (Array.isArray(manifest.acceptance_hints) && manifest.acceptance_hints.length > 0) {
    if (existsSync(acceptanceMatrixPath)) {
      const matrixContent = readFileSync(acceptanceMatrixPath, 'utf8');
      if (matrixContent.includes(ACCEPTANCE_HINTS_SEPARATOR)) {
        plan.acceptance_hints_status = 'existing_guidance';
      } else {
        plan.acceptance_hints_status = 'append';
      }
    } else {
      plan.acceptance_hints_status = 'missing_file';
    }
  }

  // System spec overlay
  const systemSpecOverlay = manifest.system_spec_overlay;
  const systemSpecPath = join(root, '.planning', 'SYSTEM_SPEC.md');
  if (systemSpecOverlay && Object.keys(systemSpecOverlay).length > 0) {
    if (!existsSync(systemSpecPath)) {
      plan.system_spec_overlay_status = 'missing_file';
    } else {
      const specContent = readFileSync(systemSpecPath, 'utf8');
      if (specContent.includes(SYSTEM_SPEC_OVERLAY_SEPARATOR)) {
        plan.system_spec_overlay_status = 'existing_guidance';
      } else {
        plan.system_spec_overlay_status = 'append';
      }
    }
  }

  // ── Dry run: print plan and exit ──────────────────────────────────────
  if (opts.dryRun) {
    console.log(chalk.bold(`\n  Template: ${previousTemplate} → ${templateId}\n`));
    console.log('  Config:');
    console.log(`    agentxchain.json: template field will be updated`);
    console.log('\n  Planning artifacts:');
    for (const f of plan.files_created) {
      console.log(`    .planning/${f}: ${chalk.green('WILL CREATE')}`);
    }
    for (const f of plan.files_skipped) {
      console.log(`    .planning/${f}: ${chalk.dim('EXISTS (skip)')}`);
    }
    if (plan.files_created.length === 0 && plan.files_skipped.length === 0) {
      console.log(`    ${chalk.dim('(none)')}`);
    }
    console.log('\n  Prompts:');
    for (const r of plan.prompts_appended) {
      const p = config.prompts?.[r] || `<unknown path for ${r}>`;
      console.log(`    ${p}: ${chalk.green('WILL APPEND override')}`);
    }
    for (const r of plan.prompts_existing_guidance) {
      const p = config.prompts?.[r] || `<unknown path for ${r}>`;
      console.log(`    ${p}: ${chalk.dim('ALREADY HAS guidance (skip)')}`);
    }
    for (const r of plan.prompts_missing_paths) {
      console.log(`    <no configured path for ${r}>: ${chalk.yellow('NO PROMPT PATH (skip)')}`);
    }
    for (const prompt of plan.prompts_missing_files) {
      console.log(`    ${prompt.path}: ${chalk.yellow('MISSING FILE (skip)')}`);
    }
    if (
      plan.prompts_appended.length === 0
      && plan.prompts_existing_guidance.length === 0
      && plan.prompts_missing_paths.length === 0
      && plan.prompts_missing_files.length === 0
    ) {
      console.log(`    ${chalk.dim('(none)')}`);
    }
    console.log('\n  Acceptance hints:');
    if (plan.acceptance_hints_status === 'append') {
      console.log(`    .planning/acceptance-matrix.md: ${chalk.green('WILL APPEND template guidance')}`);
    } else if (plan.acceptance_hints_status === 'existing_guidance') {
      console.log(`    .planning/acceptance-matrix.md: ${chalk.dim('ALREADY HAS guidance (skip)')}`);
    } else if (plan.acceptance_hints_status === 'missing_file') {
      console.log(`    .planning/acceptance-matrix.md: ${chalk.yellow('MISSING FILE (skip)')}`);
    } else {
      console.log(`    ${chalk.dim('(none)')}`);
    }
    console.log('\n  System spec overlay:');
    if (plan.system_spec_overlay_status === 'append') {
      console.log(`    .planning/SYSTEM_SPEC.md: ${chalk.green('WILL APPEND template guidance')}`);
    } else if (plan.system_spec_overlay_status === 'existing_guidance') {
      console.log(`    .planning/SYSTEM_SPEC.md: ${chalk.dim('ALREADY HAS guidance (skip)')}`);
    } else if (plan.system_spec_overlay_status === 'missing_file') {
      console.log(`    .planning/SYSTEM_SPEC.md: ${chalk.yellow('MISSING FILE (skip)')}`);
    } else {
      console.log(`    ${chalk.dim('(none)')}`);
    }
    console.log(chalk.dim('\n  No changes written. Use without --dry-run to apply.\n'));
    process.exit(0);
  }

  // ── Confirmation prompt ───────────────────────────────────────────────
  if (!opts.yes) {
    console.log(chalk.bold(`\n  Template: ${previousTemplate} → ${templateId}`));
    console.log(`  ${plan.files_created.length} files to create, ${plan.prompts_appended.length} prompts to append.\n`);
    const readline = await import('node:readline');
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise((resolve) => {
      rl.question('  Apply changes? [y/N] ', resolve);
    });
    rl.close();
    if (answer.trim().toLowerCase() !== 'y') {
      console.log(chalk.dim('  Aborted.'));
      process.exit(0);
    }
  }

  // ── Execute mutations ─────────────────────────────────────────────────

  // 1. Update config
  config.template = templateId;
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');

  // 2. Create planning artifacts
  mkdirSync(join(root, '.planning'), { recursive: true });
  for (const artifact of manifest.planning_artifacts || []) {
    const artifactPath = join(root, '.planning', artifact.filename);
    if (!existsSync(artifactPath)) {
      writeFileSync(
        artifactPath,
        interpolateTemplateContent(artifact.content_template, projectName)
      );
    }
  }

  // 3. Append prompt overrides
  for (const roleId of plan.prompts_appended) {
    const promptPath = join(root, config.prompts[roleId]);
    const content = readFileSync(promptPath, 'utf8');
    const override = promptOverrides[roleId];
    const appended = `${content}\n\n---\n\n${PROMPT_OVERRIDE_SEPARATOR}\n\n${override.trim()}\n`;
    writeFileSync(promptPath, appended);
  }
  // Warn about skipped prompts when switching templates
  for (const roleId of plan.prompts_existing_guidance) {
    console.log(chalk.yellow(`  Warning: Prompt for ${roleId} already has project-type guidance. Skipping. Edit manually if you want the new template's guidance.`));
  }
  for (const roleId of plan.prompts_missing_paths) {
    console.log(chalk.yellow(`  Warning: Prompt for ${roleId} has no configured path in agentxchain.json. Skipping template guidance.`));
  }
  for (const prompt of plan.prompts_missing_files) {
    console.log(chalk.yellow(`  Warning: Prompt file for ${prompt.role_id} not found at ${prompt.path}. Skipping template guidance.`));
  }

  // 4. Append acceptance hints
  if (plan.acceptance_hints_status === 'append' && existsSync(acceptanceMatrixPath)) {
    const matrixContent = readFileSync(acceptanceMatrixPath, 'utf8');
    const hintLines = manifest.acceptance_hints.map((hint) => `- [ ] ${hint}`).join('\n');
    const appended = `${matrixContent}\n\n${ACCEPTANCE_HINTS_SEPARATOR}\n\n${hintLines}\n`;
    writeFileSync(acceptanceMatrixPath, appended);
  } else if (plan.acceptance_hints_status === 'missing_file') {
    console.log(chalk.yellow('  Warning: .planning/acceptance-matrix.md not found. Skipping template guidance hints.'));
  }

  // 5. Append system spec overlay
  if (plan.system_spec_overlay_status === 'append' && existsSync(systemSpecPath)) {
    const specContent = readFileSync(systemSpecPath, 'utf8');
    const guidanceLines = [];
    if (systemSpecOverlay.purpose_guidance) guidanceLines.push(`**Purpose:** ${systemSpecOverlay.purpose_guidance}`);
    if (systemSpecOverlay.interface_guidance) guidanceLines.push(`**Interface:** ${systemSpecOverlay.interface_guidance}`);
    if (systemSpecOverlay.behavior_guidance) guidanceLines.push(`**Behavior:** ${systemSpecOverlay.behavior_guidance}`);
    if (systemSpecOverlay.error_cases_guidance) guidanceLines.push(`**Error Cases:** ${systemSpecOverlay.error_cases_guidance}`);
    if (systemSpecOverlay.acceptance_tests_guidance) guidanceLines.push(`**Acceptance Tests:**\n${systemSpecOverlay.acceptance_tests_guidance}`);
    if (systemSpecOverlay.extra_sections) guidanceLines.push(systemSpecOverlay.extra_sections);
    const guidanceBlock = guidanceLines.join('\n\n');
    const appended = `${specContent}\n\n${SYSTEM_SPEC_OVERLAY_SEPARATOR}\n\n${guidanceBlock}\n`;
    writeFileSync(systemSpecPath, appended);
  } else if (plan.system_spec_overlay_status === 'missing_file') {
    console.log(chalk.yellow('  Warning: .planning/SYSTEM_SPEC.md not found. Skipping template spec overlay.'));
  }

  // 6. Decision ledger
  const ledgerEntry = {
    type: 'template_set',
    timestamp: new Date().toISOString(),
    previous_template: previousTemplate,
    new_template: templateId,
    files_created: plan.files_created,
    files_skipped: plan.files_skipped,
    prompts_appended: plan.prompts_appended,
    prompts_skipped: [
      ...plan.prompts_existing_guidance,
      ...plan.prompts_missing_paths,
      ...plan.prompts_missing_files.map((prompt) => prompt.role_id),
    ],
    prompt_missing_paths: plan.prompts_missing_paths,
    prompt_missing_files: plan.prompts_missing_files,
    acceptance_hints_appended: plan.acceptance_hints_status === 'append',
    acceptance_hints_skipped_reason: plan.acceptance_hints_status === 'append' ? null : plan.acceptance_hints_status,
    system_spec_overlay_appended: plan.system_spec_overlay_status === 'append',
    system_spec_overlay_skipped_reason: plan.system_spec_overlay_status === 'append' ? null : plan.system_spec_overlay_status,
    operator: 'human',
  };
  appendJsonl(root, LEDGER_PATH, ledgerEntry);

  // ── Summary ───────────────────────────────────────────────────────────
  console.log(chalk.green(`\n  Template set to "${templateId}".`));
  if (plan.files_created.length > 0) {
    console.log(`  Created: ${plan.files_created.map(f => `.planning/${f}`).join(', ')}`);
  }
  if (plan.prompts_appended.length > 0) {
    console.log(`  Appended guidance to: ${plan.prompts_appended.join(', ')} prompts`);
  }
  if (plan.acceptance_hints_status === 'append') {
    console.log(`  Appended template guidance to acceptance-matrix.md`);
  }
  if (plan.system_spec_overlay_status === 'append') {
    console.log(`  Appended template-specific guidance to SYSTEM_SPEC.md`);
  }
  console.log('');
}
