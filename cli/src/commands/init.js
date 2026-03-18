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
    mandate: 'You think like a founder. Your only question is: would someone pay for this?\n\nEVERY TURN: 1) Prioritized list of what to build next (max 3 items). 2) Acceptance criteria for each. 3) One purchase blocker and its fix.\n\nCHALLENGE: If the dev over-engineered, call it out. If QA tested the wrong thing, redirect. If anyone is building for developers instead of users, shut it down.\n\nFIRST TURN: Write the MVP scope: who is the user, what is the core workflow, what are the max 5 features for v1.\n\nDON\'T: write code, design UI, or test. You decide what gets built and why.'
  },
  dev: {
    name: 'Fullstack Developer',
    mandate: 'You write production code, not prototypes. Every turn produces files that run.\n\nEVERY TURN: 1) Working code that executes. 2) Tests for what you built. 3) List of files changed. 4) Test suite output.\n\nCHALLENGE: If requirements are vague, refuse until they\'re specific. If QA found a bug, fix it properly.\n\nFIRST TURN: Set up the project: package.json, folder structure, database, health endpoint, one passing test.\n\nDON\'T: write pseudocode, skip tests, say "I would implement X" — implement it.'
  },
  qa: {
    name: 'QA Engineer',
    mandate: 'You assume everything is broken until you personally verify it works.\n\nEVERY TURN: 1) Test report: what tested, how, pass/fail. 2) For each bug: repro steps, expected vs actual, severity. 3) One test the dev didn\'t write. 4) Ship-ready verdict.\n\nCHALLENGE: If the dev says "tests pass," verify independently. Test the unhappy path. Question assumptions.\n\nFIRST TURN: Set up test infrastructure, one smoke test, list of planned test cases.\n\nDON\'T: say "looks good." Don\'t test only happy paths. Be surgical: file, line, input, output.'
  },
  ux: {
    name: 'UX Reviewer & Context Manager',
    mandate: 'You are two things: a first-time user advocate and the team\'s memory manager.\n\nUX REVIEW EVERY TURN: 1) Use the product as a first-time user. 2) Flag confusing labels, broken flows, missing feedback, accessibility issues. 3) One specific UX improvement with before/after description.\n\nCONTEXT MANAGEMENT: If the log exceeds the word limit, compress older turns into a summary. Keep: scope decisions, open bugs, architecture choices, current phase. Cut: resolved debates, verbose status updates.\n\nCHALLENGE: If the dev built something unusable, flag it before QA wastes time testing it. If the PM\'s scope creates a confusing experience, say so.\n\nDON\'T: write backend code. Don\'t redesign from scratch. Suggest incremental UX fixes.'
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

      const { count } = await inquirer.prompt([{
        type: 'number',
        name: 'count',
        message: 'How many agents on this team?',
        default: 4,
        validate: v => (v >= 2 && v <= 20) ? true : 'Between 2 and 20 agents.'
      }]);

      console.log('');
      console.log(chalk.dim(`  Define ${count} agents. For each, provide a name and describe their role.`));
      console.log('');

      for (let i = 1; i <= count; i++) {
        console.log(chalk.cyan(`  Agent ${i} of ${count}`));

        const { name } = await inquirer.prompt([{
          type: 'input',
          name: 'name',
          message: `  Name (e.g. "Product Manager", "Backend Engineer"):`,
          validate: v => v.trim().length > 0 ? true : 'Name is required.'
        }]);

        const { mandate } = await inquirer.prompt([{
          type: 'editor',
          name: 'mandate',
          message: `  Role & responsibilities for ${name} (opens editor — describe what this agent does, what they produce each turn, how they challenge others):`,
          default: `You are the ${name} on this team.\n\nEVERY TURN YOU MUST PRODUCE:\n1. \n2. \n3. \n\nHOW YOU CHALLENGE OTHERS:\n- \n\nANTI-PATTERNS:\n- `,
          waitForUseInput: false
        }]);

        const id = slugify(name);
        const uniqueId = agents[id] ? `${id}-${i}` : id;

        if (uniqueId === 'human' || uniqueId === 'system') {
          agents[`${uniqueId}-agent`] = { name, mandate: mandate.trim() };
        } else {
          agents[uniqueId] = { name, mandate: mandate.trim() };
        }

        console.log(chalk.green(`  ✓ Added ${chalk.bold(name)} (${uniqueId})`));
        console.log('');
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
