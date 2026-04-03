import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const REPO_ROOT = join(process.cwd(), '..');
const SOURCE_SCRIPT = join(REPO_ROOT, 'cli', 'scripts', 'publish-from-tag.sh');

function writeExecutable(path, content) {
  writeFileSync(path, content);
  chmodSync(path, 0o755);
}

function createFixture({ version = '1.0.0' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'axc-publish-tag-'));
  const cliDir = join(root, 'cli');
  const scriptsDir = join(cliDir, 'scripts');
  const fakeBinDir = join(root, 'fake-bin');
  const stateDir = join(root, 'state');

  mkdirSync(scriptsDir, { recursive: true });
  mkdirSync(fakeBinDir, { recursive: true });
  mkdirSync(stateDir, { recursive: true });

  cpSync(SOURCE_SCRIPT, join(scriptsDir, 'publish-from-tag.sh'));
  writeExecutable(
    join(scriptsDir, 'release-preflight.sh'),
    [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      'printf "%s\\n" "$*" > "../state/preflight-args.txt"',
      'if [[ "${FAKE_PREFLIGHT_FAIL:-0}" == "1" ]]; then',
      '  echo "strict preflight failed" >&2',
      '  exit 1',
      'fi',
      'echo "preflight ok"',
      '',
    ].join('\n'),
  );

  writeFileSync(
    join(cliDir, 'package.json'),
    JSON.stringify({ name: 'agentxchain', version }, null, 2),
  );

  writeExecutable(
    join(fakeBinDir, 'npm'),
    [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      'STATE_DIR="${FAKE_STATE_DIR:?}"',
      'VIEW_COUNTER_FILE="${STATE_DIR}/view-count.txt"',
      'PUBLISHED_FILE="${STATE_DIR}/published.txt"',
      'echo "${1} ${2:-} ${3:-} ${4:-}" >> "${STATE_DIR}/npm-calls.log"',
      '',
      'case "$1" in',
      '  publish)',
      '    if [[ -n "${NPM_CONFIG_USERCONFIG:-}" ]]; then',
      '      printf "%s\\n" "${NPM_CONFIG_USERCONFIG}" > "${STATE_DIR}/npm-userconfig-path.txt"',
      '      if [[ -f "${NPM_CONFIG_USERCONFIG}" ]]; then',
      '        cat "${NPM_CONFIG_USERCONFIG}" > "${STATE_DIR}/npm-userconfig.txt"',
      '      fi',
      '    fi',
      '    echo "published" > "${PUBLISHED_FILE}"',
      '    echo "npm publish ok"',
      '    exit 0',
      '    ;;',
      '  view)',
      '    count=0',
      '    if [[ -f "${VIEW_COUNTER_FILE}" ]]; then',
      '      count="$(cat "${VIEW_COUNTER_FILE}")"',
      '    fi',
      '    count=$((count + 1))',
      '    printf "%s" "${count}" > "${VIEW_COUNTER_FILE}"',
      '    if [[ ! -f "${PUBLISHED_FILE}" ]]; then',
      '      exit 1',
      '    fi',
      '    available_after="${FAKE_NPM_VIEW_AVAILABLE_AFTER:-1}"',
      '    if [[ "${count}" -lt "${available_after}" ]]; then',
      '      exit 1',
      '    fi',
      '    version="$(grep -E \'"version"\' package.json | head -1 | sed -E \'s/.*"version": "([^"]+)".*/\\1/\')"',
      '    printf "%s" "${version}"',
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

  execFileSync('git', ['init'], { cwd: cliDir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'test'], { cwd: cliDir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], {
    cwd: cliDir,
    stdio: 'ignore',
  });
  execFileSync('git', ['add', '-A'], { cwd: cliDir, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'fixture'], { cwd: cliDir, stdio: 'ignore' });

  return { root, cliDir, fakeBinDir, stateDir };
}

function runPublish(cliDir, fakeBinDir, stateDir, args = [], envOverrides = {}) {
  return spawnSync('bash', ['scripts/publish-from-tag.sh', ...args], {
    cwd: cliDir,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${fakeBinDir}:${process.env.PATH}`,
      FAKE_STATE_DIR: stateDir,
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

describe('publish-from-tag.sh', () => {
  it('rejects malformed release tags', () => {
    const fixture = createFixture();
    fixtures.push(fixture);

    const result = runPublish(
      fixture.cliDir,
      fixture.fakeBinDir,
      fixture.stateDir,
      ['1.0.0'],
      { NPM_TOKEN: 'token' },
    );

    assert.equal(result.status, 1);
    assert.match(result.stderr, /release tag must match v<semver>/);
  });

  it('rejects package version mismatches before publish', () => {
    const fixture = createFixture({ version: '0.9.0' });
    fixtures.push(fixture);

    const result = runPublish(
      fixture.cliDir,
      fixture.fakeBinDir,
      fixture.stateDir,
      ['v1.0.0'],
      { NPM_TOKEN: 'token' },
    );

    assert.equal(result.status, 1);
    assert.match(result.stderr, /package\.json version is 0\.9\.0, expected 1\.0\.0/);
  });

  it('falls back to trusted publishing (OIDC) when NPM_TOKEN is absent', () => {
    const fixture = createFixture();
    fixtures.push(fixture);

    const result = runPublish(
      fixture.cliDir,
      fixture.fakeBinDir,
      fixture.stateDir,
      ['v1.0.0'],
      // Explicitly unset NPM_TOKEN and NPM_CONFIG_USERCONFIG so the script
      // takes the trusted-publishing path. In CI, setup-node sets
      // NPM_CONFIG_USERCONFIG which would leak into the subprocess and
      // cause the fake npm to record a userconfig path even though the
      // publish script itself didn't create one.
      { NPM_TOKEN: '', NPM_CONFIG_USERCONFIG: '' },
    );

    assert.equal(result.status, 0);
    assert.match(result.stdout, /Publish auth mode: trusted publishing/);
    // No temp npmrc should be created when using OIDC
    assert.ok(
      !existsSync(join(fixture.stateDir, 'npm-userconfig-path.txt')),
      'trusted publishing should not create a temp npmrc',
    );
  });

  it('runs strict preflight, publishes, and verifies registry visibility', () => {
    const fixture = createFixture();
    fixtures.push(fixture);

    const result = runPublish(
      fixture.cliDir,
      fixture.fakeBinDir,
      fixture.stateDir,
      ['v1.0.0'],
      {
        NPM_TOKEN: 'token',
        NPM_VIEW_RETRY_DELAY_SECONDS: '0',
      },
    );

    assert.equal(result.status, 0);
    assert.match(result.stdout, /Running strict release preflight/);
    assert.match(result.stdout, /npm publish ok/);
    assert.match(result.stdout, /Verified agentxchain@1\.0\.0 on npm/);
    assert.equal(
      readFileSync(join(fixture.stateDir, 'preflight-args.txt'), 'utf8').trim(),
      '--strict --target-version 1.0.0',
    );
    const npmCalls = readFileSync(join(fixture.stateDir, 'npm-calls.log'), 'utf8');
    assert.match(npmCalls, /publish --access public/);
    assert.doesNotMatch(npmCalls, /_authToken=/);
    assert.equal(
      readFileSync(join(fixture.stateDir, 'npm-userconfig.txt'), 'utf8').trim(),
      '//registry.npmjs.org/:_authToken=token',
    );
    const userconfigPath = readFileSync(join(fixture.stateDir, 'npm-userconfig-path.txt'), 'utf8').trim();
    assert.equal(userconfigPath.length > 0, true);
    assert.equal(existsSync(userconfigPath), false);
  });

  it('retries npm view until the registry serves the published version', () => {
    const fixture = createFixture();
    fixtures.push(fixture);

    const result = runPublish(
      fixture.cliDir,
      fixture.fakeBinDir,
      fixture.stateDir,
      ['v1.0.0'],
      {
        NPM_TOKEN: 'token',
        FAKE_NPM_VIEW_AVAILABLE_AFTER: '3',
        NPM_VIEW_RETRY_DELAY_SECONDS: '0',
        NPM_VIEW_RETRY_ATTEMPTS: '4',
      },
    );

    assert.equal(result.status, 0);
    assert.match(result.stdout, /Registry not updated yet \(attempt 1\/4\)/);
    assert.match(result.stdout, /Registry not updated yet \(attempt 2\/4\)/);
    assert.match(result.stdout, /Verified agentxchain@1\.0\.0 on npm \(attempt 3\/4\)/);
  });
});
