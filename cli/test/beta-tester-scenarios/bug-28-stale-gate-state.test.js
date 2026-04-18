/**
 * BUG-28 beta-tester scenario: stale gate state after accepted turn (REOPEN of BUG-19)
 *
 * Tester sequence:
 *   1. PM turn writes .planning/PM_SIGNOFF.md with "Approved: YES"
 *   2. Turn is accepted
 *   3. status still shows "PM signoff is not approved. Found 'Approved: NO'"
 *
 * Root cause of false closure: BUG-19 reconciliation only checks file EXISTENCE
 * (existsSync), not file CONTENT. When the gate failure is content-based
 * (Approved: NO → YES), the missing_files array is empty, so reconciliation
 * never fires — hadResolvableConditions is false.
 *
 * The test must fail on current HEAD before the fix.
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
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  initializeGovernedRun,
  assignGovernedTurn,
  acceptGovernedTurn,
  normalizeGovernedStateShape,
} from '../../src/lib/governed-state.js';
import { writeDispatchBundle } from '../../src/lib/dispatch-bundle.js';

const tempDirs = [];

function createProjectWithGate() {
  const root = mkdtempSync(join(tmpdir(), 'axc-bug28-'));
  tempDirs.push(root);

  mkdirSync(join(root, '.agentxchain', 'staging'), { recursive: true });
  mkdirSync(join(root, '.planning'), { recursive: true });

  const config = {
    schema_version: '1.0',
    protocol_mode: 'governed',
    template: 'generic',
    project: { id: 'bug28-test', name: 'BUG-28 Test', default_branch: 'main' },
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
        exit_gate: 'planning_signoff',
      },
      implementation: {
        entry_role: 'pm',
        allowed_next_roles: ['pm'],
      },
    },
    gates: {
      planning_signoff: {
        requires_files: ['.planning/PM_SIGNOFF.md'],
      },
    },
  };

  writeFileSync(join(root, 'agentxchain.json'), JSON.stringify(config, null, 2));

  // Create PM_SIGNOFF.md with Approved: NO (the WRONG value)
  writeFileSync(
    join(root, '.planning', 'PM_SIGNOFF.md'),
    '# PM Signoff\n\nApproved: NO\n',
  );

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

afterEach(() => {
  while (tempDirs.length > 0) {
    try { rmSync(tempDirs.pop(), { recursive: true, force: true }); } catch {}
  }
});

describe('BUG-28 beta-tester scenario: stale gate state after content-based gate change', () => {
  it('clears last_gate_failure when accepted turn changes file content to satisfy gate', () => {
    const { root, config } = createProjectWithGate();

    // 1. Initialize run
    const initResult = initializeGovernedRun(root, config);
    assert.ok(initResult.ok, `Init failed: ${initResult.error}`);

    // 2. Assign a PM turn
    const assignResult = assignGovernedTurn(root, config, 'pm');
    assert.ok(assignResult.ok, `Assign failed: ${assignResult.error}`);

    const turnId = assignResult.turn.turn_id;

    // Write dispatch bundle
    writeDispatchBundle(root, assignResult.state, config, { turnId });

    // 3. Seed a content-based gate failure (Approved: NO → gate fails)
    // This simulates what happens when approve-transition is attempted
    // and the gate fails because the content says NO
    let state = readState(root);
    state.last_gate_failure = {
      gate_id: 'planning_signoff',
      gate_type: 'phase_transition',
      missing_files: [],  // File EXISTS — this is a CONTENT failure, not existence
      missing_verification: false,
      reasons: ['PM signoff is not approved. Found "Approved: NO" in .planning/PM_SIGNOFF.md; set it to "Approved: YES".'],
      failed_at: new Date().toISOString(),
    };
    writeFileSync(
      join(root, '.agentxchain', 'state.json'),
      JSON.stringify(state, null, 2),
    );

    // 4. Now the PM turn "fixes" the signoff — write Approved: YES
    writeFileSync(
      join(root, '.planning', 'PM_SIGNOFF.md'),
      '# PM Signoff\n\nApproved: YES\n',
    );

    // 5. Stage a turn result for acceptance at the canonical staging path
    const turnResultPath = join(root, '.agentxchain', 'staging', 'turn-result.json');
    writeFileSync(turnResultPath, JSON.stringify({
      schema_version: '1.0',
      run_id: state.run_id,
      turn_id: turnId,
      role: 'pm',
      runtime_id: 'manual-pm',
      status: 'completed',
      summary: 'PM approved the signoff — set Approved: YES',
      decisions: [],
      objections: [{ id: 'OBJ-1', target: 'process', statement: 'Gate validation needed review', severity: 'low' }],
      files_changed: ['.planning/PM_SIGNOFF.md'],
      verification: { status: 'skipped' },
      artifact: { type: 'review', ref: null },
      proposed_next_role: 'pm',
    }, null, 2));

    // Commit the change so acceptance can diff
    execSync('git add -A && git commit -m "PM signoff approved"', {
      cwd: root, stdio: 'ignore',
    });

    // 6. Accept the turn
    const acceptResult = acceptGovernedTurn(root, config, {
      turnId,
      resultPath: turnResultPath,
    });
    assert.ok(acceptResult.ok, `Accept failed: ${acceptResult.error}`);

    // 7. KEY ASSERTION: last_gate_failure must be cleared
    const stateAfter = readState(root);
    assert.strictEqual(
      stateAfter.last_gate_failure,
      null,
      `last_gate_failure should be cleared after accepted turn fixed the content. ` +
      `Still shows: ${JSON.stringify(stateAfter.last_gate_failure)}`,
    );
  });
});
