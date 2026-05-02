import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync, appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

import { loadProjectContext } from '../src/lib/config.js';
import { initializeGovernedRun } from '../src/lib/governed-state.js';
import { readCoordinatorTimeoutStatus } from '../src/lib/dashboard/coordinator-timeout-status.js';
import { render } from '../dashboard/components/coordinator-timeouts.js';

const STATUS_SOURCE = readFileSync(new URL('../src/lib/dashboard/coordinator-timeout-status.js', import.meta.url), 'utf8');
const VIEW_SOURCE = readFileSync(new URL('../dashboard/components/coordinator-timeouts.js', import.meta.url), 'utf8');
const SPEC_SOURCE = readFileSync(new URL('../../.planning/COORDINATOR_TIMEOUT_DASHBOARD_SURFACE_SPEC.md', import.meta.url), 'utf8');

function tempDir() {
  const dir = join(tmpdir(), `axc-coord-timeouts-${randomBytes(6).toString('hex')}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeJson(filePath, value) {
  writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n');
}

function writeRepo(root, { projectId, timeouts = null }) {
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
      implementation: {
        entry_role: 'dev',
        allowed_next_roles: ['dev', 'human'],
      },
      qa: {
        entry_role: 'dev',
        allowed_next_roles: ['dev', 'human'],
      },
    },
    gates: {},
    ...(timeouts ? { timeouts } : {}),
  });

  writeJson(join(root, '.agentxchain', 'state.json'), {
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

  const context = loadProjectContext(root);
  const initResult = initializeGovernedRun(root, context.config);
  assert.equal(initResult.ok, true, `repo ${projectId} must initialize`);
  return initResult.state;
}

describe('Coordinator Timeouts — readCoordinatorTimeoutStatus', () => {
  it('AT-CDTRS-001: aggregates timeout state while preserving authority-first repo status and coordinator drift metadata', () => {
    const workspace = tempDir();
    try {
      const apiRoot = join(workspace, 'repos', 'api');
      const webRoot = join(workspace, 'repos', 'web');
      const apiState = writeRepo(apiRoot, {
        projectId: 'api',
        timeouts: {
          per_turn_minutes: 30,
          per_phase_minutes: 60,
          action: 'warn',
        },
      });
      writeRepo(webRoot, { projectId: 'web' });

      writeJson(join(workspace, 'agentxchain-multi.json'), {
        schema_version: '0.1',
        project: { id: 'suite', name: 'Suite' },
        repos: {
          api: { path: './repos/api', default_branch: 'main', required: true },
          web: { path: './repos/web', default_branch: 'main', required: true },
        },
        workstreams: {
          implementation_build: {
            phase: 'implementation',
            repos: ['api', 'web'],
            entry_repo: 'api',
            depends_on: [],
            completion_barrier: 'all_repos_accepted',
          },
          qa_release: {
            phase: 'qa',
            repos: ['api', 'web'],
            entry_repo: 'web',
            depends_on: ['implementation_build'],
            completion_barrier: 'all_repos_accepted',
          },
        },
        routing: {
          implementation: { entry_workstream: 'implementation_build' },
          qa: { entry_workstream: 'qa_release' },
        },
        gates: {},
      });

      mkdirSync(join(workspace, '.agentxchain', 'multirepo'), { recursive: true });
      writeJson(join(workspace, '.agentxchain', 'multirepo', 'state.json'), {
        super_run_id: 'srun_test_001',
        status: 'active',
        phase: 'implementation',
        repo_runs: {
          api: { run_id: 'run_api_expected', status: 'linked', phase: 'implementation' },
          web: { run_id: 'run_web_001', status: 'linked', phase: 'implementation' },
        },
      });

      const apiStatePath = join(apiRoot, '.agentxchain', 'state.json');
      const mutatedApiState = JSON.parse(readFileSync(apiStatePath, 'utf8'));
      mutatedApiState.created_at = '2026-04-11T00:00:00Z';
      mutatedApiState.phase_entered_at = '2026-04-11T00:00:00Z';
      mutatedApiState.turn_sequence = 1;
      mutatedApiState.active_turns = {
        turn_api_001: {
          turn_id: 'turn_api_001',
          assigned_role: 'dev',
          status: 'active',
          runtime_id: 'local-dev',
          attempt: 1,
          assigned_sequence: 1,
          assigned_at: '2026-04-11T00:10:00Z',
          started_at: '2026-04-11T00:10:00Z',
        },
      };
      writeJson(apiStatePath, mutatedApiState);

      appendFileSync(
        join(apiRoot, '.agentxchain', 'decision-ledger.jsonl'),
        JSON.stringify({
          type: 'timeout_warning',
          scope: 'phase',
          phase: 'implementation',
          turn_id: 'turn_api_001',
          limit_minutes: 60,
          elapsed_minutes: 75,
          exceeded_by_minutes: 15,
          action: 'warn',
          timestamp: '2026-04-11T01:00:00Z',
        }) + '\n',
      );
      appendFileSync(
        join(workspace, '.agentxchain', 'multirepo', 'decision-ledger.jsonl'),
        JSON.stringify({
          type: 'timeout',
          scope: 'run',
          limit_minutes: 180,
          elapsed_minutes: 220,
          exceeded_by_minutes: 40,
          action: 'escalate',
          timestamp: '2026-04-11T02:00:00Z',
        }) + '\n',
      );

      const result = readCoordinatorTimeoutStatus(workspace);
      assert.equal(result.ok, true);
      assert.equal(result.status, 200);
      assert.equal(result.body.summary.repo_count, 2);
      assert.equal(result.body.summary.configured_repo_count, 1);
      assert.equal(result.body.summary.coordinator_event_count, 1);
      assert.equal(result.body.summary.repo_event_count, 1);
      assert.equal(result.body.repos[0].repo_id, 'api');
      assert.equal(result.body.repos[0].run_id, apiState.run_id);
      assert.equal(result.body.repos[0].status, 'active');
      assert.equal(result.body.repos[0].configured, true);
      assert.deepEqual(result.body.repos[0].details, [
        { label: 'coordinator', value: 'linked' },
        { label: 'expected run', value: 'run_api_expected', mono: true },
      ]);
      assert.ok(result.body.repos[0].live.warnings.length > 0);
      const turnWarning = result.body.repos[0].live.warnings.find((item) => item.scope === 'turn');
      assert.ok(turnWarning, 'repo snapshot must include turn-scoped live pressure');
      assert.equal(turnWarning.turn_id, 'turn_api_001');
      assert.equal(turnWarning.role_id, 'dev');
      assert.equal(result.body.repos[1].configured, false);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('renders repo-card error when a governed child repo state is missing', () => {
    const workspace = tempDir();
    try {
      const apiRoot = join(workspace, 'repos', 'api');
      writeRepo(apiRoot, {
        projectId: 'api',
        timeouts: {
          per_phase_minutes: 60,
          action: 'warn',
        },
      });

      writeJson(join(workspace, 'agentxchain-multi.json'), {
        schema_version: '0.1',
        project: { id: 'suite', name: 'Suite' },
        repos: {
          api: { path: './repos/api', default_branch: 'main', required: true },
        },
        workstreams: {
          implementation_build: {
            phase: 'implementation',
            repos: ['api'],
            entry_repo: 'api',
            depends_on: [],
            completion_barrier: 'all_repos_accepted',
          },
          qa_release: {
            phase: 'qa',
            repos: ['api'],
            entry_repo: 'api',
            depends_on: ['implementation_build'],
            completion_barrier: 'all_repos_accepted',
          },
        },
        routing: {
          implementation: { entry_workstream: 'implementation_build' },
          qa: { entry_workstream: 'qa_release' },
        },
        gates: {},
      });

      mkdirSync(join(workspace, '.agentxchain', 'multirepo'), { recursive: true });
      writeJson(join(workspace, '.agentxchain', 'multirepo', 'state.json'), {
        super_run_id: 'srun_test_002',
        status: 'blocked',
        phase: 'implementation',
        blocked_reason: 'timeout',
        repo_runs: {
          api: { run_id: 'run_api_002', status: 'linked', phase: 'implementation' },
        },
      });

      rmSync(join(apiRoot, '.agentxchain', 'state.json'));

      const result = readCoordinatorTimeoutStatus(workspace);
      assert.equal(result.ok, true);
      assert.equal(result.body.repos[0].error.code, 'repo_state_missing');
      assert.equal(result.body.repos[0].configured, true);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});

describe('Coordinator Timeouts View — render', () => {
  it('renders placeholder when data is null', () => {
    const html = render({ coordinatorTimeouts: null });
    assert.ok(html.includes('Coordinator Timeouts'));
    assert.ok(html.includes('No coordinator timeout data available'));
  });

  it('AT-CDTRS-002: renders authority-first repo status plus coordinator linkage/drift metadata on timeout cards', () => {
    const html = render({
      coordinatorTimeouts: {
        ok: true,
        super_run_id: 'srun_test_003',
        status: 'active',
        phase: 'implementation',
        blocked_reason: null,
        summary: {
          repo_count: 2,
          configured_repo_count: 1,
          repos_with_live_exceeded: 0,
          repos_with_live_warnings: 1,
          repo_event_count: 1,
          coordinator_event_count: 1,
        },
        coordinator_events: [
          {
            type: 'timeout',
            scope: 'run',
            phase: null,
            turn_id: null,
            limit_minutes: 180,
            elapsed_minutes: 220,
            exceeded_by_minutes: 40,
            action: 'escalate',
          },
        ],
        repos: [
          {
            repo_id: 'api',
            path: './repos/api',
            run_id: 'run_api_live',
            status: 'completed',
            phase: 'release',
            details: [
              { label: 'coordinator', value: 'linked' },
              { label: 'expected run', value: 'run_api_expected', mono: true },
            ],
            configured: true,
            config: {
              per_phase_minutes: 60,
              per_turn_minutes: null,
              per_run_minutes: null,
              action: 'warn',
              phase_overrides: [],
            },
            live: {
              exceeded: [],
              warnings: [
                {
                  scope: 'turn',
                  phase: 'implementation',
                  turn_id: 'turn_api_003',
                  role_id: 'dev',
                  limit_minutes: 30,
                  elapsed_minutes: 75,
                  exceeded_by_minutes: 45,
                  action: 'warn',
                },
              ],
            },
            events: [],
            error: null,
          },
          {
            repo_id: 'web',
            path: './repos/web',
            run_id: 'run_web_003',
            status: 'active',
            phase: 'implementation',
            details: [
              { label: 'coordinator', value: 'initialized' },
            ],
            configured: false,
            config: null,
            live: null,
            events: [],
            error: null,
          },
        ],
      },
    });

    assert.ok(html.includes('srun_test_003'));
    assert.ok(html.includes('Coordinator Events'));
    assert.ok(html.includes('Repo Timeout Status'));
    assert.ok(html.includes('run_api_live'));
    assert.ok(html.includes('completed'));
    assert.ok(html.includes('release'));
    assert.ok(html.includes('coordinator'));
    assert.ok(html.includes('run_api_expected'));
    assert.ok(html.includes('turn_api_003'));
    assert.ok(html.includes('(dev)'));
    assert.ok(html.includes('No <code>timeouts</code> configured in this repo.'));
    assert.ok(html.includes('WARNING'));
    assert.ok(!html.includes('<dt>Phase</dt><dd>implementation</dd><dt>coordinator</dt><dd>linked</dd>'));
  });

  it('renders repo error state', () => {
    const html = render({
      coordinatorTimeouts: {
        ok: true,
        super_run_id: 'srun_test_004',
        status: 'blocked',
        phase: 'implementation',
        blocked_reason: 'timeout',
        summary: {
          repo_count: 1,
          configured_repo_count: 1,
          repos_with_live_exceeded: 0,
          repos_with_live_warnings: 0,
          repo_event_count: 0,
          coordinator_event_count: 0,
        },
        coordinator_events: [],
        repos: [
          {
            repo_id: 'api',
            path: './repos/api',
            run_id: 'run_api_004',
            status: 'linked',
            phase: 'implementation',
            configured: true,
            config: null,
            live: { exceeded: [], warnings: [] },
            events: [],
            error: {
              code: 'repo_state_missing',
              error: 'Repo "api" governed state is missing.',
            },
          },
        ],
      },
    });

    assert.ok(html.includes('BLOCKED'));
    assert.ok(html.includes('Repo &quot;api&quot; governed state is missing.'));
  });
});

describe('Coordinator Timeouts Dashboard — wiring', () => {
  it('app.js includes coordinator-timeouts view and API mapping', () => {
    const appContent = readFileSync(join(import.meta.dirname, '..', 'dashboard', 'app.js'), 'utf8');
    assert.ok(appContent.includes("'coordinator-timeouts': {"), 'VIEWS must include coordinator-timeouts');
    assert.ok(appContent.includes("fetch: ['coordinatorTimeouts']"), 'coordinator-timeouts view must fetch coordinatorTimeouts');
    assert.ok(appContent.includes("coordinatorTimeouts: '/api/coordinator/timeouts'"), 'API_MAP must include coordinator timeouts');
  });

  it('index.html nav includes Coordinator Timeouts link', () => {
    const htmlContent = readFileSync(join(import.meta.dirname, '..', 'dashboard', 'index.html'), 'utf8');
    assert.ok(htmlContent.includes('href="#coordinator-timeouts"'));
    assert.ok(htmlContent.includes('>Coordinator Timeouts<'));
  });

  it('bridge server routes /api/coordinator/timeouts', () => {
    const serverContent = readFileSync(join(import.meta.dirname, '..', 'src', 'lib', 'dashboard', 'bridge-server.js'), 'utf8');
    assert.ok(serverContent.includes("import { readCoordinatorTimeoutStatus }"), 'bridge-server must import readCoordinatorTimeoutStatus');
    assert.ok(serverContent.includes("'/api/coordinator/timeouts'"), 'bridge-server must route /api/coordinator/timeouts');
  });

  it('AT-CDTRS-003: source guards keep coordinator timeout snapshots on the shared repo-status presenter', () => {
    assert.match(STATUS_SOURCE, /buildCoordinatorRepoStatusRows/);
    assert.doesNotMatch(STATUS_SOURCE, /status:\s*state\.status\s*\?\?\s*repoRun\?\.status/);
    assert.doesNotMatch(STATUS_SOURCE, /phase:\s*state\.phase\s*\?\?\s*repoRun\?\.phase/);
    assert.match(VIEW_SOURCE, /renderDetailRows\(repo\.details\)/);
  });

  it('AT-CDTRS-004: coordinator timeout spec tracks the shipped dashboard shell without stale ordinal claims', () => {
    assert.match(SPEC_SOURCE, /Dashboard nav item: `Coordinator Timeouts`/);
    assert.match(SPEC_SOURCE, /without relying on a stale ordinal count/);
    assert.doesNotMatch(SPEC_SOURCE, /12th nav item|12th view/);
  });
});
