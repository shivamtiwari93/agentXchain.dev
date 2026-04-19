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

const MIGRATE_INTENTS_SCOPE = 'legacy_null_run_only';

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

function listRunScopedIntents(root) {
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
    if (!intent.approved_run_id) continue;
    results.push({
      file,
      intent_id: intent.intent_id || file.replace('.json', ''),
      status: intent.status,
      approved_run_id: intent.approved_run_id,
    });
  }
  return results;
}

function buildScopeWarning(runScopedIntents) {
  if (runScopedIntents.length === 0) return null;
  return `migrate-intents only archives legacy intents with no approved_run_id; ${runScopedIntents.length} run-scoped intent(s) were left unchanged.`;
}

function buildJsonResult({ archivedCount, archivedIntentIds, dryRun, message, runScopedIntents }) {
  const warning = buildScopeWarning(runScopedIntents);
  return {
    archived_count: archivedCount,
    archived_intent_ids: archivedIntentIds,
    scope: MIGRATE_INTENTS_SCOPE,
    skipped_run_scoped_count: runScopedIntents.length,
    skipped_run_scoped_intent_ids: runScopedIntents.map((intent) => intent.intent_id),
    warnings: warning ? [warning] : [],
    dry_run: dryRun,
    message,
  };
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
  const runScopedIntents = listRunScopedIntents(root);

  if (opts.dryRun) {
    if (opts.json) {
      console.log(JSON.stringify(buildJsonResult({
        archivedCount: legacyIntents.length,
        archivedIntentIds: legacyIntents.map((i) => i.intent_id),
        dryRun: true,
        message: legacyIntents.length > 0
          ? `Would archive ${legacyIntents.length} pre-BUG-34 intent(s)`
          : 'No legacy intents found',
        runScopedIntents,
      }), null, 2));
    } else {
      if (legacyIntents.length === 0) {
        console.log(chalk.green('  No legacy intents found. Nothing to migrate.'));
      } else {
        console.log(chalk.yellow(`  Would archive ${legacyIntents.length} legacy intent(s):`));
        for (const item of legacyIntents) {
          console.log(`    ${chalk.dim('•')} ${item.intent_id} (${item.status})`);
        }
      }
      const warning = buildScopeWarning(runScopedIntents);
      if (warning) {
        console.log(chalk.yellow(`  Note: ${warning}`));
      }
    }
    return;
  }

  if (legacyIntents.length === 0) {
    if (opts.json) {
      console.log(JSON.stringify(buildJsonResult({
        archivedCount: 0,
        archivedIntentIds: [],
        dryRun: false,
        message: 'No legacy intents found',
        runScopedIntents,
      }), null, 2));
    } else {
      console.log(chalk.green('  No legacy intents found. Nothing to migrate.'));
      const warning = buildScopeWarning(runScopedIntents);
      if (warning) {
        console.log(chalk.yellow(`  Note: ${warning}`));
      }
    }
    return;
  }

  const runId = loadRunId(root);
  const result = migratePreBug34Intents(root, runId);

  if (opts.json) {
    console.log(JSON.stringify(buildJsonResult({
      archivedCount: result.archived_migration_count,
      archivedIntentIds: result.archived_migration_intent_ids,
      dryRun: false,
      message: result.migration_notice || `Archived ${result.archived_migration_count} pre-BUG-34 intent(s)`,
      runScopedIntents,
    }), null, 2));
  } else {
    if (result.archived_migration_count === 0) {
      console.log(chalk.green('  No legacy intents found. Nothing to migrate.'));
    } else {
      console.log(chalk.green(`  ✓ ${result.migration_notice}`));
      for (const id of result.archived_migration_intent_ids) {
        console.log(`    ${chalk.dim('•')} ${id}`);
      }
    }
    const warning = buildScopeWarning(runScopedIntents);
    if (warning) {
      console.log(chalk.yellow(`  Note: ${warning}`));
    }
  }
}
