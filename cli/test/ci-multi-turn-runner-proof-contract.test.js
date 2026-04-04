/**
 * CI Multi-Turn Runner Proof Contract Test
 *
 * Guards the first continuous runner proof:
 *   1. no CLI shell-out
 *   2. imports only through runner-interface.js for governed execution
 *   3. executes a 3-turn lifecycle to completion
 *   4. proves rejection retry, gate approvals, and dispatch cleanup
 *   5. is wired into CI
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { execFileSync } from 'child_process';

const CLI_ROOT = join(import.meta.dirname, '..');
const REPO_ROOT = join(CLI_ROOT, '..');
const PROOF_SCRIPT = join(REPO_ROOT, 'examples', 'ci-runner-proof', 'run-to-completion.mjs');
const WORKFLOW_PATH = join(REPO_ROOT, '.github', 'workflows', 'ci-runner-proof.yml');
const source = readFileSync(PROOF_SCRIPT, 'utf8');

describe('CI multi-turn runner proof: no CLI shell-out', () => {
  it('AT-CI-MULTI-002a: does not import child_process', () => {
    assert.ok(
      !source.includes("from 'child_process'") && !source.includes('require("child_process")') && !source.includes("require('child_process')"),
      'proof script must not import child_process',
    );
  });

  it('AT-CI-MULTI-002b: does not use exec/spawn helpers', () => {
    const forbidden = ['execSync', 'spawnSync', 'execFile', 'execFileSync'];
    for (const fn of forbidden) {
      assert.ok(!source.includes(fn), `proof script must not use ${fn}`);
    }
    assert.ok(!/\bexec\s*\(/.test(source), 'proof script must not call exec()');
    assert.ok(!/\bspawn\s*\(/.test(source), 'proof script must not call spawn()');
  });

  it('AT-CI-MULTI-002c: does not reference the agentxchain CLI', () => {
    assert.ok(!source.includes('agentxchain step'), 'proof script must not call agentxchain step');
    assert.ok(!source.includes('bin/agentxchain'), 'proof script must not reference the CLI binary');
    assert.ok(
      !/agentxchain\.js\b/.test(source.replace(/agentxchain\.json/g, '')),
      'proof script must not reference agentxchain.js binary',
    );
  });

  it('AT-CI-MULTI-002d: does not import internal governed helpers directly', () => {
    assert.ok(!source.includes('turn-paths.js'), 'proof script must not import turn-paths.js');
    assert.ok(!source.includes('governed-state.js'), 'proof script must not import governed-state.js');
  });
});

describe('CI multi-turn runner proof: runner interface boundary', () => {
  it('AT-CI-MULTI-002e: imports from runner-interface.js', () => {
    assert.ok(source.includes('runner-interface.js'), 'proof script must import runner-interface.js');
  });

  it('AT-CI-MULTI-004a: imports lifecycle and gate operations', () => {
    for (const symbol of ['initRun', 'loadState', 'assignTurn', 'writeDispatchBundle', 'getTurnStagingResultPath', 'acceptTurn', 'rejectTurn', 'approvePhaseGate', 'approveCompletionGate']) {
      assert.ok(source.includes(symbol), `proof script must import ${symbol}`);
    }
  });
});

describe('CI multi-turn runner proof: execution', () => {
  it('AT-CI-MULTI-001: exits 0 with --json', () => {
    const result = execFileSync('node', [PROOF_SCRIPT, '--json'], {
      encoding: 'utf8',
      timeout: 30_000,
    });
    const json = JSON.parse(result);
    assert.equal(json.result, 'pass');
    assert.equal(json.runner, 'ci-multi-turn-runner-proof');
    assert.equal(json.turns_executed, 3);
    assert.deepEqual(json.roles, ['pm', 'dev', 'qa']);
  });

  it('AT-CI-MULTI-003: reaches completed state with gate approvals', () => {
    const result = execFileSync('node', [PROOF_SCRIPT, '--json'], {
      encoding: 'utf8',
      timeout: 30_000,
    });
    const json = JSON.parse(result);

    assert.equal(json.phase_transition_approvals, 1);
    assert.equal(json.completion_approvals, 1);
    assert.equal(json.final_status, 'completed');
    assert.equal(json.final_phase, 'qa');
    assert.equal(json.artifacts.history.entry_count, 3);
    assert.deepEqual(json.artifacts.history.roles, ['pm', 'dev', 'qa']);
  });

  it('AT-CI-MULTI-005: proves one rejection retries on the same turn id', () => {
    const result = execFileSync('node', [PROOF_SCRIPT, '--json'], {
      encoding: 'utf8',
      timeout: 30_000,
    });
    const json = JSON.parse(result);

    assert.equal(json.rejections.length, 1);
    assert.equal(json.rejections[0].role, 'dev');
    assert.equal(json.rejections[0].first_attempt, 1);
    assert.equal(json.rejections[0].retry_attempt, 2);
    assert.equal(json.rejections[0].retry_status, 'retrying');
    assert.equal(json.rejections[0].same_turn_id_retained, true);
    assert.equal(json.rejections[0].post_reject_staging_removed, true);
    assert.equal(json.rejections[0].rejected_artifact_preserved, true);
  });

  it('AT-CI-MULTI-006: proves dispatch bundle existence before acceptance and cleanup after', () => {
    const result = execFileSync('node', [PROOF_SCRIPT, '--json'], {
      encoding: 'utf8',
      timeout: 30_000,
    });
    const json = JSON.parse(result);

    assert.equal(json.dispatch_bundles.length, 3);
    for (const bundle of json.dispatch_bundles) {
      assert.equal(bundle.pre_accept_bundle_exists, true, `bundle must exist before accept for ${bundle.role}`);
      assert.equal(bundle.post_accept_bundle_removed, true, `bundle must be removed after accept for ${bundle.role}`);
      assert.equal(bundle.post_accept_staging_removed, true, `staging must be removed after accept for ${bundle.role}`);
    }
  });

  it('AT-CI-MULTI-001b: exits 0 in text mode', () => {
    const result = execFileSync('node', [PROOF_SCRIPT], {
      encoding: 'utf8',
      timeout: 30_000,
    });
    assert.ok(result.includes('PASS'));
    assert.ok(result.includes('pm -> dev -> qa'));
    assert.ok(result.includes('1 rejection retried'));
    assert.ok(result.includes('completed governed lifecycle'));
  });
});

describe('CI multi-turn runner proof: workflow', () => {
  it('AT-CI-MULTI-007a: workflow exists', () => {
    assert.ok(existsSync(WORKFLOW_PATH), 'ci-runner-proof workflow must exist');
  });

  it('AT-CI-MULTI-007b: workflow runs the new proof script', () => {
    const workflow = readFileSync(WORKFLOW_PATH, 'utf8');
    assert.ok(workflow.includes('run-to-completion.mjs'), 'workflow must run the multi-turn proof');
    assert.ok(workflow.includes('run-one-turn.mjs'), 'workflow must retain the single-turn proof');
  });

  it('AT-CI-MULTI-007c: workflow still targets main push and pull_request', () => {
    const workflow = readFileSync(WORKFLOW_PATH, 'utf8');
    assert.ok(workflow.includes('push'), 'workflow triggers on push');
    assert.ok(workflow.includes('pull_request'), 'workflow triggers on pull_request');
    assert.ok(workflow.includes('main'), 'workflow targets main');
  });
});
