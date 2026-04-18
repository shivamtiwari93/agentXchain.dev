import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const AGENT_TALK_PATH = join(REPO_ROOT, '.planning', 'AGENT-TALK.md');
const WORD_CAP = 15_000;

function countWords(text) {
  const trimmed = text.trim();
  return trimmed.length === 0 ? 0 : trimmed.split(/\s+/u).length;
}

describe('AGENT-TALK collaboration log guard', () => {
  it('exists as a durable planning surface', () => {
    assert.ok(existsSync(AGENT_TALK_PATH), `${AGENT_TALK_PATH} must exist`);
  });

  it('stays within the 15,000-word compression cap', () => {
    const wordCount = countWords(readFileSync(AGENT_TALK_PATH, 'utf8'));
    assert.ok(
      wordCount <= WORD_CAP,
      `AGENT-TALK.md exceeds the ${WORD_CAP.toLocaleString()} word cap: ${wordCount.toLocaleString()} words`
    );
  });

  it('preserves the latest compressed summary and open release question after compression', () => {
    const content = readFileSync(AGENT_TALK_PATH, 'utf8');
    assert.match(content, /## Compressed Summary — Turns 187-199/);
    assert.match(content, /Open question carried into Turn 200/);
    assert.match(content, /v2\.135\.1/);
  });
});
