/**
 * One-shot repair command for legacy intents stuck with approved_run_id: null.
 *
 * Belt-and-suspenders insurance for BUG-41: the automatic startup migration
 * is now idempotent, but operators who already have stuck repos need a direct
 * lever that works without starting a governed run.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import chalk from 'chalk';

import { findProjectRoot } from '../lib/config.js';
import { migratePreBug34Intents } from '../lib/intent-startup-migration.js';

function loadRunId(root) {
  const statePath = join(root, '.agentxchain', 'state.json');
  if (!existsSync(statePath)) return 'manual-migration';
  try {
    const state = JSON.parse(readFileSync(statePath, 'utf8'));
    return state.run_id || 'manual-migration';
  } catch {
    return 'manual-migration';
  }
}

function listLegacyIntents(root) {
  const intentsDir = join(root, '.agentxchain', 'intake', 'intents');
  if (!existsSync(intentsDir)) return [];

  const DISPATCHABLE = new Set(['planned', 'approved']);
  const results = [];

  for (const file of readdirSync(intentsDir)) {
    if (!file.endsWith('.json') || file.startsWith('.tmp-')) continue;
    const intentPath = join(intentsDir, file);
    let intent;
    try {
      intent = JSON.parse(readFileSync(intentPath, 'utf8'));
    } catch {
      continue;
    }
    if (!intent || !DISPATCHABLE.has(intent.status)) continue;
    if (intent.cross_run_durable === true) continue;
    if (intent.approved_run_id) continue;
    results.push({ file, intent_id: intent.intent_id || file.replace('.json', ''), status: intent.status });
  }
  return results;
}

export function migrateIntentsCommand(opts) {
  const root = findProjectRoot();
  if (!root) {
    if (opts.json) {
      console.log(JSON.stringify({ error: 'No agentxchain.json found. Run from inside a governed project.' }));
    } else {
      console.error(chalk.red('  No agentxchain.json found. Run this from inside a governed project.'));
    }
    process.exit(1);
  }

  const legacyIntents = listLegacyIntents(root);

  if (opts.dryRun) {
    if (opts.json) {
      console.log(JSON.stringify({
        archived_count: legacyIntents.length,
        archived_intent_ids: legacyIntents.map(i => i.intent_id),
        dry_run: true,
        message: legacyIntents.length > 0
          ? `Would archive ${legacyIntents.length} pre-BUG-34 intent(s)`
          : 'No legacy intents found',
      }, null, 2));
    } else {
      if (legacyIntents.length === 0) {
        console.log(chalk.green('  No legacy intents found. Nothing to migrate.'));
      } else {
        console.log(chalk.yellow(`  Would archive ${legacyIntents.length} legacy intent(s):`));
        for (const item of legacyIntents) {
          console.log(`    ${chalk.dim('•')} ${item.intent_id} (${item.status})`);
        }
      }
    }
    return;
  }

  if (legacyIntents.length === 0) {
    if (opts.json) {
      console.log(JSON.stringify({
        archived_count: 0,
        archived_intent_ids: [],
        dry_run: false,
        message: 'No legacy intents found',
      }, null, 2));
    } else {
      console.log(chalk.green('  No legacy intents found. Nothing to migrate.'));
    }
    return;
  }

  const runId = loadRunId(root);
  const result = migratePreBug34Intents(root, runId);

  if (opts.json) {
    console.log(JSON.stringify({
      archived_count: result.archived_migration_count,
      archived_intent_ids: result.archived_migration_intent_ids,
      dry_run: false,
      message: result.migration_notice || `Archived ${result.archived_migration_count} pre-BUG-34 intent(s)`,
    }, null, 2));
  } else {
    if (result.archived_migration_count === 0) {
      console.log(chalk.green('  No legacy intents found. Nothing to migrate.'));
    } else {
      console.log(chalk.green(`  ✓ ${result.migration_notice}`));
      for (const id of result.archived_migration_intent_ids) {
        console.log(`    ${chalk.dim('•')} ${id}`);
      }
    }
  }
}
