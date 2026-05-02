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
const resumeCommandPath = join(cliRoot, 'src', 'commands', 'resume.js');

const tempDirs = [];

function makeProject() {
  const root = mkdtempSync(join(tmpdir(), 'axc-resume-context-'));
  tempDirs.push(root);
  scaffoldGoverned(root, 'Resume Context Fixture', `resume-context-${Date.now()}`);

  const configPath = join(root, 'agentxchain.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));

  // resume uses manual adapter (no runtime dispatch needed — it exits after assignment)
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
  mkdirSync(join(root, '.agentxchain', 'staging'), { recursive: true });
  return root;
}

function writeState(root, overrides = {}) {
  const statePath = join(root, '.agentxchain', 'state.json');
  const state = JSON.parse(readFileSync(statePath, 'utf8'));

  // Use active status with no active turns — this falls through to role
  // resolution + assign, which is the main resume path that should show the header.
  const nextState = {
    ...state,
    run_id: 'run_resume_test_001',
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

describe('resume context header', () => {
  it('AT-RCH-000: resume recovery surfaces pass config into deriveRecoveryDescriptor', () => {
    const src = readFileSync(resumeCommandPath, 'utf8');
    assert.match(
      src,
      /deriveRecoveryDescriptor\(state,\s*config\)/,
      'resume recovery summary must pass normalized config into deriveRecoveryDescriptor',
    );
    assert.match(
      src,
      /deriveRecoveryDescriptor\(result\.state,\s*config\)/,
      'resume assignment-hook recovery output must pass normalized config into deriveRecoveryDescriptor',
    );
  });

  it('AT-RCH-001: continuation-backed resume shows Origin in the run header', () => {
    const root = makeProject();
    writeState(root, {
      provenance: {
        trigger: 'continuation',
        parent_run_id: 'run_parent_resume_001',
        created_by: 'operator',
      },
    });

    const result = runCli(root, ['resume']);
    const stdout = result.stdout || '';

    // Header prints before dispatch — assert content regardless of exit code
    assert.match(stdout, /agentxchain resume/, 'resume should print a run header');
    assert.match(stdout, /Run:\s+run_resume_test_001/, 'resume should show the current run id');
    assert.match(stdout, /Origin:/, 'resume header should include Origin');
    assert.match(stdout, /continuation/, 'Origin should mention continuation');
    assert.match(stdout, /run_parent_resume_001/, 'Origin should include the parent run id');
  });

  it('AT-RCH-002: inherited-context resume shows Inherits', () => {
    const root = makeProject();
    writeState(root, {
      provenance: {
        trigger: 'continuation',
        parent_run_id: 'run_parent_inherit_resume_002',
        created_by: 'operator',
      },
      inherited_context: {
        parent_run_id: 'run_parent_inherit_resume_002',
        parent_status: 'completed',
        inherited_at: new Date().toISOString(),
        parent_phases_completed: ['planning'],
        parent_roles_used: ['pm'],
        recent_decisions: [],
        recent_accepted_turns: [],
        parent_retrospective: null,
      },
    });

    const result = runCli(root, ['resume']);
    const stdout = result.stdout || '';

    assert.match(stdout, /Inherits:/, 'resume header should include Inherits');
    assert.match(stdout, /parent run_parent_inherit_resume_002 \(completed\)/, 'Inherits should show parent identity');
  });

  it('AT-RCH-003: fresh/manual resume omits Origin and Inherits', () => {
    const root = makeProject();
    writeState(root);

    const result = runCli(root, ['resume']);
    const stdout = result.stdout || '';

    assert.match(stdout, /agentxchain resume/, 'resume should print header');
    assert.match(stdout, /Run:/, 'resume should show run id');
    assert.match(stdout, /Phase:\s+planning/, 'resume should show phase');
    assert.doesNotMatch(stdout, /Origin:/, 'manual resume should not show Origin');
    assert.doesNotMatch(stdout, /Inherits:/, 'manual resume should not show Inherits');
  });

  it('AT-RCH-004: resume shows Gate when exit gate is defined', () => {
    const root = makeProject();
    writeState(root);

    const result = runCli(root, ['resume']);
    const stdout = result.stdout || '';

    assert.match(stdout, /Gate:\s+planning_signoff \(pending\)/, 'resume header should show the active gate');
  });
});
