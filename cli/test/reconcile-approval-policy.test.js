/**
 * BUG-59 slice 3: reconcilePhaseAdvanceBeforeDispatch() consults
 * approval_policy when evaluatePhaseExit() returns 'awaiting_human_approval'.
 *
 * Coverage:
 *   AT-REC-POL-001 — matching policy rule auto-approves the transition,
 *                    writes an `approval_policy` ledger entry, and emits
 *                    `phase_entered` with `trigger: 'auto_approved'`.
 *   AT-REC-POL-002 — credentialed gate tagged `credentialed: true` is NOT
 *                    auto-approved even when a catch-all rule would match.
 *                    The reconcile path must not emit an `approval_policy`
 *                    auto_approve ledger entry.
 *   AT-REC-POL-003 — project without `approval_policy` configured preserves
 *                    legacy BUG-52 behavior (falls through to
 *                    approvePhaseTransition with `trigger: 'human_approved'`).
 */

import { afterEach, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  initializeGovernedRun,
  reconcilePhaseAdvanceBeforeDispatch,
} from '../src/lib/governed-state.js';

const tempDirs = [];

function baseConfig(overrides = {}) {
  return {
    schema_version: '1.0',
    protocol_mode: 'governed',
    template: 'generic',
    project: { id: 'bug59-recon', name: 'BUG-59 reconcile', default_branch: 'main' },
    roles: {
      pm: { title: 'PM', mandate: 'plan', write_authority: 'authoritative', runtime: 'manual-pm' },
      dev: { title: 'Dev', mandate: 'build', write_authority: 'authoritative', runtime: 'manual-dev' },
    },
    runtimes: {
      'manual-pm': { type: 'manual' },
      'manual-dev': { type: 'manual' },
    },
    routing: {
      planning: { entry_role: 'pm', allowed_next_roles: ['pm', 'dev'], exit_gate: 'planning_signoff' },
      implementation: { entry_role: 'dev', allowed_next_roles: ['dev'], exit_gate: 'implementation_complete' },
    },
    gates: {
      planning_signoff: {
        requires_files: ['.planning/PM_SIGNOFF.md'],
        requires_human_approval: true,
        ...(overrides.credentialed ? { credentialed: true } : {}),
      },
      implementation_complete: {},
    },
    ...(overrides.approval_policy ? { approval_policy: overrides.approval_policy } : {}),
    gate_semantic_coverage_mode: 'lenient',
  };
}

function createProject(config) {
  const root = mkdtempSync(join(tmpdir(), 'axc-bug59-recon-'));
  tempDirs.push(root);
  mkdirSync(join(root, '.agentxchain', 'staging'), { recursive: true });
  mkdirSync(join(root, '.planning'), { recursive: true });
  writeFileSync(join(root, 'README.md'), '# BUG-59\n');
  writeFileSync(join(root, '.planning', 'PM_SIGNOFF.md'), 'Approved: YES\n');
  writeFileSync(join(root, 'agentxchain.json'), JSON.stringify(config, null, 2));
  execSync('git init -b main', { cwd: root, stdio: 'ignore' });
  execSync('git config user.email "test@test.com"', { cwd: root, stdio: 'ignore' });
  execSync('git config user.name "Test"', { cwd: root, stdio: 'ignore' });
  execSync('git add -A && git commit -m "init"', { cwd: root, stdio: 'ignore' });
  const init = initializeGovernedRun(root, config);
  assert.ok(init.ok, init.error);
  return { root };
}

function seedAwaitingHumanApprovalState(root, config, runId) {
  // Simulate an accepted PM turn that requested planning→implementation but
  // whose gate evaluation returned awaiting_human_approval. The reconcile
  // function looks up the turn from history when last_gate_failure is null
  // (DEC-BUG52-NEEDS-HUMAN-PHASE-ADVANCE-001 null-failure path).
  const turnId = 'turn_bug59_recon_pm_0001';
  const now = new Date().toISOString();
  const historyEntry = {
    turn_id: turnId,
    run_id: runId,
    role: 'pm',
    assigned_role: 'pm',
    runtime_id: 'manual-pm',
    phase: 'planning',
    status: 'completed',
    accepted_at: now,
    phase_transition_request: 'implementation',
    summary: 'Plan complete',
    verification: { status: 'pass' },
    files_changed: ['.planning/PM_SIGNOFF.md'],
  };
  writeFileSync(
    join(root, '.agentxchain', 'history.jsonl'),
    `${JSON.stringify(historyEntry)}\n`,
  );
  const statePath = join(root, '.agentxchain', 'state.json');
  const state = JSON.parse(readFileSync(statePath, 'utf8'));
  state.status = 'active';
  state.active_turns = {};
  state.current_turn = null;
  state.last_completed_turn_id = turnId;
  state.last_gate_failure = null;
  state.queued_phase_transition = null;
  state.pending_phase_transition = null;
  writeFileSync(statePath, JSON.stringify(state, null, 2));
  return { turnId };
}

function readLedger(root) {
  const p = join(root, '.agentxchain', 'decision-ledger.jsonl');
  try {
    const raw = readFileSync(p, 'utf8').trim();
    if (!raw) return [];
    return raw.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

function readEvents(root) {
  const p = join(root, '.agentxchain', 'events.jsonl');
  try {
    const raw = readFileSync(p, 'utf8').trim();
    if (!raw) return [];
    return raw.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

describe('BUG-59 slice 3: reconcilePhaseAdvanceBeforeDispatch approval_policy coupling', () => {
  it('AT-REC-POL-001: matching policy rule auto-approves transition via reconcile', () => {
    const config = baseConfig({
      approval_policy: {
        phase_transitions: {
          default: 'require_human',
          rules: [
            {
              from_phase: 'planning',
              to_phase: 'implementation',
              action: 'auto_approve',
              when: { credentialed_gate: false },
            },
          ],
        },
      },
    });
    const { root } = createProject(config);
    const runId = JSON.parse(readFileSync(join(root, '.agentxchain', 'state.json'), 'utf8')).run_id;
    seedAwaitingHumanApprovalState(root, config, runId);

    const result = reconcilePhaseAdvanceBeforeDispatch(root, config);
    assert.equal(result.ok, true);
    assert.equal(result.advanced, true);
    assert.equal(result.from_phase, 'planning');
    assert.equal(result.to_phase, 'implementation');
    assert.equal(result.approval_policy?.action, 'auto_approve');
    assert.equal(result.approval_policy?.matched_rule?.from_phase, 'planning');

    const finalState = JSON.parse(readFileSync(join(root, '.agentxchain', 'state.json'), 'utf8'));
    assert.equal(finalState.phase, 'implementation');
    assert.equal(finalState.phase_gate_status?.planning_signoff, 'passed');
    assert.equal(finalState.pending_phase_transition, null);

    const ledger = readLedger(root);
    const policyEntry = ledger.find((e) => e.type === 'approval_policy' && e.action === 'auto_approve');
    assert.ok(policyEntry, 'ledger must contain approval_policy auto_approve entry');
    assert.equal(policyEntry.gate_type, 'phase_transition');
    assert.equal(policyEntry.from_phase, 'planning');
    assert.equal(policyEntry.to_phase, 'implementation');
    assert.equal(policyEntry.gate_id, 'planning_signoff');
    assert.ok(policyEntry.matched_rule, 'policy ledger entry must record matched_rule');

    const events = readEvents(root);
    const entered = events.find((e) => e.event_type === 'phase_entered');
    assert.ok(entered, 'phase_entered event must be emitted');
    assert.equal(entered.payload.trigger, 'auto_approved', 'trigger must be auto_approved for policy-driven advance');
    assert.equal(entered.payload.from, 'planning');
    assert.equal(entered.payload.to, 'implementation');
  });

  it('AT-REC-POL-002: credentialed gate is NOT auto-approved even with matching rule', () => {
    const config = baseConfig({
      credentialed: true,
      approval_policy: {
        phase_transitions: {
          default: 'auto_approve',
          rules: [
            { from_phase: 'planning', to_phase: 'implementation', action: 'auto_approve' },
          ],
        },
      },
    });
    const { root } = createProject(config);
    const runId = JSON.parse(readFileSync(join(root, '.agentxchain', 'state.json'), 'utf8')).run_id;
    seedAwaitingHumanApprovalState(root, config, runId);

    const result = reconcilePhaseAdvanceBeforeDispatch(root, config);
    assert.equal(result.approval_policy?.action, 'require_human', 'credentialed gate must hard-stop policy auto-approve');
    assert.match(result.approval_policy?.reason || '', /credentialed/i);

    const ledger = readLedger(root);
    const policyEntry = ledger.find((e) => e.type === 'approval_policy' && e.action === 'auto_approve');
    assert.equal(policyEntry, undefined, 'credentialed gate must NOT produce approval_policy auto_approve ledger entry');
  });

  it('AT-REC-POL-003: no approval_policy preserves legacy BUG-52 behavior (falls through to approvePhaseTransition)', () => {
    const config = baseConfig({});
    const { root } = createProject(config);
    const runId = JSON.parse(readFileSync(join(root, '.agentxchain', 'state.json'), 'utf8')).run_id;
    seedAwaitingHumanApprovalState(root, config, runId);

    const result = reconcilePhaseAdvanceBeforeDispatch(root, config);
    assert.equal(result.approval_policy?.action, 'require_human');
    assert.match(result.approval_policy?.reason || '', /no approval_policy/i);

    const ledger = readLedger(root);
    const policyEntry = ledger.find((e) => e.type === 'approval_policy' && e.action === 'auto_approve');
    assert.equal(policyEntry, undefined, 'no-policy project must not write approval_policy auto_approve entry');

    const events = readEvents(root);
    const entered = events.find((e) => e.event_type === 'phase_entered');
    // Legacy path goes through approvePhaseTransition which emits trigger: 'human_approved'.
    if (entered) {
      assert.notEqual(entered.payload.trigger, 'auto_approved', 'no-policy reconcile must not emit auto_approved trigger');
    }
  });
});
