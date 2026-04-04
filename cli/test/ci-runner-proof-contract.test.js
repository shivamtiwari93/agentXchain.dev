/**
 * CI Runner Proof Contract Test
 *
 * Guards that the CI runner proof script:
 *   1. Does NOT shell out to CLI commands (exec, spawn, agentxchain)
 *   2. DOES import from runner-interface.js
 *   3. Actually executes and produces valid output
 *   4. Is wired into a GitHub Actions workflow
 *
 * AT-CI-RUNNER-001 through AT-CI-RUNNER-005
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { execFileSync } from 'child_process';

const CLI_ROOT = join(import.meta.dirname, '..');
const REPO_ROOT = join(CLI_ROOT, '..');
const PROOF_SCRIPT = join(REPO_ROOT, 'examples', 'ci-runner-proof', 'run-one-turn.mjs');
const WORKFLOW_PATH = join(REPO_ROOT, '.github', 'workflows', 'ci-runner-proof.yml');

// ── AT-CI-RUNNER-002 / AT-CI-RUNNER-005: No CLI shell-out ───────────────────

describe('CI runner proof: no CLI shell-out', () => {
  const source = readFileSync(PROOF_SCRIPT, 'utf8');

  it('AT-CI-RUNNER-002: does not import child_process', () => {
    assert.ok(
      !source.includes("from 'child_process'") && !source.includes('require("child_process")') && !source.includes("require('child_process')"),
      'proof script must not import child_process',
    );
  });

  it('AT-CI-RUNNER-005a: does not use exec/spawn/execFile/execSync/spawnSync', () => {
    const forbidden = ['execSync', 'spawnSync', 'execFile', 'execFileSync'];
    for (const fn of forbidden) {
      assert.ok(!source.includes(fn), `proof script must not use ${fn}`);
    }
    // Check exec/spawn only as function calls, not as substrings of other words
    assert.ok(!/\bexec\s*\(/.test(source), 'proof script must not call exec()');
    assert.ok(!/\bspawn\s*\(/.test(source), 'proof script must not call spawn()');
  });

  it('AT-CI-RUNNER-005b: does not reference agentxchain CLI binary', () => {
    assert.ok(!source.includes('agentxchain step'), 'proof script must not call agentxchain step');
    assert.ok(!source.includes('bin/agentxchain'), 'proof script must not reference bin/agentxchain');
    // agentxchain.js as a standalone reference (not agentxchain.json which is the config file)
    assert.ok(
      !/agentxchain\.js\b/.test(source.replace(/agentxchain\.json/g, '')),
      'proof script must not reference agentxchain.js binary',
    );
  });
});

// ── AT-CI-RUNNER-002: Imports runner-interface.js ────────────────────────────

describe('CI runner proof: runner interface import', () => {
  const source = readFileSync(PROOF_SCRIPT, 'utf8');

  it('AT-CI-RUNNER-002b: imports from runner-interface.js', () => {
    assert.ok(
      source.includes('runner-interface.js'),
      'proof script must import from runner-interface.js',
    );
  });

  it('AT-CI-RUNNER-002c: imports core lifecycle operations', () => {
    assert.ok(source.includes('initRun'), 'must import initRun');
    assert.ok(source.includes('assignTurn'), 'must import assignTurn');
    assert.ok(source.includes('acceptTurn'), 'must import acceptTurn');
    assert.ok(source.includes('RUNNER_INTERFACE_VERSION'), 'must import RUNNER_INTERFACE_VERSION');
  });
});

// ── AT-CI-RUNNER-001 / AT-CI-RUNNER-003: Script executes and produces valid output ──

describe('CI runner proof: execution', () => {
  it('AT-CI-RUNNER-001: proof script exits 0 with --json', () => {
    const result = execFileSync('node', [PROOF_SCRIPT, '--json'], {
      encoding: 'utf8',
      timeout: 30_000,
    });
    const json = JSON.parse(result);
    assert.equal(json.result, 'pass', 'proof result should be pass');
    assert.equal(json.runner, 'ci-runner-proof');
    assert.ok(json.runner_interface_version, 'should report interface version');
  });

  it('AT-CI-RUNNER-003: artifacts match CLI-produced structure', () => {
    const result = execFileSync('node', [PROOF_SCRIPT, '--json'], {
      encoding: 'utf8',
      timeout: 30_000,
    });
    const json = JSON.parse(result);

    // State artifact
    assert.ok(json.artifacts.state, 'state artifact present');
    assert.equal(json.artifacts.state.valid, true, 'state is valid');
    assert.ok(json.artifacts.state.sha256, 'state has sha256');
    assert.match(json.artifacts.state.sha256, /^[0-9a-f]{64}$/, 'sha256 is a valid hex string');

    // History artifact
    assert.ok(json.artifacts.history, 'history artifact present');
    assert.equal(json.artifacts.history.valid, true, 'history is valid');
    assert.ok(json.artifacts.history.entry_count >= 1, 'history has at least 1 entry');

    // Decision ledger artifact
    assert.ok(json.artifacts.ledger, 'ledger artifact present');
    assert.equal(json.artifacts.ledger.valid, true, 'ledger is valid');
    assert.ok(json.artifacts.ledger.entry_count >= 1, 'ledger has at least 1 entry');
  });

  it('AT-CI-RUNNER-001b: proof script exits 0 in text mode', () => {
    const result = execFileSync('node', [PROOF_SCRIPT], {
      encoding: 'utf8',
      timeout: 30_000,
    });
    assert.ok(result.includes('PASS'), 'text output should include PASS');
    assert.ok(result.includes('runner-interface'), 'text output should mention runner-interface');
    assert.ok(!result.includes('FAIL'), 'text output should not include FAIL');
  });

  it('AT-CI-RUNNER-003b: run_id and turn_id are present and formatted', () => {
    const result = execFileSync('node', [PROOF_SCRIPT, '--json'], {
      encoding: 'utf8',
      timeout: 30_000,
    });
    const json = JSON.parse(result);
    assert.match(json.run_id, /^run_[0-9a-f]+$/, 'run_id matches expected format');
    assert.match(json.turn_id, /^turn_[0-9a-f]+$/, 'turn_id matches expected format');
    assert.equal(json.role, 'pm', 'role is pm');
  });
});

// ── AT-CI-RUNNER-004: Workflow exists ───────────────────────────────────────

describe('CI runner proof: workflow', () => {
  it('AT-CI-RUNNER-004: ci-runner-proof.yml exists', () => {
    assert.ok(existsSync(WORKFLOW_PATH), 'ci-runner-proof.yml must exist');
  });

  it('AT-CI-RUNNER-004b: workflow runs the proof script', () => {
    const workflow = readFileSync(WORKFLOW_PATH, 'utf8');
    assert.ok(
      workflow.includes('run-one-turn.mjs'),
      'workflow must reference the proof script',
    );
  });

  it('AT-CI-RUNNER-004c: workflow does not shell out to agentxchain CLI', () => {
    const workflow = readFileSync(WORKFLOW_PATH, 'utf8');
    assert.ok(
      !workflow.includes('agentxchain step') && !workflow.includes('agentxchain resume'),
      'workflow must not use CLI commands',
    );
  });

  it('AT-CI-RUNNER-004d: workflow runs on main push and PR', () => {
    const workflow = readFileSync(WORKFLOW_PATH, 'utf8');
    assert.ok(workflow.includes('push'), 'workflow triggers on push');
    assert.ok(workflow.includes('pull_request'), 'workflow triggers on pull_request');
    assert.ok(workflow.includes('main'), 'workflow targets main branch');
  });
});
