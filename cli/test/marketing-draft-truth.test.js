import { strict as assert } from 'node:assert';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');

function read(relativePath) {
  return readFileSync(join(ROOT, relativePath), 'utf8');
}

function countFixtures(dir) {
  let total = 0;
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      total += countFixtures(fullPath);
      continue;
    }
    if (entry.endsWith('.json')) {
      total += 1;
    }
  }
  return total;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractTopReleaseSection(changelog, version) {
  const heading = `## ${version}`;
  const start = changelog.indexOf(heading);
  assert.notEqual(start, -1, `CHANGELOG must contain heading ${heading}`);
  const afterStart = changelog.slice(start + heading.length);
  const nextHeadingOffset = afterStart.search(/\n##\s+\d+\.\d+\.\d+/);
  return nextHeadingOffset === -1 ? afterStart : afterStart.slice(0, nextHeadingOffset);
}

function extractEvidenceLine(section, version) {
  const match = section.match(/(\d+ tests \/ \d+ suites \/ 0 failures)/);
  assert.ok(match, `top changelog section for ${version} must contain an aggregate evidence line`);
  return match[1];
}

const pkg = JSON.parse(read('cli/package.json'));
const expectedVersion = pkg.version;
const changelogSection = extractTopReleaseSection(read('cli/CHANGELOG.md'), expectedVersion);
const expectedEvidenceLine = extractEvidenceLine(changelogSection, expectedVersion);
const fixtureCount = countFixtures(join(ROOT, '.agentxchain-conformance', 'fixtures'));
const launchPageSpec = read('.planning/LAUNCH_PAGE_SPEC.md');
const marketingSpecPath = join(ROOT, '.planning', 'MARKETING_DRAFT_TRUTH_SPEC.md');
const marketingSpec = read('.planning/MARKETING_DRAFT_TRUTH_SPEC.md');
const launchEvidenceReport = read('.planning/LAUNCH_EVIDENCE_REPORT.md');

const drafts = [
  ['Twitter thread', read('.planning/MARKETING/TWITTER_THREAD.md')],
  ['Reddit posts', read('.planning/MARKETING/REDDIT_POSTS.md')],
  ['HN submission', read('.planning/MARKETING/HN_SUBMISSION.md')],
];

describe('marketing draft truth spec', () => {
  it('exists as a standalone spec', () => {
    assert.ok(existsSync(marketingSpecPath), 'MARKETING_DRAFT_TRUTH_SPEC.md must exist');
    assert.match(marketingSpec, /# Marketing Draft Truth Spec/);
  });

  it('freezes acceptance coverage for current release truth', () => {
    for (const id of [
      'AT-MARKETING-TRUTH-001',
      'AT-MARKETING-TRUTH-002',
      'AT-MARKETING-TRUTH-003',
      'AT-MARKETING-TRUTH-004',
      'AT-MARKETING-TRUTH-005',
      'AT-MARKETING-TRUTH-006',
      'AT-MARKETING-TRUTH-007',
    ]) {
      assert.match(marketingSpec, new RegExp(id));
    }
  });

  it('defines canonical numeric authority instead of split authority between changelog and report', () => {
    assert.match(marketingSpec, /Canonical current release truth sources:/);
    assert.match(marketingSpec, /Exact release version and aggregate evidence numbers are canonical in `cli\/package\.json` and the top `cli\/CHANGELOG\.md` section/i);
    assert.match(marketingSpec, /\.planning\/LAUNCH_EVIDENCE_REPORT\.md` must mirror the same current version and aggregate evidence line/i);
  });

  it('keeps the launch-page spec honest about historical launch page vs current drafts', () => {
    assert.match(launchPageSpec, /historical v2\.24\.1 launch snapshot/i);
    assert.match(launchPageSpec, /Launch-linked drafts under `\.planning\/MARKETING\/` must track current release truth/);
    assert.match(launchPageSpec, /all five adapter types are proven live/i);
  });

  it('keeps the launch evidence report aligned with the changelog-derived evidence line', () => {
    assert.match(launchEvidenceReport, new RegExp(`v${escapeRegExp(expectedVersion)}`),
      `LAUNCH_EVIDENCE_REPORT must mention v${expectedVersion}`);
    assert.match(launchEvidenceReport, new RegExp(escapeRegExp(expectedEvidenceLine)),
      `LAUNCH_EVIDENCE_REPORT must carry ${expectedEvidenceLine}`);
  });
});

describe('reusable marketing drafts', () => {
  for (const [label, content] of drafts) {
    it(`${label} carries the current released version`, () => {
      assert.match(content, new RegExp(`v${escapeRegExp(expectedVersion)}`),
        `${label} must mention v${expectedVersion}`);
    });

    it(`${label} carries the current aggregate evidence line`, () => {
      assert.match(content, new RegExp(escapeRegExp(expectedEvidenceLine)),
        `${label} must carry ${expectedEvidenceLine}`);
    });

    it(`${label} carries the current conformance corpus size`, () => {
      assert.equal(fixtureCount, 108, 'update this guard when the shipped conformance corpus changes intentionally');
      assert.match(content, new RegExp(`\\b${fixtureCount} conformance fixtures\\b`),
        `${label} must mention ${fixtureCount} conformance fixtures`);
    });

    it(`${label} preserves the five-adapter proof boundary`, () => {
      assert.match(content, /\bAll 5 (adapter types|runtime adapters|adapters) proven live\b/i,
        `${label} must say all 5 adapters are proven live`);
      assert.match(content, /\bremote_agent\b/,
        `${label} must include remote_agent in the current adapter surface`);
      assert.doesNotMatch(content, /\bAll 4 (adapter types|runtime adapters|adapters) proven live\b/i,
        `${label} still uses the stale four-adapter story`);
    });

    it(`${label} keeps manual out of the real-model proof path`, () => {
      assert.match(content, /manual.*(human control path|human-in-the-loop control path|governed human path)/i,
        `${label} must describe manual as the human control path`);
      assert.doesNotMatch(content, /manual[^\n]*real (AI )?model/i,
        `${label} must not describe manual as real-model proof`);
    });

    it(`${label} rejects stale release-era version and count language`, () => {
      assert.doesNotMatch(content, /\bv2\.24(\.1)?\b|\bv2\.25\.2\b/,
        `${label} still carries stale launch-era version language`);
      assert.doesNotMatch(content, /\b4,500\+ tests\b|\b970\+ suites\b|\b2,486\+ tests\b/,
        `${label} still carries stale proof-floor language`);
    });
  }
});
