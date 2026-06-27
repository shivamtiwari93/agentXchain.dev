/**
 * CLI command: agentxchain attention
 *
 * Answers "what needs MY attention right now — and nothing else?" by composing the
 * cross-category human-decision queue into a single HumanAttentionReport. All evaluation
 * logic lives in lib/human-attention.js — this command is presentation only
 * (Architecture Invariant #6).
 *
 * It is a status surface, not a gate: it exits 0 in BOTH the clear and attention states.
 * When the queue is empty it prints "Nothing needs your attention." — the operational
 * proof that the human can step back and let governed autonomy run (VISION.md:51).
 */

import { resolve } from 'node:path';
import chalk from 'chalk';
import { findProjectRoot } from '../lib/config.js';
import { evaluateHumanAttention } from '../lib/human-attention.js';

export async function attentionCommand(opts) {
  const dir = opts.dir ? resolve(opts.dir) : process.cwd();
  const root = findProjectRoot(dir);
  if (!root) {
    console.error(chalk.red('No agentxchain project found. Run "agentxchain init" first.'));
    process.exitCode = 1;
    return;
  }

  const report = evaluateHumanAttention(root);

  if (opts.json) {
    // --json always emits the full, schema-valid HumanAttentionReport; exit 0 in both states.
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  if (report.overall === 'clear') {
    console.log(chalk.green('Nothing needs your attention.'));
    return;
  }

  // Default view surfaces blocking + escalation items first; informational pending-intent
  // items are summarized as a count unless --all is passed.
  const visible = opts.all ? report.items : report.items.filter((item) => item.blocking);
  const hidden = report.items.length - visible.length;

  console.log(
    `\n${chalk.bold('Attention needed')}: ${report.items_count} `
    + `item${report.items_count === 1 ? '' : 's'} (${report.blocking_count} blocking)`,
  );

  visible.forEach((item, idx) => {
    const tag = chalk.cyan(String(item.category).padEnd(16));
    const run = item.run_id ? `${chalk.dim(item.run_id)} ` : '';
    console.log(`  [${idx + 1}] ${tag} ${run}${item.summary}`);
    console.log(`      ${chalk.dim('→')} ${item.action_hint}`);
  });

  if (hidden > 0) {
    console.log(
      chalk.dim(`  (+${hidden} informational item${hidden === 1 ? '' : 's'} — run with --all to show)`),
    );
  }

  console.log('');
  // Status surface, not a gate — no non-zero exit even in the attention state.
}
