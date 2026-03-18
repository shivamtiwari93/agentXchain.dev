import { writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { CONFIG_FILE, LOCK_FILE, STATE_FILE } from '../lib/config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = join(__dirname, '../templates');

const DEFAULT_AGENTS = {
  pm: {
    name: 'Product Manager',
    mandate: 'Quality uplift, purchase blockers, voice of customer. Frame decisions from the user perspective. Production quality, not demo quality.'
  },
  dev: {
    name: 'Fullstack Developer',
    mandate: 'Implement features, run build/lint/test, use tools (git, npm). Every turn must produce working code. Push back on vague requirements.'
  },
  qa: {
    name: 'QA Engineer',
    mandate: 'Test coverage, regression, acceptance criteria. Run the app, try to break things. File bugs with reproduction steps.'
  },
  ux: {
    name: 'UX & Compression',
    mandate: 'Review UI/UX from a first-time user perspective. Compress context when log exceeds word limit.'
  }
};

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function loadTemplates() {
  const templates = [];
  try {
    const files = readdirSync(TEMPLATES_DIR).filter(f => f.endsWith('.json'));
    for (const file of files) {
      const raw = readFileSync(join(TEMPLATES_DIR, file), 'utf8');
      const tmpl = JSON.parse(raw);
      templates.push({ id: file.replace('.json', ''), ...tmpl });
    }
  } catch {}
  return templates;
}

export async function initCommand(opts) {
  let project, agents, folderName, rules;

  if (opts.yes) {
    project = 'My AgentXchain project';
    agents = DEFAULT_AGENTS;
    folderName = slugify(project);
    rules = { max_consecutive_claims: 2, require_message: true, compress_after_words: 5000 };
  } else {
    const templates = loadTemplates();

    // Template selection
    const templateChoices = [
      { name: `${chalk.cyan('Custom')} — define your own agents`, value: 'custom' },
      { name: `${chalk.cyan('Default')} — PM, Dev, QA, UX (4 agents)`, value: 'default' },
      ...templates.map(t => ({
        name: `${chalk.cyan(t.label)} — ${t.description} (${Object.keys(t.agents).length} agents)`,
        value: t.id
      }))
    ];

    const { template } = await inquirer.prompt([{
      type: 'list',
      name: 'template',
      message: 'Choose a team template:',
      choices: templateChoices
    }]);

    if (template !== 'custom' && template !== 'default') {
      const tmpl = templates.find(t => t.id === template);
      agents = tmpl.agents;
      rules = tmpl.rules || {};
      const { projectName } = await inquirer.prompt([{
        type: 'input',
        name: 'projectName',
        message: 'Project name:',
        default: tmpl.project
      }]);
      project = projectName;
    } else if (template === 'default') {
      agents = DEFAULT_AGENTS;
      rules = { max_consecutive_claims: 2, require_message: true, compress_after_words: 5000 };
      const { projectName } = await inquirer.prompt([{
        type: 'input',
        name: 'projectName',
        message: 'Project name:',
        default: 'My AgentXchain project'
      }]);
      project = projectName;
    } else {
      const { projectName } = await inquirer.prompt([{
        type: 'input',
        name: 'projectName',
        message: 'Project name:',
        default: 'My AgentXchain project'
      }]);
      project = projectName;
      agents = {};
      rules = { max_consecutive_claims: 2, require_message: true, compress_after_words: 5000 };
      let adding = true;
      while (adding) {
        const agent = await inquirer.prompt([
          {
            type: 'input', name: 'id', message: 'Agent ID (lowercase, no spaces):',
            validate: v => {
              if (!v.match(/^[a-z0-9-]+$/)) return 'Lowercase letters, numbers, hyphens only.';
              if (v === 'human' || v === 'system') return `"${v}" is reserved.`;
              if (agents[v]) return `"${v}" already added.`;
              return true;
            }
          },
          { type: 'input', name: 'name', message: 'Display name:' },
          { type: 'input', name: 'mandate', message: 'Mandate (what this agent does):' },
          { type: 'confirm', name: 'more', message: 'Add another agent?', default: true }
        ]);
        agents[agent.id] = { name: agent.name, mandate: agent.mandate };
        adding = agent.more;
      }
    }

    folderName = slugify(project);
    const { folder } = await inquirer.prompt([{
      type: 'input',
      name: 'folder',
      message: 'Folder name:',
      default: folderName
    }]);
    folderName = folder;
  }

  const dir = resolve(process.cwd(), folderName);

  if (existsSync(dir) && existsSync(join(dir, CONFIG_FILE))) {
    if (!opts.yes) {
      const { overwrite } = await inquirer.prompt([{
        type: 'confirm',
        name: 'overwrite',
        message: `${folderName}/ already has agentxchain.json. Overwrite?`,
        default: false
      }]);
      if (!overwrite) {
        console.log(chalk.yellow('  Aborted.'));
        return;
      }
    }
  }

  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  const config = {
    version: 3,
    project,
    agents,
    log: 'log.md',
    state_file: 'state.md',
    history_file: 'history.jsonl',
    rules: {
      max_consecutive_claims: rules.max_consecutive_claims || 2,
      require_message: rules.require_message !== false,
      compress_after_words: rules.compress_after_words || 5000,
      ttl_minutes: rules.ttl_minutes || 10,
      watch_interval_ms: rules.watch_interval_ms || 5000,
      ...(rules.verify_command ? { verify_command: rules.verify_command } : {})
    }
  };

  const lock = { holder: null, last_released_by: null, turn_number: 0, claimed_at: null };
  const state = { phase: 'discovery', blocked: false, blocked_on: null, project };

  writeFileSync(join(dir, CONFIG_FILE), JSON.stringify(config, null, 2) + '\n');
  writeFileSync(join(dir, LOCK_FILE), JSON.stringify(lock, null, 2) + '\n');
  writeFileSync(join(dir, 'state.json'), JSON.stringify(state, null, 2) + '\n');
  writeFileSync(join(dir, 'state.md'), `# ${project} — Current State\n\n## Architecture\n\n(Agents update this each turn with current decisions.)\n\n## Active Work\n\n(What's in progress right now.)\n\n## Open Issues\n\n(Bugs, blockers, risks.)\n\n## Next Steps\n\n(What should happen next.)\n`);
  writeFileSync(join(dir, 'history.jsonl'), '');
  writeFileSync(join(dir, 'log.md'), `# ${project} — Agent Log\n\n## COMPRESSED CONTEXT\n\n(No compressed context yet.)\n\n## MESSAGE LOG\n\n(Agents append messages below this line.)\n`);
  writeFileSync(join(dir, 'HUMAN_TASKS.md'), '# Human Tasks\n\n(Agents append tasks here when they need human action.)\n');

  const agentCount = Object.keys(agents).length;
  console.log('');
  console.log(chalk.green(`  ✓ Created ${chalk.bold(folderName)}/`));
  console.log('');
  console.log(`    ${chalk.dim('├──')} agentxchain.json  ${chalk.dim(`(${agentCount} agents)`)}`);
  console.log(`    ${chalk.dim('├──')} lock.json`);
  console.log(`    ${chalk.dim('├──')} state.json`);
  console.log(`    ${chalk.dim('├──')} state.md`);
  console.log(`    ${chalk.dim('├──')} history.jsonl`);
  console.log(`    ${chalk.dim('├──')} log.md`);
  console.log(`    ${chalk.dim('└──')} HUMAN_TASKS.md`);
  console.log('');
  console.log(`  ${chalk.dim('Agents:')} ${Object.keys(agents).join(', ')}`);
  console.log('');
  console.log(`  ${chalk.cyan('Next:')}`);
  console.log(`    ${chalk.bold(`cd ${folderName}`)}`);
  console.log(`    ${chalk.bold('agentxchain watch')}    ${chalk.dim('# start the referee')}`);
  console.log(`    ${chalk.bold('agentxchain start')}    ${chalk.dim('# launch agents in your IDE')}`);
  console.log('');
}
