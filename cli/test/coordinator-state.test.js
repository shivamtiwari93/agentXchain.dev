import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import {
  initializeCoordinatorRun,
  loadCoordinatorState,
  saveCoordinatorState,
  getCoordinatorStatus,
  readCoordinatorHistory,
  readBarriers,
} from '../src/lib/coordinator-state.js';
import { loadCoordinatorConfig } from '../src/lib/coordinator-config.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

function writeJson(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
}

function makeWorkspace() {
  return mkdtempSync(join(tmpdir(), 'axc-multi-state-'));
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
      'manual-qa': {
        type: 'manual',
      },
    },
    routing: {
      implementation: {
        entry_role: 'dev',
        allowed_next_roles: ['qa', 'human'],
      },
    },
    gates: {},
  });

  // Write idle governed state
  writeJson(join(root, '.agentxchain/state.json'), {
    schema_version: '1.1',
    run_id: null,
    status: 'idle',
    phase: 'implementation',
    active_turns: {},
    accepted_count: 0,
    rejected_count: 0,
    blocked_on: null,
    blocked_reason: null,
  });
}

function writeGovernedRepoWithActiveRun(root, projectId, runId) {
  writeGovernedRepo(root, projectId);

  writeJson(join(root, '.agentxchain/state.json'), {
    schema_version: '1.1',
    run_id: runId,
    status: 'active',
    phase: 'implementation',
    active_turns: {},
    accepted_count: 0,
    rejected_count: 0,
    blocked_on: null,
    blocked_reason: null,
  });
}

function writeGovernedRepoCompleted(root, projectId) {
  writeGovernedRepo(root, projectId);

  writeJson(join(root, '.agentxchain/state.json'), {
    schema_version: '1.1',
    run_id: 'run_completed_abc',
    status: 'completed',
    phase: 'qa',
    active_turns: {},
    accepted_count: 5,
    rejected_count: 0,
    blocked_on: null,
    blocked_reason: null,
  });
}

function buildCoordinatorConfig(repoPaths) {
  return {
    schema_version: '0.1',
    project: {
      id: 'test-project',
      name: 'Test Project',
    },
    repos: {
      web: {
        path: repoPaths.web,
        default_branch: 'main',
        required: true,
      },
      api: {
        path: repoPaths.api,
        default_branch: 'main',
        required: true,
      },
    },
    workstreams: {
      core_delivery: {
        phase: 'implementation',
        repos: ['web', 'api'],
        entry_repo: 'api',
        depends_on: [],
        completion_barrier: 'all_repos_accepted',
      },
    },
    routing: {
      implementation: {
        entry_workstream: 'core_delivery',
      },
    },
    gates: {
      ship_gate: {
        requires_human_approval: true,
        requires_repos: ['web', 'api'],
      },
    },
  };
}

function setupTwoRepoWorkspace() {
  const workspace = makeWorkspace();
  const webRepo = join(workspace, 'repos', 'web');
  const apiRepo = join(workspace, 'repos', 'api');

  writeGovernedRepo(webRepo, 'web');
  writeGovernedRepo(apiRepo, 'api');

  const config = buildCoordinatorConfig({
    web: './repos/web',
    api: './repos/api',
  });
  writeJson(join(workspace, 'agentxchain-multi.json'), config);

  return { workspace, webRepo, apiRepo };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('coordinator state machine', () => {
  it('AT-CS-001: two-repo initialization creates super_run_id, links both repo runs, writes all 5 state files', () => {
    const { workspace, webRepo, apiRepo } = setupTwoRepoWorkspace();

    try {
      const configResult = loadCoordinatorConfig(workspace);
      assert.equal(configResult.ok, true, configResult.errors?.join('\n'));

      const result = initializeCoordinatorRun(workspace, configResult.config);
      assert.equal(result.ok, true, result.errors?.join('\n'));

      // super_run_id format
      assert.ok(result.super_run_id.startsWith('srun_'), `Expected srun_ prefix, got: ${result.super_run_id}`);

      // Both repos linked
      assert.ok(result.repo_runs.web, 'web repo run missing');
      assert.ok(result.repo_runs.api, 'api repo run missing');
      assert.ok(result.repo_runs.web.run_id, 'web run_id missing');
      assert.ok(result.repo_runs.api.run_id, 'api run_id missing');

      // All 5 coordinator state files exist
      const multiDir = join(workspace, '.agentxchain/multirepo');
      assert.ok(existsSync(join(multiDir, 'state.json')), 'state.json missing');
      assert.ok(existsSync(join(multiDir, 'history.jsonl')), 'history.jsonl missing');
      assert.ok(existsSync(join(multiDir, 'decision-ledger.jsonl')), 'decision-ledger.jsonl missing');
      assert.ok(existsSync(join(multiDir, 'barriers.json')), 'barriers.json missing');
      assert.ok(existsSync(join(multiDir, 'barrier-ledger.jsonl')), 'barrier-ledger.jsonl missing');

      // State file has correct shape
      const state = JSON.parse(readFileSync(join(multiDir, 'state.json'), 'utf8'));
      assert.equal(state.super_run_id, result.super_run_id);
      assert.equal(state.status, 'active');
      assert.equal(state.project_id, 'test-project');

      // Repo-local runs were initialized (they were idle, so coordinator should have init'd them)
      assert.equal(result.repo_runs.web.initialized_by_coordinator, true);
      assert.equal(result.repo_runs.api.initialized_by_coordinator, true);

      // Verify repo-local state is now active
      const webState = JSON.parse(readFileSync(join(webRepo, '.agentxchain/state.json'), 'utf8'));
      assert.equal(webState.status, 'active');
      assert.ok(webState.run_id, 'web repo should have a run_id after init');
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('AT-CS-002: init with existing repo-local active run links it without re-initializing', () => {
    const workspace = makeWorkspace();
    const webRepo = join(workspace, 'repos', 'web');
    const apiRepo = join(workspace, 'repos', 'api');

    const existingRunId = 'run_existing_abc123';
    writeGovernedRepoWithActiveRun(webRepo, 'web', existingRunId);
    writeGovernedRepo(apiRepo, 'api');

    writeJson(join(workspace, 'agentxchain-multi.json'), buildCoordinatorConfig({
      web: './repos/web',
      api: './repos/api',
    }));

    try {
      const configResult = loadCoordinatorConfig(workspace);
      assert.equal(configResult.ok, true, configResult.errors?.join('\n'));

      const result = initializeCoordinatorRun(workspace, configResult.config);
      assert.equal(result.ok, true, result.errors?.join('\n'));

      // Web repo was linked, not re-initialized
      assert.equal(result.repo_runs.web.run_id, existingRunId);
      assert.equal(result.repo_runs.web.initialized_by_coordinator, false);
      assert.equal(result.repo_runs.web.status, 'linked');

      // API repo was initialized (was idle)
      assert.equal(result.repo_runs.api.initialized_by_coordinator, true);
      assert.equal(result.repo_runs.api.status, 'initialized');

      // Verify web repo-local state was NOT changed
      const webState = JSON.parse(readFileSync(join(webRepo, '.agentxchain/state.json'), 'utf8'));
      assert.equal(webState.run_id, existingRunId);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('AT-CS-003: init with one required repo failing validation writes no coordinator state (atomic failure)', () => {
    const workspace = makeWorkspace();
    const webRepo = join(workspace, 'repos', 'web');
    const apiRepo = join(workspace, 'repos', 'api');

    writeGovernedRepo(webRepo, 'web');
    writeGovernedRepoCompleted(apiRepo, 'api'); // completed = cannot init

    writeJson(join(workspace, 'agentxchain-multi.json'), buildCoordinatorConfig({
      web: './repos/web',
      api: './repos/api',
    }));

    try {
      const configResult = loadCoordinatorConfig(workspace);
      assert.equal(configResult.ok, true, configResult.errors?.join('\n'));

      const result = initializeCoordinatorRun(workspace, configResult.config);
      assert.equal(result.ok, false);

      // Errors mention the failed repo
      assert.ok(result.errors.some(e => e.includes('api')), `Expected error about api repo, got: ${result.errors.join(', ')}`);

      // No coordinator state written
      const multiDir = join(workspace, '.agentxchain/multirepo');
      assert.ok(!existsSync(multiDir), 'multirepo dir should not exist after atomic failure');
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('AT-CS-004: loadCoordinatorState returns null for workspace with no coordinator state', () => {
    const workspace = makeWorkspace();

    try {
      const state = loadCoordinatorState(workspace);
      assert.equal(state, null);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('AT-CS-005: getCoordinatorStatus returns the full status snapshot after successful init', () => {
    const { workspace } = setupTwoRepoWorkspace();

    try {
      const configResult = loadCoordinatorConfig(workspace);
      assert.equal(configResult.ok, true, configResult.errors?.join('\n'));

      const initResult = initializeCoordinatorRun(workspace, configResult.config);
      assert.equal(initResult.ok, true, initResult.errors?.join('\n'));

      const status = getCoordinatorStatus(workspace);
      assert.ok(status, 'status should not be null');
      assert.equal(status.super_run_id, initResult.super_run_id);
      assert.equal(status.status, 'active');
      assert.equal(status.phase, 'implementation');
      assert.ok(status.repo_runs.web, 'web repo run missing from status');
      assert.ok(status.repo_runs.api, 'api repo run missing from status');
      assert.ok(Array.isArray(status.pending_barriers), 'pending_barriers should be an array');
      assert.ok(status.pending_barriers.length > 0, 'should have at least one pending barrier after init');

      // Verify the pending barrier has the right shape
      const barrier = status.pending_barriers[0];
      assert.equal(barrier.status, 'pending');
      assert.equal(barrier.workstream_id, 'core_delivery');
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('AT-CS-006: barriers.json is populated from workstream declarations at init', () => {
    const { workspace } = setupTwoRepoWorkspace();

    try {
      const configResult = loadCoordinatorConfig(workspace);
      assert.equal(configResult.ok, true, configResult.errors?.join('\n'));

      const result = initializeCoordinatorRun(workspace, configResult.config);
      assert.equal(result.ok, true, result.errors?.join('\n'));

      const barriers = readBarriers(workspace);
      assert.ok(barriers.core_delivery_completion, 'expected core_delivery_completion barrier');

      const barrier = barriers.core_delivery_completion;
      assert.equal(barrier.workstream_id, 'core_delivery');
      assert.equal(barrier.type, 'all_repos_accepted');
      assert.equal(barrier.status, 'pending');
      assert.deepEqual(barrier.required_repos, ['web', 'api']);
      assert.deepEqual(barrier.satisfied_repos, []);
      assert.ok(barrier.created_at, 'created_at should be set');
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('AT-CS-007: history.jsonl contains a run_initialized entry after successful init', () => {
    const { workspace } = setupTwoRepoWorkspace();

    try {
      const configResult = loadCoordinatorConfig(workspace);
      assert.equal(configResult.ok, true, configResult.errors?.join('\n'));

      const result = initializeCoordinatorRun(workspace, configResult.config);
      assert.equal(result.ok, true, result.errors?.join('\n'));

      const history = readCoordinatorHistory(workspace);
      assert.equal(history.length, 1, `Expected 1 history entry, got ${history.length}`);

      const entry = history[0];
      assert.equal(entry.type, 'run_initialized');
      assert.equal(entry.super_run_id, result.super_run_id);
      assert.equal(entry.project_id, 'test-project');
      assert.ok(entry.timestamp, 'timestamp should be set');

      // repo_runs in history should include run_ids and init attribution
      assert.ok(entry.repo_runs.web, 'web repo_run missing from history entry');
      assert.ok(entry.repo_runs.api, 'api repo_run missing from history entry');
      assert.ok(entry.repo_runs.web.run_id, 'web run_id missing from history');
      assert.equal(entry.repo_runs.web.initialized_by_coordinator, true);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});

describe('coordinator state persistence', () => {
  it('saveCoordinatorState persists and loadCoordinatorState reads back correctly', () => {
    const workspace = makeWorkspace();
    const dir = join(workspace, '.agentxchain/multirepo');
    mkdirSync(dir, { recursive: true });

    try {
      const state = {
        schema_version: '0.1',
        super_run_id: 'srun_test_123',
        project_id: 'test-project',
        status: 'active',
        phase: 'implementation',
        repo_runs: {},
        created_at: new Date().toISOString(),
      };

      saveCoordinatorState(workspace, state);
      const loaded = loadCoordinatorState(workspace);

      assert.equal(loaded.super_run_id, 'srun_test_123');
      assert.equal(loaded.status, 'active');
      assert.ok(loaded.updated_at, 'updated_at should be set by save');
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('getCoordinatorStatus returns null when no state exists', () => {
    const workspace = makeWorkspace();

    try {
      const status = getCoordinatorStatus(workspace);
      assert.equal(status, null);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});
