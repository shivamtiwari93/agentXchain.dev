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
      '  query=""',
      '  while [[ $# -gt 0 ]]; do',
      '    case "$1" in',
      '      -q)',
      '        query="${2:-}"',
      '        shift 2',
      '        ;;',
      '      *)',
      '        shift',
      '        ;;',
      '    esac',
      '  done',
      '  case "$query" in',
      "    '.tagName') printf \"%s\\\\n\" \"${FAKE_GH_TAG:-v2.15.0}\" ;;",
      "    '.isDraft') printf \"%s\\\\n\" \"${FAKE_GH_DRAFT:-false}\" ;;",
      "    '.url') printf \"%s\\\\n\" \"${FAKE_GH_URL:-https://github.com/shivamtiwari93/agentXchain.dev/releases/tag/v2.15.0}\" ;;",
      "    '.publishedAt') printf \"%s\\\\n\" \"${FAKE_GH_PUBLISHED_AT:-2026-04-20T01:47:33Z}\" ;;",
      '    *) printf "%s\\n" "${FAKE_GH_TAG:-v2.15.0}" ;;',
      '  esac',
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
  const defaultEnv = {
    ...process.env,
    PATH: `${fakeBinDir}:${process.env.PATH}`,
    AGENTXCHAIN_DOWNSTREAM_FORMULA_URL: 'https://example.test/homebrew/agentxchain.rb',
    RELEASE_DOWNSTREAM_RETRY_ATTEMPTS: '1',
    RELEASE_DOWNSTREAM_RETRY_DELAY_SECONDS: '0',
  };
  const env = {
    ...defaultEnv,
    ...envOverrides,
  };
  if (env.AGENTXCHAIN_DOWNSTREAM_FORMULA_URL === null) {
    delete env.AGENTXCHAIN_DOWNSTREAM_FORMULA_URL;
  }
  return spawnSync('bash', ['scripts/release-downstream-truth.sh', ...args], {
    cwd: cliDir,
    encoding: 'utf8',
    env,
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
    assert.match(script, /AGENTXCHAIN_DOWNSTREAM_FORMULA_REPO/);
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
    assert.match(result.stdout, /PASS: GitHub release v2\.15\.0 is published on the tagged release URL/);
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
    assert.match(result.stdout, /FAIL: GitHub release v2\.15\.0 is not fully published/);
  });

  it('AT-RDT-006: default repo-based formula fetching works without raw URL override', () => {
    const fixture = createFixture();
    fixtures.push(fixture);

    const formulaRepo = mkdtempSync(join(tmpdir(), 'axc-homebrew-tap-'));
    fixtures.push({ root: formulaRepo });
    mkdirSync(join(formulaRepo, 'Formula'), { recursive: true });

    const tarballUrl = 'https://registry.npmjs.org/agentxchain/-/agentxchain-2.15.0.tgz';
    const tarballContent = 'registry-tarball-v2150';
    const sha = spawnSync('shasum', ['-a', '256'], {
      input: tarballContent,
      encoding: 'utf8',
    }).stdout.trim().split(/\s+/)[0];

    writeFileSync(
      join(formulaRepo, 'Formula', 'agentxchain.rb'),
      [
        'class Agentxchain < Formula',
        `  url "${tarballUrl}"`,
        `  sha256 "${sha}"`,
        'end',
      ].join('\n'),
    );

    spawnSync('git', ['init'], { cwd: formulaRepo, stdio: 'ignore' });
    spawnSync('git', ['config', 'user.name', 'Release Downstream Test'], { cwd: formulaRepo, stdio: 'ignore' });
    spawnSync('git', ['config', 'user.email', 'release-downstream@example.invalid'], { cwd: formulaRepo, stdio: 'ignore' });
    spawnSync('git', ['add', '.'], { cwd: formulaRepo, stdio: 'ignore' });
    spawnSync('git', ['commit', '-m', 'fixture'], { cwd: formulaRepo, stdio: 'ignore' });

    const result = runDownstream(
      fixture.cliDir,
      fixture.fakeBinDir,
      ['--target-version', '2.15.0'],
      {
        AGENTXCHAIN_DOWNSTREAM_FORMULA_URL: null,
        AGENTXCHAIN_DOWNSTREAM_FORMULA_REPO: formulaRepo,
        FAKE_DIST_TARBALL: tarballUrl,
        FAKE_TARBALL_CONTENT: tarballContent,
        FAKE_GH_TAG: 'v2.15.0',
      },
    );

    assert.equal(result.status, 0);
    assert.match(result.stdout, /PASS: canonical Homebrew formula SHA256 matches registry tarball/);
    assert.match(result.stdout, /PASS: canonical Homebrew formula URL matches registry tarball/);
  });

  it('AT-RDT-007: fails when the GitHub release still exists only as a draft', () => {
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
        FAKE_GH_DRAFT: 'true',
      },
    );

    assert.equal(result.status, 1);
    assert.match(result.stdout, /FAIL: GitHub release v2\.15\.0 is not fully published/);
    assert.match(result.stdout, /draft=true/);
  });

  it('AT-RDT-008: fails when the GitHub release URL still points at an untagged release page', () => {
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
        FAKE_GH_URL: 'https://github.com/shivamtiwari93/agentXchain.dev/releases/tag/untagged-example',
      },
    );

    assert.equal(result.status, 1);
    assert.match(result.stdout, /FAIL: GitHub release v2\.15\.0 is not fully published/);
    assert.match(result.stdout, /untagged-example/);
  });
});
