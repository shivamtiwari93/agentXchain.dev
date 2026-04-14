import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import {
  loadCoordinatorConfig,
  normalizeCoordinatorConfig,
  resolveRepoPaths,
  validateCoordinatorConfig,
} from '../src/lib/coordinator-config.js';

function writeJson(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
}

function makeWorkspace() {
  return mkdtempSync(join(tmpdir(), 'axc-multi-config-'));
}

function writeGovernedRepo(root, projectId, options = {}) {
  const routing = options.routing || {
    implementation: {
      entry_role: 'dev',
      allowed_next_roles: ['qa', 'human'],
    },
  };

  mkdirSync(root, { recursive: true });
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
      'manual-pm': {
        type: 'manual',
      },
      'local-dev': {
        type: 'local_cli',
        command: ['echo', '{prompt}'],
        prompt_transport: 'argv',
      },
      'manual-qa': {
        type: 'manual',
      },
    },
    routing,
    gates: {},
  });
}

function writeLegacyRepo(root) {
  mkdirSync(root, { recursive: true });
  writeJson(join(root, 'agentxchain.json'), {
    version: 3,
    project: 'Legacy Repo',
    agents: {
      dev: { name: 'Developer', mandate: 'Build things.' },
    },
  });
}

function buildValidCoordinatorConfig(repoPaths) {
  return {
    schema_version: '0.1',
    project: {
      id: 'agent-platform',
      name: 'Agent Platform Rollout',
    },
    repos: {
      web: {
        path: repoPaths.web,
        default_branch: 'main',
        required: true,
      },
      cli: {
        path: repoPaths.cli,
        default_branch: 'main',
        required: true,
      },
    },
    workstreams: {
      protocol_doc_sync: {
        phase: 'implementation',
        repos: ['web', 'cli'],
        entry_repo: 'cli',
        depends_on: [],
        completion_barrier: 'all_repos_accepted',
      },
    },
    routing: {
      implementation: {
        entry_workstream: 'protocol_doc_sync',
      },
    },
    gates: {
      initiative_ship: {
        requires_human_approval: true,
        requires_repos: ['web', 'cli'],
      },
    },
  };
}

function buildPlanningImplementationCoordinatorConfig(repoPaths) {
  return {
    schema_version: '0.1',
    project: {
      id: 'agent-platform',
      name: 'Agent Platform Rollout',
    },
    repos: {
      web: {
        path: repoPaths.web,
        default_branch: 'main',
        required: true,
      },
      cli: {
        path: repoPaths.cli,
        default_branch: 'main',
        required: true,
      },
    },
    workstreams: {
      planning_sync: {
        phase: 'planning',
        repos: ['web', 'cli'],
        entry_repo: 'cli',
        depends_on: [],
        completion_barrier: 'all_repos_accepted',
      },
      implementation_sync: {
        phase: 'implementation',
        repos: ['web', 'cli'],
        entry_repo: 'cli',
        depends_on: ['planning_sync'],
        completion_barrier: 'all_repos_accepted',
      },
    },
    routing: {
      planning: {
        entry_workstream: 'planning_sync',
      },
      implementation: {
        entry_workstream: 'implementation_sync',
      },
    },
    gates: {
      initiative_ship: {
        requires_human_approval: true,
        requires_repos: ['web', 'cli'],
      },
    },
  };
}

describe('coordinator config validation', () => {
  it('AT-MC-001: loads and normalizes a valid two-repo config', () => {
    const workspace = makeWorkspace();
    const webRepo = join(workspace, 'repos', 'web');
    const cliRepo = join(workspace, 'repos', 'cli');

    try {
      writeGovernedRepo(webRepo, 'web');
      writeGovernedRepo(cliRepo, 'cli');
      writeJson(
        join(workspace, 'agentxchain-multi.json'),
        buildValidCoordinatorConfig({
          web: './repos/web',
          cli: './repos/cli',
        }),
      );

      const result = loadCoordinatorConfig(workspace);
      assert.equal(result.ok, true, result.errors.join('\n'));
      assert.equal(result.config.project.id, 'agent-platform');
      assert.equal(result.config.repos.web.default_branch, 'main');
      assert.equal(result.config.workstreams.protocol_doc_sync.entry_repo, 'cli');
      assert.equal(result.config.repos.web.resolved_path, resolve(workspace, 'repos', 'web'));
      assert.equal(result.config.repos.cli.resolved_path, resolve(workspace, 'repos', 'cli'));
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('AT-MC-002: returns a clear error when agentxchain-multi.json is missing', () => {
    const workspace = makeWorkspace();

    try {
      const result = loadCoordinatorConfig(workspace);
      assert.equal(result.ok, false);
      assert.ok(result.errors.some((error) => error.includes('config_missing')));
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('AT-MC-002b: accepts interface_alignment only when explicit decision ids are declared per repo', () => {
    const config = buildValidCoordinatorConfig({ web: './repos/web', cli: './repos/cli' });
    config.workstreams.protocol_doc_sync.completion_barrier = 'interface_alignment';
    config.workstreams.protocol_doc_sync.interface_alignment = {
      decision_ids_by_repo: {
        web: ['DEC-101'],
        cli: ['DEC-201', 'DEC-202'],
      },
    };

    const result = validateCoordinatorConfig(config);
    assert.equal(result.ok, true, result.errors?.join('\n'));

    const normalized = normalizeCoordinatorConfig(config);
    assert.deepEqual(
      normalized.workstreams.protocol_doc_sync.interface_alignment,
      {
        decision_ids_by_repo: {
          web: ['DEC-101'],
          cli: ['DEC-201', 'DEC-202'],
        },
      },
    );
  });

  it('AT-MC-002c: rejects interface_alignment without decision ids for every repo', () => {
    const config = buildValidCoordinatorConfig({ web: './repos/web', cli: './repos/cli' });
    config.workstreams.protocol_doc_sync.completion_barrier = 'interface_alignment';
    config.workstreams.protocol_doc_sync.interface_alignment = {
      decision_ids_by_repo: {
        web: ['DEC-101'],
      },
    };

    const result = validateCoordinatorConfig(config);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => error.includes('workstream_interface_alignment_repo_missing')));
  });

  it('AT-NDB-001a: accepts named_decisions only when explicit decision ids are declared per repo', () => {
    const config = buildValidCoordinatorConfig({ web: './repos/web', cli: './repos/cli' });
    config.workstreams.protocol_doc_sync.completion_barrier = 'named_decisions';
    config.workstreams.protocol_doc_sync.named_decisions = {
      decision_ids_by_repo: {
        web: ['DEC-301'],
        cli: ['DEC-401', 'DEC-402'],
      },
    };

    const result = validateCoordinatorConfig(config);
    assert.equal(result.ok, true, result.errors?.join('\n'));

    const normalized = normalizeCoordinatorConfig(config);
    assert.deepEqual(
      normalized.workstreams.protocol_doc_sync.named_decisions,
      {
        decision_ids_by_repo: {
          web: ['DEC-301'],
          cli: ['DEC-401', 'DEC-402'],
        },
      },
    );
  });

  it('AT-NDB-001b: rejects named_decisions without decision ids for every repo', () => {
    const config = buildValidCoordinatorConfig({ web: './repos/web', cli: './repos/cli' });
    config.workstreams.protocol_doc_sync.completion_barrier = 'named_decisions';
    config.workstreams.protocol_doc_sync.named_decisions = {
      decision_ids_by_repo: {
        web: ['DEC-301'],
      },
    };

    const result = validateCoordinatorConfig(config);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => error.includes('workstream_named_decisions_repo_missing')));
  });

  it('AT-MC-003: rejects a repo path that does not exist on disk', () => {
    const workspace = makeWorkspace();
    const cliRepo = join(workspace, 'repos', 'cli');

    try {
      writeGovernedRepo(cliRepo, 'cli');
      writeJson(
        join(workspace, 'agentxchain-multi.json'),
        buildValidCoordinatorConfig({
          web: './repos/missing-web',
          cli: './repos/cli',
        }),
      );

      const result = loadCoordinatorConfig(workspace);
      assert.equal(result.ok, false);
      assert.ok(result.errors.some((error) => error.includes('repo_path_missing')));
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('AT-MC-004: rejects a repo that is not governed', () => {
    const workspace = makeWorkspace();
    const webRepo = join(workspace, 'repos', 'web');
    const cliRepo = join(workspace, 'repos', 'cli');

    try {
      writeLegacyRepo(webRepo);
      writeGovernedRepo(cliRepo, 'cli');
      writeJson(
        join(workspace, 'agentxchain-multi.json'),
        buildValidCoordinatorConfig({
          web: './repos/web',
          cli: './repos/cli',
        }),
      );

      const result = loadCoordinatorConfig(workspace);
      assert.equal(result.ok, false);
      assert.ok(result.errors.some((error) => error.includes('repo_not_governed')));
      assert.ok(result.errors.some((error) => error.includes('web')));
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('AT-CPA-002: rejects a child repo with extra phases beyond the coordinator order', () => {
    const workspace = makeWorkspace();
    const webRepo = join(workspace, 'repos', 'web');
    const cliRepo = join(workspace, 'repos', 'cli');

    try {
      writeGovernedRepo(webRepo, 'web', {
        routing: {
          planning: { entry_role: 'pm', allowed_next_roles: ['dev', 'human'] },
          implementation: { entry_role: 'dev', allowed_next_roles: ['qa', 'human'] },
          qa: { entry_role: 'qa', allowed_next_roles: ['human'] },
        },
      });
      writeGovernedRepo(cliRepo, 'cli', {
        routing: {
          planning: { entry_role: 'pm', allowed_next_roles: ['dev', 'human'] },
          implementation: { entry_role: 'dev', allowed_next_roles: ['qa', 'human'] },
          qa: { entry_role: 'qa', allowed_next_roles: ['human'] },
        },
      });
      writeJson(
        join(workspace, 'agentxchain-multi.json'),
        buildPlanningImplementationCoordinatorConfig({
          web: './repos/web',
          cli: './repos/cli',
        }),
      );

      const result = loadCoordinatorConfig(workspace);
      assert.equal(result.ok, false);
      assert.ok(result.errors.some((error) => error.includes('repo_phase_alignment_invalid')));
      assert.ok(result.errors.some((error) => error.includes('[planning, implementation, qa]')));
      assert.ok(result.errors.some((error) => error.includes('[planning, implementation]')));
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('AT-CPA-003: rejects a child repo missing a coordinator phase', () => {
    const workspace = makeWorkspace();
    const webRepo = join(workspace, 'repos', 'web');
    const cliRepo = join(workspace, 'repos', 'cli');

    try {
      writeGovernedRepo(webRepo, 'web', {
        routing: {
          planning: { entry_role: 'pm', allowed_next_roles: ['dev', 'human'] },
          implementation: { entry_role: 'dev', allowed_next_roles: ['human'] },
        },
      });
      writeGovernedRepo(cliRepo, 'cli', {
        routing: {
          implementation: { entry_role: 'dev', allowed_next_roles: ['human'] },
        },
      });
      writeJson(
        join(workspace, 'agentxchain-multi.json'),
        buildPlanningImplementationCoordinatorConfig({
          web: './repos/web',
          cli: './repos/cli',
        }),
      );

      const result = loadCoordinatorConfig(workspace);
      assert.equal(result.ok, false);
      assert.ok(result.errors.some((error) => error.includes('repo_phase_alignment_invalid')));
      assert.ok(result.errors.some((error) => error.includes('repo "cli"')));
      assert.ok(result.errors.some((error) => error.includes('[implementation]')));
      assert.ok(result.errors.some((error) => error.includes('[planning, implementation]')));
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it('AT-MC-005: rejects a workstream that references an undeclared repo', () => {
    const config = buildValidCoordinatorConfig({ web: './repos/web', cli: './repos/cli' });
    config.workstreams.protocol_doc_sync.repos = ['web', 'ghost'];

    const result = validateCoordinatorConfig(config);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => error.includes('workstream_repo_unknown')));
  });

  it('AT-MC-006: rejects circular workstream dependencies', () => {
    const config = buildValidCoordinatorConfig({ web: './repos/web', cli: './repos/cli' });
    config.workstreams.api_contract = {
      phase: 'implementation',
      repos: ['cli'],
      entry_repo: 'cli',
      depends_on: ['web_delivery'],
      completion_barrier: 'all_repos_accepted',
    };
    config.workstreams.web_delivery = {
      phase: 'implementation',
      repos: ['web'],
      entry_repo: 'web',
      depends_on: ['api_contract'],
      completion_barrier: 'all_repos_accepted',
    };

    const result = validateCoordinatorConfig(config);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => error.includes('workstream_cycle')));
  });

  it('AT-MC-007: rejects a gate that references an undeclared repo', () => {
    const config = buildValidCoordinatorConfig({ web: './repos/web', cli: './repos/cli' });
    config.gates.initiative_ship.requires_repos = ['web', 'ghost'];

    const result = validateCoordinatorConfig(config);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => error.includes('gate_requires_repo_unknown')));
  });

  it('AT-MC-008: resolveRepoPaths converts relative repo paths to absolute paths', () => {
    const workspace = makeWorkspace();
    const webRepo = join(workspace, 'repos', 'web');
    const cliRepo = join(workspace, 'repos', 'cli');

    try {
      writeGovernedRepo(webRepo, 'web');
      writeGovernedRepo(cliRepo, 'cli');
      const normalized = normalizeCoordinatorConfig(
        buildValidCoordinatorConfig({
          web: './repos/web',
          cli: './repos/cli',
        }),
      );

      const result = resolveRepoPaths(normalized, workspace);
      assert.equal(result.ok, true, result.errors.join('\n'));
      assert.equal(result.resolved.web, resolve(workspace, 'repos', 'web'));
      assert.equal(result.resolved.cli, resolve(workspace, 'repos', 'cli'));
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});

// --- Custom Phases (Coordinator) ---

describe('coordinator custom phases', () => {
  it('AT-CP-005: accepts custom phases in workstream when routing declares them', () => {
    const result = validateCoordinatorConfig({
      schema_version: '0.1',
      project: { id: 'x', name: 'X' },
      repos: { api: { path: './api', default_branch: 'main', required: true } },
      workstreams: {
        design_ws: {
          phase: 'design',
          repos: ['api'],
          entry_repo: 'api',
          depends_on: [],
          completion_barrier: 'all_repos_accepted',
        },
        build_ws: {
          phase: 'implementation',
          repos: ['api'],
          entry_repo: 'api',
          depends_on: ['design_ws'],
          completion_barrier: 'all_repos_accepted',
        },
      },
      routing: {
        design: { entry_workstream: 'design_ws' },
        implementation: { entry_workstream: 'build_ws' },
      },
    });
    assert.equal(result.ok, true, `Unexpected errors: ${result.errors.join(', ')}`);
  });

  it('rejects workstream phase not declared in routing', () => {
    const result = validateCoordinatorConfig({
      schema_version: '0.1',
      project: { id: 'x', name: 'X' },
      repos: { api: { path: './api', default_branch: 'main', required: true } },
      workstreams: {
        sec_ws: {
          phase: 'security_review',
          repos: ['api'],
          entry_repo: 'api',
          depends_on: [],
          completion_barrier: 'all_repos_accepted',
        },
      },
      routing: {
        implementation: { entry_workstream: 'sec_ws' },
      },
    });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.includes('workstream_phase_invalid') && e.includes('sec_ws')));
  });

  it('rejects coordinator routing phase names with invalid characters', () => {
    const result = validateCoordinatorConfig({
      schema_version: '0.1',
      project: { id: 'x', name: 'X' },
      repos: { api: { path: './api', default_branch: 'main', required: true } },
      workstreams: {
        ws: {
          phase: 'planning',
          repos: ['api'],
          entry_repo: 'api',
          depends_on: [],
          completion_barrier: 'all_repos_accepted',
        },
      },
      routing: {
        planning: { entry_workstream: 'ws' },
        'Design Phase': { entry_workstream: 'ws' },
      },
    });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.includes('Design Phase') && e.includes('lowercase')));
  });

  it('uses default phases when no routing is configured', () => {
    const result = validateCoordinatorConfig({
      schema_version: '0.1',
      project: { id: 'x', name: 'X' },
      repos: { api: { path: './api', default_branch: 'main', required: true } },
      workstreams: {
        ws: {
          phase: 'implementation',
          repos: ['api'],
          entry_repo: 'api',
          depends_on: [],
          completion_barrier: 'all_repos_accepted',
        },
      },
    });
    assert.equal(result.ok, true, `Unexpected errors: ${result.errors.join(', ')}`);
  });

  it('rejects custom phase in workstream when no routing is configured', () => {
    const result = validateCoordinatorConfig({
      schema_version: '0.1',
      project: { id: 'x', name: 'X' },
      repos: { api: { path: './api', default_branch: 'main', required: true } },
      workstreams: {
        ws: {
          phase: 'security_review',
          repos: ['api'],
          entry_repo: 'api',
          depends_on: [],
          completion_barrier: 'all_repos_accepted',
        },
      },
    });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some(e => e.includes('workstream_phase_invalid')));
  });
});
