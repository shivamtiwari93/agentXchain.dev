import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initializeCoordinatorRun, loadCoordinatorState, readCoordinatorHistory, readBarriers, saveCoordinatorState } from '../src/lib/coordinator-state.js';
import { loadCoordinatorConfig } from '../src/lib/coordinator-config.js';
import {
  detectDivergence,
  resyncFromRepoAuthority,
  resumeCoordinatorFromBlockedState,
} from '../src/lib/coordinator-recovery.js';
import { RECOVERY_REPORT_PATH } from '../src/lib/workflow-gate-semantics.js';

function writeJson(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
}

function makeWorkspace() {
  return mkdtempSync(join(tmpdir(), 'axc-multi-recovery-'));
}

function writeGovernedRepo(root, projectId) {
  mkdirSync(root, { recursive: true });
  mkdirSync(join(root, '.agentxchain'), { recursive: true });

  writeJson(join(root, 'agentxchain.json'), {
    schema_version: '1.0',
    template: 'generic',
    project: { id: projectId, name: projectId, default_branch: 'main' },
    roles: {
      dev: {
        title: 'Developer',
        mandate: 'Implement safely.',
        write_authority: 'authoritative',
        runtime: 'local-dev',
      },
      qa: {
        title: 'QA',
        mandate: 'Challenge.',
        write_authority: 'review_only',
        runtime: 'manual-qa',
      },
    },
    runtimes: {
      'local-dev': {
        type: 'local_cli',
        command: ['echo', '{prompt}'],
        prompt_transport: 'argv',
      },
      'manual-qa': { type: 'manual' },
    },
    routing: {
      implementation: {
        entry_role: 'dev',
        allowed_next_roles: ['dev', 'qa', 'human'],
      },
    },
    gates: {},
  });

  writeJson(join(root, '.agentxchain/state.json'), {
    schema_version: '1.1',
    project_id: projectId,
    run_id: null,
    status: 'idle',
    phase: 'implementation',
    active_turns: {},
    turn_sequence: 0,
    accepted_count: 0,
    rejected_count: 0,
    blocked_on: null,
    blocked_reason: null,
    next_recommended_role: null,
  });
}

function buildCoordinatorConfig(repoPaths, overrides = {}) {
  return {
    schema_version: '0.1',
    project: { id: 'test-project', name: 'Test Project' },
    repos: {
      web: { path: repoPaths.web, default_branch: 'main', required: true },
      api: { path: repoPaths.api, default_branch: 'main', required: true },
    },
    workstreams: overrides.workstreams || {
      delivery: {
        phase: 'implementation',
        repos: ['web', 'api'],
        entry_repo: 'api',
        depends_on: [],
        completion_barrier: 'all_repos_accepted',
      },
    },
    routing: overrides.routing || {
      implementation: { entry_workstream: 'delivery' },
    },
    gates: overrides.gates || {},
  };
}

function setupWorkspace(configOverrides = {}) {
  const workspace = makeWorkspace();
  const webRepo = join(workspace, 'repos', 'web');
  const apiRepo = join(workspace, 'repos', 'api');

  writeGovernedRepo(webRepo, 'web');
  writeGovernedRepo(apiRepo, 'api');
  writeJson(
    join(workspace, 'agentxchain-multi.json'),
    buildCoordinatorConfig({ web: './repos/web', api: './repos/api' }, configOverrides),
  );

  const configResult = loadCoordinatorConfig(workspace);
  assert.equal(configResult.ok, true, configResult.errors?.join('\n'));

  const initResult = initializeCoordinatorRun(workspace, configResult.config);
  assert.equal(initResult.ok, true, initResult.errors?.join('\n'));

  const state = loadCoordinatorState(workspace);
  assert.ok(state, 'coordinator state should exist after init');

  return { workspace, webRepo, apiRepo, config: configResult.config, state };
}

function appendHistory(workspace, entry) {
  appendFileSync(join(workspace, '.agentxchain/multirepo/history.jsonl'), JSON.stringify(entry) + '\n');
}

function writeValidRecoveryReport(workspace) {
  writeFileSync(join(workspace, '.agentxchain/multirepo/RECOVERY_REPORT.md'), `# Recovery Report

## Trigger

Hook violation detected during coordinator acceptance.

## Impact

Coordinator blocked. No child repo data lost.

## Mitigation

Operator investigated and confirmed false positive. Resuming.
`);
}

describe('coordinator divergence detection', () => {
  it('AT-CR-001: detects when coordinator says active but repo says accepted (unprojected turn)', () => {
    const { workspace, apiRepo, config, state } = setupWorkspace();
    try {
      // Simulate a dispatched turn that the coordinator knows about
      appendHistory(workspace, {
        type: 'turn_dispatched',
        timestamp: new Date().toISOString(),
        super_run_id: state.super_run_id,
        workstream_id: 'delivery',
        repo_id: 'api',
        repo_run_id: state.repo_runs.api.run_id,
        repo_turn_id: 'turn_001',
        role: 'dev',
      });

      // Simulate the repo accepting the turn outside the coordinator
      const repoState = JSON.parse(readFileSync(join(apiRepo, '.agentxchain/state.json'), 'utf8'));
      repoState.active_turns = {}; // Turn is no longer active
      repoState.accepted_count = 1;
      writeJson(join(apiRepo, '.agentxchain/state.json'), repoState);

      // Write a repo-local history entry showing acceptance
      appendFileSync(
        join(apiRepo, '.agentxchain/history.jsonl'),
        JSON.stringify({ turn_id: 'turn_001', status: 'completed', summary: 'done', accepted_at: new Date().toISOString() }) + '\n'
      );

      const result = detectDivergence(workspace, state, config);
      assert.equal(result.diverged, true);
      assert.ok(result.mismatches.length > 0);

      const turnMismatch = result.mismatches.find(m => m.type === 'turn_accepted_unprojected');
      assert.ok(turnMismatch, 'should detect unprojected accepted turn');
      assert.equal(turnMismatch.repo_id, 'api');
      assert.equal(turnMismatch.turn_id, 'turn_001');
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('AT-CR-001b: detects repo completed while coordinator thinks active', () => {
    const { workspace, apiRepo, config, state } = setupWorkspace();
    try {
      // Simulate repo completing outside coordinator
      const repoState = JSON.parse(readFileSync(join(apiRepo, '.agentxchain/state.json'), 'utf8'));
      repoState.status = 'completed';
      writeJson(join(apiRepo, '.agentxchain/state.json'), repoState);

      const result = detectDivergence(workspace, state, config);
      assert.equal(result.diverged, true);
      const mismatch = result.mismatches.find(m => m.type === 'repo_completed_unexpectedly');
      assert.ok(mismatch, 'should detect repo completed unexpectedly');
      assert.equal(mismatch.repo_id, 'api');
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('AT-CR-001c: no divergence when coordinator and repos agree', () => {
    const { workspace, config, state } = setupWorkspace();
    try {
      const result = detectDivergence(workspace, state, config);
      assert.equal(result.diverged, false);
      assert.equal(result.mismatches.length, 0);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('AT-CR-001e: detects run_id mismatch when a child repo drifts to another governed run', () => {
    const { workspace, apiRepo, config, state } = setupWorkspace();
    try {
      const expectedRunId = state.repo_runs.api.run_id;
      writeJson(join(apiRepo, '.agentxchain/state.json'), {
        ...JSON.parse(readFileSync(join(apiRepo, '.agentxchain/state.json'), 'utf8')),
        run_id: 'run_api_reinitialized',
      });

      const result = detectDivergence(workspace, state, config);
      assert.equal(result.diverged, true);
      const mismatch = result.mismatches.find((entry) => entry.type === 'run_id_mismatch');
      assert.ok(mismatch, 'should detect child run identity drift');
      assert.equal(mismatch.repo_id, 'api');
      assert.equal(mismatch.coordinator_run_id, expectedRunId);
      assert.equal(mismatch.repo_run_id, 'run_api_reinitialized');
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});

describe('coordinator resync from repo authority', () => {
  it('AT-CR-002: resync rebuilds projections from repo-local accepted turns', () => {
    const { workspace, apiRepo, config, state } = setupWorkspace();
    try {
      // Simulate a dispatched turn
      appendHistory(workspace, {
        type: 'turn_dispatched',
        timestamp: new Date().toISOString(),
        super_run_id: state.super_run_id,
        workstream_id: 'delivery',
        repo_id: 'api',
        repo_run_id: state.repo_runs.api.run_id,
        repo_turn_id: 'turn_001',
        role: 'dev',
      });

      // Simulate repo accepting the turn outside coordinator (no projection exists)
      const repoState = JSON.parse(readFileSync(join(apiRepo, '.agentxchain/state.json'), 'utf8'));
      repoState.active_turns = {};
      repoState.accepted_count = 1;
      writeJson(join(apiRepo, '.agentxchain/state.json'), repoState);

      appendFileSync(
        join(apiRepo, '.agentxchain/history.jsonl'),
        JSON.stringify({
          turn_id: 'turn_001',
          status: 'completed',
          summary: 'API module complete',
          files_changed: ['src/api.ts'],
          decisions: ['DEC-API-001'],
          accepted_at: new Date().toISOString(),
        }) + '\n'
      );

      // Verify no projection exists before resync
      const historyBefore = readCoordinatorHistory(workspace);
      const projectionsBefore = historyBefore.filter(e => e.type === 'acceptance_projection');
      assert.equal(projectionsBefore.length, 0);

      // Resync
      const result = resyncFromRepoAuthority(workspace, state, config);
      assert.equal(result.ok, true);
      assert.ok(result.resynced_repos.includes('api'), 'api should be in resynced repos');

      // Verify recovery projection was created
      const historyAfter = readCoordinatorHistory(workspace);
      const projectionsAfter = historyAfter.filter(e => e.type === 'acceptance_projection');
      assert.equal(projectionsAfter.length, 1);
      assert.equal(projectionsAfter[0].repo_id, 'api');
      assert.equal(projectionsAfter[0].recovery, true, 'should be marked as recovery projection');
      assert.equal(projectionsAfter[0].summary, 'API module complete');

      // Repo-local history must NOT have been mutated
      const repoHistoryAfter = readFileSync(join(apiRepo, '.agentxchain/history.jsonl'), 'utf8');
      const repoLines = repoHistoryAfter.trim().split('\n').length;
      assert.equal(repoLines, 1, 'repo-local history should still have exactly 1 entry');
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('AT-CR-003: resync appends state_resynced to coordinator history', () => {
    const { workspace, config, state } = setupWorkspace();
    try {
      const result = resyncFromRepoAuthority(workspace, state, config);
      assert.equal(result.ok, true);

      const history = readCoordinatorHistory(workspace);
      const resyncEntries = history.filter(e => e.type === 'state_resynced');
      assert.equal(resyncEntries.length, 1);
      assert.equal(resyncEntries[0].super_run_id, state.super_run_id);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('AT-CR-003b: resync recomputes interface_alignment from declared decision ids', () => {
    const { workspace, apiRepo, webRepo, config, state } = setupWorkspace({
      workstreams: {
        delivery: {
          phase: 'implementation',
          repos: ['api', 'web'],
          entry_repo: 'api',
          depends_on: [],
          completion_barrier: 'interface_alignment',
          interface_alignment: {
            decision_ids_by_repo: {
              api: ['DEC-101'],
              web: ['DEC-201'],
            },
          },
        },
      },
    });
    try {
      const barriers = readBarriers(workspace);
      barriers.delivery_completion.alignment_decision_ids = {
        api: ['DEC-101'],
        web: ['DEC-201'],
      };
      writeJson(join(workspace, '.agentxchain/multirepo/barriers.json'), barriers);

      appendHistory(workspace, {
        type: 'turn_dispatched',
        timestamp: new Date().toISOString(),
        super_run_id: state.super_run_id,
        workstream_id: 'delivery',
        repo_id: 'api',
        repo_run_id: state.repo_runs.api.run_id,
        repo_turn_id: 'turn_api_001',
        role: 'dev',
      });
      appendHistory(workspace, {
        type: 'turn_dispatched',
        timestamp: new Date().toISOString(),
        super_run_id: state.super_run_id,
        workstream_id: 'delivery',
        repo_id: 'web',
        repo_run_id: state.repo_runs.web.run_id,
        repo_turn_id: 'turn_web_001',
        role: 'dev',
      });

      appendFileSync(
        join(apiRepo, '.agentxchain/history.jsonl'),
        JSON.stringify({
          turn_id: 'turn_api_001',
          status: 'completed',
          summary: 'API contract accepted',
          decisions: [{ id: 'DEC-101' }],
          accepted_at: new Date().toISOString(),
        }) + '\n'
      );
      appendFileSync(
        join(webRepo, '.agentxchain/history.jsonl'),
        JSON.stringify({
          turn_id: 'turn_web_001',
          status: 'completed',
          summary: 'Web contract accepted',
          decisions: [{ id: 'DEC-201' }],
          accepted_at: new Date().toISOString(),
        }) + '\n'
      );

      const result = resyncFromRepoAuthority(workspace, state, config);
      assert.equal(result.ok, true);

      const repairedBarriers = readBarriers(workspace);
      assert.equal(repairedBarriers.delivery_completion.status, 'satisfied');
      assert.deepEqual(repairedBarriers.delivery_completion.satisfied_repos.sort(), ['api', 'web']);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('AT-CR-004: ambiguous divergence enters blocked with mismatch details', () => {
    const { workspace, config, state } = setupWorkspace();
    try {
      // Create a pending gate
      const updatedState = {
        ...state,
        status: 'paused',
        pending_gate: {
          gate_type: 'phase_transition',
          gate: 'phase_transition:implementation->review',
          from: 'implementation',
          to: 'review',
          required_repos: ['web', 'api'],
          human_barriers: [],
          requested_at: new Date().toISOString(),
        },
      };
      saveCoordinatorState(workspace, updatedState);

      // Simulate a required repo going blocked — makes the gate ambiguous
      const apiRepo = join(workspace, 'repos', 'api');
      const repoState = JSON.parse(readFileSync(join(apiRepo, '.agentxchain/state.json'), 'utf8'));
      repoState.status = 'blocked';
      repoState.blocked_reason = 'external failure';
      writeJson(join(apiRepo, '.agentxchain/state.json'), repoState);

      const result = resyncFromRepoAuthority(workspace, updatedState, config);
      assert.equal(result.ok, false, 'resync should fail when gate is ambiguous');
      assert.ok(result.blocked_reason, 'should have a blocked_reason');
      assert.ok(result.blocked_reason.includes('blocked'), 'reason should mention blocked repo');

      // Verify coordinator state is now blocked
      const finalState = loadCoordinatorState(workspace);
      assert.equal(finalState.status, 'blocked');

      // Blocked resync must scaffold the recovery artifact too.
      const reportPath = join(workspace, RECOVERY_REPORT_PATH);
      assert.equal(existsSync(reportPath), true);
      const reportContent = readFileSync(reportPath, 'utf8');
      assert.match(reportContent, /## Trigger/);
      assert.match(reportContent, /## Impact/);
      assert.match(reportContent, /## Mitigation/);
      assert.match(reportContent, /repo "api" is now blocked/);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('AT-CR-004b: resync blocks on repo run identity drift instead of adopting a new run_id', () => {
    const { workspace, apiRepo, config, state } = setupWorkspace();
    try {
      const expectedRunId = state.repo_runs.api.run_id;
      const repoState = JSON.parse(readFileSync(join(apiRepo, '.agentxchain/state.json'), 'utf8'));
      repoState.run_id = 'run_api_reinitialized';
      writeJson(join(apiRepo, '.agentxchain/state.json'), repoState);

      const result = resyncFromRepoAuthority(workspace, state, config);
      assert.equal(result.ok, false, 'resync must fail closed on run identity drift');
      assert.match(result.blocked_reason, /run identity drifted/);
      assert.match(result.blocked_reason, /run_api_reinitialized/);

      const finalState = loadCoordinatorState(workspace);
      assert.equal(finalState.status, 'blocked');
      assert.equal(finalState.repo_runs.api.run_id, expectedRunId, 'coordinator must preserve original repo run identity');

      const reportPath = join(workspace, RECOVERY_REPORT_PATH);
      assert.equal(existsSync(reportPath), true, 'blocked resync must scaffold a recovery report');
      const reportContent = readFileSync(reportPath, 'utf8');
      assert.match(reportContent, /run identity drifted/);
      assert.match(reportContent, /run_api_reinitialized/);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('AT-CR-002b: pending gate survives safe resync', () => {
    const { workspace, config, state } = setupWorkspace();
    try {
      // Create a pending gate where repos are healthy
      const updatedState = {
        ...state,
        status: 'paused',
        pending_gate: {
          gate_type: 'phase_transition',
          gate: 'phase_transition:implementation->review',
          from: 'implementation',
          to: 'review',
          required_repos: ['web', 'api'],
          human_barriers: [],
          requested_at: new Date().toISOString(),
        },
      };
      saveCoordinatorState(workspace, updatedState);

      const result = resyncFromRepoAuthority(workspace, updatedState, config);
      assert.equal(result.ok, true, 'resync should succeed when gate is coherent');

      // Verify pending_gate is preserved
      const finalState = loadCoordinatorState(workspace);
      assert.ok(finalState.pending_gate, 'pending_gate should survive resync');
      assert.equal(finalState.pending_gate.gate_type, 'phase_transition');
      assert.equal(finalState.status, 'paused', 'status should remain paused');
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('AT-CR-002c: resync rebuilds barrier status from recovery projections', () => {
    const { workspace, apiRepo, webRepo, config, state } = setupWorkspace();
    try {
      // Simulate both repos having accepted turns outside coordinator
      // First, dispatch turns for both
      appendHistory(workspace, {
        type: 'turn_dispatched',
        timestamp: new Date().toISOString(),
        super_run_id: state.super_run_id,
        workstream_id: 'delivery',
        repo_id: 'api',
        repo_run_id: state.repo_runs.api.run_id,
        repo_turn_id: 'turn_001',
        role: 'dev',
      });
      appendHistory(workspace, {
        type: 'turn_dispatched',
        timestamp: new Date().toISOString(),
        super_run_id: state.super_run_id,
        workstream_id: 'delivery',
        repo_id: 'web',
        repo_run_id: state.repo_runs.web.run_id,
        repo_turn_id: 'turn_002',
        role: 'dev',
      });

      // Simulate both repos accepting outside coordinator
      for (const [repo, repoPath, turnId] of [['api', apiRepo, 'turn_001'], ['web', webRepo, 'turn_002']]) {
        const repoState = JSON.parse(readFileSync(join(repoPath, '.agentxchain/state.json'), 'utf8'));
        repoState.active_turns = {};
        repoState.accepted_count = 1;
        writeJson(join(repoPath, '.agentxchain/state.json'), repoState);
        appendFileSync(
          join(repoPath, '.agentxchain/history.jsonl'),
          JSON.stringify({ turn_id: turnId, status: 'completed', summary: `${repo} done`, accepted_at: new Date().toISOString() }) + '\n'
        );
      }

      // Verify barrier is pending before resync
      const barriersBefore = readBarriers(workspace);
      assert.equal(barriersBefore['delivery_completion'].status, 'pending');

      // Resync
      const result = resyncFromRepoAuthority(workspace, state, config);
      assert.equal(result.ok, true);

      // Barrier should now be satisfied after recovery projections rebuild
      const barriersAfter = readBarriers(workspace);
      assert.equal(barriersAfter['delivery_completion'].status, 'satisfied',
        'barrier should be satisfied after resync with both repos accepted');
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('AT-CR-001d: detects repo blocked while coordinator expects active', () => {
    const { workspace, apiRepo, config, state } = setupWorkspace();
    try {
      const repoState = JSON.parse(readFileSync(join(apiRepo, '.agentxchain/state.json'), 'utf8'));
      repoState.status = 'blocked';
      repoState.blocked_reason = 'test failure';
      writeJson(join(apiRepo, '.agentxchain/state.json'), repoState);

      const result = detectDivergence(workspace, state, config);
      assert.equal(result.diverged, true);
      const mismatch = result.mismatches.find(m => m.type === 'repo_blocked_unexpectedly');
      assert.ok(mismatch, 'should detect repo blocked unexpectedly');
      assert.equal(mismatch.repo_id, 'api');
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});

describe('coordinator blocked recovery', () => {
  it('AT-MR-REC-003: resumes a blocked coordinator to active when repos are healthy and no gate is pending', () => {
    const { workspace, config, state } = setupWorkspace();
    try {
      const blockedState = {
        ...state,
        status: 'blocked',
        blocked_reason: 'coordinator_hook_violation: tamper detected',
      };
      saveCoordinatorState(workspace, blockedState);
      writeValidRecoveryReport(workspace);

      const result = resumeCoordinatorFromBlockedState(workspace, blockedState, config);
      assert.equal(result.ok, true, result.error);
      assert.equal(result.resumed_status, 'active');

      const finalState = loadCoordinatorState(workspace);
      assert.equal(finalState.status, 'active');
      assert.ok(!('blocked_reason' in finalState), 'blocked_reason should be cleared after successful recovery');

      const history = readCoordinatorHistory(workspace);
      const resolved = history.filter((entry) => entry.type === 'blocked_resolved');
      assert.equal(resolved.length, 1);
      assert.equal(resolved[0].to, 'active');
      assert.equal(resolved[0].blocked_reason, 'coordinator_hook_violation: tamper detected');
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('AT-MR-REC-004: resumes a blocked coordinator to paused when a coherent pending gate still exists', () => {
    const { workspace, config, state } = setupWorkspace();
    try {
      const blockedState = {
        ...state,
        status: 'blocked',
        blocked_reason: 'temporary operator hold',
        pending_gate: {
          gate_type: 'phase_transition',
          gate: 'phase_transition:implementation->review',
          from: 'implementation',
          to: 'review',
          required_repos: ['web', 'api'],
          human_barriers: [],
          requested_at: new Date().toISOString(),
        },
      };
      saveCoordinatorState(workspace, blockedState);
      writeValidRecoveryReport(workspace);

      const result = resumeCoordinatorFromBlockedState(workspace, blockedState, config);
      assert.equal(result.ok, true, result.error);
      assert.equal(result.resumed_status, 'paused');

      const finalState = loadCoordinatorState(workspace);
      assert.equal(finalState.status, 'paused');
      assert.ok(finalState.pending_gate, 'pending gate should be preserved');
      assert.equal(finalState.pending_gate.gate_type, 'phase_transition');

      const history = readCoordinatorHistory(workspace);
      const resolved = history.filter((entry) => entry.type === 'blocked_resolved');
      assert.equal(resolved.length, 1);
      assert.equal(resolved[0].to, 'paused');
      assert.equal(resolved[0].pending_gate.gate_type, 'phase_transition');
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('AT-MR-REC-005: refuses recovery when a child repo remains blocked after resync', () => {
    const { workspace, apiRepo, config, state } = setupWorkspace();
    try {
      const blockedState = {
        ...state,
        status: 'blocked',
        blocked_reason: 'coordinator_hook_violation: tamper detected',
      };
      saveCoordinatorState(workspace, blockedState);
      writeValidRecoveryReport(workspace);

      const repoState = JSON.parse(readFileSync(join(apiRepo, '.agentxchain/state.json'), 'utf8'));
      repoState.status = 'blocked';
      repoState.blocked_reason = 'repo validation failure';
      writeJson(join(apiRepo, '.agentxchain/state.json'), repoState);

      const result = resumeCoordinatorFromBlockedState(workspace, blockedState, config);
      assert.equal(result.ok, false, 'resume must fail while a child repo remains blocked');
      assert.deepEqual(result.blocked_repos, ['api']);

      const finalState = loadCoordinatorState(workspace);
      assert.equal(finalState.status, 'blocked');
      assert.equal(finalState.blocked_reason, 'child repos remain blocked: api');
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});
