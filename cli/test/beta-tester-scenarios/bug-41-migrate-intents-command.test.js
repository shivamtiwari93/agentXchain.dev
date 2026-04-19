import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createLegacyIntentRepo,
  seedLegacyIntent,
  readIntent,
} from './_helpers/legacy-intent-fixture.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const CLI = join(__dirname, '..', '..', 'bin', 'agentxchain.js');

function run(args, cwd) {
  return execFileSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, NODE_NO_WARNINGS: '1' },
    timeout: 15_000,
  });
}

describe('BUG-41: migrate-intents one-shot repair command', () => {
  // AT-MI-001: archives legacy intents
  it('archives all legacy intents and reports correct count and IDs', () => {
    const root = createLegacyIntentRepo('axc-mi-001-');
    seedLegacyIntent(root, 'intent-legacy-a');
    seedLegacyIntent(root, 'intent-legacy-b');
    seedLegacyIntent(root, 'intent-legacy-c');

    const output = run(['migrate-intents', '--json'], root);
    const result = JSON.parse(output);

    assert.equal(result.archived_count, 3);
    assert.equal(result.dry_run, false);
    assert.equal(result.scope, 'legacy_and_phantom');
    assert.equal(result.phantom_superseded_count, 0);
    assert.deepStrictEqual(result.archived_intent_ids.sort(), [
      'intent-legacy-a',
      'intent-legacy-b',
      'intent-legacy-c',
    ]);

    // Verify on disk
    const a = readIntent(root, 'intent-legacy-a');
    assert.equal(a.status, 'archived_migration');
    const b = readIntent(root, 'intent-legacy-b');
    assert.equal(b.status, 'archived_migration');
    const c = readIntent(root, 'intent-legacy-c');
    assert.equal(c.status, 'archived_migration');
  });

  // AT-MI-002: no legacy intents
  it('reports 0 when no legacy intents exist', () => {
    const root = createLegacyIntentRepo('axc-mi-002-');

    const output = run(['migrate-intents', '--json'], root);
    const result = JSON.parse(output);

    assert.equal(result.archived_count, 0);
    assert.deepStrictEqual(result.archived_intent_ids, []);
    assert.equal(result.scope, 'legacy_and_phantom');
    assert.equal(result.phantom_superseded_count, 0);
  });

  // AT-MI-003: dry-run does not modify
  it('--dry-run lists intents without modifying them on disk', () => {
    const root = createLegacyIntentRepo('axc-mi-003-');
    seedLegacyIntent(root, 'intent-dry-a');
    seedLegacyIntent(root, 'intent-dry-b');

    const output = run(['migrate-intents', '--json', '--dry-run'], root);
    const result = JSON.parse(output);

    assert.equal(result.archived_count, 2);
    assert.equal(result.dry_run, true);
    assert.equal(result.scope, 'legacy_and_phantom');

    // Files should NOT be modified
    const a = readIntent(root, 'intent-dry-a');
    assert.equal(a.status, 'approved', 'dry-run must not modify intent status');
    assert.equal(a.approved_run_id, null, 'dry-run must not set approved_run_id');
  });

  // AT-MI-004: cross_run_durable intents are not archived
  it('does not archive cross_run_durable intents', () => {
    const root = createLegacyIntentRepo('axc-mi-004-');
    seedLegacyIntent(root, 'intent-durable');
    // Make it cross_run_durable
    const intent = readIntent(root, 'intent-durable');
    intent.cross_run_durable = true;
    writeFileSync(
      join(root, '.agentxchain', 'intake', 'intents', 'intent-durable.json'),
      JSON.stringify(intent, null, 2),
    );

    const output = run(['migrate-intents', '--json'], root);
    const result = JSON.parse(output);

    assert.equal(result.archived_count, 0);
    assert.equal(result.phantom_superseded_count, 0);
    // Verify it was NOT modified
    const after = readIntent(root, 'intent-durable');
    assert.equal(after.status, 'approved');
  });

  // AT-MI-005: run-scoped non-phantom intents are left unchanged
  it('does not archive run-scoped non-phantom intents', () => {
    const root = createLegacyIntentRepo('axc-mi-005-');
    seedLegacyIntent(root, 'intent-legacy');
    seedLegacyIntent(root, 'intent-run-bound');

    const runBound = readIntent(root, 'intent-run-bound');
    runBound.approved_run_id = 'run_prior';
    writeFileSync(
      join(root, '.agentxchain', 'intake', 'intents', 'intent-run-bound.json'),
      JSON.stringify(runBound, null, 2),
    );

    const output = run(['migrate-intents', '--json'], root);
    const result = JSON.parse(output);

    assert.equal(result.scope, 'legacy_and_phantom');
    assert.equal(result.archived_count, 1);
    assert.deepStrictEqual(result.archived_intent_ids, ['intent-legacy']);
    assert.equal(result.phantom_superseded_count, 0);

    const legacy = readIntent(root, 'intent-legacy');
    assert.equal(legacy.status, 'archived_migration');

    const after = readIntent(root, 'intent-run-bound');
    assert.equal(after.status, 'approved');
    assert.equal(after.approved_run_id, 'run_prior');
  });

  // AT-MI-006: dry-run on run-scoped non-phantom intents
  it('dry-run correctly reports scope for run-scoped non-phantom intents', () => {
    const root = createLegacyIntentRepo('axc-mi-006-');
    seedLegacyIntent(root, 'intent-run-bound');

    const runBound = readIntent(root, 'intent-run-bound');
    runBound.approved_run_id = 'run_existing';
    writeFileSync(
      join(root, '.agentxchain', 'intake', 'intents', 'intent-run-bound.json'),
      JSON.stringify(runBound, null, 2),
    );

    const output = run(['migrate-intents', '--json', '--dry-run'], root);
    const result = JSON.parse(output);

    assert.equal(result.scope, 'legacy_and_phantom');
    assert.equal(result.archived_count, 0);
    assert.equal(result.phantom_superseded_count, 0);
    assert.equal(result.dry_run, true);
  });
});
