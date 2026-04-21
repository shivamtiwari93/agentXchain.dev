import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Diagnostic-only guard for `.github/workflows/publish-npm-on-tag.yml`:
// Turn 129 added a runner-local `npm pack` SHA capture before publish and a
// registry `dist.shasum` comparison after publish. This guard locks the
// diagnostic contract so a future edit cannot:
//   1. silently delete the diagnostic (removing evidence collection before a
//      gate is ever designed), or
//   2. accidentally promote it into a gate by dropping the `exit 0` at the end
//      of the post-publish comparison step (a mismatch must stay informational
//      until multiple releases worth of data justify a real gate — per the
//      Turn 128 handoff and `DEC-HOMEBREW-LOCAL-PACK-SHA-NOT-CANONICAL-001`).
//
// The guard is positive on the two step names and positional on their ordering
// relative to `publish-from-tag.sh` and `release-postflight.sh`.

const ROOT = resolve(import.meta.dirname, '..', '..');
const WORKFLOW_PATH = '.github/workflows/publish-npm-on-tag.yml';
const read = (rel) => readFileSync(resolve(ROOT, rel), 'utf8');

describe('publish workflow pack-SHA diagnostic (Turn 129)', () => {
  it('captures runner-local pack SHA before publish', () => {
    const workflow = read(WORKFLOW_PATH);
    assert.match(
      workflow,
      /- name: Record runner-local pack SHA \(diagnostic\)/,
      'publish workflow must capture a runner-local pack SHA before publish as diagnostic evidence',
    );
    assert.match(
      workflow,
      /npm pack --json --pack-destination/,
      'diagnostic step must use npm pack --json to produce the same bytes publish would upload',
    );
    assert.match(
      workflow,
      /runner_sha1=/,
      'diagnostic step must surface the runner sha1 so the later comparison step can read it',
    );
  });

  it('compares runner-local pack SHA to registry after publish', () => {
    const workflow = read(WORKFLOW_PATH);
    assert.match(
      workflow,
      /- name: Compare runner-local pack SHA to registry \(diagnostic\)/,
      'publish workflow must include the registry comparison diagnostic step',
    );
    assert.match(
      workflow,
      /npm view "agentxchain@\$\{VERSION\}" dist --json/,
      'comparison step must read registry dist metadata (shasum + integrity) from npm view',
    );
    assert.match(
      workflow,
      /PACK_SHA_DIAGNOSTIC:/,
      'comparison step must emit a grep-friendly PACK_SHA_DIAGNOSTIC tag for log scraping',
    );
  });

  it('diagnostic stays diagnostic — comparison exits 0 regardless of mismatch', () => {
    const workflow = read(WORKFLOW_PATH);
    const compareIdx = workflow.indexOf(
      'Compare runner-local pack SHA to registry (diagnostic)',
    );
    assert.ok(compareIdx > -1, 'comparison step must exist');
    // Isolate the Compare step body: from the step's `- name:` line up to the
    // next `- name:` (the next workflow step) — using the `- name:`-anchored
    // split and taking [0] gives us exactly the Compare step's own contents.
    const compareSlice = workflow.slice(compareIdx);
    const stepBody = compareSlice.split(/\n      - name:/)[0] ?? '';
    // The step must end on an explicit `exit 0` so a MISMATCH branch cannot
    // short-circuit the workflow. If someone later wants this to gate, they
    // must rename the step (drop "(diagnostic)") AND remove the comment block
    // above the step — both of which would fail the content guards here and
    // force an explicit code review for the gating change.
    assert.match(
      stepBody,
      /\n\s+exit 0\s*\n?\s*$/,
      'comparison step must end with `exit 0` so a MISMATCH verdict is informational, not a gate',
    );
    // Nothing inside the step body may call `exit 1`. Forbid any `exit 1`.
    assert.doesNotMatch(
      stepBody,
      /\bexit 1\b/,
      'comparison step must NEVER exit 1 — it is diagnostic evidence collection only, not a release gate',
    );
  });

  it('diagnostic capture runs AFTER the --publish-gate step and BEFORE publish-from-tag.sh', () => {
    const workflow = read(WORKFLOW_PATH);
    const gateIdx = workflow.indexOf(
      'Re-verify tagged release before publish',
    );
    const captureIdx = workflow.indexOf(
      'Record runner-local pack SHA (diagnostic)',
    );
    const publishIdx = workflow.indexOf(
      'bash scripts/publish-from-tag.sh --skip-preflight',
    );
    assert.ok(gateIdx > -1, 'publish-gate step must still exist');
    assert.ok(captureIdx > -1, 'capture step must exist');
    assert.ok(publishIdx > -1, 'publish-from-tag.sh step must still exist');
    assert.ok(
      gateIdx < captureIdx && captureIdx < publishIdx,
      'ordering must be: --publish-gate -> record pack SHA -> publish-from-tag.sh. Capturing pack bytes after the gate but before publish ensures the diagnostic reflects the exact source state that was gated, not a later drift.',
    );
  });

  it('diagnostic comparison runs AFTER release-postflight.sh', () => {
    const workflow = read(WORKFLOW_PATH);
    const postflightIdx = workflow.indexOf('release-postflight.sh');
    const compareIdx = workflow.indexOf(
      'Compare runner-local pack SHA to registry (diagnostic)',
    );
    assert.ok(postflightIdx > -1, 'release-postflight.sh step must still exist');
    assert.ok(compareIdx > -1, 'comparison step must exist');
    assert.ok(
      postflightIdx < compareIdx,
      'registry comparison must run AFTER release-postflight.sh so the registry has fully propagated the new version by the time we query dist.shasum.',
    );
  });
});
