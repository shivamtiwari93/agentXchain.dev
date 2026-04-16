import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { scaffoldGoverned } from '../src/commands/init.js';
import { loadProjectContext } from '../src/lib/config.js';
import { executeGovernedRun } from '../src/commands/run.js';

const cliRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI_BIN = join(cliRoot, 'bin', 'agentxchain.js');
const MOCK_AGENT = join(cliRoot, 'test-support', 'mock-agent.mjs');

const tempDirs = [];

function makeProject() {
  const root = mkdtempSync(join(tmpdir(), 'axc-run-chain-e2e-'));
  tempDirs.push(root);
  scaffoldGoverned(root, 'Run Chain E2E', `run-chain-${Date.now()}`);

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
  mkdirSync(join(root, '.agentxchain', 'staging'), { recursive: true });
  return root;
}

function runCli(root, args, opts = {}) {
  const result = spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout: opts.timeout || 120000,
    env: { ...process.env, NO_COLOR: '1', NODE_NO_WARNINGS: '1' },
  });

  return {
    status: result.status ?? 1,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    combined: `${result.stdout || ''}${result.stderr || ''}`,
  };
}

function readState(root) {
  return JSON.parse(readFileSync(join(root, '.agentxchain', 'state.json'), 'utf8'));
}

function readRunHistory(root) {
  const raw = readFileSync(join(root, '.agentxchain', 'run-history.jsonl'), 'utf8').trim();
  if (!raw) return [];
  return raw.split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

function readChainReport(root) {
  const reportsDir = join(root, '.agentxchain', 'reports');
  const reportName = readdirSync(reportsDir).find((name) => name.startsWith('chain-') && name.endsWith('.json'));
  assert.ok(reportName, 'expected a chain report in .agentxchain/reports');
  return JSON.parse(readFileSync(join(reportsDir, reportName), 'utf8'));
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('run chaining E2E', () => {
  it('AT-CHAIN-E2E-001: run --chain records three linked runs with inherited context summaries', () => {
    const root = makeProject();

    const result = runCli(root, [
      'run',
      '--chain',
      '--max-chains',
      '2',
      '--chain-cooldown',
      '0',
      '--auto-approve',
      '--max-turns',
      '5',
    ]);

    assert.equal(result.status, 0, `run --chain failed:\n${result.combined}`);
    assert.match(result.stdout, /Chain Summary/, 'must print the chain summary');
    assert.match(result.stdout, /Total runs:\s+3/, 'must report 3 total runs');

    const history = readRunHistory(root);
    assert.equal(history.length, 3, 'expected 3 run-history entries');
    assert.equal(new Set(history.map((entry) => entry.run_id)).size, 3, 'run ids must stay unique');
    assert.equal(history[0].provenance.trigger, 'manual');
    assert.equal(history[1].provenance.trigger, 'continuation');
    assert.equal(history[1].provenance.parent_run_id, history[0].run_id);
    assert.equal(history[2].provenance.trigger, 'continuation');
    assert.equal(history[2].provenance.parent_run_id, history[1].run_id);

    const chainReport = readChainReport(root);
    assert.equal(chainReport.terminal_reason, 'chain_limit_reached');
    assert.equal(chainReport.runs.length, 3);
    assert.equal(chainReport.runs[0].provenance_trigger, 'manual');
    assert.equal(chainReport.runs[0].inherited_context_summary, null);
    assert.equal(chainReport.runs[1].provenance_trigger, 'continuation');
    assert.equal(chainReport.runs[1].parent_run_id, history[0].run_id);
    assert.equal(chainReport.runs[1].inherited_context_summary.parent_run_id, history[0].run_id);
    assert.equal(chainReport.runs[1].inherited_context_summary.parent_status, 'completed');
    assert.ok(chainReport.runs[1].inherited_context_summary.recent_accepted_turns_count > 0);
    assert.equal(chainReport.runs[2].parent_run_id, history[1].run_id);
    assert.equal(chainReport.runs[2].inherited_context_summary.parent_run_id, history[1].run_id);

    for (const run of chainReport.runs) {
      assert.ok(existsSync(join(root, '.agentxchain', 'reports', `export-${run.run_id}.json`)), `missing export for ${run.run_id}`);
      assert.ok(existsSync(join(root, '.agentxchain', 'reports', `report-${run.run_id}.md`)), `missing governance report for ${run.run_id}`);
    }

    const finalState = readState(root);
    assert.equal(finalState.status, 'completed');
    assert.equal(finalState.run_id, history[2].run_id);
    assert.equal(finalState.inherited_context.parent_run_id, history[1].run_id);
  });

  it('AT-CHAIN-E2E-002: executeGovernedRun removes SIGINT listeners after each run', async () => {
    const root = makeProject();
    const baselineListeners = process.listenerCount('SIGINT');

    const first = await executeGovernedRun(loadProjectContext(root), {
      autoApprove: true,
      maxTurns: 5,
      log: () => {},
    });
    assert.equal(first.exitCode, 0, 'first run must succeed');
    assert.equal(process.listenerCount('SIGINT'), baselineListeners, 'first run must clean up SIGINT listener');

    const parentRunId = readState(root).run_id;
    const second = await executeGovernedRun(loadProjectContext(root), {
      autoApprove: true,
      maxTurns: 5,
      continueFrom: parentRunId,
      inheritContext: true,
      log: () => {},
    });
    assert.equal(second.exitCode, 0, 'continuation run must succeed');
    assert.equal(second.result.state.provenance.parent_run_id, parentRunId);
    assert.equal(process.listenerCount('SIGINT'), baselineListeners, 'continuation run must clean up SIGINT listener');
  });
});
