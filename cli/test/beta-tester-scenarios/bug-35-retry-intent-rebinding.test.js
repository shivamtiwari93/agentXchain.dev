/**
 * BUG-35 beta-tester scenario: retry dispatch bundle must re-embed the injected
 * intent charter AND surface the rejection reason, with gate failure BEFORE
 * the intent in the prompt.
 *
 * Tester sequence:
 *   1. Create governed project with a gate on IMPLEMENTATION_NOTES.md
 *   2. Inject narrow repair intent
 *   3. Dispatch dev turn bound to the intent
 *   4. Simulate dev ignoring the narrow path — submit result without editing
 *      the gated file → rejection
 *   5. Verify: retry PROMPT.md contains both the rejection reason AND the
 *      intent charter verbatim
 *   6. Verify: rejection reason appears BEFORE the intent section in the prompt
 *
 * This test must FAIL on pre-fix HEAD and PASS after the fix.
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
  rejectGovernedTurn,
  normalizeGovernedStateShape,
} from '../../src/lib/governed-state.js';
import { writeDispatchBundle } from '../../src/lib/dispatch-bundle.js';
import { injectIntent } from '../../src/lib/intake.js';

const tempDirs = [];

function makeRawConfig() {
  return {
    schema_version: '1.0',
    protocol_mode: 'governed',
    template: 'generic',
    project: { id: 'bug35-test', name: 'BUG-35 Test', default_branch: 'main' },
    roles: {
      dev: {
        title: 'Developer',
        mandate: 'Implement features',
        write_authority: 'authoritative',
        runtime: 'local-dev',
      },
    },
    runtimes: { 'local-dev': { type: 'local_cli', command: 'echo done' } },
    routing: {
      implementation: {
        entry_role: 'dev',
        allowed_next_roles: ['dev'],
      },
    },
    gates: {},
    rules: { max_turn_retries: 3 },
  };
}

function makeConfig() {
  return {
    schema_version: 4,
    protocol_mode: 'governed',
    project: { id: 'bug35-test', name: 'BUG-35 Test', default_branch: 'main' },
    roles: {
      dev: {
        title: 'Developer',
        mandate: 'Implement features',
        write_authority: 'authoritative',
        runtime_class: 'local_cli',
        runtime_id: 'local-dev',
      },
    },
    runtimes: { 'local-dev': { type: 'local_cli', command: 'echo done' } },
    phases: [{ id: 'implementation', name: 'Implementation' }],
    routing: {
      implementation: {
        entry_role: 'dev',
        allowed_next_roles: ['dev'],
      },
    },
    gates: {},
    rules: { max_turn_retries: 3 },
  };
}

function createProject() {
  const root = mkdtempSync(join(tmpdir(), 'axc-bug35-'));
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

describe('BUG-35: retry prompt must re-bind injected intent with gate failure first', () => {
  it('retry PROMPT.md contains rejection reason BEFORE injected intent charter', () => {
    const config = makeConfig();
    const root = createProject();

    // 1. Initialize run
    initializeGovernedRun(root, config);
    const state = readState(root);

    // 2. Inject narrow repair intent
    const inject = injectIntent(root, 'Edit IMPLEMENTATION_NOTES.md to add ## Changes section', {
      priority: 'p0',
      charter: 'Edit .planning/IMPLEMENTATION_NOTES.md to add a ## Changes section that satisfies the implementation_complete gate',
      acceptance: 'IMPLEMENTATION_NOTES.md has ## Changes section,Gate implementation_complete passes',
    });
    assert.ok(inject.ok, `inject failed: ${inject.error}`);
    const intentId = inject.intent.intent_id;

    // 3. Dispatch dev turn bound to the intent
    const assign = assignGovernedTurn(root, config, 'dev', {
      runtime_id: 'local-dev',
      intakeContext: {
        intent_id: intentId,
        charter: inject.intent.charter,
        acceptance_contract: inject.intent.acceptance_contract,
      },
    });
    assert.ok(assign.ok, `assign failed: ${assign.error}`);
    const turnId = assign.turn.turn_id;

    writeDispatchBundle(root, readState(root), config, { turnId });

    // Verify initial prompt has the intent section
    const dispatchDir = join(root, '.agentxchain', 'dispatch', 'turns', turnId);
    const initialPrompt = readFileSync(join(dispatchDir, 'PROMPT.md'), 'utf8');
    assert.match(initialPrompt, /Active Injected Intent/, 'initial prompt must have intent section');

    // 4. Simulate rejection — dev didn't fix the gate issue
    execSync('git add -A && git commit -m "turn1" --allow-empty', { cwd: root, stdio: 'ignore' });

    const reject = rejectGovernedTurn(root, config, turnId, {
      reason: 'Did not address implementation_complete gate semantic or pending narrow intent',
      failed_stage: 'gate_semantic',
      validation_errors: [
        '.planning/IMPLEMENTATION_NOTES.md must define ## Changes to satisfy implementation_complete gate',
      ],
    });
    assert.ok(reject.ok, `reject failed: ${reject.error}`);

    // 5. Write the retry dispatch bundle
    const stateAfterReject = readState(root);
    const retryTurn = Object.values(stateAfterReject.active_turns || {})[0];
    assert.ok(retryTurn, 'retry turn should exist');
    assert.equal(retryTurn.attempt, 2, 'should be attempt 2');
    assert.ok(retryTurn.intake_context, 'retry turn must preserve intake_context');
    assert.equal(retryTurn.intake_context.intent_id, intentId, 'retry must preserve intent_id');

    writeDispatchBundle(root, stateAfterReject, config, { turnId: retryTurn.turn_id });

    // 6. Read the retry PROMPT.md
    const retryDispatchDir = join(root, '.agentxchain', 'dispatch', 'turns', retryTurn.turn_id);
    const retryPrompt = readFileSync(join(retryDispatchDir, 'PROMPT.md'), 'utf8');

    // Verify: retry prompt contains the rejection reason
    assert.match(retryPrompt, /Previous Attempt Failed/, 'retry prompt must contain rejection context');
    assert.match(
      retryPrompt,
      /implementation_complete/,
      'retry prompt must name the failing gate'
    );
    assert.match(
      retryPrompt,
      /IMPLEMENTATION_NOTES\.md/,
      'retry prompt must name the gated file'
    );

    // Verify: retry prompt contains the injected intent
    assert.match(retryPrompt, /Active Injected Intent/, 'retry prompt must re-embed the intent section');
    assert.match(
      retryPrompt,
      /IMPLEMENTATION_NOTES\.md.*## Changes/,
      'retry prompt must contain the intent charter'
    );

    // Verify: gate failure appears BEFORE injected intent in the prompt
    const failureIndex = retryPrompt.indexOf('Previous Attempt Failed');
    const intentIndex = retryPrompt.indexOf('Active Injected Intent');
    assert.ok(failureIndex >= 0, 'failure section must exist');
    assert.ok(intentIndex >= 0, 'intent section must exist');
    assert.ok(
      failureIndex < intentIndex,
      `BUG-35: gate failure (at ${failureIndex}) must appear BEFORE injected intent (at ${intentIndex}) in the retry prompt`
    );
  });
});
