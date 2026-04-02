import chalk from 'chalk';
import { loadAllGovernedTemplates, VALID_GOVERNED_TEMPLATE_IDS } from '../lib/governed-templates.js';

export function templateListCommand(opts) {
  if (opts.json) {
    const templates = loadAllGovernedTemplates();
    const output = templates.map((t) => ({
      id: t.id,
      display_name: t.display_name,
      description: t.description,
      planning_artifacts: (t.planning_artifacts || []).map((a) => a.filename),
      prompt_overrides: Object.keys(t.prompt_overrides || {}),
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
    console.log('');
  }
  console.log(chalk.dim(`  Usage: agentxchain template set <id>\n`));
}
