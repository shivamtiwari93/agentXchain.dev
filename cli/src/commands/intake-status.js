import chalk from 'chalk';
import { intakeStatus } from '../lib/intake.js';
import { requireIntakeWorkspaceOrExit } from './intake-workspace.js';

export async function intakeStatusCommand(opts) {
  const root = requireIntakeWorkspaceOrExit(opts);

  const result = intakeStatus(root, opts.intent || null);

  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.exitCode);
  }

  if (!result.ok) {
    console.log(chalk.red(`  ${result.error}`));
    process.exit(result.exitCode);
  }

  // Detail mode: single intent
  if (result.intent) {
    printIntentDetail(result.intent, result.event, result.next_action);
    process.exit(0);
  }

  // List mode: summary
  printSummary(result.summary);
  process.exit(0);
}

function printSummary(summary) {
  console.log('');
  console.log(chalk.bold('  AgentXchain Intake Status'));
  console.log(chalk.dim('  ' + '─'.repeat(44)));
  console.log(`  ${chalk.dim('Events:')}  ${summary.total_events}`);

  const statusParts = Object.entries(summary.by_status)
    .map(([s, c]) => `${s}: ${c}`)
    .join(', ');
  console.log(`  ${chalk.dim('Intents:')} ${summary.total_intents}  (${statusParts || 'none'})`);
  console.log('');

  if (summary.intents.length > 0) {
    console.log(chalk.dim('  Recent Intents:'));
    for (const i of summary.intents.slice(0, 20)) {
      const pri = i.priority ? i.priority.padEnd(3) : '---';
      const tpl = (i.template || '---').padEnd(12);
      const st = statusColor(i.status);
      const actionHint = i.next_action?.action_required && i.next_action?.label !== 'none'
        ? `  ${chalk.dim(`→ ${i.next_action.label}`)}`
        : '';
      console.log(`  ${chalk.dim(i.intent_id)}  ${pri}  ${tpl}  ${st}  ${chalk.dim(i.updated_at)}${actionHint}`);
    }
  }

  console.log('');
}

function printIntentDetail(intent, event, nextAction) {
  console.log('');
  console.log(chalk.bold(`  Intent: ${intent.intent_id}`));
  console.log(chalk.dim('  ' + '─'.repeat(44)));
  console.log(`  ${chalk.dim('Status:')}    ${statusColor(intent.status)}`);
  console.log(`  ${chalk.dim('Event:')}     ${intent.event_id}`);
  console.log(`  ${chalk.dim('Priority:')}  ${intent.priority || '—'}`);
  console.log(`  ${chalk.dim('Template:')}  ${intent.template || '—'}`);
  console.log(`  ${chalk.dim('Charter:')}   ${intent.charter || '—'}`);
  console.log(`  ${chalk.dim('Created:')}   ${intent.created_at}`);
  console.log(`  ${chalk.dim('Updated:')}   ${intent.updated_at}`);
  if (intent.target_workstream) {
    console.log(`  ${chalk.dim('Workstream:')} ${intent.target_workstream.workstream_id}`);
    console.log(`  ${chalk.dim('Super Run:')}  ${intent.target_workstream.super_run_id}`);
  }

  if (intent.acceptance_contract && intent.acceptance_contract.length > 0) {
    console.log('');
    console.log(chalk.dim('  Acceptance Contract:'));
    for (const a of intent.acceptance_contract) {
      console.log(`    - ${a}`);
    }
  }

  if (intent.history && intent.history.length > 0) {
    console.log('');
    console.log(chalk.dim('  History:'));
    for (const h of intent.history) {
      const from = h.from || '(new)';
      console.log(`    ${chalk.dim(h.at)}  ${from} → ${h.to}  ${chalk.dim(h.reason)}`);
    }
  }

  if (event) {
    console.log('');
    console.log(chalk.dim('  Source Event:'));
    console.log(`    ${chalk.dim('Source:')}  ${event.source}`);
    console.log(`    ${chalk.dim('Signal:')}  ${JSON.stringify(event.signal)}`);
  }

  if (nextAction) {
    console.log('');
    console.log(chalk.dim('  Next Action:'));
    console.log(`    ${nextAction.summary}`);
    if (nextAction.command) {
      console.log(`    ${chalk.dim('Command:')}  ${nextAction.command}`);
    }
    for (const alternative of nextAction.alternatives || []) {
      console.log(`    ${chalk.dim('Alternative:')} ${alternative}`);
    }
    if (nextAction.recovery) {
      console.log(`    ${chalk.dim('Recovery:')} ${nextAction.recovery}`);
    }
  }

  console.log('');
}

function statusColor(status) {
  switch (status) {
    case 'detected': return chalk.yellow(status);
    case 'triaged': return chalk.cyan(status);
    case 'approved': return chalk.green(status);
    case 'planned': return chalk.green(status);
    case 'suppressed': return chalk.dim(status);
    case 'rejected': return chalk.red(status);
    default: return status;
  }
}
