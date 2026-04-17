/**
 * AT-RUN-INT-001, AT-RUN-INT-002, AT-RUN-INT-003
 *
 * Behavioral integration tests for `agentxchain run`.
 * These prove actual end-to-end CLI behavior through a real governed project
 * with local_cli runtimes backed by a mock agent script.
 *
 * No mocking of runLoop, adapters, or state machine — the real code path runs.
 */

import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { scaffoldGoverned } from '../src/commands/init.js';
import { assignGovernedTurn, initializeGovernedRun } from '../src/lib/governed-state.js';

const cliRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const binPath = join(cliRoot, 'bin', 'agentxchain.js');
const mockAgentPath = join(cliRoot, 'test-support', 'mock-agent.mjs');

const tempDirs = [];

/**
 * Create a governed project using scaffoldGoverned, then patch all runtimes
 * to use local_cli with the mock-agent.mjs script.
 */
function makeProject() {
  const root = mkdtempSync(join(tmpdir(), 'axc-run-int-'));
  tempDirs.push(root);
  scaffoldGoverned(root, 'Run Integration Test', `run-int-${Date.now()}`);

  // Patch config: all roles use local_cli runtimes backed by mock-agent.
  // review_only + local_cli is rejected by normalized-config validation,
  // so we promote all roles to authoritative for the integration fixture.
  const configPath = join(root, 'agentxchain.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));

  const mockRuntime = {
    type: 'local_cli',
    command: process.execPath,
    args: [mockAgentPath],
    prompt_transport: 'dispatch_bundle_only',
  };

  for (const key of Object.keys(config.runtimes)) {
    config.runtimes[key] = { ...mockRuntime };
  }
  for (const role of Object.values(config.roles)) {
    role.write_authority = 'authoritative';
  }

  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
  return root;
}

function runCli(root, args, opts = {}) {
  return spawnSync(process.execPath, [binPath, ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout: opts.timeout || 30000,
    input: opts.input || undefined,
  });
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('agentxchain run — integration', () => {

  // ──────────────────────────────────────────────────────────────────────────
  // AT-RUN-INT-001: Full 3-turn governed lifecycle to completion
  // ──────────────────────────────────────────────────────────────────────────
  it('AT-RUN-INT-001: completes a 3-turn governed lifecycle with auto-approve and exits 0', () => {
    const root = makeProject();

    const result = runCli(root, ['run', '--auto-approve', '--max-turns', '5']);

    // Must exit 0
    assert.equal(result.status, 0, `Expected exit 0, got ${result.status}.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);

    // Must show "Run completed" in output
    assert.match(result.stdout, /Run completed/, 'Expected "Run completed" in output');

    // Must show turn assignments for pm, dev, qa
    assert.match(result.stdout, /Turn assigned:.*pm/i, 'Expected pm turn assignment');
    assert.match(result.stdout, /Turn assigned:.*dev/i, 'Expected dev turn assignment');
    assert.match(result.stdout, /Turn assigned:.*qa/i, 'Expected qa turn assignment');

    // Summary must show at least 3 turns executed
    assert.match(result.stdout, /Turns:\s+3/, 'Expected 3 turns in summary');

    // Must have approved at least 2 gates (planning→implementation, qa→completion)
    assert.match(result.stdout, /Gates:\s+[23]/, 'Expected 2-3 gates approved');

    // State file should be in completed status
    const state = JSON.parse(readFileSync(join(root, '.agentxchain/state.json'), 'utf8'));
    assert.equal(state.status, 'completed', 'Final state should be completed');

    // Gate files should exist (created by mock agent)
    assert.ok(existsSync(join(root, '.planning/PM_SIGNOFF.md')), 'PM signoff should exist');
    assert.ok(existsSync(join(root, '.planning/ROADMAP.md')), 'Roadmap should exist');
    assert.ok(existsSync(join(root, '.planning/acceptance-matrix.md')), 'Acceptance matrix should exist');
    assert.ok(existsSync(join(root, '.planning/ship-verdict.md')), 'Ship verdict should exist');

    // History should have 3 entries
    const history = readFileSync(join(root, '.agentxchain/history.jsonl'), 'utf8')
      .trim().split('\n').filter(Boolean);
    assert.ok(history.length >= 3, `Expected at least 3 history entries, got ${history.length}`);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // AT-RUN-INT-002: Gate hold when user denies approval (non-TTY → fail-closed)
  // ──────────────────────────────────────────────────────────────────────────
  it('AT-RUN-INT-002: holds at gate when stdin is not TTY (fail-closed)', () => {
    const root = makeProject();

    // Without --auto-approve, gates should fail-closed when stdin is not a TTY
    // (spawnSync stdin is a pipe, not a TTY)
    const result = runCli(root, ['run', '--max-turns', '5']);

    // The pm turn should succeed, but the phase gate should hold
    assert.match(result.stdout, /Turn assigned:.*pm/i, 'PM turn should be assigned');
    assert.match(result.stdout, /Turn accepted/i, 'PM turn should be accepted');

    // Should show gate hold behavior
    assert.match(result.stdout, /Gate pause.*phase_transition|stdin is not a TTY|failing closed/i,
      'Expected gate hold or fail-closed message');

    // Should show gate_held in summary
    assert.match(result.stdout, /gate_held/, 'Expected gate_held stop reason');

    // Should exit 0 (gate_held is a success exit per DEC-RUN-006)
    assert.equal(result.status, 0, `Expected exit 0 for gate_held, got ${result.status}`);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // AT-RUN-INT-003: auto-approve advances through gates without prompting
  // ──────────────────────────────────────────────────────────────────────────
  it('AT-RUN-INT-003: auto-approve advances through all gates', () => {
    const root = makeProject();

    const result = runCli(root, ['run', '--auto-approve', '--max-turns', '5']);

    // Should show auto-approved messages
    assert.match(result.stdout, /Auto-approved/i, 'Expected auto-approve messages');

    // Should reach completion (not gate_held)
    assert.match(result.stdout, /Run completed/, 'Expected run completion with auto-approve');
    assert.equal(result.status, 0);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // AT-RUN-INT-004: max-turns safety limit stops the run
  // ──────────────────────────────────────────────────────────────────────────
  it('AT-RUN-INT-004: max-turns limit triggers graceful stop', () => {
    const root = makeProject();

    // With max-turns 1, only one turn should execute before stopping
    const result = runCli(root, ['run', '--auto-approve', '--max-turns', '1']);

    // Should execute exactly 1 turn
    assert.match(result.stdout, /Turns:\s+1/, 'Expected 1 turn in summary');

    // Should stop with max_turns_reached
    assert.match(result.stdout, /max_turns_reached/, 'Expected max_turns_reached stop reason');

    // max_turns_reached exits 0 per DEC-RUN-006
    assert.equal(result.status, 0);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // AT-RUN-INT-005: dry-run mode does not execute anything
  // ──────────────────────────────────────────────────────────────────────────
  it('AT-RUN-INT-005: dry-run prints plan and exits without execution', () => {
    const root = makeProject();

    const result = runCli(root, ['run', '--dry-run']);

    assert.equal(result.status, 0);
    assert.match(result.stdout, /Dry run/, 'Expected dry-run header');
    assert.match(result.stdout, /First role:\s+pm/, 'Expected pm as first role');
    assert.match(result.stdout, /local_cli/, 'Expected local_cli runtime type');

    // State should still be idle (nothing executed)
    const state = JSON.parse(readFileSync(join(root, '.agentxchain/state.json'), 'utf8'));
    assert.equal(state.status, 'idle', 'State should remain idle after dry-run');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // AT-RUN-INT-006: --no-report suppresses auto-generated governance artifacts
  // ──────────────────────────────────────────────────────────────────────────
  it('AT-RUN-INT-006: --no-report suppresses auto-generated governance artifacts', () => {
    const root = makeProject();

    const result = runCli(root, ['run', '--auto-approve', '--max-turns', '5', '--no-report']);

    assert.equal(result.status, 0, `Expected exit 0, got ${result.status}.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
    assert.match(result.stdout, /Run completed/, 'Expected run completion with --no-report');

    const state = JSON.parse(readFileSync(join(root, '.agentxchain/state.json'), 'utf8'));
    const reportsDir = join(root, '.agentxchain', 'reports');
    const exportPath = join(reportsDir, `export-${state.run_id}.json`);
    const reportPath = join(reportsDir, `report-${state.run_id}.md`);

    assert.ok(!existsSync(exportPath), 'export artifact must not be written when --no-report is set');
    assert.ok(!existsSync(reportPath), 'governance report must not be written when --no-report is set');
    assert.doesNotMatch(result.stdout, /Governance report:/, 'CLI output must not claim a report was written');
  });

  it('AT-RESTART-MSG-002: run bootstraps a governed project when state.json is missing', () => {
    const root = makeProject();
    rmSync(join(root, '.agentxchain/state.json'), { force: true });

    const result = runCli(root, ['run', '--auto-approve', '--max-turns', '5']);

    assert.equal(result.status, 0, `Expected exit 0, got ${result.status}.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
    assert.match(result.stdout, /Run completed/, 'Expected run completion after bootstrapping missing state');

    const statePath = join(root, '.agentxchain/state.json');
    assert.ok(existsSync(statePath), 'state.json should be recreated by run');
    const state = JSON.parse(readFileSync(statePath, 'utf8'));
    assert.equal(state.status, 'completed', 'bootstrapped run should complete successfully');
  });

  it('AT-RUN-TIMEOUT-004: blocks the real CLI when a local_cli dispatch hangs past the configured turn timeout', () => {
    const root = makeProject();
    const configPath = join(root, 'agentxchain.json');
    const config = JSON.parse(readFileSync(configPath, 'utf8'));

    config.timeouts = {
      per_turn_minutes: 1,
      action: 'escalate',
    };
    for (const key of Object.keys(config.runtimes)) {
      config.runtimes[key] = {
        type: 'local_cli',
        command: process.execPath,
        args: ['-e', 'setInterval(() => {}, 1000)'],
        prompt_transport: 'dispatch_bundle_only',
      };
    }
    writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');

    const init = initializeGovernedRun(root, config);
    assert.ok(init.ok, init.error);
    const assigned = assignGovernedTurn(root, config, 'pm');
    assert.ok(assigned.ok, assigned.error);

    const statePath = join(root, '.agentxchain/state.json');
    const state = JSON.parse(readFileSync(statePath, 'utf8'));
    const [turnId] = Object.keys(state.active_turns);
    state.active_turns[turnId].started_at = '2026-04-10T00:00:00.000Z';
    writeFileSync(statePath, JSON.stringify(state, null, 2));

    const result = runCli(root, ['run', '--auto-approve', '--max-turns', '5'], { timeout: 15000 });

    assert.equal(result.status, 1, `Expected timeout block exit 1, got ${result.status}.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`);
    assert.match(result.stdout, /Run blocked/, 'Expected blocked output');
    assert.match(result.stdout, /Recovery:\s+timeout/, 'Expected timeout recovery summary');
    assert.match(result.stdout, /Action:\s+agentxchain resume/, 'Expected resume recovery command');

    const blockedState = JSON.parse(readFileSync(statePath, 'utf8'));
    assert.equal(blockedState.status, 'blocked');
    assert.equal(blockedState.blocked_on, 'timeout:turn');
    assert.equal(Object.keys(blockedState.active_turns || {}).length, 1, 'timed-out turn must remain retained');
  });
});
