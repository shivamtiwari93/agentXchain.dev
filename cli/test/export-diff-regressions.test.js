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

    it('AT-REG-001B: status completed -> blocked also produces status regression', () => {
      const left = makeRunExport();
      const right = makeRunExport({ summary: { status: 'blocked' } });
      const result = buildExportDiff(left, right);
      assert.ok(result.ok);
      const reg = result.diff.regressions.find((r) => r.category === 'status');
      assert.ok(reg, 'should have status regression');
      assert.strictEqual(reg.severity, 'error');
      assert.strictEqual(reg.left, 'completed');
      assert.strictEqual(reg.right, 'blocked');
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

    it('AT-REG-013: new delegation missing_decision_ids produce delegation regression', () => {
      const left = makeRunExport({
        summary: {
          delegation_summary: {
            total_delegations_issued: 1,
            delegation_chains: [{
              parent_role: 'pm',
              parent_turn_id: 'turn_parent_001',
              review_turn_id: 'turn_review_001',
              outcome: 'completed',
              delegations: [{
                delegation_id: 'del-001',
                to_role: 'dev',
                child_turn_id: 'turn_child_001',
                status: 'completed',
                charter: 'Implement API',
                required_decision_ids: ['DEC-101'],
                satisfied_decision_ids: ['DEC-101'],
                missing_decision_ids: [],
              }],
            }],
          },
        },
      });
      const right = makeRunExport({
        summary: {
          delegation_summary: {
            total_delegations_issued: 1,
            delegation_chains: [{
              parent_role: 'pm',
              parent_turn_id: 'turn_parent_001',
              review_turn_id: 'turn_review_001',
              outcome: 'failed',
              delegations: [{
                delegation_id: 'del-001',
                to_role: 'dev',
                child_turn_id: 'turn_child_001',
                status: 'completed',
                charter: 'Implement API',
                required_decision_ids: ['DEC-101', 'DEC-102'],
                satisfied_decision_ids: ['DEC-101'],
                missing_decision_ids: ['DEC-102'],
              }],
            }],
          },
        },
      });
      const result = buildExportDiff(left, right);
      assert.ok(result.ok);
      const reg = result.diff.regressions.find((r) => r.category === 'delegation');
      assert.ok(reg, 'should have delegation regression');
      assert.strictEqual(reg.severity, 'error');
      assert.ok(reg.message.includes('DEC-102'));
      assert.deepStrictEqual(reg.left, []);
      assert.deepStrictEqual(reg.right, ['DEC-102']);
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

    it('AT-REG-005B: child repo status completed -> blocked also produces repo status regression', () => {
      const left = makeCoordinatorExport();
      const right = makeCoordinatorExport({
        summary: { repo_run_statuses: { web: 'completed', api: 'blocked' } },
      });
      const result = buildExportDiff(left, right);
      assert.ok(result.ok);
      const reg = result.diff.regressions.find((r) => r.category === 'repo_status');
      assert.ok(reg, 'should have repo status regression');
      assert.strictEqual(reg.severity, 'error');
      assert.ok(reg.message.includes('api'));
      assert.strictEqual(reg.right, 'blocked');
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

  describe('Phase-aware regressions', () => {
    it('AT-PHASE-001: backward phase movement produces REG-PHASE warning', () => {
      const left = makeRunExport({
        summary: { phase: 'implementation', workflow_phase_order: ['planning', 'implementation', 'qa'] },
      });
      const right = makeRunExport({
        summary: { phase: 'planning', workflow_phase_order: ['planning', 'implementation', 'qa'] },
      });
      const result = buildExportDiff(left, right);
      assert.ok(result.ok);
      const reg = result.diff.regressions.find((r) => r.category === 'phase');
      assert.ok(reg, 'should have phase regression');
      assert.strictEqual(reg.severity, 'warning');
      assert.ok(reg.message.includes('backward'));
      assert.strictEqual(reg.left, 'implementation');
      assert.strictEqual(reg.right, 'planning');
    });

    it('AT-PHASE-002: forward phase movement produces NO regression', () => {
      const left = makeRunExport({
        summary: { phase: 'planning', workflow_phase_order: ['planning', 'implementation', 'qa'] },
      });
      const right = makeRunExport({
        summary: { phase: 'implementation', workflow_phase_order: ['planning', 'implementation', 'qa'] },
      });
      const result = buildExportDiff(left, right);
      assert.ok(result.ok);
      const phaseRegs = result.diff.regressions.filter((r) => r.category === 'phase');
      assert.strictEqual(phaseRegs.length, 0, 'forward movement should not be a regression');
    });

    it('AT-PHASE-003: same phase produces NO regression', () => {
      const left = makeRunExport({
        summary: { phase: 'implementation', workflow_phase_order: ['planning', 'implementation', 'qa'] },
      });
      const right = makeRunExport({
        summary: { phase: 'implementation', workflow_phase_order: ['planning', 'implementation', 'qa'] },
      });
      const result = buildExportDiff(left, right);
      assert.ok(result.ok);
      const phaseRegs = result.diff.regressions.filter((r) => r.category === 'phase');
      assert.strictEqual(phaseRegs.length, 0, 'same phase should not be a regression');
    });

    it('AT-PHASE-004: phase disappears (non-null -> null) produces REG-PHASE warning', () => {
      const left = makeRunExport({
        summary: { phase: 'implementation', workflow_phase_order: ['planning', 'implementation', 'qa'] },
      });
      const right = makeRunExport({
        summary: { phase: null, workflow_phase_order: ['planning', 'implementation', 'qa'] },
      });
      const result = buildExportDiff(left, right);
      assert.ok(result.ok);
      const reg = result.diff.regressions.find((r) => r.category === 'phase');
      assert.ok(reg, 'should have phase regression for disappearing phase');
      assert.strictEqual(reg.severity, 'warning');
      assert.strictEqual(reg.left, 'implementation');
      assert.strictEqual(reg.right, null);
    });

    it('AT-PHASE-005: phase appears (null -> non-null) produces NO regression', () => {
      const left = makeRunExport({
        summary: { phase: null, workflow_phase_order: ['planning', 'implementation', 'qa'] },
      });
      const right = makeRunExport({
        summary: { phase: 'planning', workflow_phase_order: ['planning', 'implementation', 'qa'] },
      });
      const result = buildExportDiff(left, right);
      assert.ok(result.ok);
      const phaseRegs = result.diff.regressions.filter((r) => r.category === 'phase');
      assert.strictEqual(phaseRegs.length, 0, 'phase appearance should not be a regression');
    });

    it('AT-PHASE-006: no workflow_phase_order on either export produces NO phase regression', () => {
      const left = makeRunExport({ summary: { phase: 'qa' } });
      const right = makeRunExport({ summary: { phase: 'planning' } });
      const result = buildExportDiff(left, right);
      assert.ok(result.ok);
      const phaseRegs = result.diff.regressions.filter((r) => r.category === 'phase');
      assert.strictEqual(phaseRegs.length, 0, 'no phase order means no phase regression');
    });

    it('AT-PHASE-007: custom phase order backward produces regression', () => {
      const customOrder = ['design', 'build', 'verify', 'release'];
      const left = makeRunExport({
        summary: { phase: 'release', workflow_phase_order: customOrder },
      });
      const right = makeRunExport({
        summary: { phase: 'design', workflow_phase_order: customOrder },
      });
      const result = buildExportDiff(left, right);
      assert.ok(result.ok);
      const reg = result.diff.regressions.find((r) => r.category === 'phase');
      assert.ok(reg, 'should have phase regression with custom order');
      assert.strictEqual(reg.left, 'release');
      assert.strictEqual(reg.right, 'design');
    });

    it('AT-PHASE-008: coordinator phase backward movement produces regression', () => {
      const left = makeCoordinatorExport({
        summary: { phase: 'qa', workflow_phase_order: ['planning', 'implementation', 'qa'] },
      });
      const right = makeCoordinatorExport({
        summary: { phase: 'planning', workflow_phase_order: ['planning', 'implementation', 'qa'] },
      });
      const result = buildExportDiff(left, right);
      assert.ok(result.ok);
      const reg = result.diff.regressions.find((r) => r.category === 'phase');
      assert.ok(reg, 'should have coordinator phase regression');
      assert.strictEqual(reg.severity, 'warning');
      assert.strictEqual(reg.left, 'qa');
      assert.strictEqual(reg.right, 'planning');
    });

    it('AT-PHASE-CONF-004: differing phase orders produce explicit phase-order drift regression', () => {
      const left = makeRunExport({
        summary: { phase: 'implementation', workflow_phase_order: ['planning', 'implementation', 'qa'] },
      });
      const right = makeRunExport({
        summary: { phase: 'planning', workflow_phase_order: ['discovery', 'planning', 'implementation'] },
      });
      const result = buildExportDiff(left, right);
      assert.ok(result.ok);
      const reg = result.diff.regressions.find((r) => r.id.startsWith('REG-PHASE-ORDER-'));
      assert.ok(reg, 'should have phase-order drift regression');
      assert.strictEqual(reg.category, 'phase');
      assert.strictEqual(reg.severity, 'warning');
      assert.deepStrictEqual(reg.left, ['planning', 'implementation', 'qa']);
      assert.deepStrictEqual(reg.right, ['discovery', 'planning', 'implementation']);
    });

    it('AT-PHASE-CONF-005: differing phase orders suppress backward phase inference', () => {
      const left = makeRunExport({
        summary: { phase: 'qa', workflow_phase_order: ['planning', 'implementation', 'qa'] },
      });
      const right = makeRunExport({
        summary: { phase: 'planning', workflow_phase_order: ['planning', 'qa', 'implementation'] },
      });
      const result = buildExportDiff(left, right);
      assert.ok(result.ok);
      const backwardRegs = result.diff.regressions.filter((r) => r.id.startsWith('REG-PHASE-') && !r.id.startsWith('REG-PHASE-ORDER-') && r.field === 'phase');
      assert.strictEqual(backwardRegs.length, 0, 'should not infer backward movement when phase orders drift');
      const orderRegs = result.diff.regressions.filter((r) => r.id.startsWith('REG-PHASE-ORDER-'));
      assert.strictEqual(orderRegs.length, 1, 'should emit explicit phase-order drift warning');
    });

    it('AT-PHASE-CONF-006: equal phase orders still allow backward phase detection', () => {
      const phaseOrder = ['planning', 'implementation', 'qa'];
      const left = makeRunExport({
        summary: { phase: 'qa', workflow_phase_order: phaseOrder },
      });
      const right = makeRunExport({
        summary: { phase: 'planning', workflow_phase_order: phaseOrder },
      });
      const result = buildExportDiff(left, right);
      assert.ok(result.ok);
      const reg = result.diff.regressions.find((r) => r.id.startsWith('REG-PHASE-') && !r.id.startsWith('REG-PHASE-ORDER-') && r.field === 'phase');
      assert.ok(reg, 'should retain backward phase detection when phase order matches');
      const orderRegs = result.diff.regressions.filter((r) => r.id.startsWith('REG-PHASE-ORDER-'));
      assert.strictEqual(orderRegs.length, 0, 'equal phase order should not emit drift warning');
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

    it('AT-PHASE-009: text output includes phase regression in Governance Regressions section', () => {
      const tmp = makeTmpDir();
      try {
        const leftExport = makeRunExport({
          summary: { phase: 'qa', workflow_phase_order: ['planning', 'implementation', 'qa'] },
        });
        const rightExport = makeRunExport({
          summary: { phase: 'planning', workflow_phase_order: ['planning', 'implementation', 'qa'] },
        });
        const leftPath = join(tmp, 'left.json');
        const rightPath = join(tmp, 'right.json');
        writeFileSync(leftPath, JSON.stringify(leftExport));
        writeFileSync(rightPath, JSON.stringify(rightExport));
        const result = spawnSync(process.execPath, [CLI_BIN, 'diff', leftPath, rightPath, '--export'], {
          cwd: tmp, encoding: 'utf8', timeout: 15_000,
        });
        assert.strictEqual(result.status, 0);
        assert.ok(result.stdout.includes('Governance Regressions'), 'should contain Governance Regressions section');
        assert.ok(result.stdout.includes('REG-PHASE'), 'should contain REG-PHASE regression');
        assert.ok(result.stdout.includes('backward'), 'should mention backward movement');
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    });

    it('AT-PHASE-010: JSON output includes phase regression with correct category/severity', () => {
      const tmp = makeTmpDir();
      try {
        const leftExport = makeRunExport({
          summary: { phase: 'implementation', workflow_phase_order: ['planning', 'implementation', 'qa'] },
        });
        const rightExport = makeRunExport({
          summary: { phase: 'planning', workflow_phase_order: ['planning', 'implementation', 'qa'] },
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
        const phaseReg = parsed.regressions.find((r) => r.category === 'phase');
        assert.ok(phaseReg, 'should have phase regression');
        assert.strictEqual(phaseReg.severity, 'warning');
        assert.strictEqual(phaseReg.left, 'implementation');
        assert.strictEqual(phaseReg.right, 'planning');
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
