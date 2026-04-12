import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  initializeCoordinatorRun,
  loadCoordinatorState,
  saveCoordinatorState,
  getCoordinatorStatus,
} from '../src/lib/coordinator-state.js';
import { loadCoordinatorConfig } from '../src/lib/coordinator-config.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

function writeJson(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
}

function makeWorkspace() {
  return mkdtempSync(join(tmpdir(), 'axc-multi-status-obs-'));
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
    },
    runtimes: {
      'local-dev': {
        type: 'local_cli',
        command: ['echo', '{prompt}'],
        prompt_transport: 'argv',
      },
    },
    routing: {
      implementation: { entry_role: 'dev', allowed_next_roles: ['human'] },
    },
    gates: {},
  });

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

function buildCoordinatorConfig(repoPaths) {
  return {
    schema_version: '0.1',
    project: { id: 'test-project', name: 'Test Project' },
    repos: {
      web: { path: repoPaths.web, default_branch: 'main', required: true },
      api: { path: repoPaths.api, default_branch: 'main', required: true },
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
      implementation: { entry_workstream: 'core_delivery' },
    },
    gates: {
      ship_gate: { requires_human_approval: true, requires_repos: ['web', 'api'] },
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

describe('Coordinator status observability enrichment', () => {
  it('getCoordinatorStatus includes created_at and updated_at after init', () => {
    const { workspace } = setupTwoRepoWorkspace();
    try {
      const configResult = loadCoordinatorConfig(workspace);
      assert.equal(configResult.ok, true, configResult.errors?.join('\n'));

      const initResult = initializeCoordinatorRun(workspace, configResult.config);
      assert.equal(initResult.ok, true, initResult.errors?.join('\n'));

      const status = getCoordinatorStatus(workspace);
      assert.ok(status, 'status should not be null');
      assert.ok(status.created_at, 'created_at should be present');
      assert.ok(status.updated_at, 'updated_at should be present');
      assert.ok(!isNaN(new Date(status.created_at).getTime()), 'created_at should be valid ISO');
      assert.ok(!isNaN(new Date(status.updated_at).getTime()), 'updated_at should be valid ISO');
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('getCoordinatorStatus includes phase_gate_status after init', () => {
    const { workspace } = setupTwoRepoWorkspace();
    try {
      const configResult = loadCoordinatorConfig(workspace);
      assert.equal(configResult.ok, true, configResult.errors?.join('\n'));

      initializeCoordinatorRun(workspace, configResult.config);

      const status = getCoordinatorStatus(workspace);
      assert.ok(status, 'status should not be null');
      assert.ok(status.phase_gate_status !== undefined, 'phase_gate_status should be present');
      assert.equal(typeof status.phase_gate_status, 'object');
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('getCoordinatorStatus returns blocked_reason when coordinator is blocked', () => {
    const { workspace } = setupTwoRepoWorkspace();
    try {
      const configResult = loadCoordinatorConfig(workspace);
      assert.equal(configResult.ok, true, configResult.errors?.join('\n'));

      initializeCoordinatorRun(workspace, configResult.config);

      const state = loadCoordinatorState(workspace);
      state.status = 'blocked';
      state.blocked_reason = 'repo-a has irreconcilable divergence';
      saveCoordinatorState(workspace, state);

      const status = getCoordinatorStatus(workspace);
      assert.equal(status.status, 'blocked');
      assert.equal(status.blocked_reason, 'repo-a has irreconcilable divergence');
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('getCoordinatorStatus returns null blocked_reason when not blocked', () => {
    const { workspace } = setupTwoRepoWorkspace();
    try {
      const configResult = loadCoordinatorConfig(workspace);
      assert.equal(configResult.ok, true, configResult.errors?.join('\n'));

      initializeCoordinatorRun(workspace, configResult.config);

      const status = getCoordinatorStatus(workspace);
      assert.equal(status.status, 'active');
      assert.equal(status.blocked_reason, null);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('getCoordinatorStatus returns phase_gate_status entries when gates have been evaluated', () => {
    const { workspace } = setupTwoRepoWorkspace();
    try {
      const configResult = loadCoordinatorConfig(workspace);
      assert.equal(configResult.ok, true, configResult.errors?.join('\n'));

      initializeCoordinatorRun(workspace, configResult.config);

      const state = loadCoordinatorState(workspace);
      state.phase_gate_status = { implementation_gate: 'passed', qa_gate: 'pending' };
      saveCoordinatorState(workspace, state);

      const status = getCoordinatorStatus(workspace);
      assert.deepEqual(status.phase_gate_status, {
        implementation_gate: 'passed',
        qa_gate: 'pending',
      });
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('JSON output includes all enriched fields', () => {
    const { workspace } = setupTwoRepoWorkspace();
    try {
      const configResult = loadCoordinatorConfig(workspace);
      assert.equal(configResult.ok, true, configResult.errors?.join('\n'));

      initializeCoordinatorRun(workspace, configResult.config);

      const status = getCoordinatorStatus(workspace);
      const json = JSON.parse(JSON.stringify(status));

      // All enriched fields present
      assert.ok('blocked_reason' in json, 'blocked_reason key in JSON');
      assert.ok('created_at' in json, 'created_at key in JSON');
      assert.ok('updated_at' in json, 'updated_at key in JSON');
      assert.ok('phase_gate_status' in json, 'phase_gate_status key in JSON');

      // Original fields still present
      assert.ok('super_run_id' in json, 'super_run_id key in JSON');
      assert.ok('status' in json, 'status key in JSON');
      assert.ok('phase' in json, 'phase key in JSON');
      assert.ok('repo_runs' in json, 'repo_runs key in JSON');
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});
