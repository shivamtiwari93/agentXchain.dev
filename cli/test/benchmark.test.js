import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI_BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'agentxchain.js');

function runCli(args, timeout = 30000) {
  return spawnSync(process.execPath, [CLI_BIN, ...args], {
    encoding: 'utf8',
    timeout,
    env: { ...process.env, NO_COLOR: '1' },
  });
}

describe('benchmark command', () => {
  it('AT-BENCH-001: benchmark completes with exit 0 and prints PASS', () => {
    const result = runCli(['benchmark']);
    assert.equal(result.status, 0, `Expected exit 0, got ${result.status}. stderr: ${result.stderr}`);
    assert.ok(result.stdout.includes('PASS'), 'Should print PASS');
    assert.ok(result.stdout.includes('Phases completed'), 'Should print phases');
  });

  it('AT-BENCH-002: benchmark --json returns valid JSON with result: pass', () => {
    const result = runCli(['benchmark', '--json']);
    assert.equal(result.status, 0, `Expected exit 0, got ${result.status}. stderr: ${result.stderr}`);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.result, 'pass');
    assert.equal(payload.version, '1.0');
  });

  it('AT-BENCH-003: elapsed time is reported and > 0', () => {
    const result = runCli(['benchmark', '--json']);
    const payload = JSON.parse(result.stdout);
    assert.ok(payload.elapsed_ms > 0, `Elapsed should be > 0, got ${payload.elapsed_ms}`);
  });

  it('AT-BENCH-004: all three default phases are completed', () => {
    const result = runCli(['benchmark', '--json']);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.phases.completed, 3);
    assert.equal(payload.phases.total, 3);
    assert.deepEqual(payload.phases.names, ['planning', 'implementation', 'qa']);
  });

  it('AT-BENCH-005: admission control passes', () => {
    const result = runCli(['benchmark', '--json']);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.admission_control, 'pass');
  });

  it('AT-BENCH-006: all gates pass', () => {
    const result = runCli(['benchmark', '--json']);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.gates.passed, payload.gates.evaluated);
    assert.equal(payload.gates.failed, 0);
    assert.ok(payload.gates.evaluated >= 3, 'Should evaluate at least 3 gates');
  });

  it('AT-BENCH-007: turns are distributed across all phases', () => {
    const result = runCli(['benchmark', '--json']);
    const payload = JSON.parse(result.stdout);
    assert.ok(payload.turns.total >= 3, 'Should have at least 3 turns');
    assert.ok(payload.turns.per_phase.planning >= 1);
    assert.ok(payload.turns.per_phase.implementation >= 1);
    assert.ok(payload.turns.per_phase.qa >= 1);
  });
});
