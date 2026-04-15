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
import { verifyDiffCommand, verifyExportCommand, verifyProtocolCommand, verifyTurnCommand } from '../src/commands/verify.js';
import { replayTurnCommand } from '../src/commands/replay.js';
import { replayExportCommand } from '../src/commands/replay-export.js';
import { kickoffCommand } from '../src/commands/kickoff.js';
import { rebindCommand } from '../src/commands/rebind.js';
import { branchCommand } from '../src/commands/branch.js';
import { migrateCommand } from '../src/commands/migrate.js';
import { resumeCommand } from '../src/commands/resume.js';
import { escalateCommand } from '../src/commands/escalate.js';
import { acceptTurnCommand } from '../src/commands/accept-turn.js';
import { rejectTurnCommand } from '../src/commands/reject-turn.js';
import { proposalListCommand, proposalDiffCommand, proposalApplyCommand, proposalRejectCommand } from '../src/commands/proposal.js';
import { stepCommand } from '../src/commands/step.js';
import { runCommand } from '../src/commands/run.js';
import { approveTransitionCommand } from '../src/commands/approve-transition.js';
import { approveCompletionCommand } from '../src/commands/approve-completion.js';
import { dashboardCommand } from '../src/commands/dashboard.js';
import { exportCommand } from '../src/commands/export.js';
import { auditCommand } from '../src/commands/audit.js';
import { restoreCommand } from '../src/commands/restore.js';
import { restartCommand } from '../src/commands/restart.js';
import { reportCommand } from '../src/commands/report.js';
import {
  pluginInstallCommand,
  pluginListCommand,
  pluginListAvailableCommand,
  pluginRemoveCommand,
  pluginUpgradeCommand,
} from '../src/commands/plugin.js';
import { templateSetCommand } from '../src/commands/template-set.js';
import { templateListCommand } from '../src/commands/template-list.js';
import { phaseCommand } from '../src/commands/phase.js';
import { gateCommand } from '../src/commands/gate.js';
import { roleCommand } from '../src/commands/role.js';
import { turnShowCommand } from '../src/commands/turn.js';
import { templateValidateCommand } from '../src/commands/template-validate.js';
import {
  multiInitCommand,
  multiStatusCommand,
  multiStepCommand,
  multiResumeCommand,
  multiApproveGateCommand,
  multiResyncCommand,
} from '../src/commands/multi.js';
import { intakeRecordCommand } from '../src/commands/intake-record.js';
import { intakeTriageCommand } from '../src/commands/intake-triage.js';
import { intakeApproveCommand } from '../src/commands/intake-approve.js';
import { intakePlanCommand } from '../src/commands/intake-plan.js';
import { intakeStartCommand } from '../src/commands/intake-start.js';
import { intakeHandoffCommand } from '../src/commands/intake-handoff.js';
import { intakeScanCommand } from '../src/commands/intake-scan.js';
import { intakeResolveCommand } from '../src/commands/intake-resolve.js';
import { intakeStatusCommand } from '../src/commands/intake-status.js';
import { demoCommand } from '../src/commands/demo.js';
import { benchmarkCommand } from '../src/commands/benchmark.js';
import { historyCommand } from '../src/commands/history.js';
import { decisionsCommand } from '../src/commands/decisions.js';
import { diffCommand } from '../src/commands/diff.js';
import { eventsCommand } from '../src/commands/events.js';
import { connectorCheckCommand } from '../src/commands/connector.js';
import { scheduleDaemonCommand, scheduleListCommand, scheduleRunDueCommand, scheduleStatusCommand } from '../src/commands/schedule.js';

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
  .option('-y, --yes', 'Skip guided prompts, use defaults')
  .option('--governed', 'Create a governed project (orchestrator-owned state)')
  .option('--dir <path>', 'Scaffold target directory. Use "." for in-place bootstrap.')
  .option('--template <id>', 'Governed scaffold template: generic, api-service, cli-tool, library, web-app, enterprise-app')
  .option('--dev-command <parts...>', 'Governed local-dev command parts. Include {prompt} for argv prompt delivery.')
  .option('--dev-prompt-transport <mode>', 'Governed local-dev prompt transport: argv, stdin, dispatch_bundle_only')
  .option('--goal <text>', 'Project goal — persisted in config and rendered in every dispatch bundle')
  .option('--schema-version <version>', 'Schema version (3 for legacy, or use --governed for current)')
  .action(initCommand);

program
  .command('status')
  .description('Show current run or lock status')
  .option('-j, --json', 'Output as JSON')
  .action(statusCommand);

program
  .command('export')
  .description('Export the governed run audit surface as a single artifact')
  .option('--format <format>', 'Export format (json)', 'json')
  .option('--output <path>', 'Write the export artifact to a file instead of stdout')
  .action(exportCommand);

program
  .command('audit')
  .description('Render a governance audit directly from the current governed project or coordinator workspace')
  .option('--format <format>', 'Output format: text, json, markdown, or html', 'text')
  .action(auditCommand);

program
  .command('restore')
  .description('Restore governed continuity roots from a run export artifact')
  .requiredOption('--input <path>', 'Path to a prior run export artifact')
  .action(restoreCommand);

program
  .command('restart')
  .description('Restart a governed run from the last checkpoint (cross-session recovery)')
  .option('--role <role>', 'Override the next role assignment')
  .action(restartCommand);

program
  .command('report')
  .description('Render a human-readable governance summary from an export artifact')
  .option('--input <path>', 'Export artifact path, or "-" for stdin', '-')
  .option('--format <format>', 'Output format: text, json, markdown, or html', 'text')
  .action(reportCommand);

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
  .description('Stop dashboard/watch daemons and Claude Code sessions; close Cursor/VS Code chats manually')
  .action(stopCommand);

program
  .command('config')
  .description('View or edit project configuration')
  .option('--add-agent', 'Add a new agent interactively')
  .option('--remove-agent <id>', 'Remove an agent by ID')
  .option('--get <path>', 'Read a config value (e.g. --get project.goal)')
  .option('--set <path_and_value...>', 'Set a config value (e.g. --set project.goal "Build a governed CLI")')
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
  .description('Check governed project readiness (v4) or local environment (v3)')
  .option('-j, --json', 'Output as JSON')
  .action(doctorCommand);

const connectorCmd = program
  .command('connector')
  .description('Probe governed runtime connectors directly');

connectorCmd
  .command('check [runtime_id]')
  .description('Run live connector probes for all non-manual runtimes or one named runtime')
  .option('-j, --json', 'Output as JSON')
  .option('--timeout <ms>', 'Per-probe timeout in milliseconds', '8000')
  .action(connectorCheckCommand);

program
  .command('demo')
  .description('Run a complete governed lifecycle demo (no API keys required)')
  .option('-j, --json', 'Output as JSON')
  .option('-v, --verbose', 'Show stack traces on failure')
  .action(demoCommand);

program
  .command('benchmark')
  .description('Run a governed delivery compliance proof (no API keys required)')
  .option('-j, --json', 'Output as structured JSON')
  .option('--stress', 'Run the adversarial retry workload instead of the baseline happy path')
  .action(benchmarkCommand);

const scheduleCmd = program
  .command('schedule')
  .description('Run governed schedules for repo-local lights-out execution');

scheduleCmd
  .command('list')
  .description('List configured governed schedules and due status')
  .option('--schedule <id>', 'Show a single schedule')
  .option('--at <iso8601>', 'Evaluate due status at a fixed time')
  .option('-j, --json', 'Output as JSON')
  .action(scheduleListCommand);

scheduleCmd
  .command('run-due')
  .description('Execute every due governed schedule once')
  .option('--schedule <id>', 'Run one configured schedule only')
  .option('--at <iso8601>', 'Evaluate due status at a fixed time')
  .option('-j, --json', 'Output as JSON')
  .action(scheduleRunDueCommand);

scheduleCmd
  .command('daemon')
  .description('Poll for due governed schedules and run them locally')
  .option('--schedule <id>', 'Run one configured schedule only')
  .option('--poll-seconds <n>', 'Polling interval in seconds', '60')
  .option('--max-cycles <n>', 'Stop after N cycles (test helper)')
  .option('-j, --json', 'Output as JSON')
  .action(scheduleDaemonCommand);

scheduleCmd
  .command('status')
  .description('Show daemon health: running, stale, not_running, or never_started')
  .option('-j, --json', 'Output as JSON')
  .action(scheduleStatusCommand);

program
  .command('history')
  .description('Show cross-run history of governed runs in this project')
  .option('-j, --json', 'Output as JSON')
  .option('-l, --limit <n>', 'Number of recent runs to show (default: 20)')
  .option('-s, --status <status>', 'Filter by status: completed or blocked')
  .option('--lineage <run_id>', 'Show lineage chain for a specific run')
  .option('-d, --dir <path>', 'Project directory')
  .action(historyCommand);

program
  .command('decisions')
  .description('Show repo-level decisions that persist across governed runs')
  .option('-j, --json', 'Output as JSON')
  .option('-a, --all', 'Include overridden decisions')
  .option('-s, --show <id>', 'Show details for a specific decision (e.g. DEC-042)')
  .option('-d, --dir <path>', 'Project directory')
  .action(decisionsCommand);

program
  .command('diff <left_ref> <right_ref>')
  .description('Compare two recorded governed runs or two export artifacts')
  .option('-j, --json', 'Output as JSON')
  .option('--export', 'Compare two export artifacts instead of run-history entries')
  .option('-d, --dir <path>', 'Project directory')
  .action(diffCommand);

program
  .command('events')
  .description('Show repo-local run lifecycle events')
  .option('-f, --follow', 'Stream events as they occur')
  .option('-t, --type <type>', 'Filter by event type (comma-separated)')
  .option('--since <timestamp>', 'Show events after ISO-8601 timestamp')
  .option('-j, --json', 'Output raw JSONL')
  .option('-l, --limit <n>', 'Max events to show (default: 50, 0 = all)')
  .option('-d, --dir <path>', 'Project directory')
  .action(eventsCommand);

program
  .command('validate')
  .description('Validate project protocol artifacts')
  .option('--mode <mode>', 'Validation mode: kickoff, turn, full', 'full')
  .option('--agent <id>', 'Expected agent for last history entry (turn mode)')
  .option('-j, --json', 'Output as JSON')
  .action(validateCommand);

const verifyCmd = program
  .command('verify')
  .description('Verify governed turns, export artifacts, and protocol conformance targets');

verifyCmd
  .command('turn [turn_id]')
  .description('Replay a staged turn\'s declared machine-evidence commands and compare exit codes')
  .option('-j, --json', 'Output as JSON')
  .option('--timeout <ms>', 'Per-command replay timeout in milliseconds', '30000')
  .action(verifyTurnCommand);

verifyCmd
  .command('protocol')
  .description('Run the protocol conformance fixture suite against a target implementation')
  .option('--tier <tier>', 'Conformance tier to verify (1, 2, or 3)', '1')
  .option('--surface <surface>', 'Restrict verification to a single surface')
  .option('--target <path>', 'Target root containing .agentxchain-conformance/capabilities.json', '.')
  .option('--remote <url>', 'Remote HTTP conformance endpoint base URL')
  .option('--token <token>', 'Bearer token for remote HTTP conformance endpoint')
  .option('--timeout <ms>', 'Per-fixture remote HTTP timeout in milliseconds', '30000')
  .option('--format <format>', 'Output format: text or json', 'text')
  .action(verifyProtocolCommand);

verifyCmd
  .command('export')
  .description('Verify an AgentXchain export artifact against its embedded file bytes and summaries')
  .option('--input <path>', 'Export artifact path, or "-" for stdin', '-')
  .option('--format <format>', 'Output format: text or json', 'text')
  .action(verifyExportCommand);

verifyCmd
  .command('diff <left_export> <right_export>')
  .description('Verify two export artifacts, then detect governance regressions between them')
  .option('--format <format>', 'Output format: text or json', 'text')
  .action(verifyDiffCommand);

const replayCmd = program
  .command('replay')
  .description('Replay accepted governed evidence against the current workspace');

replayCmd
  .command('turn [turn_id]')
  .description('Replay an accepted turn\'s declared machine-evidence commands from history')
  .option('-j, --json', 'Output as JSON')
  .option('--timeout <ms>', 'Per-command replay timeout in milliseconds', '30000')
  .action(replayTurnCommand);

replayCmd
  .command('export <export-file>')
  .description('Browse a completed export in the dashboard for offline post-mortem analysis')
  .option('-j, --json', 'Output session info as JSON')
  .option('--port <port>', 'Dashboard port', '3847')
  .option('--no-open', 'Do not auto-open browser')
  .action(replayExportCommand);

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
  .command('escalate')
  .description('Raise an operator escalation and block the governed run intentionally')
  .requiredOption('--reason <reason>', 'Operator escalation summary')
  .option('--detail <detail>', 'Longer escalation detail for status and ledger surfaces')
  .option('--action <action>', 'Override the default recovery action string')
  .option('--turn <id>', 'Target a specific active turn when multiple turns exist')
  .action(escalateCommand);

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
  .command('run')
  .description('Drive a governed run to completion: multi-turn execution with gate prompting')
  .option('--role <role>', 'Override the initial role (default: config-driven selection)')
  .option('--max-turns <n>', 'Maximum turns before stopping (default: 50)', parseInt)
  .option('--auto-approve', 'Auto-approve all gates (non-interactive mode)')
  .option('--verbose', 'Stream adapter subprocess output')
  .option('--dry-run', 'Print what would be dispatched without executing')
  .option('--no-report', 'Suppress automatic governance report after run completes')
  .option('--continue-from <run_id>', 'Continue from a prior terminal run (sets trigger=continuation)')
  .option('--recover-from <run_id>', 'Recover from a prior blocked run (sets trigger=recovery)')
  .option('--inherit-context', 'Inherit read-only summary context from the parent run (requires --continue-from or --recover-from)')
  .action(runCommand);

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
  .option('--daemon', 'Run the dashboard in background mode')
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
  .command('list-available')
  .description('List built-in plugins available for installation')
  .option('-j, --json', 'Output as JSON')
  .action(pluginListAvailableCommand);

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
  .option('--phase-templates', 'List workflow-kit phase templates instead of governed project templates')
  .action(templateListCommand);

templateCmd
  .command('validate')
  .description('Validate the built-in governed template registry and current project template binding')
  .option('-j, --json', 'Output as JSON')
  .action(templateValidateCommand);

const phaseCmd = program
  .command('phase')
  .description('Inspect governed workflow phases');

phaseCmd
  .command('list')
  .description('List governed phases in routing order')
  .option('-j, --json', 'Output as JSON')
  .action((opts) => phaseCommand('list', null, opts));

phaseCmd
  .command('show [phase]')
  .description('Show one governed phase in detail')
  .option('-j, --json', 'Output as JSON')
  .action((phaseId, opts) => phaseCommand('show', phaseId, opts));

const gateCmd = program
  .command('gate')
  .description('Inspect governed gate definitions');

gateCmd
  .command('list')
  .description('List all defined gates with phase linkage and predicate summary')
  .option('-j, --json', 'Output as JSON')
  .action((opts) => gateCommand('list', null, opts));

gateCmd
  .command('show <gate_id>')
  .description('Show a single gate contract, predicates, and status')
  .option('-j, --json', 'Output as JSON')
  .option('--evaluate', 'Live-evaluate gate predicates against current filesystem')
  .action((gateId, opts) => gateCommand('show', gateId, opts));

const roleCmd = program
  .command('role')
  .description('Inspect governed role definitions');

roleCmd
  .command('list')
  .description('List all defined roles with title, authority, and runtime')
  .option('-j, --json', 'Output as JSON')
  .action((opts) => roleCommand('list', null, opts));

roleCmd
  .command('show <role_id>')
  .description('Show detailed information for a single role')
  .option('-j, --json', 'Output as JSON')
  .action((roleId, opts) => roleCommand('show', roleId, opts));

const turnCmd = program
  .command('turn')
  .description('Inspect active governed turn dispatch bundles');

turnCmd
  .command('show [turn_id]')
  .description('Show a selected active turn and its dispatch artifacts')
  .option('--artifact <name>', 'Print one artifact: assignment, prompt, context, or manifest')
  .option('-j, --json', 'Output as JSON')
  .action(turnShowCommand);

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
  .command('resume')
  .description('Clear a blocked coordinator state after operator recovery')
  .option('-j, --json', 'Output as JSON')
  .action(multiResumeCommand);

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

// --- Intake (v3) -----------------------------------------------------------

const intakeCmd = program
  .command('intake')
  .description('Continuous governed delivery intake — record signals, triage intents, view status');

intakeCmd
  .command('record')
  .description('Record a delivery trigger event and create a detected intent')
  .option('--file <path>', 'Read event payload from a JSON file')
  .option('--stdin', 'Read event payload from stdin')
  .option('--source <source>', 'Inline event source (manual, ci_failure, git_ref_change, schedule)')
  .option('--signal <json>', 'Inline signal object (JSON string, requires --source)')
  .option('--evidence <json>', 'Inline evidence entry (JSON string, requires --source)')
  .option('--category <category>', 'Optional event category override')
  .option('-j, --json', 'Output as JSON')
  .action(intakeRecordCommand);

intakeCmd
  .command('triage')
  .description('Triage a detected intent — set priority, template, charter, and acceptance')
  .option('--intent <id>', 'Intent ID to triage')
  .option('--priority <level>', 'Priority level (p0, p1, p2, p3)')
  .option('--template <id>', 'Governed template (generic, api-service, cli-tool, library, web-app, enterprise-app)')
  .option('--charter <text>', 'Delivery charter text')
  .option('--acceptance <text>', 'Comma-separated acceptance criteria')
  .option('--suppress', 'Suppress the intent instead of triaging')
  .option('--reject', 'Reject a triaged intent')
  .option('--reason <text>', 'Reason for suppress or reject')
  .option('-j, --json', 'Output as JSON')
  .action(intakeTriageCommand);

intakeCmd
  .command('approve')
  .description('Approve a triaged intent for planning')
  .option('--intent <id>', 'Intent ID to approve')
  .option('--approver <name>', 'Name of the approving authority', 'operator')
  .option('--reason <text>', 'Reason for approval')
  .option('-j, --json', 'Output as JSON')
  .action(intakeApproveCommand);

intakeCmd
  .command('plan')
  .description('Generate planning artifacts and transition an approved intent to planned')
  .option('--intent <id>', 'Intent ID to plan')
  .option('--project-name <name>', 'Project name for template substitution')
  .option('--force', 'Overwrite existing planning artifacts')
  .option('-j, --json', 'Output as JSON')
  .action(intakePlanCommand);

intakeCmd
  .command('start')
  .description('Start governed execution for a planned intent')
  .option('--intent <id>', 'Intent ID to start')
  .option('--role <role>', 'Override the default entry role for the governed phase')
  .option('-j, --json', 'Output as JSON')
  .action(intakeStartCommand);

intakeCmd
  .command('handoff')
  .description('Hand off a planned intent to a coordinator workstream')
  .option('--intent <id>', 'Intent ID to hand off')
  .option('--coordinator-root <path>', 'Path to the coordinator workspace root')
  .option('--workstream <id>', 'Coordinator workstream ID')
  .option('-j, --json', 'Output as JSON')
  .action(intakeHandoffCommand);

intakeCmd
  .command('scan')
  .description('Scan a structured source snapshot into intake events')
  .option('--source <id>', 'Source type: ci_failure, git_ref_change, schedule')
  .option('--file <path>', 'Path to snapshot JSON file')
  .option('--stdin', 'Read snapshot from stdin')
  .option('-j, --json', 'Output as JSON')
  .action(intakeScanCommand);

intakeCmd
  .command('resolve')
  .description('Resolve an executing intent by reading the governed run outcome')
  .option('--intent <id>', 'Intent ID to resolve')
  .option('-j, --json', 'Output as JSON')
  .action(intakeResolveCommand);

intakeCmd
  .command('status')
  .description('Show current intake state — events, intents, and aggregate counts')
  .option('--intent <id>', 'Show detail for a specific intent')
  .option('-j, --json', 'Output as JSON')
  .action(intakeStatusCommand);

// --- Proposal operations ----------------------------------------------------

const proposalCmd = program
  .command('proposal')
  .description('Manage proposed changes from api_proxy agents');

proposalCmd
  .command('list')
  .description('List all proposals and their status')
  .action(proposalListCommand);

proposalCmd
  .command('diff <turn_id>')
  .description('Show diff between proposed files and current workspace')
  .option('--file <path>', 'Show diff for a single file only')
  .action(proposalDiffCommand);

proposalCmd
  .command('apply <turn_id>')
  .description('Apply proposed changes to the workspace')
  .option('--file <path>', 'Apply only a specific file')
  .option('--dry-run', 'Show what would change without writing')
  .option('--force', 'Override proposal conflicts or unverifiable legacy proposals')
  .action(proposalApplyCommand);

proposalCmd
  .command('reject <turn_id>')
  .description('Reject a proposal without applying changes')
  .option('--reason <reason>', 'Reason for rejection (required)')
  .action(proposalRejectCommand);

program.parse();
