/**
 * HUMAN-ROADMAP open blocker guard.
 *
 * The current roadmap has two different open-blocker classes:
 *   - BUG-52/53/54/61/62 closure requires literal tester quote-back from the
 *     published package asks.
 *   - BUG-59 is shipped and checked, but its tester quote-back still gates
 *     BUG-60 implementation.
 *   - BUG-60 is not in that quote-back-only class; it is blocked behind
 *     BUG-52 + BUG-59 shipped-package quote-back and its own two-agent
 *     research/review gate before implementation.
 *
 * This guard prevents future status edits from collapsing those classes.
 */

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const HUMAN_ROADMAP_PATH = join(REPO_ROOT, '.planning', 'HUMAN-ROADMAP.md');
const TESTER_QUOTEBACK_ASKS = [
  {
    path: '.planning/TESTER_QUOTEBACK_ASK_V1.md',
    bugs: ['BUG-52'],
    evidence: ['seven fields', 'BUG_52_TESTER_QUOTEBACK_RUNBOOK.md'],
  },
  {
    path: '.planning/TESTER_QUOTEBACK_ASK_V2.md',
    bugs: ['BUG-59', 'BUG-54'],
    evidence: ['five evidence blocks', 'ten real adapter-path dispatches'],
  },
  {
    path: '.planning/TESTER_QUOTEBACK_ASK_V3.md',
    bugs: ['BUG-62'],
    evidence: ['three evidence blocks', 'reconcile-state --accept-operator-head'],
  },
  {
    path: '.planning/TESTER_QUOTEBACK_ASK_V4.md',
    bugs: ['BUG-61'],
    evidence: ['one or both of the evidence blocks', 'auto_retry_on_ghost'],
  },
  {
    path: '.planning/TESTER_QUOTEBACK_ASK_V5_BUG53.md',
    bugs: ['BUG-53'],
    evidence: ['evidence blocks below', 'session_continuation'],
  },
];

function readRoadmap() {
  return readFileSync(HUMAN_ROADMAP_PATH, 'utf8');
}

function extractRoadmapItem(roadmap, bugId) {
  const start = roadmap.search(new RegExp(`^- \\[ \\] \\*\\*${bugId}(?::|\\b)`, 'm'));
  assert.notEqual(start, -1, `${bugId} must remain an unchecked roadmap item`);
  const next = roadmap.indexOf('\n- [', start + 1);
  return roadmap.slice(start, next === -1 ? roadmap.length : next);
}

describe('HUMAN-ROADMAP open blocker status', () => {
  it('keeps BUG-52 third variant as the explicit current focus until quote-back lands', () => {
    const roadmap = readRoadmap();
    const currentFocusLine = roadmap
      .split('\n')
      .find((line) => line.startsWith('Current focus:'));

    assert.ok(currentFocusLine, 'roadmap must keep a current focus line');
    assert.match(
      currentFocusLine,
      /BUG-52 third variant/,
      'current focus must keep BUG-52 third variant as the named top priority',
    );
    assert.match(
      currentFocusLine,
      /`unblock`-based human-gate resolution/,
      'current focus must preserve the delegated unblock failure lane',
    );
    assert.match(
      currentFocusLine,
      /pending_phase_transition` is `null`/,
      'current focus must preserve the null pending_phase_transition reproducer',
    );
    assert.match(
      currentFocusLine,
      /MUST ship before BUG-60/,
      'current focus must preserve BUG-52 before BUG-60 sequencing',
    );
    assert.match(
      currentFocusLine,
      /implementation waits for BUG-52 to ship/,
      'current focus must keep BUG-60 implementation blocked behind BUG-52',
    );
  });

  it('keeps the current tester handoff line pointing at V1 through V5', () => {
    const roadmap = readRoadmap();
    const handoffLine = roadmap
      .split('\n')
      .find((line) => line.startsWith('Current tester handoff asks:'));

    assert.ok(handoffLine, 'roadmap must keep a current tester handoff line');
    for (const ask of [
      'TESTER_QUOTEBACK_ASK_V1.md',
      'TESTER_QUOTEBACK_ASK_V2.md',
      'TESTER_QUOTEBACK_ASK_V3.md',
      'TESTER_QUOTEBACK_ASK_V4.md',
      'TESTER_QUOTEBACK_ASK_V5_BUG53.md',
    ]) {
      assert.match(handoffLine, new RegExp(ask), `handoff line must list ${ask}`);
    }
    assert.match(
      handoffLine,
      /do not replace the literal tester quote-back requirement/,
      'handoff line must preserve the literal tester quote-back closure gate',
    );
  });

  it('keeps BUG-60 distinct from quote-back-only blockers', () => {
    const roadmap = readRoadmap();
    const bug60 = extractRoadmapItem(roadmap, 'BUG-60');

    assert.match(
      bug60,
      /BEFORE WRITING ANY CODE[\s\S]{0,500}research \+ code-review pass/,
      'BUG-60 must keep the pre-implementation research/review gate',
    );
    assert.match(
      bug60,
      /BUG-60-RESEARCH-CLAUDE/,
      'BUG-60 must name the Claude research-turn tag',
    );
    assert.match(
      bug60,
      /BUG-60-REVIEW-GPT/,
      'BUG-60 must name the GPT review-turn tag',
    );
    assert.match(
      roadmap,
      /BUG-52[\s\S]{0,900}(before BUG-60|BUG-60 inherits|blocks full-auto)/,
      'roadmap must keep the BUG-52 phase-gate lane ahead of BUG-60',
    );
    assert.match(
      bug60,
      /BUG-59[\s\S]{0,300}(tester-verified|tester quote-back|closed first)/,
      'BUG-60 must stay blocked behind BUG-59 tester verification',
    );
    assert.match(
      bug60,
      /BUG-59 closed first with tester-verified evidence/,
      'BUG-60 sequencing must still require BUG-59 tester verification first',
    );
    assert.match(
      bug60,
      /Do NOT skip the research turns/,
      'BUG-60 must preserve the no-shortcut research-turn warning',
    );
  });

  it('keeps BUG-59 shipped-but-still-gating-BUG-60 status explicit', () => {
    const roadmap = readRoadmap();
    const uncheckedBug59 = roadmap.search(/^- \[ \] \*\*BUG-59(?::|\b)/m);
    const checkedBug59 = roadmap.search(/^- \[x\] \*\*BUG-59(?::|\b)/m);

    assert.equal(
      uncheckedBug59,
      -1,
      'BUG-59 must not regress into an unchecked roadmap blocker; its remaining role is BUG-60 gating evidence',
    );
    assert.notEqual(checkedBug59, -1, 'BUG-59 must remain present as a checked shipped item');

    const next = roadmap.indexOf('\n- [', checkedBug59 + 1);
    const bug59 = roadmap.slice(checkedBug59, next === -1 ? roadmap.length : next);

    assert.match(
      bug59,
      /Shipped 2026-04-21 in `agentxchain@2\.151\.0`/,
      'BUG-59 checked item must preserve the shipped-package baseline',
    );
    assert.match(
      bug59,
      /Tester quote-back is still required before BUG-60 implementation starts/,
      'BUG-59 checked item must preserve its BUG-60 gating quote-back requirement',
    );
    assert.match(
      bug59,
      /BUG-52 third variant/,
      'BUG-59 checked item must preserve the BUG-52 third-variant distinction',
    );
  });

  it('keeps quote-back closure language visible on the other still-open blocker asks', () => {
    const roadmap = readRoadmap();
    const bugToExpectedAsk = new Map([
      ['BUG-61', 'TESTER_QUOTEBACK_ASK_V4.md'],
      ['BUG-62', 'TESTER_QUOTEBACK_ASK_V3.md'],
      ['BUG-54', 'TESTER_QUOTEBACK_ASK_V2.md'],
      ['BUG-52', 'TESTER_QUOTEBACK_ASK_V1.md'],
      ['BUG-53', 'TESTER_QUOTEBACK_ASK_V5_BUG53.md'],
    ]);

    for (const [bugId, askPath] of bugToExpectedAsk) {
      const item = extractRoadmapItem(roadmap, bugId);
      assert.match(
        item,
        /tester quote-back|Tester-quoted|tester-quoted|quote-back/i,
        `${bugId} must preserve tester quote-back as the closure evidence`,
      );
    }

    const handoffLine = roadmap
      .split('\n')
      .find((line) => line.startsWith('Current tester handoff asks:'));
    for (const [, askPath] of bugToExpectedAsk) {
      assert.match(
        handoffLine,
        new RegExp(askPath),
        `top-of-file handoff must point at ${askPath}`,
      );
    }
  });

  it('keeps tester quote-back ask files aligned with their open-blocker closure lanes', () => {
    for (const ask of TESTER_QUOTEBACK_ASKS) {
      const content = readFileSync(join(REPO_ROOT, ask.path), 'utf8');

      assert.match(
        content,
        /Target package: `agentxchain@2\.154\.7` or later/,
        `${ask.path} must preserve the current shipped-package floor`,
      );
      assert.match(
        content,
        /Do not paraphrase|literal command output|literal event output|literal output/i,
        `${ask.path} must preserve the literal quote-back requirement`,
      );
      assert.match(
        content,
        /When valid quote-back lands[\s\S]{0,120}update `.planning\/HUMAN-ROADMAP\.md`/,
        `${ask.path} must preserve the roadmap closure instruction`,
      );

      for (const bugId of ask.bugs) {
        assert.match(content, new RegExp(bugId), `${ask.path} must name ${bugId}`);
      }
      for (const evidencePhrase of ask.evidence) {
        assert.match(
          content,
          new RegExp(evidencePhrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
          `${ask.path} must preserve evidence phrase ${JSON.stringify(evidencePhrase)}`,
        );
      }
    }
  });
});
