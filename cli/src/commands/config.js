import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { loadProjectContext, CONFIG_FILE } from '../lib/config.js';
import { validateConfigSchema } from '../lib/schema.js';
import { validateV4Config } from '../lib/normalized-config.js';

export async function configCommand(opts) {
  const context = loadProjectContext();
  if (!context) {
    console.log(chalk.red('  No agentxchain.json found. Run `agentxchain init` first.'));
    process.exit(1);
  }

  const { root, rawConfig, version } = context;
  const config = rawConfig;
  const configPath = join(root, CONFIG_FILE);

  if (opts.get && opts.set) {
    console.log(chalk.red('  --get and --set are mutually exclusive.'));
    console.log(chalk.dim('  Inspect a value with `agentxchain config --get <path>` or change it with `agentxchain config --set <path> <value>`.'));
    process.exit(1);
  }

  if (version === 4 && opts.addAgent) {
    printLegacyOnlyMutationError('--add-agent');
    return;
  }

  if (opts.addAgent) {
    await addAgent(config, configPath);
    return;
  }

  if (version === 4 && opts.removeAgent) {
    printLegacyOnlyMutationError('--remove-agent');
    return;
  }

  if (opts.removeAgent) {
    removeAgent(config, configPath, opts.removeAgent);
    return;
  }

  if (opts.get) {
    getSetting(config, opts.get, { json: opts.json });
    return;
  }

  if (opts.set) {
    setSetting(config, configPath, opts.set, { version, root });
    return;
  }

  if (opts.json) {
    console.log(JSON.stringify(config, null, 2));
    return;
  }

  if (version === 4) {
    printGovernedConfig(config);
    return;
  }

  printLegacyConfig(config);
}

function printLegacyConfig(config) {
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
  console.log(`    ${chalk.bold('agentxchain config --get <key>')}         Read one config value`);
  console.log(`    ${chalk.bold('agentxchain config --set <key> <val>')}   Update a setting`);
  console.log(`    ${chalk.bold('agentxchain config --json')}              Output as JSON`);
  console.log('');
}

function printGovernedConfig(config) {
  console.log('');
  console.log(chalk.bold('  AgentXchain Governed Config'));
  console.log(chalk.dim('  ' + '─'.repeat(40)));
  console.log('');
  console.log(`  ${chalk.dim('Project:')}   ${config.project?.name || '(unknown)'}`);
  console.log(`  ${chalk.dim('Project ID:')} ${config.project?.id || '(unknown)'}`);
  console.log(`  ${chalk.dim('Goal:')}      ${config.project?.goal || '(not set)'}`);
  console.log(`  ${chalk.dim('Template:')}  ${config.template || 'generic'}`);
  console.log(`  ${chalk.dim('Roles:')}     ${Object.keys(config.roles || {}).length}`);
  console.log(`  ${chalk.dim('Runtimes:')}  ${Object.keys(config.runtimes || {}).length}`);
  console.log('');
  console.log(chalk.dim('  Commands:'));
  console.log(`    ${chalk.bold('agentxchain config --get project.goal')}              Read one config value without opening JSON`);
  console.log(`    ${chalk.bold('agentxchain config --set project.goal "Build a ..."')}  Set mission context without hand-editing JSON`);
  console.log(`    ${chalk.bold('agentxchain config --set roles.qa.runtime manual-qa')}  Switch a governed role runtime`);
  console.log(`    ${chalk.bold('agentxchain config --json')}                             Output raw config`);
  console.log('');
}

function printLegacyOnlyMutationError(flag) {
  console.log(chalk.red(`  ${flag} is legacy-only.`));
  console.log(chalk.dim('  Governed repos use roles and runtimes instead of legacy v3 agents.'));
  console.log(chalk.dim('  Use `agentxchain config --set <path> <value>` for governed config changes.'));
  process.exit(1);
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
  if (Object.keys(config.agents).length <= 1) {
    console.log(chalk.red('  Cannot remove the last agent.'));
    console.log(chalk.dim('  Add another agent first, then remove this one if needed.'));
    process.exit(1);
  }
  delete config.agents[id];
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');

  console.log('');
  console.log(chalk.green(`  ✓ Removed agent ${chalk.bold(id)} (${name})`));
  console.log(`  ${chalk.dim('Agents now:')} ${Object.keys(config.agents).join(', ')}`);
  console.log('');
}

function setSetting(config, configPath, keyValPair, context) {
  const parsed = parseSetInput(keyValPair);
  if (!parsed) {
    console.log(chalk.red('  Usage: agentxchain config --set <key> <value>'));
    console.log(chalk.dim('  Example: agentxchain config --set project.goal "Build a governed CLI"'));
    process.exit(1);
  }

  const { key, rawVal } = parsed;
  const segments = parseKeyPath(key);
  if (!segments) {
    console.log(chalk.red('  Refusing to write reserved object path.'));
    process.exit(1);
  }

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
  const validation = validateEditedConfig(config, context);
  if (!validation.ok) {
    target[lastKey] = oldVal;
    if (oldVal === undefined) {
      delete target[lastKey];
    }
    console.log(chalk.red(`  Refusing to save invalid config: ${validation.errors.join(', ')}`));
    process.exit(1);
  }
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');

  console.log('');
  console.log(chalk.green(`  ✓ Set ${chalk.bold(key)} = ${val}`));
  if (oldVal !== undefined) console.log(chalk.dim(`    (was: ${oldVal})`));
  if ((validation.warnings || []).length > 0) {
    console.log(chalk.yellow('  Warnings:'));
    for (const warning of validation.warnings) {
      console.log(chalk.dim(`    - ${warning}`));
    }
  }
  console.log('');
}

function getSetting(config, key, opts = {}) {
  const segments = parseKeyPath(key);
  if (!segments) {
    console.log(chalk.red('  Refusing to read reserved object path.'));
    process.exit(1);
  }

  let value = config;
  for (const segment of segments) {
    if (value === null || typeof value !== 'object' || !(segment in value)) {
      console.log(chalk.red(`  Config path not found: ${key}`));
      process.exit(1);
    }
    value = value[segment];
  }

  if (opts.json) {
    console.log(JSON.stringify(value, null, 2));
    return;
  }

  if (value !== null && typeof value === 'object') {
    console.log(JSON.stringify(value, null, 2));
    return;
  }

  console.log(String(value));
}

function parseSetInput(input) {
  if (Array.isArray(input)) {
    if (input.length >= 2) {
      return { key: input[0], rawVal: input.slice(1).join(' ') };
    }
    if (input.length === 1 && typeof input[0] === 'string') {
      const parts = input[0].trim().split(/\s+/);
      if (parts.length >= 2) {
        return { key: parts[0], rawVal: parts.slice(1).join(' ') };
      }
    }
    return null;
  }

  if (typeof input === 'string') {
    const parts = input.trim().split(/\s+/);
    if (parts.length >= 2) {
      return { key: parts[0], rawVal: parts.slice(1).join(' ') };
    }
  }

  return null;
}

function parseKeyPath(input) {
  if (typeof input !== 'string' || input.trim() === '') {
    return null;
  }

  const segments = input.split('.');
  const forbiddenKeys = new Set(['__proto__', 'prototype', 'constructor']);
  if (segments.some(segment => segment === '' || forbiddenKeys.has(segment))) {
    return null;
  }
  return segments;
}

function validateEditedConfig(config, context) {
  if (context.version === 4) {
    return validateV4Config(config, context.root);
  }
  return validateConfigSchema(config);
}
