#!/usr/bin/env node

import { readFileSync, existsSync } from 'fs';
import { join, dirname, parse as pathParse, resolve } from 'path';
import { fileURLToPath } from 'url';
import { Command } from 'commander';

// Load .env from AgentXchain project root when available, then cwd as fallback.
(function loadDotenv() {
  const cwd = process.cwd();
  const projectRoot = findNearestProjectRoot(cwd);
  const envPaths = [];

  if (projectRoot) {
    envPaths.push(join(projectRoot, '.env'));
  }
  if (!projectRoot || projectRoot !== cwd) {
    envPaths.push(join(cwd, '.env'));
  }

  for (const envPath of envPaths) {
    if (!existsSync(envPath)) continue;
    try {
      const content = readFileSync(envPath, 'utf8');
      for (const line of content.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx === -1) continue;
        const key = trimmed.slice(0, eqIdx).trim();
        let val = trimmed.slice(eqIdx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (!process.env[key]) process.env[key] = val;
      }
    } catch {}
  }
})();

function findNearestProjectRoot(startDir) {
  let dir = resolve(startDir);
  const { root: fsRoot } = pathParse(dir);
  while (true) {
    if (existsSync(join(dir, 'agentxchain.json'))) return dir;
    if (dir === fsRoot) return null;
    dir = join(dir, '..');
  }
}
import { initCommand } from '../src/commands/init.js';
import { statusCommand } from '../src/commands/status.js';
import { startCommand } from '../src/commands/start.js';
import { stopCommand } from '../src/commands/stop.js';
import { configCommand } from '../src/commands/config.js';
import { updateCommand } from '../src/commands/update.js';
import { watchCommand } from '../src/commands/watch.js';
import { claimCommand, releaseCommand } from '../src/commands/claim.js';
import { generateCommand } from '../src/commands/generate.js';
import { doctorCommand } from '../src/commands/doctor.js';
import { superviseCommand } from '../src/commands/supervise.js';
import { validateCommand } from '../src/commands/validate.js';
import { kickoffCommand } from '../src/commands/kickoff.js';
import { rebindCommand } from '../src/commands/rebind.js';
import { branchCommand } from '../src/commands/branch.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'));

const program = new Command();

program
  .name('agentxchain')
  .description('Multi-agent coordination in your IDE')
  .version(pkg.version);

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
  .option('--remaining', 'Launch all remaining agents except PM (for PM-first flow)')
  .option('--dry-run', 'Print what would be launched without doing it')
  .action(startCommand);

program
  .command('kickoff')
  .description('Guided PM-first first-run workflow')
  .option('--ide <ide>', 'Target IDE: cursor, vscode, claude-code', 'cursor')
  .option('--send', 'When using Cursor auto-nudge, auto-send nudges')
  .option('--interval <seconds>', 'Auto-nudge poll interval in seconds', '3')
  .option('--no-autonudge', 'Skip auto-nudge supervisor prompt')
  .action(kickoffCommand);

program
  .command('stop')
  .description('Stop watch daemon and Claude Code sessions; close Cursor/VS Code chats manually')
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
  .description('Show or set the Cursor branch used for launches')
  .option('--use-current', 'Set override to the current local git branch')
  .option('--unset', 'Remove override and follow the active git branch automatically')
  .action(branchCommand);

program
  .command('generate')
  .description('Regenerate VS Code agent files (.agent.md, hooks) from agentxchain.json')
  .action(generateCommand);

program
  .command('watch')
  .description('Watch lock.json and coordinate agent turns (the referee)')
  .option('--daemon', 'Run in background mode')
  .action(watchCommand);

program
  .command('supervise')
  .description('Run watch loop and optional auto-nudge together')
  .option('--autonudge', 'Start AppleScript auto-nudge alongside watch')
  .option('--send', 'Auto-send nudges (default is paste-only)')
  .option('--interval <seconds>', 'Auto-nudge poll interval in seconds', '3')
  .action(superviseCommand);

program
  .command('rebind')
  .description('Rebuild Cursor prompt/workspace bindings for agents')
  .option('--agent <id>', 'Rebind a single agent only')
  .option('--open', 'Reopen Cursor windows after rebinding')
  .action(rebindCommand);

program
  .command('claim')
  .description('Claim the lock as a human (take control)')
  .option('--agent <id>', 'Claim lock as a specific agent (guarded by turn order)')
  .option('--force', 'Force-claim even if an agent holds the lock')
  .action(claimCommand);

program
  .command('release')
  .description('Release the lock (hand back to agents)')
  .option('--agent <id>', 'Release lock as a specific agent')
  .option('--force', 'Force release even if a non-human holder has the lock')
  .action(releaseCommand);

program
  .command('update')
  .description('Update agentxchain CLI to the latest version')
  .action(updateCommand);

program
  .command('doctor')
  .description('Check local environment and first-run readiness')
  .action(doctorCommand);

program
  .command('validate')
  .description('Validate Get Shit Done docs and QA protocol artifacts')
  .option('--mode <mode>', 'Validation mode: kickoff, turn, full', 'full')
  .option('--agent <id>', 'Expected agent for last history entry (turn mode)')
  .option('-j, --json', 'Output as JSON')
  .action(validateCommand);

program.parse();
