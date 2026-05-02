import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  parseDiagnosticLines,
  renderTable,
  summarize,
} from '../scripts/collect-pack-sha-diagnostic.mjs';

// Content + behavior guards for Turn 131's collect-pack-sha-diagnostic.mjs.
//
// Purpose: turn the Turn 129 per-run PACK_SHA_DIAGNOSTIC log lines into a
// multi-release evidence view directly informing the
// DEC-PUBLISH-WORKFLOW-PACK-SHA-DIAGNOSTIC-ONLY-001 "≥3 MATCH" threshold.
//
// Coverage is the parse/render/summarize pure functions plus a couple of
// content assertions on the script itself. We intentionally do NOT call
// `gh` in tests: running gh in CI is flaky and auth-dependent, and the
// collector exists to *surface* evidence, not to *produce* MATCH/MISMATCH.

const ROOT = resolve(import.meta.dirname, '..', '..');
const SCRIPT_PATH = resolve(ROOT, 'cli/scripts/collect-pack-sha-diagnostic.mjs');

describe('collect-pack-sha-diagnostic script shape', () => {
  it('exists at the documented path', () => {
    assert.ok(existsSync(SCRIPT_PATH), 'collect-pack-sha-diagnostic.mjs must exist');
  });

  it('is executable on disk', () => {
    // Not a hard CI requirement — package.json bin/scripts still work
    // without +x — but the script's shebang only matters when +x is set.
    const mode = statSync(SCRIPT_PATH).mode & 0o111;
    assert.ok(mode !== 0, 'script must have at least one execute bit set');
  });

  it('declares diagnostic-only intent in its header', () => {
    const text = readFileSync(SCRIPT_PATH, 'utf8');
    // The whole point of the script is to COLLECT evidence for the
    // still-unresolved reproducible-publish question. If anyone ever
    // reshapes it into a release gate, they must also rewrite the header
    // and therefore fail this guard.
    assert.match(
      text,
      /Diagnostic-only/,
      'header must name its diagnostic-only nature',
    );
    assert.match(
      text,
      /DEC-PUBLISH-WORKFLOW-PACK-SHA-DIAGNOSTIC-ONLY-001/,
      'header must cite the governing decision record',
    );
  });

  it('documents npm-run discoverability and threshold interpretation', () => {
    const scriptText = readFileSync(SCRIPT_PATH, 'utf8');
    const packageJson = JSON.parse(readFileSync(resolve(ROOT, 'cli/package.json'), 'utf8'));

    assert.equal(
      packageJson.scripts['collect:pack-sha-diagnostic'],
      'node scripts/collect-pack-sha-diagnostic.mjs',
      'package.json must expose the collector as a discoverable maintenance script',
    );
    assert.match(
      scriptText,
      /npm run collect:pack-sha-diagnostic/,
      'script header must show the npm-run entry point',
    );
    assert.match(
      scriptText,
      /Only non-rerun `MATCH` verdicts count toward the "≥3 MATCH" evidence\s+\*     threshold/,
      'script header must explain what the ≥3 MATCH threshold actually counts',
    );
    assert.match(
      scriptText,
      /That threshold only permits designing a future gate; it is not a gate\s+\*     by itself/,
      'script header must prevent the diagnostic threshold from being mistaken for a release gate',
    );
    assert.match(
      scriptText,
      /`missing` means the diagnostic tag was absent, usually because the run\s+\*     was an already-published rerun/,
      'script header must explain missing vs rerun semantics',
    );
  });
});

describe('parseDiagnosticLines', () => {
  it('extracts MATCH verdict and agentxchain version from a SHA MATCH line', () => {
    const log = [
      'Some earlier log noise',
      'PACK_SHA_DIAGNOSTIC: MATCH — runner-local pack sha1 equals registry dist.shasum for agentxchain@2.150.1.',
      'PACK_INTEGRITY_DIAGNOSTIC: MATCH — runner-local pack integrity equals registry dist.integrity.',
      'Trailing log line',
    ].join('\n');
    const parsed = parseDiagnosticLines(log);
    assert.equal(parsed.shaVerdict, 'MATCH');
    assert.equal(parsed.integrityVerdict, 'MATCH');
    assert.equal(parsed.version, '2.150.1');
  });

  it('extracts MISMATCH verdict and preserves the reason detail', () => {
    const log = [
      'PACK_SHA_DIAGNOSTIC: MISMATCH — runner-local pack sha1 (abc) differs from registry dist.shasum (xyz) for agentxchain@2.151.0. Informational only.',
    ].join('\n');
    const parsed = parseDiagnosticLines(log);
    assert.equal(parsed.shaVerdict, 'MISMATCH');
    assert.match(parsed.shaDetail, /abc/, 'MISMATCH detail must preserve the runner sha');
    assert.match(parsed.shaDetail, /xyz/, 'MISMATCH detail must preserve the registry sha');
    assert.equal(parsed.version, '2.151.0');
  });

  it('returns shaVerdict = "missing" when the diagnostic step did not run (rerun path)', () => {
    // The workflow skips both diagnostic steps on `already_published == 'true'`
    // reruns, so a rerun's log contains neither tag. The script must distinguish
    // this from MATCH/MISMATCH/unavailable so the evidence summary does not
    // double-count reruns toward the "≥3 MATCH" threshold.
    const log = 'Normal publish log without any diagnostic tags.';
    const parsed = parseDiagnosticLines(log);
    assert.equal(parsed.shaVerdict, 'missing');
    assert.equal(parsed.integrityVerdict, 'missing');
    assert.equal(parsed.version, null);
  });

  it('returns "unavailable" when the diagnostic ran but could not form a verdict', () => {
    const log = [
      'PACK_SHA_DIAGNOSTIC: registry dist.shasum unavailable; skipping comparison.',
    ].join('\n');
    const parsed = parseDiagnosticLines(log);
    assert.equal(parsed.shaVerdict, 'unavailable');
    assert.equal(parsed.integrityVerdict, 'missing');
  });
});

describe('summarize', () => {
  it('tallies MATCH / MISMATCH / unavailable / missing across rows', () => {
    const rows = [
      { shaVerdict: 'MATCH', integrityVerdict: 'MATCH' },
      { shaVerdict: 'MATCH', integrityVerdict: 'MATCH' },
      { shaVerdict: 'MISMATCH', integrityVerdict: 'MATCH' },
      { shaVerdict: 'unavailable', integrityVerdict: 'unavailable' },
      { shaVerdict: 'missing', integrityVerdict: 'missing' },
    ];
    const summary = summarize(rows);
    assert.equal(summary.totalRuns, 5);
    assert.equal(summary.sha.MATCH, 2);
    assert.equal(summary.sha.MISMATCH, 1);
    assert.equal(summary.sha.unavailable, 1);
    assert.equal(summary.sha.missing, 1);
    assert.equal(summary.integrity.MATCH, 3);
    assert.equal(summary.integrity.missing, 1);
  });
});

describe('renderTable', () => {
  it('produces a header-bearing aligned table', () => {
    const rows = [
      {
        version: '2.150.1',
        runId: 24700000000,
        shaVerdict: 'MATCH',
        integrityVerdict: 'MATCH',
        createdAt: '2026-04-21T00:00:00Z',
        url: 'https://example/actions/runs/24700000000',
      },
    ];
    const table = renderTable(rows);
    assert.match(table, /version/, 'table must have a header row');
    assert.match(table, /run_id/, 'table must include run_id column');
    assert.match(table, /MATCH/, 'table must include the verdict value');
    assert.match(table, /2\.150\.1/, 'table must include the version');
  });

  it('handles empty input without throwing', () => {
    const out = renderTable([]);
    assert.match(out, /No publish-npm-on-tag\.yml runs found/);
  });
});
