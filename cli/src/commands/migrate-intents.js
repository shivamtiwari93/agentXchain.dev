/**
 * One-shot repair command for legacy and phantom intents.
 *
 * Handles two classes of stuck intents:
 * 1. Legacy (null-scoped): approved_run_id is null — pre-BUG-34 intents
 * 2. Phantom: approved_run_id matches current run but planning artifacts
 *    already exist on disk — would fail with "existing planning artifacts
 *    would be overwritten" if dispatched (BUG-42)
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import chalk from 'chalk';

import { findProjectRoot } from '../lib/config.js';
import { isPhantomIntent, migratePreBug34Intents } from '../lib/intent-startup-migration.js';
import { safeWriteJson } from '../lib/safe-write.js';

const MIGRATE_INTENTS_SCOPE = 'legacy_and_phantom';

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

function listPhantomIntents(root) {
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
    if (!intent.approved_run_id) continue;
    if (isPhantomIntent(root, intent)) {
      results.push({
        file,
        intent_id: intent.intent_id || file.replace('.json', ''),
        status: intent.status,
        approved_run_id: intent.approved_run_id,
      });
    }
  }
  return results;
}

function supersedePhantomIntents(root, phantomIntents) {
  const intentsDir = join(root, '.agentxchain', 'intake', 'intents');
  const now = new Date().toISOString();
  const supersededIds = [];

  for (const phantom of phantomIntents) {
    const intentPath = join(intentsDir, phantom.file);
    let intent;
    try {
      intent = JSON.parse(readFileSync(intentPath, 'utf8'));
    } catch {
      continue;
    }

    const prevStatus = intent.status;
    intent.status = 'superseded';
    intent.updated_at = now;
    intent.archived_reason = 'planning artifacts for this intent already exist on disk; intent superseded';
    if (!intent.history) intent.history = [];
    intent.history.push({
      from: prevStatus,
      to: 'superseded',
      at: now,
      reason: intent.archived_reason,
    });
    safeWriteJson(intentPath, intent);
    supersededIds.push(phantom.intent_id);
  }

  return supersededIds;
}

function buildJsonResult({ archivedCount, archivedIntentIds, phantomCount, phantomIntentIds, dryRun, message }) {
  return {
    archived_count: archivedCount,
    archived_intent_ids: archivedIntentIds,
    phantom_superseded_count: phantomCount,
    phantom_superseded_intent_ids: phantomIntentIds,
    scope: MIGRATE_INTENTS_SCOPE,
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
  const phantomIntents = listPhantomIntents(root);
  const totalIssues = legacyIntents.length + phantomIntents.length;

  if (opts.dryRun) {
    const msg = [];
    if (legacyIntents.length > 0) msg.push(`Would archive ${legacyIntents.length} legacy intent(s)`);
    if (phantomIntents.length > 0) msg.push(`Would supersede ${phantomIntents.length} phantom intent(s)`);
    const message = msg.length > 0 ? msg.join('; ') : 'No legacy or phantom intents found';

    if (opts.json) {
      console.log(JSON.stringify(buildJsonResult({
        archivedCount: legacyIntents.length,
        archivedIntentIds: legacyIntents.map((i) => i.intent_id),
        phantomCount: phantomIntents.length,
        phantomIntentIds: phantomIntents.map((i) => i.intent_id),
        dryRun: true,
        message,
      }), null, 2));
    } else {
      if (totalIssues === 0) {
        console.log(chalk.green('  No legacy or phantom intents found. Nothing to migrate.'));
      } else {
        if (legacyIntents.length > 0) {
          console.log(chalk.yellow(`  Would archive ${legacyIntents.length} legacy intent(s):`));
          for (const item of legacyIntents) {
            console.log(`    ${chalk.dim('•')} ${item.intent_id} (${item.status})`);
          }
        }
        if (phantomIntents.length > 0) {
          console.log(chalk.yellow(`  Would supersede ${phantomIntents.length} phantom intent(s) (planning artifacts already exist):`));
          for (const item of phantomIntents) {
            console.log(`    ${chalk.dim('•')} ${item.intent_id} (${item.status}, run=${item.approved_run_id})`);
          }
        }
      }
    }
    return;
  }

  if (totalIssues === 0) {
    if (opts.json) {
      console.log(JSON.stringify(buildJsonResult({
        archivedCount: 0,
        archivedIntentIds: [],
        phantomCount: 0,
        phantomIntentIds: [],
        dryRun: false,
        message: 'No legacy or phantom intents found',
      }), null, 2));
    } else {
      console.log(chalk.green('  No legacy or phantom intents found. Nothing to migrate.'));
    }
    return;
  }

  // Archive legacy intents
  const runId = loadRunId(root);
  const legacyResult = legacyIntents.length > 0
    ? migratePreBug34Intents(root, runId)
    : { archived_migration_count: 0, archived_migration_intent_ids: [], migration_notice: null };

  // Supersede phantom intents
  const phantomSupersededIds = phantomIntents.length > 0
    ? supersedePhantomIntents(root, phantomIntents)
    : [];

  const messages = [];
  if (legacyResult.archived_migration_count > 0) {
    messages.push(legacyResult.migration_notice || `Archived ${legacyResult.archived_migration_count} legacy intent(s)`);
  }
  if (phantomSupersededIds.length > 0) {
    messages.push(`Superseded ${phantomSupersededIds.length} phantom intent(s)`);
  }

  if (opts.json) {
    console.log(JSON.stringify(buildJsonResult({
      archivedCount: legacyResult.archived_migration_count,
      archivedIntentIds: legacyResult.archived_migration_intent_ids,
      phantomCount: phantomSupersededIds.length,
      phantomIntentIds: phantomSupersededIds,
      dryRun: false,
      message: messages.join('; ') || 'No legacy or phantom intents found',
    }), null, 2));
  } else {
    if (legacyResult.archived_migration_count > 0) {
      console.log(chalk.green(`  ✓ ${legacyResult.migration_notice}`));
      for (const id of legacyResult.archived_migration_intent_ids) {
        console.log(`    ${chalk.dim('•')} ${id}`);
      }
    }
    if (phantomSupersededIds.length > 0) {
      console.log(chalk.green(`  ✓ Superseded ${phantomSupersededIds.length} phantom intent(s)`));
      for (const id of phantomSupersededIds) {
        console.log(`    ${chalk.dim('•')} ${id}`);
      }
    }
    if (legacyResult.archived_migration_count === 0 && phantomSupersededIds.length === 0) {
      console.log(chalk.green('  No legacy or phantom intents found. Nothing to migrate.'));
    }
  }
}
