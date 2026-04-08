import chalk from 'chalk';
import { loadProjectContext } from '../lib/config.js';
import { listProposals, diffProposal, applyProposal, rejectProposal } from '../lib/proposal-ops.js';

export async function proposalListCommand() {
  const context = requireGovernedContext();
  const result = listProposals(context.root);
  if (!result.ok) {
    console.log(chalk.red(result.error));
    process.exit(1);
  }

  if (result.proposals.length === 0) {
    console.log(chalk.dim('  No proposals found.'));
    return;
  }

  console.log('');
  console.log(chalk.bold('  Proposals'));
  console.log(chalk.dim('  ' + '─'.repeat(60)));
  for (const p of result.proposals) {
    const statusColor = p.status === 'applied' ? chalk.green : p.status === 'rejected' ? chalk.red : chalk.yellow;
    console.log(`  ${chalk.dim(p.turn_id)}  ${p.role}  ${p.file_count} files  ${statusColor(p.status)}`);
  }
  console.log('');
}

export async function proposalDiffCommand(turnId, opts) {
  const context = requireGovernedContext();
  if (!turnId) {
    console.log(chalk.red('Usage: agentxchain proposal diff <turn_id>'));
    process.exit(1);
  }

  const result = diffProposal(context.root, turnId, opts.file);
  if (!result.ok) {
    console.log(chalk.red(result.error));
    process.exit(1);
  }

  for (const d of result.diffs) {
    console.log('');
    console.log(chalk.bold(`  ${d.path}`) + chalk.dim(` (${d.action})`));
    console.log(chalk.dim('  ' + '─'.repeat(50)));
    for (const line of d.preview.split('\n')) {
      if (line.startsWith('+')) console.log(chalk.green(`  ${line}`));
      else if (line.startsWith('-')) console.log(chalk.red(`  ${line}`));
      else console.log(chalk.dim(`  ${line}`));
    }
  }
  console.log('');
}

export async function proposalApplyCommand(turnId, opts) {
  const context = requireGovernedContext();
  if (!turnId) {
    console.log(chalk.red('Usage: agentxchain proposal apply <turn_id>'));
    process.exit(1);
  }

  const result = applyProposal(context.root, turnId, {
    file: opts.file,
    dryRun: opts.dryRun,
  });

  if (!result.ok) {
    console.log(chalk.red(result.error));
    process.exit(1);
  }

  console.log('');
  if (result.dry_run) {
    console.log(chalk.yellow('  Dry Run — No Changes Written'));
  } else {
    console.log(chalk.green('  Proposal Applied'));
  }
  console.log(chalk.dim('  ' + '─'.repeat(44)));
  console.log(`  ${chalk.dim('Turn:')}    ${turnId}`);
  console.log(`  ${chalk.dim('Applied:')} ${result.applied_files.length} files`);
  if (result.applied_files.length > 0) {
    for (const f of result.applied_files) {
      console.log(`           ${chalk.dim('•')} ${f}`);
    }
  }
  if (result.skipped_files.length > 0) {
    console.log(`  ${chalk.dim('Skipped:')} ${result.skipped_files.length} files`);
    for (const f of result.skipped_files) {
      console.log(`           ${chalk.dim('•')} ${f}`);
    }
  }
  console.log('');
}

export async function proposalRejectCommand(turnId, opts) {
  const context = requireGovernedContext();
  if (!turnId) {
    console.log(chalk.red('Usage: agentxchain proposal reject <turn_id> --reason "..."'));
    process.exit(1);
  }

  const result = rejectProposal(context.root, turnId, opts.reason);
  if (!result.ok) {
    console.log(chalk.red(result.error));
    process.exit(1);
  }

  console.log('');
  console.log(chalk.yellow('  Proposal Rejected'));
  console.log(chalk.dim('  ' + '─'.repeat(44)));
  console.log(`  ${chalk.dim('Turn:')}   ${turnId}`);
  console.log(`  ${chalk.dim('Reason:')} ${opts.reason}`);
  console.log('');
}

function requireGovernedContext() {
  const context = loadProjectContext();
  if (!context) {
    console.log(chalk.red('No agentxchain.json found. Run `agentxchain init` first.'));
    process.exit(1);
  }
  if (context.config.protocol_mode !== 'governed') {
    console.log(chalk.red('The proposal command is only available for governed projects.'));
    process.exit(1);
  }
  return context;
}
