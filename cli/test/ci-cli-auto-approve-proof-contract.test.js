/**
 * CI CLI Auto-Approve Proof Contract Test
 *
 * Guards the real operator-surface proof boundary:
 *   1. shells out to the actual CLI binary
 *   2. uses `run --auto-approve --max-turns 6`
 *   3. does not import runLoop or proof-local turn-result normalization
 *   4. validates governance report artifacts and real API cost
 *   5. is covered by the local prepublish gate
 */

import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { spawnSync } from 'child_process';

const CLI_ROOT = join(import.meta.dirname, '..');
const REPO_ROOT = join(CLI_ROOT, '..');
const PROOF_SCRIPT = join(REPO_ROOT, 'examples', 'ci-runner-proof', 'run-via-cli-auto-approve.mjs');
const PREPUBLISH_GATE_PATH = join(CLI_ROOT, 'scripts', 'prepublish-gate.sh');
const SPEC_PATH = join(REPO_ROOT, '.planning', 'CI_CLI_AUTO_APPROVE_PROOF_SPEC.md');
const source = readFileSync(PROOF_SCRIPT, 'utf8');

describe('CI CLI auto-approve proof: operator boundary', () => {
  it('AT-CICLI-CONTRACT-001: shells out to the real agentxchain CLI binary', () => {
    assert.ok(source.includes("join(cliRoot, 'bin', 'agentxchain.js')"), 'must target cli/bin/agentxchain.js');
    assert.ok(source.includes('spawnSync'), 'must shell out via spawnSync');
  });

  it('AT-CICLI-CONTRACT-002: runs `agentxchain run --auto-approve --max-turns 6`', () => {
    assert.ok(source.includes("'run'"), 'must invoke the run command');
    assert.ok(source.includes("'--auto-approve'"), 'must use --auto-approve');
    assert.ok(source.includes("'--max-turns', '6'"), 'must pin the max-turns bound');
  });

  it('AT-CICLI-CONTRACT-003: does not import runLoop or local turn-result normalization', () => {
    assert.equal(source.includes('run-loop.js'), false, 'must not import runLoop directly');
    assert.equal(source.includes('normalizeTurnResult'), false, 'must not normalize turn results locally');
    assert.equal(source.includes('stabilizeCiProofTurnResult'), false, 'must not apply proof-local semantic coercion');
  });

  it('AT-CICLI-CONTRACT-004: validates generated governance report artifacts', () => {
    assert.ok(
      source.includes("'.agentxchain', 'reports'"),
      'must validate the reports directory',
    );
    assert.ok(source.includes('export_exists') && source.includes('report_exists'), 'must check export and report existence');
  });

  it('AT-CICLI-CONTRACT-005: validates real non-zero API cost', () => {
    assert.ok(source.includes('real_api_calls'), 'must count real API-backed turns');
    assert.ok(source.includes('cost?.usd'), 'must inspect per-turn USD cost');
  });

  it('AT-CICLI-CONTRACT-006: uses ANTHROPIC_API_KEY-backed api_proxy runtimes', () => {
    assert.ok(source.includes('ANTHROPIC_API_KEY'), 'must require ANTHROPIC_API_KEY');
    assert.ok(source.includes('claude-haiku-4-5-20251001'), 'must use the cost-controlled Haiku model');
  });
});

describe('CI CLI auto-approve proof: local gate wiring', () => {
  it('AT-CICLI-CONTRACT-007: proof script exists', () => {
    assert.ok(existsSync(PROOF_SCRIPT), 'run-via-cli-auto-approve.mjs must exist');
  });

  it('AT-CICLI-CONTRACT-008: prepublish gate runs npm test coverage', () => {
    const gate = readFileSync(PREPUBLISH_GATE_PATH, 'utf8');
    assert.ok(gate.includes('npm test'), 'prepublish gate must run npm test');
  });

  it('AT-CICLI-CONTRACT-009: proof keeps ANTHROPIC_API_KEY auth boundary explicit', () => {
    assert.ok(source.includes('ANTHROPIC_API_KEY'), 'proof must keep the API auth boundary explicit');
  });

  it('AT-CICLI-CONTRACT-010: spec exists', () => {
    assert.ok(existsSync(SPEC_PATH), 'CI_CLI_AUTO_APPROVE_PROOF_SPEC.md must exist');
  });

  it('AT-CICLI-CONTRACT-011: --json emits one parseable payload even after retries', () => {
    const result = spawnSync(process.execPath, [PROOF_SCRIPT, '--json'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...process.env, ANTHROPIC_API_KEY: '' },
      timeout: 60000,
    });

    assert.equal(result.status, 1, 'missing auth should fail the proof');
    assert.equal(result.stderr.trim(), '', 'failure contract should not depend on stderr parsing');

    const payload = JSON.parse(result.stdout);
    assert.equal(payload.runner, 'ci-cli-auto-approve-proof');
    assert.equal(payload.result, 'fail');
    assert.equal(payload.attempts_used, 3);
    assert.equal(payload.attempt_history.length, 3);
  });
});
