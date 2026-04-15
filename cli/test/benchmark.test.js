import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const CLI_BIN = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'agentxchain.js');

function runCli(args, timeout = 30000) {
  return spawnSync(process.execPath, [CLI_BIN, ...args], {
    encoding: 'utf8',
    timeout,
    env: { ...process.env, NO_COLOR: '1' },
  });
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
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
    assert.equal(payload.mode, 'baseline');
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

  it('AT-BENCH-006: export verification passes', () => {
    const result = runCli(['benchmark', '--json']);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.export_verification, 'pass');
  });

  it('AT-BENCH-007: all gates pass', () => {
    const result = runCli(['benchmark', '--json']);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.gates.passed, payload.gates.evaluated);
    assert.equal(payload.gates.failed, 0);
    assert.ok(payload.gates.evaluated >= 3, 'Should evaluate at least 3 gates');
  });

  it('AT-BENCH-008: turns are distributed across all phases', () => {
    const result = runCli(['benchmark', '--json']);
    const payload = JSON.parse(result.stdout);
    assert.ok(payload.turns.total >= 3, 'Should have at least 3 turns');
    assert.ok(payload.turns.per_phase.planning >= 1);
    assert.ok(payload.turns.per_phase.implementation >= 1);
    assert.ok(payload.turns.per_phase.qa >= 1);
  });

  it('AT-BENCH-009: stress mode records a rejected turn and still passes', () => {
    const result = runCli(['benchmark', '--json', '--stress']);
    assert.equal(result.status, 0, `Expected exit 0, got ${result.status}. stderr: ${result.stderr}`);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.result, 'pass');
    assert.equal(payload.mode, 'stress');
    assert.ok(payload.turns.rejected >= 1, `Expected at least one rejected turn, got ${payload.turns.rejected}`);
    assert.ok(payload.turns.total > payload.turns.accepted, 'Stress mode should include at least one rejected attempt');
    assert.equal(payload.export_verification, 'pass');
    assert.equal(payload.phases.completed, 3);
    assert.equal(payload.gates.failed, 0);
  });

  it('AT-BENCH-010: benchmark --output writes durable proof artifacts', () => {
    const outputDir = mkdtempSync(join(tmpdir(), 'agentxchain-benchmark-output-'));
    try {
      const result = runCli(['benchmark', '--json', '--output', outputDir]);
      assert.equal(result.status, 0, `Expected exit 0, got ${result.status}. stderr: ${result.stderr}`);
      const payload = JSON.parse(result.stdout);

      assert.ok(payload.proof_artifacts, 'Expected proof_artifacts in benchmark payload');
      assert.equal(payload.proof_artifacts.directory, outputDir);
      assert.ok(existsSync(payload.proof_artifacts.metrics), 'metrics.json should exist');
      assert.ok(existsSync(payload.proof_artifacts.export), 'run-export.json should exist');
      assert.ok(existsSync(payload.proof_artifacts.verify_export), 'verify-export.json should exist');
      assert.ok(existsSync(payload.proof_artifacts.workload), 'workload.json should exist');

      const persistedMetrics = readJson(payload.proof_artifacts.metrics);
      const persistedWorkload = readJson(payload.proof_artifacts.workload);
      const persistedVerifyExport = readJson(payload.proof_artifacts.verify_export);

      assert.equal(persistedMetrics.result, 'pass');
      assert.equal(persistedMetrics.export_verification, 'pass');
      assert.equal(persistedWorkload.mode, 'baseline');
      assert.equal(persistedWorkload.rejected_turn_expected, false);
      assert.equal(persistedVerifyExport.overall, 'pass');
    } finally {
      rmSync(outputDir, { recursive: true, force: true });
    }
  });

  it('AT-BENCH-011: saved benchmark export passes verify export', () => {
    const outputDir = mkdtempSync(join(tmpdir(), 'agentxchain-benchmark-export-'));
    try {
      const benchmark = runCli(['benchmark', '--json', '--output', outputDir]);
      assert.equal(benchmark.status, 0, `Expected benchmark exit 0, got ${benchmark.status}. stderr: ${benchmark.stderr}`);
      const payload = JSON.parse(benchmark.stdout);

      const verification = runCli(['verify', 'export', '--input', payload.proof_artifacts.export, '--format', 'json']);
      assert.equal(verification.status, 0, `Expected verify export exit 0, got ${verification.status}. stderr: ${verification.stderr}`);
      const report = JSON.parse(verification.stdout);
      assert.equal(report.overall, 'pass');
    } finally {
      rmSync(outputDir, { recursive: true, force: true });
    }
  });

  it('AT-BENCH-012: saved baseline and stress artifacts pass verify diff', () => {
    const baselineDir = mkdtempSync(join(tmpdir(), 'agentxchain-benchmark-baseline-'));
    const stressDir = mkdtempSync(join(tmpdir(), 'agentxchain-benchmark-stress-'));
    try {
      const baseline = runCli(['benchmark', '--json', '--output', baselineDir]);
      assert.equal(baseline.status, 0, `Expected baseline exit 0, got ${baseline.status}. stderr: ${baseline.stderr}`);
      const baselinePayload = JSON.parse(baseline.stdout);

      const stress = runCli(['benchmark', '--json', '--stress', '--output', stressDir]);
      assert.equal(stress.status, 0, `Expected stress exit 0, got ${stress.status}. stderr: ${stress.stderr}`);
      const stressPayload = JSON.parse(stress.stdout);

      const diff = runCli(['verify', 'diff', baselinePayload.proof_artifacts.export, stressPayload.proof_artifacts.export, '--format', 'json']);
      assert.equal(diff.status, 0, `Expected verify diff exit 0, got ${diff.status}. stderr: ${diff.stderr}`);
      const report = JSON.parse(diff.stdout);
      assert.equal(report.overall, 'pass');
      assert.ok(report.diff, 'Expected diff payload');
      assert.equal(report.diff.has_regressions, false);
    } finally {
      rmSync(baselineDir, { recursive: true, force: true });
      rmSync(stressDir, { recursive: true, force: true });
    }
  });
});
