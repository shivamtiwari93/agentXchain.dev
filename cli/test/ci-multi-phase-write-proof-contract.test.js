/**
 * CI Multi-Phase Write Proof Contract Test
 *
 * Guards the multi-phase write-owning proof boundary:
 *   1. uses runLoop + dispatchApiProxy (same composition as Tier 4)
 *   2. config has 3 phases: planning → implementation → qa
 *   3. at least one role has proposed write_authority
 *   4. implementation_gate uses requires_files
 *   5. proposed changes are applied to workspace during dispatch
 *   6. no proof-local semantic coercion
 *   7. uses Haiku for cost control with budget guard
 *   8. covered by the local prepublish gate
 *   9. single JSON payload on retry exhaustion
 *  10. reports gate-pass evidence through phase_gate_status
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { spawnSync } from 'child_process';

const CLI_ROOT = join(import.meta.dirname, '..');
const REPO_ROOT = join(CLI_ROOT, '..');
const PROOF_SCRIPT = join(REPO_ROOT, 'examples', 'ci-runner-proof', 'run-multi-phase-write.mjs');
const PREPUBLISH_GATE_PATH = join(CLI_ROOT, 'scripts', 'prepublish-gate.sh');
const SPEC_PATH = join(REPO_ROOT, '.planning', 'CI_MULTI_PHASE_AUTHORITATIVE_PROOF_SPEC.md');
const source = readFileSync(PROOF_SCRIPT, 'utf8');

describe('CI multi-phase write proof: composition boundary', () => {
  it('AT-CIMPA-C01: imports runLoop from run-loop.js', () => {
    assert.ok(source.includes('run-loop.js'), 'must import from run-loop.js');
    assert.ok(source.includes('runLoop'), 'must import runLoop');
  });

  it('AT-CIMPA-C02: imports dispatchApiProxy from api-proxy-adapter.js', () => {
    assert.ok(source.includes('api-proxy-adapter.js'), 'must import from api-proxy-adapter.js');
    assert.ok(source.includes('dispatchApiProxy'), 'must import dispatchApiProxy');
  });

  it('AT-CIMPA-C03: config defines 3 phases (planning, implementation, qa)', () => {
    assert.ok(source.includes("planning:"), 'must define planning phase');
    assert.ok(source.includes("implementation:"), 'must define implementation phase');
    assert.ok(source.includes("qa:"), 'must define qa phase');
    // Verify routing has all three
    assert.ok(source.includes("'planning'"), 'routing must include planning');
    assert.ok(source.includes("'implementation'"), 'routing must include implementation');
    assert.ok(source.includes("'qa'"), 'routing must include qa');
  });

  it('AT-CIMPA-C04: at least one role has proposed write_authority', () => {
    assert.ok(
      source.includes("write_authority: 'proposed'"),
      'at least one role must use proposed write authority',
    );
  });

  it('AT-CIMPA-C05: implementation gate uses requires_files', () => {
    assert.ok(
      source.includes('requires_files') && source.includes('src/server.js'),
      'implementation_gate must require src/server.js',
    );
  });

  it('AT-CIMPA-C06: applies proposed changes to workspace during dispatch', () => {
    assert.ok(
      source.includes('proposed_changes') && source.includes('writeFileSync'),
      'dispatch callback must write proposed changes to workspace',
    );
  });

  it('AT-CIMPA-C07: does not add proof-local turn-result coercion', () => {
    assert.equal(
      source.includes('normalizeTurnResult'),
      false,
      'must not import normalizeTurnResult',
    );
    assert.equal(
      source.includes('stabilizeCiProofTurnResult'),
      false,
      'must not apply proof-local semantic stabilization',
    );
    assert.equal(
      source.includes('normalizeCiTurnResult'),
      false,
      'must not use legacy proof-local normalizer',
    );
  });

  it('AT-CIMPA-C08: uses claude-haiku for cost control', () => {
    assert.ok(
      source.includes('claude-haiku-4-5-20251001'),
      'must use Haiku model for cost-controlled CI proof',
    );
  });

  it('AT-CIMPA-C09: sets budget guard', () => {
    assert.ok(source.includes('per_run_max_usd'), 'must set per-run budget guard');
    assert.ok(source.includes('per_turn_max_usd'), 'must set per-turn budget guard');
  });

  it('AT-CIMPA-C10: validates 3-phase completion', () => {
    assert.ok(
      source.includes("'planning'") && source.includes("'implementation'") && source.includes("'qa'"),
      'must validate all three phases appear in history',
    );
  });

  it('AT-CIMPA-C11: validates write-owning turn exists', () => {
    assert.ok(
      source.includes('has_write_owning') || source.includes('proposed_turns'),
      'must validate that a proposed/write-owning turn exists in history',
    );
  });

  it('AT-CIMPA-C12: validates gate artifact exists and is non-trivial', () => {
    assert.ok(
      source.includes('gate_artifact') && source.includes('non_trivial'),
      'must validate gate artifact existence and content',
    );
  });

  it('AT-CIMPA-C13: validates real API cost across phases', () => {
    assert.ok(
      source.includes('real_api_calls') && source.includes('3'),
      'must validate at least 3 turns with real API cost',
    );
  });

  it('AT-CIMPA-C14: reports auto-advanced gate truth through phase_gate_status', () => {
    assert.ok(
      source.includes('phase_gate_status'),
      'proof payload must report phase_gate_status for auto-advanced gates',
    );
    assert.ok(
      source.includes('implementation_gate') && source.includes('qa_gate'),
      'proof must validate expected gate ids, not only count paused approvals',
    );
  });
});

describe('CI multi-phase write proof: workflow wiring', () => {
  it('AT-CIMPA-C15: proof script exists', () => {
    assert.ok(existsSync(PROOF_SCRIPT), 'run-multi-phase-write.mjs must exist');
  });

  it('AT-CIMPA-C16: spec exists', () => {
    assert.ok(existsSync(SPEC_PATH), 'CI_MULTI_PHASE_AUTHORITATIVE_PROOF_SPEC.md must exist');
  });

  it('AT-CIMPA-C17: prepublish gate runs npm test coverage', () => {
    const gate = readFileSync(PREPUBLISH_GATE_PATH, 'utf8');
    assert.ok(gate.includes('npm test'), 'prepublish gate must run npm test');
  });

  it('AT-CIMPA-C18: --json emits one parseable payload even after retries', () => {
    const result = spawnSync(process.execPath, [PROOF_SCRIPT, '--json'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, ANTHROPIC_API_KEY: '' },
      timeout: 120000,
    });

    assert.equal(result.status, 1, 'missing auth should fail the proof');

    const payload = JSON.parse(result.stdout);
    assert.equal(payload.runner, 'ci-multi-phase-write-proof');
    assert.equal(payload.result, 'fail');
    assert.equal(payload.attempts_used, 3);
    assert.equal(payload.attempt_history.length, 3);
  });
});
