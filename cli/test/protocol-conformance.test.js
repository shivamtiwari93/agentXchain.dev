import { strict as assert } from 'node:assert';
import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(__dirname, '..', 'bin', 'agentxchain.js');
const REPO_ROOT = join(__dirname, '..', '..');

function runCli(args, cwd = REPO_ROOT) {
  return spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd,
    encoding: 'utf8',
  });
}

describe('protocol conformance verifier', () => {
  it('passes Tier 1 self-validation against the reference adapter', () => {
    const result = runCli(['verify', 'protocol', '--tier', '1', '--target', '.', '--format', 'json']);
    assert.equal(result.status, 0, result.stderr);

    const report = JSON.parse(result.stdout);
    assert.equal(report.overall, 'pass');
    assert.equal(report.results.tier_1.fixtures_run, 40);
    assert.equal(report.results.tier_1.fixtures_passed, 40);
  });

  it('passes Tier 2 self-validation against the reference adapter', () => {
    const result = runCli(['verify', 'protocol', '--tier', '2', '--target', '.', '--format', 'json']);
    assert.equal(result.status, 0, result.stderr);

    const report = JSON.parse(result.stdout);
    assert.equal(report.overall, 'pass');
    assert.equal(report.results.tier_1.fixtures_run, 40);
    assert.equal(report.results.tier_1.fixtures_passed, 40);
    assert.equal(report.results.tier_2.fixtures_run, 8);
    assert.equal(report.results.tier_2.fixtures_passed, 8);
  });

  it('supports Tier 2 surface filtering for dispatch manifest fixtures', () => {
    const result = runCli([
      'verify',
      'protocol',
      '--tier',
      '2',
      '--surface',
      'dispatch_manifest',
      '--target',
      '.',
      '--format',
      'json',
    ]);
    assert.equal(result.status, 0, result.stderr);

    const report = JSON.parse(result.stdout);
    assert.equal(report.overall, 'pass');
    assert.equal(report.results.tier_1.fixtures_run, 0);
    assert.equal(report.results.tier_2.fixtures_run, 5);
    assert.equal(report.results.tier_2.fixtures_passed, 5);
    assert.deepEqual(Object.keys(report.results.tier_2.surfaces), ['dispatch_manifest']);
  });

  it('passes Tier 3 self-validation against the reference adapter', () => {
    const result = runCli(['verify', 'protocol', '--tier', '3', '--target', '.', '--format', 'json']);
    assert.equal(result.status, 0, result.stderr);

    const report = JSON.parse(result.stdout);
    assert.equal(report.overall, 'pass');
    assert.equal(report.results.tier_1.fixtures_run, 40);
    assert.equal(report.results.tier_1.fixtures_passed, 40);
    assert.equal(report.results.tier_2.fixtures_run, 8);
    assert.equal(report.results.tier_2.fixtures_passed, 8);
    assert.equal(report.results.tier_3.fixtures_run, 5);
    assert.equal(report.results.tier_3.fixtures_passed, 5);
  });

  it('supports Tier 3 surface filtering for coordinator fixtures', () => {
    const result = runCli([
      'verify',
      'protocol',
      '--tier',
      '3',
      '--surface',
      'coordinator',
      '--target',
      '.',
      '--format',
      'json',
    ]);
    assert.equal(result.status, 0, result.stderr);

    const report = JSON.parse(result.stdout);
    assert.equal(report.overall, 'pass');
    assert.equal(report.results.tier_1.fixtures_run, 0);
    assert.equal(report.results.tier_2.fixtures_run, 0);
    assert.equal(report.results.tier_3.fixtures_run, 5);
    assert.equal(report.results.tier_3.fixtures_passed, 5);
    assert.deepEqual(Object.keys(report.results.tier_3.surfaces), ['coordinator']);
  });

  it('surfaces fixture failures as exit code 1', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agentxchain-conformance-fail-'));
    try {
      mkdirSync(join(dir, '.agentxchain-conformance'), { recursive: true });
      writeFileSync(join(dir, '.agentxchain-conformance', 'capabilities.json'), JSON.stringify({
        implementation: 'fake-target',
        protocol_version: 'v6',
        adapter: {
          protocol: 'stdio-fixture-v1',
          command: ['node', '.agentxchain-conformance/failing-adapter.js'],
        },
        tiers: [1],
        surfaces: {
          state_machine: true,
        },
      }, null, 2));
      writeFileSync(join(dir, '.agentxchain-conformance', 'failing-adapter.js'), `process.stdin.resume();process.stdin.on('data',()=>{});process.stdin.on('end',()=>{process.stdout.write(JSON.stringify({status:'fail',message:'intentional failure',actual:{}})+'\\n');process.exit(1);});`);

      const result = runCli(['verify', 'protocol', '--tier', '1', '--surface', 'state_machine', '--target', dir, '--format', 'json']);
      assert.equal(result.status, 1, result.stderr);

      const report = JSON.parse(result.stdout);
      assert.equal(report.overall, 'fail');
      assert.ok(report.results.tier_1.fixtures_failed > 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('surfaces malformed adapter responses as exit code 2', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agentxchain-conformance-error-'));
    try {
      mkdirSync(join(dir, '.agentxchain-conformance'), { recursive: true });
      const adapterPath = join(dir, '.agentxchain-conformance', 'bad-adapter.js');
      writeFileSync(join(dir, '.agentxchain-conformance', 'capabilities.json'), JSON.stringify({
        implementation: 'bad-target',
        protocol_version: 'v6',
        adapter: {
          protocol: 'stdio-fixture-v1',
          command: ['node', '.agentxchain-conformance/bad-adapter.js'],
        },
        tiers: [1],
        surfaces: {
          state_machine: true,
        },
      }, null, 2));
      writeFileSync(adapterPath, `process.stdin.resume();process.stdin.on('data',()=>{});process.stdin.on('end',()=>{process.stdout.write('not-json\\n');process.exit(2);});`);
      chmodSync(adapterPath, 0o755);

      const result = runCli(['verify', 'protocol', '--tier', '1', '--surface', 'state_machine', '--target', dir, '--format', 'json']);
      assert.equal(result.status, 2, result.stderr);

      const report = JSON.parse(result.stdout);
      assert.equal(report.overall, 'error');
      assert.ok(report.results.tier_1.fixtures_errored > 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
