/**
 * BUG-50 beta-tester scenario: run-history.jsonl contamination.
 *
 * A fresh run's history record must track ONLY that run's own phase/turn
 * progression, not inherit phases_completed and total_turns from the parent.
 *
 * Tester sequence:
 *   1. Initialize parent run, accept several turns across phases, complete it
 *   2. Chain a fresh run from the parent
 *   3. Accept one PM turn in the fresh run, then complete/block it
 *   4. Assert the fresh run's run-history.jsonl entry has phases_completed
 *      and total_turns reflecting only the fresh run's own work
 */

import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { recordRunHistory, queryRunHistory } from '../../src/lib/run-history.js';

const tempDirs = [];

function createProject() {
  const root = mkdtempSync(join(tmpdir(), 'axc-bug50-'));
  tempDirs.push(root);

  mkdirSync(join(root, '.agentxchain'), { recursive: true });
  writeFileSync(join(root, 'README.md'), '# BUG-50\n');

  execSync('git init -b main', { cwd: root, stdio: 'ignore' });
  execSync('git config user.email "test@test.com"', { cwd: root, stdio: 'ignore' });
  execSync('git config user.name "Test"', { cwd: root, stdio: 'ignore' });
  execSync('git add -A && git commit -m "init"', { cwd: root, stdio: 'ignore' });

  return root;
}

function seedHistoryEntries(root, entries) {
  const filePath = join(root, '.agentxchain', 'history.jsonl');
  const content = entries.map(e => JSON.stringify(e)).join('\n') + '\n';
  writeFileSync(filePath, content);
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

describe('BUG-50: run-history.jsonl contamination — fresh run isolation', () => {
  it('fresh run record reflects only its own turns, not parent turns', () => {
    const root = createProject();

    const parentRunId = 'run_parent_abcdef12';
    const childRunId = 'run_child_98765432';

    // Simulate parent run's history.jsonl: 70 turns across all phases
    const parentTurns = [];
    const phases = ['planning', 'implementation', 'qa', 'launch'];
    for (let i = 0; i < 70; i++) {
      parentTurns.push({
        turn_id: `turn_parent_${String(i).padStart(3, '0')}`,
        run_id: parentRunId,
        role: i < 10 ? 'pm' : i < 40 ? 'dev' : i < 60 ? 'qa' : 'pm',
        phase: phases[Math.min(Math.floor(i / 20), 3)],
        status: 'completed',
        summary: `Parent turn ${i}`,
        decisions: [],
      });
    }

    // Add one turn for the child run
    const childTurns = [
      {
        turn_id: 'turn_child_001',
        run_id: childRunId,
        role: 'pm',
        phase: 'planning',
        status: 'completed',
        summary: 'Child run PM turn',
        decisions: [],
      },
    ];

    // Write ALL turns to history.jsonl (simulating accumulation across runs)
    seedHistoryEntries(root, [...parentTurns, ...childTurns]);

    // Record the child run's history
    const childState = {
      run_id: childRunId,
      phase: 'planning',
      status: 'active',
      phase_gate_status: {
        planning_signoff: 'pending',
        implementation_complete: 'pending',
        qa_ship_verdict: 'pending',
        launch_approval: 'pending',
      },
      provenance: {
        trigger: 'manual',
        parent_run_id: parentRunId,
      },
      inherited_context: {
        parent_run_id: parentRunId,
        parent_status: 'completed',
        inherited_at: '2026-04-19T00:00:00.000Z',
      },
    };

    const childConfig = {
      project: { id: 'bug50-test', name: 'BUG-50 Test' },
      roles: { pm: { runtime_id: 'manual', model: 'test' } },
    };

    const result = recordRunHistory(root, childState, childConfig, 'completed');
    assert.ok(result.ok, result.error);

    // Read the recorded entry
    const entries = queryRunHistory(root);
    assert.equal(entries.length, 1, 'Expected exactly one run-history entry');

    const entry = entries[0];
    assert.equal(entry.run_id, childRunId, 'Entry should be for the child run');

    // BUG-50: these MUST reflect the child run only
    assert.equal(entry.total_turns, 1, 'total_turns should be 1 (child run only)');
    assert.deepEqual(entry.phases_completed, ['planning'],
      'phases_completed should be ["planning"] (child run only)');

    // Should NOT have inherited parent phases
    assert.ok(!entry.phases_completed.includes('implementation'),
      'Should NOT include parent implementation phase');
    assert.ok(!entry.phases_completed.includes('qa'),
      'Should NOT include parent qa phase');
    assert.ok(!entry.phases_completed.includes('launch'),
      'Should NOT include parent launch phase');
    assert.equal(entry.parent_context.parent_run_id, parentRunId);
    assert.equal(entry.parent_context.parent_status, 'completed');
  });

  it('parent run record still includes all its own turns', () => {
    const root = createProject();

    const parentRunId = 'run_parent_abcdef12';

    // Seed 5 turns for the parent run
    const parentTurns = [
      { turn_id: 'turn_p1', run_id: parentRunId, role: 'pm', phase: 'planning', status: 'completed', summary: 'p1', decisions: [] },
      { turn_id: 'turn_p2', run_id: parentRunId, role: 'dev', phase: 'implementation', status: 'completed', summary: 'p2', decisions: [] },
      { turn_id: 'turn_p3', run_id: parentRunId, role: 'dev', phase: 'implementation', status: 'completed', summary: 'p3', decisions: [] },
      { turn_id: 'turn_p4', run_id: parentRunId, role: 'qa', phase: 'qa', status: 'completed', summary: 'p4', decisions: [] },
      { turn_id: 'turn_p5', run_id: parentRunId, role: 'pm', phase: 'launch', status: 'completed', summary: 'p5', decisions: [] },
    ];

    seedHistoryEntries(root, parentTurns);

    const parentState = {
      run_id: parentRunId,
      phase: 'launch',
      status: 'active',
      phase_gate_status: {},
      provenance: { trigger: 'manual' },
    };

    const config = {
      project: { id: 'bug50-test', name: 'BUG-50 Test' },
      roles: { pm: { runtime_id: 'manual' } },
    };

    const result = recordRunHistory(root, parentState, config, 'completed');
    assert.ok(result.ok, result.error);

    const entries = queryRunHistory(root);
    const entry = entries[0];
    assert.equal(entry.total_turns, 5, 'Parent run total_turns should be 5');
    assert.deepEqual(
      entry.phases_completed.sort(),
      ['implementation', 'launch', 'planning', 'qa'],
      'Parent run should include all phases',
    );
  });
});
