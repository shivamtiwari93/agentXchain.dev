import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { buildExportDiff } from '../src/lib/export-diff.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(__dirname, '..', 'bin', 'agentxchain.js');

function makeTmpDir() {
  const dir = join(tmpdir(), `reg-test-${randomBytes(6).toString('hex')}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function makeRunExport(overrides = {}) {
  const base = {
    export_kind: 'agentxchain_run_export',
    schema_version: '0.3',
    project: { name: 'Test', goal: 'test goal' },
    summary: {
      run_id: 'run_test_001',
      status: 'completed',
      phase: 'done',
      project_goal: 'test goal',
      provenance: { trigger: 'manual' },
      history_entries: 5,
      decision_entries: 2,
      hook_audit_entries: 1,
      notification_audit_entries: 0,
      dispatch_artifact_files: 1,
      staging_artifact_files: 0,
      active_turn_ids: [],
      retained_turn_ids: [],
      dashboard_session: { status: 'absent' },
      delegation_summary: { total_delegations_issued: 0 },
      repo_decisions: { active_count: 1, overridden_count: 0, active: [{ id: 'DEC-100' }], overridden: [] },
    },
    state: {
      budget_status: { warn_mode: false, exhausted: false },
      phase_gate_status: { planning_signoff: 'passed' },
    },
  };
  return mergeDeep(base, overrides);
}

function makeCoordinatorExport(overrides = {}) {
  const base = {
    export_kind: 'agentxchain_coordinator_export',
    schema_version: '0.3',
    coordinator: { project_name: 'Coord Test' },
    summary: {
      super_run_id: 'super_001',
      status: 'completed',
      phase: 'done',
      barrier_count: 3,
      history_entries: 10,
      decision_entries: 4,
      repo_run_statuses: { web: 'completed', api: 'completed' },
      aggregated_events: {
        total_events: 20,
        repos_with_events: ['web', 'api'],
        event_type_counts: { run_started: 2, run_completed: 2 },
      },
    },
    repos: {
      web: { ok: true },
      api: { ok: true },
    },
    state: {
      budget_status: { warn_mode: false, exhausted: false },
      phase_gate_status: {},
    },
  };
  return mergeDeep(base, overrides);
}

function mergeDeep(target, source) {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])
      && target[key] && typeof target[key] === 'object' && !Array.isArray(target[key])) {
      result[key] = mergeDeep(target[key], source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

describe('Export diff regression detection', () => {
  describe('Run export regressions', () => {
    it('AT-REG-001: status completed -> failed produces status regression', () => {
      const left = makeRunExport();
      const right = makeRunExport({ summary: { status: 'failed' } });
      const result = buildExportDiff(left, right);
      assert.ok(result.ok);
      assert.ok(result.diff.has_regressions);
      assert.strictEqual(result.diff.regression_count, 1);
      const reg = result.diff.regressions[0];
      assert.strictEqual(reg.category, 'status');
      assert.strictEqual(reg.severity, 'error');
      assert.ok(reg.message.includes('failed'));
      assert.strictEqual(reg.left, 'completed');
      assert.strictEqual(reg.right, 'failed');
    });

    it('AT-REG-002: budget warn_mode false -> true produces budget warning', () => {
      const left = makeRunExport();
      const right = makeRunExport({ state: { budget_status: { warn_mode: true, exhausted: false } } });
      const result = buildExportDiff(left, right);
      assert.ok(result.ok);
      assert.ok(result.diff.has_regressions);
      const reg = result.diff.regressions.find((r) => r.category === 'budget' && r.severity === 'warning');
      assert.ok(reg, 'should have budget warning regression');
      assert.ok(reg.message.includes('warn mode'));
    });

    it('AT-REG-003: budget exhausted false -> true produces budget error', () => {
      const left = makeRunExport();
      const right = makeRunExport({ state: { budget_status: { warn_mode: true, exhausted: true } } });
      const result = buildExportDiff(left, right);
      assert.ok(result.ok);
      const reg = result.diff.regressions.find((r) => r.category === 'budget' && r.severity === 'error');
      assert.ok(reg, 'should have budget exhaustion regression');
      assert.ok(reg.message.includes('exhausted'));
    });

    it('AT-REG-004: overridden_repo_decision_count increase produces decision override warning', () => {
      const left = makeRunExport();
      const right = makeRunExport({
        summary: {
          repo_decisions: { active_count: 0, overridden_count: 2, active: [], overridden: [{ id: 'DEC-100' }, { id: 'DEC-200' }] },
        },
      });
      const result = buildExportDiff(left, right);
      assert.ok(result.ok);
      const reg = result.diff.regressions.find((r) => r.category === 'decisions');
      assert.ok(reg, 'should have decision override regression');
      assert.strictEqual(reg.severity, 'warning');
      assert.strictEqual(reg.left, 0);
      assert.strictEqual(reg.right, 2);
    });

    it('AT-REG-012: gate regression passed -> failed produces gate error', () => {
      const left = makeRunExport();
      const right = makeRunExport({ state: { phase_gate_status: { planning_signoff: 'failed' } } });
      const result = buildExportDiff(left, right);
      assert.ok(result.ok);
      const reg = result.diff.regressions.find((r) => r.category === 'gate');
      assert.ok(reg, 'should have gate regression');
      assert.strictEqual(reg.severity, 'error');
      assert.ok(reg.message.includes('planning_signoff'));
      assert.strictEqual(reg.left, 'passed');
      assert.strictEqual(reg.right, 'failed');
    });

    it('AT-REG-010: no regressions when exports are identical', () => {
      const left = makeRunExport();
      const right = makeRunExport();
      const result = buildExportDiff(left, right);
      assert.ok(result.ok);
      assert.strictEqual(result.diff.has_regressions, false);
      assert.strictEqual(result.diff.regression_count, 0);
      assert.deepStrictEqual(result.diff.regressions, []);
    });

    it('AT-REG-011: no regressions when status improves failed -> completed', () => {
      const left = makeRunExport({ summary: { status: 'failed' } });
      const right = makeRunExport({ summary: { status: 'completed' } });
      const result = buildExportDiff(left, right);
      assert.ok(result.ok);
      const statusRegs = result.diff.regressions.filter((r) => r.category === 'status');
      assert.strictEqual(statusRegs.length, 0, 'status improvement should not be a regression');
    });
  });

  describe('Coordinator export regressions', () => {
    it('AT-REG-005: child repo status completed -> failed produces repo status regression', () => {
      const left = makeCoordinatorExport();
      const right = makeCoordinatorExport({
        summary: { repo_run_statuses: { web: 'completed', api: 'failed' } },
      });
      const result = buildExportDiff(left, right);
      assert.ok(result.ok);
      const reg = result.diff.regressions.find((r) => r.category === 'repo_status');
      assert.ok(reg, 'should have repo status regression');
      assert.strictEqual(reg.severity, 'error');
      assert.ok(reg.message.includes('api'));
    });

    it('AT-REG-006: child repo export ok -> failed produces repo export regression', () => {
      const left = makeCoordinatorExport();
      const right = makeCoordinatorExport({ repos: { web: { ok: true }, api: { ok: false } } });
      const result = buildExportDiff(left, right);
      assert.ok(result.ok);
      const reg = result.diff.regressions.find((r) => r.category === 'repo_export');
      assert.ok(reg, 'should have repo export regression');
      assert.strictEqual(reg.severity, 'error');
      assert.ok(reg.message.includes('api'));
    });

    it('AT-REG-007: barrier_count decrease produces barrier warning', () => {
      const left = makeCoordinatorExport();
      const right = makeCoordinatorExport({ summary: { barrier_count: 1 } });
      const result = buildExportDiff(left, right);
      assert.ok(result.ok);
      const reg = result.diff.regressions.find((r) => r.category === 'barrier');
      assert.ok(reg, 'should have barrier regression');
      assert.strictEqual(reg.severity, 'warning');
      assert.strictEqual(reg.left, 3);
      assert.strictEqual(reg.right, 1);
    });

    it('AT-REG-EVT-001: total_events decrease produces event loss warning', () => {
      const left = makeCoordinatorExport();
      const right = makeCoordinatorExport({
        summary: { aggregated_events: { total_events: 10, repos_with_events: ['web'], event_type_counts: { run_started: 1 } } },
      });
      const result = buildExportDiff(left, right);
      assert.ok(result.ok);
      const reg = result.diff.regressions.find((r) => r.category === 'events');
      assert.ok(reg, 'should have event loss regression');
      assert.strictEqual(reg.severity, 'warning');
      assert.strictEqual(reg.left, 20);
      assert.strictEqual(reg.right, 10);
    });
  });

  describe('CLI output', () => {
    it('AT-REG-008: text output includes Governance Regressions section', () => {
      const tmp = makeTmpDir();
      try {
        const leftExport = makeRunExport();
        const rightExport = makeRunExport({ summary: { status: 'failed' } });
        const leftPath = join(tmp, 'left.json');
        const rightPath = join(tmp, 'right.json');
        writeFileSync(leftPath, JSON.stringify(leftExport));
        writeFileSync(rightPath, JSON.stringify(rightExport));
        const result = spawnSync(process.execPath, [CLI_BIN, 'diff', leftPath, rightPath, '--export'], {
          cwd: tmp, encoding: 'utf8', timeout: 15_000,
        });
        assert.strictEqual(result.status, 0);
        assert.ok(result.stdout.includes('Governance Regressions'), `should contain Governance Regressions section, got: ${result.stdout.slice(0, 500)}`);
        assert.ok(result.stdout.includes('REG-STATUS'), 'should contain REG-STATUS regression');
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    });

    it('AT-REG-009: JSON output includes regressions array and flags', () => {
      const tmp = makeTmpDir();
      try {
        const leftExport = makeRunExport();
        const rightExport = makeRunExport({
          summary: { status: 'failed' },
          state: { budget_status: { warn_mode: true, exhausted: true }, phase_gate_status: { planning_signoff: 'failed' } },
        });
        const leftPath = join(tmp, 'left.json');
        const rightPath = join(tmp, 'right.json');
        writeFileSync(leftPath, JSON.stringify(leftExport));
        writeFileSync(rightPath, JSON.stringify(rightExport));
        const result = spawnSync(process.execPath, [CLI_BIN, 'diff', leftPath, rightPath, '--export', '--json'], {
          cwd: tmp, encoding: 'utf8', timeout: 15_000,
        });
        assert.strictEqual(result.status, 0);
        const parsed = JSON.parse(result.stdout);
        assert.ok(parsed.has_regressions, 'has_regressions should be true');
        assert.ok(parsed.regression_count >= 3, `should have at least 3 regressions, got ${parsed.regression_count}`);
        assert.ok(Array.isArray(parsed.regressions), 'regressions should be an array');
        const categories = new Set(parsed.regressions.map((r) => r.category));
        assert.ok(categories.has('status'), 'should have status regression');
        assert.ok(categories.has('budget'), 'should have budget regression');
        assert.ok(categories.has('gate'), 'should have gate regression');
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    });
  });
});
