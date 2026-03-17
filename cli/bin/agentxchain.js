#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import { initCommand } from '../src/commands/init.js';
import { statusCommand } from '../src/commands/status.js';
import { startCommand } from '../src/commands/start.js';
import { stopCommand } from '../src/commands/stop.js';

const program = new Command();

program
  .name('agentxchain')
  .description('Multi-agent coordination in your IDE')
  .version('0.1.0');

program
  .command('init')
  .description('Initialize a new AgentXchain project')
  .option('-y, --yes', 'Skip prompts, use defaults')
  .action(initCommand);

program
  .command('status')
  .description('Show current lock status, phase, and agents')
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

program.parse();
