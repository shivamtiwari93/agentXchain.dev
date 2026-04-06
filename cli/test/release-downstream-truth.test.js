import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const CLI_ROOT = join(import.meta.dirname, '..');
const REPO_ROOT = join(CLI_ROOT, '..');
const SOURCE_SCRIPT = join(CLI_ROOT, 'scripts', 'release-downstream-truth.sh');

function read(relPath) {
  return readFileSync(join(REPO_ROOT, relPath), 'utf8');
}

function writeExecutable(path, content) {
  writeFileSync(path, content);
  chmodSync(path, 0o755);
}

function createFixture({ version = '2.15.0' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'axc-release-downstream-'));
  const cliDir = join(root, 'cli');
  const scriptsDir = join(cliDir, 'scripts');
  const fakeBinDir = join(root, 'fake-bin');

  mkdirSync(scriptsDir, { recursive: true });
  mkdirSync(fakeBinDir, { recursive: true });
  cpSync(SOURCE_SCRIPT, join(scriptsDir, 'release-downstream-truth.sh'));

  writeFileSync(
    join(cliDir, 'package.json'),
    JSON.stringify(
      {
        name: 'agentxchain',
        version,
        type: 'module',
      },
      null,
      2,
    ),
  );

  writeExecutable(
    join(fakeBinDir, 'npm'),
    [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      'if [[ "$1" == "view" && "$3" == "dist.tarball" ]]; then',
      '  if [[ "${FAKE_REGISTRY_MISSING:-0}" == "1" ]]; then',
      '    exit 1',
      '  fi',
      '  printf "%s\\n" "${FAKE_DIST_TARBALL:-https://registry.npmjs.org/agentxchain/-/agentxchain-2.15.0.tgz}"',
      '  exit 0',
      'fi',
      'echo "unexpected npm args: $*" >&2',
      'exit 2',
    ].join('\n'),
  );

  writeExecutable(
    join(fakeBinDir, 'gh'),
    [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      'if [[ "$1" == "release" && "$2" == "view" ]]; then',
      '  if [[ "${FAKE_GH_MISSING:-0}" == "1" ]]; then',
      '    exit 1',
      '  fi',
      '  printf "%s\\n" "${FAKE_GH_TAG:-v2.15.0}"',
      '  exit 0',
      'fi',
      'echo "unexpected gh args: $*" >&2',
      'exit 2',
    ].join('\n'),
  );

  writeExecutable(
    join(fakeBinDir, 'curl'),
    [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      'url="${@: -1}"',
      'if [[ "${FAKE_FORMULA_FETCH_FAIL:-0}" == "1" && "$url" == "${AGENTXCHAIN_DOWNSTREAM_FORMULA_URL:-}" ]]; then',
      '  exit 22',
      'fi',
      'if [[ "$url" == "${AGENTXCHAIN_DOWNSTREAM_FORMULA_URL:-}" ]]; then',
      '  printf "%s" "${FAKE_FORMULA_CONTENT:-}"',
      '  exit 0',
      'fi',
      'if [[ "$url" == "${FAKE_DIST_TARBALL:-https://registry.npmjs.org/agentxchain/-/agentxchain-2.15.0.tgz}" ]]; then',
      '  printf "%s" "${FAKE_TARBALL_CONTENT:-agentxchain-tarball}"',
      '  exit 0',
      'fi',
      'echo "unexpected curl url: ${url}" >&2',
      'exit 2',
    ].join('\n'),
  );

  return { root, cliDir, fakeBinDir };
}

function runDownstream(cliDir, fakeBinDir, args = [], envOverrides = {}) {
  return spawnSync('bash', ['scripts/release-downstream-truth.sh', ...args], {
    cwd: cliDir,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${fakeBinDir}:${process.env.PATH}`,
      AGENTXCHAIN_DOWNSTREAM_FORMULA_URL: 'https://example.test/homebrew/agentxchain.rb',
      RELEASE_DOWNSTREAM_RETRY_ATTEMPTS: '1',
      RELEASE_DOWNSTREAM_RETRY_DELAY_SECONDS: '0',
      ...envOverrides,
    },
  });
}

const fixtures = [];

after(() => {
  for (const fixture of fixtures) {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

describe('release downstream truth contract', () => {
  const script = read('cli/scripts/release-downstream-truth.sh');
  const packageJson = JSON.parse(read('cli/package.json'));
  const playbook = read('.planning/RELEASE_PLAYBOOK.md');
  const spec = read('.planning/RELEASE_DOWNSTREAM_TRUTH_SPEC.md');

  it('AT-RDT-GUARD-001: downstream truth script exists and is referenced in package.json', () => {
    assert.equal(packageJson.scripts['postflight:downstream'], 'bash scripts/release-downstream-truth.sh');
    assert.match(script, /AGENTXCHAIN_DOWNSTREAM_FORMULA_URL/);
  });

  it('AT-RDT-GUARD-002: spec and playbook declare canonical tap verification, not repo-mirror-only verification', () => {
    assert.match(spec, /canonical Homebrew tap/i);
    assert.match(playbook, /canonical Homebrew tap/i);
    assert.doesNotMatch(spec, /local repo mirror/i);
  });

  it('AT-RDT-001: passes when GitHub release and canonical tap match npm registry truth', () => {
    const fixture = createFixture();
    fixtures.push(fixture);

    const tarballUrl = 'https://registry.npmjs.org/agentxchain/-/agentxchain-2.15.0.tgz';
    const tarballContent = 'registry-tarball-v2140';
    const sha = spawnSync('shasum', ['-a', '256'], {
      input: tarballContent,
      encoding: 'utf8',
    }).stdout.trim().split(/\s+/)[0];
    const formula = [
      'class Agentxchain < Formula',
      `  url "${tarballUrl}"`,
      `  sha256 "${sha}"`,
      'end',
    ].join('\n');

    const result = runDownstream(
      fixture.cliDir,
      fixture.fakeBinDir,
      ['--target-version', '2.15.0'],
      {
        FAKE_DIST_TARBALL: tarballUrl,
        FAKE_TARBALL_CONTENT: tarballContent,
        FAKE_FORMULA_CONTENT: formula,
        FAKE_GH_TAG: 'v2.15.0',
      },
    );

    assert.equal(result.status, 0);
    assert.match(result.stdout, /PASS: GitHub release v2\.14\.0 exists/);
    assert.match(result.stdout, /PASS: canonical Homebrew formula SHA256 matches registry tarball/);
    assert.match(result.stdout, /PASS: canonical Homebrew formula URL matches registry tarball/);
    assert.match(result.stdout, /DOWNSTREAM TRUTH PASSED/);
  });

  it('AT-RDT-002: fails when the canonical formula cannot be fetched', () => {
    const fixture = createFixture();
    fixtures.push(fixture);

    const result = runDownstream(
      fixture.cliDir,
      fixture.fakeBinDir,
      ['--target-version', '2.15.0'],
      { FAKE_FORMULA_FETCH_FAIL: '1' },
    );

    assert.equal(result.status, 1);
    assert.match(result.stdout, /FAIL: cannot fetch canonical Homebrew formula/);
    assert.match(result.stdout, /FAIL: cannot verify URL — canonical Homebrew formula unavailable/);
  });

  it('AT-RDT-003: fails when the canonical formula SHA does not match the registry tarball', () => {
    const fixture = createFixture();
    fixtures.push(fixture);

    const formula = [
      'class Agentxchain < Formula',
      '  url "https://registry.npmjs.org/agentxchain/-/agentxchain-2.15.0.tgz"',
      '  sha256 "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"',
      'end',
    ].join('\n');

    const result = runDownstream(
      fixture.cliDir,
      fixture.fakeBinDir,
      ['--target-version', '2.15.0'],
      {
        FAKE_FORMULA_CONTENT: formula,
        FAKE_TARBALL_CONTENT: 'registry-tarball-v2140',
      },
    );

    assert.equal(result.status, 1);
    assert.match(result.stdout, /FAIL: canonical Homebrew formula SHA256 mismatch/);
  });

  it('AT-RDT-004: fails when the canonical formula URL does not match the registry tarball URL', () => {
    const fixture = createFixture();
    fixtures.push(fixture);

    const tarballContent = 'registry-tarball-v2140';
    const sha = spawnSync('shasum', ['-a', '256'], {
      input: tarballContent,
      encoding: 'utf8',
    }).stdout.trim().split(/\s+/)[0];
    const formula = [
      'class Agentxchain < Formula',
      '  url "https://registry.npmjs.org/agentxchain/-/agentxchain-2.13.0.tgz"',
      `  sha256 "${sha}"`,
      'end',
    ].join('\n');

    const result = runDownstream(
      fixture.cliDir,
      fixture.fakeBinDir,
      ['--target-version', '2.15.0'],
      {
        FAKE_DIST_TARBALL: 'https://registry.npmjs.org/agentxchain/-/agentxchain-2.15.0.tgz',
        FAKE_TARBALL_CONTENT: tarballContent,
        FAKE_FORMULA_CONTENT: formula,
      },
    );

    assert.equal(result.status, 1);
    assert.match(result.stdout, /FAIL: canonical Homebrew formula URL mismatch/);
  });

  it('AT-RDT-005: fails when the GitHub release is missing', () => {
    const fixture = createFixture();
    fixtures.push(fixture);

    const tarballContent = 'registry-tarball-v2140';
    const sha = spawnSync('shasum', ['-a', '256'], {
      input: tarballContent,
      encoding: 'utf8',
    }).stdout.trim().split(/\s+/)[0];
    const formula = [
      'class Agentxchain < Formula',
      '  url "https://registry.npmjs.org/agentxchain/-/agentxchain-2.15.0.tgz"',
      `  sha256 "${sha}"`,
      'end',
    ].join('\n');

    const result = runDownstream(
      fixture.cliDir,
      fixture.fakeBinDir,
      ['--target-version', '2.15.0'],
      {
        FAKE_FORMULA_CONTENT: formula,
        FAKE_TARBALL_CONTENT: tarballContent,
        FAKE_GH_MISSING: '1',
      },
    );

    assert.equal(result.status, 1);
    assert.match(result.stdout, /FAIL: GitHub release v2\.14\.0 not found/);
  });
});
