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
const CURRENT_VERSION = process.env.AGENTXCHAIN_RELEASE_TARGET_VERSION || PACKAGE.version;
const CURRENT_RELEASE_DOC_ID = `releases/v${CURRENT_VERSION.replace(/\./g, '-')}`;
const CURRENT_RELEASE_DOC_PATH = `website-v2/docs/${CURRENT_RELEASE_DOC_ID}.mdx`;

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
    assert.match(releasePage, /\d+ node tests/, 'Evidence must include concrete node test count');
    assert.match(releasePage, /0 failures/, 'Evidence must confirm 0 failures');
  });

  it('AT-CRS-008: changelog evidence section has concrete test counts', () => {
    const versionBlock = CHANGELOG.split(/^## \d+\.\d+\.\d+$/m).slice(0, 2).join('');
    assert.match(versionBlock, /\d+ node tests/, 'Changelog evidence must include concrete node test count');
    assert.match(versionBlock, /0 failures/, 'Changelog evidence must confirm 0 failures');
  });
});
