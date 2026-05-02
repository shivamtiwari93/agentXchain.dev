/**
 * BUG-16 beta-tester scenario: all dispatch paths use the same
 * consumeNextApprovedIntent() function, and it respects priority ordering.
 *
 * When multiple approved intents exist, the highest priority (p0 > p1) is consumed first.
 */

import { describe, it, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';

import {
  initializeGovernedRun,
  normalizeGovernedStateShape,
} from '../../src/lib/governed-state.js';
import { injectIntent, approveIntent, consumeNextApprovedIntent } from '../../src/lib/intake.js';

const tempDirs = [];

function makeRawConfig() {
  return {
    schema_version: '1.0',
    protocol_mode: 'governed',
    template: 'generic',
    project: { id: 'bug16-test', name: 'BUG-16 Test', default_branch: 'main' },
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
    project: { id: 'bug16-test', name: 'BUG-16 Test', default_branch: 'main' },
    roles: {
      pm: { title: 'PM', mandate: 'Plan', write_authority: 'review_only', runtime_class: 'manual', runtime_id: 'manual-pm' },
    },
    runtimes: { 'manual-pm': { type: 'manual' } },
    phases: [{ id: 'planning', name: 'Planning' }],
    routing: { planning: { entry_role: 'pm', allowed_next_roles: ['pm'] } },
    gates: {},
  };
}

function createProject() {
  const root = mkdtempSync(join(tmpdir(), 'axc-bug16-'));
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

afterEach(() => {
  while (tempDirs.length > 0) { try { rmSync(tempDirs.pop(), { recursive: true, force: true }); } catch {} }
});

describe('BUG-16 beta-tester scenario: unified intake consumption with priority ordering', () => {
  it('consumeNextApprovedIntent picks the p0 intent before the p1 intent', () => {
    const config = makeConfig();
    const root = createProject();

    initializeGovernedRun(root, config);

    // Inject p1 first, then p0
    const injectP1 = injectIntent(root, 'Low priority work', {
      priority: 'p1',
      charter: 'Low priority work',
      acceptance: 'Task A',
    });
    assert.ok(injectP1.ok);
    if (injectP1.intent.status !== 'approved') approveIntent(root, injectP1.intent.intent_id);

    const injectP0 = injectIntent(root, 'High priority work', {
      priority: 'p0',
      charter: 'High priority work',
      acceptance: 'Task B',
    });
    assert.ok(injectP0.ok);
    if (injectP0.intent.status !== 'approved') approveIntent(root, injectP0.intent.intent_id);

    // Consume — must pick p0 first despite p1 being injected earlier
    const consumed = consumeNextApprovedIntent(root, { role: 'pm' });
    assert.ok(consumed && consumed.ok, `Must consume an approved intent: ${JSON.stringify(consumed)}`);
    assert.equal(consumed.intentId, injectP0.intent.intent_id,
      `Must consume p0 intent first. Got: ${consumed.intentId}, expected: ${injectP0.intent.intent_id}`);
  });
});
