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

function writeGovernedRepo(root, projectId) {
  mkdirSync(root, { recursive: true });
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
