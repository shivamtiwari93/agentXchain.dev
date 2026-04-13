import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const SOURCE_SCRIPT = join(REPO_ROOT, 'cli', 'scripts', 'release-preflight.sh');

function writeExecutable(path, content) {
  writeFileSync(path, content);
  chmodSync(path, 0o755);
}

function createFixture({ version = '0.9.0', changelogVersions = ['2.0.0'] } = {}) {
  const root = join(
    tmpdir(),
    `axc-release-preflight-${randomBytes(6).toString('hex')}`,
  );
  const cliDir = join(root, 'cli');
  const scriptsDir = join(cliDir, 'scripts');
  const fakeBinDir = join(root, 'fake-bin');

  mkdirSync(scriptsDir, { recursive: true });
  mkdirSync(fakeBinDir, { recursive: true });
  cpSync(SOURCE_SCRIPT, join(scriptsDir, 'release-preflight.sh'));

  writeFileSync(
    join(cliDir, 'package.json'),
    JSON.stringify({ name: 'agentxchain', version }, null, 2),
  );
  const changelog = ['# Changelog', '']
    .concat(
      changelogVersions.flatMap((entryVersion) => [`## ${entryVersion}`, '', '- ready', '']),
    )
    .join('\n');
  writeFileSync(join(cliDir, 'CHANGELOG.md'), changelog);
  execFileSync('git', ['init'], { cwd: cliDir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'test'], { cwd: cliDir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], {
    cwd: cliDir,
    stdio: 'ignore',
  });
  execFileSync('git', ['add', '-A'], { cwd: cliDir, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'fixture'], { cwd: cliDir, stdio: 'ignore' });

  writeExecutable(
    join(fakeBinDir, 'npm'),
    [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      '',
      'case "$1" in',
      '  ci)',
      '    if [[ "${FAKE_NPM_CI_FAIL:-0}" == "1" ]]; then',
      '      echo "npm ci failed" >&2',
      '      exit 1',
      '    fi',
      '    echo "npm ci ok"',
      '    exit 0',
      '    ;;',
      '  test)',
      '    if [[ "${FAKE_NPM_TEST_FAIL:-0}" == "1" ]]; then',
      '      echo "# pass 9"',
      '      echo "# fail 1"',
      '      exit 1',
      '    fi',
      '    if [[ "${FAKE_NPM_TEST_FORMAT:-tap}" == "dual-runner" ]]; then',
      '      echo "      Tests  761 passed (761)"',
      '      echo "ℹ tests 2371"',
      '      echo "ℹ fail 0"',
      '      exit 0',
      '    fi',
      '    echo "# pass 9"',
      '    echo "# fail 0"',
      '    exit 0',
      '    ;;',
      '  pack)',
      '    if [[ "${FAKE_NPM_PACK_FAIL:-0}" == "1" ]]; then',
      '      echo "npm pack failed" >&2',
      '      exit 1',
      '    fi',
      '    echo "npm notice total files: 4"',
      '    exit 0',
      '    ;;',
      '  *)',
      '    echo "unexpected npm args: $*" >&2',
      '    exit 2',
      '    ;;',
      'esac',
      '',
    ].join('\n'),
  );

  return { root, cliDir, fakeBinDir };
}

function runPreflight(cliDir, fakeBinDir, args = [], envOverrides = {}) {
  return spawnSync('bash', ['scripts/release-preflight.sh', ...args], {
    cwd: cliDir,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${fakeBinDir}:${process.env.PATH}`,
      ...envOverrides,
    },
  });
}

describe('release-preflight.sh', () => {
  const fixtures = [];

  before(() => {});

  after(() => {
    for (const fixture of fixtures) {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  it('keeps dirty tree and pre-bump version as warnings in default mode', () => {
    const fixture = createFixture({ version: '0.9.0' });
    fixtures.push(fixture);
    writeFileSync(join(fixture.cliDir, 'scratch.txt'), 'dirty\n');

    const result = runPreflight(fixture.cliDir, fixture.fakeBinDir);

    assert.equal(result.status, 0);
    assert.match(result.stdout, /AgentXchain v2\.0\.0 Release Preflight/);
    assert.match(
      result.stdout,
      /Human-gated release items remain in \.planning\/V1_RELEASE_CHECKLIST\.md/,
    );
    assert.match(result.stdout, /Mode: DEFAULT/);
    assert.match(result.stdout, /WARN: Uncommitted or untracked files present/);
    assert.match(
      result.stdout,
      /WARN: package\.json is at 0\.9\.0, not yet bumped to 2\.0\.0/,
    );
    assert.match(result.stdout, /Results: 4 passed, 0 failed, 2 warnings/);
  });

  it('elevates dirty tree and wrong version to failures in strict mode', () => {
    const fixture = createFixture({ version: '0.9.0' });
    fixtures.push(fixture);
    writeFileSync(join(fixture.cliDir, 'scratch.txt'), 'dirty\n');

    const result = runPreflight(fixture.cliDir, fixture.fakeBinDir, ['--strict']);

    assert.equal(result.status, 1);
    assert.match(result.stdout, /Mode: STRICT/);
    assert.match(result.stdout, /FAIL: Working tree is not clean/);
    assert.match(result.stdout, /FAIL: package\.json is at 0\.9\.0, expected 2\.0\.0/);
    assert.match(result.stdout, /Results: 4 passed, 2 failed, 0 warnings/);
  });

  it('passes in strict mode after bump when the tree is clean', () => {
    const fixture = createFixture({ version: '2.0.0' });
    fixtures.push(fixture);

    const result = runPreflight(fixture.cliDir, fixture.fakeBinDir, ['--strict']);

    assert.equal(result.status, 0);
    assert.match(result.stdout, /PASS: Working tree is clean/);
    assert.match(result.stdout, /PASS: package\.json is at 2\.0\.0/);
    assert.match(result.stdout, /Results: 6 passed, 0 failed, 0 warnings/);
  });

  it('continues after npm test failure and still evaluates later checks', () => {
    const fixture = createFixture({ version: '0.9.0' });
    fixtures.push(fixture);

    const result = runPreflight(fixture.cliDir, fixture.fakeBinDir, [], {
      FAKE_NPM_TEST_FAIL: '1',
    });

    assert.equal(result.status, 1);
    assert.match(result.stdout, /\[4\/6\] CHANGELOG/);
    assert.match(result.stdout, /\[5\/6\] Package version/);
    assert.match(result.stdout, /\[6\/6\] npm pack --dry-run/);
    assert.match(result.stdout, /FAIL: npm test failed/);
  });

  it('parameterizes banner, changelog, and package checks with --target-version', () => {
    const fixture = createFixture({
      version: '1.1.0',
      changelogVersions: ['1.1.0'],
    });
    fixtures.push(fixture);

    const result = runPreflight(
      fixture.cliDir,
      fixture.fakeBinDir,
      ['--strict', '--target-version', '1.1.0'],
    );

    assert.equal(result.status, 0);
    assert.match(result.stdout, /AgentXchain v1\.1\.0 Release Preflight/);
    assert.match(
      result.stdout,
      /Human-gated release items remain in \.planning\/V1_RELEASE_CHECKLIST\.md \(v1\.0\) or \.planning\/V1_1_RELEASE_CHECKLIST\.md \(v1\.1\+\)\./,
    );
    assert.match(result.stdout, /PASS: CHANGELOG\.md contains 1\.1\.0 entry/);
    assert.match(result.stdout, /PASS: package\.json is at 1\.1\.0/);
    assert.match(result.stdout, /Results: 6 passed, 0 failed, 0 warnings/);
  });

  it('summarizes dual-runner npm test output without losing the pass count', () => {
    const fixture = createFixture({ version: '2.21.0', changelogVersions: ['2.21.0'] });
    fixtures.push(fixture);

    const result = runPreflight(
      fixture.cliDir,
      fixture.fakeBinDir,
      ['--strict', '--target-version', '2.21.0'],
      { FAKE_NPM_TEST_FORMAT: 'dual-runner' },
    );

    assert.equal(result.status, 0);
    assert.match(result.stdout, /PASS: 3132 tests passed, 0 failures/);
    assert.match(result.stdout, /Results: 6 passed, 0 failed, 0 warnings/);
  });

  it('rejects invalid semver values for --target-version', () => {
    const fixture = createFixture({ version: '0.9.0' });
    fixtures.push(fixture);

    const result = runPreflight(
      fixture.cliDir,
      fixture.fakeBinDir,
      ['--target-version', 'v1.1.0'],
    );

    assert.equal(result.status, 1);
    assert.match(result.stderr, /Invalid semver: v1\.1\.0/);
    assert.match(
      result.stderr,
      /Usage: bash scripts\/release-preflight\.sh \[--strict\] \[--target-version <semver>\]/,
    );
  });

  it('rejects missing --target-version arguments', () => {
    const fixture = createFixture({ version: '0.9.0' });
    fixtures.push(fixture);

    const result = runPreflight(
      fixture.cliDir,
      fixture.fakeBinDir,
      ['--target-version'],
    );

    assert.equal(result.status, 1);
    assert.match(result.stderr, /Error: --target-version requires a semver argument/);
    assert.match(
      result.stderr,
      /Usage: bash scripts\/release-preflight\.sh \[--strict\] \[--target-version <semver>\]/,
    );
  });
});
