import chalk from 'chalk';
import { loadAllGovernedTemplates, VALID_GOVERNED_TEMPLATE_IDS } from '../lib/governed-templates.js';
import { listWorkflowKitPhaseTemplates } from '../lib/workflow-kit-phase-templates.js';

export function templateListCommand(opts) {
  if (opts.phaseTemplates) {
    return listPhaseTemplates(opts);
  }

  if (opts.json) {
    const templates = loadAllGovernedTemplates();
    const output = templates.map((t) => ({
      id: t.id,
      display_name: t.display_name,
      description: t.description,
      planning_artifacts: (t.planning_artifacts || []).map((a) => a.filename),
      prompt_overrides: Object.keys(t.prompt_overrides || {}),
      scaffold_blueprint_roles: Object.keys(t.scaffold_blueprint?.roles || {}),
      acceptance_hints: t.acceptance_hints || [],
    }));
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  console.log(chalk.bold('\n  Available governed templates:\n'));
  const templates = loadAllGovernedTemplates();
  for (const t of templates) {
    const artifacts = (t.planning_artifacts || []).map((a) => a.filename);
    console.log(`  ${chalk.cyan(t.id)} — ${t.description}`);
    if (artifacts.length > 0) {
      console.log(`    Planning artifacts: ${artifacts.join(', ')}`);
    }
    if (t.prompt_overrides && Object.keys(t.prompt_overrides).length > 0) {
      console.log(`    Prompt overrides: ${Object.keys(t.prompt_overrides).join(', ')}`);
    }
    if (t.scaffold_blueprint?.roles && Object.keys(t.scaffold_blueprint.roles).length > 0) {
      console.log(`    Scaffold roles: ${Object.keys(t.scaffold_blueprint.roles).join(', ')}`);
    }
    console.log('');
  }
  console.log(chalk.dim(`  Usage: agentxchain template set <id>\n`));
  console.log(chalk.dim(`  Tip: use --phase-templates to list workflow-kit phase templates.\n`));
}

function listPhaseTemplates(opts) {
  const templates = listWorkflowKitPhaseTemplates();

  if (opts.json) {
    const output = templates.map((t) => ({
      id: t.id,
      description: t.description,
      artifacts: t.artifacts.map((a) => ({
        path: a.path,
        semantics: a.semantics || null,
        semantics_config: a.semantics_config || null,
        required: a.required,
      })),
    }));
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  console.log(chalk.bold('\n  Workflow-kit phase templates:\n'));
  for (const t of templates) {
    console.log(`  ${chalk.cyan(t.id)} — ${t.description}`);
    for (const a of t.artifacts) {
      const req = a.required ? chalk.green('required') : chalk.dim('optional');
      const sem = a.semantics ? chalk.yellow(a.semantics) : chalk.dim('none');
      console.log(`    ${a.path}  [${req}] [semantics: ${sem}]`);
      if (a.semantics === 'section_check' && a.semantics_config?.required_sections) {
        console.log(`      sections: ${a.semantics_config.required_sections.join(', ')}`);
      }
    }
    console.log('');
  }
  console.log(chalk.dim('  Usage in agentxchain.json:'));
  console.log(chalk.dim('    "workflow_kit": { "phases": { "<phase>": { "template": "<id>" } } }\n'));
}
