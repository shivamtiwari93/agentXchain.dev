#!/usr/bin/env node

import { Command } from 'commander';
import { initCommand } from '../src/commands/init.js';
import { statusCommand } from '../src/commands/status.js';
import { startCommand } from '../src/commands/start.js';
import { stopCommand } from '../src/commands/stop.js';
import { configCommand } from '../src/commands/config.js';
import { updateCommand } from '../src/commands/update.js';
import { watchCommand } from '../src/commands/watch.js';
import { claimCommand, releaseCommand } from '../src/commands/claim.js';
import { branchCommand } from '../src/commands/branch.js';

const program = new Command();

program
  .name('agentxchain')
  .description('Multi-agent coordination in your IDE')
  .version('0.4.0');

program
  .command('init')
  .description('Create a new AgentXchain project folder')
  .option('-y, --yes', 'Skip prompts, use defaults')
  .action(initCommand);

program
  .command('status')
  .description('Show lock status, phase, and agents')
  .option('-j, --json', 'Output as JSON')
  .action(statusCommand);

program
  .command('start')
  .description('Launch agents in your IDE')
  .option('--ide <ide>', 'Target IDE: cursor, vscode, claude-code', 'cursor')
  .option('--agent <id>', 'Launch a specific agent only')
  .option('--dry-run', 'Print what would be launched without doing it')
  .action(startCommand);

program
  .command('stop')
  .description('Stop all running agent sessions')
  .action(stopCommand);

program
  .command('config')
  .description('View or edit project configuration')
  .option('--add-agent', 'Add a new agent interactively')
  .option('--remove-agent <id>', 'Remove an agent by ID')
  .option('--set <key_value>', 'Set a config value (e.g. --set "rules.max_consecutive_claims 3")')
  .option('-j, --json', 'Output config as JSON')
  .action(configCommand);

program
  .command('branch [name]')
  .description('Show or set the Cursor branch used for agent launches')
  .option('--use-current', 'Set override to the current local git branch')
  .option('--unset', 'Remove override and follow active git branch automatically')
  .action(branchCommand);

program
  .command('watch')
  .description('Watch lock.json and coordinate agent turns (the referee)')
  .option('--daemon', 'Run in background mode')
  .action(watchCommand);

program
  .command('claim')
  .description('Claim the lock as a human (take control)')
  .option('--force', 'Force-claim even if an agent holds the lock')
  .action(claimCommand);

program
  .command('release')
  .description('Release the lock (hand back to agents)')
  .action(releaseCommand);

program
  .command('update')
  .description('Update agentxchain CLI to the latest version')
  .action(updateCommand);

program.parse();
