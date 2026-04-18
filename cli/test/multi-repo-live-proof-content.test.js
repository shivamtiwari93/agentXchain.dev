import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

function read(relativePath) {
  return readFileSync(join(ROOT, relativePath), 'utf8');
}

const SPEC = read('.planning/MULTI_REPO_LIVE_PROOF_SPEC.md');
const SCRIPT = read('examples/live-governed-proof/run-multi-repo-proof.mjs');
const EVIDENCE = JSON.parse(read('examples/live-governed-proof/evidence/multi-repo-proof.latest.json'));
const DOC = read('website-v2/docs/multi-repo.mdx');
const proofDate = EVIDENCE.recorded_at.slice(0, 10);
const totalCost = `$${EVIDENCE.artifacts.cost.total_usd.toFixed(4)}`;

describe('multi-repo live proof contract', () => {
  it('AT-MRLP-001: spec names the proof surfaces', () => {
    assert.match(SPEC, /run-multi-repo-proof\.mjs/);
    assert.match(SPEC, /multi-repo-proof\.latest\.json/);
    assert.match(SPEC, /website-v2\/docs\/multi-repo\.mdx/);
    assert.match(SPEC, /multi-repo-live-proof-content\.test\.js/);
  });

  it('AT-MRLP-002: live proof script exercises the real coordinator and child-repo commands', () => {
    for (const token of [
      "['multi', 'init', '--json']",
      "['multi', 'step', '--json']",
      "['step', '--resume', '--auto-reject']",
      "['multi', 'approve-gate']",
    ]) {
      assert.match(SCRIPT, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    }
  });

  it('AT-MRLP-003: live proof verifies downstream coordinator context from api', () => {
    assert.match(SCRIPT, /COORDINATOR_CONTEXT\.json/);
    assert.match(SCRIPT, /upstream_acceptances/);
    assert.match(SCRIPT, /includes\('api'\)/);
  });

  it('AT-MRLP-004: docs include a dated live proof section naming the script and command', () => {
    assert.match(DOC, /Live Coordinator Proof/i);
    assert.match(DOC, new RegExp(proofDate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(DOC, /run-multi-repo-proof\.mjs/);
    assert.match(DOC, /node examples\/live-governed-proof\/run-multi-repo-proof\.mjs --json/);
  });

  it('AT-MRLP-005: docs record the live proof evidence fields', () => {
    assert.equal(EVIDENCE.result, 'pass');
    assert.match(DOC, new RegExp(`agentxchain v${EVIDENCE.cli_version}`.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
    assert.match(DOC, new RegExp(EVIDENCE.artifacts.coordinator.super_run_id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(DOC, new RegExp(String(EVIDENCE.artifacts.coordinator.acceptance_projections).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(DOC, /COORDINATOR_CONTEXT\.json/);
    assert.match(DOC, new RegExp(totalCost.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  });

  it('AT-MRLP-006: docs explicitly preserve repo-local approvals inside the proof', () => {
    assert.match(DOC, /approve-transition/);
    assert.match(DOC, /approve-completion/);
    assert.match(DOC, /repo-local approvals remained required/i);
  });

  it('AT-MRLP-007: script supports checked-in evidence capture', () => {
    assert.match(SCRIPT, /--output <path>/);
    assert.match(SCRIPT, /--keep-temp/);
    assert.match(SCRIPT, /result: 'skip'/);
    assert.match(SCRIPT, /missing_env/);
  });

  it('AT-MRLP-008: docs name the checked-in evidence artifact', () => {
    assert.match(DOC, /examples\/live-governed-proof\/evidence\/multi-repo-proof\.latest\.json/);
  });

  it('AT-MRLP-009: checked-in evidence remains sanitized and repo-native', () => {
    assert.equal(EVIDENCE.cli_path, 'cli/bin/agentxchain.js');
    assert.equal(EVIDENCE.script_path, 'examples/live-governed-proof/run-multi-repo-proof.mjs');
    for (const trace of EVIDENCE.traces.filter((entry) => entry.bundle_path)) {
      assert.match(trace.bundle_path, /^repos\//);
      assert.doesNotMatch(trace.bundle_path, /^\/private\//);
    }
  });
});
