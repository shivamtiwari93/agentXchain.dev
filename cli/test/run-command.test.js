import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const cliRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const runCommandPath = join(cliRoot, 'src', 'commands', 'run.js');
const binPath = join(cliRoot, 'bin', 'agentxchain.js');

describe('agentxchain run — guard tests', () => {

  // AT-RUN-GUARD-001: run.js must not import from governed-state.js directly
  it('AT-RUN-GUARD-001: run.js does not import from governed-state.js', () => {
    const src = readFileSync(runCommandPath, 'utf8');
    const governedStateImport = /from\s+['"]\.\.\/lib\/governed-state\.js['"]/;
    assert.ok(
      !governedStateImport.test(src),
      'run.js must not import from governed-state.js directly — the runLoop library owns state transitions',
    );
  });

  // AT-RUN-GUARD-002: run.js must not call assignTurn, acceptTurn, rejectTurn, approvePhaseGate, or approveCompletionGate
  it('AT-RUN-GUARD-002: run.js does not call state-machine primitives directly', () => {
    const src = readFileSync(runCommandPath, 'utf8');
    const forbidden = [
      'assignTurn',
      'acceptTurn',
      'rejectTurn',
      'assignGovernedTurn',
      'acceptGovernedTurn',
      'rejectGovernedTurn',
      'approvePhaseGate',
      'approveCompletionGate',
      'markRunBlocked',
      'initializeGovernedRun',
      'reactivateGovernedRun',
    ];
    for (const fn of forbidden) {
      const pattern = new RegExp(`\\b${fn}\\s*\\(`);
      assert.ok(
        !pattern.test(src),
        `run.js must not call ${fn}() directly — runLoop owns the state machine`,
      );
    }
  });

  // AT-RUN-GUARD-003: run command is registered in agentxchain.js with correct options
  it('AT-RUN-GUARD-003: run command is registered in CLI entry point', () => {
    const bin = readFileSync(binPath, 'utf8');
    assert.ok(bin.includes("import { runCommand } from '../src/commands/run.js'"), 'run command import missing');
    assert.ok(bin.includes(".command('run')"), 'run command registration missing');
    assert.ok(bin.includes('.action(runCommand)'), 'run command action binding missing');
    assert.ok(bin.includes("--max-turns"), '--max-turns option missing');
    assert.ok(bin.includes('--auto-approve'), '--auto-approve option missing');
    assert.ok(bin.includes('--verbose'), '--verbose option missing in run command block');
    assert.ok(bin.includes('--dry-run'), '--dry-run option missing');
  });

  // AT-RUN-GUARD-004: run.js calls runLoop exactly once
  it('AT-RUN-GUARD-004: run.js calls runLoop', () => {
    const src = readFileSync(runCommandPath, 'utf8');
    const matches = src.match(/\brunLoop\s*\(/g);
    assert.ok(matches, 'run.js must call runLoop');
    assert.equal(matches.length, 1, 'run.js must call runLoop exactly once');
  });

  // AT-RUN-GUARD-005: run.js does not contain process.exit in the dispatch callback
  it('AT-RUN-GUARD-005: dispatch callback does not call process.exit', () => {
    const src = readFileSync(runCommandPath, 'utf8');
    // Extract the dispatch callback body (between 'async dispatch(ctx)' and the next callback)
    const dispatchMatch = src.match(/async dispatch\(ctx\)\s*\{([\s\S]*?)^\s{4}\},/m);
    if (dispatchMatch) {
      const dispatchBody = dispatchMatch[1];
      assert.ok(
        !dispatchBody.includes('process.exit'),
        'dispatch callback must not call process.exit — it returns a result, runLoop decides',
      );
    }
  });

  // AT-RUN-GUARD-006: run.js rejects manual adapter in dispatch
  it('AT-RUN-GUARD-006: dispatch callback rejects manual adapter', () => {
    const src = readFileSync(runCommandPath, 'utf8');
    assert.ok(
      src.includes("manual adapter is not supported in run mode"),
      'run.js must reject manual adapter dispatches',
    );
  });

  // AT-RUN-GUARD-007: run.js supports all three automated adapter types
  it('AT-RUN-GUARD-007: dispatch routes to api_proxy, local_cli, and mcp', () => {
    const src = readFileSync(runCommandPath, 'utf8');
    assert.ok(src.includes('dispatchApiProxy'), 'must route to api_proxy adapter');
    assert.ok(src.includes('dispatchLocalCli'), 'must route to local_cli adapter');
    assert.ok(src.includes('dispatchMcp'), 'must route to mcp adapter');
  });

  // AT-RUN-GUARD-008: approveGate is fail-closed (returns false) for non-TTY
  it('AT-RUN-GUARD-008: gate approval handles non-TTY stdin', () => {
    const src = readFileSync(runCommandPath, 'utf8');
    assert.ok(
      src.includes('process.stdin.isTTY'),
      'approveGate must check isTTY for fail-closed non-interactive behavior',
    );
  });

  // AT-RUN-GUARD-009: run.js uses deriveRecoveryDescriptor for blocked states
  it('AT-RUN-GUARD-009: recovery guidance uses deriveRecoveryDescriptor', () => {
    const src = readFileSync(runCommandPath, 'utf8');
    assert.ok(
      src.includes('deriveRecoveryDescriptor'),
      'run.js must use deriveRecoveryDescriptor for blocked-state recovery guidance',
    );
  });

  // AT-RUN-GUARD-010: run.js file exists
  it('AT-RUN-GUARD-010: run.js exists at expected path', () => {
    assert.ok(existsSync(runCommandPath), 'cli/src/commands/run.js must exist');
  });

  // AT-RUN-GUARD-011: run.js imports buildRunExport and buildGovernanceReport for auto-report
  it('AT-RUN-GUARD-011: run.js imports auto-report dependencies', () => {
    const src = readFileSync(runCommandPath, 'utf8');
    assert.ok(
      src.includes('buildRunExport'),
      'run.js must import buildRunExport for automatic governance export after run',
    );
    assert.ok(
      src.includes('buildGovernanceReport'),
      'run.js must import buildGovernanceReport for automatic governance report after run',
    );
    assert.ok(
      src.includes('formatGovernanceReportMarkdown'),
      'run.js must import formatGovernanceReportMarkdown for writing the report file',
    );
  });

  // AT-RUN-GUARD-012: run.js writes reports to .agentxchain/reports/
  it('AT-RUN-GUARD-012: auto-report writes to .agentxchain/reports/', () => {
    const src = readFileSync(runCommandPath, 'utf8');
    assert.ok(
      src.includes('.agentxchain/reports/report-'),
      'run.js must reference .agentxchain/reports/ for governance report output',
    );
    assert.ok(
      src.includes('export-'),
      'run.js must write export artifact alongside the governance report',
    );
  });

  // AT-RUN-GUARD-013: run.js respects --no-report flag
  it('AT-RUN-GUARD-013: auto-report respects --no-report opt-out', () => {
    const src = readFileSync(runCommandPath, 'utf8');
    assert.ok(
      src.includes('opts.report !== false'),
      'run.js must check opts.report to support --no-report suppression',
    );
    const bin = readFileSync(binPath, 'utf8');
    assert.ok(
      bin.includes('--no-report'),
      '--no-report option must be registered in CLI entry point',
    );
  });

  // AT-RUN-GUARD-014: auto-report does not change exit code on failure
  it('AT-RUN-GUARD-014: auto-report failure does not alter exit code', () => {
    const src = readFileSync(runCommandPath, 'utf8');
    // The report generation must be wrapped in try/catch so failures are non-fatal
    assert.ok(
      src.includes('Governance report failed:') || src.includes('Governance report skipped:'),
      'run.js must handle report generation failures gracefully without altering exit code',
    );
  });
});
