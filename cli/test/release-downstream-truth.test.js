import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_DIR = join(__dirname, '..');
const REPO_ROOT = join(CLI_DIR, '..');

function read(relPath) {
  return readFileSync(join(REPO_ROOT, relPath), 'utf8');
}

const SCRIPT = read('cli/scripts/release-downstream-truth.sh');
const PACKAGE = JSON.parse(read('cli/package.json'));
const PLAYBOOK = read('.planning/RELEASE_PLAYBOOK.md');
const HOMEBREW_FORMULA = read('cli/homebrew/agentxchain.rb');

describe('release downstream truth contract', () => {
  it('AT-RDT-GUARD-001: downstream truth script exists and is referenced in package.json', () => {
    assert.ok(
      existsSync(join(CLI_DIR, 'scripts', 'release-downstream-truth.sh')),
      'release-downstream-truth.sh must exist',
    );
    assert.ok(
      PACKAGE.scripts['postflight:downstream'],
      'package.json must have postflight:downstream script',
    );
    assert.match(
      PACKAGE.scripts['postflight:downstream'],
      /release-downstream-truth\.sh/,
    );
  });

  it('AT-RDT-GUARD-002: script checks GitHub release existence', () => {
    assert.match(SCRIPT, /gh release view/);
    assert.match(SCRIPT, /GitHub release/);
  });

  it('AT-RDT-GUARD-003: script checks Homebrew SHA against registry tarball', () => {
    assert.match(SCRIPT, /sha256/i);
    assert.match(SCRIPT, /registry tarball/i);
    assert.match(SCRIPT, /Homebrew formula SHA256/);
  });

  it('AT-RDT-GUARD-004: script checks Homebrew URL against registry tarball URL', () => {
    assert.match(SCRIPT, /Homebrew formula URL/);
    assert.match(SCRIPT, /dist\.tarball/);
  });

  it('AT-RDT-GUARD-005: release playbook documents downstream truth verification', () => {
    assert.match(PLAYBOOK, /postflight:downstream/);
    assert.match(PLAYBOOK, /Downstream Truth Verification/);
  });

  it('AT-RDT-GUARD-006: Homebrew formula URL contains current package version', () => {
    const version = PACKAGE.version;
    assert.match(
      HOMEBREW_FORMULA,
      new RegExp(`agentxchain-${version.replace(/\./g, '\\.')}\\.tgz`),
      `Homebrew formula URL must reference current version ${version}`,
    );
  });
});
