import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lintDecisionLog } from '../src/lint.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

describe('lintDecisionLog', () => {
  it('passes a valid decision log', () => {
    const source = readFileSync(join(__dirname, 'fixtures', 'good.md'), 'utf8');
    const result = lintDecisionLog(source);
    assert.equal(result.ok, true);
    assert.equal(result.decisions_checked, 2);
    assert.equal(result.errors.length, 0);
  });

  it('reports duplicate ids, invalid statuses, and missing rationale sections', () => {
    const source = readFileSync(join(__dirname, 'fixtures', 'bad.md'), 'utf8');
    const result = lintDecisionLog(source);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => error.code === 'duplicate_id'));
    assert.ok(result.errors.some((error) => error.code === 'invalid_status'));
    assert.ok(result.errors.some((error) => error.code === 'missing_rationale_section'));
  });

  it('fails when the file contains no decisions', () => {
    const result = lintDecisionLog('# Empty\n');
    assert.equal(result.ok, false);
    assert.equal(result.decisions_checked, 0);
    assert.equal(result.errors[0].code, 'no_decisions_found');
  });
});
