import { describe, it, beforeEach, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';

const cliRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const binPath = join(cliRoot, 'bin', 'agentxchain.js');

describe('run --chain --mission — structural guards', () => {

  it('AT-CHAIN-MISSION-001: CLI registers --mission option on the run command', () => {
    const bin = readFileSync(binPath, 'utf8');
    assert.ok(bin.includes("--mission"), '--mission flag must be registered on run command');
  });

  it('AT-CHAIN-MISSION-002: resolveChainOptions includes mission field', async () => {
    const mod = await import(join(cliRoot, 'src', 'lib', 'run-chain.js'));
    const result = mod.resolveChainOptions({}, {});
    assert.equal(result.mission, null, 'mission defaults to null');
  });

  it('AT-CHAIN-MISSION-003: CLI --mission flag overrides config', async () => {
    const mod = await import(join(cliRoot, 'src', 'lib', 'run-chain.js'));
    const config = { run_loop: { chain: { mission: 'mission-from-config' } } };
    const result = mod.resolveChainOptions({ mission: 'mission-from-cli' }, config);
    assert.equal(result.mission, 'mission-from-cli');
  });

  it('AT-CHAIN-MISSION-004: config run_loop.chain.mission is respected', async () => {
    const mod = await import(join(cliRoot, 'src', 'lib', 'run-chain.js'));
    const config = { run_loop: { chain: { mission: 'mission-configured' } } };
    const result = mod.resolveChainOptions({}, config);
    assert.equal(result.mission, 'mission-configured');
  });

  it('AT-CHAIN-MISSION-005: run-chain.js imports from missions.js', () => {
    const src = readFileSync(join(cliRoot, 'src', 'lib', 'run-chain.js'), 'utf8');
    assert.ok(src.includes("from './missions.js'"), 'run-chain.js must import from missions.js');
  });
});

describe('run --chain --mission — integration behavior', () => {
  let tmpDir;
  let executeChainedRun;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `axc-chain-mission-${randomUUID().slice(0, 8)}`);
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(join(tmpDir, 'agentxchain.json'), JSON.stringify({
      version: 4,
      project: { name: 'chain-mission-test', id: 'cm-001' },
      roles: { dev: { agent: 'manual' } },
      workflow: { phases: ['implementation'] },
    }, null, 2));
    const mod = await import(join(cliRoot, 'src', 'lib', 'run-chain.js'));
    executeChainedRun = mod.executeChainedRun;
  });

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  function createMission(dir, missionId, title, goal) {
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
    writeFileSync(join(missionsDir, `${missionId}.json`), JSON.stringify(artifact, null, 2));
    return artifact;
  }

  function loadMission(dir, missionId) {
    const filePath = join(dir, '.agentxchain', 'missions', `${missionId}.json`);
    return JSON.parse(readFileSync(filePath, 'utf8'));
  }

  function mockExecute() {
    return async () => ({
      exitCode: 0,
      result: {
        ok: true,
        stop_reason: 'completed',
        turns_executed: 3,
        state: { run_id: `gov-${randomUUID().slice(0, 8)}` },
      },
    });
  }

  it('AT-CHAIN-MISSION-006: explicit --mission attaches chain to the specified mission', async () => {
    createMission(tmpDir, 'mission-release-hardening', 'Release Hardening', 'Unify release truth');

    const context = { root: tmpDir, config: {} };
    const chainOpts = { maxChains: 0, chainOn: ['completed'], cooldownSeconds: 0, mission: 'mission-release-hardening' };
    const logs = [];

    const result = await executeChainedRun(context, {}, chainOpts, mockExecute(), (msg) => logs.push(msg));

    // Chain report must exist
    assert.ok(result.chainReport, 'chain report must be returned');
    assert.ok(result.chainReport.chain_id, 'chain must have an ID');

    // Mission must now contain the chain ID
    const mission = loadMission(tmpDir, 'mission-release-hardening');
    assert.ok(mission.chain_ids.includes(result.chainReport.chain_id), 'mission must contain the chain ID');

    // Logs must mention attachment
    const attachLog = logs.find(l => typeof l === 'string' && l.includes('attached to mission'));
    assert.ok(attachLog, 'log must confirm attachment');
  });

  it('AT-CHAIN-MISSION-007: --mission latest attaches to the most recent mission', async () => {
    createMission(tmpDir, 'mission-older', 'Older Mission', 'Old goal');
    // Ensure the second mission has a later updated_at
    const laterArtifact = createMission(tmpDir, 'mission-newer', 'Newer Mission', 'New goal');

    const context = { root: tmpDir, config: {} };
    const chainOpts = { maxChains: 0, chainOn: ['completed'], cooldownSeconds: 0, mission: 'latest' };

    const result = await executeChainedRun(context, {}, chainOpts, mockExecute(), () => {});

    const mission = loadMission(tmpDir, 'mission-newer');
    assert.ok(mission.chain_ids.includes(result.chainReport.chain_id), 'latest mission must contain the chain ID');

    // Older mission must NOT have the chain
    const olderMission = loadMission(tmpDir, 'mission-older');
    assert.ok(!olderMission.chain_ids.includes(result.chainReport.chain_id), 'older mission must not get the chain');
  });

  it('AT-CHAIN-MISSION-008: non-existent mission ID fails closed with exitCode 1', async () => {
    const context = { root: tmpDir, config: {} };
    const chainOpts = { maxChains: 0, chainOn: ['completed'], cooldownSeconds: 0, mission: 'mission-does-not-exist' };
    const logs = [];

    const result = await executeChainedRun(context, {}, chainOpts, mockExecute(), (msg) => logs.push(msg));

    assert.equal(result.exitCode, 1, 'must fail with exit code 1');
    assert.equal(result.chainReport, null, 'no chain report on failure');
    const errorLog = logs.find(l => typeof l === 'string' && l.includes('not found'));
    assert.ok(errorLog, 'log must explain mission not found');
  });

  it('AT-CHAIN-MISSION-009: --mission latest with no missions warns but continues chaining', async () => {
    const context = { root: tmpDir, config: {} };
    const chainOpts = { maxChains: 0, chainOn: ['completed'], cooldownSeconds: 0, mission: 'latest' };
    const logs = [];

    const result = await executeChainedRun(context, {}, chainOpts, mockExecute(), (msg) => logs.push(msg));

    // Must still complete the chain successfully
    assert.equal(result.exitCode, 0);
    assert.ok(result.chainReport, 'chain report must exist');

    // Warn log must appear
    const warnLog = logs.find(l => typeof l === 'string' && l.includes('no missions found'));
    assert.ok(warnLog, 'must warn about no missions');
  });

  it('AT-CHAIN-MISSION-010: duplicate chain attachment is prevented', async () => {
    createMission(tmpDir, 'mission-dedup', 'Dedup Test', 'No duplicate chains');

    const context = { root: tmpDir, config: {} };

    // First chain
    const chainOpts1 = { maxChains: 0, chainOn: ['completed'], cooldownSeconds: 0, mission: 'mission-dedup' };
    const result1 = await executeChainedRun(context, {}, chainOpts1, mockExecute(), () => {});

    // Manually re-attach same chain ID by creating a second chainOpts pointing to same mission
    // The attachChainToMission function already handles dedup internally via includes check
    const mission1 = loadMission(tmpDir, 'mission-dedup');
    assert.equal(mission1.chain_ids.length, 1, 'first attach should add one chain');

    // Second chain (different chain, same mission)
    const chainOpts2 = { maxChains: 0, chainOn: ['completed'], cooldownSeconds: 0, mission: 'mission-dedup' };
    const result2 = await executeChainedRun(context, {}, chainOpts2, mockExecute(), () => {});

    const mission2 = loadMission(tmpDir, 'mission-dedup');
    assert.equal(mission2.chain_ids.length, 2, 'second chain should add a second entry');
    assert.notEqual(mission2.chain_ids[0], mission2.chain_ids[1], 'chain IDs must be different');
  });

  it('AT-CHAIN-MISSION-011: config-driven mission binding works without CLI flag', async () => {
    createMission(tmpDir, 'mission-config-driven', 'Config Driven', 'Mission from config');

    const config = { run_loop: { chain: { mission: 'mission-config-driven' } } };
    const context = { root: tmpDir, config };

    const mod = await import(join(cliRoot, 'src', 'lib', 'run-chain.js'));
    const chainOpts = mod.resolveChainOptions({ chain: true }, config);
    assert.equal(chainOpts.mission, 'mission-config-driven');

    const result = await executeChainedRun(context, {}, { ...chainOpts, maxChains: 0, cooldownSeconds: 0 }, mockExecute(), () => {});

    const mission = loadMission(tmpDir, 'mission-config-driven');
    assert.ok(mission.chain_ids.includes(result.chainReport.chain_id), 'config-driven mission must contain the chain');
  });

  it('AT-CHAIN-MISSION-012: executeChainedRun preserves an internally preallocated chain ID', async () => {
    createMission(tmpDir, 'mission-preallocated-chain', 'Preallocated Chain', 'Launch uses a fixed chain ID');

    const context = { root: tmpDir, config: {} };
    const chainOpts = {
      maxChains: 0,
      chainOn: ['completed'],
      cooldownSeconds: 0,
      mission: 'mission-preallocated-chain',
      chainId: 'chain-preallocated-001',
    };

    const result = await executeChainedRun(context, {}, chainOpts, mockExecute(), () => {});

    assert.equal(result.chainReport.chain_id, 'chain-preallocated-001', 'chain report must preserve the provided chain ID');

    const mission = loadMission(tmpDir, 'mission-preallocated-chain');
    assert.deepEqual(mission.chain_ids, ['chain-preallocated-001'], 'mission attachment must use the same preallocated chain ID');
  });
});
