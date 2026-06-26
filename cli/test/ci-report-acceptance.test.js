import { strict as assert } from 'node:assert';
import { describe, it, beforeAll, afterAll, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';

import { buildRunExport } from '../src/lib/export.js';
import { buildGovernanceReport } from '../src/lib/report.js';
import {
  formatGitHubAnnotations,
  formatJUnitXml,
  deriveCIExitCode,
} from '../src/lib/ci-reporter.js';
import { ciReportCommand } from '../src/commands/ci-report.js';

// --- Helpers ---

function writeJson(filePath, value) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n');
}

function writeJsonl(filePath, entries) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
}

// --- Test suite ---

describe('M9 acceptance: CI reporter formats governed run report as GitHub Actions annotations and JUnit XML with correct exit codes', () => {
  let passingRoot;
  let failingRoot;
  let passingReport;
  let failingReport;
  let passingExportArtifact;

  beforeAll(() => {
    // --- Passing governed project (completed run, all gates satisfied) ---
    passingRoot = mkdtempSync(join(tmpdir(), 'ci-acc-pass-'));

    writeJson(join(passingRoot, 'agentxchain.json'), {
      schema_version: '1.0',
      template: 'generic',
      project: { id: 'ci-acc-pass', name: 'CI Acceptance Pass', default_branch: 'main' },
      roles: {
        dev: { title: 'Developer', mandate: 'Execute.', write_authority: 'authoritative', runtime: 'local-dev' },
      },
      runtimes: {
        'local-dev': { type: 'local_cli', command: ['echo', '{prompt}'], prompt_transport: 'argv' },
      },
      routing: {
        planning: { entry_role: 'dev', allowed_next_roles: ['dev'] },
        implementation: { entry_role: 'dev', allowed_next_roles: ['dev'] },
        qa: { entry_role: 'dev', allowed_next_roles: ['dev'] },
      },
      budget: { per_run_max_usd: 10.0, per_turn_max_usd: 2.0 },
      gates: {},
      hooks: {},
    });

    writeJson(join(passingRoot, '.agentxchain', 'state.json'), {
      schema_version: '1.1',
      project_id: 'ci-acc-pass',
      run_id: 'run_ci_pass_001',
      status: 'completed',
      phase: 'qa',
      turn_sequence: 3,
      active_turns: {},
      retained_turns: {},
      phase_gate_status: {
        planning_signoff: 'satisfied',
        implementation_complete: 'satisfied',
        qa_ship_verdict: 'satisfied',
      },
    });

    writeJsonl(join(passingRoot, '.agentxchain', 'history.jsonl'), [
      { turn_id: 'turn_p01', role: 'dev', status: 'accepted', phase: 'planning', summary: 'Planning complete.' },
      { turn_id: 'turn_i01', role: 'dev', status: 'accepted', phase: 'implementation', summary: 'Implementation complete.' },
      { turn_id: 'turn_q01', role: 'dev', status: 'accepted', phase: 'qa', summary: 'QA complete.' },
    ]);

    writeJsonl(join(passingRoot, '.agentxchain', 'decision-ledger.jsonl'), [
      { id: 'DEC-001', turn_id: 'turn_p01', role: 'dev', phase: 'planning', category: 'scope', statement: 'Scope confirmed for CI test.' },
    ]);

    const passExport = buildRunExport(passingRoot);
    assert.ok(passExport.ok, `Passing export failed: ${passExport.error}`);
    passingExportArtifact = passExport.export;
    const passReportResult = buildGovernanceReport(passingExportArtifact, { input: 'test' });
    assert.ok(passReportResult.ok, 'Passing report build failed');
    passingReport = passReportResult.report;

    // --- Failing governed project (blocked run, pending gate, failed turn) ---
    failingRoot = mkdtempSync(join(tmpdir(), 'ci-acc-fail-'));

    writeJson(join(failingRoot, 'agentxchain.json'), {
      schema_version: '1.0',
      template: 'generic',
      project: { id: 'ci-acc-fail', name: 'CI Acceptance Fail', default_branch: 'main' },
      roles: {
        dev: { title: 'Developer', mandate: 'Execute.', write_authority: 'authoritative', runtime: 'local-dev' },
      },
      runtimes: {
        'local-dev': { type: 'local_cli', command: ['echo', '{prompt}'], prompt_transport: 'argv' },
      },
      routing: {
        planning: { entry_role: 'dev', allowed_next_roles: ['dev'] },
        implementation: { entry_role: 'dev', allowed_next_roles: ['dev'] },
      },
      budget: { per_run_max_usd: 10.0, per_turn_max_usd: 2.0 },
      gates: {},
      hooks: {},
    });

    writeJson(join(failingRoot, '.agentxchain', 'state.json'), {
      schema_version: '1.1',
      project_id: 'ci-acc-fail',
      run_id: 'run_ci_fail_001',
      status: 'blocked',
      phase: 'implementation',
      blocked_on: 'credential_failure',
      blocked_reason: {
        category: 'credential_failure',
        blocked_at: '2026-06-26T00:00:00.000Z',
        turn_id: 'turn_f02',
        recovery: {
          typed_reason: 'credential_failure',
          owner: 'human',
          recovery_action: 'agentxchain step --resume',
          turn_retained: false,
          detail: 'API key expired',
        },
      },
      turn_sequence: 2,
      active_turns: {},
      retained_turns: {},
      phase_gate_status: {
        planning_signoff: 'satisfied',
        implementation_complete: 'pending',
      },
    });

    writeJsonl(join(failingRoot, '.agentxchain', 'history.jsonl'), [
      { turn_id: 'turn_f01', role: 'dev', status: 'accepted', phase: 'planning', summary: 'Planning OK.' },
      { turn_id: 'turn_f02', role: 'dev', status: 'failed', phase: 'implementation', summary: 'API key expired' },
    ]);

    writeJsonl(join(failingRoot, '.agentxchain', 'decision-ledger.jsonl'), []);

    const failExport = buildRunExport(failingRoot);
    assert.ok(failExport.ok, `Failing export failed: ${failExport.error}`);
    const failReportResult = buildGovernanceReport(failExport.export, { input: 'test' });
    assert.ok(failReportResult.ok, 'Failing report build failed');
    failingReport = failReportResult.report;
  });

  afterAll(() => {
    if (passingRoot) rmSync(passingRoot, { recursive: true, force: true });
    if (failingRoot) rmSync(failingRoot, { recursive: true, force: true });
  });

  // --- AT-CI-ACC-001: Passing governed run -> GitHub Actions annotations ---

  it('AT-CI-ACC-001: passing governed run produces correct GitHub Actions annotations', () => {
    const output = formatGitHubAnnotations(passingReport);

    // Overall status annotation
    assert.ok(output.includes('::notice title=AgentXchain Governance::'), 'should contain overall notice annotation');
    assert.ok(output.includes('PASS'), 'should indicate PASS');
    assert.ok(output.includes('run_ci_pass_001'), 'should contain run_id');

    // Gate annotations (from real pipeline gate_summary array)
    assert.ok(output.includes('::notice title=Gate planning_signoff::satisfied'), 'planning_signoff gate should be satisfied');
    assert.ok(output.includes('::notice title=Gate implementation_complete::satisfied'), 'implementation_complete gate should be satisfied');
    assert.ok(output.includes('::notice title=Gate qa_ship_verdict::satisfied'), 'qa_ship_verdict gate should be satisfied');

    // Decision annotation
    assert.ok(output.includes('::notice title=Decision DEC-001::'), 'should contain decision annotation');
    assert.ok(output.includes('Scope confirmed for CI test'), 'decision statement should be present');
  });

  // --- AT-CI-ACC-002: Passing governed run -> JUnit XML with zero failures ---

  it('AT-CI-ACC-002: passing governed run produces JUnit XML with zero failures', () => {
    const xml = formatJUnitXml(passingReport);

    // XML declaration and root
    assert.ok(xml.includes('<?xml version="1.0" encoding="UTF-8"?>'), 'should start with XML declaration');
    assert.ok(xml.includes('<testsuites name="AgentXchain Governance"'), 'should have testsuites root');

    // Gates testsuite — 3 gates from phase_gate_status
    assert.ok(xml.includes('<testsuite name="Gates"'), 'should have Gates testsuite');
    assert.ok(xml.includes('tests="3"') || xml.match(/<testsuite name="Gates" tests="3"/), 'Gates should have 3 tests');

    // Turns testsuite — 3 turns from history
    assert.ok(xml.includes('<testsuite name="Turns"'), 'should have Turns testsuite');

    // Turn testcases include turn_id and role
    assert.ok(xml.includes('<testcase name="turn_p01 (dev)"'), 'should have turn_p01 testcase with role');
    assert.ok(xml.includes('<testcase name="turn_i01 (dev)"'), 'should have turn_i01 testcase');
    assert.ok(xml.includes('<testcase name="turn_q01 (dev)"'), 'should have turn_q01 testcase');

    // Zero failures
    assert.ok(xml.includes('failures="0"'), 'root testsuites should have zero failures');
    assert.ok(!xml.includes('<failure'), 'should contain no failure elements');
  });

  // --- AT-CI-ACC-003: Passing governed run -> exit code 0 ---

  it('AT-CI-ACC-003: passing governed run yields exit code 0', () => {
    const exitCode = deriveCIExitCode(passingReport);
    assert.equal(exitCode, 0, 'passing report overall="pass" should yield exit code 0');
  });

  // --- AT-CI-ACC-004: Failing governed run -> error annotations ---

  it('AT-CI-ACC-004: failing governed run produces blocked and gate warning annotations', () => {
    const output = formatGitHubAnnotations(failingReport);

    // Run ID present
    assert.ok(output.includes('run_ci_fail_001'), 'should contain failing run_id');

    // Blocked annotation (blocked_reason is a structured object; the annotation is emitted from blocked_on)
    assert.ok(output.includes('::error title=Blocked::'), 'should contain blocked error annotation');

    // Gate annotations
    assert.ok(output.includes('::notice title=Gate planning_signoff::satisfied'), 'satisfied gate gets ::notice');
    assert.ok(output.includes('::warning title=Gate implementation_complete::pending'), 'pending gate gets ::warning');
  });

  // --- AT-CI-ACC-005: Failing governed run -> JUnit XML with failure elements ---

  it('AT-CI-ACC-005: failing governed run produces JUnit XML with failure elements', () => {
    const xml = formatJUnitXml(failingReport);

    // Gates testsuite — implementation_complete is pending → failure
    assert.ok(xml.includes('<testsuite name="Gates"'), 'should have Gates testsuite');
    assert.ok(xml.includes('<failure message="pending">'), 'pending gate should produce failure element');
    assert.ok(xml.includes('implementation_complete gate status: pending'), 'failure should describe the pending gate');

    // Turns testsuite — turn_f02 with status failed → failure
    assert.ok(xml.includes('<testsuite name="Turns"'), 'should have Turns testsuite');
    assert.ok(xml.includes('<failure message="failed">'), 'failed turn should produce failure element');
    assert.ok(xml.includes('API key expired'), 'turn failure should include summary');

    // Total failures > 0
    const failureCountMatch = xml.match(/<testsuites[^>]*failures="(\d+)"/);
    assert.ok(failureCountMatch, 'testsuites should have failures attribute');
    assert.ok(parseInt(failureCountMatch[1], 10) > 0, 'total failures should be > 0');
  });

  // --- AT-CI-ACC-006: Exit code differentiation ---

  it('AT-CI-ACC-006: valid export yields exit code 0, invalid export yields exit code 1', () => {
    // Valid export with blocked run — overall is still 'pass' (export validates)
    const validExitCode = deriveCIExitCode(failingReport);
    assert.equal(validExitCode, 0, 'valid export with blocked run should yield exit code 0 (overall=pass)');

    // Invalid artifact → buildGovernanceReport returns overall: 'fail'
    const invalidResult = buildGovernanceReport({}, { input: 'test' });
    assert.equal(invalidResult.report.overall, 'fail', 'invalid artifact should produce overall=fail');
    const invalidExitCode = deriveCIExitCode(invalidResult.report);
    assert.equal(invalidExitCode, 1, 'invalid export should yield exit code 1');
  });

  // --- AT-CI-ACC-007: ciReportCommand reads export file and produces correct output ---

  it('AT-CI-ACC-007: ciReportCommand reads export file and produces correct output format and exit code', async () => {
    // Write export artifact to temp file
    const tmpDir = mkdtempSync(join(tmpdir(), 'ci-acc-cmd-'));
    const exportFilePath = join(tmpDir, 'export.json');
    writeFileSync(exportFilePath, JSON.stringify(passingExportArtifact, null, 2));

    const savedExitCode = process.exitCode;
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    try {
      // Test JUnit XML format
      process.exitCode = undefined;
      logSpy.mockClear();
      await ciReportCommand({ input: exportFilePath, format: 'junit-xml' });

      assert.equal(process.exitCode, 0, 'passing export should set process.exitCode to 0');
      const xmlOutput = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      assert.ok(xmlOutput.includes('<testsuites'), 'JUnit XML output should contain testsuites');
      assert.ok(xmlOutput.includes('<testsuite name="Gates"'), 'JUnit XML output should contain Gates testsuite');

      // Test GitHub Actions format
      process.exitCode = undefined;
      logSpy.mockClear();
      await ciReportCommand({ input: exportFilePath, format: 'github-actions' });

      assert.equal(process.exitCode, 0, 'passing export should set process.exitCode to 0 for github-actions format');
      const annotationsOutput = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      assert.ok(annotationsOutput.includes('::notice'), 'GitHub Actions output should contain ::notice annotations');
      assert.ok(annotationsOutput.includes('run_ci_pass_001'), 'GitHub Actions output should contain run_id');
    } finally {
      logSpy.mockRestore();
      process.exitCode = savedExitCode;
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
