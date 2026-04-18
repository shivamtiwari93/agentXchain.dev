/**
 * BUG-11 beta-tester scenario: resume/step must consume approved intake intents
 *
 * When approved intents exist in the intake queue, `resume` must bind the
 * highest-priority one as the turn's primary charter.
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';

import {
  initializeGovernedRun,
  assignGovernedTurn,
  getActiveTurn,
  normalizeGovernedStateShape,
} from '../../src/lib/governed-state.js';
import { writeDispatchBundle } from '../../src/lib/dispatch-bundle.js';
import { injectIntent, approveIntent, consumeNextApprovedIntent } from '../../src/lib/intake.js';

const tempDirs = [];

// Raw config for disk (uses `runtime`), will be normalized by loadProjectContext
function makeRawConfig() {
  return {
    schema_version: '1.0',
    protocol_mode: 'governed',
    template: 'generic',
    project: { id: 'bug11-test', name: 'BUG-11 Test', default_branch: 'main' },
    roles: {
      pm: { title: 'PM', mandate: 'Plan', write_authority: 'review_only', runtime: 'manual-pm' },
    },
    runtimes: { 'manual-pm': { type: 'manual' } },
    routing: { planning: { entry_role: 'pm', allowed_next_roles: ['pm'] } },
    gates: {},
  };
}

// Normalized config for direct API calls (uses `runtime_id`)
function makeConfig() {
  return {
    schema_version: 4,
    protocol_mode: 'governed',
    project: { id: 'bug11-test', name: 'BUG-11 Test', default_branch: 'main' },
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
  const root = mkdtempSync(join(tmpdir(), 'axc-bug11-'));
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

afterEach(() => {
  while (tempDirs.length > 0) { try { rmSync(tempDirs.pop(), { recursive: true, force: true }); } catch {} }
});

describe('BUG-11 beta-tester scenario: resume consumes approved intake intents', () => {
  it('consumeNextApprovedIntent binds the highest-priority approved intent', () => {
    const config = makeConfig();
    const root = createProject();

    // 1. Initialize run
    initializeGovernedRun(root, config);

    // 2. Inject and approve an intent
    const injectResult = injectIntent(root, 'Planning revision for API endpoints', {
      priority: 'p0',
      charter: 'Planning revision for API endpoints',
      acceptance: 'Revise API plan,Update documentation',
    });
    assert.ok(injectResult.ok, `Inject failed: ${injectResult.error}`);
    const intentId = injectResult.intent.intent_id;

    // Auto-inject auto-approves for p0. Approve manually if needed.
    if (injectResult.intent.status !== 'approved') {
      const approveResult = approveIntent(root, intentId);
      assert.ok(approveResult.ok, `Approve failed: ${approveResult.error}`);
    }

    // 3. Consume the approved intent (this is what resume/step call internally)
    // consumeNextApprovedIntent internally calls startIntent which assigns the turn
    const consumed = consumeNextApprovedIntent(root, { role: 'pm' });
    assert.ok(consumed && consumed.ok, `consumeNextApprovedIntent must succeed. Got: ${JSON.stringify(consumed)}`);
    assert.equal(consumed.intentId, intentId, `Consumed intentId must match. Got ${consumed.intentId}, expected ${intentId}`);

    // 4. Verify the active turn has intake_context (startIntent did the assignment)
    const state = readState(root);
    const turn = getActiveTurn(state);
    assert.ok(turn, 'Must have an active turn');
    assert.ok(turn.intake_context, 'Turn must have intake_context when consuming an intent');
    assert.equal(turn.intake_context.intent_id, intentId, 'intake_context.intent_id must match');
  });
});
