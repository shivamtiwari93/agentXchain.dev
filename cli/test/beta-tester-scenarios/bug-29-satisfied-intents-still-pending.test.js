/**
 * BUG-29 beta-tester scenario: satisfied intents still showing as pending
 * after acceptance (REOPEN of BUG-20)
 *
 * Tester sequence:
 *   1. Inject intent → approve
 *   2. PM turn addresses intent
 *   3. Accept PM turn
 *   4. status still shows intent as "Pending injected intents"
 *
 * Root cause of false closure: BUG-20's test manually set intake_context
 * and manually set intent status to 'executing'. The real flow goes through
 * assignGovernedTurn which binds intakeContext to the turn. After acceptance,
 * the intent should auto-complete.
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';

import {
  initializeGovernedRun,
  assignGovernedTurn,
  acceptGovernedTurn,
  normalizeGovernedStateShape,
} from '../../src/lib/governed-state.js';
import { writeDispatchBundle } from '../../src/lib/dispatch-bundle.js';
import { findPendingApprovedIntents } from '../../src/lib/intake.js';

const tempDirs = [];

function createProject() {
  const root = mkdtempSync(join(tmpdir(), 'axc-bug29-'));
  tempDirs.push(root);

  mkdirSync(join(root, '.agentxchain', 'staging'), { recursive: true });
  mkdirSync(join(root, '.agentxchain', 'intake', 'intents'), { recursive: true });
  mkdirSync(join(root, '.planning'), { recursive: true });

  const config = {
    schema_version: '1.0',
    protocol_mode: 'governed',
    template: 'generic',
    project: { id: 'bug29-test', name: 'BUG-29 Test', default_branch: 'main' },
    roles: {
      pm: {
        title: 'PM',
        mandate: 'Plan the project.',
        write_authority: 'review_only',
        runtime: 'manual-pm',
      },
    },
    runtimes: {
      'manual-pm': { type: 'manual' },
    },
    routing: {
      planning: {
        entry_role: 'pm',
        allowed_next_roles: ['pm'],
      },
    },
    gates: {},
  };

  writeFileSync(join(root, 'agentxchain.json'), JSON.stringify(config, null, 2));

  execSync('git init && git config user.email "test@test.com" && git config user.name "Test"', {
    cwd: root, stdio: 'ignore',
  });
  execSync('git add -A && git commit -m "init"', { cwd: root, stdio: 'ignore' });

  return { root, config };
}

function readState(root) {
  const raw = JSON.parse(readFileSync(join(root, '.agentxchain/state.json'), 'utf8'));
  return normalizeGovernedStateShape(raw).state;
}

function createExecutingIntent(root, intentId, charter) {
  // Create intent directly in 'executing' state (simulating what startIntent does)
  const intentPath = join(root, '.agentxchain', 'intake', 'intents', `${intentId}.json`);
  writeFileSync(intentPath, JSON.stringify({
    intent_id: intentId,
    type: 'planning_revision',
    priority: 'p0',
    status: 'executing',
    charter,
    acceptance_contract: [
      `Address: ${charter}`,
    ],
    source: 'operator',
    created_at: new Date().toISOString(),
    approved_at: new Date().toISOString(),
    history: [
      { from: 'needs_triage', to: 'approved', at: new Date().toISOString(), by: 'operator' },
      { from: 'approved', to: 'executing', at: new Date().toISOString(), by: 'system' },
    ],
  }, null, 2));
}

afterEach(() => {
  while (tempDirs.length > 0) {
    try { rmSync(tempDirs.pop(), { recursive: true, force: true }); } catch {}
  }
});

describe('BUG-29 beta-tester scenario: intent lifecycle after acceptance', () => {
  it('intent transitions to completed after turn acceptance when intake_context is bound', () => {
    const { root, config } = createProject();

    // 1. Initialize run
    const initResult = initializeGovernedRun(root, config);
    assert.ok(initResult.ok, `Init failed: ${initResult.error}`);

    // 2. Create an intent in 'executing' state (simulates consumeNextApprovedIntent flow)
    const intentId = `intent_bug29_${Date.now()}`;
    createExecutingIntent(root, intentId, 'Add error handling to the API layer');

    // 3. Assign a PM turn WITH intakeContext (this is what consumeNextApprovedIntent does internally)
    const assignResult = assignGovernedTurn(root, config, 'pm', {
      intakeContext: {
        intent_id: intentId,
        charter: 'Add error handling to the API layer',
        acceptance_contract: [
          'Add error handling to the API layer',
        ],
      },
    });
    assert.ok(assignResult.ok, `Assign failed: ${assignResult.error}`);

    const turnId = assignResult.turn.turn_id;

    // Verify the turn has intake_context
    const state = readState(root);
    const turn = state.active_turns?.[turnId];
    assert.ok(turn?.intake_context?.intent_id === intentId,
      `Turn should have intake_context.intent_id=${intentId}`);

    // 4. Write dispatch bundle
    writeDispatchBundle(root, state, config, { turnId });

    // 5. Stage a turn result at the canonical staging path
    const turnResultPath = join(root, '.agentxchain', 'staging', 'turn-result.json');
    writeFileSync(turnResultPath, JSON.stringify({
      schema_version: '1.0',
      run_id: state.run_id,
      turn_id: turnId,
      role: 'pm',
      runtime_id: 'manual-pm',
      status: 'completed',
      summary: 'Added error handling to the API layer as requested.',
      decisions: [],
      objections: [{ id: 'OBJ-1', target: 'process', statement: 'Intent coverage review', severity: 'low' }],
      files_changed: [],
      verification: { status: 'skipped' },
      artifact: { type: 'review', ref: null },
      proposed_next_role: 'pm',
      intent_response: [
        { item: 'Add error handling to the API layer', status: 'addressed' },
      ],
    }, null, 2));

    // 6. Accept the turn
    const acceptResult = acceptGovernedTurn(root, config, {
      turnId,
      resultPath: turnResultPath,
    });
    assert.ok(acceptResult.ok, `Accept failed: ${acceptResult.error}`);

    // 7. KEY ASSERTION: intent file on disk should show 'completed'
    const intentPath = join(root, '.agentxchain', 'intake', 'intents', `${intentId}.json`);
    const intentData = JSON.parse(readFileSync(intentPath, 'utf8'));
    assert.equal(
      intentData.status,
      'completed',
      `Intent status should be 'completed' after accepted turn. Got '${intentData.status}'`,
    );

    // 8. KEY ASSERTION: intent should NOT appear in pending approved intents
    // (findPendingApprovedIntents only returns 'approved' intents, but let's verify
    //  the intent is not somehow stuck in an intermediate state)
    const pendingAfter = findPendingApprovedIntents(root);
    const stillPending = pendingAfter.find(i => i.intent_id === intentId);
    assert.equal(
      stillPending,
      undefined,
      `Intent should not appear as pending after acceptance. Still showing: ${JSON.stringify(stillPending)}`,
    );
  });
});
