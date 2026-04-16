/**
 * Tests for `agentxchain chain` CLI commands: latest, list, show.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';

const cliRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const binPath = join(cliRoot, 'bin', 'agentxchain.js');
const chainCommandPath = join(cliRoot, 'src', 'commands', 'chain.js');

// ── Helpers ─────────────────────────────────────────────────────────────────

function createTmpProject() {
  const dir = join(tmpdir(), `axc-chain-test-${randomUUID().slice(0, 8)}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'agentxchain.json'), JSON.stringify({
    version: 4,
    project: { name: 'chain-test', id: 'test-001' },
    roles: { dev: { agent: 'manual' } },
    workflow: { phases: ['implementation'] },
  }, null, 2));
  return dir;
}

function writeChainReport(dir, report) {
  const reportsDir = join(dir, '.agentxchain', 'reports');
  mkdirSync(reportsDir, { recursive: true });
  writeFileSync(join(reportsDir, `${report.chain_id}.json`), JSON.stringify(report, null, 2));
}

function makeChainReport(overrides = {}) {
  const chainId = `chain-${randomUUID().slice(0, 8)}`;
  return {
    chain_id: chainId,
    started_at: new Date(Date.now() - 60000).toISOString(),
    completed_at: new Date().toISOString(),
    terminal_reason: 'chain_limit_reached',
    total_turns: 6,
    total_duration_ms: 45000,
    runs: [
      {
        run_id: `gov-${randomUUID().slice(0, 8)}`,
        status: 'completed',
        turns: 3,
        duration_ms: 20000,
        provenance_trigger: 'manual',
        parent_run_id: null,
        inherited_context_summary: null,
      },
      {
        run_id: `gov-${randomUUID().slice(0, 8)}`,
        status: 'completed',
        turns: 3,
        duration_ms: 25000,
        provenance_trigger: 'continuation',
        parent_run_id: 'gov-parent-001',
        inherited_context_summary: {
          parent_run_id: 'gov-parent-001',
          parent_status: 'completed',
          inherited_at: new Date().toISOString(),
          parent_roles_used: ['pm', 'dev', 'qa'],
          parent_phases_completed_count: 2,
          recent_decisions_count: 3,
          recent_accepted_turns_count: 5,
        },
      },
    ],
    ...overrides,
  };
}

function runCli(args, dir) {
  return execFileSync(process.execPath, [binPath, ...args], {
    cwd: dir,
    encoding: 'utf8',
    timeout: 10000,
    env: { ...process.env, NODE_NO_WARNINGS: '1' },
  });
}

// ── Structural guards ───────────────────────────────────────────────────────

describe('chain CLI — structural guards', () => {
  it('AT-CHAIN-CLI-001: chain.js command module exists and exports all commands', async () => {
    assert.ok(existsSync(chainCommandPath), 'chain.js must exist');
    const mod = await import(chainCommandPath);
    assert.equal(typeof mod.chainLatestCommand, 'function', 'chainLatestCommand must be exported');
    assert.equal(typeof mod.chainListCommand, 'function', 'chainListCommand must be exported');
    assert.equal(typeof mod.chainShowCommand, 'function', 'chainShowCommand must be exported');
  });

  it('AT-CHAIN-CLI-002: CLI registers chain subcommands', () => {
    const bin = readFileSync(binPath, 'utf8');
    assert.ok(bin.includes("command('chain')"), 'chain parent command must be registered');
    assert.ok(bin.includes("command('latest')"), 'chain latest subcommand must be registered');
    assert.ok(bin.includes("command('list')"), 'chain list subcommand must be registered');
    assert.ok(bin.includes("command('show"), 'chain show subcommand must be registered');
  });
});

// ── chain latest ────────────────────────────────────────────────────────────

describe('chain latest', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTmpProject();
  });

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  it('AT-CHAIN-CLI-003: shows "no chain reports" when none exist', () => {
    const output = runCli(['chain', 'latest', '-d', tmpDir], tmpDir);
    assert.ok(output.includes('No chain reports'), 'should indicate no chain reports found');
    assert.ok(output.includes('--chain'), 'should hint at run --chain');
  });

  it('AT-CHAIN-CLI-004: renders the latest chain report in text mode', () => {
    const report = makeChainReport();
    writeChainReport(tmpDir, report);

    const output = runCli(['chain', 'latest', '-d', tmpDir], tmpDir);
    assert.ok(output.includes(report.chain_id), 'should show chain ID');
    assert.ok(output.includes('Total runs'), 'should show total runs label');
    assert.ok(output.includes('2'), 'should show 2 runs');
    assert.ok(output.includes('chain limit reached'), 'should show terminal reason');
    assert.ok(output.includes('manual'), 'should show first run trigger');
    assert.ok(output.includes('continuation'), 'should show second run trigger');
  });

  it('AT-CHAIN-CLI-005: latest --json outputs valid JSON with full report', () => {
    const report = makeChainReport();
    writeChainReport(tmpDir, report);

    const output = runCli(['chain', 'latest', '--json', '-d', tmpDir], tmpDir);
    const parsed = JSON.parse(output);
    assert.equal(parsed.chain_id, report.chain_id);
    assert.equal(parsed.runs.length, 2);
    assert.equal(parsed.terminal_reason, 'chain_limit_reached');
    assert.equal(parsed.total_turns, 6);
  });

  it('AT-CHAIN-CLI-006: latest returns the most recent by started_at', () => {
    const older = makeChainReport({
      chain_id: 'chain-older',
      started_at: new Date(Date.now() - 120000).toISOString(),
    });
    const newer = makeChainReport({
      chain_id: 'chain-newer',
      started_at: new Date(Date.now() - 10000).toISOString(),
    });
    writeChainReport(tmpDir, older);
    writeChainReport(tmpDir, newer);

    const output = runCli(['chain', 'latest', '--json', '-d', tmpDir], tmpDir);
    const parsed = JSON.parse(output);
    assert.equal(parsed.chain_id, 'chain-newer', 'should return the newest chain report');
  });

  it('AT-CHAIN-CLI-007: latest renders inherited context summary counts', () => {
    const report = makeChainReport();
    writeChainReport(tmpDir, report);

    const output = runCli(['chain', 'latest', '-d', tmpDir], tmpDir);
    assert.ok(output.includes('3 roles'), 'should show inherited role count');
    assert.ok(output.includes('2 phases'), 'should show inherited phase count');
    assert.ok(output.includes('3 decisions'), 'should show inherited decision count');
    assert.ok(output.includes('5 turns'), 'should show inherited turn count');
  });
});

// ── chain list ──────────────────────────────────────────────────────────────

describe('chain list', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTmpProject();
  });

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  it('AT-CHAIN-CLI-008: shows "no chain reports" when none exist', () => {
    const output = runCli(['chain', 'list', '-d', tmpDir], tmpDir);
    assert.ok(output.includes('No chain reports'), 'should indicate no chain reports found');
  });

  it('AT-CHAIN-CLI-009: lists multiple chain reports newest first', () => {
    const older = makeChainReport({
      chain_id: 'chain-aaa',
      started_at: new Date(Date.now() - 120000).toISOString(),
      terminal_reason: 'completed',
    });
    const newer = makeChainReport({
      chain_id: 'chain-bbb',
      started_at: new Date(Date.now() - 10000).toISOString(),
      terminal_reason: 'chain_limit_reached',
    });
    writeChainReport(tmpDir, older);
    writeChainReport(tmpDir, newer);

    const output = runCli(['chain', 'list', '-d', tmpDir], tmpDir);
    const aaaPos = output.indexOf('chain-aaa');
    const bbbPos = output.indexOf('chain-bbb');
    assert.ok(bbbPos < aaaPos, 'newer chain should appear first');
    assert.ok(output.includes('2 chain(s) shown'), 'should show count');
  });

  it('AT-CHAIN-CLI-010: list --json outputs array of reports', () => {
    const r1 = makeChainReport({ chain_id: 'chain-json-1' });
    const r2 = makeChainReport({ chain_id: 'chain-json-2' });
    writeChainReport(tmpDir, r1);
    writeChainReport(tmpDir, r2);

    const output = runCli(['chain', 'list', '--json', '-d', tmpDir], tmpDir);
    const parsed = JSON.parse(output);
    assert.ok(Array.isArray(parsed), 'should be an array');
    assert.equal(parsed.length, 2);
  });

  it('AT-CHAIN-CLI-011: list --limit restricts output', () => {
    for (let i = 0; i < 5; i++) {
      writeChainReport(tmpDir, makeChainReport({
        chain_id: `chain-limit-${i}`,
        started_at: new Date(Date.now() - i * 10000).toISOString(),
      }));
    }

    const output = runCli(['chain', 'list', '--limit', '2', '--json', '-d', tmpDir], tmpDir);
    const parsed = JSON.parse(output);
    assert.equal(parsed.length, 2, 'should limit to 2 reports');
  });

  it('AT-CHAIN-CLI-012: list renders terminal reason with color-coded text', () => {
    writeChainReport(tmpDir, makeChainReport({
      chain_id: 'chain-term',
      terminal_reason: 'operator_abort',
    }));

    const output = runCli(['chain', 'list', '-d', tmpDir], tmpDir);
    assert.ok(output.includes('operator abort'), 'should render operator abort reason');
  });
});

// ── chain show ──────────────────────────────────────────────────────────────

describe('chain show', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTmpProject();
  });

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  });

  it('AT-CHAIN-CLI-013: show renders a specific chain report', () => {
    const report = makeChainReport({ chain_id: 'chain-show-test' });
    writeChainReport(tmpDir, report);

    const output = runCli(['chain', 'show', 'chain-show-test', '-d', tmpDir], tmpDir);
    assert.ok(output.includes('chain-show-test'), 'should show the chain ID');
    assert.ok(output.includes('Total runs'), 'should show total runs');
    assert.ok(output.includes('continuation'), 'should show continuation trigger');
  });

  it('AT-CHAIN-CLI-014: show --json outputs valid JSON for specific chain', () => {
    const report = makeChainReport({ chain_id: 'chain-json-show' });
    writeChainReport(tmpDir, report);

    const output = runCli(['chain', 'show', 'chain-json-show', '--json', '-d', tmpDir], tmpDir);
    const parsed = JSON.parse(output);
    assert.equal(parsed.chain_id, 'chain-json-show');
    assert.equal(parsed.runs.length, 2);
  });

  it('AT-CHAIN-CLI-015: show exits with error for nonexistent chain', () => {
    assert.throws(
      () => runCli(['chain', 'show', 'chain-does-not-exist', '-d', tmpDir], tmpDir),
      (err) => {
        assert.ok(err.stderr?.includes('not found') || err.status !== 0, 'should exit with error');
        return true;
      },
    );
  });
});
