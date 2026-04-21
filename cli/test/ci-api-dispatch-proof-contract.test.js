/**
 * CI API Dispatch Proof Contract Test
 *
 * Guards the API dispatch proof boundary:
 *   1. imports runLoop (not primitive lifecycle operations)
 *   2. imports dispatchApiProxy (real adapter, not synthetic)
 *   3. lets runLoop/acceptTurn own validation instead of proof-local coercion
 *   4. validates governed artifacts including real API cost
 *   5. is covered by the local prepublish gate
 *   6. uses Haiku for cost control
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { spawnSync } from 'child_process';

const CLI_ROOT = join(import.meta.dirname, '..');
const REPO_ROOT = join(CLI_ROOT, '..');
const PROOF_SCRIPT = join(REPO_ROOT, 'examples', 'ci-runner-proof', 'run-with-api-dispatch.mjs');
const PREPUBLISH_GATE_PATH = join(CLI_ROOT, 'scripts', 'prepublish-gate.sh');
const SPEC_PATH = join(REPO_ROOT, '.planning', 'CI_AUTOMATION_RUNNER_SPEC.md');
const source = readFileSync(PROOF_SCRIPT, 'utf8');

describe('CI API dispatch proof: composition boundary', () => {
  it('AT-CIAPI-PROOF-001: imports runLoop from run-loop.js', () => {
    assert.ok(source.includes('run-loop.js'), 'must import from run-loop.js');
    assert.ok(source.includes('runLoop'), 'must import runLoop');
  });

  it('AT-CIAPI-PROOF-002: imports dispatchApiProxy from api-proxy-adapter.js', () => {
    assert.ok(source.includes('api-proxy-adapter.js'), 'must import from api-proxy-adapter.js');
    assert.ok(source.includes('dispatchApiProxy'), 'must import dispatchApiProxy');
  });

  it('AT-CIAPI-PROOF-003: does not import primitive lifecycle operations directly', () => {
    // Should use runLoop, not raw assign/accept/reject
    const primitives = ['assignTurn', 'acceptTurn', 'rejectTurn', 'approvePhaseGate', 'approveCompletionGate'];
    const importLines = source.split('\n').filter(
      (l) => l.trim().startsWith('import') || l.trim().startsWith('const {'),
    );
    for (const prim of primitives) {
      const imported = importLines.some((l) => l.includes(prim));
      assert.ok(!imported, `must not import ${prim} — runLoop owns the state machine`);
    }
  });

  it('AT-CIAPI-PROOF-004: does not add proof-local turn-result coercion', () => {
    assert.equal(
      source.includes('normalizeTurnResult'),
      false,
      'proof script must return raw adapter output and let acceptTurn own validation',
    );
    assert.equal(
      source.includes('stabilizeCiProofTurnResult'),
      false,
      'proof script must not apply proof-local semantic stabilization',
    );
  });

  it('AT-CIAPI-PROOF-005: uses claude-haiku for cost control', () => {
    assert.ok(
      source.includes('claude-haiku-4-5-20251001'),
      'must use Haiku model for cost-controlled CI proof',
    );
  });

  it('AT-CIAPI-PROOF-006: validates real API cost (non-zero)', () => {
    assert.ok(
      source.includes('real_api_calls') || source.includes('cost.usd'),
      'must validate that API calls incurred real cost (distinguishes from synthetic proof)',
    );
  });

  it('AT-CIAPI-PROOF-007: sets budget guard', () => {
    assert.ok(
      source.includes('per_run_max_usd'),
      'must set a per-run budget to prevent CI cost runaway',
    );
  });

  it('AT-CIAPI-PROOF-008: uses ANTHROPIC_API_KEY for auth', () => {
    assert.ok(
      source.includes('ANTHROPIC_API_KEY'),
      'must reference ANTHROPIC_API_KEY for api_proxy auth',
    );
  });
});

describe('CI API dispatch proof: local gate wiring', () => {
  it('AT-CIAPI-PROOF-009: proof script exists', () => {
    assert.ok(existsSync(PROOF_SCRIPT), 'run-with-api-dispatch.mjs must exist');
  });

  it('AT-CIAPI-PROOF-010: prepublish gate runs npm test coverage', () => {
    const gate = readFileSync(PREPUBLISH_GATE_PATH, 'utf8');
    assert.ok(gate.includes('npm test'), 'prepublish gate must run npm test');
  });

  it('AT-CIAPI-PROOF-011: proof still declares ANTHROPIC_API_KEY auth boundary', () => {
    assert.ok(source.includes('ANTHROPIC_API_KEY'), 'proof must keep the API auth boundary explicit');
  });

  it('AT-CIAPI-PROOF-012: removed remote workflow stays absent', () => {
    const removedWorkflow = join(REPO_ROOT, '.github', 'workflows', 'ci-runner-proof.yml');
    assert.equal(existsSync(removedWorkflow), false, 'ci-runner-proof workflow must stay removed');
  });

  it('AT-CIAPI-PROOF-013: spec exists', () => {
    assert.ok(existsSync(SPEC_PATH), 'CI_AUTOMATION_RUNNER_SPEC.md must exist');
  });

  it('AT-CIAPI-PROOF-014: --json emits one parseable payload even after retries', () => {
    const result = spawnSync(process.execPath, [PROOF_SCRIPT, '--json'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, ANTHROPIC_API_KEY: '' },
      timeout: 60000,
    });

    assert.equal(result.status, 1, 'missing auth should fail the proof');
    // Human-escalation local notices legitimately emit to stderr; filter them out
    const nonEscalationStderr = result.stderr
      .split('\n')
      .filter(l => !l.startsWith('[agentxchain] ⚠ HUMAN ESCALATION') &&
                   !l.startsWith('  Type:') && !l.startsWith('  Action:') &&
                   !l.startsWith('  Unblock:'))
      .join('\n').trim();
    assert.equal(nonEscalationStderr, '', 'failure contract should not depend on stderr parsing');

    const payload = JSON.parse(result.stdout);
    assert.equal(payload.runner, 'ci-api-dispatch-proof');
    assert.equal(payload.result, 'fail');
    assert.equal(payload.attempts_used, 3);
    assert.equal(payload.attempt_history.length, 3);
  });
});
