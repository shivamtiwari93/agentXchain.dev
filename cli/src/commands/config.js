import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { loadConfig, CONFIG_FILE } from '../lib/config.js';

export async function configCommand(opts) {
  const result = loadConfig();
  if (!result) {
    console.log(chalk.red('  No agentxchain.json found. Run `agentxchain init` first.'));
    process.exit(1);
  }

  const { root, config } = result;
  const configPath = join(root, CONFIG_FILE);

  if (opts.addAgent) {
    await addAgent(config, configPath);
    return;
  }

  if (opts.removeAgent) {
    removeAgent(config, configPath, opts.removeAgent);
    return;
  }

  if (opts.set) {
    setSetting(config, configPath, opts.set);
    return;
  }

  if (opts.json) {
    console.log(JSON.stringify(config, null, 2));
    return;
  }

  printConfig(config);
}

function printConfig(config) {
  console.log('');
  console.log(chalk.bold('  AgentXchain Config'));
  console.log(chalk.dim('  ' + '─'.repeat(40)));
  console.log('');
  console.log(`  ${chalk.dim('Project:')}  ${config.project}`);
  console.log(`  ${chalk.dim('Version:')}  ${config.version}`);
  console.log(`  ${chalk.dim('Log:')}      ${config.log}`);
  console.log('');

  console.log(`  ${chalk.dim('Rules:')}`);
  for (const [key, val] of Object.entries(config.rules || {})) {
    console.log(`    ${chalk.dim(key + ':')} ${val}`);
  }
  console.log('');

  console.log(`  ${chalk.dim('Agents:')}   ${Object.keys(config.agents).length}`);
  for (const [id, agent] of Object.entries(config.agents)) {
    console.log(`    ${chalk.cyan(id)} — ${agent.name}`);
    console.log(`    ${chalk.dim(agent.mandate.slice(0, 80))}${agent.mandate.length > 80 ? '...' : ''}`);
    console.log('');
  }

  console.log(chalk.dim('  Commands:'));
  console.log(`    ${chalk.bold('agentxchain config --add-agent')}        Add a new agent`);
  console.log(`    ${chalk.bold('agentxchain config --remove-agent <id>')} Remove an agent`);
  console.log(`    ${chalk.bold('agentxchain config --set <key> <val>')}   Update a setting`);
  console.log(`    ${chalk.bold('agentxchain config --json')}              Output as JSON`);
  console.log('');
}

async function addAgent(config, configPath) {
  const answers = await inquirer.prompt([
    {
      type: 'input',
      name: 'id',
      message: 'Agent ID (lowercase, no spaces):',
      validate: (val) => {
        if (!val.match(/^[a-z0-9-]+$/)) return 'Use lowercase letters, numbers, and hyphens only.';
        if (val === 'human' || val === 'system') return `"${val}" is a reserved ID.`;
        if (config.agents[val]) return `Agent "${val}" already exists.`;
        return true;
      }
    },
    { type: 'input', name: 'name', message: 'Display name:' },
    { type: 'input', name: 'mandate', message: 'Mandate (what this agent does):' }
  ]);

  config.agents[answers.id] = { name: answers.name, mandate: answers.mandate };
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');

  console.log('');
  console.log(chalk.green(`  ✓ Added agent ${chalk.bold(answers.id)} (${answers.name})`));
  console.log(`  ${chalk.dim('Agents now:')} ${Object.keys(config.agents).join(', ')}`);
  console.log('');
}

function removeAgent(config, configPath, id) {
  if (!config.agents[id]) {
    console.log(chalk.red(`  Agent "${id}" not found.`));
    console.log(`  ${chalk.dim('Available:')} ${Object.keys(config.agents).join(', ')}`);
    process.exit(1);
  }

  const name = config.agents[id].name;
  delete config.agents[id];
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');

  console.log('');
  console.log(chalk.green(`  ✓ Removed agent ${chalk.bold(id)} (${name})`));
  console.log(`  ${chalk.dim('Agents now:')} ${Object.keys(config.agents).join(', ')}`);
  console.log('');
}

function setSetting(config, configPath, keyValPair) {
  const parts = keyValPair.split(/\s+/);
  if (parts.length < 2) {
    console.log(chalk.red('  Usage: agentxchain config --set <key> <value>'));
    console.log(chalk.dim('  Example: agentxchain config --set rules.max_consecutive_claims 3'));
    process.exit(1);
  }

  const key = parts[0];
  const rawVal = parts.slice(1).join(' ');
  const segments = key.split('.');

  let target = config;
  for (let i = 0; i < segments.length - 1; i++) {
    if (target[segments[i]] === undefined) {
      target[segments[i]] = {};
    }
    target = target[segments[i]];
  }

  const lastKey = segments[segments.length - 1];
  const oldVal = target[lastKey];

  let val = rawVal;
  if (rawVal === 'true') val = true;
  else if (rawVal === 'false') val = false;
  else if (!isNaN(rawVal) && rawVal !== '') val = Number(rawVal);

  target[lastKey] = val;
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');

  console.log('');
  console.log(chalk.green(`  ✓ Set ${chalk.bold(key)} = ${val}`));
  if (oldVal !== undefined) console.log(chalk.dim(`    (was: ${oldVal})`));
  console.log('');
}
