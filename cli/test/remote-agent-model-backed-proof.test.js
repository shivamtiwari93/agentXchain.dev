/**
 * Guard: model-backed remote agent bridge proof files exist and have
 * the expected contract shape.
 *
 * These tests do NOT call the Anthropic API. They verify that the proof
 * surface ships with the correct structure and documentation.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');
const EXAMPLE_DIR = resolve(ROOT, 'examples', 'remote-agent-bridge');
const PLANNING_DIR = resolve(ROOT, '.planning');

describe('remote-agent model-backed proof', () => {
  it('ships model-backed-server.js and run-model-proof.mjs', () => {
    for (const file of ['model-backed-server.js', 'run-model-proof.mjs']) {
      assert.ok(existsSync(resolve(EXAMPLE_DIR, file)), `${file} must exist`);
    }
  });

  it('model-backed-server.js calls the Anthropic Messages API', () => {
    const server = readFileSync(resolve(EXAMPLE_DIR, 'model-backed-server.js'), 'utf8');
    assert.match(server, /api\.anthropic\.com\/v1\/messages/);
    assert.match(server, /x-api-key/);
    assert.match(server, /anthropic-version/);
    assert.match(server, /ANTHROPIC_API_KEY/);
  });

  it('model-backed-server.js uses Claude Haiku for cost efficiency', () => {
    const server = readFileSync(resolve(EXAMPLE_DIR, 'model-backed-server.js'), 'utf8');
    assert.match(server, /claude-haiku-4-5/);
  });

  it('model-backed-server.js documents no-fixup policy', () => {
    const server = readFileSync(resolve(EXAMPLE_DIR, 'model-backed-server.js'), 'utf8');
    // Should explicitly document the no-fixup policy
    assert.match(server, /NO fixups|no fixups|as-is/i);
    // Should not contain a transformResult or repairOutput function
    assert.doesNotMatch(server, /function\s+(?:transform|repair|correct)(?:Result|Output)/);
  });

  it('model-backed-server.js system prompt teaches the turn-result contract', () => {
    const server = readFileSync(resolve(EXAMPLE_DIR, 'model-backed-server.js'), 'utf8');
    assert.match(server, /schema_version.*1\.0/);
    assert.match(server, /DEC-NNN/);
    assert.match(server, /OBJ-NNN/);
    assert.match(server, /proposed_changes/);
    assert.match(server, /at least one objection/i);
  });

  it('run-model-proof.mjs checks for ANTHROPIC_API_KEY', () => {
    const proof = readFileSync(resolve(EXAMPLE_DIR, 'run-model-proof.mjs'), 'utf8');
    assert.match(proof, /ANTHROPIC_API_KEY/);
  });

  it('run-model-proof.mjs exercises the full proposed + review lifecycle', () => {
    const proof = readFileSync(resolve(EXAMPLE_DIR, 'run-model-proof.mjs'), 'utf8');
    assert.match(proof, /step.*--role.*dev/);
    assert.match(proof, /proposal.*apply/);
    assert.match(proof, /step.*--role.*qa/);
    assert.match(proof, /PROPOSAL\.md/);
    assert.match(proof, /APPLIED\.json/);
    assert.match(proof, /review/);
  });

  it('run-model-proof.mjs writes an honest proof report', () => {
    const proof = readFileSync(resolve(EXAMPLE_DIR, 'run-model-proof.mjs'), 'utf8');
    assert.match(proof, /MODEL_PROOF_REPORT\.md/);
    assert.match(proof, /writeProofReport/);
    // Must report both success and failure honestly
    assert.match(proof, /PASSED|FAILED/);
  });

  it('run-model-proof.mjs detects validation failures even when exit code is 0', () => {
    const proof = readFileSync(resolve(EXAMPLE_DIR, 'run-model-proof.mjs'), 'utf8');
    assert.match(proof, /Validation failed/);
  });

  it('spec exists at .planning/REMOTE_AGENT_MODEL_BACKED_PROOF_SPEC.md', () => {
    assert.ok(existsSync(resolve(PLANNING_DIR, 'REMOTE_AGENT_MODEL_BACKED_PROOF_SPEC.md')));
    const spec = readFileSync(resolve(PLANNING_DIR, 'REMOTE_AGENT_MODEL_BACKED_PROOF_SPEC.md'), 'utf8');
    assert.match(spec, /model-backed/i);
    assert.match(spec, /claude-haiku/);
    assert.match(spec, /proposed_changes/);
    assert.match(spec, /acceptance.*test/i);
  });

  it('launch evidence includes E2e+ model-backed remote agent proof', () => {
    const evidence = readFileSync(resolve(PLANNING_DIR, 'LAUNCH_EVIDENCE_REPORT.md'), 'utf8');
    assert.match(evidence, /E2e\+.*Remote Agent Model-Backed/);
    assert.match(evidence, /claude-haiku-4-5/);
    assert.match(evidence, /model-backed-server\.js/);
    assert.match(evidence, /run-model-proof\.mjs/);
  });
});
