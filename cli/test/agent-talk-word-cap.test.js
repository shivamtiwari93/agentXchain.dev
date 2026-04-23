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
const TURN_HEADING = /^## Turn (\d+) — ([^\n]+)$/gm;
const LIVE_TURN_ACTOR_AND_TIMESTAMP = /^(GPT 5\.4|Claude Opus 4\.7) — \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const LIVE_TURN_TIMESTAMP = / — (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z)$/;

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

function getTurnHeadings(content) {
  return [...content.matchAll(TURN_HEADING)].map((match) => ({
    turn: Number.parseInt(match[1], 10),
    heading: match[0],
    actor: match[2],
    index: match.index,
  }));
}

function getTurnTimestamp(turn) {
  const match = turn.actor.match(LIVE_TURN_TIMESTAMP);
  assert.ok(match, `Turn ${turn.turn} must include a UTC timestamp in its actor heading`);
  return Date.parse(match[1]);
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

  it('keeps the latest turn in the mandatory collaboration handoff format', () => {
    const content = readFileSync(AGENT_TALK_PATH, 'utf8');
    const turns = getTurnHeadings(content);

    assert.ok(turns.length > 0, 'AGENT-TALK.md must retain at least one uncompressed turn heading');

    const latest = turns.at(-1);
    const nextTurn = turns.at(-2);
    const latestBodyStart = latest.index + latest.heading.length;
    const latestBody = content.slice(latestBodyStart).trim();
    const delimiter = content.slice(Math.max(0, latest.index - 4), latest.index);

    assert.equal(
      delimiter,
      '---\n',
      `latest AGENT-TALK turn must start after the required "---" delimiter; got ${JSON.stringify(delimiter)}`,
    );
    assert.ok(
      LIVE_TURN_ACTOR_AND_TIMESTAMP.test(latest.actor),
      `latest AGENT-TALK turn actor must name a collaborating agent and UTC timestamp; got ${JSON.stringify(latest.actor)}`,
    );
    if (nextTurn) {
      assert.equal(
        latest.turn,
        nextTurn.turn + 1,
        `latest uncompressed AGENT-TALK turn number must increment by one from the previous uncompressed turn; got ${nextTurn.turn} -> ${latest.turn}`,
      );
    }
    assert.match(
      latestBody,
      /### Next Action For (Claude Opus 4\.7|GPT 5\.4)/,
      'latest AGENT-TALK turn must end with a concrete next-action handoff for the other agent',
    );
    assert.doesNotMatch(
      latestBody,
      /\n---$/,
      'latest AGENT-TALK turn must not leave a dangling delimiter after the next-action handoff',
    );
  });

  it('keeps all live turn headings in the mandatory agent timestamp format', () => {
    const content = readFileSync(AGENT_TALK_PATH, 'utf8');
    const turns = getTurnHeadings(content);

    assert.ok(turns.length > 0, 'AGENT-TALK.md must retain at least one uncompressed turn heading');
    for (const turn of turns) {
      assert.match(
        turn.actor,
        LIVE_TURN_ACTOR_AND_TIMESTAMP,
        `Turn ${turn.turn} heading must use "## Turn N — Agent — YYYY-MM-DDTHH:MM:SSZ"; got ${JSON.stringify(turn.heading)}`,
      );
    }
  });

  it('keeps the latest live turn timestamp monotonic with the previous live turn', () => {
    const content = readFileSync(AGENT_TALK_PATH, 'utf8');
    const turns = getTurnHeadings(content);

    if (turns.length < 2) {
      return;
    }

    const previous = turns.at(-2);
    const latest = turns.at(-1);
    const previousTimestamp = getTurnTimestamp(previous);
    const latestTimestamp = getTurnTimestamp(latest);

    assert.ok(
      latestTimestamp >= previousTimestamp,
      `latest AGENT-TALK turn timestamp must be >= previous live turn timestamp; got Turn ${previous.turn} ${new Date(previousTimestamp).toISOString()} -> Turn ${latest.turn} ${new Date(latestTimestamp).toISOString()}`,
    );
  });
});
