/**
 * BUG-21 beta-tester scenario: `restart` must consume approved intents (same
 * as resume/step), so `intent_id` propagates into lifecycle events.
 *
 * Root cause: restart.js called assignGovernedTurn without intakeContext.
 * Fix: restart now calls consumeNextApprovedIntent before assignment.
 *
 * This test verifies the fix at the API level: when an approved intent exists
 * and a new turn is assigned with consumeNextApprovedIntent, the intent_id
 * propagates into the turn_dispatched event.
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  initializeGovernedRun,
  assignGovernedTurn,
  acceptGovernedTurn,
  normalizeGovernedStateShape,
} from '../../src/lib/governed-state.js';
import { writeDispatchBundle } from '../../src/lib/dispatch-bundle.js';
import { injectIntent, approveIntent, consumeNextApprovedIntent } from '../../src/lib/intake.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(__dirname, '..', '..', 'bin', 'agentxchain.js');
const tempDirs = [];

function makeRawConfig() {
  return {
    schema_version: '1.0',
    protocol_mode: 'governed',
    template: 'generic',
    project: { id: 'bug21-test', name: 'BUG-21 Test', default_branch: 'main' },
    roles: {
      pm: { title: 'PM', mandate: 'Plan', write_authority: 'review_only', runtime: 'manual-pm' },
      dev: { title: 'Dev', mandate: 'Build', write_authority: 'authoritative', runtime: 'manual-dev' },
    },
    runtimes: { 'manual-pm': { type: 'manual' }, 'manual-dev': { type: 'manual' } },
    routing: {
      planning: { entry_role: 'pm', allowed_next_roles: ['pm', 'dev'] },
      implementation: { entry_role: 'dev', allowed_next_roles: ['dev', 'pm'] },
    },
    gates: {},
  };
}

function makeConfig() {
  return {
    schema_version: 4,
    protocol_mode: 'governed',
    project: { id: 'bug21-test', name: 'BUG-21 Test', default_branch: 'main' },
    roles: {
      pm: { title: 'PM', mandate: 'Plan', write_authority: 'review_only', runtime_class: 'manual', runtime_id: 'manual-pm' },
      dev: { title: 'Dev', mandate: 'Build', write_authority: 'authoritative', runtime_class: 'manual', runtime_id: 'manual-dev' },
    },
    runtimes: { 'manual-pm': { type: 'manual' }, 'manual-dev': { type: 'manual' } },
    phases: [{ id: 'planning', name: 'Planning' }, { id: 'implementation', name: 'Implementation' }],
    routing: {
      planning: { entry_role: 'pm', allowed_next_roles: ['pm', 'dev'] },
      implementation: { entry_role: 'dev', allowed_next_roles: ['dev', 'pm'] },
    },
    gates: {},
  };
}

function createProject(config) {
  const root = mkdtempSync(join(tmpdir(), 'axc-bug21-'));
  tempDirs.push(root);
  mkdirSync(join(root, '.agentxchain', 'staging'), { recursive: true });
  mkdirSync(join(root, '.agentxchain', 'intake', 'intents'), { recursive: true });
  mkdirSync(join(root, '.planning'), { recursive: true });
  writeFileSync(join(root, 'agentxchain.json'), JSON.stringify(makeRawConfig(), null, 2));
  writeFileSync(join(root, 'README.md'), '# Test\n');
  execSync('git init && git config user.email "test@test.com" && git config user.name "Test"', { cwd: root, stdio: 'ignore' });
  execSync('git add -A && git commit -m "init"', { cwd: root, stdio: 'ignore' });
  return root;
}

function readState(root) {
  return normalizeGovernedStateShape(JSON.parse(readFileSync(join(root, '.agentxchain/state.json'), 'utf8'))).state;
}

function readEvents(root) {
  try {
    return readFileSync(join(root, '.agentxchain', 'events.jsonl'), 'utf8')
      .trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
  } catch { return []; }
}

afterEach(() => {
  while (tempDirs.length > 0) { try { rmSync(tempDirs.pop(), { recursive: true, force: true }); } catch {} }
});

describe('BUG-21 beta-tester scenario: intent_id propagation through restart', () => {
  it('when approved intent exists, next turn assignment includes intent_id in events', () => {
    const config = makeConfig();
    const root = createProject(config);

    // 1. Initialize + first turn + accept
    initializeGovernedRun(root, config);
    const assign1 = assignGovernedTurn(root, config, 'pm');
    assert.ok(assign1.ok);
    const turnId1 = assign1.turn.turn_id;
    const state1 = readState(root);
    writeDispatchBundle(root, state1, config, { turnId: turnId1 });

    writeFileSync(join(root, '.agentxchain', 'staging', 'turn-result.json'), JSON.stringify({
      schema_version: '1.0', run_id: state1.run_id, turn_id: turnId1,
      role: 'pm', runtime_id: 'manual-pm', status: 'completed',
      summary: 'Initial turn.', decisions: [], files_changed: [],
      objections: [{ id: 'OBJ-1', target: 'process', statement: 'Review', severity: 'low' }],
      verification: { status: 'skipped' }, artifact: { type: 'review', ref: null },
      proposed_next_role: 'pm',
    }, null, 2));

    acceptGovernedTurn(root, config, {
      turnId: turnId1,
      resultPath: join(root, '.agentxchain', 'staging', 'turn-result.json'),
    });

    // 2. Inject + approve intent
    const inject = injectIntent(root, 'Review docs thoroughly', {
      priority: 'p0', charter: 'Review docs thoroughly', acceptance: 'Check README',
    });
    assert.ok(inject.ok);
    const intentId = inject.intent.intent_id;
    if (inject.intent.status !== 'approved') approveIntent(root, intentId);

    // 3. Simulate what restart does: consume intent (which internally assigns the turn)
    const consumed = consumeNextApprovedIntent(root, { role: 'pm' });
    assert.ok(consumed && consumed.ok, `Must consume the approved intent: ${JSON.stringify(consumed)}`);
    assert.equal(consumed.intentId, intentId, 'consumeNextApprovedIntent must return the correct intentId');

    // 4. Check events — the second turn_dispatched must have intent_id
    const events = readEvents(root);
    const dispatched = events.filter(e => e.event_type === 'turn_dispatched');
    assert.ok(dispatched.length >= 2, `Expected ≥2 turn_dispatched events, got ${dispatched.length}`);

    const lastDispatch = dispatched[dispatched.length - 1];
    const eventIntentId = lastDispatch.intent_id || lastDispatch.payload?.intent_id;
    assert.ok(eventIntentId, `Last turn_dispatched must have intent_id. Event: ${JSON.stringify(lastDispatch)}`);
    assert.equal(eventIntentId, intentId, 'intent_id must match injected intent');
  });
});
