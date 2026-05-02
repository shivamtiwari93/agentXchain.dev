import { afterEach, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
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
  const root = mkdtempSync(join(tmpdir(), 'axc-step-context-'));
  tempDirs.push(root);
  scaffoldGoverned(root, 'Step Context Fixture', `step-context-${Date.now()}`);

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

function writeState(root, overrides = {}) {
  const statePath = join(root, '.agentxchain', 'state.json');
  const state = JSON.parse(readFileSync(statePath, 'utf8'));
  const nextState = {
    ...state,
    run_id: 'run_step_child_001',
    status: 'active',
    phase: 'planning',
    active_turns: {},
    turn_sequence: 0,
    last_completed_turn_id: null,
    blocked_on: null,
    blocked_reason: null,
    pending_phase_transition: null,
    pending_run_completion: null,
    queued_phase_transition: null,
    queued_run_completion: null,
    provenance: null,
    inherited_context: null,
    ...overrides,
  };

  writeFileSync(statePath, JSON.stringify(nextState, null, 2) + '\n');
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

describe('step context header', () => {
  it('AT-SCH-001: continuation-backed step shows Origin in the run header', () => {
    const root = makeProject();
    writeState(root, {
      provenance: {
        trigger: 'continuation',
        parent_run_id: 'run_parent_continue_001',
        created_by: 'operator',
      },
    });

    const result = runCli(root, ['step']);
    const stdout = result.stdout || '';

    assert.equal(result.status, 0, `step failed:\n${stdout}\n${result.stderr || ''}`);
    assert.match(stdout, /agentxchain step/, 'step should print a run header');
    assert.match(stdout, /Run:\s+run_step_child_001/, 'step should show the current run id');
    assert.match(stdout, /Origin:/, 'step header should include Origin');
    assert.match(stdout, /continuation/, 'Origin should mention continuation');
    assert.match(stdout, /run_parent_continue_001/, 'Origin should include the parent run id');
  });

  it('AT-SCH-002: inherited-context step shows Inherits plus active gate detail', () => {
    const root = makeProject();
    writeState(root, {
      provenance: {
        trigger: 'continuation',
        parent_run_id: 'run_parent_inherit_002',
        created_by: 'operator',
      },
      inherited_context: {
        parent_run_id: 'run_parent_inherit_002',
        parent_status: 'completed',
        inherited_at: new Date().toISOString(),
        parent_phases_completed: ['planning'],
        parent_roles_used: ['pm'],
        recent_decisions: [],
        recent_accepted_turns: [],
        parent_retrospective: null,
      },
    });

    const result = runCli(root, ['step']);
    const stdout = result.stdout || '';

    assert.equal(result.status, 0, `step failed:\n${stdout}\n${result.stderr || ''}`);
    assert.match(stdout, /Inherits:/, 'step header should include Inherits');
    assert.match(stdout, /parent run_parent_inherit_002 \(completed\)/, 'Inherits should show parent identity');
    assert.match(stdout, /Gate:\s+planning_signoff \(pending\)/, 'step header should show the active gate');
    assert.match(stdout, /Files:\s+PM_SIGNOFF\.md/, 'step header should show required files');
    assert.match(stdout, /ROADMAP\.md/, 'step header should show all gate files');
    assert.match(stdout, /SYSTEM_SPEC\.md/, 'step header should show all gate files');
    assert.match(stdout, /Needs:\s+human approval/, 'step header should show gate requirements');
  });

  it('AT-SCH-003: fresh/manual step omits Origin and Inherits while keeping run context', () => {
    const root = makeProject();
    writeState(root);

    const result = runCli(root, ['step']);
    const stdout = result.stdout || '';

    assert.equal(result.status, 0, `step failed:\n${stdout}\n${result.stderr || ''}`);
    assert.match(stdout, /Run:\s+run_step_child_001/, 'step should still show run id');
    assert.match(stdout, /Phase:\s+planning/, 'step should still show phase');
    assert.doesNotMatch(stdout, /Origin:/, 'manual step should not show Origin');
    assert.doesNotMatch(stdout, /Inherits:/, 'manual step should not show Inherits');
  });
});
