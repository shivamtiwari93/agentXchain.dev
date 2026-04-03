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
import { migrateCommand } from '../src/commands/migrate.js';
import { resumeCommand } from '../src/commands/resume.js';
import { acceptTurnCommand } from '../src/commands/accept-turn.js';
import { rejectTurnCommand } from '../src/commands/reject-turn.js';
import { stepCommand } from '../src/commands/step.js';
import { approveTransitionCommand } from '../src/commands/approve-transition.js';
import { approveCompletionCommand } from '../src/commands/approve-completion.js';
import { dashboardCommand } from '../src/commands/dashboard.js';
import {
  pluginInstallCommand,
  pluginListCommand,
  pluginRemoveCommand,
  pluginUpgradeCommand,
} from '../src/commands/plugin.js';
import { templateSetCommand } from '../src/commands/template-set.js';
import { templateListCommand } from '../src/commands/template-list.js';
import {
  multiInitCommand,
  multiStatusCommand,
  multiStepCommand,
  multiApproveGateCommand,
  multiResyncCommand,
} from '../src/commands/multi.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'));

const program = new Command();

program
  .name('agentxchain')
  .description('Governed multi-agent software delivery orchestration')
  .version(pkg.version);

program
  .command('init')
  .description('Create a new AgentXchain project folder')
  .option('-y, --yes', 'Skip prompts, use defaults')
  .option('--governed', 'Create a governed project (orchestrator-owned state)')
  .option('--template <id>', 'Governed scaffold template: generic, api-service, cli-tool, web-app')
  .option('--schema-version <version>', 'Schema version (3 for legacy, or use --governed for current)')
  .action(initCommand);

program
  .command('status')
  .description('Show current run or lock status')
  .option('-j, --json', 'Output as JSON')
  .action(statusCommand);

program
  .command('start')
  .description('Launch legacy v3 agents in your IDE')
  .option('--ide <ide>', 'Target IDE: cursor, vscode, claude-code', 'cursor')
  .option('--agent <id>', 'Launch a specific agent only')
  .option('--remaining', 'Launch all remaining agents except PM (for PM-first flow)')
  .option('--dry-run', 'Print what would be launched without doing it')
  .action(startCommand);

program
  .command('kickoff')
  .description('Guided legacy PM-first first-run workflow')
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
  .description('Validate project protocol artifacts')
  .option('--mode <mode>', 'Validation mode: kickoff, turn, full', 'full')
  .option('--agent <id>', 'Expected agent for last history entry (turn mode)')
  .option('-j, --json', 'Output as JSON')
  .action(validateCommand);

program
  .command('migrate')
  .description('Migrate a legacy v3 project to governed format')
  .option('-y, --yes', 'Skip confirmation prompts')
  .option('-j, --json', 'Output migration report as JSON')
  .action(migrateCommand);

program
  .command('resume')
  .description('Resume a governed project: initialize or continue a run and assign the next turn')
  .option('--role <role>', 'Override the target role (default: phase entry role)')
  .option('--turn <id>', 'Target a specific retained turn when multiple exist')
  .action(resumeCommand);

program
  .command('accept-turn')
  .description('Accept the currently staged governed turn result')
  .option('--turn <id>', 'Target a specific active turn when multiple turns exist')
  .option('--resolution <mode>', 'Conflict resolution mode for conflicted turns (standard, human_merge)', 'standard')
  .action(acceptTurnCommand);

program
  .command('reject-turn')
  .description('Reject the current governed turn result and retry or escalate')
  .option('--turn <id>', 'Target a specific active turn when multiple turns exist')
  .option('--reason <reason>', 'Operator reason for the rejection')
  .option('--reassign', 'Immediately re-dispatch a conflicted turn with conflict context')
  .action(rejectTurnCommand);

program
  .command('step')
  .description('Run a single governed turn: assign, dispatch, wait, validate, accept/reject')
  .option('--role <role>', 'Override the target role (default: phase entry role)')
  .option('--resume', 'Resume waiting for an already-active turn')
  .option('--turn <id>', 'Target a specific active turn (required with --resume when multiple turns exist)')
  .option('--poll <seconds>', 'Polling interval for manual adapter in seconds', '2')
  .option('--verbose', 'Stream local_cli subprocess output while the turn is running')
  .option('--auto-reject', 'Auto-reject and retry on validation failure')
  .action(stepCommand);

program
  .command('approve-transition')
  .description('Approve a pending phase transition that requires human sign-off')
  .action(approveTransitionCommand);

program
  .command('approve-completion')
  .description('Approve a pending run completion that requires human sign-off')
  .action(approveCompletionCommand);

program
  .command('dashboard')
  .description('Open the read-only governance dashboard in your browser')
  .option('--port <port>', 'Server port', '3847')
  .option('--no-open', 'Do not auto-open the browser')
  .action(dashboardCommand);

const pluginCmd = program
  .command('plugin')
  .description('Manage governed project plugins');

pluginCmd
  .command('install <source>')
  .description('Install a plugin from a local path, archive, or npm package spec')
  .option('--config <json>', 'Inline JSON plugin config validated against config_schema')
  .option('--config-file <path>', 'Read plugin config JSON from a file')
  .option('-j, --json', 'Output as JSON')
  .action(pluginInstallCommand);

pluginCmd
  .command('list')
  .description('List installed plugins')
  .option('-j, --json', 'Output as JSON')
  .action(pluginListCommand);

pluginCmd
  .command('remove <name>')
  .description('Remove an installed plugin')
  .option('-j, --json', 'Output as JSON')
  .action(pluginRemoveCommand);

pluginCmd
  .command('upgrade <name> [source]')
  .description('Upgrade an installed plugin atomically, rolling back on failure')
  .option('--config <json>', 'Inline JSON plugin config validated against config_schema')
  .option('--config-file <path>', 'Read plugin config JSON from a file')
  .option('-j, --json', 'Output as JSON')
  .action(pluginUpgradeCommand);

const templateCmd = program
  .command('template')
  .description('Manage governed project templates');

templateCmd
  .command('set <id>')
  .description('Set or change the governed template for this project')
  .option('-y, --yes', 'Skip confirmation prompt')
  .option('--dry-run', 'Print what would change without writing anything')
  .action(templateSetCommand);

templateCmd
  .command('list')
  .description('List available governed templates')
  .option('-j, --json', 'Output as JSON')
  .action(templateListCommand);

const multiCmd = program
  .command('multi')
  .description('Multi-repo coordinator orchestration');

multiCmd
  .command('init')
  .description('Bootstrap a multi-repo coordinator run')
  .option('-j, --json', 'Output as JSON')
  .action(multiInitCommand);

multiCmd
  .command('status')
  .description('Show coordinator status and repo-run snapshots')
  .option('-j, --json', 'Output as JSON')
  .action(multiStatusCommand);

multiCmd
  .command('step')
  .description('Select the next workstream and dispatch a coordinator turn')
  .option('-j, --json', 'Output as JSON')
  .action(multiStepCommand);

multiCmd
  .command('approve-gate')
  .description('Approve a pending phase transition or completion gate')
  .option('-j, --json', 'Output as JSON')
  .action(multiApproveGateCommand);

multiCmd
  .command('resync')
  .description('Detect divergence and rebuild coordinator state from repo authority')
  .option('-j, --json', 'Output as JSON')
  .option('--dry-run', 'Detect divergence without resyncing')
  .action(multiResyncCommand);

program.parse();
