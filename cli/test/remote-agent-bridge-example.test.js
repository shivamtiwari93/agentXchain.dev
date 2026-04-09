/**
 * Guard: examples/remote-agent-bridge/ example ships with required files
 * and the server module has the expected contract shape.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');
const EXAMPLE_DIR = resolve(ROOT, 'examples', 'remote-agent-bridge');

describe('remote-agent-bridge example', () => {
  it('ships server.js, run-proof.mjs, README.md, and package.json', () => {
    for (const file of ['server.js', 'run-proof.mjs', 'README.md', 'package.json']) {
      assert.ok(existsSync(resolve(EXAMPLE_DIR, file)), `${file} must exist`);
    }
  });

  it('server.js handles /turn and /health endpoints', () => {
    const server = readFileSync(resolve(EXAMPLE_DIR, 'server.js'), 'utf8');
    assert.match(server, /\/turn/);
    assert.match(server, /\/health/);
    assert.match(server, /handleTurn/);
    assert.match(server, /handleHealth/);
  });

  it('server.js returns proposed_changes for non-qa roles', () => {
    const server = readFileSync(resolve(EXAMPLE_DIR, 'server.js'), 'utf8');
    assert.match(server, /proposed_changes/);
    assert.match(server, /buildProposedResult/);
    assert.match(server, /buildReviewResult/);
  });

  it('server.js supports Bearer auth via BRIDGE_TOKEN', () => {
    const server = readFileSync(resolve(EXAMPLE_DIR, 'server.js'), 'utf8');
    assert.match(server, /BRIDGE_TOKEN/);
    assert.match(server, /requireBearerToken/);
  });

  it('server.js review result includes at least one objection (challenge requirement)', () => {
    const server = readFileSync(resolve(EXAMPLE_DIR, 'server.js'), 'utf8');
    assert.match(server, /OBJ-001/);
    assert.match(server, /objections.*\[/);
  });

  it('run-proof.mjs exercises the full proposed + review lifecycle', () => {
    const proof = readFileSync(resolve(EXAMPLE_DIR, 'run-proof.mjs'), 'utf8');
    assert.match(proof, /step.*--role.*dev/);
    assert.match(proof, /proposal.*apply/);
    assert.match(proof, /step.*--role.*qa/);
    assert.match(proof, /PROPOSAL\.md/);
    assert.match(proof, /APPLIED\.json/);
    assert.match(proof, /review/);
  });

  it('README.md documents the request/response contract', () => {
    const readme = readFileSync(resolve(EXAMPLE_DIR, 'README.md'), 'utf8');
    assert.match(readme, /Request.*envelope/i);
    assert.match(readme, /turn_id/);
    assert.match(readme, /run_id/);
    assert.match(readme, /proposed_changes/);
    assert.match(readme, /remote_agent/);
  });

  it('decision IDs follow the DEC-NNN pattern required by the validator', () => {
    const server = readFileSync(resolve(EXAMPLE_DIR, 'server.js'), 'utf8');
    const proof = readFileSync(resolve(EXAMPLE_DIR, 'run-proof.mjs'), 'utf8');
    // Must not use dynamic decision IDs like DEC-BRIDGE-${Date.now()}
    assert.doesNotMatch(server, /DEC-BRIDGE-\$\{/);
    assert.doesNotMatch(proof, /DEC-PROOF-\$\{/);
    assert.doesNotMatch(proof, /DEC-REVIEW-\$\{/);
    // Must use valid pattern
    assert.match(server, /DEC-001/);
    assert.match(server, /DEC-002/);
  });

  it('README.md warns about validator traps and literal header values', () => {
    const readme = readFileSync(resolve(EXAMPLE_DIR, 'README.md'), 'utf8');
    assert.match(readme, /DEC-NNN/);
    assert.match(readme, /at least one objection/i);
    assert.match(readme, /does not interpolate.*headers|generate the final token value/i);
  });
});
