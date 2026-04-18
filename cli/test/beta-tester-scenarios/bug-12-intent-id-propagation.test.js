/**
 * BUG-12 beta-tester scenario: turn_dispatched and lifecycle events must
 * include intent_id when the turn fulfills an injected intent.
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';

import {
  initializeGovernedRun,
  assignGovernedTurn,
  normalizeGovernedStateShape,
} from '../../src/lib/governed-state.js';
import { writeDispatchBundle } from '../../src/lib/dispatch-bundle.js';
import { injectIntent, approveIntent, consumeNextApprovedIntent } from '../../src/lib/intake.js';

const tempDirs = [];

function makeRawConfig() {
  return {
    schema_version: '1.0',
    protocol_mode: 'governed',
    template: 'generic',
    project: { id: 'bug12-test', name: 'BUG-12 Test', default_branch: 'main' },
    roles: {
      pm: { title: 'PM', mandate: 'Plan', write_authority: 'review_only', runtime: 'manual-pm' },
    },
    runtimes: { 'manual-pm': { type: 'manual' } },
    routing: { planning: { entry_role: 'pm', allowed_next_roles: ['pm'] } },
    gates: {},
  };
}

function makeConfig() {
  return {
    schema_version: 4,
    protocol_mode: 'governed',
    project: { id: 'bug12-test', name: 'BUG-12 Test', default_branch: 'main' },
    roles: {
      pm: { title: 'PM', mandate: 'Plan', write_authority: 'review_only', runtime_class: 'manual', runtime_id: 'manual-pm' },
    },
    runtimes: { 'manual-pm': { type: 'manual' } },
    phases: [{ id: 'planning', name: 'Planning' }],
    routing: { planning: { entry_role: 'pm', allowed_next_roles: ['pm'] } },
    gates: {},
  };
}

function createProject(config) {
  const root = mkdtempSync(join(tmpdir(), 'axc-bug12-'));
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

function readEvents(root) {
  try {
    return readFileSync(join(root, '.agentxchain', 'events.jsonl'), 'utf8')
      .trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
  } catch { return []; }
}

afterEach(() => {
  while (tempDirs.length > 0) { try { rmSync(tempDirs.pop(), { recursive: true, force: true }); } catch {} }
});

describe('BUG-12 beta-tester scenario: intent_id propagation in lifecycle events', () => {
  it('turn_dispatched event includes intent_id when turn is bound to an intent', () => {
    const config = makeConfig();
    const root = createProject(config);

    initializeGovernedRun(root, config);

    // Inject + approve intent
    const inject = injectIntent(root, 'Review architecture', {
      priority: 'p0',
      charter: 'Review architecture',
      acceptance: 'Check API design',
    });
    assert.ok(inject.ok);
    const intentId = inject.intent.intent_id;
    if (inject.intent.status !== 'approved') approveIntent(root, intentId);

    // Consume intent — this internally assigns the turn via startIntent
    const consumed = consumeNextApprovedIntent(root, { role: 'pm' });
    assert.ok(consumed && consumed.ok, `consumeNextApprovedIntent must succeed: ${JSON.stringify(consumed)}`);

    // Check events for turn_dispatched with intent_id
    const events = readEvents(root);
    const dispatched = events.find(e => e.event_type === 'turn_dispatched');
    assert.ok(dispatched, 'turn_dispatched event must exist');

    const eventIntentId = dispatched.intent_id || dispatched.payload?.intent_id;
    assert.ok(eventIntentId, `turn_dispatched must have intent_id. Event: ${JSON.stringify(dispatched)}`);
    assert.equal(eventIntentId, intentId, 'intent_id must match the injected intent');
  });
});
