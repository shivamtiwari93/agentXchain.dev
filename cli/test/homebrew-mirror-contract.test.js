import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');

function read(relPath) {
  return readFileSync(resolve(ROOT, relPath), 'utf8');
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ── Tier 1: Internal consistency — always runs ─────────────────────────
// These tests verify the formula is structurally valid regardless of
// which version it currently tracks. They must never be skipped.
describe('homebrew mirror — internal consistency (always)', () => {
  const formula = read('cli/homebrew/agentxchain.rb');
  const readme = read('cli/homebrew/README.md');

  it('formula has a well-formed registry URL', () => {
    assert.match(
      formula,
      /url "https:\/\/registry\.npmjs\.org\/agentxchain\/-\/agentxchain-\d+\.\d+\.\d+\.tgz"/,
      'expected formula URL to be a valid npm registry tarball URL',
    );
  });

  it('formula has a real non-placeholder SHA256', () => {
    const shaMatch = formula.match(/sha256 "([0-9a-f]{64})"/);
    assert.ok(shaMatch, 'expected formula to declare a SHA256');
    assert.notEqual(
      shaMatch[1],
      '0000000000000000000000000000000000000000000000000000000000000000',
      'expected formula SHA to be a real hash, not the all-zero placeholder',
    );
  });

  it('formula uses the correct install pattern', () => {
    assert.match(formula, /system "npm", "install", \*std_npm_args\b/);
    assert.doesNotMatch(formula, /\*std_npm_args\(libexec\)/);
  });

  it('README documents the canonical tap', () => {
    assert.match(readme, /canonical Homebrew tap lives in `shivamtiwari93\/homebrew-tap`/);
    assert.match(
      readme,
      /Mirror the same version and tarball URL in `cli\/homebrew\/agentxchain\.rb` and this README\./,
    );
  });

  it('formula URL and README version are internally consistent', () => {
    const urlMatch = formula.match(/url "https:\/\/registry\.npmjs\.org\/agentxchain\/-\/agentxchain-(\d+\.\d+\.\d+)\.tgz"/);
    assert.ok(urlMatch, 'expected formula to have a parseable version in URL');
    const formulaVersion = urlMatch[1];
    assert.match(readme, new RegExp(`- version: \`${escapeRegExp(formulaVersion)}\``),
      'expected README version to match formula URL version');
    const tarball = `https://registry.npmjs.org/agentxchain/-/agentxchain-${formulaVersion}.tgz`;
    assert.match(readme, new RegExp(`- source tarball: \`${escapeRegExp(tarball)}\``),
      'expected README tarball to match formula URL');
  });

  it('README does not reference ancient stale versions', () => {
    assert.doesNotMatch(readme, /0\.8\.8/);
    assert.doesNotMatch(readme, /2\.1\.1/);
  });
});

// ── Tier 2: Version alignment — skipped during release preflight ───────
// These tests verify the mirror tracks the *current* package.json version.
// During the transient post-bump/pre-publish window, the formula URL points
// to the new version but the SHA is carried from the previous version.
// The `AGENTXCHAIN_RELEASE_PREFLIGHT=1` skip is intentional for this window.
// After publish, `sync-homebrew.sh` sets the real SHA and these tests must
// pass without the env skip.
describe('homebrew mirror — version alignment (post-publish)', () => {
  const isReleasePreflight = process.env.AGENTXCHAIN_RELEASE_PREFLIGHT === '1';
  const packageJson = JSON.parse(read('cli/package.json'));
  const formula = read('cli/homebrew/agentxchain.rb');
  const readme = read('cli/homebrew/README.md');
  const version = packageJson.version;
  const tarballUrl = `https://registry.npmjs.org/agentxchain/-/agentxchain-${version}.tgz`;

  it('formula URL matches current package.json version', { skip: isReleasePreflight }, () => {
    assert.match(formula, new RegExp(`url "${escapeRegExp(tarballUrl)}"`),
      `expected formula URL to point to v${version}`);
  });

  it('README version and tarball match current package.json version', { skip: isReleasePreflight }, () => {
    assert.match(readme, new RegExp(`- version: \`${escapeRegExp(version)}\``));
    assert.match(readme, new RegExp(`- source tarball: \`${escapeRegExp(tarballUrl)}\``));
  });

  it('formula SHA is a real hash (not placeholder) for current version', { skip: isReleasePreflight }, () => {
    // This test verifies structural non-placeholder status. True SHA-to-tarball
    // correctness requires network verification via `npm run verify:post-publish`.
    assert.match(formula, new RegExp(`url "${escapeRegExp(tarballUrl)}"`),
      'URL must match current version before SHA can be meaningful');
    const shaMatch = formula.match(/sha256 "([0-9a-f]{64})"/);
    assert.ok(shaMatch, 'expected formula to declare a SHA256');
    assert.notEqual(
      shaMatch[1],
      '0000000000000000000000000000000000000000000000000000000000000000',
      'expected formula SHA to be a real hash, not the all-zero placeholder',
    );
  });
});
