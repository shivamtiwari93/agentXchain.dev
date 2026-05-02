import { afterAll, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const CLI_ROOT = join(import.meta.dirname, '..');
const REPO_ROOT = join(CLI_ROOT, '..');
const SOURCE_SCRIPT = join(CLI_ROOT, 'scripts', 'verify-post-publish.sh');

function writeExecutable(path, content) {
  writeFileSync(path, content);
  chmodSync(path, 0o755);
}

function createFixture({ version = '2.128.0' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'axc-verify-post-publish-'));
  const cliDir = join(root, 'cli');
  const scriptsDir = join(cliDir, 'scripts');
  const homebrewDir = join(cliDir, 'homebrew');
  const fakeBinDir = join(root, 'fake-bin');

  mkdirSync(scriptsDir, { recursive: true });
  mkdirSync(homebrewDir, { recursive: true });
  mkdirSync(fakeBinDir, { recursive: true });

  cpSync(SOURCE_SCRIPT, join(scriptsDir, 'verify-post-publish.sh'));
  writeFileSync(
    join(cliDir, 'package.json'),
    JSON.stringify({ name: 'agentxchain', version, type: 'module', bin: { agentxchain: './bin/agentxchain.js' } }, null, 2) + '\n',
  );
  writeFileSync(
    join(homebrewDir, 'agentxchain.rb'),
    `class Agentxchain < Formula
  url "https://registry.npmjs.org/agentxchain/-/agentxchain-${version}.tgz"
  sha256 "1111111111111111111111111111111111111111111111111111111111111111"
end
`,
  );
  writeFileSync(
    join(homebrewDir, 'README.md'),
    `# Homebrew distribution for AgentXchain

- version: \`${version}\`
- source tarball: \`https://registry.npmjs.org/agentxchain/-/agentxchain-${version}.tgz\`
`,
  );

  writeExecutable(
    join(scriptsDir, 'sync-homebrew.sh'),
    [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      'counter_file="${FAKE_COUNTER_DIR:?}/sync-count.txt"',
      'count=0',
      'if [[ -f "${counter_file}" ]]; then',
      '  count="$(cat "${counter_file}")"',
      'fi',
      'count=$((count + 1))',
      'printf "%s" "${count}" > "${counter_file}"',
      'if [[ "${FAKE_SYNC_FAIL:-0}" == "1" ]]; then',
      '  echo "sync failed" >&2',
      '  exit 1',
      'fi',
      'cat > "${PWD}/homebrew/agentxchain.rb" <<EOF',
      'class Agentxchain < Formula',
      '  url "${FAKE_SYNC_FORMULA_URL:?}"',
      '  sha256 "${FAKE_SYNC_FORMULA_SHA:?}"',
      'end',
      'EOF',
      'cat > "${PWD}/homebrew/README.md" <<EOF',
      '# Homebrew distribution for AgentXchain',
      '',
      '- version: `${FAKE_SYNC_VERSION:-2.128.0}`',
      '- source tarball: `${FAKE_SYNC_FORMULA_URL:?}`',
      'EOF',
    ].join('\n'),
  );

  writeExecutable(
    join(fakeBinDir, 'npm'),
    [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      'if [[ "$1" == "view" ]]; then',
      '  field="$3"',
      '  case "${field}" in',
      '    version)',
      '      if [[ "${FAKE_REGISTRY_MISSING:-0}" == "1" ]]; then',
      '        exit 1',
      '      fi',
      '      printf "%s\\n" "${FAKE_REGISTRY_VERSION:-2.128.0}"',
      '      exit 0',
      '      ;;',
      '    dist.tarball)',
      '      if [[ "${FAKE_DIST_TARBALL_MISSING:-0}" == "1" ]]; then',
      '        printf "\\n"',
      '        exit 0',
      '      fi',
      '      printf "%s\\n" "${FAKE_DIST_TARBALL:?}"',
      '      exit 0',
      '      ;;',
      '    *)',
      '      echo "unexpected npm view field: ${field}" >&2',
      '      exit 2',
      '      ;;',
      '  esac',
      'fi',
      'if [[ "$1" == "test" ]]; then',
      '  counter_file="${FAKE_COUNTER_DIR:?}/npm-test-count.txt"',
      '  count=0',
      '  if [[ -f "${counter_file}" ]]; then',
      '    count="$(cat "${counter_file}")"',
      '  fi',
      '  count=$((count + 1))',
      '  printf "%s" "${count}" > "${counter_file}"',
      '  if [[ "${FAKE_NPM_TEST_FAIL:-0}" == "1" ]]; then',
      '    echo "npm test failed" >&2',
      '    exit 1',
      '  fi',
      '  printf "%s\\n" "npm test ok"',
      '  exit 0',
      'fi',
      'echo "unexpected npm args: $*" >&2',
      'exit 2',
    ].join('\n'),
  );

  writeExecutable(
    join(fakeBinDir, 'npx'),
    [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      'counter_file="${FAKE_COUNTER_DIR:?}/npx-count.txt"',
      'count=0',
      'if [[ -f "${counter_file}" ]]; then',
      '  count="$(cat "${counter_file}")"',
      'fi',
      'count=$((count + 1))',
      'printf "%s" "${count}" > "${counter_file}"',
      'printf "%s\\n" "$*" > "${FAKE_COUNTER_DIR:?}/npx-args.txt"',
      'if [[ "${FAKE_NPX_FAIL:-0}" == "1" ]]; then',
      '  echo "npx smoke failed" >&2',
      '  exit 1',
      'fi',
      'printf "%s\\n" "${FAKE_NPX_VERSION:-2.128.0}"',
    ].join('\n'),
  );

  writeExecutable(
    join(fakeBinDir, 'curl'),
    [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      'url="${@: -1}"',
      'if [[ "$url" == "${FAKE_DIST_TARBALL:?}" ]]; then',
      '  printf "%s" "${FAKE_TARBALL_CONTENT:?}"',
      '  exit 0',
      'fi',
      'echo "unexpected curl url: ${url}" >&2',
      'exit 2',
    ].join('\n'),
  );

  return { root, cliDir, fakeBinDir };
}

function addDogfoodBinAlias(cliDir) {
  const packagePath = join(cliDir, 'package.json');
  const pkg = JSON.parse(readFileSync(packagePath, 'utf8'));
  pkg.bin['agentxchain-dogfood-claude-smoke'] = './scripts/dogfood-claude-smoke.mjs';
  writeFileSync(packagePath, JSON.stringify(pkg, null, 2) + '\n');
}

function runVerify(cliDir, fakeBinDir, envOverrides = {}) {
  return spawnSync('bash', ['scripts/verify-post-publish.sh', '--target-version', '2.128.0'], {
    cwd: cliDir,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${fakeBinDir}:${process.env.PATH}`,
      FAKE_COUNTER_DIR: fakeBinDir,
      ...envOverrides,
    },
  });
}

function counterValue(fakeBinDir, filename) {
  try {
    return readFileSync(join(fakeBinDir, filename), 'utf8');
  } catch {
    return null;
  }
}

const fixtures = [];

afterAll(() => {
  for (const fixture of fixtures) {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

describe('verify-post-publish Homebrew phase contract', () => {
  it('spec and playbook freeze explicit Phase 2 to Phase 3 proof', () => {
    const spec = readFileSync(join(REPO_ROOT, '.planning', 'HOMEBREW_PHASE_VERIFICATION_SPEC.md'), 'utf8');
    const playbook = readFileSync(join(REPO_ROOT, '.planning', 'RELEASE_PLAYBOOK.md'), 'utf8');

    assert.match(spec, /AT-HPV-001/);
    assert.match(spec, /AT-HPV-005/);
    assert.match(spec, /formula URL and SHA/);
    assert.match(spec, /public `npx` path resolves and reports the target version/);
    assert.match(playbook, /formula URL and SHA256 now match the live registry tarball/);
    assert.match(playbook, /rechecks the public `npx --yes -p agentxchain@<semver>` path/);
  });

  it('AT-HPV-001: proves repo-mirror URL and SHA match registry truth before npm test', () => {
    const fixture = createFixture();
    fixtures.push(fixture);

    const tarballUrl = 'https://registry.npmjs.org/agentxchain/-/agentxchain-2.128.0.tgz';
    const tarballContent = 'registry-tarball-v2.128.0';
    const tarballSha = createHash('sha256').update(tarballContent).digest('hex');

    const result = runVerify(fixture.cliDir, fixture.fakeBinDir, {
      FAKE_REGISTRY_VERSION: '2.128.0',
      FAKE_DIST_TARBALL: tarballUrl,
      FAKE_TARBALL_CONTENT: tarballContent,
      FAKE_NPX_VERSION: '2.128.0',
      FAKE_SYNC_VERSION: '2.128.0',
      FAKE_SYNC_FORMULA_URL: tarballUrl,
      FAKE_SYNC_FORMULA_SHA: tarballSha,
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /OK: repo mirror formula URL matches registry tarball/);
    assert.match(result.stdout, /OK: repo mirror formula SHA256 matches registry tarball/);
    assert.match(result.stdout, /OK: public npx path resolves and reports v2\.128\.0/);
    assert.equal(counterValue(fixture.fakeBinDir, 'sync-count.txt'), '1');
    assert.equal(counterValue(fixture.fakeBinDir, 'npx-count.txt'), '1');
    assert.equal(counterValue(fixture.fakeBinDir, 'npm-test-count.txt'), '1');
  });

  it('AT-HPV-002: fails before sync when npm does not yet serve the target version', () => {
    const fixture = createFixture();
    fixtures.push(fixture);

    const result = runVerify(fixture.cliDir, fixture.fakeBinDir, {
      FAKE_REGISTRY_MISSING: '1',
      FAKE_DIST_TARBALL: 'https://registry.npmjs.org/agentxchain/-/agentxchain-2.128.0.tgz',
      FAKE_TARBALL_CONTENT: 'unused',
      FAKE_SYNC_FORMULA_URL: 'https://registry.npmjs.org/agentxchain/-/agentxchain-2.128.0.tgz',
      FAKE_SYNC_FORMULA_SHA: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    });

    assert.equal(result.status, 1);
    assert.match(result.stdout, /FAIL: npm does not serve agentxchain@2\.128\.0/);
    assert.equal(counterValue(fixture.fakeBinDir, 'sync-count.txt'), null);
    assert.equal(counterValue(fixture.fakeBinDir, 'npm-test-count.txt'), null);
  });

  it('AT-HPV-003: fails before npm test when sync leaves the formula URL wrong', () => {
    const fixture = createFixture();
    fixtures.push(fixture);

    const tarballUrl = 'https://registry.npmjs.org/agentxchain/-/agentxchain-2.128.0.tgz';
    const tarballContent = 'registry-tarball-v2.128.0';
    const tarballSha = createHash('sha256').update(tarballContent).digest('hex');

    const result = runVerify(fixture.cliDir, fixture.fakeBinDir, {
      FAKE_REGISTRY_VERSION: '2.128.0',
      FAKE_DIST_TARBALL: tarballUrl,
      FAKE_TARBALL_CONTENT: tarballContent,
      FAKE_SYNC_VERSION: '2.128.0',
      FAKE_SYNC_FORMULA_URL: 'https://registry.npmjs.org/agentxchain/-/agentxchain-2.127.0.tgz',
      FAKE_SYNC_FORMULA_SHA: tarballSha,
    });

    assert.equal(result.status, 1);
    assert.match(result.stdout, /FAIL: repo mirror formula URL does not match registry tarball/);
    assert.equal(counterValue(fixture.fakeBinDir, 'sync-count.txt'), '1');
    assert.equal(counterValue(fixture.fakeBinDir, 'npx-count.txt'), null);
    assert.equal(counterValue(fixture.fakeBinDir, 'npm-test-count.txt'), null);
  });

  it('AT-HPV-004: fails before npm test when sync leaves the formula SHA wrong', () => {
    const fixture = createFixture();
    fixtures.push(fixture);

    const tarballUrl = 'https://registry.npmjs.org/agentxchain/-/agentxchain-2.128.0.tgz';
    const tarballContent = 'registry-tarball-v2.128.0';

    const result = runVerify(fixture.cliDir, fixture.fakeBinDir, {
      FAKE_REGISTRY_VERSION: '2.128.0',
      FAKE_DIST_TARBALL: tarballUrl,
      FAKE_TARBALL_CONTENT: tarballContent,
      FAKE_SYNC_VERSION: '2.128.0',
      FAKE_SYNC_FORMULA_URL: tarballUrl,
      FAKE_SYNC_FORMULA_SHA: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    });

    assert.equal(result.status, 1);
    assert.match(result.stdout, /FAIL: repo mirror formula SHA256 does not match registry tarball/);
    assert.equal(counterValue(fixture.fakeBinDir, 'sync-count.txt'), '1');
    assert.equal(counterValue(fixture.fakeBinDir, 'npx-count.txt'), null);
    assert.equal(counterValue(fixture.fakeBinDir, 'npm-test-count.txt'), null);
  });

  it('AT-HPV-005: fails before npm test when the public npx path reports the wrong version', () => {
    const fixture = createFixture();
    fixtures.push(fixture);

    const tarballUrl = 'https://registry.npmjs.org/agentxchain/-/agentxchain-2.128.0.tgz';
    const tarballContent = 'registry-tarball-v2.128.0';
    const tarballSha = createHash('sha256').update(tarballContent).digest('hex');

    const result = runVerify(fixture.cliDir, fixture.fakeBinDir, {
      FAKE_REGISTRY_VERSION: '2.128.0',
      FAKE_DIST_TARBALL: tarballUrl,
      FAKE_TARBALL_CONTENT: tarballContent,
      FAKE_NPX_VERSION: '2.127.9',
      FAKE_SYNC_VERSION: '2.128.0',
      FAKE_SYNC_FORMULA_URL: tarballUrl,
      FAKE_SYNC_FORMULA_SHA: tarballSha,
    });

    assert.equal(result.status, 1);
    assert.match(result.stdout, /FAIL: public npx path did not report 2\.128\.0/);
    assert.equal(counterValue(fixture.fakeBinDir, 'sync-count.txt'), '1');
    assert.equal(counterValue(fixture.fakeBinDir, 'npx-count.txt'), '1');
    assert.equal(counterValue(fixture.fakeBinDir, 'npm-test-count.txt'), null);
  });

  it('uses the primary package bin when package.json exposes additional helper bins', () => {
    const fixture = createFixture();
    fixtures.push(fixture);
    addDogfoodBinAlias(fixture.cliDir);

    const tarballUrl = 'https://registry.npmjs.org/agentxchain/-/agentxchain-2.128.0.tgz';
    const tarballContent = 'registry-tarball-v2.128.0';
    const tarballSha = createHash('sha256').update(tarballContent).digest('hex');

    const result = runVerify(fixture.cliDir, fixture.fakeBinDir, {
      FAKE_REGISTRY_VERSION: '2.128.0',
      FAKE_DIST_TARBALL: tarballUrl,
      FAKE_TARBALL_CONTENT: tarballContent,
      FAKE_NPX_VERSION: '2.128.0',
      FAKE_SYNC_VERSION: '2.128.0',
      FAKE_SYNC_FORMULA_URL: tarballUrl,
      FAKE_SYNC_FORMULA_SHA: tarballSha,
    });

    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(
      readFileSync(join(fixture.fakeBinDir, 'npx-args.txt'), 'utf8').trim(),
      '--yes -p agentxchain@2.128.0 -c agentxchain --version',
    );
  });
});
