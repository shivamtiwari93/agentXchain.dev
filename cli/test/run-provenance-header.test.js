/**
 * AT-RPH-001 through AT-RPH-004: Run provenance header tests.
 *
 * Verifies that `agentxchain run` displays provenance and inheritance
 * information in the run header when --continue-from / --recover-from
 * flags are used.
 */

import { afterEach, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  appendFileSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { scaffoldGoverned } from '../src/commands/init.js';

const cliRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI_BIN = join(cliRoot, 'bin', 'agentxchain.js');
const MOCK_AGENT = join(cliRoot, 'test-support', 'mock-agent.mjs');

const tempDirs = [];

function makeProject() {
  const root = mkdtempSync(join(tmpdir(), 'axc-rph-'));
  tempDirs.push(root);
  scaffoldGoverned(root, 'RPH Test', `rph-${Date.now()}`);

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

/** Write a fake parent run into run-history.jsonl so --continue-from / --recover-from can find it */
function seedParentRun(root, runId, status) {
  const historyPath = join(root, '.agentxchain', 'run-history.jsonl');
  mkdirSync(dirname(historyPath), { recursive: true });
  const record = {
    schema_version: '0.2',
    run_id: runId,
    status,
    started_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
    phases_completed: ['planning', 'implementation'],
    roles_used: ['pm', 'dev'],
    decisions_count: 2,
    total_turns: 4,
    blocked_reason: status === 'blocked' ? 'test blocker' : null,
    retrospective: {
      headline: 'Parent run completed',
      terminal_reason: status,
    },
    inheritance_snapshot: {
      recent_decisions: [
        { decision_id: 'DEC-TEST-001', statement: 'Use mock adapter' },
        { decision_id: 'DEC-TEST-002', statement: 'Ship it' },
      ],
      recent_accepted_turns: [
        { turn_id: 't-001', role: 'pm', summary: 'Planned the work' },
      ],
    },
    recorded_at: new Date().toISOString(),
  };
  appendFileSync(historyPath, JSON.stringify(record) + '\n');
}

function runCli(root, args) {
  return spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout: 30000,
    env: { ...process.env, FORCE_COLOR: '0' },
  });
}

afterEach(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  tempDirs.length = 0;
});

describe('Run provenance header', () => {
  it('AT-RPH-001: --continue-from shows Origin in run header', () => {
    const root = makeProject();
    const parentId = 'parent-run-continue-001';
    seedParentRun(root, parentId, 'completed');

    const result = runCli(root, ['run', '--continue-from', parentId, '--max-turns', '1', '--auto-approve']);
    const stdout = result.stdout || '';

    assert.match(stdout, /Origin:/, 'run header should include Origin line');
    assert.match(stdout, /continuation/, 'Origin should mention continuation trigger');
    assert.match(stdout, /parent-run-continue-001/, 'Origin should reference parent run ID');
  });

  it('AT-RPH-002: --continue-from --inherit-context shows both Origin and Inherits', () => {
    const root = makeProject();
    const parentId = 'parent-run-inherit-002';
    seedParentRun(root, parentId, 'completed');

    const result = runCli(root, ['run', '--continue-from', parentId, '--inherit-context', '--max-turns', '1', '--auto-approve']);
    const stdout = result.stdout || '';

    assert.match(stdout, /Origin:/, 'run header should include Origin line');
    assert.match(stdout, /Inherits:/, 'run header should include Inherits line');
    assert.match(stdout, /parent parent-run-inherit-002/, 'Inherits should reference parent run ID');
  });

  it('AT-RPH-003: --recover-from shows Origin: recovery in run header', () => {
    const root = makeProject();
    const parentId = 'parent-run-recover-003';
    seedParentRun(root, parentId, 'blocked');

    const result = runCli(root, ['run', '--recover-from', parentId, '--max-turns', '1', '--auto-approve']);
    const stdout = result.stdout || '';

    assert.match(stdout, /Origin:/, 'run header should include Origin line');
    assert.match(stdout, /recovery/, 'Origin should mention recovery trigger');
  });

  it('AT-RPH-004: plain run without provenance does NOT show Origin', () => {
    const root = makeProject();

    const result = runCli(root, ['run', '--max-turns', '1', '--auto-approve']);
    const stdout = result.stdout || '';

    assert.doesNotMatch(stdout, /Origin:/, 'plain run should not show Origin line');
    assert.doesNotMatch(stdout, /Inherits:/, 'plain run should not show Inherits line');
  });
});
