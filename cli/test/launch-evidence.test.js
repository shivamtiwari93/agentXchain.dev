import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');
const read = (rel) => readFileSync(resolve(ROOT, rel), 'utf8');

describe('Launch evidence report', () => {
  const report = read('.planning/LAUNCH_EVIDENCE_REPORT.md');

  it('exists and contains all four required sections', () => {
    assert.match(report, /## 1\. Evidence Inventory/);
    assert.match(report, /## 2\. Allowed Claims/);
    assert.match(report, /## 3\. Disallowed Claims/);
    assert.match(report, /## 4\. Evidence Gaps/);
  });

  it('every allowed claim row cites an evidence source (E1-E5) or a direct file reference', () => {
    const allowedSection = report.split('## 2. Allowed Claims')[1].split('## 3. Disallowed Claims')[0];
    const rows = allowedSection.split('\n').filter(l => l.startsWith('|') && !l.includes('---') && !l.includes('Claim'));
    assert.ok(rows.length > 0, 'should have allowed claim rows');
    for (const row of rows) {
      assert.match(row, /E[1-5]|`[A-Z]/,
        `Allowed claim row must cite evidence or a file: ${row.slice(0, 80)}`);
    }
  });

  it('references the current test count floor', () => {
    assert.match(report, /1000\+.*launch-copy floor/i,
      'report should state the current launch-copy floor explicitly');
    assert.match(report, /1033 tests\s*[,\/]\s*0 failures/i,
      'report should record the current exact suite count verified on 2026-04-03');
    assert.doesNotMatch(report, /900\+.*launch-copy floor/i,
      'report should not retain the stale 900+ floor after crossing 1000+');
  });

  it('removes stale prerelease references to v1.0.0 publish gating', () => {
    assert.doesNotMatch(report, /v1\.0\.0 published to npm/i);
    assert.match(report, /v2\.0\.1 published to npm/i);
  });
});

describe('Launch surfaces do not contain disallowed claims', () => {
  const surfaces = [
    '.planning/SHOW_HN_DRAFT.md',
    '.planning/LAUNCH_BRIEF.md',
    'README.md',
    'website-v2/src/pages/index.tsx',
    'website-v2/src/pages/why.mdx',
  ];

  // Surfaces that contain user-facing copy (not internal constraint docs)
  const copyOnlySurfaces = surfaces.filter(s => !s.includes('LAUNCH_BRIEF'));

  for (const rel of copyOnlySurfaces) {
    describe(rel, () => {
      const content = read(rel);

      it('does not claim "full live end-to-end proof"', () => {
        assert.doesNotMatch(content, /full live (end.to.end|e2e) proof/i);
        assert.doesNotMatch(content, /all adapters proven live/i);
      });

      it('frames human gate claims as protocol rules, not as implied live proof', () => {
        if (/phase transitions and final completion/i.test(content)) {
          assert.match(content, /protocol requires human approval/i,
            `${rel} should frame completion gating as a protocol rule`);
        }
      });

      it('does not claim "production-proven" or "battle-tested"', () => {
        assert.doesNotMatch(content, /production.proven/i);
        assert.doesNotMatch(content, /battle.tested/i);
      });

      it('does not reference OpenAI Swarm as a current competitor', () => {
        const lines = content.split('\n');
        for (const line of lines) {
          if (/openai swarm/i.test(line) && !/deprecat/i.test(line) && !/replaced/i.test(line)) {
            assert.fail(`${rel} references OpenAI Swarm as current: ${line.trim().slice(0, 100)}`);
          }
        }
      });
    });
  }

  // LAUNCH_BRIEF is an internal doc with "do not claim X" constraint language.
  // We verify it references the evidence report but don't pattern-match its constraint warnings.
  describe('.planning/LAUNCH_BRIEF.md (internal)', () => {
    const content = read('.planning/LAUNCH_BRIEF.md');

    it('does not make positive claims of full live proof in non-constraint sections', () => {
      // Strip the "Evidence-Based Claim Boundaries" section before checking
      const withoutConstraints = content.split('## Evidence-Based Claim Boundaries')[0] +
        (content.split('## Release Day Sequence')[1] || '');
      assert.doesNotMatch(withoutConstraints, /full live (end.to.end|e2e) proof/i);
      assert.doesNotMatch(withoutConstraints, /production.proven/i);
    });
  });
});

describe('Website badge version matches package.json', () => {
  const homepage = read('website-v2/src/pages/index.tsx');
  const pkg = JSON.parse(read('cli/package.json'));

  it('hero badge shows the current package.json version', () => {
    const badgeMatch = homepage.match(/v(\d+\.\d+\.\d+)/);
    assert.ok(badgeMatch, 'hero badge should contain a version like vX.Y.Z');
    assert.equal(badgeMatch[1], pkg.version,
      `Website badge shows v${badgeMatch[1]} but package.json is ${pkg.version} — update the badge in website-v2/src/pages/index.tsx`);
  });
});

describe('Launch brief references evidence report', () => {
  const brief = read('.planning/LAUNCH_BRIEF.md');

  it('links to the evidence report', () => {
    assert.match(brief, /LAUNCH_EVIDENCE_REPORT\.md/);
  });

  it('includes claim boundary constraints', () => {
    assert.match(brief, /full live end-to-end proof/i);
    assert.match(brief, /production-proven/i);
    assert.match(brief, /DEC-POSITIONING-008/);
  });
});
