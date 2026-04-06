import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initializeCoordinatorRun, loadCoordinatorState, readCoordinatorHistory, readBarriers } from '../src/lib/coordinator-state.js';
import { loadCoordinatorConfig } from '../src/lib/coordinator-config.js';
import { dispatchCoordinatorTurn, selectNextAssignment } from '../src/lib/coordinator-dispatch.js';
import { generateCrossRepoContext } from '../src/lib/cross-repo-context.js';
import { getDispatchTurnDir } from '../src/lib/turn-paths.js';

function writeJson(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
}

function writeJsonl(path, entries) {
  writeFileSync(path, entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n');
}

function makeWorkspace() {
  return mkdtempSync(join(tmpdir(), 'axc-multi-dispatch-'));
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

function setRepoState(repoRoot, updater) {
  const statePath = join(repoRoot, '.agentxchain/state.json');
  const current = JSON.parse(readFileSync(statePath, 'utf8'));
  const next = updater(current);
  writeJson(statePath, next);
}

function buildCoordinatorConfig(repoPaths, overrides = {}) {
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
      implementation: {
        entry_workstream: 'delivery',
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

function setupWorkspace(configOverrides = {}) {
  const workspace = makeWorkspace();
  const webRepo = join(workspace, 'repos', 'web');
  const apiRepo = join(workspace, 'repos', 'api');

  writeGovernedRepo(webRepo, 'web');
  writeGovernedRepo(apiRepo, 'api');
  writeJson(
    join(workspace, 'agentxchain-multi.json'),
    buildCoordinatorConfig(
      {
        web: './repos/web',
        api: './repos/api',
      },
      configOverrides,
    ),
  );

  const configResult = loadCoordinatorConfig(workspace);
  assert.equal(configResult.ok, true, configResult.errors?.join('\n'));

  const initResult = initializeCoordinatorRun(workspace, configResult.config);
  assert.equal(initResult.ok, true, initResult.errors?.join('\n'));

  const state = loadCoordinatorState(workspace);
  assert.ok(state, 'coordinator state should exist after init');

  return {
    workspace,
    webRepo,
    apiRepo,
    config: configResult.config,
    state,
  };
}

describe('coordinator dispatch selection', () => {
  it('AT-CD-001: workstream with unsatisfied dependency barrier is not selectable', () => {
    const { workspace, config, state } = setupWorkspace({
      workstreams: {
        web_delivery: {
          phase: 'implementation',
          repos: ['web'],
          entry_repo: 'web',
          depends_on: ['api_contract'],
          completion_barrier: 'all_repos_accepted',
        },
        api_contract: {
          phase: 'planning',
          repos: ['api'],
          entry_repo: 'api',
          depends_on: [],
          completion_barrier: 'all_repos_accepted',
        },
      },
      routing: {
        implementation: {
          entry_workstream: 'web_delivery',
        },
      },
    });

    try {
      const selection = selectNextAssignment(workspace, state, config);
      assert.equal(selection.ok, false);
      assert.equal(selection.reason, 'dependency_pending');
      assert.equal(selection.workstream_id, 'web_delivery');
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('AT-CD-002: workstream with satisfied dependency barrier is selectable', () => {
    const { workspace, config, state } = setupWorkspace({
      workstreams: {
        web_delivery: {
          phase: 'implementation',
          repos: ['web'],
          entry_repo: 'web',
          depends_on: ['api_contract'],
          completion_barrier: 'all_repos_accepted',
        },
        api_contract: {
          phase: 'planning',
          repos: ['api'],
          entry_repo: 'api',
          depends_on: [],
          completion_barrier: 'all_repos_accepted',
        },
      },
      routing: {
        implementation: {
          entry_workstream: 'web_delivery',
        },
      },
    });

    try {
      const barriersPath = join(workspace, '.agentxchain/multirepo/barriers.json');
      const barriers = readBarriers(workspace);
      barriers.api_contract_completion.status = 'satisfied';
      writeJson(barriersPath, barriers);

      const selection = selectNextAssignment(workspace, state, config);
      assert.equal(selection.ok, true);
      assert.equal(selection.workstream_id, 'web_delivery');
      assert.equal(selection.repo_id, 'web');
      assert.equal(selection.role, 'dev');
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('AT-CD-003: assignment to blocked repo is rejected with repo_blocked reason', () => {
    const { workspace, webRepo, config, state } = setupWorkspace();

    try {
      setRepoState(webRepo, (current) => ({
        ...current,
        status: 'blocked',
        blocked_on: 'human:test',
        turn_sequence: current.turn_sequence ?? 0,
      }));

      const selection = selectNextAssignment(workspace, state, config);
      assert.equal(selection.ok, true);
      assert.equal(selection.repo_id, 'api');

      const historyPath = join(workspace, '.agentxchain/multirepo/history.jsonl');
      writeJsonl(historyPath, [
        ...readCoordinatorHistory(workspace),
        {
          type: 'acceptance_projection',
          super_run_id: state.super_run_id,
          projection_ref: 'mproj_api_1',
          workstream_id: 'delivery',
          repo_id: 'api',
          repo_turn_id: 'turn_api_1',
          summary: 'API accepted',
          decisions: ['DEC-API-001'],
          files_changed: ['src/api.js'],
        },
      ]);

      const blockedSelection = selectNextAssignment(workspace, state, config);
      assert.equal(blockedSelection.ok, false);
      assert.equal(blockedSelection.reason, 'repo_blocked');
      assert.equal(blockedSelection.repo_id, 'web');
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('AT-CD-007: independent workstream remains assignable when unrelated workstream is blocked', () => {
    const { workspace, apiRepo, config, state } = setupWorkspace({
      workstreams: {
        blocked_stream: {
          phase: 'implementation',
          repos: ['api'],
          entry_repo: 'api',
          depends_on: [],
          completion_barrier: 'all_repos_accepted',
        },
        docs_stream: {
          phase: 'implementation',
          repos: ['web'],
          entry_repo: 'web',
          depends_on: [],
          completion_barrier: 'all_repos_accepted',
        },
      },
      routing: {
        implementation: {
          entry_workstream: 'blocked_stream',
        },
      },
    });

    try {
      setRepoState(apiRepo, (current) => ({
        ...current,
        status: 'blocked',
        blocked_on: 'human:test',
        turn_sequence: current.turn_sequence ?? 0,
      }));

      const selection = selectNextAssignment(workspace, state, config);
      assert.equal(selection.ok, true);
      assert.equal(selection.workstream_id, 'docs_stream');
      assert.equal(selection.repo_id, 'web');
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('AT-CD-008: entry repo is selected first when a workstream has an entry_repo declaration', () => {
    const { workspace, config, state } = setupWorkspace();

    try {
      const selection = selectNextAssignment(workspace, state, config);
      assert.equal(selection.ok, true);
      assert.equal(selection.repo_id, 'api');
      assert.equal(selection.reason, 'entry_repo');
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('AT-CD-009: ordered_repo_sequence barrier prevents downstream repo assignment before barrier release', () => {
    const { workspace, config, state } = setupWorkspace();

    try {
      const historyPath = join(workspace, '.agentxchain/multirepo/history.jsonl');
      writeJsonl(historyPath, [
        ...readCoordinatorHistory(workspace),
        {
          type: 'acceptance_projection',
          super_run_id: state.super_run_id,
          projection_ref: 'mproj_api_1',
          workstream_id: 'delivery',
          repo_id: 'api',
          repo_turn_id: 'turn_api_1',
          summary: 'API accepted',
          decisions: ['DEC-API-001'],
          files_changed: ['src/api.js'],
        },
      ]);

      const barriers = readBarriers(workspace);
      barriers.delivery_ordered = {
        barrier_id: 'delivery_ordered',
        workstream_id: 'delivery',
        type: 'ordered_repo_sequence',
        status: 'pending',
        downstream_repos: ['web'],
        blocked_assignments: ['web:dev'],
      };
      writeJson(join(workspace, '.agentxchain/multirepo/barriers.json'), barriers);

      const selection = selectNextAssignment(workspace, state, config);
      assert.equal(selection.ok, false);
      assert.equal(selection.reason, 'barrier_blocked');
      assert.equal(selection.repo_id, 'web');
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});

describe('cross-repo context and dispatch', () => {
  it('AT-CD-004 and AT-CD-005: generated coordinator context includes upstream projections, barrier state, and readable markdown', () => {
    const { workspace, config, state } = setupWorkspace();

    try {
      writeJsonl(join(workspace, '.agentxchain/multirepo/history.jsonl'), [
        ...readCoordinatorHistory(workspace),
        {
          type: 'acceptance_projection',
          super_run_id: state.super_run_id,
          projection_ref: 'mproj_api_1',
          workstream_id: 'delivery',
          repo_id: 'api',
          repo_turn_id: 'turn_api_1',
          summary: 'Accepted API contract update',
          decisions: ['DEC-API-001'],
          files_changed: ['src/contracts.ts'],
          verification: { command: 'node --test', exit_code: 0 },
        },
      ]);

      const barriers = readBarriers(workspace);
      barriers.delivery_alignment = {
        barrier_id: 'delivery_alignment',
        workstream_id: 'delivery',
        type: 'interface_alignment',
        status: 'partially_satisfied',
        alignment_decision_ids: {
          web: ['DEC-201'],
        },
        downstream_repos: ['web'],
        notes: 'Update web integration to match the accepted contract.',
      };
      writeJson(join(workspace, '.agentxchain/multirepo/barriers.json'), barriers);

      const result = generateCrossRepoContext(workspace, state, config, 'web', 'delivery');
      assert.equal(result.ok, true);

      const json = JSON.parse(readFileSync(result.jsonPath, 'utf8'));
      const md = readFileSync(result.mdPath, 'utf8');

      assert.equal(json.target_repo_id, 'web');
      assert.equal(json.upstream_acceptances.length, 1);
      assert.equal(json.upstream_acceptances[0].repo_id, 'api');
      assert.equal(json.active_barriers.length, 1);
      assert.equal(json.active_barriers[0].barrier_id, 'delivery_alignment');
      assert.deepEqual(json.active_barriers[0].alignment_decision_ids, { web: ['DEC-201'] });
      assert.ok(json.required_followups.some((item) => item.includes('accepted contract')));
      assert.ok(json.required_followups.some((item) => item.includes('DEC-201')));

      assert.match(md, /Coordinator Context/);
      assert.match(md, /Accepted API contract update/);
      assert.match(md, /delivery_alignment/);
      assert.match(md, /DEC-201/);
      assert.match(md, /Required Follow-ups/);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('dispatchCoordinatorTurn assigns the repo-local turn, writes the bundle, and injects coordinator context artifacts', () => {
    const { workspace, config, state, apiRepo } = setupWorkspace();

    try {
      const assignment = selectNextAssignment(workspace, state, config);
      assert.equal(assignment.ok, true);
      assert.equal(assignment.repo_id, 'api');

      const dispatchResult = dispatchCoordinatorTurn(workspace, state, config, assignment);
      assert.equal(dispatchResult.ok, true, dispatchResult.error);

      const bundleDir = join(apiRepo, getDispatchTurnDir(dispatchResult.turn_id));
      assert.ok(existsSync(join(bundleDir, 'ASSIGNMENT.json')));
      assert.ok(existsSync(join(bundleDir, 'PROMPT.md')));
      assert.ok(existsSync(join(bundleDir, 'CONTEXT.md')));
      assert.ok(existsSync(join(bundleDir, 'COORDINATOR_CONTEXT.json')));
      assert.ok(existsSync(join(bundleDir, 'COORDINATOR_CONTEXT.md')));

      const coordinatorContext = JSON.parse(readFileSync(join(bundleDir, 'COORDINATOR_CONTEXT.json'), 'utf8'));
      assert.equal(coordinatorContext.workstream_id, 'delivery');
      assert.equal(coordinatorContext.target_repo_id, 'api');

      const history = readCoordinatorHistory(workspace);
      const dispatched = history.find((entry) => entry.type === 'turn_dispatched');
      assert.ok(dispatched, 'expected turn_dispatched entry in coordinator history');
      assert.equal(dispatched.repo_id, 'api');
      assert.equal(dispatched.repo_turn_id, dispatchResult.turn_id);
      assert.equal(dispatched.context_ref, dispatchResult.context_ref);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});
