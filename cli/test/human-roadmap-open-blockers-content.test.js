/**
 * HUMAN-ROADMAP closure evidence guard.
 *
 * All bugs in the original BUG-52 through BUG-68 cluster are now CLOSED:
 *   - BUG-52: tester-verified on agentxchain@2.154.11.
 *   - BUG-53: closed via shipped agentxchain@2.155.10 dogfood evidence.
 *   - BUG-54: closed via shipped agentxchain@2.155.10 dogfood evidence.
 *   - BUG-55: tester-verified on agentxchain@2.150.0.
 *   - BUG-59: shipped in agentxchain@2.151.0, checked.
 *   - BUG-60: closed via shipped agentxchain@2.155.10 dogfood evidence.
 *   - BUG-61: mechanism-verified on agentxchain@2.154.11.
 *   - BUG-62: shipped-package scratch proof on agentxchain@2.155.10.
 *   - BUG-63, BUG-64: closed via agentxchain@2.155.2 / 2.155.6.
 *   - BUG-65, BUG-66, BUG-67, BUG-68: fixed in repo HEAD.
 *
 * This guard ensures closure evidence is not silently removed or regressed.
 */

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const HUMAN_ROADMAP_PATH = join(REPO_ROOT, '.planning', 'HUMAN-ROADMAP.md');
const HUMAN_ROADMAP_ARCHIVE_PATH = join(REPO_ROOT, '.planning', 'HUMAN-ROADMAP-ARCHIVE.md');
const DECISIONS_PATH = join(REPO_ROOT, '.planning', 'DECISIONS.md');
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
  return [
    readFileSync(HUMAN_ROADMAP_PATH, 'utf8'),
    readFileSync(HUMAN_ROADMAP_ARCHIVE_PATH, 'utf8'),
  ].join('\n');
}

function readCurrentRoadmap() {
  return readFileSync(HUMAN_ROADMAP_PATH, 'utf8');
}

function extractCheckedItem(roadmap, bugId) {
  const start = roadmap.search(new RegExp(`^- \\[x\\] \\*\\*${bugId}(?::|\\b)`, 'm'));
  assert.notEqual(start, -1, `${bugId} must be a checked (closed) roadmap item`);
  const next = roadmap.indexOf('\n- [', start + 1);
  return roadmap.slice(start, next === -1 ? roadmap.length : next);
}

function assertDecisionExists(decisions, decisionId, requiredPhrase) {
  const start = decisions.indexOf(`## ${decisionId}`);
  assert.notEqual(start, -1, `${decisionId} must exist in the durable decision ledger`);
  const next = decisions.indexOf('\n## ', start + 1);
  const decision = decisions.slice(start, next === -1 ? decisions.length : next);
  assert.match(
    decision,
    new RegExp(requiredPhrase),
    `${decisionId} must preserve ${requiredPhrase}`,
  );
}

describe('HUMAN-ROADMAP open blocker status', () => {
  it('keeps the current focus reflecting full-auto closure sweep completion', () => {
    const roadmap = readCurrentRoadmap();
    const currentFocusLine = roadmap
      .split('\n')
      .find((line) => line.startsWith('Current focus:'));

    assert.ok(currentFocusLine, 'roadmap must keep a current focus line');
    assert.match(
      currentFocusLine,
      /BUG-77/,
      'current focus must reflect the open BUG-77 roadmap-replenishment defect awaiting reverify',
    );
    assert.match(
      currentFocusLine,
      /BUG-78/,
      'current focus must reflect the open BUG-78 no-edit review defect awaiting reverify',
    );
    assert.match(
      currentFocusLine,
      /BUG-90/,
      'current focus must reflect the open BUG-90 broad staged-result normalization blocker',
    );
  });

  it('keeps the current tester handoff line pointing at historical V1 through V6 asks', () => {
    const roadmap = readRoadmap();
    assert.match(
      roadmap,
      /historical/,
      'roadmap/archive must mark historical asks as historical now that all older bugs are closed',
    );
  });

  it('keeps BUG-60 marked as closed with dogfood evidence', () => {
    const roadmap = readRoadmap();
    const bug60 = extractCheckedItem(roadmap, 'BUG-60');
    const decisions = readFileSync(DECISIONS_PATH, 'utf8');

    assert.match(
      bug60,
      /Closed 2026-04-24[\s\S]{0,300}agentxchain@2\.155\.10/,
      'BUG-60 must preserve the dogfood closure date and package version',
    );
    assert.match(
      bug60,
      /DEC-BUG60-PERPETUAL-DOGFOOD-CLOSURE-001/,
      'BUG-60 closure must cite the durable decision record',
    );
    assertDecisionExists(
      decisions,
      'DEC-BUG60-PERPETUAL-DOGFOOD-CLOSURE-001',
      'BUG-60 is closed',
    );
  });

  it('keeps BUG-59 shipped with BUG-60 gate satisfied status explicit', () => {
    const roadmap = readRoadmap();
    const uncheckedBug59 = roadmap.search(/^- \[ \] \*\*BUG-59(?::|\b)/m);

    assert.equal(
      uncheckedBug59,
      -1,
      'BUG-59 must not regress into an unchecked roadmap blocker',
    );
    assert.match(
      roadmap,
      /BUG-59[\s\S]{0,120}agentxchain@2\.151\.0/,
      'BUG-59 closure must preserve the shipped-package baseline',
    );
    assert.match(
      roadmap,
      /BUG-52 third variant/,
      'BUG-59 closure must preserve the BUG-52 third-variant distinction',
    );
  });

  it('keeps BUG-52 marked as closed with tester-verified closure evidence', () => {
    const roadmap = readRoadmap();

    assert.match(
      roadmap,
      /BUG-52[\s\S]{0,600}agentxchain@2\.154\.11/,
      'BUG-52 must preserve the tester-verified closure date and package version',
    );
    assert.match(
      roadmap,
      /tester-verified shipped-package evidence/,
      'BUG-52 must preserve that closure came from tester quote-back',
    );
  });

  it('keeps BUG-61 marked as closed with mechanism-verified tester evidence and caveat', () => {
    const roadmap = readRoadmap();
    const checkedBug61 = roadmap.search(/^- \[x\] \*\*BUG-61(?::|\b)/m);

    assert.notEqual(checkedBug61, -1, 'BUG-61 must be a checked (closed) roadmap item');

    const next = roadmap.indexOf('\n- [', checkedBug61 + 1);
    const bug61 = roadmap.slice(checkedBug61, next === -1 ? roadmap.length : next);

    assert.match(
      bug61,
      /Closed 2026-04-24[\s\S]{0,240}agentxchain@2\.154\.11/,
      'BUG-61 must preserve the tester evidence date and package version',
    );
    assert.match(
      bug61,
      /BUG-61-ghost-retry-v2\.154\.11\.md/,
      'BUG-61 closure must cite the tester quote-back evidence file',
    );
    assert.match(
      bug61,
      /Positive retry-success was not separately provable[\s\S]{0,420}BUG-61b/,
      'BUG-61 closure must preserve the positive-path caveat and narrow follow-up boundary',
    );
    assert.match(
      bug61,
      /DEC-BUG61-MECHANISM-VERIFIED-CLOSURE-001/,
      'BUG-61 closure must cite the durable decision record',
    );

    const decisions = readFileSync(DECISIONS_PATH, 'utf8');
    assert.match(
      decisions,
      /## DEC-BUG61-MECHANISM-VERIFIED-CLOSURE-001[\s\S]{0,900}BUG-61 is closed as mechanism-verified/,
      'BUG-61 closure decision must exist in the durable decision ledger',
    );
  });

  it('keeps BUG-54 marked as closed with dogfood reliability evidence', () => {
    const roadmap = readRoadmap();
    const bug54 = extractCheckedItem(roadmap, 'BUG-54');
    const decisions = readFileSync(DECISIONS_PATH, 'utf8');

    assert.match(
      bug54,
      /Closed 2026-04-24[\s\S]{0,300}agentxchain@2\.155\.10/,
      'BUG-54 must preserve the dogfood closure date and package version',
    );
    assert.match(
      bug54,
      /DEC-BUG54-DOGFOOD-RELIABILITY-CLOSURE-001/,
      'BUG-54 closure must cite the durable decision record',
    );
    assertDecisionExists(
      decisions,
      'DEC-BUG54-DOGFOOD-RELIABILITY-CLOSURE-001',
      'BUG-54 is closed',
    );
  });

  it('keeps BUG-53 and BUG-62 marked as closed with dogfood evidence', () => {
    const roadmap = readRoadmap();
    const decisions = readFileSync(DECISIONS_PATH, 'utf8');

    assert.match(
      roadmap,
      /Closed 2026-04-24[\s\S]{0,300}agentxchain@2\.155\.10/,
      'BUG-53 must preserve the dogfood closure date and package version',
    );
    assert.match(
      roadmap,
      /Closed 2026-04-24[\s\S]{0,300}agentxchain@2\.155\.10/,
      'BUG-62 must preserve the dogfood closure date and package version',
    );
    assert.match(
      decisions,
      /DEC-BUG53-PERPETUAL-CHAIN-CLOSURE-001/,
      'BUG-53 closure must cite the durable decision record',
    );
    assert.match(
      decisions,
      /DEC-BUG62-SHIPPED-PACKAGE-CLOSURE-001/,
      'BUG-62 closure must cite the durable decision record',
    );
    assertDecisionExists(
      decisions,
      'DEC-BUG53-PERPETUAL-CHAIN-CLOSURE-001',
      'BUG-53 is closed',
    );
    assertDecisionExists(
      decisions,
      'DEC-BUG62-SHIPPED-PACKAGE-CLOSURE-001',
      'BUG-62 is closed',
    );
  });

  it('keeps tester quote-back ask files aligned with their closure lanes', () => {
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
