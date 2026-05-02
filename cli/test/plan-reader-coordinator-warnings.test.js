import { strict as assert } from 'node:assert';
import { describe, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readPlanSnapshot } from '../src/lib/dashboard/plan-reader.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

function writeJson(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
}

function makeWorkspaceWithMission() {
  const root = mkdtempSync(join(tmpdir(), 'axc-plan-reader-warn-'));
  mkdirSync(join(root, '.agentxchain/missions/m1/plans'), { recursive: true });
  mkdirSync(join(root, '.agentxchain/multirepo'), { recursive: true });
  mkdirSync(join(root, '.agentxchain'), { recursive: true });

  writeJson(join(root, '.agentxchain/missions/m1/mission.json'), {
    mission_id: 'm1',
    title: 'Test Mission',
    status: 'active',
    created_at: new Date().toISOString(),
  });

  writeJson(join(root, '.agentxchain/missions/m1/plans/p1.json'), {
    plan_id: 'p1',
    mission_id: 'm1',
    status: 'active',
    created_at: new Date().toISOString(),
    workstreams: [
      { workstream_id: 'ws-1', title: 'WS 1', goal: 'Test', roles: ['dev'], phases: ['implementation'], depends_on: [] },
    ],
    launch_records: [],
  });

  writeJson(join(root, '.agentxchain/multirepo/state.json'), {
    schema_version: '0.1',
    super_run_id: 'srun-current',
    status: 'active',
    phase: 'implementation',
    repo_runs: {},
  });

  return root;
}

function appendEvent(root, event) {
  appendFileSync(
    join(root, '.agentxchain/events.jsonl'),
    JSON.stringify(event) + '\n',
  );
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('plan-reader — coordinator warning visibility', () => {
  it('AT-PLAN-WARN-001: plan snapshot includes coordinator_warnings with count 0 when no warnings exist', () => {
    const root = makeWorkspaceWithMission();
    const result = readPlanSnapshot(root);
    assert.ok(result.ok);
    assert.ok(result.body.coordinator_warnings, 'coordinator_warnings must be present in plan snapshot');
    assert.equal(result.body.coordinator_warnings.count, 0);
    assert.equal(result.body.coordinator_warnings.reconciliation_required, false);
  });

  it('AT-PLAN-WARN-002: plan snapshot surfaces projection warnings from events.jsonl', () => {
    const root = makeWorkspaceWithMission();
    appendEvent(root, {
      event_id: 'evt_pr001',
      event_type: 'coordinator_retry_projection_warning',
      timestamp: new Date().toISOString(),
      run_id: 'srun-current',
      payload: {
        workstream_id: 'ws-1',
        repo_id: 'repo-a',
        warning_code: 'coordinator_acceptance_projection_incomplete',
      },
    });
    const result = readPlanSnapshot(root);
    assert.ok(result.ok);
    assert.equal(result.body.coordinator_warnings.count, 1);
    assert.equal(result.body.coordinator_warnings.reconciliation_required, true);
    assert.equal(result.body.coordinator_warnings.warnings[0].workstream_id, 'ws-1');
    assert.equal(result.body.coordinator_warnings.warnings[0].repo_id, 'repo-a');
  });

  it('AT-PLAN-WARN-003: plan snapshot filters only projection warning events, not other event types', () => {
    const root = makeWorkspaceWithMission();
    appendEvent(root, {
      event_id: 'evt_pr002',
      event_type: 'turn_dispatched',
      timestamp: new Date().toISOString(),
      payload: {},
    });
    appendEvent(root, {
      event_id: 'evt_pr003',
      event_type: 'coordinator_retry',
      timestamp: new Date().toISOString(),
      payload: { workstream_id: 'ws-1' },
    });
    const result = readPlanSnapshot(root);
    assert.ok(result.ok);
    assert.equal(result.body.coordinator_warnings.count, 0);
    assert.equal(result.body.coordinator_warnings.reconciliation_required, false);
  });

  it('AT-PLAN-WARN-004: plan snapshot ignores projection warnings from prior coordinator runs', () => {
    const root = makeWorkspaceWithMission();
    appendEvent(root, {
      event_id: 'evt_old_srun',
      event_type: 'coordinator_retry_projection_warning',
      timestamp: new Date().toISOString(),
      run_id: 'srun-old',
      payload: {
        workstream_id: 'ws-old',
        repo_id: 'repo-old',
        warning_code: 'coordinator_acceptance_projection_incomplete',
      },
    });
    appendEvent(root, {
      event_id: 'evt_current_srun',
      event_type: 'coordinator_retry_projection_warning',
      timestamp: new Date().toISOString(),
      run_id: 'srun-current',
      payload: {
        workstream_id: 'ws-1',
        repo_id: 'repo-a',
        reissued_turn_id: 'turn-retry-001',
        warning_code: 'coordinator_acceptance_projection_incomplete',
        warning_message: 'Projection incomplete for current super-run',
      },
    });

    const result = readPlanSnapshot(root);
    assert.ok(result.ok);
    assert.equal(result.body.coordinator_warnings.count, 1);
    assert.equal(result.body.coordinator_warnings.warnings[0].workstream_id, 'ws-1');
    assert.equal(result.body.coordinator_warnings.warnings[0].repo_id, 'repo-a');
    assert.equal(result.body.coordinator_warnings.warnings[0].reissued_turn_id, 'turn-retry-001');
    assert.equal(result.body.coordinator_warnings.warnings[0].warning_message, 'Projection incomplete for current super-run');
  });
});
