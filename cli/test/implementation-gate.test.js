import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { evaluateWorkflowGateSemantics, IMPLEMENTATION_NOTES_PATH } from '../src/lib/workflow-gate-semantics.js';

describe('Implementation gate semantics', () => {
  let root;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'impl-gate-'));
    mkdirSync(join(root, '.planning'), { recursive: true });
  });

  it('AT-IMPL-GATE-001: scaffold placeholder IMPLEMENTATION_NOTES.md fails the gate', () => {
    writeFileSync(
      join(root, '.planning', 'IMPLEMENTATION_NOTES.md'),
      `# Implementation Notes\n\n## Changes\n\n(Dev fills this during implementation)\n\n## Verification\n\n(Dev fills this during implementation)\n`
    );

    const result = evaluateWorkflowGateSemantics(root, IMPLEMENTATION_NOTES_PATH);
    assert.ok(result);
    assert.equal(result.ok, false);
    assert.ok(result.reason.includes('placeholder'));
  });

  it('AT-IMPL-GATE-002: real Changes but placeholder Verification fails', () => {
    writeFileSync(
      join(root, '.planning', 'IMPLEMENTATION_NOTES.md'),
      `# Implementation Notes\n\n## Changes\n\nAdded user authentication module with JWT tokens.\n\n## Verification\n\n(Dev fills this during implementation)\n`
    );

    const result = evaluateWorkflowGateSemantics(root, IMPLEMENTATION_NOTES_PATH);
    assert.ok(result);
    assert.equal(result.ok, false);
    assert.ok(result.reason.includes('Verification'));
    assert.ok(result.reason.includes('placeholder'));
  });

  it('AT-IMPL-GATE-003: real Changes and real Verification satisfies the gate', () => {
    writeFileSync(
      join(root, '.planning', 'IMPLEMENTATION_NOTES.md'),
      `# Implementation Notes\n\n## Changes\n\nAdded user authentication module with JWT tokens.\nUpdated middleware chain to validate tokens on protected routes.\n\n## Verification\n\nRun \`npm test\` to execute the auth test suite.\nManually test: POST /login with valid credentials returns 200 + token.\n`
    );

    const result = evaluateWorkflowGateSemantics(root, IMPLEMENTATION_NOTES_PATH);
    assert.ok(result);
    assert.equal(result.ok, true);
  });

  it('AT-IMPL-GATE-004: missing IMPLEMENTATION_NOTES.md returns null (file-not-found)', () => {
    const result = evaluateWorkflowGateSemantics(root, IMPLEMENTATION_NOTES_PATH);
    assert.equal(result, null);
  });

  it('missing ## Changes section fails', () => {
    writeFileSync(
      join(root, '.planning', 'IMPLEMENTATION_NOTES.md'),
      `# Implementation Notes\n\n## Verification\n\nRun tests.\n`
    );

    const result = evaluateWorkflowGateSemantics(root, IMPLEMENTATION_NOTES_PATH);
    assert.ok(result);
    assert.equal(result.ok, false);
    assert.ok(result.reason.includes('## Changes'));
  });

  it('missing ## Verification section fails', () => {
    writeFileSync(
      join(root, '.planning', 'IMPLEMENTATION_NOTES.md'),
      `# Implementation Notes\n\n## Changes\n\nBuilt the thing.\n`
    );

    const result = evaluateWorkflowGateSemantics(root, IMPLEMENTATION_NOTES_PATH);
    assert.ok(result);
    assert.equal(result.ok, false);
    assert.ok(result.reason.includes('## Verification'));
  });

  it('both sections missing fails with both named', () => {
    writeFileSync(
      join(root, '.planning', 'IMPLEMENTATION_NOTES.md'),
      `# Implementation Notes\n\nSome random text.\n`
    );

    const result = evaluateWorkflowGateSemantics(root, IMPLEMENTATION_NOTES_PATH);
    assert.ok(result);
    assert.equal(result.ok, false);
    assert.ok(result.reason.includes('## Changes'));
    assert.ok(result.reason.includes('## Verification'));
  });

  it('empty sections (no content lines) fail', () => {
    writeFileSync(
      join(root, '.planning', 'IMPLEMENTATION_NOTES.md'),
      `# Implementation Notes\n\n## Changes\n\n## Verification\n\n## Unresolved Follow-ups\n`
    );

    const result = evaluateWorkflowGateSemantics(root, IMPLEMENTATION_NOTES_PATH);
    assert.ok(result);
    assert.equal(result.ok, false);
    assert.ok(result.reason.includes('placeholder'));
  });

  it('Unresolved Follow-ups section is not gated', () => {
    writeFileSync(
      join(root, '.planning', 'IMPLEMENTATION_NOTES.md'),
      `# Implementation Notes\n\n## Changes\n\nBuilt auth module.\n\n## Verification\n\nRun npm test.\n\n## Unresolved Follow-ups\n\n(Dev lists any known gaps, tech debt, or follow-up items here.)\n`
    );

    const result = evaluateWorkflowGateSemantics(root, IMPLEMENTATION_NOTES_PATH);
    assert.ok(result);
    assert.equal(result.ok, true);
  });

  it('spec guard: IMPLEMENTATION_EXIT_GATE_SPEC.md exists', () => {
    const specPath = join(process.cwd(), '..', '.planning', 'IMPLEMENTATION_EXIT_GATE_SPEC.md');
    const altPath = join(process.cwd(), '.planning', 'IMPLEMENTATION_EXIT_GATE_SPEC.md');
    // Try both potential paths (running from cli/ or from repo root)
    assert.ok(
      existsSync(specPath) || existsSync(altPath),
      'IMPLEMENTATION_EXIT_GATE_SPEC.md must exist in .planning/'
    );
  });
});
