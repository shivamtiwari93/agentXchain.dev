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

describe('homebrew mirror contract', () => {
  const packageJson = JSON.parse(read('cli/package.json'));
  const formula = read('cli/homebrew/agentxchain.rb');
  const readme = read('cli/homebrew/README.md');
  const version = packageJson.version;
  const tarballUrl = `https://registry.npmjs.org/agentxchain/-/agentxchain-${version}.tgz`;

  it('keeps the mirror formula aligned with the current package version', () => {
    assert.match(formula, new RegExp(`url "${escapeRegExp(tarballUrl)}"`));
    const shaMatch = formula.match(/sha256 "([0-9a-f]{64})"/);
    assert.ok(shaMatch, 'expected mirrored formula to declare a SHA256');
    assert.notEqual(
      shaMatch[1],
      '0000000000000000000000000000000000000000000000000000000000000000',
      'expected mirrored formula to use the real npm tarball SHA, not a placeholder',
    );
    assert.match(formula, /system "npm", "install", \*std_npm_args\b/);
    assert.doesNotMatch(formula, /\*std_npm_args\(libexec\)/);
  });

  it('keeps maintainer docs aligned with the mirrored formula target', () => {
    assert.match(readme, /canonical Homebrew tap lives in `shivamtiwari93\/homebrew-tap`/);
    assert.match(readme, new RegExp(`- version: \`${escapeRegExp(version)}\``));
    assert.match(readme, new RegExp(`- source tarball: \`${escapeRegExp(tarballUrl)}\``));
    assert.match(
      readme,
      /Mirror the same version and tarball URL in `cli\/homebrew\/agentxchain\.rb` and this README\./,
    );
    assert.doesNotMatch(readme, /0\.8\.8/);
    assert.doesNotMatch(readme, /2\.1\.1/);
  });
});
