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

const EVIDENCE_PATH = 'examples/live-governed-proof/evidence/continuous-3run-proof.latest.json';
const SCRIPT = read('examples/live-governed-proof/run-continuous-3run-proof.mjs');
const EVIDENCE = JSON.parse(read(EVIDENCE_PATH));
const DOC = read('website-v2/docs/examples/live-continuous-3run-proof.mdx');
const PARENT_DOC = read('website-v2/docs/examples/live-governed-proof.mdx');

describe('continuous 3-run proof evidence contract', () => {
  it('AT-C3RP-001: checked-in evidence artifact exists and is valid JSON', () => {
    assert.ok(existsSync(join(ROOT, EVIDENCE_PATH)), 'evidence artifact must exist');
    assert.equal(EVIDENCE.runner, 'continuous-3run-live-proof');
    assert.equal(EVIDENCE.result, 'pass');
  });

  it('AT-C3RP-002: evidence records cli_version, cli_path, and script_path', () => {
    assert.ok(EVIDENCE.cli_version, 'cli_version must be present');
    assert.equal(EVIDENCE.cli_path, 'cli/bin/agentxchain.js');
    assert.equal(EVIDENCE.script_path, 'examples/live-governed-proof/run-continuous-3run-proof.mjs');
  });

  it('AT-C3RP-003: evidence contains 3 run summaries with real-credential QA turns', () => {
    assert.ok(EVIDENCE.proof, 'proof payload must be present');
    assert.ok(Array.isArray(EVIDENCE.proof.run_summaries), 'run_summaries must be an array');
    assert.ok(EVIDENCE.proof.run_summaries.length >= 3, 'must have at least 3 run summaries');
    for (const run of EVIDENCE.proof.run_summaries) {
      assert.ok(run.run_id, 'run_id must be present');
      assert.equal(run.provenance_trigger, 'vision_scan');
      assert.equal(run.provenance_created_by, 'continuous_loop');
      assert.ok(run.real_credential_turn, 'real_credential_turn must be present');
      assert.equal(run.real_credential_turn.role, 'qa');
      assert.equal(run.real_credential_turn.provider, 'anthropic');
    }
  });

  it('AT-C3RP-004: evidence session completed with 3 runs', () => {
    const session = EVIDENCE.proof.continuous_session_after;
    assert.ok(session, 'continuous_session_after must be present');
    assert.equal(session.status, 'completed');
    assert.ok(session.runs_completed >= 3, 'must have at least 3 runs completed');
    assert.ok(session.session_id, 'session_id must be present');
  });

  it('AT-C3RP-005: evidence paths are sanitized (no absolute workstation paths)', () => {
    const workdir = EVIDENCE.proof.workdir;
    assert.doesNotMatch(workdir, /^\/Users\//, 'workdir must not contain absolute user path');
    assert.doesNotMatch(workdir, /^\/private\//, 'workdir must not contain /private/ path');
  });

  it('AT-C3RP-006: docs page names the checked-in evidence artifact', () => {
    assert.match(DOC, /continuous-3run-proof\.latest\.json/);
    assert.match(DOC, /examples\/live-governed-proof\/evidence\//);
  });

  it('AT-C3RP-007: docs page records session_id from the evidence artifact', () => {
    const sessionId = EVIDENCE.proof.continuous_session_after.session_id;
    assert.match(DOC, new RegExp(sessionId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  });

  it('AT-C3RP-008: docs page records spend from the evidence artifact', () => {
    const spend = EVIDENCE.proof.continuous_session_after.cumulative_spent_usd;
    assert.match(DOC, new RegExp(`\\$${spend}`));
  });

  it('AT-C3RP-009: docs page includes --output in the invocation command', () => {
    assert.match(DOC, /--output examples\/live-governed-proof\/evidence\/continuous-3run-proof\.latest\.json/);
  });

  it('AT-C3RP-010: harness supports --output, --keep-temp, and skip semantics', () => {
    assert.match(SCRIPT, /--output/);
    assert.match(SCRIPT, /--keep-temp/);
    assert.match(SCRIPT, /result:.*'skip'/);
    assert.match(SCRIPT, /missing_env/);
    assert.match(SCRIPT, /writePayloadFile/);
  });

  it('AT-C3RP-011: parent docs page references the evidence artifact', () => {
    assert.match(PARENT_DOC, /continuous-3run-proof\.latest\.json/);
  });

  it('AT-C3RP-012: evidence git log shows commits for all 3 runs', () => {
    const commits = EVIDENCE.proof.run_commit_entries;
    assert.ok(Array.isArray(commits), 'run_commit_entries must be an array');
    const runIds = EVIDENCE.proof.run_summaries.map((r) => r.run_id);
    for (const runId of runIds) {
      const runCommits = commits.filter((c) => c.run_id === runId);
      assert.ok(runCommits.length > 0, `must have commits for ${runId}`);
    }
  });
});
