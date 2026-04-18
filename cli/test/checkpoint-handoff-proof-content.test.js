import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');

function read(relativePath) {
  return readFileSync(join(ROOT, relativePath), 'utf8');
}

const SPEC = read('.planning/CHECKPOINT_HANDOFF_LIVE_PROOF_SPEC.md');
const SCRIPT = read('examples/live-governed-proof/run-checkpoint-handoff-proof.mjs');
const EVIDENCE_PATH = 'examples/live-governed-proof/evidence/checkpoint-handoff-proof.latest.json';
const EVIDENCE = JSON.parse(read(EVIDENCE_PATH));
const DOC = read('website-v2/docs/examples/checkpoint-handoff-proof.mdx');
const PARENT_DOC = read('website-v2/docs/examples/live-governed-proof.mdx');
const proofDate = EVIDENCE.recorded_at.slice(0, 10);

describe('checkpoint handoff proof evidence contract', () => {
  it('AT-CKPT-PROOF-001: spec names the proof surfaces', () => {
    assert.match(SPEC, /run-checkpoint-handoff-proof\.mjs/);
    assert.match(SPEC, /checkpoint-handoff-proof\.latest\.json/);
    assert.match(SPEC, /website-v2\/docs\/examples\/checkpoint-handoff-proof\.mdx/);
    assert.match(SPEC, /website-v2\/docs\/examples\/live-governed-proof\.mdx/);
    assert.match(SPEC, /checkpoint-handoff-proof-content\.test\.js/);
  });

  it('AT-CKPT-PROOF-002: harness supports checked-in evidence capture', () => {
    assert.match(SCRIPT, /--output/);
    assert.match(SCRIPT, /--keep-temp/);
    assert.match(SCRIPT, /writePayloadFile/);
  });

  it('AT-CKPT-PROOF-003: checked-in evidence artifact exists and records runner metadata', () => {
    assert.ok(existsSync(join(ROOT, EVIDENCE_PATH)), 'evidence artifact must exist');
    assert.equal(EVIDENCE.runner, 'checkpoint-handoff-live-proof');
    assert.equal(EVIDENCE.result, 'pass');
    assert.equal(EVIDENCE.cli_path, 'cli/bin/agentxchain.js');
    assert.equal(EVIDENCE.script_path, 'examples/live-governed-proof/run-checkpoint-handoff-proof.mjs');
    assert.ok(EVIDENCE.cli_version, 'cli_version must be present');
  });

  it('AT-CKPT-PROOF-004: evidence records a completed session with checkpoint commits and events', () => {
    assert.ok(EVIDENCE.proof, 'proof payload must be present');
    assert.match(EVIDENCE.proof.session_status, /^(completed|stopped)$/);
    assert.ok(EVIDENCE.proof.runs_completed >= 1, 'runs_completed must be at least 1');
    assert.ok(EVIDENCE.proof.checkpoint_commit_count >= 1, 'checkpoint commits must be present');
    assert.ok(EVIDENCE.proof.checkpoint_event_count >= 1, 'checkpoint events must be present');
    assert.ok(Array.isArray(EVIDENCE.proof.checkpoint_commits), 'checkpoint_commits must be an array');
    assert.ok(Array.isArray(EVIDENCE.proof.checkpoint_events), 'checkpoint_events must be an array');
  });

  it('AT-CKPT-PROOF-005: evidence records zero clean-baseline errors and sanitized temp paths', () => {
    assert.equal(EVIDENCE.proof.clean_baseline_errors, 0);
    assert.match(EVIDENCE.proof.workdir, /^<tmp>\/axc-ckpt-handoff-proof-/);
    assert.doesNotMatch(EVIDENCE.proof.workdir, /^\/Users\//);
    assert.doesNotMatch(EVIDENCE.proof.workdir, /^\/private\//);
  });

  it('AT-CKPT-PROOF-006: dedicated docs page matches the checked-in evidence artifact', () => {
    assert.match(DOC, /checkpoint-handoff-proof\.latest\.json/);
    assert.match(DOC, new RegExp(proofDate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(DOC, new RegExp(EVIDENCE.cli_version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(DOC, new RegExp(EVIDENCE.proof.session_id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(DOC, new RegExp(String(EVIDENCE.proof.checkpoint_commit_count).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(DOC, new RegExp(String(EVIDENCE.proof.checkpoint_event_count).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  });

  it('AT-CKPT-PROOF-007: dedicated docs page includes the --output invocation and parent link', () => {
    assert.match(DOC, /--output examples\/live-governed-proof\/evidence\/checkpoint-handoff-proof\.latest\.json/);
    assert.match(DOC, /\/docs\/examples\/live-governed-proof/);
  });

  it('AT-CKPT-PROOF-008: parent docs page links to the dedicated page and artifact', () => {
    assert.match(PARENT_DOC, /\/docs\/examples\/checkpoint-handoff-proof/);
    assert.match(PARENT_DOC, /checkpoint-handoff-proof\.latest\.json/);
  });
});
