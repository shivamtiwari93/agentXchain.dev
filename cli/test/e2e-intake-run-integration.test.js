/**
 * E2E intake -> run integration proof
 *
 * Validates the shipped repo-local automation handoff through real CLI
 * subprocesses:
 * record -> triage -> approve -> plan -> start -> run -> resolve.
 *
 * See: .planning/E2E_INTAKE_RUN_INTEGRATION_SPEC.md
 */

import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { scaffoldGoverned } from '../src/commands/init.js';

const cliRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI_BIN = join(cliRoot, 'bin', 'agentxchain.js');
const MOCK_AGENT = join(cliRoot, 'test-support', 'mock-agent.mjs');

const tempDirs = [];

function makeProject() {
  const root = mkdtempSync(join(tmpdir(), 'axc-e2e-intake-run-'));
  tempDirs.push(root);
  scaffoldGoverned(root, 'Intake Run Integration', `intake-run-${Date.now()}`);

  const configPath = join(root, 'agentxchain.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  const mockRuntime = {
    type: 'local_cli',
    command: process.execPath,
    args: [MOCK_AGENT],
    prompt_transport: 'dispatch_bundle_only',
  };

  for (const runtimeId of Object.keys(config.runtimes || {})) {
    config.runtimes[runtimeId] = { ...mockRuntime };
  }
  for (const role of Object.values(config.roles || {})) {
    role.write_authority = 'authoritative';
  }

  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
  return root;
}

function runCli(root, args, opts = {}) {
  const result = spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout: opts.timeout || 60000,
  });

  return {
    exitCode: result.status ?? 1,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    combined: `${result.stdout || ''}${result.stderr || ''}`,
  };
}

function parseJsonResult(result, label) {
  assert.equal(result.exitCode, 0, `${label} failed:\n${result.combined}`);
  return JSON.parse(result.stdout);
}

function readState(root) {
  return JSON.parse(readFileSync(join(root, '.agentxchain', 'state.json'), 'utf8'));
}

function readIntent(root, intentId) {
  const intentsDir = join(root, '.agentxchain', 'intake', 'intents');
  const filename = readdirSync(intentsDir)
    .find((entry) => entry === `${intentId}.json`);
  assert.ok(filename, `intent artifact ${intentId}.json must exist`);
  return JSON.parse(readFileSync(join(intentsDir, filename), 'utf8'));
}

function readHistory(root) {
  return readFileSync(join(root, '.agentxchain', 'history.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('E2E intake -> run integration', () => {
  it('AT-E2E-INTAKE-RUN-001: intake-started work completes through agentxchain run without changing run identity', () => {
    const root = makeProject();

    const recordOut = parseJsonResult(runCli(root, [
      'intake', 'record',
      '--source', 'manual',
      '--signal', '{"description":"prove intake-to-run automation"}',
      '--evidence', '{"type":"text","value":"repo-local run continuation proof"}',
      '--json',
    ]), 'intake record');
    const intentId = recordOut.intent.intent_id;

    parseJsonResult(runCli(root, [
      'intake', 'triage',
      '--intent', intentId,
      '--priority', 'p1',
      '--template', 'cli-tool',
      '--charter', 'Prove that intake-started work can continue through agentxchain run',
      '--acceptance', 'run continues the intake-started governed run to completion',
      '--json',
    ]), 'intake triage');

    parseJsonResult(runCli(root, [
      'intake', 'approve',
      '--intent', intentId,
      '--approver', 'e2e-operator',
      '--reason', 'single-repo automation proof',
      '--json',
    ]), 'intake approve');

    const planOut = parseJsonResult(runCli(root, [
      'intake', 'plan',
      '--intent', intentId,
      '--project-name', 'Intake Run Integration',
      '--json',
    ]), 'intake plan');
    assert.ok(Array.isArray(planOut.intent.planning_artifacts), 'planning artifacts must be recorded');
    assert.ok(planOut.intent.planning_artifacts.length > 0, 'planning artifacts must not be empty');
    for (const relPath of planOut.intent.planning_artifacts) {
      assert.ok(existsSync(join(root, relPath)), `planning artifact must exist: ${relPath}`);
    }

    const startOut = parseJsonResult(runCli(root, [
      'intake', 'start',
      '--intent', intentId,
      '--json',
    ]), 'intake start');
    assert.equal(startOut.intent.status, 'executing');
    assert.equal(startOut.role, 'pm');
    assert.ok(startOut.run_id, 'run_id must be returned');
    assert.ok(startOut.turn_id, 'turn_id must be returned');

    const startState = readState(root);
    assert.equal(startState.status, 'active');
    assert.equal(startState.run_id, startOut.run_id);
    assert.ok(startState.active_turns[startOut.turn_id], 'started turn must be active');
    assert.equal(startState.active_turns[startOut.turn_id].assigned_role, 'pm');

    const resolveBeforeRun = parseJsonResult(runCli(root, [
      'intake', 'resolve',
      '--intent', intentId,
      '--json',
    ]), 'intake resolve before run completion');
    assert.equal(resolveBeforeRun.no_change, true, 'resolve must not close an active run');
    assert.equal(resolveBeforeRun.new_status, 'executing');
    assert.equal(resolveBeforeRun.run_outcome, 'active');

    const runResult = runCli(root, ['run', '--auto-approve', '--max-turns', '10']);
    assert.equal(runResult.exitCode, 0, `run failed:\n${runResult.combined}`);
    assert.match(runResult.stdout, /Run completed/, 'run must complete');
    assert.match(runResult.stdout, new RegExp(`Turn accepted:\\s+${startOut.turn_id}`), 'run must accept the intake-started turn');
    assert.match(runResult.stdout, /Turn assigned:.*dev/i, 'run must continue into implementation');
    assert.match(runResult.stdout, /Turn assigned:.*qa/i, 'run must continue into QA');
    assert.match(runResult.stdout, /Turns:\s+3/, 'run summary must count all three governed turns');

    const completedState = readState(root);
    assert.equal(completedState.status, 'completed', 'governed run must complete');
    assert.equal(completedState.run_id, startOut.run_id, 'run must preserve the intake-started run identity');
    assert.ok(completedState.last_completed_turn_id, 'final turn id must be recorded');

    const reportsDir = join(root, '.agentxchain', 'reports');
    const exportPath = join(reportsDir, `export-${startOut.run_id}.json`);
    const reportPath = join(reportsDir, `report-${startOut.run_id}.md`);
    assert.ok(existsSync(exportPath), 'run must emit the governed export artifact automatically');
    assert.ok(existsSync(reportPath), 'run must emit the governance report automatically');

    const exportArtifact = JSON.parse(readFileSync(exportPath, 'utf8'));
    assert.equal(exportArtifact.summary.run_id, startOut.run_id, 'auto-export must preserve the intake-started run_id');
    assert.equal(exportArtifact.summary.status, 'completed', 'auto-export must reflect completed run status');

    const reportMarkdown = readFileSync(reportPath, 'utf8');
    assert.match(reportMarkdown, new RegExp(`Run: \`${startOut.run_id}\``), 'governance report must identify the completed run');
    assert.match(reportMarkdown, /Verification: `pass`/, 'governance report must be built from a valid export artifact');
    assert.match(reportMarkdown, /Status: `completed`/, 'governance report must reflect final run status');
    assert.match(reportMarkdown, /## Turn Timeline/, 'governance report must include turn timeline for real run output');
    assert.match(reportMarkdown, /\| 1 \| pm /, 'governance report must include the intake-started PM turn row');
    assert.match(reportMarkdown, /## Intake Linkage/, 'governance report must expose intake linkage on intake-started runs');
    assert.match(reportMarkdown, new RegExp(`\`${intentId}\``), 'governance report must identify the linked intake intent');
    assert.match(reportMarkdown, /## Gate Outcomes/, 'governance report must expose gate outcomes on completed runs');
    assert.match(reportMarkdown, /`planning_signoff`: `passed`/, 'governance report must show passed planning gate');
    assert.match(reportMarkdown, /`qa_ship_verdict`: `passed`/, 'governance report must show passed completion gate');

    const historyEntries = readHistory(root);
    assert.ok(
      historyEntries.some((entry) => entry.turn_id === startOut.turn_id),
      'history must include the intake-started turn',
    );

    const intentBeforeResolve = readIntent(root, intentId);
    assert.equal(intentBeforeResolve.status, 'executing', 'intent must stay executing until resolve');
    assert.equal(intentBeforeResolve.target_run, startOut.run_id);
    assert.equal(intentBeforeResolve.target_turn, startOut.turn_id);

    const resolveAfterRun = parseJsonResult(runCli(root, [
      'intake', 'resolve',
      '--intent', intentId,
      '--json',
    ]), 'intake resolve after run completion');
    assert.equal(resolveAfterRun.no_change, false);
    assert.equal(resolveAfterRun.new_status, 'completed');
    assert.equal(resolveAfterRun.run_outcome, 'completed');
    assert.equal(resolveAfterRun.intent.target_run, startOut.run_id);
    assert.equal(resolveAfterRun.intent.run_final_turn, completedState.last_completed_turn_id);
    assert.ok(resolveAfterRun.intent.run_completed_at, 'completed intent must record run_completed_at');
    assert.ok(
      existsSync(join(root, '.agentxchain', 'intake', 'observations', intentId)),
      'observation scaffold must exist after resolve',
    );
    assert.ok(
      resolveAfterRun.intent.history.some((entry) =>
        entry.from === 'executing'
        && entry.to === 'completed'
        && entry.run_id === startOut.run_id
        && entry.run_status === 'completed'),
      'intent history must record executing -> completed against the same run',
    );
  });
});
