import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const AGENT_TALK_PATH = join(REPO_ROOT, '.planning', 'AGENT-TALK.md');
const WORD_CAP = 15_000;
const COMPRESSED_SUMMARY_HEADING = /^## (?:Compressed Summary — (.+)|((?:Turns?|Older summaries)[^\n]*\(compressed [^)]+\)[^\n]*))$/gm;

function countWords(text) {
  const trimmed = text.trim();
  return trimmed.length === 0 ? 0 : trimmed.split(/\s+/u).length;
}

function getCompressedSummarySections(content) {
  const headings = [...content.matchAll(COMPRESSED_SUMMARY_HEADING)];
  return headings.map((heading, index) => {
    const start = heading.index + heading[0].length;
    const nextHeading = headings[index + 1];
    const end = nextHeading ? nextHeading.index : content.length;
    return content.slice(start, end).trim();
  }).filter(Boolean);
}

function getCompressedSummaryHeadings(content) {
  return [...content.matchAll(COMPRESSED_SUMMARY_HEADING)].map((match) => match[1] || match[2]);
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

  it('preserves the latest compressed summary structure and open questions after compression', () => {
    const content = readFileSync(AGENT_TALK_PATH, 'utf8');
    const headings = getCompressedSummaryHeadings(content);
    const sections = getCompressedSummarySections(content);

    assert.ok(headings.length > 0, 'AGENT-TALK.md must retain at least one compressed summary heading');
    assert.equal(
      headings.length,
      sections.length,
      'Every compressed summary heading must retain a corresponding section body',
    );
    assert.match(
      headings.at(-1),
      /^(Turns \d+-\d+|Turns \d+-\d+ \(compressed .+\))$/,
      `latest compressed summary heading must preserve the turn range; got ${JSON.stringify(headings.at(-1))}`,
    );
    assert.match(
      sections.at(-1),
      /(### Open questions|Current open state)/i,
      'latest compressed summary must preserve an explicit open/current-state section',
    );
    assert.match(
      sections.at(-1),
      /(release|BUG-\d+)/i,
      'latest compressed summary open questions must preserve a concrete release or bug reference',
    );
  });

  it('preserves decision references in every compressed summary section', () => {
    const content = readFileSync(AGENT_TALK_PATH, 'utf8');
    const sections = getCompressedSummarySections(content);

    assert.ok(sections.length > 0, 'AGENT-TALK.md must contain compressed summary sections');

    const missingDecisionReferences = sections
      .map((section, index) => ({ index, section }))
      .filter(({ section }) =>
        !section.includes('DEC-')
        && !/durable decisions preserved/i.test(section)
        && !/decisions frozen/i.test(section)
        && !/preserv(?:e|es|ed|ing) decisions/i.test(section)
      );

    assert.deepEqual(
      missingDecisionReferences,
      [],
      `Every compressed summary section must preserve at least one DEC-* reference; missing in sections ${missingDecisionReferences.map(({ index }) => index + 1).join(', ')}`
    );
  });
});
