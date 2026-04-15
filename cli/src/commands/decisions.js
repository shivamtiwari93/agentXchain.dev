/**
 * agentxchain decisions — cross-run decision carryover surface.
 *
 * Shows repo-level decisions that persist across governed runs.
 */

import { resolve } from 'path';
import { existsSync, readFileSync } from 'fs';
import chalk from 'chalk';
import {
  readRepoDecisions,
  getActiveRepoDecisions,
  getRepoDecisionById,
  resolveDecisionAuthority,
  getDecisionAuthorityMetadata,
} from '../lib/repo-decisions.js';

/**
 * @param {object} opts - { json?: boolean, all?: boolean, show?: string, dir?: string }
 */
export async function decisionsCommand(opts) {
  const root = findProjectRoot(opts.dir || process.cwd());
  if (!root) {
    console.error(chalk.red('No AgentXchain project found. Run this inside a governed project.'));
    process.exit(1);
  }
  const config = loadConfig(root);

  // ── Show single decision ───────────────────────────────────────────────
  if (opts.show) {
    const dec = getRepoDecisionById(root, opts.show);
    if (!dec) {
      console.error(chalk.red(`Decision ${opts.show} not found in repo decisions.`));
      process.exit(1);
    }
    const enriched = enrichDecision(dec, config);
    if (opts.json) {
      console.log(JSON.stringify(enriched, null, 2));
      return;
    }
    console.log(chalk.bold(`Decision ${enriched.id}`));
    console.log(`  Category:    ${enriched.category || '—'}`);
    console.log(`  Statement:   ${enriched.statement || '—'}`);
    console.log(`  Rationale:   ${enriched.rationale || '—'}`);
    console.log(`  Status:      ${formatStatus(enriched.status)}`);
    console.log(`  Binding:     ${formatBindingState(enriched.binding_state)}`);
    console.log(`  Role:        ${enriched.role || '—'}`);
    console.log(`  Phase:       ${enriched.phase || '—'}`);
    console.log(`  Run:         ${(enriched.run_id || '—').slice(0, 16)}`);
    console.log(`  Turn:        ${(enriched.turn_id || '—').slice(0, 16)}`);
    console.log(`  Durability:  ${enriched.durability || 'repo'}`);
    // Show decision authority if config has it
    if (config && enriched.role) {
      const auth = resolveDecisionAuthority(enriched.role, config);
      if (auth !== null && !(typeof auth === 'object' && auth.unknown)) {
        console.log(`  Authority:   ${auth} (${enriched.role})`);
      }
    }
    if (enriched.overrides) {
      console.log(`  Supersedes:  ${chalk.yellow(enriched.overrides)}`);
    }
    console.log(`  Created:     ${enriched.created_at || '—'}`);
    if (enriched.overridden_by) {
      console.log(`  Overridden:  ${chalk.yellow(enriched.overridden_by)}`);
    }
    return;
  }

  // ── List decisions ─────────────────────────────────────────────────────
  const allDecisions = readRepoDecisions(root);
  const decisions = opts.all ? allDecisions : getActiveRepoDecisions(root);
  const enrichedDecisions = decisions.map((dec) => enrichDecision(dec, config));

  if (opts.json) {
    console.log(JSON.stringify(enrichedDecisions, null, 2));
    return;
  }

  if (enrichedDecisions.length === 0) {
    console.log(chalk.dim(opts.all ? 'No repo-level decisions found.' : 'No active repo decisions found.'));
    if (!opts.all && allDecisions.length > 0) {
      console.log(chalk.dim('Use --all to include overridden decisions.'));
      return;
    }
    return;
  }

  const label = opts.all ? 'Repo Decisions (all)' : 'Active Repo Decisions';
  const allEnrichedDecisions = allDecisions.map((dec) => enrichDecision(dec, config));
  const summary = buildDecisionListSummary(allEnrichedDecisions, opts.all);
  console.log(chalk.bold(`${label}: ${enrichedDecisions.length}`));
  console.log(chalk.dim(summary.binding_line));
  if (summary.category_line) console.log(chalk.dim(summary.category_line));
  if (summary.history_line) console.log(chalk.dim(summary.history_line));
  if (summary.authority_line) console.log(chalk.dim(summary.authority_line));
  console.log('');

  for (const dec of enrichedDecisions) {
    const status = formatStatus(dec.status);
    const runShort = (dec.run_id || '').slice(0, 12);
    const override = dec.overridden_by
      ? chalk.dim(` → ${dec.overridden_by}`)
      : dec.overrides
        ? chalk.dim(` ← supersedes ${dec.overrides}`)
        : '';
    const authority = formatAuthority(dec);
    console.log(`  ${chalk.cyan(dec.id)}  ${status}  ${chalk.dim(dec.category)}  ${dec.statement}${override}`);
    console.log(`    ${chalk.dim(`by ${dec.role || '?'} in ${runShort || '?'}${authority}`)}`);
  }
}

function formatStatus(status) {
  if (status === 'active') return chalk.green('active');
  if (status === 'overridden') return chalk.yellow('overridden');
  return chalk.dim(status || '—');
}

function enrichDecision(decision, config) {
  const authority = getDecisionAuthorityMetadata(decision.role, config);
  return {
    ...decision,
    binding_state: decision.status === 'active'
      ? 'binding'
      : decision.overridden_by
        ? 'replaced'
        : 'historical',
    authority_level: authority?.level ?? null,
    authority_source: authority?.source ?? null,
  };
}

function buildDecisionListSummary(allDecisions, includeAll) {
  const activeDecisions = allDecisions.filter((decision) => decision.status === 'active');
  const overriddenCount = allDecisions.filter((decision) => decision.status === 'overridden').length;
  const categories = [...new Set(activeDecisions.map((decision) => decision.category).filter(Boolean))];
  const authorities = activeDecisions
    .filter((decision) => typeof decision.authority_level === 'number');
  const highestAuthority = authorities.reduce((current, decision) => {
    if (!current || decision.authority_level > current.authority_level) return decision;
    return current;
  }, null);

  return {
    binding_line: `binding now: ${activeDecisions.length} active decision${activeDecisions.length === 1 ? '' : 's'}`,
    category_line: categories.length > 0
      ? `categories: ${categories.join(', ')}`
      : null,
    history_line: overriddenCount > 0
      ? includeAll
        ? `history: ${overriddenCount} overridden decision${overriddenCount === 1 ? '' : 's'} recorded`
        : `history: ${overriddenCount} overridden decision${overriddenCount === 1 ? '' : 's'} hidden (use --all)`
      : null,
    authority_line: highestAuthority
      ? `highest active authority: ${highestAuthority.authority_level} (${highestAuthority.role || 'unknown'})`
      : null,
  };
}

function formatAuthority(decision) {
  if (typeof decision.authority_level === 'number') {
    if (decision.authority_source === 'unknown_role') return ' • authority unknown';
    return ` • authority ${decision.authority_level}`;
  }
  return '';
}

function formatBindingState(bindingState) {
  if (bindingState === 'binding') return chalk.green('binding');
  if (bindingState === 'replaced') return chalk.yellow('replaced');
  if (bindingState === 'historical') return chalk.dim('historical');
  return chalk.dim('—');
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

function loadConfig(root) {
  const configPath = resolve(root, 'agentxchain.json');
  if (!existsSync(configPath)) return null;
  try {
    return JSON.parse(readFileSync(configPath, 'utf8'));
  } catch {
    return null;
  }
}
