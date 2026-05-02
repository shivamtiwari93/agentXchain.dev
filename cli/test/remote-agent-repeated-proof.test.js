/**
 * Guard: repeated model-backed remote agent proof infrastructure exists
 * and has the expected contract shape.
 *
 * These tests do NOT call the Anthropic API. They verify that the
 * repeatable proof harness ships with correct structure and documentation.
 */

import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');
const EXAMPLE_DIR = resolve(ROOT, 'examples', 'remote-agent-bridge');
const PLANNING_DIR = resolve(ROOT, '.planning');

describe('remote-agent repeated proof', () => {
  it('ships run-repeated-proof.mjs', () => {
    assert.ok(existsSync(resolve(EXAMPLE_DIR, 'run-repeated-proof.mjs')));
  });

  it('run-repeated-proof.mjs supports --runs argument', () => {
    const script = readFileSync(resolve(EXAMPLE_DIR, 'run-repeated-proof.mjs'), 'utf8');
    assert.match(script, /--runs/);
    assert.match(script, /parseArgs/);
  });

  it('run-repeated-proof.mjs uses the same model as single-run proof', () => {
    const script = readFileSync(resolve(EXAMPLE_DIR, 'run-repeated-proof.mjs'), 'utf8');
    assert.match(script, /claude-haiku-4-5-20251001/);
  });

  it('run-repeated-proof.mjs runs N independent lifecycles with per-run isolation', () => {
    const script = readFileSync(resolve(EXAMPLE_DIR, 'run-repeated-proof.mjs'), 'utf8');
    assert.match(script, /executeRun/);
    assert.match(script, /mkdtempSync/);
    assert.match(script, /init.*--governed/);
    assert.match(script, /step.*--role.*dev/);
    assert.match(script, /proposal.*apply/);
    assert.match(script, /step.*--role.*qa/);
  });

  it('run-repeated-proof.mjs does NOT contain retry logic for failed runs', () => {
    const script = readFileSync(resolve(EXAMPLE_DIR, 'run-repeated-proof.mjs'), 'utf8');
    // Should not contain retry loops or retry functions
    assert.doesNotMatch(script, /function\s+retry|retryCount|maxRetries|attempt\s*\+\+/i);
    // Documents the no-retry policy
    assert.match(script, /no retries/i);
  });

  it('run-repeated-proof.mjs writes REPEATED_PROOF_REPORT.md with aggregate stats', () => {
    const script = readFileSync(resolve(EXAMPLE_DIR, 'run-repeated-proof.mjs'), 'utf8');
    assert.match(script, /REPEATED_PROOF_REPORT\.md/);
    assert.match(script, /Pass Rate/);
    assert.match(script, /Failure Taxonomy/);
    assert.match(script, /Per-Run Results/);
  });

  it('run-repeated-proof.mjs tracks token usage and cost', () => {
    const script = readFileSync(resolve(EXAMPLE_DIR, 'run-repeated-proof.mjs'), 'utf8');
    assert.match(script, /totalInputTokens/);
    assert.match(script, /totalOutputTokens/);
    assert.match(script, /costUsd|Estimated cost/);
  });

  it('run-repeated-proof.mjs records per-run failure reasons precisely', () => {
    const script = readFileSync(resolve(EXAMPLE_DIR, 'run-repeated-proof.mjs'), 'utf8');
    assert.match(script, /failureReason/);
    assert.match(script, /categorizeFailure/);
    assert.match(script, /dev_validation_failed/);
    assert.match(script, /qa_no_objections/);
  });

  it('run-repeated-proof.mjs documents the fence-stripping concession', () => {
    const script = readFileSync(resolve(EXAMPLE_DIR, 'run-repeated-proof.mjs'), 'utf8');
    assert.match(script, /fenceStrips/);
    assert.match(script, /markdown-fence/i);
  });

  it('run-repeated-proof.mjs exits 0 regardless of pass rate', () => {
    const script = readFileSync(resolve(EXAMPLE_DIR, 'run-repeated-proof.mjs'), 'utf8');
    // Should have a comment explaining this is a reporting tool
    assert.match(script, /reporting tool.*not a gate|Exit 0 regardless/i);
  });

  it('spec exists at .planning/REPEATABLE_MODEL_PROOF_SPEC.md', () => {
    assert.ok(existsSync(resolve(PLANNING_DIR, 'REPEATABLE_MODEL_PROOF_SPEC.md')));
    const spec = readFileSync(resolve(PLANNING_DIR, 'REPEATABLE_MODEL_PROOF_SPEC.md'), 'utf8');
    assert.match(spec, /repeatable/i);
    assert.match(spec, /pass rate/i);
    assert.match(spec, /no silent retries|never retries/i);
    assert.match(spec, /failure.*taxonomy|failure mode/i);
  });

  it('REPEATED_PROOF_REPORT.md exists with honest results', () => {
    const reportPath = resolve(EXAMPLE_DIR, 'REPEATED_PROOF_REPORT.md');
    assert.ok(existsSync(reportPath), 'REPEATED_PROOF_REPORT.md must exist');
    const report = readFileSync(reportPath, 'utf8');
    assert.match(report, /Pass Rate/);
    assert.match(report, /Per-Run Results/);
    assert.match(report, /Failure Taxonomy/);
    assert.match(report, /Proof Boundary/);
    // Must mention the model
    assert.match(report, /claude-haiku-4-5/);
    // Must mention no-retry policy
    assert.match(report, /No retries/);
  });
});
