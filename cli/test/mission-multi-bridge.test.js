import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';

/**
 * Fixture helpers — build temporary governed project + multi-repo workspace
 * for testing the mission ↔ coordinator bridge.
 */

function createTmpDir() {
  const dir = join(tmpdir(), `axc-mission-multi-${randomUUID().slice(0, 8)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeAgentxchainJson(dir, overrides = {}) {
  const config = {
    schema_version: '1.0',
    protocol_mode: 'governed',
    template: 'generic',
    project: { name: 'multi-test', id: 'mt-001', default_branch: 'main' },
    roles: {
      dev: { title: 'Developer', mandate: 'Implement.', write_authority: 'authoritative', runtime: 'manual-dev' },
    },
    runtimes: { 'manual-dev': { type: 'manual' } },
    routing: { implementation: { entry_role: 'dev', allowed_next_roles: ['dev'], exit_gate: 'done' } },
    gates: { done: {} },
    rules: { challenge_required: false, max_turn_retries: 1 },
    ...overrides,
  };
  writeFileSync(join(dir, 'agentxchain.json'), JSON.stringify(config, null, 2));
  return config;
}

function writeGovernedState(dir, overrides = {}) {
  const stateDir = join(dir, '.agentxchain');
  mkdirSync(stateDir, { recursive: true });
  const state = {
    run_id: `gov_test_${randomUUID().slice(0, 8)}`,
    status: 'idle',
    phase: 'implementation',
    ...overrides,
  };
  writeFileSync(join(stateDir, 'state.json'), JSON.stringify(state, null, 2));
  return state;
}

function createRepoFixture(parentDir, repoId) {
  const repoDir = join(parentDir, repoId);
  mkdirSync(repoDir, { recursive: true });
  writeAgentxchainJson(repoDir, { project: { name: repoId, id: repoId, default_branch: 'main' } });
  writeGovernedState(repoDir);
  return repoDir;
}

function writeCoordinatorConfig(workspaceDir, repos) {
  const repoEntries = {};
  for (const [repoId, repoDir] of Object.entries(repos)) {
    repoEntries[repoId] = { path: repoDir, required: true };
  }
  const config = {
    schema_version: '0.1',
    project: { id: 'multi-test', name: 'Multi Test' },
    repos: repoEntries,
    workstreams: {
      'ws-main': {
        repos: Object.keys(repos),
        entry_repo: Object.keys(repos)[0],
        phase: 'implementation',
        depends_on: [],
        completion_barrier: 'all_repos_accepted',
      },
    },
    routing: {
      implementation: {
        entry_role: 'dev',
        allowed_next_roles: ['dev'],
        exit_gate: 'done',
      },
    },
    gates: { done: {} },
  };
  writeFileSync(join(workspaceDir, 'agentxchain-multi.json'), JSON.stringify(config, null, 2));
  return config;
}

function writeMissionArtifact(dir, { missionId, title, goal, coordinator }) {
  const missionsDir = join(dir, '.agentxchain', 'missions');
  mkdirSync(missionsDir, { recursive: true });
  const now = new Date().toISOString();
  const artifact = {
    mission_id: missionId,
    title,
    goal,
    status: 'active',
    created_at: now,
    updated_at: now,
    chain_ids: [],
  };
  if (coordinator) {
    artifact.coordinator = coordinator;
  }
  writeFileSync(join(missionsDir, `${missionId}.json`), JSON.stringify(artifact, null, 2));
  return artifact;
}

let tmpDirs = [];
beforeEach(() => { tmpDirs = []; });
afterEach(() => { tmpDirs.forEach((d) => rmSync(d, { recursive: true, force: true })); });
function trackDir(dir) { tmpDirs.push(dir); return dir; }

// ── Library-level tests ────────────────────────────────────────────────────

describe('Mission multi-repo bridge (library)', () => {
  it('AT-MISSION-MULTI-008: missions without coordinator field work unchanged', async () => {
    const dir = trackDir(createTmpDir());
    writeAgentxchainJson(dir);
    const { createMission, buildMissionSnapshot } = await import('../src/lib/missions.js');

    const result = createMission(dir, {
      missionId: 'mission-no-coord',
      title: 'No Coord',
      goal: 'Single repo only',
    });
    assert.ok(result.ok);
    assert.equal(result.mission.coordinator, undefined);

    const snapshot = buildMissionSnapshot(dir, result.mission);
    assert.equal(snapshot.coordinator_status, null);
    assert.equal(snapshot.derived_status, 'planned');
  });

  it('AT-MISSION-MULTI-006: bindCoordinatorToMission writes coordinator ref', async () => {
    const dir = trackDir(createTmpDir());
    writeAgentxchainJson(dir);
    const { createMission, bindCoordinatorToMission, loadMissionArtifact } = await import('../src/lib/missions.js');

    createMission(dir, {
      missionId: 'mission-bind-test',
      title: 'Bind Test',
      goal: 'Test binding',
    });

    const result = bindCoordinatorToMission(dir, 'mission-bind-test', {
      super_run_id: 'srun_test_12345',
      config_path: './agentxchain-multi.json',
      workspace_path: dir,
    });

    assert.ok(result.ok);
    assert.equal(result.mission.coordinator.super_run_id, 'srun_test_12345');
    assert.equal(result.mission.coordinator.config_path, './agentxchain-multi.json');

    // Reload from disk to confirm persistence
    const reloaded = loadMissionArtifact(dir, 'mission-bind-test');
    assert.equal(reloaded.coordinator.super_run_id, 'srun_test_12345');
  });

  it('AT-MISSION-MULTI-005: show on coordinator-bound mission with missing state shows unreachable', async () => {
    const dir = trackDir(createTmpDir());
    writeAgentxchainJson(dir);
    const { buildMissionSnapshot } = await import('../src/lib/missions.js');

    const artifact = writeMissionArtifact(dir, {
      missionId: 'mission-unreachable',
      title: 'Unreachable Coord',
      goal: 'Coord state missing',
      coordinator: {
        super_run_id: 'srun_missing_000',
        config_path: null,
        workspace_path: '/nonexistent/path',
      },
    });

    const snapshot = buildMissionSnapshot(dir, artifact);
    assert.ok(snapshot.coordinator_status);
    // Either unreachable or null (no coordinator state at that path)
    if (snapshot.coordinator_status.unreachable) {
      assert.equal(snapshot.coordinator_status.super_run_id, 'srun_missing_000');
    } else {
      // getCoordinatorStatus returned null, which is fine
      assert.equal(snapshot.coordinator_status, null);
    }
  });

  it('AT-MISSION-MULTI-004: show on coordinator-bound mission includes repo status', async () => {
    const workspace = trackDir(createTmpDir());
    writeAgentxchainJson(workspace);

    // Create two repo fixtures
    const repoADir = createRepoFixture(workspace, 'repo-a');
    const repoBDir = createRepoFixture(workspace, 'repo-b');

    // Write coordinator config
    writeCoordinatorConfig(workspace, { 'repo-a': repoADir, 'repo-b': repoBDir });

    // Initialize coordinator
    const { initializeCoordinatorRun } = await import('../src/lib/coordinator-state.js');
    const { loadCoordinatorConfig } = await import('../src/lib/coordinator-config.js');

    const configResult = loadCoordinatorConfig(workspace);
    assert.ok(configResult.ok, `Config load failed: ${JSON.stringify(configResult.errors)}`);

    const initResult = initializeCoordinatorRun(workspace, configResult.config);
    assert.ok(initResult.ok, `Init failed: ${JSON.stringify(initResult.errors)}`);

    // Create mission bound to coordinator
    const { buildMissionSnapshot } = await import('../src/lib/missions.js');
    const artifact = writeMissionArtifact(workspace, {
      missionId: 'mission-with-coord',
      title: 'With Coordinator',
      goal: 'Test multi-repo view',
      coordinator: {
        super_run_id: initResult.super_run_id,
        config_path: './agentxchain-multi.json',
        workspace_path: workspace,
      },
    });

    const snapshot = buildMissionSnapshot(workspace, artifact);
    assert.ok(snapshot.coordinator_status);
    assert.equal(snapshot.coordinator_status.super_run_id, initResult.super_run_id);
    assert.equal(snapshot.coordinator_status.status, 'active');
    assert.ok(snapshot.coordinator_status.repo_runs);
    assert.ok(snapshot.coordinator_status.repo_runs['repo-a']);
    assert.ok(snapshot.coordinator_status.repo_runs['repo-b']);
    assert.equal(snapshot.derived_status, 'progressing');
  });
});

// ── CLI registration tests ─────────────────────────────────────────────────

describe('Mission multi-repo bridge (CLI registration)', () => {
  it('S01: missionBindCoordinatorCommand is exported', async () => {
    const mod = await import('../src/commands/mission.js');
    assert.equal(typeof mod.missionBindCoordinatorCommand, 'function');
  });

  it('S02: bind-coordinator subcommand is registered in CLI', () => {
    const binContent = readFileSync(join(import.meta.dirname, '..', 'bin', 'agentxchain.js'), 'utf8');
    assert.ok(binContent.includes('missionBindCoordinatorCommand'), 'bind-coordinator command import exists');
    assert.ok(binContent.includes("'bind-coordinator"), 'bind-coordinator subcommand registered');
    assert.ok(binContent.includes('--super-run-id'), '--super-run-id option registered');
  });

  it('S03: mission start --multi option is registered in CLI', () => {
    const binContent = readFileSync(join(import.meta.dirname, '..', 'bin', 'agentxchain.js'), 'utf8');
    assert.ok(binContent.includes("'--multi'"), '--multi option registered');
    assert.ok(binContent.includes("'--coordinator-config"), '--coordinator-config option registered');
    assert.ok(binContent.includes("'--coordinator-workspace"), '--coordinator-workspace option registered');
  });

  it('S04: spec file exists', () => {
    const specPath = join(import.meta.dirname, '..', '..', '.planning', 'MULTI_REPO_MISSION_BRIDGE_SPEC.md');
    assert.ok(existsSync(specPath), 'MULTI_REPO_MISSION_BRIDGE_SPEC.md exists');
  });

  it('AT-MISSION-MULTI-007: mission list includes coordinator field for multi-repo missions', async () => {
    const dir = trackDir(createTmpDir());
    writeAgentxchainJson(dir);
    const { createMission, bindCoordinatorToMission, buildMissionListSummary } = await import('../src/lib/missions.js');

    // Single-repo mission
    createMission(dir, { missionId: 'mission-single', title: 'Single', goal: 'No coord' });

    // Multi-repo mission
    createMission(dir, { missionId: 'mission-multi', title: 'Multi', goal: 'With coord' });
    bindCoordinatorToMission(dir, 'mission-multi', {
      super_run_id: 'srun_list_test_001',
      config_path: null,
      workspace_path: dir,
    });

    const list = buildMissionListSummary(dir);
    assert.ok(list.length >= 2);

    const multiMission = list.find((m) => m.mission_id === 'mission-multi');
    assert.ok(multiMission);
    assert.ok(multiMission.coordinator);
    assert.equal(multiMission.coordinator.super_run_id, 'srun_list_test_001');

    const singleMission = list.find((m) => m.mission_id === 'mission-single');
    assert.ok(singleMission);
    assert.equal(singleMission.coordinator, undefined);
  });
});
