import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import {
  escapeRegExp,
  formatCount,
  extractTopReleaseSection,
  extractAggregateEvidenceLine,
} from '../src/lib/release-alignment.js';

// ── escapeRegExp ────────────────────────────────────────────────────────

describe('escapeRegExp', () => {
  it('AT-QDP-037: escapes regex special characters', () => {
    assert.equal(escapeRegExp('v1.0.0'), 'v1\\.0\\.0');
    assert.equal(escapeRegExp('foo[bar]'), 'foo\\[bar\\]');
    assert.equal(escapeRegExp('a+b*c?'), 'a\\+b\\*c\\?');
    assert.equal(escapeRegExp('(test)'), '\\(test\\)');
    assert.equal(escapeRegExp('$100'), '\\$100');
    assert.equal(escapeRegExp('a|b'), 'a\\|b');
  });

  it('AT-QDP-038: returns plain strings unchanged', () => {
    assert.equal(escapeRegExp('hello'), 'hello');
    assert.equal(escapeRegExp('simple-text'), 'simple-text');
  });

  it('AT-QDP-039: escaped result is safe for RegExp constructor', () => {
    const special = 'v1.0.0 (beta)';
    const escaped = escapeRegExp(special);
    const re = new RegExp(escaped);
    assert.ok(re.test(special));
    assert.ok(!re.test('v1X0X0 Xbeta)'));
  });
});

// ── formatCount ─────────────────────────────────────────────────────────

describe('formatCount', () => {
  it('AT-QDP-040: formats numbers with locale-appropriate grouping', () => {
    assert.equal(formatCount(197), '197');
    assert.equal(formatCount(1000), '1,000');
    assert.equal(formatCount(10000), '10,000');
    assert.equal(formatCount(1234567), '1,234,567');
  });

  it('AT-QDP-041: formats zero', () => {
    assert.equal(formatCount(0), '0');
  });
});

// ── extractTopReleaseSection ────────────────────────────────────────────

describe('extractTopReleaseSection', () => {
  const changelog = [
    '# Changelog',
    '',
    '## 2.0.0',
    '',
    '- Added scope overlap guard',
    '- 172 tests / 0 failures',
    '',
    '## 1.9.0',
    '',
    '- Previous release content',
  ].join('\n');

  it('AT-QDP-042: extracts the section for the matching version', () => {
    const section = extractTopReleaseSection(changelog, '2.0.0');
    assert.ok(section);
    assert.ok(section.includes('scope overlap guard'));
    assert.ok(section.includes('172 tests'));
    assert.ok(!section.includes('Previous release'));
  });

  it('AT-QDP-043: returns null when version heading is not found', () => {
    const section = extractTopReleaseSection(changelog, '3.0.0');
    assert.equal(section, null);
  });

  it('AT-QDP-044: returns rest of file when version is the last heading', () => {
    const section = extractTopReleaseSection(changelog, '1.9.0');
    assert.ok(section);
    assert.ok(section.includes('Previous release'));
  });

  it('AT-QDP-045: handles changelog with single version', () => {
    const single = '# Changelog\n\n## 1.0.0\n\n- Initial release\n- 50 tests / 0 failures\n';
    const section = extractTopReleaseSection(single, '1.0.0');
    assert.ok(section);
    assert.ok(section.includes('Initial release'));
  });
});

// ── extractAggregateEvidenceLine ────────────────────────────────────────

describe('extractAggregateEvidenceLine', () => {
  it('AT-QDP-046: extracts evidence line with test count and 0 failures', () => {
    const text = '- some change\n- 197 tests / 0 failures across 8 suites\n- other note';
    const line = extractAggregateEvidenceLine(text);
    assert.ok(line);
    assert.ok(line.includes('197 tests'));
    assert.ok(line.includes('0 failures'));
  });

  it('AT-QDP-047: returns null when no evidence line matches', () => {
    const text = '- some change\n- refactored internals\n- no test data here';
    const line = extractAggregateEvidenceLine(text);
    assert.equal(line, null);
  });

  it('AT-QDP-048: picks the line with the highest test count when multiple match', () => {
    const text = [
      '- 50 tests / 0 failures in unit suite',
      '- 197 tests / 0 failures across all suites',
      '- 100 tests / 0 failures in integration suite',
    ].join('\n');
    const line = extractAggregateEvidenceLine(text);
    assert.ok(line);
    assert.ok(line.includes('197 tests'));
  });

  it('AT-QDP-049: handles comma-formatted test counts', () => {
    const text = '- 1,234 tests / 0 failures across all suites';
    const line = extractAggregateEvidenceLine(text);
    assert.ok(line);
    assert.ok(line.includes('1,234 tests'));
  });

  it('AT-QDP-050: strips markdown bold and backtick formatting', () => {
    const text = '- **197 tests** / `0 failures` across 8 suites';
    const line = extractAggregateEvidenceLine(text);
    assert.ok(line);
    // Bold and backticks should be stripped from the returned line
    assert.ok(!line.includes('**'));
    assert.ok(!line.includes('`'));
  });
});
