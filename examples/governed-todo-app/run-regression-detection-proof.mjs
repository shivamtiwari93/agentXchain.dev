#!/usr/bin/env node

/**
 * Proof: governance regression detection in export diffs.
 *
 * Creates two synthetic export artifacts — one "healthy" and one "regressed" —
 * then runs `agentxchain diff --export --json` and verifies the regression
 * flags are correctly detected.
 *
 * Checks:
 *  1. Status regression (completed → failed)
 *  2. Budget warn_mode regression
 *  3. Budget exhaustion regression
 *  4. Gate regression (passed → failed)
 *  5. Decision override increase
 *  6. No false-positive on improvement (failed → completed)
 *  7. Coordinator: repo status regression
 *  8. Coordinator: repo export regression
 *  9. Coordinator: barrier count decrease
 * 10. Coordinator: event loss
 */

import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(__dirname, '..', '..', 'cli', 'bin', 'agentxchain.js');

const jsonMode = process.argv.includes('--json');
const checks = [];
let pass = 0;
let fail = 0;

function check(label, condition) {
  if (condition) {
    pass++;
    checks.push({ label, result: 'pass' });
    if (!jsonMode) console.log(`  ✓ ${label}`);
  } else {
    fail++;
    checks.push({ label, result: 'fail' });
    if (!jsonMode) console.log(`  ✗ ${label}`);
  }
}

function makeTmp() {
  const dir = join(tmpdir(), `reg-proof-${randomBytes(6).toString('hex')}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function runDiff(tmp, leftExport, rightExport) {
  const leftPath = join(tmp, 'left.json');
  const rightPath = join(tmp, 'right.json');
  writeFileSync(leftPath, JSON.stringify(leftExport));
  writeFileSync(rightPath, JSON.stringify(rightExport));
  const result = spawnSync(process.execPath, [CLI_BIN, 'diff', leftPath, rightPath, '--export', '--json'], {
    cwd: tmp, encoding: 'utf8', timeout: 15_000,
  });
  if (result.status !== 0) {
    console.error('diff failed:', result.stderr);
    return null;
  }
  return JSON.parse(result.stdout);
}

function makeRunExport(overrides = {}) {
  const base = {
    export_kind: 'agentxchain_run_export',
    schema_version: '0.3',
    project: { name: 'Proof Project', goal: 'test regression detection' },
    summary: {
      run_id: 'run_proof_001', status: 'completed', phase: 'done',
      project_goal: 'test regression detection', provenance: { trigger: 'manual' },
      history_entries: 5, decision_entries: 2, hook_audit_entries: 1,
      notification_audit_entries: 0, dispatch_artifact_files: 1, staging_artifact_files: 0,
      active_turn_ids: [], retained_turn_ids: [],
      dashboard_session: { status: 'absent' },
      delegation_summary: { total_delegations_issued: 0 },
      repo_decisions: { active_count: 1, overridden_count: 0, active: [{ id: 'DEC-PROOF-001' }], overridden: [] },
    },
    state: {
      budget_status: { warn_mode: false, exhausted: false },
      phase_gate_status: { qa_signoff: 'passed', security_review: 'approved' },
    },
  };
  return deepMerge(base, overrides);
}

function makeCoordinatorExport(overrides = {}) {
  const base = {
    export_kind: 'agentxchain_coordinator_export',
    schema_version: '0.3',
    coordinator: { project_name: 'Coord Proof' },
    summary: {
      super_run_id: 'super_proof_001', status: 'completed', phase: 'done',
      barrier_count: 4, history_entries: 10, decision_entries: 5,
      repo_run_statuses: { web: 'completed', api: 'completed', worker: 'completed' },
      aggregated_events: { total_events: 30, repos_with_events: ['web', 'api', 'worker'], event_type_counts: { run_started: 3, run_completed: 3 } },
    },
    repos: { web: { ok: true }, api: { ok: true }, worker: { ok: true } },
    state: { budget_status: { warn_mode: false, exhausted: false }, phase_gate_status: {} },
  };
  return deepMerge(base, overrides);
}

function deepMerge(target, source) {
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])
      && target[key] && typeof target[key] === 'object' && !Array.isArray(target[key])) {
      result[key] = deepMerge(target[key], source[key]);
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

// --- Run proof ---
if (!jsonMode) console.log('\nGovernance Regression Detection Proof\n');

const tmp = makeTmp();
try {
  // 1. Status regression
  const statusDiff = runDiff(tmp, makeRunExport(), makeRunExport({ summary: { status: 'failed' } }));
  check('1. Status regression detected', statusDiff?.has_regressions === true
    && statusDiff.regressions.some((r) => r.category === 'status' && r.severity === 'error'));

  // 2. Budget warn_mode regression
  const budgetWarnDiff = runDiff(tmp, makeRunExport(),
    makeRunExport({ state: { budget_status: { warn_mode: true, exhausted: false } } }));
  check('2. Budget warn_mode regression detected', budgetWarnDiff?.has_regressions === true
    && budgetWarnDiff.regressions.some((r) => r.category === 'budget' && r.severity === 'warning'));

  // 3. Budget exhaustion regression
  const budgetExhaustDiff = runDiff(tmp, makeRunExport(),
    makeRunExport({ state: { budget_status: { warn_mode: true, exhausted: true } } }));
  check('3. Budget exhaustion regression detected', budgetExhaustDiff?.has_regressions === true
    && budgetExhaustDiff.regressions.some((r) => r.category === 'budget' && r.severity === 'error'));

  // 4. Gate regression
  const gateDiff = runDiff(tmp, makeRunExport(),
    makeRunExport({ state: { phase_gate_status: { qa_signoff: 'failed', security_review: 'approved' } } }));
  check('4. Gate regression detected', gateDiff?.has_regressions === true
    && gateDiff.regressions.some((r) => r.category === 'gate' && r.severity === 'error'));

  // 5. Decision override increase
  const decisionDiff = runDiff(tmp, makeRunExport(),
    makeRunExport({
      summary: { repo_decisions: { active_count: 0, overridden_count: 2, active: [], overridden: [{ id: 'DEC-PROOF-001' }, { id: 'DEC-PROOF-002' }] } },
    }));
  check('5. Decision override increase detected', decisionDiff?.has_regressions === true
    && decisionDiff.regressions.some((r) => r.category === 'decisions'));

  // 6. No false positive on improvement
  const improveDiff = runDiff(tmp,
    makeRunExport({ summary: { status: 'failed' } }),
    makeRunExport({ summary: { status: 'completed' } }));
  check('6. No false positive on status improvement',
    !improveDiff?.regressions?.some((r) => r.category === 'status'));

  // 7. Coordinator: repo status regression
  const repoStatusDiff = runDiff(tmp, makeCoordinatorExport(),
    makeCoordinatorExport({ summary: { repo_run_statuses: { web: 'completed', api: 'failed', worker: 'completed' } } }));
  check('7. Coordinator repo status regression detected', repoStatusDiff?.has_regressions === true
    && repoStatusDiff.regressions.some((r) => r.category === 'repo_status'));

  // 8. Coordinator: repo export regression
  const repoExportDiff = runDiff(tmp, makeCoordinatorExport(),
    makeCoordinatorExport({ repos: { web: { ok: true }, api: { ok: false }, worker: { ok: true } } }));
  check('8. Coordinator repo export regression detected', repoExportDiff?.has_regressions === true
    && repoExportDiff.regressions.some((r) => r.category === 'repo_export'));

  // 9. Coordinator: barrier decrease
  const barrierDiff = runDiff(tmp, makeCoordinatorExport(),
    makeCoordinatorExport({ summary: { barrier_count: 1 } }));
  check('9. Coordinator barrier decrease detected', barrierDiff?.has_regressions === true
    && barrierDiff.regressions.some((r) => r.category === 'barrier'));

  // 10. Coordinator: event loss
  const eventLossDiff = runDiff(tmp, makeCoordinatorExport(),
    makeCoordinatorExport({ summary: { aggregated_events: { total_events: 15, repos_with_events: ['web'], event_type_counts: { run_started: 1 } } } }));
  check('10. Coordinator event loss detected', eventLossDiff?.has_regressions === true
    && eventLossDiff.regressions.some((r) => r.category === 'events'));

} finally {
  rmSync(tmp, { recursive: true, force: true });
}

if (jsonMode) {
  console.log(JSON.stringify({ proof: 'governance-regression-detection', pass, fail, total: pass + fail, checks }, null, 2));
} else {
  console.log(`\nResult: ${pass}/${pass + fail} checks passed${fail > 0 ? ' — FAIL' : ' — PASS'}\n`);
}

process.exit(fail > 0 ? 1 : 0);
