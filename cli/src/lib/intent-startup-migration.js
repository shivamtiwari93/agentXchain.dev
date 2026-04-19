import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { safeWriteJson } from './safe-write.js';

const DISPATCHABLE_STATUSES = new Set(['planned', 'approved']);

function nowISO() {
  return new Date().toISOString();
}

function getIntentsDir(root) {
  return join(root, '.agentxchain', 'intake', 'intents');
}

function listIntentFiles(intentsDir) {
  if (!existsSync(intentsDir)) return [];
  return readdirSync(intentsDir).filter((file) => file.endsWith('.json') && !file.startsWith('.tmp-'));
}

export function formatLegacyIntentMigrationNotice(intentIds) {
  if (!Array.isArray(intentIds) || intentIds.length === 0) return null;
  return `Archived ${intentIds.length} pre-BUG-34 intent(s): ${intentIds.join(', ')}`;
}

export function migratePreBug34Intents(root, runId, options = {}) {
  const intentsDir = getIntentsDir(root);
  if (!existsSync(intentsDir)) {
    return {
      archived_migration_count: 0,
      archived_migration_intent_ids: [],
      migration_notice: null,
    };
  }

  const now = nowISO();
  const archivedMigrationIntentIds = [];
  const protocolVersion = options.protocolVersion || '2.x';

  for (const file of listIntentFiles(intentsDir)) {
    const intentPath = join(intentsDir, file);
    let intent;
    try {
      intent = JSON.parse(readFileSync(intentPath, 'utf8'));
    } catch {
      continue;
    }

    if (!intent || !DISPATCHABLE_STATUSES.has(intent.status)) continue;
    if (intent.cross_run_durable === true) continue;
    if (intent.approved_run_id) continue;

    const prevStatus = intent.status;
    intent.status = 'archived_migration';
    intent.updated_at = now;
    intent.archived_reason = `pre-BUG-34 intent with no run scope; archived during v${protocolVersion} migration on run ${runId}`;
    if (!intent.history) intent.history = [];
    intent.history.push({
      from: prevStatus,
      to: 'archived_migration',
      at: now,
      reason: intent.archived_reason,
    });
    safeWriteJson(intentPath, intent);
    if (intent.intent_id) archivedMigrationIntentIds.push(intent.intent_id);
  }

  return {
    archived_migration_count: archivedMigrationIntentIds.length,
    archived_migration_intent_ids: archivedMigrationIntentIds,
    migration_notice: formatLegacyIntentMigrationNotice(archivedMigrationIntentIds),
  };
}

export function archiveStaleIntentsForRun(root, runId, options = {}) {
  const intentsDir = getIntentsDir(root);
  if (!existsSync(intentsDir)) {
    return {
      archived: 0,
      adopted: 0,
      archived_migration_count: 0,
      archived_migration_intent_ids: [],
      migration_notice: null,
    };
  }

  const now = nowISO();
  let archived = 0;
  let adopted = 0;

  for (const file of listIntentFiles(intentsDir)) {
    const intentPath = join(intentsDir, file);
    let intent;
    try {
      intent = JSON.parse(readFileSync(intentPath, 'utf8'));
    } catch {
      continue;
    }

    if (!intent || !DISPATCHABLE_STATUSES.has(intent.status)) continue;

    if (intent.cross_run_durable === true && !intent.approved_run_id) {
      intent.approved_run_id = runId;
      delete intent.cross_run_durable;
      intent.updated_at = now;
      if (!intent.history) intent.history = [];
      intent.history.push({
        from: intent.status,
        to: intent.status,
        at: now,
        reason: `pre-run durable approval bound to run ${runId}`,
      });
      safeWriteJson(intentPath, intent);
      adopted += 1;
      continue;
    }

    if (intent.cross_run_durable === true && intent.approved_run_id === runId) {
      delete intent.cross_run_durable;
      intent.updated_at = now;
      safeWriteJson(intentPath, intent);
      continue;
    }

    if (intent.approved_run_id && intent.approved_run_id !== runId) {
      const prevStatus = intent.status;
      intent.status = 'suppressed';
      intent.updated_at = now;
      intent.archived_reason = `stale: approved under run ${intent.approved_run_id}, archived on run ${runId} initialization`;
      if (!intent.history) intent.history = [];
      intent.history.push({
        from: prevStatus,
        to: 'suppressed',
        at: now,
        reason: intent.archived_reason,
      });
      safeWriteJson(intentPath, intent);
      archived += 1;
    }
  }

  const migration = migratePreBug34Intents(root, runId, options);

  return {
    archived,
    adopted,
    archived_migration_count: migration.archived_migration_count,
    archived_migration_intent_ids: migration.archived_migration_intent_ids,
    migration_notice: migration.migration_notice,
  };
}
