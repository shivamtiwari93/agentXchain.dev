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

const SCRIPT = read('examples/live-governed-proof/run-continuous-mixed-proof.mjs');
const EVIDENCE_PATH = 'examples/live-governed-proof/evidence/continuous-mixed-proof.latest.json';
const EVIDENCE = JSON.parse(read(EVIDENCE_PATH));
const PARENT_DOC = read('website-v2/docs/examples/live-governed-proof.mdx');
const LIGHTS_OUT_DOC = read('website-v2/docs/lights-out-operation.mdx');

describe('continuous mixed-runtime proof evidence contract', () => {
  it('AT-CMRP-001: checked-in evidence artifact exists and records runner metadata', () => {
    assert.ok(existsSync(join(ROOT, EVIDENCE_PATH)), 'evidence artifact must exist');
    assert.equal(EVIDENCE.runner, 'continuous-mixed-runtime-live-proof');
    assert.equal(EVIDENCE.result, 'pass');
    assert.equal(EVIDENCE.cli_path, 'cli/bin/agentxchain.js');
    assert.equal(EVIDENCE.script_path, 'examples/live-governed-proof/run-continuous-mixed-proof.mjs');
    assert.ok(EVIDENCE.cli_version, 'cli_version must be present');
  });

  it('AT-CMRP-002: evidence records a completed session with real api_proxy QA', () => {
    assert.ok(EVIDENCE.proof, 'proof payload must be present');
    assert.equal(EVIDENCE.proof.status, 'completed');
    assert.ok(EVIDENCE.proof.runs_completed >= 1, 'runs_completed must be at least 1');
    assert.ok(EVIDENCE.proof.session_id, 'session_id must be present');
    assert.equal(EVIDENCE.proof.qa_runtime_id, 'api-qa');
    assert.ok(EVIDENCE.proof.qa_turn_id, 'qa_turn_id must be present');
    assert.ok(EVIDENCE.proof.review_artifact, 'review_artifact must be present');
  });

  it('AT-CMRP-003: evidence records spend and continuous provenance', () => {
    assert.ok(EVIDENCE.proof.cumulative_spent_usd > 0, 'spend must be non-zero for live api proof');
    assert.ok(EVIDENCE.proof.continuous_provenance, 'continuous_provenance must be present');
    assert.equal(EVIDENCE.proof.continuous_provenance.created_by, 'continuous_loop');
    assert.ok(EVIDENCE.proof.continuous_provenance.intake_intent_id, 'intake_intent_id must be present');
  });

  it('AT-CMRP-004: evidence paths are sanitized (no absolute workstation paths)', () => {
    const raw = JSON.stringify(EVIDENCE);
    assert.doesNotMatch(raw, /\/Users\//);
    assert.doesNotMatch(raw, /\/private\//);
    assert.doesNotMatch(raw, /\/var\/folders\//);
  });

  it('AT-CMRP-005: harness supports --output, --keep-temp, and skip semantics', () => {
    assert.match(SCRIPT, /--output/);
    assert.match(SCRIPT, /--keep-temp/);
    assert.match(SCRIPT, /writePayloadFile/);
    assert.match(SCRIPT, /buildPayload/);
    assert.match(SCRIPT, /result: 'skip'/);
  });

  it('AT-CMRP-006: parent docs page references the evidence artifact and session ID', () => {
    assert.match(PARENT_DOC, /continuous-mixed-proof\.latest\.json/);
    assert.match(PARENT_DOC, new RegExp(EVIDENCE.proof.session_id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(PARENT_DOC, /--output examples\/live-governed-proof\/evidence\/continuous-mixed-proof\.latest\.json/);
  });

  it('AT-CMRP-007: lights-out operation docs reference the evidence artifact', () => {
    assert.match(LIGHTS_OUT_DOC, /continuous-mixed-proof\.latest\.json/);
    assert.match(LIGHTS_OUT_DOC, /--output examples\/live-governed-proof\/evidence\/continuous-mixed-proof\.latest\.json/);
  });
});
