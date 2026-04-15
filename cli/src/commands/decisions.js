/**
 * agentxchain decisions — cross-run decision carryover surface.
 *
 * Shows repo-level decisions that persist across governed runs.
 */

import { resolve } from 'path';
import { existsSync } from 'fs';
import chalk from 'chalk';
import { readRepoDecisions, getActiveRepoDecisions, getRepoDecisionById } from '../lib/repo-decisions.js';

/**
 * @param {object} opts - { json?: boolean, all?: boolean, show?: string, dir?: string }
 */
export async function decisionsCommand(opts) {
  const root = findProjectRoot(opts.dir || process.cwd());
  if (!root) {
    console.error(chalk.red('No AgentXchain project found. Run this inside a governed project.'));
    process.exit(1);
  }

  // ── Show single decision ───────────────────────────────────────────────
  if (opts.show) {
    const dec = getRepoDecisionById(root, opts.show);
    if (!dec) {
      console.error(chalk.red(`Decision ${opts.show} not found in repo decisions.`));
      process.exit(1);
    }
    if (opts.json) {
      console.log(JSON.stringify(dec, null, 2));
      return;
    }
    console.log(chalk.bold(`Decision ${dec.id}`));
    console.log(`  Category:    ${dec.category}`);
    console.log(`  Statement:   ${dec.statement}`);
    console.log(`  Rationale:   ${dec.rationale}`);
    console.log(`  Status:      ${formatStatus(dec.status)}`);
    console.log(`  Role:        ${dec.role || '—'}`);
    console.log(`  Phase:       ${dec.phase || '—'}`);
    console.log(`  Run:         ${(dec.run_id || '—').slice(0, 16)}`);
    console.log(`  Turn:        ${(dec.turn_id || '—').slice(0, 16)}`);
    console.log(`  Durability:  ${dec.durability || 'repo'}`);
    if (dec.overrides) {
      console.log(`  Supersedes:  ${chalk.yellow(dec.overrides)}`);
    }
    console.log(`  Created:     ${dec.created_at || '—'}`);
    if (dec.overridden_by) {
      console.log(`  Overridden:  ${chalk.yellow(dec.overridden_by)}`);
    }
    return;
  }

  // ── List decisions ─────────────────────────────────────────────────────
  const decisions = opts.all ? readRepoDecisions(root) : getActiveRepoDecisions(root);

  if (opts.json) {
    console.log(JSON.stringify(decisions, null, 2));
    return;
  }

  if (decisions.length === 0) {
    console.log(chalk.dim('No repo-level decisions found.'));
    if (!opts.all) {
      console.log(chalk.dim('Use --all to include overridden decisions.'));
    }
    return;
  }

  const label = opts.all ? 'Repo Decisions (all)' : 'Active Repo Decisions';
  console.log(chalk.bold(`${label}: ${decisions.length}`));
  console.log('');

  for (const dec of decisions) {
    const status = formatStatus(dec.status);
    const runShort = (dec.run_id || '').slice(0, 12);
    const override = dec.overridden_by
      ? chalk.dim(` → ${dec.overridden_by}`)
      : dec.overrides
        ? chalk.dim(` ← supersedes ${dec.overrides}`)
        : '';
    console.log(`  ${chalk.cyan(dec.id)}  ${status}  ${chalk.dim(dec.category)}  ${dec.statement}${override}`);
    console.log(`    ${chalk.dim(`by ${dec.role || '?'} in ${runShort || '?'}`)}`);
  }
}

function formatStatus(status) {
  if (status === 'active') return chalk.green('active');
  if (status === 'overridden') return chalk.yellow('overridden');
  return chalk.dim(status || '—');
}

function findProjectRoot(dir) {
  let current = resolve(dir);
  while (current !== '/') {
    if (existsSync(resolve(current, 'agentxchain.json'))) return current;
    if (existsSync(resolve(current, '.agentxchain'))) return current;
    const parent = resolve(current, '..');
    if (parent === current) break;
    current = parent;
  }
  return null;
}
