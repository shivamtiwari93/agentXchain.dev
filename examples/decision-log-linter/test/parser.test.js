import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractStatus, parseDecisionLog } from '../src/parser.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

describe('parseDecisionLog', () => {
  it('parses multiple decision blocks from markdown', () => {
    const source = readFileSync(join(__dirname, 'fixtures', 'good.md'), 'utf8');
    const decisions = parseDecisionLog(source);
    assert.equal(decisions.length, 2);
    assert.equal(decisions[0].id, 'DEC-001');
    assert.equal(decisions[1].id, 'DEC-002');
    assert.match(decisions[0].body, /### Decision/);
  });

  it('extracts decision status from a body block', () => {
    const source = readFileSync(join(__dirname, 'fixtures', 'good.md'), 'utf8');
    const [first] = parseDecisionLog(source);
    assert.equal(extractStatus(first.body), 'accepted');
  });
});
