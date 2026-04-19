/**
 * BUG-48 beta-tester scenario: injected intent lifecycle contradiction.
 *
 * When an intent transitions to superseded, the preemption marker
 * (injected-priority.json) must be cleared, `status` must not show
 * "Priority injection pending", and continuous run must not react to it.
 *
 * Tester sequence:
 *   1. Inject a p0 intent that would be auto-superseded (phantom detection)
 *   2. Assert intent JSON is superseded
 *   3. Assert injected-priority.json is cleared
 *   4. Assert status does not show "Priority injection pending"
 *   5. Assert continuous run does not react to the stale intent
 */

import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  initializeGovernedRun,
} from '../../src/lib/governed-state.js';
import {
  validatePreemptionMarker,
  clearPreemptionMarkerForIntent,
  triageIntent,
} from '../../src/lib/intake.js';
import { safeWriteJson } from '../../src/lib/safe-write.js';

const ROOT = join(import.meta.dirname, '..', '..');
const CLI_PATH = join(ROOT, 'bin', 'agentxchain.js');
const INTENT_ID = 'intent_1776631311439_ca68';
const EVENT_ID = 'evt_1776631311439_bug48';
const tempDirs = [];

function makeConfig() {
  return {
    schema_version: '1.0',
    protocol_mode: 'governed',
    template: 'generic',
    project: { id: 'bug48-test', name: 'BUG-48 Test', default_branch: 'main' },
    roles: {
      dev: { title: 'Developer', mandate: 'Build.', write_authority: 'authoritative', runtime: 'manual-dev' },
    },
    runtimes: { 'manual-dev': { type: 'manual' } },
    routing: {
      planning: { entry_role: 'dev', allowed_next_roles: ['dev'], exit_gate: 'planning_signoff' },
    },
    gates: { planning_signoff: {} },
  };
}

function createProject() {
  const root = mkdtempSync(join(tmpdir(), 'axc-bug48-'));
  tempDirs.push(root);

  mkdirSync(join(root, '.agentxchain', 'intake', 'events'), { recursive: true });
  mkdirSync(join(root, '.agentxchain', 'intake', 'intents'), { recursive: true });
  writeFileSync(join(root, 'README.md'), '# BUG-48\n');
  writeFileSync(join(root, 'agentxchain.json'), JSON.stringify(makeConfig(), null, 2));

  execSync('git init -b main', { cwd: root, stdio: 'ignore' });
  execSync('git config user.email "test@test.com"', { cwd: root, stdio: 'ignore' });
  execSync('git config user.name "Test"', { cwd: root, stdio: 'ignore' });
  execSync('git add -A && git commit -m "init"', { cwd: root, stdio: 'ignore' });

  const config = makeConfig();
  const init = initializeGovernedRun(root, config);
  assert.ok(init.ok, init.error);
  return { root, config, state: init.state };
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

describe('BUG-48: injected intent lifecycle contradiction', () => {
  it('clearPreemptionMarkerForIntent clears marker for matching intent', () => {
    const { root } = createProject();

    // Write a preemption marker
    const markerPath = join(root, '.agentxchain', 'intake', 'injected-priority.json');
    safeWriteJson(markerPath, {
      intent_id: INTENT_ID,
      priority: 'p0',
      description: 'test',
      injected_at: new Date().toISOString(),
    });
    assert.ok(existsSync(markerPath), 'Preemption marker should exist');

    // Clear for matching intent
    clearPreemptionMarkerForIntent(root, INTENT_ID);
    assert.ok(!existsSync(markerPath), 'Preemption marker should be cleared');
  });

  it('clearPreemptionMarkerForIntent does NOT clear marker for different intent', () => {
    const { root } = createProject();

    const markerPath = join(root, '.agentxchain', 'intake', 'injected-priority.json');
    safeWriteJson(markerPath, {
      intent_id: INTENT_ID,
      priority: 'p0',
      description: 'test',
      injected_at: new Date().toISOString(),
    });

    clearPreemptionMarkerForIntent(root, 'intent_different_1234');
    assert.ok(existsSync(markerPath), 'Preemption marker should NOT be cleared for different intent');
  });

  it('validatePreemptionMarker auto-clears stale marker for superseded intent', () => {
    const { root, state } = createProject();

    // Seed a superseded intent and a preemption marker pointing at it
    const intentPath = join(root, '.agentxchain', 'intake', 'intents', `${INTENT_ID}.json`);
    safeWriteJson(intentPath, {
      schema_version: '1.0',
      intent_id: INTENT_ID,
      event_id: EVENT_ID,
      status: 'superseded',
      priority: 'p0',
      archived_reason: 'planning artifacts for this intent already exist on disk; intent superseded during approval',
      history: [],
    });

    const markerPath = join(root, '.agentxchain', 'intake', 'injected-priority.json');
    safeWriteJson(markerPath, {
      intent_id: INTENT_ID,
      priority: 'p0',
      description: 'test intent',
      injected_at: new Date().toISOString(),
    });

    // validatePreemptionMarker should auto-clear and return null
    const result = validatePreemptionMarker(root);
    assert.equal(result, null, 'Should return null for superseded intent');
    assert.ok(!existsSync(markerPath), 'Marker file should be cleared');
  });

  it('status --json does not show preemption_marker for superseded intent', () => {
    const { root, state } = createProject();

    // Seed superseded intent + stale marker
    const intentPath = join(root, '.agentxchain', 'intake', 'intents', `${INTENT_ID}.json`);
    safeWriteJson(intentPath, {
      schema_version: '1.0',
      intent_id: INTENT_ID,
      event_id: EVENT_ID,
      status: 'superseded',
      priority: 'p0',
      archived_reason: 'planning artifacts already exist',
      history: [],
    });

    const markerPath = join(root, '.agentxchain', 'intake', 'injected-priority.json');
    safeWriteJson(markerPath, {
      intent_id: INTENT_ID,
      priority: 'p0',
      description: 'should not appear in status',
      injected_at: new Date().toISOString(),
    });

    // Run status --json
    const result = execSync(`node "${CLI_PATH}" status --json`, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const json = JSON.parse(result);
    assert.equal(json.preemption_marker, null, 'preemption_marker should be null for superseded intent');
  });

  it('validatePreemptionMarker preserves marker for actionable intent', () => {
    const { root, state } = createProject();

    // Seed an approved (actionable) intent + preemption marker
    const intentPath = join(root, '.agentxchain', 'intake', 'intents', `${INTENT_ID}.json`);
    safeWriteJson(intentPath, {
      schema_version: '1.0',
      intent_id: INTENT_ID,
      event_id: EVENT_ID,
      status: 'approved',
      priority: 'p0',
      approved_run_id: state.run_id,
      history: [],
    });

    const markerPath = join(root, '.agentxchain', 'intake', 'injected-priority.json');
    safeWriteJson(markerPath, {
      intent_id: INTENT_ID,
      priority: 'p0',
      description: 'should be preserved',
      injected_at: new Date().toISOString(),
    });

    const result = validatePreemptionMarker(root);
    assert.ok(result, 'Marker should be preserved for actionable intent');
    assert.equal(result.intent_id, INTENT_ID);
    assert.ok(existsSync(markerPath), 'Marker file should still exist');
  });

  it('triage reject clears a stale marker immediately at the writer', () => {
    const { root } = createProject();

    const intentPath = join(root, '.agentxchain', 'intake', 'intents', `${INTENT_ID}.json`);
    safeWriteJson(intentPath, {
      schema_version: '1.0',
      intent_id: INTENT_ID,
      event_id: EVENT_ID,
      status: 'triaged',
      history: [],
    });

    const markerPath = join(root, '.agentxchain', 'intake', 'injected-priority.json');
    safeWriteJson(markerPath, {
      intent_id: INTENT_ID,
      priority: 'p0',
      description: 'reject-me',
      injected_at: new Date().toISOString(),
    });

    const rejected = triageIntent(root, INTENT_ID, { reject: true, reason: 'not needed' });
    assert.ok(rejected.ok, rejected.error);
    assert.equal(rejected.intent.status, 'rejected');
    assert.ok(!existsSync(markerPath), 'reject transition must clear the marker');
  });

  it('validatePreemptionMarker auto-clears archived_migration marker', () => {
    const { root } = createProject();

    const intentPath = join(root, '.agentxchain', 'intake', 'intents', `${INTENT_ID}.json`);
    safeWriteJson(intentPath, {
      schema_version: '1.0',
      intent_id: INTENT_ID,
      event_id: EVENT_ID,
      status: 'archived_migration',
      history: [],
    });

    const markerPath = join(root, '.agentxchain', 'intake', 'injected-priority.json');
    safeWriteJson(markerPath, {
      intent_id: INTENT_ID,
      priority: 'p0',
      description: 'migration-stale',
      injected_at: new Date().toISOString(),
    });

    const validated = validatePreemptionMarker(root);
    assert.equal(validated, null);
    assert.ok(!existsSync(markerPath));
  });
});
