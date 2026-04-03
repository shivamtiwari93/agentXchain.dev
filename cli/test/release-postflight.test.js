import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const REPO_ROOT = join(process.cwd(), '..');
const SOURCE_SCRIPT = join(REPO_ROOT, 'cli', 'scripts', 'release-postflight.sh');

function writeExecutable(path, content) {
  writeFileSync(path, content);
  chmodSync(path, 0o755);
}

function createFixture({ version = '2.0.1', createTag = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'axc-release-postflight-'));
  const cliDir = join(root, 'cli');
  const scriptsDir = join(cliDir, 'scripts');
  const fakeBinDir = join(root, 'fake-bin');

  mkdirSync(scriptsDir, { recursive: true });
  mkdirSync(fakeBinDir, { recursive: true });
  cpSync(SOURCE_SCRIPT, join(scriptsDir, 'release-postflight.sh'));

  writeFileSync(
    join(cliDir, 'package.json'),
    JSON.stringify({ name: 'agentxchain', version }, null, 2),
  );

  writeExecutable(
    join(fakeBinDir, 'npm'),
    [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      '',
      'if [[ "$1" == "view" ]]; then',
      '  spec="$2"',
      '  field="$3"',
      '  if [[ "${FAKE_REGISTRY_MISSING:-0}" == "1" ]]; then',
      '    echo "E404 Not Found: ${spec}" >&2',
      '    exit 1',
      '  fi',
      '  case "${field}" in',
      '    version)',
      '      printf "%s\\n" "${FAKE_REGISTRY_VERSION:-2.0.1}"',
      '      ;;',
      '    dist.tarball)',
      '      printf "%s\\n" "${FAKE_DIST_TARBALL:-https://registry.npmjs.org/agentxchain/-/agentxchain-2.0.1.tgz}"',
      '      ;;',
      '    dist.integrity)',
      '      printf "%s\\n" "${FAKE_DIST_INTEGRITY:-sha512-test}"',
      '      ;;',
      '    dist.shasum)',
      '      printf "%s\\n" "${FAKE_DIST_SHASUM:-}"',
      '      ;;',
      '    *)',
      '      echo "unexpected npm view field: ${field}" >&2',
      '      exit 2',
      '      ;;',
      '  esac',
      '  exit 0',
      'fi',
      '',
      'if [[ "$1" == "exec" ]]; then',
      '  if [[ "${FAKE_EXEC_FAIL:-0}" == "1" ]]; then',
      '    echo "npm exec failed" >&2',
      '    exit 1',
      '  fi',
      '  printf "%s\\n" "${FAKE_EXEC_VERSION:-2.0.1}"',
      '  exit 0',
      'fi',
      '',
      'echo "unexpected npm args: $*" >&2',
      'exit 2',
      '',
    ].join('\n'),
  );

  execFileSync('git', ['init'], { cwd: cliDir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'test'], { cwd: cliDir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: cliDir, stdio: 'ignore' });
  execFileSync('git', ['add', '-A'], { cwd: cliDir, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'fixture'], { cwd: cliDir, stdio: 'ignore' });
  if (createTag) {
    execFileSync('git', ['tag', 'v2.0.1'], { cwd: cliDir, stdio: 'ignore' });
  }

  return { root, cliDir, fakeBinDir };
}

function runPostflight(cliDir, fakeBinDir, args = [], envOverrides = {}) {
  return spawnSync('bash', ['scripts/release-postflight.sh', ...args], {
    cwd: cliDir,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${fakeBinDir}:${process.env.PATH}`,
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

describe('release-postflight.sh', () => {
  it('requires --target-version', () => {
    const fixture = createFixture();
    fixtures.push(fixture);

    const result = runPostflight(fixture.cliDir, fixture.fakeBinDir);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /--target-version is required/);
    assert.match(
      result.stderr,
      /Usage: bash scripts\/release-postflight\.sh --target-version <semver> \[--tag vX\.Y\.Z\]/,
    );
  });

  it('passes when the tag, registry metadata, and install smoke are all correct', () => {
    const fixture = createFixture();
    fixtures.push(fixture);

    const result = runPostflight(
      fixture.cliDir,
      fixture.fakeBinDir,
      ['--target-version', '2.0.1'],
    );

    assert.equal(result.status, 0);
    assert.match(result.stdout, /PASS: Git tag v2\.0\.1 exists locally/);
    assert.match(result.stdout, /PASS: npm registry serves agentxchain@2\.0\.1/);
    assert.match(result.stdout, /PASS: published CLI executes and reports 2\.0\.1/);
    assert.match(result.stdout, /Tarball: https:\/\/registry\.npmjs\.org\/agentxchain\/-\/agentxchain-2\.0\.1\.tgz/);
    assert.match(result.stdout, /POSTFLIGHT PASSED/);
  });

  it('fails closed when the registry does not yet serve the release', () => {
    const fixture = createFixture();
    fixtures.push(fixture);

    const result = runPostflight(
      fixture.cliDir,
      fixture.fakeBinDir,
      ['--target-version', '2.0.1'],
      { FAKE_REGISTRY_MISSING: '1', FAKE_EXEC_FAIL: '1' },
    );

    assert.equal(result.status, 1);
    assert.match(result.stdout, /\[3\/5\] Registry tarball metadata/);
    assert.match(result.stdout, /\[5\/5\] Install smoke/);
    assert.match(result.stdout, /FAIL: npm registry does not serve agentxchain@2\.0\.1/);
    assert.match(result.stdout, /FAIL: published CLI install smoke failed/);
    assert.match(result.stdout, /POSTFLIGHT FAILED/);
  });

  it('fails when the published CLI reports the wrong version', () => {
    const fixture = createFixture();
    fixtures.push(fixture);

    const result = runPostflight(
      fixture.cliDir,
      fixture.fakeBinDir,
      ['--target-version', '2.0.1'],
      { FAKE_EXEC_VERSION: '2.0.0' },
    );

    assert.equal(result.status, 1);
    assert.match(result.stdout, /FAIL: published CLI reported '2\.0\.0', expected '2\.0\.1'/);
  });
});
