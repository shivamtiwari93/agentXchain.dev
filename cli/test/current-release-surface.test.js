import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

function read(relPath) {
  return readFileSync(join(REPO_ROOT, relPath), 'utf8');
}

function readJson(relPath) {
  return JSON.parse(read(relPath));
}

const PACKAGE = readJson('cli/package.json');
const CHANGELOG = read('cli/CHANGELOG.md');
const SIDEBARS = read('website-v2/sidebars.ts');
const HOME = read('website-v2/src/pages/index.tsx');
const CAPABILITIES = readJson('.agentxchain-conformance/capabilities.json');
const IMPLEMENTOR_GUIDE = read('website-v2/docs/protocol-implementor-guide.mdx');
const LAUNCH_EVIDENCE = read('.planning/LAUNCH_EVIDENCE_REPORT.md');
const LLMS = read('website-v2/static/llms.txt');
const SITEMAP = read('website-v2/static/sitemap.xml');
const HOMEBREW_FORMULA = read('cli/homebrew/agentxchain.rb');
const HOMEBREW_README = read('cli/homebrew/README.md');
const CURRENT_VERSION = process.env.AGENTXCHAIN_RELEASE_TARGET_VERSION || PACKAGE.version;
const CURRENT_RELEASE_DOC_ID = `releases/v${CURRENT_VERSION.replace(/\./g, '-')}`;
const CURRENT_RELEASE_DOC_PATH = `website-v2/docs/${CURRENT_RELEASE_DOC_ID}.mdx`;
const CURRENT_TARBALL_URL = `https://registry.npmjs.org/agentxchain/-/agentxchain-${CURRENT_VERSION}.tgz`;
const CURRENT_RELEASE_ROUTE = `/docs/${CURRENT_RELEASE_DOC_ID}`;

function extractAggregateEvidenceLine(text, label) {
  const matches = [...text.matchAll(/^-\s+.*\b(\d+)\s+tests\b.*\b0 failures\b.*$/gm)];
  assert.ok(matches.length > 0, `${label} must include a concrete test-count evidence line with 0 failures`);
  const aggregate = matches.reduce((best, match) => {
    const count = Number(match[1]);
    if (!best || count > best.count) {
      return { count, line: match[0] };
    }
    return best;
  }, null);
  return aggregate.line
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .trim();
}

describe('current release surface', () => {
  it('AT-CRS-001: changelog top heading matches current package version', () => {
    const topHeading = CHANGELOG.match(/^##\s+([0-9]+\.[0-9]+\.[0-9]+)$/m);
    assert.ok(topHeading, 'CHANGELOG.md must contain a version heading');
    assert.equal(topHeading[1], CURRENT_VERSION);
  });

  it('AT-CRS-002: current release notes page exists', () => {
    assert.ok(
      existsSync(join(REPO_ROOT, CURRENT_RELEASE_DOC_PATH)),
      `current release notes page must exist at ${CURRENT_RELEASE_DOC_PATH}`,
    );
  });

  it('AT-CRS-003: docs sidebar links the current release notes page', () => {
    assert.match(SIDEBARS, new RegExp(`'${CURRENT_RELEASE_DOC_ID}'`));
  });

  it('AT-CRS-004: homepage hero badge shows current package version', () => {
    assert.match(HOME, new RegExp(`v${CURRENT_VERSION.replace(/\./g, '\\.')}`));
  });

  it('AT-CRS-005: conformance capabilities version matches current package version', () => {
    assert.equal(CAPABILITIES.version, CURRENT_VERSION);
  });

  it('AT-CRS-006: protocol implementor guide example shows current package version', () => {
    assert.match(IMPLEMENTOR_GUIDE, new RegExp(`"version": "${CURRENT_VERSION.replace(/\./g, '\\.')}"`));
  });

  it('AT-CRS-007: release notes page evidence section has concrete test counts', () => {
    const releasePage = read(CURRENT_RELEASE_DOC_PATH);
    assert.match(releasePage, /## Evidence/i, 'release notes page must have an Evidence section');
    extractAggregateEvidenceLine(releasePage, 'release notes evidence');
  });

  it('AT-CRS-008: changelog and release notes evidence lines stay aligned', () => {
    const versionBlock = CHANGELOG.split(/^## \d+\.\d+\.\d+$/m).slice(0, 2).join('');
    const releasePage = read(CURRENT_RELEASE_DOC_PATH);
    const changelogEvidence = extractAggregateEvidenceLine(versionBlock, 'changelog evidence');
    const releaseEvidence = extractAggregateEvidenceLine(releasePage, 'release notes evidence');
    assert.equal(
      changelogEvidence,
      releaseEvidence,
      'top changelog aggregate evidence and current release-note aggregate evidence must match exactly',
    );
  });

  it('AT-CRS-009: launch evidence title carries the current release version', () => {
    assert.match(
      LAUNCH_EVIDENCE,
      new RegExp(`^# Launch Evidence Report — AgentXchain v${CURRENT_VERSION.replace(/\./g, '\\.')}`, 'm'),
      'Launch evidence report title must track the current release version',
    );
  });

  it('AT-CRS-010: Homebrew mirror formula points at the current npm tarball', () => {
    assert.match(
      HOMEBREW_FORMULA,
      new RegExp(`url "${CURRENT_TARBALL_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`),
      'Homebrew mirror formula must track the current npm tarball URL',
    );
  });

  it('AT-CRS-011: Homebrew mirror maintainer README tracks the current version and tarball', () => {
    assert.match(
      HOMEBREW_README,
      new RegExp(`- version: \`${CURRENT_VERSION.replace(/\./g, '\\.')}\``),
      'Homebrew mirror README must track the current version',
    );
    assert.match(
      HOMEBREW_README,
      new RegExp(`- source tarball: \`${CURRENT_TARBALL_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\``),
      'Homebrew mirror README must track the current tarball URL',
    );
  });

  it('AT-CRS-012: llms.txt lists the current release-notes route', () => {
    assert.match(
      LLMS,
      new RegExp(CURRENT_RELEASE_ROUTE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      'llms.txt must list the current release-notes route',
    );
  });

  it('AT-CRS-013: sitemap.xml lists the current release-notes route', () => {
    assert.match(
      SITEMAP,
      new RegExp(CURRENT_RELEASE_ROUTE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      'sitemap.xml must list the current release-notes route',
    );
  });
});
