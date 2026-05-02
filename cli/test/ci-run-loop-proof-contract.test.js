/**
 * CI Run-Loop Composition Proof Contract Test
 *
 * Guards the run-loop composition proof:
 *   1. imports runLoop, not primitive lifecycle operations
 *   2. no CLI shell-out or child_process
 *   3. executes a 3-turn lifecycle to completion via runLoop
 *   4. proves rejection/retry, gate approvals, and event emission
 *   5. is covered by the local prepublish gate
 */

import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { execFileSync } from 'child_process';

const CLI_ROOT = join(import.meta.dirname, '..');
const REPO_ROOT = join(CLI_ROOT, '..');
const PROOF_SCRIPT = join(REPO_ROOT, 'examples', 'ci-runner-proof', 'run-with-run-loop.mjs');
const PREPUBLISH_GATE_PATH = join(CLI_ROOT, 'scripts', 'prepublish-gate.sh');
const source = readFileSync(PROOF_SCRIPT, 'utf8');

describe('CI run-loop proof: composition boundary', () => {
  it('AT-RUNLOOP-PROOF-009: imports runLoop from run-loop.js', () => {
    assert.ok(source.includes('run-loop.js'), 'proof script must import from run-loop.js');
    assert.ok(source.includes('runLoop'), 'proof script must import runLoop');
  });

  it('AT-RUNLOOP-PROOF-008a: does not import initRun', () => {
    // Check that initRun is not destructured from any import
    // The script may reference RUNNER_INTERFACE_VERSION from runner-interface.js, but not initRun
    const lines = source.split('\n');
    const importBlocks = [];
    let inImport = false;
    let currentBlock = '';
    for (const line of lines) {
      if (line.includes('import') && line.includes('{')) inImport = true;
      if (inImport) currentBlock += line;
      if (inImport && line.includes('}')) {
        importBlocks.push(currentBlock);
        currentBlock = '';
        inImport = false;
      }
    }
    for (const block of importBlocks) {
      if (block.includes('runner-interface.js') || block.includes('run-loop.js')) {
        assert.ok(!block.includes('initRun'), 'proof script must not import initRun — runLoop handles initialization');
      }
    }
  });

  it('AT-RUNLOOP-PROOF-008b: does not import primitive lifecycle operations', () => {
    const primitives = [
      'assignTurn', 'acceptTurn', 'rejectTurn',
      'writeDispatchBundle', 'getTurnStagingResultPath',
      'approvePhaseGate', 'approveCompletionGate',
    ];
    const lines = source.split('\n');
    const importLines = lines.filter(l => l.trim().startsWith('import') || l.trim().startsWith('const {'));
    for (const prim of primitives) {
      for (const importLine of importLines) {
        assert.ok(
          !importLine.includes(prim),
          `proof script must not import ${prim} — runLoop composes these internally`,
        );
      }
    }
  });

  it('AT-RUNLOOP-PROOF-010a: does not import child_process', () => {
    assert.ok(
      !source.includes("from 'child_process'") &&
      !source.includes('require("child_process")') &&
      !source.includes("require('child_process')"),
      'proof script must not import child_process',
    );
  });

  it('AT-RUNLOOP-PROOF-010b: does not use exec/spawn helpers', () => {
    const forbidden = ['execSync', 'spawnSync', 'execFile', 'execFileSync'];
    for (const fn of forbidden) {
      assert.ok(!source.includes(fn), `proof script must not use ${fn}`);
    }
  });

  it('AT-RUNLOOP-PROOF-010c: does not reference the agentxchain CLI binary', () => {
    assert.ok(!source.includes('agentxchain step'), 'proof script must not call agentxchain step');
    assert.ok(!source.includes('bin/agentxchain'), 'proof script must not reference the CLI binary');
  });

  it('AT-RUNLOOP-PROOF-008c: does not import internal governed helpers directly', () => {
    assert.ok(!source.includes("'./governed-state.js'"), 'must not import governed-state.js');
    assert.ok(!source.includes("'./turn-paths.js'"), 'must not import turn-paths.js');
    assert.ok(!source.includes("'./config.js'"), 'must not import config.js');
    assert.ok(!source.includes("'./dispatch-bundle.js'"), 'must not import dispatch-bundle.js');
  });
});

describe('CI run-loop proof: execution', () => {
  it('AT-RUNLOOP-PROOF-001: exits 0 with --json and result === "pass"', () => {
    const result = execFileSync('node', [PROOF_SCRIPT, '--json'], {
      encoding: 'utf8',
      timeout: 30_000,
    });
    const json = JSON.parse(result);
    assert.equal(json.result, 'pass');
    assert.equal(json.runner, 'ci-run-loop-composition-proof');
  });

  it('AT-RUNLOOP-PROOF-002: stop_reason is completed and turns_executed is 3', () => {
    const result = execFileSync('node', [PROOF_SCRIPT, '--json'], {
      encoding: 'utf8',
      timeout: 30_000,
    });
    const json = JSON.parse(result);
    assert.equal(json.stop_reason, 'completed');
    assert.equal(json.turns_executed, 3);
  });

  it('AT-RUNLOOP-PROOF-003: roles are pm, dev, qa', () => {
    const result = execFileSync('node', [PROOF_SCRIPT, '--json'], {
      encoding: 'utf8',
      timeout: 30_000,
    });
    const json = JSON.parse(result);
    assert.deepEqual(json.roles, ['pm', 'dev', 'qa']);
  });

  it('AT-RUNLOOP-PROOF-004: gates_approved is 2', () => {
    const result = execFileSync('node', [PROOF_SCRIPT, '--json'], {
      encoding: 'utf8',
      timeout: 30_000,
    });
    const json = JSON.parse(result);
    assert.equal(json.gates_approved, 2);
  });

  it('AT-RUNLOOP-PROOF-005: rejection_count is 1', () => {
    const result = execFileSync('node', [PROOF_SCRIPT, '--json'], {
      encoding: 'utf8',
      timeout: 30_000,
    });
    const json = JSON.parse(result);
    assert.equal(json.rejection_count, 1);
  });

  it('AT-RUNLOOP-PROOF-006: turn_history contains one rejected dev entry', () => {
    const result = execFileSync('node', [PROOF_SCRIPT, '--json'], {
      encoding: 'utf8',
      timeout: 30_000,
    });
    const json = JSON.parse(result);
    const rejected = json.turn_history.filter(t => !t.accepted);
    assert.equal(rejected.length, 1);
    assert.equal(rejected[0].role, 'dev');

    // Same turn_id for rejected and accepted dev entries
    const devEntries = json.turn_history.filter(t => t.role === 'dev');
    assert.equal(devEntries.length, 2);
    assert.equal(devEntries[0].turn_id, devEntries[1].turn_id, 'rejection and retry must share turn_id');
  });

  it('AT-RUNLOOP-PROOF-007: event_types include all lifecycle events', () => {
    const result = execFileSync('node', [PROOF_SCRIPT, '--json'], {
      encoding: 'utf8',
      timeout: 30_000,
    });
    const json = JSON.parse(result);
    const expected = ['turn_assigned', 'turn_accepted', 'turn_rejected', 'gate_paused', 'gate_approved', 'completed'];
    for (const evt of expected) {
      assert.ok(json.event_types.includes(evt), `missing event type: ${evt}`);
    }
  });

  it('AT-RUNLOOP-PROOF-012: exits 0 in text mode with PASS', () => {
    const result = execFileSync('node', [PROOF_SCRIPT], {
      encoding: 'utf8',
      timeout: 30_000,
    });
    assert.ok(result.includes('PASS'), 'text output must include PASS');
    assert.ok(result.includes('pm -> dev -> qa'), 'text output must include role sequence');
    assert.ok(result.includes('runLoop drove governed lifecycle'), 'text output must describe library composition');
  });
});

describe('CI run-loop proof: local gate', () => {
  it('AT-RUNLOOP-PROOF-011a: prepublish gate exists', () => {
    assert.ok(existsSync(PREPUBLISH_GATE_PATH), 'prepublish gate must exist');
  });

  it('AT-RUNLOOP-PROOF-011b: prepublish gate runs npm test coverage', () => {
    const gate = readFileSync(PREPUBLISH_GATE_PATH, 'utf8');
    assert.ok(gate.includes('npm test'), 'prepublish gate must run npm test');
  });

  it('AT-RUNLOOP-PROOF-011c: ci-runner-proof remote workflow stays absent', () => {
    const removedWorkflow = join(REPO_ROOT, '.github', 'workflows', 'ci-runner-proof.yml');
    assert.equal(existsSync(removedWorkflow), false, 'ci-runner-proof workflow must stay removed');
  });
});
