import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(__dirname, '..', 'bin', 'agentxchain.js');
const MULTI_SOURCE = readFileSync(join(__dirname, '..', 'src', 'commands', 'multi.js'), 'utf8');

function writeJson(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
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
    assert.doesNotMatch(MULTI_SOURCE, /Action:\s+Run \$\{chalk\.cyan\('agentxchain multi approve-gate'\)\} to advance/);
  });

  it('AT-CLI-MR-019: multi command imports shared coordinator pending-gate presentation helpers', () => {
    assert.match(MULTI_SOURCE, /getCoordinatorPendingGateDetails/);
    assert.doesNotMatch(MULTI_SOURCE, /const fromTo = pg\.from && pg\.to/);
    assert.doesNotMatch(MULTI_SOURCE, /Pending Gate: \$\{pg\.gate\}/);
    assert.doesNotMatch(MULTI_SOURCE, /Coordinator has a pending gate: \$\{state\.pending_gate\.gate\}/);
  });
});
