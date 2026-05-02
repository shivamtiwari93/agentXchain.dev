import { afterAll, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const CLI_ROOT = join(import.meta.dirname, '..');
const SOURCE_SCRIPT = join(CLI_ROOT, 'scripts', 'release-postflight.sh');

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
    JSON.stringify(
      {
        name: 'agentxchain',
        version,
        type: 'module',
        bin: {
          agentxchain: './bin/agentxchain.js',
        },
      },
      null,
      2,
    ),
  );

  mkdirSync(join(cliDir, 'src', 'lib'), { recursive: true });
  writeFileSync(
    join(cliDir, 'src', 'lib', 'runner-interface.js'),
    [
      "export const RUNNER_INTERFACE_VERSION = '0.2';",
      'export function loadContext() { return null; }',
    ].join('\n'),
  );
  writeFileSync(
    join(cliDir, 'src', 'lib', 'adapter-interface.js'),
    [
      "export const ADAPTER_INTERFACE_VERSION = '0.1';",
      'export async function dispatchLocalCli() { return { ok: true }; }',
    ].join('\n'),
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
      '  counter_file="${FAKE_COUNTER_DIR:?}/$(echo "${field}" | tr ".:" "__")-count.txt"',
      '  if [[ "${FAKE_REGISTRY_MISSING:-0}" == "1" ]]; then',
      '    echo "E404 Not Found: ${spec}" >&2',
      '    exit 1',
      '  fi',
      '  count=0',
      '  if [[ -f "${counter_file}" ]]; then',
      '    count="$(cat "${counter_file}")"',
      '  fi',
      '  count=$((count + 1))',
      '  printf "%s" "${count}" > "${counter_file}"',
      '  case "${field}" in',
      '    version)',
      '      if [[ "${count}" -lt "${FAKE_VERSION_AVAILABLE_AFTER:-1}" ]]; then',
      '        echo "E404 Not Found: ${spec}" >&2',
      '        exit 1',
      '      fi',
      '      printf "%s\\n" "${FAKE_REGISTRY_VERSION:-2.0.1}"',
      '      ;;',
      '    dist.tarball)',
      '      if [[ "${count}" -lt "${FAKE_TARBALL_AVAILABLE_AFTER:-1}" ]]; then',
      '        printf "\\n"',
      '        exit 0',
      '      fi',
      '      printf "%s\\n" "${FAKE_DIST_TARBALL:-https://registry.npmjs.org/agentxchain/-/agentxchain-2.0.1.tgz}"',
      '      ;;',
      '    dist.integrity)',
      '      if [[ "${count}" -lt "${FAKE_CHECKSUM_AVAILABLE_AFTER:-1}" ]]; then',
      '        printf "\\n"',
      '        exit 0',
      '      fi',
      '      printf "%s\\n" "${FAKE_DIST_INTEGRITY:-sha512-test}"',
      '      ;;',
      '    dist.shasum)',
      '      if [[ "${count}" -lt "${FAKE_CHECKSUM_AVAILABLE_AFTER:-1}" ]]; then',
      '        printf "\\n"',
      '        exit 0',
      '      fi',
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
      'if [[ "$1" == "install" ]]; then',
      '  install_counter_file="${FAKE_COUNTER_DIR:?}/install-count.txt"',
      '  install_count=0',
      '  if [[ -f "${install_counter_file}" ]]; then',
      '    install_count="$(cat "${install_counter_file}")"',
      '  fi',
      '  install_count=$((install_count + 1))',
      '  printf "%s" "${install_count}" > "${install_counter_file}"',
      '  if [[ "${install_count}" -lt "${FAKE_INSTALL_AVAILABLE_AFTER:-1}" ]]; then',
      '    echo "npm install failed" >&2',
      '    exit 1',
      '  fi',
      '  if [[ "${FAKE_INSTALL_FAIL:-0}" == "1" ]]; then',
      '    echo "npm install failed" >&2',
      '    exit 1',
      '  fi',
      '  prefix=""',
      '  while [[ $# -gt 0 ]]; do',
      '    if [[ "$1" == "--prefix" ]]; then',
      '      prefix="$2"',
      '      shift 2',
      '      continue',
      '    fi',
      '    shift',
      '  done',
      '  if [[ -z "${prefix}" ]]; then',
      '    mkdir -p "node_modules/agentxchain/src/lib"',
      '    cat > "node_modules/agentxchain/package.json" <<EOF',
      '{',
      '  "name": "agentxchain",',
      '  "type": "module",',
      '  "exports": {',
      '    "./adapter-interface": "./src/lib/adapter-interface.js",',
      '    "./runner-interface": "./src/lib/runner-interface.js",',
      '    "./run-loop": "./src/lib/run-loop.js"',
      '  }',
      '}',
      'EOF',
      '    cat > "node_modules/agentxchain/src/lib/adapter-interface.js" <<EOF',
      "export const ADAPTER_INTERFACE_VERSION = '${FAKE_ADAPTER_INTERFACE_VERSION:-0.1}';",
      'export async function dispatchLocalCli() { return { ok: true }; }',
      'EOF',
      '    cat > "node_modules/agentxchain/src/lib/runner-interface.js" <<EOF',
      "export const RUNNER_INTERFACE_VERSION = '${FAKE_RUNNER_INTERFACE_VERSION:-0.2}';",
      'export function loadContext() { return null; }',
      'EOF',
      '    cat > "node_modules/agentxchain/src/lib/run-loop.js" <<EOF',
      'export async function runLoop() { return { stopReason: "completed" }; }',
      'EOF',
      '    exit 0',
      '  fi',
      '  mkdir -p "${prefix}/bin"',
      '  cat > "${prefix}/bin/agentxchain" <<\'EOF\'',
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      'printf "%s\\n" "$*" >> "${FAKE_COUNTER_DIR:?}/installed-bin-args.txt"',
      'case "${1:-}" in',
      '  --version)',
      '    printf "%s\\n" "${FAKE_INSTALL_VERSION:-2.0.1}"',
      '    ;;',
      '  init)',
      '    target_dir=""',
      '    shift',
      '    while [[ $# -gt 0 ]]; do',
      '      if [[ "$1" == "--dir" ]]; then',
      '        target_dir="$2"',
      '        shift 2',
      '        continue',
      '      fi',
      '      shift',
      '    done',
      '    if [[ -z "${target_dir}" ]]; then',
      '      echo "missing --dir" >&2',
      '      exit 1',
      '    fi',
      '    mkdir -p "${target_dir}/.planning"',
      '    cat > "${target_dir}/agentxchain.json" <<JSON',
      '{ "version": 4, "protocol_mode": "governed" }',
      'JSON',
      '    printf "Initialized governed scaffold\\n"',
      '    ;;',
      '  validate)',
      '    printf "%s\\n" "${FAKE_VALIDATE_JSON:-{\\"ok\\":true,\\"mode\\":\\"kickoff\\",\\"errors\\":[],\\"warnings\\":[],\\"protocol_mode\\":\\"governed\\",\\"version\\":4}}"',
      '    ;;',
      '  *)',
      '    echo "unexpected installed binary args: $*" >&2',
      '    exit 1',
      '    ;;',
      'esac',
      'EOF',
      '  chmod 755 "${prefix}/bin/agentxchain"',
      '  exit 0',
      'fi',
      '',
      'echo "unexpected npm args: $*" >&2',
      'exit 2',
      '',
    ].join('\n'),
  );

  writeExecutable(
    join(fakeBinDir, 'npx'),
    [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      '',
      'counter_file="${FAKE_COUNTER_DIR:?}/npx-count.txt"',
      'count=0',
      'if [[ -f "${counter_file}" ]]; then',
      '  count="$(cat "${counter_file}")"',
      'fi',
      'count=$((count + 1))',
      'printf "%s" "${count}" > "${counter_file}"',
      'printf "%s\\n" "$*" > "${FAKE_COUNTER_DIR:?}/npx-args.txt"',
      '',
      'if [[ "${count}" -lt "${FAKE_NPX_AVAILABLE_AFTER:-1}" ]]; then',
      '  echo "npx resolution failed" >&2',
      '  exit 1',
      'fi',
      '',
      'if [[ "${FAKE_NPX_FAIL:-0}" == "1" ]]; then',
      '  echo "npx resolution failed" >&2',
      '  exit 1',
      'fi',
      '',
      'if [[ -n "${FAKE_NPX_OUTPUT:-}" ]]; then',
      '  printf "%b" "${FAKE_NPX_OUTPUT}"',
      '  exit 0',
      'fi',
      '',
      'printf "%s\\n" "${FAKE_NPX_VERSION:-2.0.1}"',
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

function addDogfoodBinAlias(cliDir) {
  const packagePath = join(cliDir, 'package.json');
  const pkg = JSON.parse(readFileSync(packagePath, 'utf8'));
  pkg.bin['agentxchain-dogfood-claude-smoke'] = './scripts/dogfood-claude-smoke.mjs';
  writeFileSync(packagePath, JSON.stringify(pkg, null, 2));
}

function runPostflight(cliDir, fakeBinDir, args = [], envOverrides = {}) {
  return spawnSync('bash', ['scripts/release-postflight.sh', ...args], {
    cwd: cliDir,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${fakeBinDir}:${process.env.PATH}`,
      FAKE_COUNTER_DIR: fakeBinDir,
      RELEASE_POSTFLIGHT_RETRY_ATTEMPTS: '1',
      RELEASE_POSTFLIGHT_RETRY_DELAY_SECONDS: '0',
      ...envOverrides,
    },
  });
}

const fixtures = [];

afterAll(() => {
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
    assert.match(result.stdout, /PASS: published npx command resolves and reports 2\.0\.1/);
    assert.match(result.stdout, /PASS: published CLI executes and reports 2\.0\.1/);
    assert.match(result.stdout, /PASS: published runner exports import with interface 0\.2/);
    assert.match(result.stdout, /PASS: published adapter exports import with interface 0\.1/);
    assert.match(result.stdout, /PASS: published CLI scaffolds and validates a governed workspace/);
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
      { FAKE_REGISTRY_MISSING: '1', FAKE_NPX_FAIL: '1', FAKE_INSTALL_FAIL: '1' },
    );

    assert.equal(result.status, 1);
    assert.match(result.stdout, /\[3\/8\] Registry tarball metadata/);
    assert.match(result.stdout, /\[5\/8\] npx smoke/);
    assert.match(result.stdout, /\[6\/8\] Install smoke/);
    assert.match(result.stdout, /\[7\/8\] Package export smoke/);
    assert.match(result.stdout, /\[8\/8\] Operator front-door smoke/);
    assert.match(result.stdout, /FAIL: npm registry does not serve agentxchain@2\.0\.1/);
    assert.match(result.stdout, /FAIL: published npx smoke failed/);
    assert.match(result.stdout, /FAIL: published CLI install smoke failed/);
    assert.match(result.stdout, /FAIL: published runner\/adapter exports install smoke failed/);
    assert.match(result.stdout, /FAIL: published operator front-door smoke failed/);
    assert.match(result.stdout, /POSTFLIGHT FAILED/);
  });

  it('fails when the published npx command reports the wrong version', () => {
    const fixture = createFixture();
    fixtures.push(fixture);

    const result = runPostflight(
      fixture.cliDir,
      fixture.fakeBinDir,
      ['--target-version', '2.0.1'],
      { FAKE_NPX_VERSION: '2.0.0' },
    );

    assert.equal(result.status, 1);
    assert.match(result.stdout, /FAIL: published npx command reported '2\.0\.0', expected '2\.0\.1'/);
  });

  it('passes when npx emits npm notices around the correct version line', () => {
    const fixture = createFixture();
    fixtures.push(fixture);

    const result = runPostflight(
      fixture.cliDir,
      fixture.fakeBinDir,
      ['--target-version', '2.0.1'],
      {
        FAKE_NPX_OUTPUT: '2.0.1\\nnpm notice New major version of npm available!\\n',
      },
    );

    assert.equal(result.status, 0);
    assert.match(result.stdout, /PASS: published npx command resolves and reports 2\.0\.1/);
  });

  it('uses the explicit npx package invocation instead of the ambiguous shorthand form', () => {
    const fixture = createFixture();
    fixtures.push(fixture);

    const result = runPostflight(
      fixture.cliDir,
      fixture.fakeBinDir,
      ['--target-version', '2.0.1'],
    );

    assert.equal(result.status, 0);
    const npxArgs = readFileSync(join(fixture.fakeBinDir, 'npx-args.txt'), 'utf8').trim();
    assert.equal(npxArgs, '--yes -p agentxchain@2.0.1 -c agentxchain --version');
  });

  it('uses the primary package bin when package.json exposes additional helper bins', () => {
    const fixture = createFixture();
    fixtures.push(fixture);
    addDogfoodBinAlias(fixture.cliDir);

    const result = runPostflight(
      fixture.cliDir,
      fixture.fakeBinDir,
      ['--target-version', '2.0.1'],
    );

    assert.equal(result.status, 0);
    const npxArgs = readFileSync(join(fixture.fakeBinDir, 'npx-args.txt'), 'utf8').trim();
    const installedArgs = readFileSync(join(fixture.fakeBinDir, 'installed-bin-args.txt'), 'utf8');
    assert.equal(npxArgs, '--yes -p agentxchain@2.0.1 -c agentxchain --version');
    assert.match(installedArgs, /--version/);
  });

  it('fails when the published CLI reports the wrong version', () => {
    const fixture = createFixture();
    fixtures.push(fixture);

    const result = runPostflight(
      fixture.cliDir,
      fixture.fakeBinDir,
      ['--target-version', '2.0.1'],
      { FAKE_INSTALL_VERSION: '2.0.0' },
    );

    assert.equal(result.status, 1);
    assert.match(result.stdout, /FAIL: published CLI reported '2\.0\.0', expected '2\.0\.1'/);
  });

  it('fails when the published runner exports report the wrong interface version', () => {
    const fixture = createFixture();
    fixtures.push(fixture);

    const result = runPostflight(
      fixture.cliDir,
      fixture.fakeBinDir,
      ['--target-version', '2.0.1'],
      { FAKE_RUNNER_INTERFACE_VERSION: '0.1' },
    );

    assert.equal(result.status, 1);
    assert.match(
      result.stdout,
      /FAIL: published runner exports reported interface '0\.1', expected '0\.2'/,
    );
  });

  it('fails when the published adapter exports report the wrong interface version', () => {
    const fixture = createFixture();
    fixtures.push(fixture);

    const result = runPostflight(
      fixture.cliDir,
      fixture.fakeBinDir,
      ['--target-version', '2.0.1'],
      { FAKE_ADAPTER_INTERFACE_VERSION: '0.0' },
    );

    assert.equal(result.status, 1);
    assert.match(
      result.stdout,
      /FAIL: published adapter exports reported interface '0\.0', expected '0\.1'/,
    );
  });

  it('retries registry metadata and install smoke until the published artifact is ready', () => {
    const fixture = createFixture();
    fixtures.push(fixture);

    const result = runPostflight(
      fixture.cliDir,
      fixture.fakeBinDir,
      ['--target-version', '2.0.1'],
      {
        FAKE_VERSION_AVAILABLE_AFTER: '2',
        FAKE_TARBALL_AVAILABLE_AFTER: '2',
        FAKE_CHECKSUM_AVAILABLE_AFTER: '2',
        FAKE_NPX_AVAILABLE_AFTER: '2',
        FAKE_INSTALL_AVAILABLE_AFTER: '2',
        RELEASE_POSTFLIGHT_RETRY_ATTEMPTS: '3',
        RELEASE_POSTFLIGHT_RETRY_DELAY_SECONDS: '0',
      },
    );

    assert.equal(result.status, 0);
    assert.match(result.stdout, /INFO: registry version not ready \(attempt 1\/3\)/);
    assert.match(result.stdout, /INFO: registry tarball metadata not ready \(attempt 1\/3\)/);
    assert.match(result.stdout, /INFO: registry checksum metadata not ready \(attempt 1\/3\)/);
    assert.match(result.stdout, /INFO: npx smoke not ready \(attempt 1\/3\)/);
    assert.match(result.stdout, /INFO: install smoke not ready \(attempt 1\/3\)/);
    assert.match(result.stdout, /PASS: published npx command resolves and reports 2\.0\.1/);
    assert.match(result.stdout, /PASS: published CLI executes and reports 2\.0\.1/);
  });

  it('ignores an older ambient agentxchain binary on PATH during npx and install smoke', () => {
    const fixture = createFixture();
    fixtures.push(fixture);

    writeExecutable(
      join(fixture.fakeBinDir, 'agentxchain'),
      ['#!/usr/bin/env bash', 'printf "%s\\n" "0.8.7"'].join('\n'),
    );

    const result = runPostflight(
      fixture.cliDir,
      fixture.fakeBinDir,
      ['--target-version', '2.0.1'],
    );

    assert.equal(result.status, 0);
    assert.match(result.stdout, /PASS: published npx command resolves and reports 2\.0\.1/);
    assert.match(result.stdout, /PASS: published CLI executes and reports 2\.0\.1/);
    assert.doesNotMatch(result.stdout, /0\.8\.7/);
  });

  it('runs init and kickoff validation from the installed published binary', () => {
    const fixture = createFixture();
    fixtures.push(fixture);

    const result = runPostflight(
      fixture.cliDir,
      fixture.fakeBinDir,
      ['--target-version', '2.0.1'],
    );

    assert.equal(result.status, 0);
    const installedArgs = readFileSync(join(fixture.fakeBinDir, 'installed-bin-args.txt'), 'utf8');
    assert.match(installedArgs, /--version/);
    assert.match(installedArgs, /init --governed --template cli-tool --goal Release operator smoke --dir .* -y/);
    assert.match(installedArgs, /validate --mode kickoff --json/);
  });

  it('fails when the installed CLI cannot validate a fresh governed scaffold', () => {
    const fixture = createFixture();
    fixtures.push(fixture);

    const result = runPostflight(
      fixture.cliDir,
      fixture.fakeBinDir,
      ['--target-version', '2.0.1'],
      {
        FAKE_VALIDATE_JSON: '{"ok":false,"mode":"kickoff","errors":["kickoff failed"],"warnings":[],"protocol_mode":"governed","version":4}',
      },
    );

    assert.equal(result.status, 1);
    assert.match(result.stdout, /FAIL: published operator front-door smoke did not validate a governed workspace/);
  });
});
