import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { evaluateWorkflowGateSemantics, RELEASE_NOTES_PATH } from '../src/lib/workflow-gate-semantics.js';

describe('Release notes gate semantics', () => {
  let root;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'release-gate-'));
    mkdirSync(join(root, '.planning'), { recursive: true });
  });

  it('AT-RELEASE-GATE-001: scaffold placeholder RELEASE_NOTES.md fails the gate', () => {
    writeFileSync(
      join(root, '.planning', 'RELEASE_NOTES.md'),
      `# Release Notes\n\n## User Impact\n\n(QA fills this during the QA phase)\n\n## Verification Summary\n\n(QA fills this during the QA phase)\n`
    );

    const result = evaluateWorkflowGateSemantics(root, RELEASE_NOTES_PATH);
    assert.ok(result);
    assert.equal(result.ok, false);
    assert.ok(result.reason.includes('placeholder'));
  });

  it('AT-RELEASE-GATE-002: real User Impact + placeholder Verification Summary fails', () => {
    writeFileSync(
      join(root, '.planning', 'RELEASE_NOTES.md'),
      `# Release Notes\n\n## User Impact\n\nUsers can now authenticate with OAuth2 providers.\n\n## Verification Summary\n\n(QA fills this during the QA phase)\n`
    );

    const result = evaluateWorkflowGateSemantics(root, RELEASE_NOTES_PATH);
    assert.ok(result);
    assert.equal(result.ok, false);
    assert.ok(result.reason.includes('Verification Summary'));
    assert.ok(result.reason.includes('placeholder'));
  });

  it('AT-RELEASE-GATE-003: both real sections pass the gate', () => {
    writeFileSync(
      join(root, '.planning', 'RELEASE_NOTES.md'),
      `# Release Notes\n\n## User Impact\n\nUsers can now authenticate with OAuth2 providers.\nNew /login endpoint supports Google and GitHub SSO.\n\n## Verification Summary\n\nAll 42 acceptance matrix requirements pass.\nE2E auth flow tested against staging.\n`
    );

    const result = evaluateWorkflowGateSemantics(root, RELEASE_NOTES_PATH);
    assert.ok(result);
    assert.equal(result.ok, true);
  });

  it('AT-RELEASE-GATE-004: missing ## User Impact section fails with section-missing reason', () => {
    writeFileSync(
      join(root, '.planning', 'RELEASE_NOTES.md'),
      `# Release Notes\n\n## Verification Summary\n\nAll tests pass.\n`
    );

    const result = evaluateWorkflowGateSemantics(root, RELEASE_NOTES_PATH);
    assert.ok(result);
    assert.equal(result.ok, false);
    assert.ok(result.reason.includes('## User Impact'));
  });

  it('AT-RELEASE-GATE-005: missing ## Verification Summary section fails with section-missing reason', () => {
    writeFileSync(
      join(root, '.planning', 'RELEASE_NOTES.md'),
      `# Release Notes\n\n## User Impact\n\nNew feature added.\n`
    );

    const result = evaluateWorkflowGateSemantics(root, RELEASE_NOTES_PATH);
    assert.ok(result);
    assert.equal(result.ok, false);
    assert.ok(result.reason.includes('## Verification Summary'));
  });

  it('AT-RELEASE-GATE-006: optional sections do not affect gate outcome', () => {
    writeFileSync(
      join(root, '.planning', 'RELEASE_NOTES.md'),
      `# Release Notes\n\n## User Impact\n\nNew OAuth2 login.\n\n## Verification Summary\n\nAll tests pass.\n\n## Upgrade Notes\n\n(QA fills this during the QA phase)\n\n## Known Issues\n\n(QA fills this during the QA phase)\n`
    );

    const result = evaluateWorkflowGateSemantics(root, RELEASE_NOTES_PATH);
    assert.ok(result);
    assert.equal(result.ok, true, 'Optional sections with placeholder text must not affect the gate');
  });

  it('AT-RELEASE-GATE-007: spec guard - RELEASE_ARTIFACT_GATE_SPEC.md exists', () => {
    const specPath = join(process.cwd(), '..', '.planning', 'RELEASE_ARTIFACT_GATE_SPEC.md');
    const altPath = join(process.cwd(), '.planning', 'RELEASE_ARTIFACT_GATE_SPEC.md');
    assert.ok(
      existsSync(specPath) || existsSync(altPath),
      'RELEASE_ARTIFACT_GATE_SPEC.md must exist in .planning/'
    );
  });

  it('missing RELEASE_NOTES.md returns null (file-not-found)', () => {
    const result = evaluateWorkflowGateSemantics(root, RELEASE_NOTES_PATH);
    assert.equal(result, null);
  });

  it('empty required sections (no content lines) fail', () => {
    writeFileSync(
      join(root, '.planning', 'RELEASE_NOTES.md'),
      `# Release Notes\n\n## User Impact\n\n## Verification Summary\n\n## Upgrade Notes\n`
    );

    const result = evaluateWorkflowGateSemantics(root, RELEASE_NOTES_PATH);
    assert.ok(result);
    assert.equal(result.ok, false);
    assert.ok(result.reason.includes('placeholder'));
  });

  it('both required sections missing fails with both named', () => {
    writeFileSync(
      join(root, '.planning', 'RELEASE_NOTES.md'),
      `# Release Notes\n\nSome random text.\n`
    );

    const result = evaluateWorkflowGateSemantics(root, RELEASE_NOTES_PATH);
    assert.ok(result);
    assert.equal(result.ok, false);
    assert.ok(result.reason.includes('## User Impact'));
    assert.ok(result.reason.includes('## Verification Summary'));
  });
});
