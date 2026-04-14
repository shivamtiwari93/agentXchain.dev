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
const DOC = read('website-v2/docs/multi-repo.mdx');

describe('multi-repo live proof contract', () => {
  it('AT-MRLP-001: spec names the proof surfaces', () => {
    assert.match(SPEC, /run-multi-repo-proof\.mjs/);
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
    assert.match(DOC, /2026-04-13/);
    assert.match(DOC, /run-multi-repo-proof\.mjs/);
    assert.match(DOC, /node examples\/live-governed-proof\/run-multi-repo-proof\.mjs --json/);
  });

  it('AT-MRLP-005: docs record the live proof evidence fields', () => {
    for (const token of [
      'agentxchain v',
      'super_run_id',
      'accepted projections',
      'COORDINATOR_CONTEXT.json',
      'total API cost',
    ]) {
      assert.match(DOC, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
    }
  });

  it('AT-MRLP-006: docs explicitly preserve repo-local approvals inside the proof', () => {
    assert.match(DOC, /approve-transition/);
    assert.match(DOC, /approve-completion/);
    assert.match(DOC, /repo-local approvals remained required/i);
  });
});
