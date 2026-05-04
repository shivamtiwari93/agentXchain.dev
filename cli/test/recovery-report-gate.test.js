import { describe, it, beforeEach } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  evaluateRecoveryReport,
  scaffoldRecoveryReport,
  getSemanticIdForPath,
  RECOVERY_REPORT_PATH,
  PM_SIGNOFF_PATH,
  SYSTEM_SPEC_PATH,
  IMPLEMENTATION_NOTES_PATH,
  ACCEPTANCE_MATRIX_PATH,
  SHIP_VERDICT_PATH,
  RELEASE_NOTES_PATH,
} from '../src/lib/workflow-gate-semantics.js';

// ── evaluateRecoveryReport ──────────────────────────────────────────────

describe('evaluateRecoveryReport', () => {
  let root;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'axc-recovery-'));
  });

  it('AT-QDP-001: returns null when recovery report file does not exist', () => {
    const result = evaluateRecoveryReport(root);
    assert.equal(result, null);
  });

  it('AT-QDP-002: passes when all three required sections have real content', () => {
    const dir = join(root, '.agentxchain', 'multirepo');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'RECOVERY_REPORT.md'),
      [
        '# Recovery Report',
        '',
        '## Trigger',
        '',
        'Coordinator hit a blocked state due to scope overlap.',
        '',
        '## Impact',
        '',
        'Run was paused for 2 hours.',
        '',
        '## Mitigation',
        '',
        'Operator reviewed scope and used --force-scope to resume.',
      ].join('\n'),
    );

    const result = evaluateRecoveryReport(root);
    assert.ok(result);
    assert.equal(result.ok, true);
  });

  it('AT-QDP-003: fails when Trigger section is missing entirely', () => {
    const dir = join(root, '.agentxchain', 'multirepo');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'RECOVERY_REPORT.md'),
      [
        '# Recovery Report',
        '',
        '## Impact',
        '',
        'Run was paused.',
        '',
        '## Mitigation',
        '',
        'Operator resumed.',
      ].join('\n'),
    );

    const result = evaluateRecoveryReport(root);
    assert.ok(result);
    assert.equal(result.ok, false);
    assert.ok(result.reason.includes('## Trigger'));
  });

  it('AT-QDP-004: fails when Impact and Mitigation sections are missing', () => {
    const dir = join(root, '.agentxchain', 'multirepo');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'RECOVERY_REPORT.md'),
      [
        '# Recovery Report',
        '',
        '## Trigger',
        '',
        'Something broke.',
      ].join('\n'),
    );

    const result = evaluateRecoveryReport(root);
    assert.ok(result);
    assert.equal(result.ok, false);
    assert.ok(result.reason.includes('## Impact'));
    assert.ok(result.reason.includes('## Mitigation'));
  });

  it('AT-QDP-005: fails when sections exist but contain only placeholder text', () => {
    const dir = join(root, '.agentxchain', 'multirepo');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'RECOVERY_REPORT.md'),
      [
        '# Recovery Report',
        '',
        '## Trigger',
        '',
        '(Operator fills this before running multi resume)',
        '',
        '## Impact',
        '',
        '(Operator fills this before running multi resume)',
        '',
        '## Mitigation',
        '',
        '(Operator fills this before running multi resume)',
      ].join('\n'),
    );

    const result = evaluateRecoveryReport(root);
    assert.ok(result);
    assert.equal(result.ok, false);
    assert.ok(result.reason.includes('placeholder'));
  });

  it('AT-QDP-006: fails when one section has real content but others have placeholders', () => {
    const dir = join(root, '.agentxchain', 'multirepo');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'RECOVERY_REPORT.md'),
      [
        '# Recovery Report',
        '',
        '## Trigger',
        '',
        'Actual trigger description here.',
        '',
        '## Impact',
        '',
        '(Operator fills this before running multi resume)',
        '',
        '## Mitigation',
        '',
        'Fixed by restarting the run.',
      ].join('\n'),
    );

    const result = evaluateRecoveryReport(root);
    assert.ok(result);
    assert.equal(result.ok, false);
    assert.ok(result.reason.includes('## Impact'));
    // Trigger and Mitigation should NOT appear in reason since they have content
    assert.ok(!result.reason.includes('## Trigger'));
    assert.ok(!result.reason.includes('## Mitigation'));
  });
});

// ── scaffoldRecoveryReport ──────────────────────────────────────────────

describe('scaffoldRecoveryReport', () => {
  let root;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'axc-scaffold-'));
  });

  it('AT-QDP-007: creates scaffold file with blocked reason when file does not exist', () => {
    const dir = join(root, '.agentxchain', 'multirepo');
    mkdirSync(dir, { recursive: true });

    const created = scaffoldRecoveryReport(root, 'scope overlap detected');
    assert.equal(created, true);

    const absPath = join(root, RECOVERY_REPORT_PATH);
    assert.ok(existsSync(absPath));

    const content = require('node:fs').readFileSync(absPath, 'utf8');
    assert.ok(content.includes('scope overlap detected'));
    assert.ok(content.includes('## Trigger'));
    assert.ok(content.includes('## Impact'));
    assert.ok(content.includes('## Mitigation'));
  });

  it('AT-QDP-008: returns false and does not overwrite when file already exists', () => {
    const dir = join(root, '.agentxchain', 'multirepo');
    mkdirSync(dir, { recursive: true });
    const absPath = join(root, RECOVERY_REPORT_PATH);
    writeFileSync(absPath, 'existing content');

    const created = scaffoldRecoveryReport(root, 'new reason');
    assert.equal(created, false);

    const content = require('node:fs').readFileSync(absPath, 'utf8');
    assert.equal(content, 'existing content');
  });

  it('AT-QDP-009: handles non-string blocked reason by JSON-stringifying it', () => {
    const dir = join(root, '.agentxchain', 'multirepo');
    mkdirSync(dir, { recursive: true });

    scaffoldRecoveryReport(root, { code: 'SCOPE_OVERLAP', detail: 'M10 vs M12' });

    const absPath = join(root, RECOVERY_REPORT_PATH);
    const content = require('node:fs').readFileSync(absPath, 'utf8');
    assert.ok(content.includes('SCOPE_OVERLAP'));
    assert.ok(content.includes('M10 vs M12'));
  });
});

// ── getSemanticIdForPath ────────────────────────────────────────────────

describe('getSemanticIdForPath', () => {
  it('AT-QDP-010: returns correct semantic ID for each known planning path', () => {
    assert.equal(getSemanticIdForPath(PM_SIGNOFF_PATH), 'pm_signoff');
    assert.equal(getSemanticIdForPath(SYSTEM_SPEC_PATH), 'system_spec');
    assert.equal(getSemanticIdForPath(IMPLEMENTATION_NOTES_PATH), 'implementation_notes');
    assert.equal(getSemanticIdForPath(ACCEPTANCE_MATRIX_PATH), 'acceptance_matrix');
    assert.equal(getSemanticIdForPath(SHIP_VERDICT_PATH), 'ship_verdict');
    assert.equal(getSemanticIdForPath(RELEASE_NOTES_PATH), 'release_notes');
  });

  it('AT-QDP-011: returns null for unknown paths', () => {
    assert.equal(getSemanticIdForPath('.planning/ARCHITECTURE.md'), null);
    assert.equal(getSemanticIdForPath('random/file.txt'), null);
    assert.equal(getSemanticIdForPath(''), null);
  });

  it('AT-QDP-012: returns null for recovery report path (not in path-semantic map)', () => {
    assert.equal(getSemanticIdForPath(RECOVERY_REPORT_PATH), null);
  });
});
