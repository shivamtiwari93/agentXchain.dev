import { writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { CONFIG_FILE, LOCK_FILE, STATE_FILE } from '../lib/config.js';

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

export async function initCommand(opts) {
  const dir = process.cwd();

  if (existsSync(join(dir, CONFIG_FILE)) && !opts.yes) {
    const { overwrite } = await inquirer.prompt([{
      type: 'confirm',
      name: 'overwrite',
      message: `${CONFIG_FILE} already exists. Overwrite?`,
      default: false
    }]);
    if (!overwrite) {
      console.log(chalk.yellow('Aborted.'));
      return;
    }
  }

  let project, agents;

  if (opts.yes) {
    project = 'My AgentXchain project';
    agents = DEFAULT_AGENTS;
  } else {
    const answers = await inquirer.prompt([
      {
        type: 'input',
        name: 'project',
        message: 'Project name (one line):',
        default: 'My AgentXchain project'
      },
      {
        type: 'confirm',
        name: 'useDefaults',
        message: `Use default agents (pm, dev, qa, ux)?`,
        default: true
      }
    ]);

    project = answers.project;

    if (answers.useDefaults) {
      agents = DEFAULT_AGENTS;
    } else {
      agents = {};
      let adding = true;
      while (adding) {
        const agent = await inquirer.prompt([
          { type: 'input', name: 'id', message: 'Agent ID (lowercase, no spaces):' },
          { type: 'input', name: 'name', message: 'Display name:' },
          { type: 'input', name: 'mandate', message: 'Mandate (what this agent does):' },
          { type: 'confirm', name: 'more', message: 'Add another agent?', default: true }
        ]);
        agents[agent.id] = { name: agent.name, mandate: agent.mandate };
        adding = agent.more;
      }
    }
  }

  const config = {
    version: 3,
    project,
    agents,
    log: 'log.md',
    rules: {
      max_consecutive_claims: 2,
      require_message: true,
      compress_after_words: 5000
    }
  };

  const lock = {
    holder: null,
    last_released_by: null,
    turn_number: 0,
    claimed_at: null
  };

  const state = {
    phase: 'discovery',
    blocked: false,
    blocked_on: null,
    project
  };

  writeFileSync(join(dir, CONFIG_FILE), JSON.stringify(config, null, 2) + '\n');
  writeFileSync(join(dir, LOCK_FILE), JSON.stringify(lock, null, 2) + '\n');
  writeFileSync(join(dir, STATE_FILE), JSON.stringify(state, null, 2) + '\n');

  const logFile = config.log;
  if (!existsSync(join(dir, logFile))) {
    writeFileSync(join(dir, logFile), `# ${project} — Agent Log\n\n## COMPRESSED CONTEXT\n\n(No compressed context yet.)\n\n## MESSAGE LOG\n\n(Agents append messages below this line.)\n`);
  }

  if (!existsSync(join(dir, 'HUMAN_TASKS.md'))) {
    writeFileSync(join(dir, 'HUMAN_TASKS.md'), '# Human Tasks\n\n(Agents append tasks here when they need human action.)\n');
  }

  console.log('');
  console.log(chalk.green('  AgentXchain project initialized.'));
  console.log('');
  console.log(`  ${chalk.dim('Config:')}   ${CONFIG_FILE}`);
  console.log(`  ${chalk.dim('Lock:')}     ${LOCK_FILE}`);
  console.log(`  ${chalk.dim('State:')}    ${STATE_FILE}`);
  console.log(`  ${chalk.dim('Log:')}      ${logFile}`);
  console.log(`  ${chalk.dim('Tasks:')}    HUMAN_TASKS.md`);
  console.log('');
  console.log(`  ${chalk.dim('Agents:')}   ${Object.keys(agents).join(', ')}`);
  console.log('');
  console.log(`  ${chalk.cyan('Next:')} Run ${chalk.bold('agentxchain start')} to launch agents in your IDE.`);
  console.log('');
}
