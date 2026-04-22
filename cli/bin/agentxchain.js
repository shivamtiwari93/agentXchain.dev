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
import { generateCommand, generatePlanningCommand } from '../src/commands/generate.js';
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
import { migrateIntentsCommand } from '../src/commands/migrate-intents.js';
import { resumeCommand } from '../src/commands/resume.js';
import { unblockCommand } from '../src/commands/unblock.js';
import { injectCommand } from '../src/commands/inject.js';
import { escalateCommand } from '../src/commands/escalate.js';
import { acceptTurnCommand } from '../src/commands/accept-turn.js';
import { checkpointTurnCommand } from '../src/commands/checkpoint-turn.js';
import { reconcileStateCommand } from '../src/commands/reconcile-state.js';
import { rejectTurnCommand } from '../src/commands/reject-turn.js';
import { reissueTurnCommand } from '../src/commands/reissue-turn.js';
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
import { benchmarkWorkloadsCommand } from '../src/commands/benchmark-workloads.js';
import { historyCommand } from '../src/commands/history.js';
import { decisionsCommand } from '../src/commands/decisions.js';
import { diffCommand } from '../src/commands/diff.js';
import { eventsCommand } from '../src/commands/events.js';
import { connectorCapabilitiesCommand, connectorCheckCommand, connectorValidateCommand } from '../src/commands/connector.js';
import { scheduleDaemonCommand, scheduleListCommand, scheduleRunDueCommand, scheduleStatusCommand } from '../src/commands/schedule.js';
import { chainLatestCommand, chainListCommand, chainShowCommand } from '../src/commands/chain.js';
import { missionAttachChainCommand, missionBindCoordinatorCommand, missionListCommand, missionPlanApproveCommand, missionPlanAutopilotCommand, missionPlanCommand, missionPlanLaunchCommand, missionPlanListCommand, missionPlanShowCommand, missionShowCommand, missionStartCommand } from '../src/commands/mission.js';
import { workflowKitDescribeCommand } from '../src/commands/workflow-kit.js';

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
  .option('--template <id>', 'Governed scaffold template: generic, api-service, cli-tool, library, web-app, full-local-cli, enterprise-app')
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
  .description('Write a portable governed/coordinator export artifact from the current repo/workspace')
  .option('--format <format>', 'Export format (json)', 'json')
  .option('--output <path>', 'Write the export artifact to a file instead of stdout')
  .action(exportCommand);

program
  .command('audit')
  .description('Render a governance audit from the live current repo/workspace')
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
  .description('Render a governance summary from an existing verified export artifact')
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

const generateCmd = program
  .command('generate')
  .description('Regenerate VS Code agent files, or governed planning artifacts via subcommands')
  .action(generateCommand);

generateCmd
  .command('planning')
  .description('Generate or restore scaffold-owned governed planning artifacts')
  .option('--dry-run', 'Show which planning artifacts would be written without changing files')
  .option('--force', 'Overwrite existing scaffold-owned planning artifacts')
  .option('-j, --json', 'Output as JSON')
  .action(generatePlanningCommand);

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

connectorCmd
  .command('capabilities [runtime_id]')
  .description('Show merged capability contract for a runtime or all runtimes (machine-readable handshake)')
  .option('-j, --json', 'Output as JSON')
  .option('--all', 'Show capabilities for all configured runtimes')
  .action(connectorCapabilitiesCommand);

connectorCmd
  .command('validate <runtime_id>')
  .description('Dispatch one synthetic governed turn through a runtime and validate the staged turn result')
  .option('--role <role_id>', 'Validate a specific role binding for the runtime')
  .option('-j, --json', 'Output as JSON')
  .option('--timeout <ms>', 'Synthetic dispatch timeout in milliseconds', '120000')
  .option('--keep-artifacts', 'Keep the scratch validation workspace even on success')
  .action(connectorValidateCommand);

program
  .command('demo')
  .description('Run a complete governed lifecycle demo (no API keys required)')
  .option('-j, --json', 'Output as JSON')
  .option('-v, --verbose', 'Show stack traces on failure')
  .action(demoCommand);

const benchmarkCmd = program
  .command('benchmark')
  .description('Run a governed delivery compliance proof (no API keys required)')
  .option('-j, --json', 'Output as structured JSON')
  .option('--workload <name>', 'Run a named workload: baseline, stress, completion-recovery, or phase-drift')
  .option('--stress', 'Run the adversarial retry workload instead of the baseline happy path')
  .option('--output <dir>', 'Persist benchmark proof artifacts to a directory')
  .action(benchmarkCommand);

benchmarkCmd
  .command('workloads')
  .description('List available benchmark workloads')
  .option('-j, --json', 'Output as JSON')
  .action((subOpts) => {
    // Merge parent opts (Commander passes --json to parent, not subcommand)
    const parentOpts = benchmarkCmd.opts();
    benchmarkWorkloadsCommand({ ...subOpts, json: subOpts.json || parentOpts.json });
  });

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

const chainCmd = program
  .command('chain')
  .description('Inspect run-chaining history and reports');

chainCmd
  .command('latest')
  .description('Show the most recent chain report')
  .option('-j, --json', 'Output as JSON')
  .option('-d, --dir <path>', 'Project directory')
  .action(chainLatestCommand);

chainCmd
  .command('list')
  .description('List all chain reports')
  .option('-j, --json', 'Output as JSON')
  .option('-l, --limit <n>', 'Max chain reports to show (default: 20)')
  .option('-d, --dir <path>', 'Project directory')
  .action(chainListCommand);

chainCmd
  .command('show <chain_id>')
  .description('Show a specific chain report by ID')
  .option('-j, --json', 'Output as JSON')
  .option('-d, --dir <path>', 'Project directory')
  .action(chainShowCommand);

const missionCmd = program
  .command('mission')
  .description('Group chained runs under a single-repo long-horizon mission');

missionCmd
  .command('start')
  .description('Create a durable mission artifact for a single repo')
  .requiredOption('--title <text>', 'Mission title')
  .requiredOption('--goal <text>', 'Mission goal')
  .option('--id <mission_id>', 'Override the derived mission ID')
  .option('--plan', 'Generate a proposed mission plan immediately after mission creation')
  .option('--constraint <text>', 'Add a constraint to the planner when using --plan (repeatable)', collectOption, [])
  .option('--role-hint <role>', 'Hint available roles to the planner when using --plan (repeatable)', collectOption, [])
  .option('--planner-output-file <path>', 'Read planner JSON output from a file instead of calling the configured planner')
  .option('--multi', 'Create a multi-repo mission with coordinator initialization')
  .option('--coordinator-config <path>', 'Path to agentxchain-multi.json (required with --multi)')
  .option('--coordinator-workspace <path>', 'Coordinator workspace path (defaults to project root)')
  .option('-j, --json', 'Output as JSON')
  .option('-d, --dir <path>', 'Project directory')
  .action(missionStartCommand);

missionCmd
  .command('bind-coordinator [mission_id]')
  .description('Bind an existing coordinator super_run to a mission')
  .requiredOption('--super-run-id <id>', 'Coordinator super_run_id to bind')
  .option('--coordinator-config <path>', 'Path to agentxchain-multi.json')
  .option('--coordinator-workspace <path>', 'Coordinator workspace path')
  .option('-j, --json', 'Output as JSON')
  .option('-d, --dir <path>', 'Project directory')
  .action(missionBindCoordinatorCommand);

missionCmd
  .command('list')
  .description('List mission artifacts newest first')
  .option('-l, --limit <n>', 'Max missions to show (default: 20)')
  .option('-j, --json', 'Output as JSON')
  .option('-d, --dir <path>', 'Project directory')
  .action(missionListCommand);

missionCmd
  .command('show [mission_id]')
  .description('Show one mission, or the latest mission when no ID is provided')
  .option('-j, --json', 'Output as JSON')
  .option('-d, --dir <path>', 'Project directory')
  .action(missionShowCommand);

missionCmd
  .command('attach-chain [chain_id]')
  .description('Attach a chain report to a mission (default: latest chain on latest mission)')
  .option('-m, --mission <mission_id>', 'Explicit mission ID (defaults to latest mission)')
  .option('-j, --json', 'Output as JSON')
  .option('-d, --dir <path>', 'Project directory')
  .action(missionAttachChainCommand);

const missionPlanCmd = missionCmd
  .command('plan [mission_id]')
  .description('Generate a decomposition plan for a mission (default: latest mission)')
  .option('--constraint <text>', 'Add a constraint to the planner (repeatable)', collectOption, [])
  .option('--role-hint <role>', 'Hint available roles to the planner (repeatable)', collectOption, [])
  .option('--planner-output-file <path>', 'Read planner JSON output from a file instead of calling the configured planner')
  .option('-j, --json', 'Output as JSON')
  .option('-d, --dir <path>', 'Project directory')
  .action(missionPlanCommand);

missionPlanCmd
  .command('show [plan_id]')
  .description('Show a decomposition plan (default: latest plan)')
  .option('-m, --mission <mission_id>', 'Explicit mission ID')
  .option('-j, --json', 'Output as JSON')
  .option('-d, --dir <path>', 'Project directory')
  .action(missionPlanShowCommand);

missionPlanCmd
  .command('approve [plan_id]')
  .description('Approve a decomposition plan (default: latest plan)')
  .option('-m, --mission <mission_id>', 'Explicit mission ID')
  .option('-d, --dir <path>', 'Project directory')
  .action(missionPlanApproveCommand);

missionPlanCmd
  .command('launch [plan_id]')
  .description('Launch workstream(s) from an approved plan (default: latest plan)')
  .option('-w, --workstream <id>', 'Workstream ID to launch (mutually exclusive with --all-ready)')
  .option('--all-ready', 'Launch all ready workstreams sequentially (mutually exclusive with --workstream)')
  .option('--retry', 'Retry a failed workstream (requires --workstream, only for needs_attention status)')
  .option('-m, --mission <mission_id>', 'Explicit mission ID')
  .option('--auto-approve', 'Auto-approve run gates while executing the launched workstream')
  .option('-j, --json', 'Output as JSON')
  .option('-d, --dir <path>', 'Project directory')
  .action(missionPlanLaunchCommand);

missionPlanCmd
  .command('autopilot [plan_id]')
  .description('Run unattended wave execution of an approved plan (default: latest plan)')
  .option('-m, --mission <mission_id>', 'Explicit mission ID')
  .option('--max-waves <n>', 'Maximum number of dependency waves (default: 10)')
  .option('--continue-on-failure', 'Skip failed workstreams and keep launching ready ones')
  .option('--auto-retry', 'Coordinator-only: retry one retryable repo-local failure within the same autopilot session')
  .option('--max-retries <n>', 'Coordinator-only: maximum auto-retries per workstream/repo pair in one autopilot session (default: 1)')
  .option('--cooldown <seconds>', 'Pause between waves in seconds (default: 5)')
  .option('--auto-approve', 'Auto-approve run gates during execution')
  .option('-j, --json', 'Output as JSON')
  .option('-d, --dir <path>', 'Project directory')
  .action(missionPlanAutopilotCommand);

missionPlanCmd
  .command('list')
  .description('List all plans for a mission')
  .option('-m, --mission <mission_id>', 'Explicit mission ID')
  .option('-l, --limit <n>', 'Max plans to show (default: 20)')
  .option('-j, --json', 'Output as JSON')
  .option('-d, --dir <path>', 'Project directory')
  .action(missionPlanListCommand);

function collectOption(value, previous) {
  return previous.concat([value]);
}

program
  .command('validate')
  .description('Validate project protocol artifacts')
  .option('--mode <mode>', 'Validation mode: kickoff, turn, full', 'full')
  .option('--agent <id>', 'Expected agent for last history entry (turn mode)')
  .option('-j, --json', 'Output as JSON')
  .action(validateCommand);

const conformanceCmd = program
  .command('conformance')
  .description('Run protocol conformance checks against local or remote implementations');

conformanceCmd
  .command('check')
  .description('Run the shipped protocol conformance fixture suite against a target implementation')
  .option('--tier <tier>', 'Conformance tier to verify (1, 2, or 3)', '1')
  .option('--surface <surface>', 'Restrict verification to a single surface')
  .option('--target <path>', 'Target root containing .agentxchain-conformance/capabilities.json', '.')
  .option('--remote <url>', 'Remote HTTP conformance endpoint base URL')
  .option('--token <token>', 'Bearer token for remote HTTP conformance endpoint')
  .option('--timeout <ms>', 'Per-fixture remote HTTP timeout in milliseconds', '30000')
  .option('--format <format>', 'Output format: text or json', 'text')
  .action(verifyProtocolCommand);

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
  .description('Open an existing export artifact in the read-only dashboard')
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
  .command('migrate-intents')
  .description('Archive legacy intents with no run scope (pre-BUG-34 repair)')
  .option('-j, --json', 'Output as JSON')
  .option('--dry-run', 'List legacy intents without modifying them')
  .action(migrateIntentsCommand);

program
  .command('resume')
  .description('Resume a governed project: initialize or continue a run and assign the next turn')
  .option('--role <role>', 'Override the target role (default: phase entry role)')
  .option('--turn <id>', 'Target a specific retained turn when multiple exist')
  .option('--no-intent', 'Do not bind the next queued approved/planned intake intent to the next turn')
  .action(resumeCommand);

program
  .command('unblock <escalation-id>')
  .description('Resolve the current human escalation record and continue the governed run')
  .action(unblockCommand);

program
  .command('inject <description>')
  .description('Inject a priority work item into the intake queue (composed record + triage + approve)')
  .option('--priority <level>', 'Priority level (p0, p1, p2, p3)', 'p0')
  .option('--template <id>', 'Governed template (generic, api-service, cli-tool, library, web-app, full-local-cli, enterprise-app)', 'generic')
  .option('--charter <text>', 'Delivery charter (defaults to description)')
  .option('--acceptance <text>', 'Comma-separated acceptance criteria')
  .option('--approver <name>', 'Approver identity', 'human')
  .option('--no-approve', 'Stop at triaged state instead of auto-approving')
  .option('-j, --json', 'Output as JSON')
  .action(injectCommand);

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
  .option('--checkpoint', 'Checkpoint the accepted turn to git immediately after acceptance')
  .option('--resolution <mode>', 'Conflict resolution mode for conflicted turns (standard, human_merge)', 'standard')
  .action(acceptTurnCommand);

program
  .command('checkpoint-turn')
  .description('Checkpoint the latest accepted turn into git so the next writable turn has a clean baseline')
  .option('--turn <id>', 'Checkpoint a specific accepted turn from history')
  .action(checkpointTurnCommand);

program
  .command('reconcile-state')
  .description('Reconcile safe operator commits into governed run state')
  .option('--accept-operator-head', 'Accept safe fast-forward operator commits as the new governed baseline')
  .action(reconcileStateCommand);

program
  .command('reject-turn')
  .description('Reject the current governed turn result and retry or escalate')
  .option('--turn <id>', 'Target a specific active turn when multiple turns exist')
  .option('--reason <reason>', 'Operator reason for the rejection')
  .option('--reassign', 'Immediately re-dispatch a conflicted turn with conflict context')
  .action(rejectTurnCommand);

program
  .command('reissue-turn')
  .description('Invalidate an active turn and reissue it against current repo state (baseline drift recovery)')
  .option('--turn <id>', 'Target a specific active turn when multiple turns exist')
  .option('--reason <reason>', 'Reason for the reissue (e.g., baseline drift, runtime rebinding)')
  .action(reissueTurnCommand);

program
  .command('step')
  .description('Run a single governed turn: assign, dispatch, wait, validate, accept/reject')
  .option('--role <role>', 'Override the target role (default: phase entry role)')
  .option('--resume', 'Resume waiting for an already-active turn')
  .option('--turn <id>', 'Target a specific active turn (required with --resume when multiple turns exist)')
  .option('--no-intent', 'Do not bind the next queued approved/planned intake intent to the next turn')
  .option('--poll <seconds>', 'Polling interval for manual adapter in seconds', '2')
  .option('--verbose', 'Stream local_cli subprocess output while the turn is running')
  .option('--stream', 'Stream live subprocess output to terminal (alias for --verbose)')
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
  .option('--chain', 'Auto-chain runs: when a run completes, start a continuation automatically')
  .option('--max-chains <n>', 'Maximum continuation runs in chain mode (default: 5)', parseInt)
  .option('--chain-on <statuses>', 'Comma-separated terminal statuses that trigger chaining (default: completed)')
  .option('--chain-cooldown <seconds>', 'Seconds to wait between chained runs (default: 5)', parseInt)
  .option('--mission <mission_id>', 'Bind chained runs to a mission (use "latest" for most recent mission)')
  .option('--continuous', 'Enable continuous vision-driven loop: derive work from VISION.md and run until satisfied')
  .option('--vision <path>', 'Path to VISION.md (project-relative or absolute, default: .planning/VISION.md)')
  .option('--max-runs <n>', 'Maximum consecutive governed runs in continuous mode (default: 100)', parseInt)
  .option('--poll-seconds <n>', 'Seconds between idle-detection cycles in continuous mode (default: 30)', parseInt)
  .option('--triage-approval <mode>', 'Triage policy for vision-derived intents: auto or human (default: config or auto)')
  .option('--max-idle-cycles <n>', 'Stop after N consecutive idle cycles with no derivable work (default: 3)', parseInt)
  .option('--session-budget <usd>', 'Cumulative session-level budget cap in USD for continuous mode', parseFloat)
  .option('--auto-retry-on-ghost', 'Enable bounded automatic retry for continuous-mode startup ghost turns')
  .option('--no-auto-retry-on-ghost', 'Disable bounded automatic retry for continuous-mode startup ghost turns')
  .option('--auto-retry-on-ghost-max-retries <n>', 'Maximum startup ghost retries per continuous run (default: config or 3)', parseInt)
  .option('--auto-retry-on-ghost-cooldown-seconds <n>', 'Seconds to wait between startup ghost retries (default: config or 5)', parseInt)
  .option('--auto-checkpoint', 'Auto-commit accepted writable turns after acceptance')
  .option('--no-auto-checkpoint', 'Disable automatic checkpointing after accepted writable turns')
  .action(runCommand);

program
  .command('approve-transition')
  .description('Approve a pending phase transition that requires human sign-off')
  .option('--dry-run', 'Show configured gate actions without executing approval')
  .action(approveTransitionCommand);

program
  .command('approve-completion')
  .description('Approve a pending run completion that requires human sign-off')
  .option('--dry-run', 'Show configured gate actions without executing approval')
  .action(approveCompletionCommand);

program
  .command('dashboard')
  .description('Open the live governance dashboard for the current repo/workspace')
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

const workflowKitCmd = program
  .command('workflow-kit')
  .description('Inspect the workflow kit contract for this project');

workflowKitCmd
  .command('describe')
  .description('Show the workflow kit contract — templates, artifacts, semantic validators, gate coverage')
  .option('-j, --json', 'Output as JSON')
  .action(workflowKitDescribeCommand);

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
  .option('--template <id>', 'Governed template (generic, api-service, cli-tool, library, web-app, full-local-cli, enterprise-app)')
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
  .option('--restart-completed', 'Initialize a fresh governed run when state is already completed')
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
  .option('--outcome <status>', 'Force transition to this status (e.g., "completed")')
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
