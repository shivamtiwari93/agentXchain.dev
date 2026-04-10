/**
 * CI API Dispatch Proof Contract Test
 *
 * Guards the API dispatch proof boundary:
 *   1. imports runLoop (not primitive lifecycle operations)
 *   2. imports dispatchApiProxy (real adapter, not synthetic)
 *   3. reuses core turn-result normalization before proof-only stabilization
 *   4. validates governed artifacts including real API cost
 *   5. is wired into CI workflow
 *   6. uses Haiku for cost control
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

const CLI_ROOT = join(import.meta.dirname, '..');
const REPO_ROOT = join(CLI_ROOT, '..');
const PROOF_SCRIPT = join(REPO_ROOT, 'examples', 'ci-runner-proof', 'run-with-api-dispatch.mjs');
const WORKFLOW_PATH = join(REPO_ROOT, '.github', 'workflows', 'ci-runner-proof.yml');
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

  it('AT-CIAPI-PROOF-004: reuses core turn-result normalization', () => {
    assert.ok(
      source.includes('turn-result-validator.js') && source.includes('normalizeTurnResult'),
      'must reuse normalizeTurnResult from turn-result-validator.js before proof-only stabilization',
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

describe('CI API dispatch proof: workflow wiring', () => {
  it('AT-CIAPI-PROOF-009: proof script exists', () => {
    assert.ok(existsSync(PROOF_SCRIPT), 'run-with-api-dispatch.mjs must exist');
  });

  it('AT-CIAPI-PROOF-010: CI workflow references the proof script', () => {
    assert.ok(existsSync(WORKFLOW_PATH), 'ci-runner-proof.yml must exist');
    const workflow = readFileSync(WORKFLOW_PATH, 'utf8');
    assert.ok(
      workflow.includes('run-with-api-dispatch.mjs'),
      'CI workflow must reference the API dispatch proof script',
    );
  });

  it('AT-CIAPI-PROOF-011: CI workflow injects ANTHROPIC_API_KEY secret', () => {
    const workflow = readFileSync(WORKFLOW_PATH, 'utf8');
    assert.ok(
      workflow.includes('ANTHROPIC_API_KEY') && workflow.includes('secrets.ANTHROPIC_API_KEY'),
      'CI workflow must inject ANTHROPIC_API_KEY from secrets',
    );
  });

  it('AT-CIAPI-PROOF-012: CI workflow restricts to push on main', () => {
    const workflow = readFileSync(WORKFLOW_PATH, 'utf8');
    assert.ok(
      workflow.includes("github.event_name == 'push'") && workflow.includes("refs/heads/main"),
      'API dispatch job must only run on push to main (cost + secret safety)',
    );
  });

  it('AT-CIAPI-PROOF-013: spec exists', () => {
    assert.ok(existsSync(SPEC_PATH), 'CI_AUTOMATION_RUNNER_SPEC.md must exist');
  });
});
