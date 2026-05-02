import { strict as assert } from 'node:assert';
import { describe, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(__dirname, '..', 'bin', 'agentxchain.js');
const MULTI_SOURCE = readFileSync(join(__dirname, '..', 'src', 'commands', 'multi.js'), 'utf8');
const MULTI_STEP_SOURCE = (() => {
  const start = MULTI_SOURCE.indexOf('export async function multiStepCommand');
  const end = MULTI_SOURCE.indexOf('function maybeRequestCoordinatorGate', start);
  return start >= 0 && end > start ? MULTI_SOURCE.slice(start, end) : '';
})();
const MULTI_RESYNC_SOURCE = (() => {
  const start = MULTI_SOURCE.indexOf('export async function multiResyncCommand');
  const end = MULTI_SOURCE.indexOf('// ── Hook helpers', start);
  return start >= 0 && end > start ? MULTI_SOURCE.slice(start, end) : '';
})();

function writeJson(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
}

function writeCoordinatorRecoveryReport(workspace) {
  writeFileSync(
    join(workspace, '.agentxchain', 'multirepo', 'RECOVERY_REPORT.md'),
    [
      '# Recovery Report',
      '',
      '## Trigger',
      'Coordinator block reproduced and understood.',
      '',
      '## Impact',
      'No child repo state changed during recovery.',
      '',
      '## Mitigation',
      'Root cause addressed before running multi resume.',
      '',
    ].join('\n'),
  );
}

function writeGovernedRepo(root, projectId, options = {}) {
  const routing = options.routing || {
    implementation: {
      entry_role: 'dev',
      allowed_next_roles: ['qa', 'human'],
    },
  };

  mkdirSync(root, { recursive: true });
  mkdirSync(join(root, '.agentxchain', 'prompts'), { recursive: true });
  mkdirSync(join(root, '.agentxchain', 'staging'), { recursive: true });
  // Write an idle state so coordinator can initialize a run
  writeJson(join(root, '.agentxchain', 'state.json'), {
    schema_version: '1.1',
    status: 'idle',
    run_id: null,
    phase: null,
    active_turns: {},
    retained_turns: {},
    protocol_mode: 'governed',
  });
  writeJson(join(root, 'agentxchain.json'), {
    schema_version: '1.0',
    template: 'generic',
    project: { id: projectId, name: projectId, default_branch: 'main' },
    roles: {
      pm: {
        title: 'PM',
        mandate: 'Plan safely.',
        write_authority: 'authoritative',
        runtime: 'manual-pm',
      },
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
      'manual-pm': { type: 'manual' },
      'local-dev': {
        type: 'local_cli',
        command: ['echo', '{prompt}'],
        prompt_transport: 'argv',
      },
      'manual-qa': { type: 'manual' },
    },
    routing,
    gates: {},
  });
}

function buildCoordinatorConfig(repoPaths) {
  return {
    schema_version: '0.1',
    project: {
      id: 'test-multi',
      name: 'Test Multi Repo',
    },
    repos: {
      web: { path: repoPaths.web, default_branch: 'main', required: true },
      api: { path: repoPaths.api, default_branch: 'main', required: true },
    },
    workstreams: {
      auth_rollout: {
        phase: 'implementation',
        repos: ['api', 'web'],
        entry_repo: 'api',
        depends_on: [],
        completion_barrier: 'all_repos_accepted',
      },
    },
    routing: {
      implementation: { entry_workstream: 'auth_rollout' },
    },
    gates: {
      initiative_ship: {
        requires_human_approval: true,
        requires_repos: ['web', 'api'],
      },
    },
  };
}

function buildPlanningImplementationCoordinatorConfig(repoPaths) {
  return {
    schema_version: '0.1',
    project: {
      id: 'test-multi',
      name: 'Test Multi Repo',
    },
    repos: {
      web: { path: repoPaths.web, default_branch: 'main', required: true },
      api: { path: repoPaths.api, default_branch: 'main', required: true },
    },
    workstreams: {
      planning_sync: {
        phase: 'planning',
        repos: ['api', 'web'],
        entry_repo: 'api',
        depends_on: [],
        completion_barrier: 'all_repos_accepted',
      },
      implementation_sync: {
        phase: 'implementation',
        repos: ['api', 'web'],
        entry_repo: 'api',
        depends_on: ['planning_sync'],
        completion_barrier: 'all_repos_accepted',
      },
    },
    routing: {
      planning: { entry_workstream: 'planning_sync' },
      implementation: { entry_workstream: 'implementation_sync' },
    },
    gates: {
      initiative_ship: {
        requires_human_approval: true,
        requires_repos: ['web', 'api'],
      },
    },
  };
}

function buildCoordinatorConfigWithBlockingGateHook(repoPaths) {
  const config = buildPlanningImplementationCoordinatorConfig(repoPaths);
  config.hooks = {
    before_gate: [
      {
        name: 'release-guard',
        type: 'process',
        command: ['./hooks/block-gate.sh'],
        timeout_ms: 5000,
        mode: 'blocking',
      },
    ],
  };
  return config;
}

function runCli(cwd, args) {
  return spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 15000,
    env: { ...process.env, NODE_NO_WARNINGS: '1' },
  });
}

function makeMultiWorkspace() {
  const workspace = mkdtempSync(join(tmpdir(), 'axc-multi-cli-'));
  const webRepo = join(workspace, 'repos', 'web');
  const apiRepo = join(workspace, 'repos', 'api');
  writeGovernedRepo(webRepo, 'web');
  writeGovernedRepo(apiRepo, 'api');
  writeJson(
    join(workspace, 'agentxchain-multi.json'),
    buildCoordinatorConfig({ web: './repos/web', api: './repos/api' }),
  );
  return { workspace, webRepo, apiRepo };
}

function makePlanningImplementationMultiWorkspace() {
  const workspace = mkdtempSync(join(tmpdir(), 'axc-multi-cli-'));
  const webRepo = join(workspace, 'repos', 'web');
  const apiRepo = join(workspace, 'repos', 'api');
  writeGovernedRepo(webRepo, 'web', {
    routing: {
      planning: {
        entry_role: 'pm',
        allowed_next_roles: ['dev', 'human'],
      },
      implementation: {
        entry_role: 'dev',
        allowed_next_roles: ['qa', 'human'],
      },
    },
  });
  writeGovernedRepo(apiRepo, 'api', {
    routing: {
      planning: {
        entry_role: 'pm',
        allowed_next_roles: ['dev', 'human'],
      },
      implementation: {
        entry_role: 'dev',
        allowed_next_roles: ['qa', 'human'],
      },
    },
  });
  writeJson(
    join(workspace, 'agentxchain-multi.json'),
    buildPlanningImplementationCoordinatorConfig({ web: './repos/web', api: './repos/api' }),
  );
  return { workspace, webRepo, apiRepo };
}

describe('multi init CLI', () => {
  it('AT-CLI-MR-001: multi init bootstraps a coordinator run', () => {
    const { workspace } = makeMultiWorkspace();
    try {
      const result = runCli(workspace, ['multi', 'init']);
      assert.equal(result.status, 0, `stderr: ${result.stderr}`);
      assert.ok(result.stdout.includes('Coordinator run initialized'), result.stdout);

      // Verify state files exist
      assert.ok(existsSync(join(workspace, '.agentxchain/multirepo/state.json')));
      assert.ok(existsSync(join(workspace, '.agentxchain/multirepo/history.jsonl')));
      assert.ok(existsSync(join(workspace, '.agentxchain/multirepo/barriers.json')));
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('AT-CLI-MR-002: multi init --json returns structured output', () => {
    const { workspace } = makeMultiWorkspace();
    try {
      const result = runCli(workspace, ['multi', 'init', '--json']);
      assert.equal(result.status, 0, `stderr: ${result.stderr}`);
      const parsed = JSON.parse(result.stdout);
      assert.ok(parsed.super_run_id);
      assert.ok(parsed.repo_runs.web);
      assert.ok(parsed.repo_runs.api);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('AT-CLI-MR-003: multi init fails without agentxchain-multi.json', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'axc-multi-cli-'));
    try {
      const result = runCli(workspace, ['multi', 'init']);
      assert.notEqual(result.status, 0);
      assert.ok(result.stderr.includes('config') || result.stderr.includes('error'), result.stderr);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('AT-CPA-004: multi init fails fast on coordinator-child phase mismatch', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'axc-multi-cli-'));
    const webRepo = join(workspace, 'repos', 'web');
    const apiRepo = join(workspace, 'repos', 'api');

    try {
      writeGovernedRepo(webRepo, 'web', {
        routing: {
          planning: { entry_role: 'pm', allowed_next_roles: ['dev', 'human'] },
          implementation: { entry_role: 'dev', allowed_next_roles: ['qa', 'human'] },
          qa: { entry_role: 'qa', allowed_next_roles: ['human'] },
        },
      });
      writeGovernedRepo(apiRepo, 'api', {
        routing: {
          planning: { entry_role: 'pm', allowed_next_roles: ['dev', 'human'] },
          implementation: { entry_role: 'dev', allowed_next_roles: ['qa', 'human'] },
          qa: { entry_role: 'qa', allowed_next_roles: ['human'] },
        },
      });
      writeJson(
        join(workspace, 'agentxchain-multi.json'),
        buildPlanningImplementationCoordinatorConfig({ web: './repos/web', api: './repos/api' }),
      );

      const result = runCli(workspace, ['multi', 'init']);
      assert.notEqual(result.status, 0);
      assert.ok(result.stderr.includes('repo_phase_alignment_invalid'), result.stderr);
      assert.ok(result.stderr.includes('[planning, implementation, qa]'), result.stderr);
      assert.ok(result.stderr.includes('[planning, implementation]'), result.stderr);
      assert.equal(existsSync(join(workspace, '.agentxchain/multirepo/state.json')), false);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});

describe('multi status CLI', () => {
  it('AT-CLI-MR-004: multi status shows coordinator state after init', () => {
    const { workspace } = makeMultiWorkspace();
    try {
      runCli(workspace, ['multi', 'init']);
      const result = runCli(workspace, ['multi', 'status']);
      assert.equal(result.status, 0, `stderr: ${result.stderr}`);
      assert.ok(result.stdout.includes('Super Run:'), result.stdout);
      assert.ok(result.stdout.includes('web:'), result.stdout);
      assert.ok(result.stdout.includes('api:'), result.stdout);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('AT-CLI-MR-005: multi status --json returns full snapshot', () => {
    const { workspace } = makeMultiWorkspace();
    try {
      runCli(workspace, ['multi', 'init']);
      const result = runCli(workspace, ['multi', 'status', '--json']);
      assert.equal(result.status, 0, `stderr: ${result.stderr}`);
      const parsed = JSON.parse(result.stdout);
      assert.ok(parsed.super_run_id);
      assert.ok(parsed.repo_runs);
      assert.ok(parsed.barriers);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('AT-CLI-MR-012: multi status renders ordered shared next_actions for blocked pending gates', () => {
    const { workspace } = makeMultiWorkspace();
    try {
      const init = runCli(workspace, ['multi', 'init']);
      assert.equal(init.status, 0, `stderr: ${init.stderr}`);

      const statePath = join(workspace, '.agentxchain', 'multirepo', 'state.json');
      const state = JSON.parse(readFileSync(statePath, 'utf8'));
      state.status = 'blocked';
      state.blocked_reason = 'hook violation';
      state.pending_gate = {
        gate: 'phase_transition:implementation->qa',
        gate_type: 'phase_transition',
        from: 'implementation',
        to: 'qa',
        required_repos: ['api', 'web'],
      };
      writeJson(statePath, state);

      const result = runCli(workspace, ['multi', 'status']);
      assert.equal(result.status, 0, `stderr: ${result.stderr}`);
      assert.match(result.stdout, /Next Actions:/);
      const resumeIndex = result.stdout.indexOf('agentxchain multi resume');
      const approveIndex = result.stdout.indexOf('agentxchain multi approve-gate');
      assert.ok(resumeIndex >= 0, result.stdout);
      assert.ok(approveIndex >= 0, result.stdout);
      assert.ok(resumeIndex < approveIndex, 'multi status must preserve shared next-action ordering');
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('AT-CLI-MR-013: multi status --json includes next_actions', () => {
    const { workspace } = makeMultiWorkspace();
    try {
      const init = runCli(workspace, ['multi', 'init']);
      assert.equal(init.status, 0, `stderr: ${init.stderr}`);

      const statePath = join(workspace, '.agentxchain', 'multirepo', 'state.json');
      const state = JSON.parse(readFileSync(statePath, 'utf8'));
      state.pending_gate = {
        gate: 'initiative_ship',
        gate_type: 'run_completion',
        required_repos: ['api', 'web'],
      };
      state.status = 'paused';
      writeJson(statePath, state);

      const result = runCli(workspace, ['multi', 'status', '--json']);
      assert.equal(result.status, 0, `stderr: ${result.stderr}`);
      const parsed = JSON.parse(result.stdout);
      assert.equal(parsed.next_actions?.[0]?.command, 'agentxchain multi approve-gate');
      assert.match(parsed.next_actions?.[0]?.reason || '', /pending gate/i);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('AT-CLI-MR-018: multi status renders canonical pending-gate detail rows', () => {
    const { workspace } = makeMultiWorkspace();
    try {
      const init = runCli(workspace, ['multi', 'init']);
      assert.equal(init.status, 0, `stderr: ${init.stderr}`);

      const statePath = join(workspace, '.agentxchain', 'multirepo', 'state.json');
      const state = JSON.parse(readFileSync(statePath, 'utf8'));
      state.pending_gate = {
        gate: 'phase_transition:implementation->qa',
        gate_type: 'phase_transition',
        from: 'implementation',
        to: 'qa',
        required_repos: ['api', 'web'],
        human_barriers: ['PM_SIGNOFF.md'],
      };
      state.status = 'paused';
      writeJson(statePath, state);

      const result = runCli(workspace, ['multi', 'status']);
      assert.equal(result.status, 0, `stderr: ${result.stderr}`);
      assert.match(result.stdout, /Pending Gate:/);
      assert.match(result.stdout, /Type: phase_transition/);
      assert.match(result.stdout, /Gate: phase_transition:implementation->qa/);
      assert.match(result.stdout, /Current Phase: implementation/);
      assert.match(result.stdout, /Target Phase: qa/);
      assert.match(result.stdout, /Required Repos: api, web/);
      assert.match(result.stdout, /Approval State: Awaiting human approval/);
      assert.match(result.stdout, /Human Barriers: PM_SIGNOFF\.md/);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('AT-CLI-MR-033: multi status renders repo-authority status and keeps coordinator provenance as metadata', () => {
    const { workspace } = makeMultiWorkspace();
    try {
      const init = runCli(workspace, ['multi', 'init']);
      assert.equal(init.status, 0, `stderr: ${init.stderr}`);

      const result = runCli(workspace, ['multi', 'status']);
      assert.equal(result.status, 0, `stderr: ${result.stderr}`);
      assert.match(result.stdout, /api: active \[implementation\] \(run: run_[^;]+; coordinator: initialized\)/);
      assert.match(result.stdout, /web: active \[implementation\] \(run: run_[^;]+; coordinator: initialized\)/);
      assert.doesNotMatch(result.stdout, /api: initialized \[/);
      assert.doesNotMatch(result.stdout, /web: initialized \[/);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('AT-CLI-MR-034: multi status repo rows show actual repo run and expected coordinator run during drift', () => {
    const { workspace, apiRepo } = makeMultiWorkspace();
    try {
      const init = runCli(workspace, ['multi', 'init']);
      assert.equal(init.status, 0, `stderr: ${init.stderr}`);

      const apiStatePath = join(apiRepo, '.agentxchain', 'state.json');
      const apiState = JSON.parse(readFileSync(apiStatePath, 'utf8'));
      const coordinatorState = JSON.parse(readFileSync(join(workspace, '.agentxchain', 'multirepo', 'state.json'), 'utf8'));
      const expectedRunId = coordinatorState.repo_runs.api.run_id;
      apiState.run_id = 'run_api_reinitialized';
      writeJson(apiStatePath, apiState);

      const result = runCli(workspace, ['multi', 'status']);
      assert.equal(result.status, 0, `stderr: ${result.stderr}`);
      assert.match(
        result.stdout,
        new RegExp(`api: active \\[implementation\\] \\(run: run_api_reinitialized; coordinator: initialized; expected run: ${expectedRunId}\\)`),
      );
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('AT-CLI-MR-006: multi status fails without init', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'axc-multi-cli-'));
    try {
      const result = runCli(workspace, ['multi', 'status']);
      assert.notEqual(result.status, 0);
      assert.ok(result.stderr.includes('No coordinator state'), result.stderr);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});

describe('multi resync CLI', () => {
  it('AT-CLI-MR-007: multi resync --dry-run reports no divergence', () => {
    const { workspace } = makeMultiWorkspace();
    try {
      runCli(workspace, ['multi', 'init']);
      const result = runCli(workspace, ['multi', 'resync', '--dry-run']);
      assert.equal(result.status, 0, `stderr: ${result.stderr}`);
      // No divergence right after init
      assert.ok(
        result.stdout.includes('No divergence') || result.stdout.includes('"diverged": false'),
        result.stdout,
      );
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('AT-CLI-MR-007b: multi step fails closed when a child repo run identity drifts', () => {
    const { workspace, apiRepo } = makeMultiWorkspace();
    try {
      const init = runCli(workspace, ['multi', 'init']);
      assert.equal(init.status, 0, `stderr: ${init.stderr}`);

      const apiStatePath = join(apiRepo, '.agentxchain', 'state.json');
      const apiState = JSON.parse(readFileSync(apiStatePath, 'utf8'));
      apiState.run_id = 'run_api_reinitialized';
      writeJson(apiStatePath, apiState);

      const result = runCli(workspace, ['multi', 'step']);
      assert.notEqual(result.status, 0, 'multi step must fail on child run identity drift');
      assert.ok(result.stderr.includes('Coordinator resync entered blocked state'), result.stderr);
      assert.ok(result.stderr.includes('run identity drifted'), result.stderr);

      const coordinatorState = JSON.parse(
        readFileSync(join(workspace, '.agentxchain', 'multirepo', 'state.json'), 'utf8'),
      );
      assert.equal(coordinatorState.status, 'blocked');
      assert.equal(
        existsSync(join(workspace, '.agentxchain', 'multirepo', 'RECOVERY_REPORT.md')),
        true,
        'identity drift must scaffold recovery instructions',
      );
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('AT-CLI-MR-008: multi resync --json --dry-run returns structured output', () => {
    const { workspace } = makeMultiWorkspace();
    try {
      runCli(workspace, ['multi', 'init']);
      const result = runCli(workspace, ['multi', 'resync', '--json', '--dry-run']);
      assert.equal(result.status, 0, `stderr: ${result.stderr}`);
      const parsed = JSON.parse(result.stdout);
      assert.equal(parsed.diverged, false);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('AT-CLI-MR-026: multi resync --dry-run prints canonical run-identity mismatch detail rows', () => {
    const { workspace, apiRepo } = makeMultiWorkspace();
    try {
      const init = runCli(workspace, ['multi', 'init']);
      assert.equal(init.status, 0, `stderr: ${init.stderr}`);

      const apiStatePath = join(apiRepo, '.agentxchain', 'state.json');
      const apiState = JSON.parse(readFileSync(apiStatePath, 'utf8'));
      apiState.run_id = 'run_api_reinitialized';
      writeJson(apiStatePath, apiState);

      const result = runCli(workspace, ['multi', 'resync', '--dry-run']);
      assert.equal(result.status, 0, `stderr: ${result.stderr}`);
      assert.ok(result.stdout.includes('[repo_run_id_mismatch]'), result.stdout);
      assert.ok(result.stdout.includes('Repo: api'), result.stdout);
      assert.ok(result.stdout.includes('Expected: run_'), result.stdout);
      assert.ok(result.stdout.includes('Actual: run_api_reinitialized'), result.stdout);
      assert.ok(result.stdout.includes('Run without --dry-run to resync.'), result.stdout);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('AT-CLI-MR-027: blocked multi resync prints shared mismatch details and ordered next actions', () => {
    const { workspace, apiRepo } = makeMultiWorkspace();
    try {
      const init = runCli(workspace, ['multi', 'init']);
      assert.equal(init.status, 0, `stderr: ${init.stderr}`);

      const apiStatePath = join(apiRepo, '.agentxchain', 'state.json');
      const apiState = JSON.parse(readFileSync(apiStatePath, 'utf8'));
      apiState.run_id = 'run_api_reinitialized';
      writeJson(apiStatePath, apiState);

      const result = runCli(workspace, ['multi', 'resync']);
      assert.notEqual(result.status, 0, 'run-identity drift must block resync');
      assert.ok(result.stderr.includes('Coordinator resync entered blocked state'), result.stderr);
      assert.ok(result.stderr.includes('Repo: api'), result.stderr);
      assert.ok(result.stderr.includes('Expected: run_'), result.stderr);
      assert.ok(result.stderr.includes('Actual: run_api_reinitialized'), result.stderr);
      assert.match(result.stderr, /Next Actions:/);
      assert.match(result.stderr, /agentxchain multi resume/);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('AT-CLI-MR-028: successful multi resync prints pending-gate details and ordered next actions', () => {
    const { workspace, webRepo } = makeMultiWorkspace();
    try {
      const init = runCli(workspace, ['multi', 'init']);
      assert.equal(init.status, 0, `stderr: ${init.stderr}`);

      const coordinatorStatePath = join(workspace, '.agentxchain', 'multirepo', 'state.json');
      const coordinatorState = JSON.parse(readFileSync(coordinatorStatePath, 'utf8'));
      coordinatorState.status = 'paused';
      coordinatorState.pending_gate = {
        gate: 'phase_transition:implementation->qa',
        gate_type: 'phase_transition',
        from: 'implementation',
        to: 'qa',
        required_repos: ['api', 'web'],
      };
      writeJson(coordinatorStatePath, coordinatorState);

      const webStatePath = join(webRepo, '.agentxchain', 'state.json');
      const webState = JSON.parse(readFileSync(webStatePath, 'utf8'));
      webState.status = 'completed';
      writeJson(webStatePath, webState);

      const result = runCli(workspace, ['multi', 'resync']);
      assert.equal(result.status, 0, `stderr: ${result.stderr}`);
      assert.ok(result.stdout.includes('Resync complete.'), result.stdout);
      assert.ok(result.stdout.includes('Repos resynced: web'), result.stdout);
      assert.ok(result.stdout.includes('Pending Gate:'), result.stdout);
      assert.ok(result.stdout.includes('Approval State: Awaiting human approval'), result.stdout);
      assert.match(result.stdout, /Next Actions:/);
      assert.match(result.stdout, /agentxchain multi approve-gate/);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('AT-CLI-MR-029: successful multi resync --json returns post-resync handoff fields', () => {
    const { workspace, webRepo } = makeMultiWorkspace();
    try {
      const init = runCli(workspace, ['multi', 'init']);
      assert.equal(init.status, 0, `stderr: ${init.stderr}`);

      const coordinatorStatePath = join(workspace, '.agentxchain', 'multirepo', 'state.json');
      const coordinatorState = JSON.parse(readFileSync(coordinatorStatePath, 'utf8'));
      coordinatorState.status = 'paused';
      coordinatorState.pending_gate = {
        gate: 'phase_transition:implementation->qa',
        gate_type: 'phase_transition',
        from: 'implementation',
        to: 'qa',
        required_repos: ['api', 'web'],
      };
      writeJson(coordinatorStatePath, coordinatorState);

      const webStatePath = join(webRepo, '.agentxchain', 'state.json');
      const webState = JSON.parse(readFileSync(webStatePath, 'utf8'));
      webState.status = 'completed';
      writeJson(webStatePath, webState);

      const result = runCli(workspace, ['multi', 'resync', '--json']);
      assert.equal(result.status, 0, `stderr: ${result.stderr}`);
      const parsed = JSON.parse(result.stdout);
      assert.equal(parsed.ok, true);
      assert.equal(parsed.status, 'paused');
      assert.equal(parsed.pending_gate?.gate, 'phase_transition:implementation->qa');
      assert.equal(parsed.next_action, 'agentxchain multi approve-gate');
      assert.equal(parsed.next_actions?.[0]?.command, 'agentxchain multi approve-gate');
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('AT-CLI-MR-014: blocked multi step prints shared coordinator next_actions', () => {
    const { workspace } = makeMultiWorkspace();
    try {
      const init = runCli(workspace, ['multi', 'init']);
      assert.equal(init.status, 0, `stderr: ${init.stderr}`);

      const statePath = join(workspace, '.agentxchain', 'multirepo', 'state.json');
      const state = JSON.parse(readFileSync(statePath, 'utf8'));
      state.status = 'blocked';
      state.blocked_reason = 'hook violation';
      state.pending_gate = {
        gate: 'phase_transition:implementation->qa',
        gate_type: 'phase_transition',
        from: 'implementation',
        to: 'qa',
        required_repos: ['api', 'web'],
      };
      writeJson(statePath, state);

      const result = runCli(workspace, ['multi', 'step']);
      assert.notEqual(result.status, 0, 'blocked multi step must fail');
      assert.match(result.stderr, /Next Actions:/);
      assert.match(result.stderr, /agentxchain multi resume/);
      assert.match(result.stderr, /agentxchain multi approve-gate/);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('AT-CLI-MR-020: multi step with a pending gate prints canonical pending-gate detail rows', () => {
    const { workspace } = makeMultiWorkspace();
    try {
      const init = runCli(workspace, ['multi', 'init']);
      assert.equal(init.status, 0, `stderr: ${init.stderr}`);

      const statePath = join(workspace, '.agentxchain', 'multirepo', 'state.json');
      const state = JSON.parse(readFileSync(statePath, 'utf8'));
      state.status = 'paused';
      state.pending_gate = {
        gate: 'phase_transition:implementation->qa',
        gate_type: 'phase_transition',
        from: 'implementation',
        to: 'qa',
        required_repos: ['api', 'web'],
        human_barriers: ['PM_SIGNOFF.md'],
      };
      writeJson(statePath, state);

      const result = runCli(workspace, ['multi', 'step']);
      assert.notEqual(result.status, 0, 'multi step must fail while a pending gate exists');
      assert.match(result.stderr, /Coordinator has a pending gate\./);
      assert.match(result.stderr, /Pending Gate:/);
      assert.match(result.stderr, /Type: phase_transition/);
      assert.match(result.stderr, /Gate: phase_transition:implementation->qa/);
      assert.match(result.stderr, /Current Phase: implementation/);
      assert.match(result.stderr, /Target Phase: qa/);
      assert.match(result.stderr, /Required Repos: api, web/);
      assert.match(result.stderr, /Approval State: Awaiting human approval/);
      assert.match(result.stderr, /Human Barriers: PM_SIGNOFF\.md/);
      assert.match(result.stderr, /Next Actions:/);
      assert.match(result.stderr, /agentxchain multi approve-gate/);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('AT-CLI-MR-031: multi step with no assignable workstream prints gate-blocker diagnostics', () => {
    const { workspace } = makePlanningImplementationMultiWorkspace();
    try {
      const init = runCli(workspace, ['multi', 'init']);
      assert.equal(init.status, 0, `stderr: ${init.stderr}`);

      const historyPath = join(workspace, '.agentxchain', 'multirepo', 'history.jsonl');
      const existingHistory = readFileSync(historyPath, 'utf8');
      writeFileSync(
        historyPath,
        `${existingHistory}${JSON.stringify({
          type: 'acceptance_projection',
          timestamp: new Date().toISOString(),
          super_run_id: 'test-super-run',
          repo_id: 'api',
          workstream_id: 'planning_sync',
          repo_turn_id: 'turn-api-001',
        })}\n${JSON.stringify({
          type: 'acceptance_projection',
          timestamp: new Date().toISOString(),
          super_run_id: 'test-super-run',
          repo_id: 'web',
          workstream_id: 'planning_sync',
          repo_turn_id: 'turn-web-001',
        })}\n`,
      );

      const result = runCli(workspace, ['multi', 'step']);
      assert.notEqual(result.status, 0, 'multi step must fail when the next gate is not ready');
      assert.match(result.stderr, /No assignable workstream: workstream_complete/);
      assert.match(result.stderr, /Workstream "planning_sync" already has accepted projections for all repos/);
      assert.match(result.stderr, /Coordinator phase gate is not ready:/);
      assert.match(result.stderr, /Barrier "planning_sync_completion" is "pending"/);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('AT-CLI-MR-032: multi step gate-blocker path does not carry private run-id detail labels', () => {
    assert.match(MULTI_STEP_SOURCE, /printCoordinatorBlockerDetails\(gate\.blockers, console\.error\)/);
    assert.doesNotMatch(MULTI_STEP_SOURCE, /expected:\s*\$\{blocker\.expected_run_id\}/);
    assert.doesNotMatch(MULTI_STEP_SOURCE, /actual:\s*\$\{blocker\.actual_run_id\}/);
  });
});

describe('multi approve-gate CLI', () => {
  it('AT-CLI-MR-009: multi approve-gate fails with no pending gate', () => {
    const { workspace } = makeMultiWorkspace();
    try {
      runCli(workspace, ['multi', 'init']);
      const result = runCli(workspace, ['multi', 'approve-gate']);
      assert.notEqual(result.status, 0);
      assert.ok(result.stderr.includes('No pending gate'), result.stderr);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('AT-CLI-MR-016: hook-blocked multi approve-gate prints structured recovery guidance', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'axc-multi-cli-'));
    const webRepo = join(workspace, 'repos', 'web');
    const apiRepo = join(workspace, 'repos', 'api');

    try {
      writeGovernedRepo(webRepo, 'web', {
        routing: {
          planning: { entry_role: 'pm', allowed_next_roles: ['dev', 'human'] },
          implementation: { entry_role: 'dev', allowed_next_roles: ['qa', 'human'] },
        },
      });
      writeGovernedRepo(apiRepo, 'api', {
        routing: {
          planning: { entry_role: 'pm', allowed_next_roles: ['dev', 'human'] },
          implementation: { entry_role: 'dev', allowed_next_roles: ['qa', 'human'] },
        },
      });
      mkdirSync(join(workspace, 'hooks'), { recursive: true });
      writeFileSync(join(workspace, 'hooks', 'block-gate.sh'), `#!/bin/sh
cat <<'HOOKEOF'
{"verdict":"block","message":"Compliance review required"}
HOOKEOF
`, { mode: 0o755 });
      writeJson(
        join(workspace, 'agentxchain-multi.json'),
        buildCoordinatorConfigWithBlockingGateHook({ web: './repos/web', api: './repos/api' }),
      );

      const init = runCli(workspace, ['multi', 'init']);
      assert.equal(init.status, 0, init.stderr);

      const coordinatorStatePath = join(workspace, '.agentxchain', 'multirepo', 'state.json');
      const coordinatorState = JSON.parse(readFileSync(coordinatorStatePath, 'utf8'));
      coordinatorState.status = 'paused';
      coordinatorState.phase = 'planning';
      coordinatorState.pending_gate = {
        gate_type: 'phase_transition',
        gate: 'phase_transition:planning->implementation',
        from: 'planning',
        to: 'implementation',
        required_repos: ['api', 'web'],
      };
      writeJson(coordinatorStatePath, coordinatorState);

      const result = runCli(workspace, ['multi', 'approve-gate']);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /Coordinator Gate Approval Failed/);
      assert.match(result.stderr, /Hook:\s+release-guard/);
      assert.match(result.stderr, /Action:\s+agentxchain multi approve-gate/);
      assert.match(result.stderr, /Coordinator state is unchanged/);
      assert.match(result.stderr, /Next Actions:/);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('AT-CLI-MR-017: hook-blocked multi approve-gate --json returns normalized failure fields', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'axc-multi-cli-'));
    const webRepo = join(workspace, 'repos', 'web');
    const apiRepo = join(workspace, 'repos', 'api');

    try {
      writeGovernedRepo(webRepo, 'web', {
        routing: {
          planning: { entry_role: 'pm', allowed_next_roles: ['dev', 'human'] },
          implementation: { entry_role: 'dev', allowed_next_roles: ['qa', 'human'] },
        },
      });
      writeGovernedRepo(apiRepo, 'api', {
        routing: {
          planning: { entry_role: 'pm', allowed_next_roles: ['dev', 'human'] },
          implementation: { entry_role: 'dev', allowed_next_roles: ['qa', 'human'] },
        },
      });
      mkdirSync(join(workspace, 'hooks'), { recursive: true });
      writeFileSync(join(workspace, 'hooks', 'block-gate.sh'), `#!/bin/sh
cat <<'HOOKEOF'
{"verdict":"block","message":"Compliance review required"}
HOOKEOF
`, { mode: 0o755 });
      writeJson(
        join(workspace, 'agentxchain-multi.json'),
        buildCoordinatorConfigWithBlockingGateHook({ web: './repos/web', api: './repos/api' }),
      );

      const init = runCli(workspace, ['multi', 'init']);
      assert.equal(init.status, 0, init.stderr);

      const coordinatorStatePath = join(workspace, '.agentxchain', 'multirepo', 'state.json');
      const coordinatorState = JSON.parse(readFileSync(coordinatorStatePath, 'utf8'));
      coordinatorState.status = 'paused';
      coordinatorState.phase = 'planning';
      coordinatorState.pending_gate = {
        gate_type: 'phase_transition',
        gate: 'phase_transition:planning->implementation',
        from: 'planning',
        to: 'implementation',
        required_repos: ['api', 'web'],
      };
      writeJson(coordinatorStatePath, coordinatorState);

      const result = runCli(workspace, ['multi', 'approve-gate', '--json']);
      assert.notEqual(result.status, 0);
      const parsed = JSON.parse(result.stdout);
      assert.equal(parsed.ok, false);
      assert.equal(parsed.code, 'hook_blocked');
      assert.equal(parsed.hook_phase, 'before_gate');
      assert.equal(parsed.hook_name, 'release-guard');
      assert.equal(parsed.next_action, 'agentxchain multi approve-gate');
      assert.equal(parsed.next_actions[0].command, 'agentxchain multi approve-gate');
      assert.equal(parsed.recovery_summary.typed_reason, 'hook_block');
      assert.match(parsed.recovery_summary.detail, /Coordinator state is unchanged/);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('AT-CLI-MR-023: successful phase-transition multi approve-gate prints ordered next actions', () => {
    const { workspace } = makeMultiWorkspace();
    try {
      const init = runCli(workspace, ['multi', 'init']);
      assert.equal(init.status, 0, `stderr: ${init.stderr}`);

      const coordinatorStatePath = join(workspace, '.agentxchain', 'multirepo', 'state.json');
      const coordinatorState = JSON.parse(readFileSync(coordinatorStatePath, 'utf8'));
      coordinatorState.status = 'paused';
      coordinatorState.phase = 'implementation';
      coordinatorState.pending_gate = {
        gate_type: 'phase_transition',
        gate: 'phase_transition:implementation->qa',
        from: 'implementation',
        to: 'qa',
        required_repos: ['api', 'web'],
      };
      writeJson(coordinatorStatePath, coordinatorState);

      const result = runCli(workspace, ['multi', 'approve-gate']);
      assert.equal(result.status, 0, `stderr: ${result.stderr}`);
      assert.match(result.stdout, /Coordinator phase transition approved: implementation -> qa/);
      assert.match(result.stdout, /Next Actions:/);
      assert.match(result.stdout, /agentxchain multi step/);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('AT-CLI-MR-024: successful phase-transition multi approve-gate --json returns normalized success fields', () => {
    const { workspace } = makeMultiWorkspace();
    try {
      const init = runCli(workspace, ['multi', 'init']);
      assert.equal(init.status, 0, `stderr: ${init.stderr}`);

      const coordinatorStatePath = join(workspace, '.agentxchain', 'multirepo', 'state.json');
      const coordinatorState = JSON.parse(readFileSync(coordinatorStatePath, 'utf8'));
      coordinatorState.status = 'paused';
      coordinatorState.phase = 'implementation';
      coordinatorState.pending_gate = {
        gate_type: 'phase_transition',
        gate: 'phase_transition:implementation->qa',
        from: 'implementation',
        to: 'qa',
        required_repos: ['api', 'web'],
      };
      writeJson(coordinatorStatePath, coordinatorState);

      const result = runCli(workspace, ['multi', 'approve-gate', '--json']);
      assert.equal(result.status, 0, `stderr: ${result.stderr}`);
      const parsed = JSON.parse(result.stdout);
      assert.equal(parsed.ok, true);
      assert.equal(parsed.gate_type, 'phase_transition');
      assert.equal(parsed.status, 'active');
      assert.equal(parsed.phase, 'qa');
      assert.equal(parsed.message, 'Coordinator phase transition approved: implementation -> qa');
      assert.equal(parsed.next_action, 'agentxchain multi step');
      assert.equal(parsed.next_actions?.[0]?.command, 'agentxchain multi step');
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('AT-CLI-MR-025: successful run-completion multi approve-gate --json keeps next actions empty', () => {
    const { workspace } = makeMultiWorkspace();
    try {
      const init = runCli(workspace, ['multi', 'init']);
      assert.equal(init.status, 0, `stderr: ${init.stderr}`);

      const coordinatorStatePath = join(workspace, '.agentxchain', 'multirepo', 'state.json');
      const coordinatorState = JSON.parse(readFileSync(coordinatorStatePath, 'utf8'));
      coordinatorState.status = 'paused';
      coordinatorState.phase = 'implementation';
      coordinatorState.pending_gate = {
        gate_type: 'run_completion',
        gate: 'initiative_ship',
        required_repos: ['api', 'web'],
      };
      writeJson(coordinatorStatePath, coordinatorState);

      const result = runCli(workspace, ['multi', 'approve-gate', '--json']);
      assert.equal(result.status, 0, `stderr: ${result.stderr}`);
      const parsed = JSON.parse(result.stdout);
      assert.equal(parsed.ok, true);
      assert.equal(parsed.gate_type, 'run_completion');
      assert.equal(parsed.status, 'completed');
      assert.equal(parsed.next_action, null);
      assert.deepEqual(parsed.next_actions, []);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});

describe('multi resume CLI', () => {
  it('AT-MR-REC-001: multi resume fails without coordinator init', () => {
    const { workspace } = makeMultiWorkspace();
    try {
      const result = runCli(workspace, ['multi', 'resume']);
      assert.notEqual(result.status, 0);
      assert.ok(result.stderr.includes('No coordinator state'), result.stderr);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('AT-MR-REC-002: multi resume rejects non-blocked coordinator state', () => {
    const { workspace } = makeMultiWorkspace();
    try {
      runCli(workspace, ['multi', 'init']);
      const result = runCli(workspace, ['multi', 'resume']);
      assert.notEqual(result.status, 0);
      assert.ok(result.stderr.includes('expected "blocked"'), result.stderr);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('AT-MR-REC-003: multi resume restores active state and surfaces the next action', () => {
    const { workspace } = makeMultiWorkspace();
    try {
      const init = runCli(workspace, ['multi', 'init']);
      assert.equal(init.status, 0, `stderr: ${init.stderr}`);

      const statePath = join(workspace, '.agentxchain', 'multirepo', 'state.json');
      const state = JSON.parse(readFileSync(statePath, 'utf8'));
      state.status = 'blocked';
      state.blocked_reason = 'operator recovery required';
      writeJson(statePath, state);
      writeCoordinatorRecoveryReport(workspace);

      const result = runCli(workspace, ['multi', 'resume']);
      assert.equal(result.status, 0, `stderr: ${result.stderr}`);
      assert.match(result.stdout, /Coordinator resumed: active/);
      assert.match(result.stdout, /Previous block: operator recovery required/);
      assert.match(result.stdout, /Next Actions:/);
      assert.match(result.stdout, /agentxchain multi step/);
      assert.doesNotMatch(result.stdout, /Pending Gate:/);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('AT-CLI-MR-021: multi resume restoring paused prints canonical pending-gate detail rows', () => {
    const { workspace } = makeMultiWorkspace();
    try {
      const init = runCli(workspace, ['multi', 'init']);
      assert.equal(init.status, 0, `stderr: ${init.stderr}`);

      const statePath = join(workspace, '.agentxchain', 'multirepo', 'state.json');
      const state = JSON.parse(readFileSync(statePath, 'utf8'));
      state.status = 'blocked';
      state.blocked_reason = 'operator recovery required';
      state.phase = 'implementation';
      state.pending_gate = {
        gate: 'phase_transition:implementation->qa',
        gate_type: 'phase_transition',
        from: 'implementation',
        to: 'qa',
        required_repos: ['api', 'web'],
        human_barriers: ['PM_SIGNOFF.md'],
      };
      writeJson(statePath, state);
      writeCoordinatorRecoveryReport(workspace);

      const result = runCli(workspace, ['multi', 'resume']);
      assert.equal(result.status, 0, `stderr: ${result.stderr}`);
      assert.match(result.stdout, /Coordinator resumed: paused/);
      assert.match(result.stdout, /Pending Gate:/);
      assert.match(result.stdout, /Type: phase_transition/);
      assert.match(result.stdout, /Gate: phase_transition:implementation->qa/);
      assert.match(result.stdout, /Current Phase: implementation/);
      assert.match(result.stdout, /Target Phase: qa/);
      assert.match(result.stdout, /Required Repos: api, web/);
      assert.match(result.stdout, /Approval State: Awaiting human approval/);
      assert.match(result.stdout, /Human Barriers: PM_SIGNOFF\.md/);
      assert.match(result.stdout, /Next Actions:/);
      assert.match(result.stdout, /agentxchain multi approve-gate/);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('AT-CLI-MR-022: multi resume --json exposes ordered next actions', () => {
    const { workspace } = makeMultiWorkspace();
    try {
      const init = runCli(workspace, ['multi', 'init']);
      assert.equal(init.status, 0, `stderr: ${init.stderr}`);

      const statePath = join(workspace, '.agentxchain', 'multirepo', 'state.json');
      const state = JSON.parse(readFileSync(statePath, 'utf8'));
      state.status = 'blocked';
      state.blocked_reason = 'operator recovery required';
      state.pending_gate = {
        gate: 'initiative_ship',
        gate_type: 'run_completion',
        required_repos: ['api', 'web'],
      };
      writeJson(statePath, state);
      writeCoordinatorRecoveryReport(workspace);

      const result = runCli(workspace, ['multi', 'resume', '--json']);
      assert.equal(result.status, 0, `stderr: ${result.stderr}`);
      const parsed = JSON.parse(result.stdout);
      assert.equal(parsed.resumed_status, 'paused');
      assert.equal(parsed.next_action, 'agentxchain multi approve-gate');
      assert.equal(parsed.next_actions?.[0]?.command, 'agentxchain multi approve-gate');
      assert.ok(parsed.pending_gate);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});

describe('multi help surface', () => {
  it('AT-CLI-MR-010: multi --help lists subcommands', () => {
    const result = runCli(process.cwd(), ['multi', '--help']);
    assert.equal(result.status, 0, `stderr: ${result.stderr}`);
    assert.ok(result.stdout.includes('init'), result.stdout);
    assert.ok(result.stdout.includes('status'), result.stdout);
    assert.ok(result.stdout.includes('step'), result.stdout);
    assert.ok(result.stdout.includes('resume'), result.stdout);
    assert.ok(result.stdout.includes('approve-gate'), result.stdout);
    assert.ok(result.stdout.includes('resync'), result.stdout);
  });

  it('AT-CLI-MR-011: top-level --help shows multi command', () => {
    const result = runCli(process.cwd(), ['--help']);
    assert.equal(result.status, 0, `stderr: ${result.stderr}`);
    assert.ok(result.stdout.includes('multi'), result.stdout);
  });

  it('AT-CLI-MR-015: multi command imports shared coordinator next-action helpers', () => {
    assert.match(MULTI_SOURCE, /deriveCoordinatorNextActions/);
    assert.match(MULTI_SOURCE, /collectCoordinatorRepoSnapshots/);
    assert.match(MULTI_SOURCE, /normalizeCoordinatorGateApprovalSuccess/);
    assert.doesNotMatch(MULTI_SOURCE, /Action:\s+Run \$\{chalk\.cyan\('agentxchain multi approve-gate'\)\} to advance/);
  });

  it('AT-CLI-MR-019: multi command imports shared coordinator pending-gate presentation helpers', () => {
    assert.match(MULTI_SOURCE, /getCoordinatorPendingGateDetails/);
    assert.doesNotMatch(MULTI_SOURCE, /const fromTo = pg\.from && pg\.to/);
    assert.doesNotMatch(MULTI_SOURCE, /Pending Gate: \$\{pg\.gate\}/);
    assert.doesNotMatch(MULTI_SOURCE, /Coordinator has a pending gate: \$\{state\.pending_gate\.gate\}/);
  });

  it('AT-CLI-MR-030: multi command imports shared coordinator blocker presentation helpers for resync output', () => {
    assert.match(MULTI_SOURCE, /getCoordinatorBlockerDetails/);
    assert.match(MULTI_RESYNC_SOURCE, /printCoordinatorBlockerDetails/);
    assert.doesNotMatch(MULTI_RESYNC_SOURCE, /expected:\s*\$\{mismatch\.expected_run_id\}/);
    assert.doesNotMatch(MULTI_RESYNC_SOURCE, /actual:\s*\$\{mismatch\.actual_run_id\}/);
  });

  it('AT-CLI-MR-035: multi status imports shared coordinator repo-row presentation helpers', () => {
    assert.match(MULTI_SOURCE, /buildCoordinatorRepoStatusRows/);
    assert.doesNotMatch(MULTI_SOURCE, /console\.log\(`  \$\{repoId\}: \$\{info\.status \|\| 'unknown'\}/);
  });
});
