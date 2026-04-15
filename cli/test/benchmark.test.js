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
    assert.equal(payload.workload, 'baseline');
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
    assert.equal(payload.workload, 'stress');
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
      assert.equal(persistedMetrics.workload, 'baseline');
      assert.equal(persistedWorkload.mode, 'baseline');
      assert.equal(persistedWorkload.workload, 'baseline');
      assert.equal(persistedWorkload.rejected_turn_expected, false);
      assert.equal(persistedWorkload.gate_failure_expected, false);
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

  it('AT-BENCH-013: --workload stress resolves the named stress workload', () => {
    const result = runCli(['benchmark', '--json', '--workload', 'stress']);
    assert.equal(result.status, 0, `Expected exit 0, got ${result.status}. stderr: ${result.stderr}`);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.result, 'pass');
    assert.equal(payload.mode, 'stress');
    assert.equal(payload.workload, 'stress');
    assert.ok(payload.turns.rejected >= 1, 'Stress workload should include a rejected turn');
  });

  it('AT-BENCH-014: completion-recovery workload records a failed completion gate before passing', () => {
    const result = runCli(['benchmark', '--json', '--workload', 'completion-recovery']);
    assert.equal(result.status, 0, `Expected exit 0, got ${result.status}. stderr: ${result.stderr}`);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.result, 'pass');
    assert.equal(payload.mode, 'completion-recovery');
    assert.equal(payload.workload, 'completion-recovery');
    assert.equal(payload.turns.rejected, 0, 'Completion recovery should not use rejected turns');
    assert.ok(payload.gates.failed >= 1, `Expected at least one failed gate evaluation, got ${payload.gates.failed}`);
    assert.equal(payload.phases.completed, 3);
    assert.equal(payload.export_verification, 'pass');
  });

  it('AT-BENCH-015: conflicting --stress and --workload values fail closed', () => {
    const result = runCli(['benchmark', '--json', '--stress', '--workload', 'baseline']);
    assert.equal(result.status, 1, `Expected exit 1, got ${result.status}. stdout: ${result.stdout} stderr: ${result.stderr}`);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.result, 'fail');
    assert.match(payload.error, /conflicting benchmark workload options/i);
    assert.deepEqual(payload.valid_workloads, ['baseline', 'stress', 'completion-recovery', 'phase-drift']);
  });

  it('AT-BENCH-016: saved baseline and completion-recovery artifacts pass verify diff', () => {
    const baselineDir = mkdtempSync(join(tmpdir(), 'agentxchain-benchmark-baseline-diff-'));
    const recoveryDir = mkdtempSync(join(tmpdir(), 'agentxchain-benchmark-completion-recovery-'));
    try {
      const baseline = runCli(['benchmark', '--json', '--workload', 'baseline', '--output', baselineDir]);
      assert.equal(baseline.status, 0, `Expected baseline exit 0, got ${baseline.status}. stderr: ${baseline.stderr}`);
      const baselinePayload = JSON.parse(baseline.stdout);

      const recovery = runCli(['benchmark', '--json', '--workload', 'completion-recovery', '--output', recoveryDir]);
      assert.equal(recovery.status, 0, `Expected completion-recovery exit 0, got ${recovery.status}. stderr: ${recovery.stderr}`);
      const recoveryPayload = JSON.parse(recovery.stdout);

      const diff = runCli(['verify', 'diff', baselinePayload.proof_artifacts.export, recoveryPayload.proof_artifacts.export, '--format', 'json']);
      assert.equal(diff.status, 0, `Expected verify diff exit 0, got ${diff.status}. stderr: ${diff.stderr}`);
      const report = JSON.parse(diff.stdout);
      assert.equal(report.overall, 'pass');
      assert.ok(report.diff, 'Expected diff payload');
      assert.equal(report.diff.has_regressions, false);
    } finally {
      rmSync(baselineDir, { recursive: true, force: true });
      rmSync(recoveryDir, { recursive: true, force: true });
    }
  });

  it('AT-BENCH-017: phase-drift workload completes all 4 phases with export verification', () => {
    const result = runCli(['benchmark', '--json', '--workload', 'phase-drift']);
    assert.equal(result.status, 0, `Expected exit 0, got ${result.status}. stderr: ${result.stderr}`);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.result, 'pass');
    assert.equal(payload.mode, 'phase-drift');
    assert.equal(payload.workload, 'phase-drift');
    assert.equal(payload.phases.completed, 4);
    assert.equal(payload.phases.total, 4);
    assert.deepEqual(payload.phases.names, ['planning', 'design', 'implementation', 'qa']);
    assert.equal(payload.turns.total, 4);
    assert.equal(payload.turns.rejected, 0);
    assert.equal(payload.gates.passed, 4);
    assert.equal(payload.gates.failed, 0);
    assert.equal(payload.export_verification, 'pass');
  });

  it('AT-BENCH-018: baseline vs phase-drift verify diff detects REG-PHASE-ORDER regression', () => {
    const baselineDir = mkdtempSync(join(tmpdir(), 'agentxchain-benchmark-baseline-phdrift-'));
    const driftDir = mkdtempSync(join(tmpdir(), 'agentxchain-benchmark-phase-drift-'));
    try {
      const baseline = runCli(['benchmark', '--json', '--workload', 'baseline', '--output', baselineDir]);
      assert.equal(baseline.status, 0, `Expected baseline exit 0, got ${baseline.status}. stderr: ${baseline.stderr}`);
      const baselinePayload = JSON.parse(baseline.stdout);

      const drift = runCli(['benchmark', '--json', '--workload', 'phase-drift', '--output', driftDir]);
      assert.equal(drift.status, 0, `Expected phase-drift exit 0, got ${drift.status}. stderr: ${drift.stderr}`);
      const driftPayload = JSON.parse(drift.stdout);

      const diff = runCli(['verify', 'diff', baselinePayload.proof_artifacts.export, driftPayload.proof_artifacts.export, '--format', 'json']);
      // verify diff exits 1 because has_regressions is true — this is correct
      assert.equal(diff.status, 1, `Expected verify diff exit 1 (regressions detected), got ${diff.status}`);
      const report = JSON.parse(diff.stdout);
      assert.equal(report.diff.has_regressions, true);
      assert.equal(report.diff.regression_count, 1);
      assert.equal(report.diff.regressions[0].id, 'REG-PHASE-ORDER-001');
      assert.equal(report.diff.regressions[0].category, 'phase');
      assert.equal(report.diff.regressions[0].severity, 'warning');
      assert.deepEqual(report.diff.regressions[0].left, ['planning', 'implementation', 'qa']);
      assert.deepEqual(report.diff.regressions[0].right, ['planning', 'design', 'implementation', 'qa']);
    } finally {
      rmSync(baselineDir, { recursive: true, force: true });
      rmSync(driftDir, { recursive: true, force: true });
    }
  });

  it('AT-BENCH-019: benchmark workloads subcommand lists all workloads', () => {
    const result = runCli(['benchmark', 'workloads']);
    assert.equal(result.status, 0, `Expected exit 0, got ${result.status}. stderr: ${result.stderr}`);
    assert.ok(result.stdout.includes('baseline'), 'Should list baseline');
    assert.ok(result.stdout.includes('stress'), 'Should list stress');
    assert.ok(result.stdout.includes('completion-recovery'), 'Should list completion-recovery');
    assert.ok(result.stdout.includes('phase-drift'), 'Should list phase-drift');
    assert.ok(result.stdout.includes('agentxchain benchmark --workload'), 'Should show usage hint');
  });

  it('AT-BENCH-020: benchmark workloads --json returns structured catalog', () => {
    const result = runCli(['benchmark', 'workloads', '--json']);
    assert.equal(result.status, 0, `Expected exit 0, got ${result.status}. stderr: ${result.stderr}`);
    const payload = JSON.parse(result.stdout);
    assert.ok(Array.isArray(payload.workloads), 'Should have workloads array');
    assert.equal(payload.workloads.length, 4);
    const ids = payload.workloads.map(w => w.id);
    assert.deepEqual(ids, ['baseline', 'stress', 'completion-recovery', 'phase-drift']);
    for (const w of payload.workloads) {
      assert.ok(w.id, 'Each workload needs id');
      assert.ok(w.label, 'Each workload needs label');
      assert.ok(w.description, 'Each workload needs description');
      assert.ok(typeof w.rejected_turn_expected === 'boolean', 'Each workload needs rejected_turn_expected');
      assert.ok(typeof w.gate_failure_expected === 'boolean', 'Each workload needs gate_failure_expected');
      assert.ok(typeof w.recovery_branch === 'string', 'Each workload needs recovery_branch');
    }
  });
});
