import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initializeCoordinatorRun, loadCoordinatorState, readCoordinatorHistory, readBarriers } from '../src/lib/coordinator-state.js';
import { loadCoordinatorConfig } from '../src/lib/coordinator-config.js';
import { projectRepoAcceptance, evaluateBarriers, recordBarrierTransition } from '../src/lib/coordinator-acceptance.js';

function writeJson(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
}

function makeWorkspace() {
  return mkdtempSync(join(tmpdir(), 'axc-multi-accept-'));
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

function readBarrierLedger(workspace) {
  const file = join(workspace, '.agentxchain/multirepo/barrier-ledger.jsonl');
  if (!existsSync(file)) return [];
  const content = readFileSync(file, 'utf8').trim();
  if (!content) return [];
  return content.split('\n').map(line => JSON.parse(line));
}

function makeAcceptedTurn(turnId, overrides = {}) {
  return {
    turn_id: turnId,
    summary: overrides.summary ?? `Completed work for ${turnId}`,
    files_changed: overrides.files_changed ?? ['src/index.ts'],
    decisions: overrides.decisions ?? [`DEC-${turnId}`],
    verification: overrides.verification ?? { command: 'npm test', exit_code: 0 },
    ...overrides,
  };
}

describe('coordinator acceptance projection', () => {
  it('AT-CA-001: projection created without mutating repo-local history', () => {
    const { workspace, apiRepo, config, state } = setupWorkspace();
    try {
      // Record repo-local history length before projection
      const repoHistoryBefore = readRepoLocalHistory(apiRepo);

      const turn = makeAcceptedTurn('turn_001');
      const result = projectRepoAcceptance(workspace, state, config, 'api', turn, 'delivery');

      assert.equal(result.ok, true);
      assert.ok(result.projection_ref, 'should return a projection_ref');
      assert.ok(result.projection_ref.startsWith('proj_delivery_api_'));

      // Coordinator history should have the projection
      const coordHistory = readCoordinatorHistory(workspace);
      const projections = coordHistory.filter(e => e.type === 'acceptance_projection');
      assert.equal(projections.length, 1);
      assert.equal(projections[0].repo_id, 'api');
      assert.equal(projections[0].workstream_id, 'delivery');
      assert.equal(projections[0].repo_turn_id, 'turn_001');
      assert.equal(projections[0].summary, 'Completed work for turn_001');
      assert.deepEqual(projections[0].files_changed, ['src/index.ts']);
      assert.deepEqual(projections[0].decisions, ['DEC-turn_001']);

      // Repo-local history must NOT be mutated
      const repoHistoryAfter = readRepoLocalHistory(apiRepo);
      assert.equal(repoHistoryAfter.length, repoHistoryBefore.length, 'repo-local history must not change');
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('AT-CA-002: barrier moves pending → partially_satisfied → satisfied', () => {
    const { workspace, config, state } = setupWorkspace();
    try {
      // Accept first repo (api = entry_repo) — barrier effects come from projectRepoAcceptance
      const turn1 = makeAcceptedTurn('turn_001', { summary: 'API work done' });
      const result1 = projectRepoAcceptance(workspace, state, config, 'api', turn1, 'delivery');
      assert.equal(result1.ok, true);
      assert.ok(result1.barrier_effects.length > 0, 'should have barrier effects from first acceptance');
      assert.equal(result1.barrier_effects[0].previous_status, 'pending');
      assert.equal(result1.barrier_effects[0].new_status, 'partially_satisfied');

      // Verify snapshot reflects partial satisfaction
      const barriers1 = readBarriers(workspace);
      assert.equal(barriers1['delivery_completion'].status, 'partially_satisfied');

      // Accept second repo (web)
      const turn2 = makeAcceptedTurn('turn_002', { summary: 'Web work done' });
      const result2 = projectRepoAcceptance(workspace, state, config, 'web', turn2, 'delivery');
      assert.equal(result2.ok, true);
      assert.ok(result2.barrier_effects.some(e => e.new_status === 'satisfied'),
        'should have barrier satisfied effect from second acceptance');

      // Verify snapshot reflects full satisfaction
      const barriers2 = readBarriers(workspace);
      assert.equal(barriers2['delivery_completion'].status, 'satisfied');
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('AT-CA-003: each barrier transition is recorded in barrier-ledger.jsonl with causation', () => {
    const { workspace, config, state } = setupWorkspace();
    try {
      // Accept api
      projectRepoAcceptance(workspace, state, config, 'api', makeAcceptedTurn('turn_001'), 'delivery');
      evaluateBarriers(workspace, state, config);

      const ledger = readBarrierLedger(workspace);
      assert.ok(ledger.length >= 1, 'barrier ledger should have entries');

      const firstEntry = ledger.find(e => e.barrier_id === 'delivery_completion');
      assert.ok(firstEntry, 'should have delivery_completion transition');
      assert.equal(firstEntry.previous_status, 'pending');
      assert.equal(firstEntry.new_status, 'partially_satisfied');
      assert.ok(firstEntry.causation, 'transition must include causation');
      assert.equal(firstEntry.causation.super_run_id, state.super_run_id);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('AT-CA-004: ordered_repo_sequence satisfied only after upstream acceptance', () => {
    const { workspace, config, state } = setupWorkspace({
      workstreams: {
        delivery: {
          phase: 'implementation',
          repos: ['api', 'web'],
          entry_repo: 'api',
          depends_on: [],
          completion_barrier: 'ordered_repo_sequence',
        },
      },
    });
    try {
      // Before any acceptance, barrier is pending
      const eval0 = evaluateBarriers(workspace, state, config);
      assert.equal(eval0.barriers['delivery_completion'].status, 'pending');

      // Accept the downstream (web) first — barrier should NOT become satisfied
      projectRepoAcceptance(workspace, state, config, 'web', makeAcceptedTurn('turn_web_001'), 'delivery');
      const eval1 = evaluateBarriers(workspace, state, config);
      assert.notEqual(eval1.barriers['delivery_completion'].status, 'satisfied',
        'downstream acceptance alone must not satisfy ordered_repo_sequence');

      // Accept the upstream (api) — now barrier should become satisfied
      projectRepoAcceptance(workspace, state, config, 'api', makeAcceptedTurn('turn_api_001'), 'delivery');
      const eval2 = evaluateBarriers(workspace, state, config);
      assert.equal(eval2.barriers['delivery_completion'].status, 'satisfied');
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('AT-CA-005: shared_human_gate NOT auto-satisfied by repo-local acceptances', () => {
    const { workspace, config, state } = setupWorkspace({
      workstreams: {
        delivery: {
          phase: 'implementation',
          repos: ['api', 'web'],
          entry_repo: 'api',
          depends_on: [],
          completion_barrier: 'shared_human_gate',
        },
      },
    });
    try {
      // Accept both repos
      projectRepoAcceptance(workspace, state, config, 'api', makeAcceptedTurn('turn_001'), 'delivery');
      projectRepoAcceptance(workspace, state, config, 'web', makeAcceptedTurn('turn_002'), 'delivery');

      // Evaluate — barrier must still be pending
      const result = evaluateBarriers(workspace, state, config);
      assert.equal(result.barriers['delivery_completion'].status, 'pending',
        'shared_human_gate must not auto-satisfy');
      assert.equal(result.changes.length, 0, 'no transitions should occur for shared_human_gate');
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('AT-CA-006: cross-repo write violation rejected at acceptance', () => {
    const { workspace, webRepo, config, state } = setupWorkspace();
    try {
      const absoluteTurn = makeAcceptedTurn('turn_bad_abs', {
        files_changed: [join(config.repos.web.resolved_path, 'src/stolen.ts')],
      });
      const absoluteResult = projectRepoAcceptance(workspace, state, config, 'api', absoluteTurn, 'delivery');

      assert.equal(absoluteResult.ok, false);
      assert.ok(absoluteResult.error.includes('Cross-repo write violation'));
      assert.ok(absoluteResult.error.includes('web'));

      const relativeTurn = makeAcceptedTurn('turn_bad_rel', {
        files_changed: ['../web/src/stolen.ts'],
      });
      const relativeResult = projectRepoAcceptance(workspace, state, config, 'api', relativeTurn, 'delivery');

      assert.equal(relativeResult.ok, false);
      assert.ok(relativeResult.error.includes('Cross-repo write violation'));
      assert.ok(relativeResult.error.includes('web'));

      // Coordinator history must NOT contain this projection
      const coordHistory = readCoordinatorHistory(workspace);
      const projections = coordHistory.filter(e => e.type === 'acceptance_projection');
      assert.equal(projections.length, 0, 'rejected acceptance must not create a projection');
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('AT-CA-007: upstream acceptance invalidates downstream pending context', () => {
    const { workspace, config, state } = setupWorkspace({
      workstreams: {
        upstream: {
          phase: 'implementation',
          repos: ['api'],
          entry_repo: 'api',
          depends_on: [],
          completion_barrier: 'all_repos_accepted',
        },
        downstream: {
          phase: 'implementation',
          repos: ['web'],
          entry_repo: 'web',
          depends_on: ['upstream'],
          completion_barrier: 'all_repos_accepted',
        },
      },
      routing: {
        implementation: { entry_workstream: 'upstream' },
      },
    });
    try {
      // Simulate a dispatched downstream turn (pending, not yet projected)
      const historyFile = join(workspace, '.agentxchain/multirepo/history.jsonl');
      const dispatchEntry = JSON.stringify({
        type: 'turn_dispatched',
        timestamp: new Date().toISOString(),
        super_run_id: state.super_run_id,
        workstream_id: 'downstream',
        repo_id: 'web',
        repo_turn_id: 'turn_web_pending',
        role: 'dev',
      });
      writeFileSync(historyFile, readFileSync(historyFile, 'utf8') + dispatchEntry + '\n');

      // Now accept upstream — should invalidate the downstream pending turn
      const turn = makeAcceptedTurn('turn_api_001');
      const result = projectRepoAcceptance(workspace, state, config, 'api', turn, 'upstream');

      assert.equal(result.ok, true);
      assert.ok(Array.isArray(result.context_invalidations));
      assert.ok(result.context_invalidations.includes('turn_web_pending'),
        'downstream pending turn should be flagged for re-dispatch');
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('AT-CA-008: barriers.json snapshot matches cumulative barrier-ledger transitions', () => {
    const { workspace, config, state } = setupWorkspace();
    try {
      // Accept api → evaluateBarriers → pending→partially_satisfied
      projectRepoAcceptance(workspace, state, config, 'api', makeAcceptedTurn('turn_001'), 'delivery');
      evaluateBarriers(workspace, state, config);

      // Accept web → evaluateBarriers → partially_satisfied→satisfied
      projectRepoAcceptance(workspace, state, config, 'web', makeAcceptedTurn('turn_002'), 'delivery');
      evaluateBarriers(workspace, state, config);

      // Read final snapshot
      const barriers = readBarriers(workspace);
      assert.equal(barriers['delivery_completion'].status, 'satisfied');

      // Read all ledger transitions
      const ledger = readBarrierLedger(workspace);
      const deliveryTransitions = ledger.filter(e => e.barrier_id === 'delivery_completion');

      // Replay ledger: start from pending, apply transitions, should arrive at snapshot
      let replayedStatus = 'pending';
      for (const t of deliveryTransitions) {
        assert.equal(t.previous_status, replayedStatus,
          `ledger transition previous_status should match replayed state`);
        replayedStatus = t.new_status;
      }
      assert.equal(replayedStatus, 'satisfied',
        'replayed ledger status should match snapshot');
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});

// Helper shared with the main module
function readRepoLocalHistory(repoPath) {
  const file = join(repoPath, '.agentxchain/history.jsonl');
  if (!existsSync(file)) return [];
  try {
    const content = readFileSync(file, 'utf8').trim();
    if (!content) return [];
    return content.split('\n').map(line => JSON.parse(line));
  } catch {
    return [];
  }
}
