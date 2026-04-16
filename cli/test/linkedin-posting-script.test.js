import { after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const REPO_ROOT = join(import.meta.dirname, '..', '..');
const SOURCE_SCRIPT = join(REPO_ROOT, 'marketing', 'post-linkedin.sh');
const SOURCE_BROWSER_DIR = '/Users/shivamtiwari.highlevel/VS Code/1008apps/li-browser';

function writeExecutable(path, content) {
  writeFileSync(path, content);
  chmodSync(path, 0o755);
}

function createFixture() {
  const root = mkdtempSync(join(tmpdir(), 'axc-post-linkedin-'));
  const marketingDir = join(root, 'marketing');
  const fakeBrowserDir = join(root, 'fake-li-browser');
  const fakeBinDir = join(fakeBrowserDir, '.venv', 'bin');

  mkdirSync(marketingDir, { recursive: true });
  mkdirSync(fakeBinDir, { recursive: true });

  let patchedScript = readFileSync(SOURCE_SCRIPT, 'utf8')
    .replace(
      `LIBROWSER_DIR="${SOURCE_BROWSER_DIR}"`,
      `LIBROWSER_DIR="${fakeBrowserDir}"`,
    )
    // Eliminate the 5-second sleep between primary and fallback to keep tests fast
    .replace(/sleep 5/, 'sleep 0');
  writeFileSync(join(marketingDir, 'post-linkedin.sh'), patchedScript);
  chmodSync(join(marketingDir, 'post-linkedin.sh'), 0o755);

  // Fake li-browser binary: handles `post create` commands
  writeExecutable(
    join(fakeBinDir, 'li-browser'),
    [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      '',
      'LOG_FILE="${FAKE_LI_LOG_FILE:?}"',
      'printf "%s\\n" "$*" >> "${LOG_FILE}"',
      '',
      'if ! printf "%s\\n" "$*" | grep -Fq "post create"; then',
      '  echo "unexpected li-browser args: $*" >&2',
      '  exit 64',
      'fi',
      '',
      'outcome="${FAKE_LI_ISOLATED_OUTCOME:-success}"',
      'if printf "%s\\n" "$*" | grep -Fq -- "--system-profile"; then',
      '  outcome="${FAKE_LI_SYSTEM_OUTCOME:-success}"',
      'fi',
      '',
      'case "${outcome}" in',
      '  success)',
      '    echo "post published"',
      '    exit 0',
      '    ;;',
      '  ambiguous)',
      '    echo "composer remained open after clicking the submit control" >&2',
      '    exit 17',
      '    ;;',
      '  error)',
      '    echo "li-browser transport failure" >&2',
      '    exit 23',
      '    ;;',
      '  *)',
      '    echo "unknown fake outcome: ${outcome}" >&2',
      '    exit 65',
      '    ;;',
      'esac',
    ].join('\n'),
  );

  // Fake python binary: handles verify_linkedin_post_visible inline Python calls
  // The real script calls: "${LIBROWSER_PYTHON}" - "$use_system_profile" "$COMPANY_ID" "$snippet" <<'PY'
  // Args: $1="-", $2=use_system_profile, $3=company_id, $4=snippet
  writeExecutable(
    join(fakeBinDir, 'python'),
    [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      '',
      '# Discard the here-doc Python source from stdin',
      'cat > /dev/null',
      '',
      'LOG_FILE="${FAKE_LI_LOG_FILE:?}"',
      'printf "python-verify %s %s %s\\n" "$2" "$3" "$4" >> "${LOG_FILE}"',
      '',
      'if [ "${FAKE_LI_VERIFY_RESULT:-not-found}" = "found" ]; then',
      '  echo "linkedin-verify:found" >&2',
      '  exit 0',
      'fi',
      '',
      'echo "linkedin-verify:not-found" >&2',
      'exit 1',
    ].join('\n'),
  );

  return { root, logFile: join(root, 'li-browser.log') };
}

function runLinkedInScript(fixture, text, envOverrides = {}) {
  return spawnSync('bash', ['marketing/post-linkedin.sh', text], {
    cwd: fixture.root,
    encoding: 'utf8',
    env: {
      ...process.env,
      FAKE_LI_LOG_FILE: fixture.logFile,
      // Default to isolated profile (USE_SYSTEM_PROFILE=0), matching production default
      AGENTXCHAIN_LINKEDIN_USE_SYSTEM_PROFILE: '0',
      ...envOverrides,
    },
  });
}

function readLogLines(fixture) {
  return readFileSync(fixture.logFile, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

const fixtures = [];

after(() => {
  for (const fixture of fixtures) {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

describe('post-linkedin.sh behavior', () => {
  it('AT-LIPOST-001: clean primary success exits 0 without verification', () => {
    const fixture = createFixture();
    fixtures.push(fixture);

    const result = runLinkedInScript(fixture, 'Clean success post', {
      FAKE_LI_ISOLATED_OUTCOME: 'success',
    });

    assert.equal(result.status, 0);
    assert.deepEqual(readLogLines(fixture), [
      '--min-delay 2 --max-delay 5 post create Clean success post --company-id 112883208',
    ]);
  });

  it('AT-LIPOST-002: ambiguous primary submit verifies feed and succeeds when found', () => {
    const fixture = createFixture();
    fixtures.push(fixture);

    const result = runLinkedInScript(fixture, 'Verified primary post', {
      FAKE_LI_ISOLATED_OUTCOME: 'ambiguous',
      FAKE_LI_VERIFY_RESULT: 'found',
    });

    assert.equal(result.status, 0);
    assert.match(result.stderr, /ambiguous; verifying company feed before any retry/i);
    assert.match(result.stderr, /verified on the company admin feed; treating the attempt as success/i);
    const logs = readLogLines(fixture);
    assert.equal(logs.length, 2);
    assert.equal(logs[0], '--min-delay 2 --max-delay 5 post create Verified primary post --company-id 112883208');
    assert.match(logs[1], /^python-verify 0 112883208 /);
  });

  it('AT-LIPOST-003: ambiguous primary submit exits non-zero when feed verification misses', () => {
    const fixture = createFixture();
    fixtures.push(fixture);

    const result = runLinkedInScript(fixture, 'Unverified primary post', {
      FAKE_LI_ISOLATED_OUTCOME: 'ambiguous',
      FAKE_LI_VERIFY_RESULT: 'not-found',
    });

    assert.equal(result.status, 17);
    assert.match(result.stderr, /could not be verified after an ambiguous submit/i);
    assert.match(result.stderr, /suppressing automatic retry to avoid duplicate posts/i);
    const logs = readLogLines(fixture);
    assert.equal(logs.length, 2);
    assert.equal(logs[0], '--min-delay 2 --max-delay 5 post create Unverified primary post --company-id 112883208');
    assert.match(logs[1], /^python-verify 0 112883208 /);
  });

  it('AT-LIPOST-004: non-ambiguous primary failure retries once with opposite profile', () => {
    const fixture = createFixture();
    fixtures.push(fixture);

    const result = runLinkedInScript(fixture, 'Fallback success post', {
      FAKE_LI_ISOLATED_OUTCOME: 'error',
      FAKE_LI_SYSTEM_OUTCOME: 'success',
    });

    assert.equal(result.status, 0);
    assert.match(result.stderr, /retrying once with system-profile/i);
    assert.deepEqual(readLogLines(fixture), [
      '--min-delay 2 --max-delay 5 post create Fallback success post --company-id 112883208',
      '--system-profile --min-delay 2 --max-delay 5 post create Fallback success post --company-id 112883208',
    ]);
  });

  it('AT-LIPOST-005: ambiguous fallback submit verifies feed before succeeding', () => {
    const fixture = createFixture();
    fixtures.push(fixture);

    const result = runLinkedInScript(fixture, 'Verified fallback post', {
      FAKE_LI_ISOLATED_OUTCOME: 'error',
      FAKE_LI_SYSTEM_OUTCOME: 'ambiguous',
      FAKE_LI_VERIFY_RESULT: 'found',
    });

    assert.equal(result.status, 0);
    assert.match(result.stderr, /fallback attempt reached an ambiguous submit/i);
    assert.match(result.stderr, /verified on the company admin feed after fallback; treating the attempt as success/i);
    const logs = readLogLines(fixture);
    assert.equal(logs.length, 3);
    assert.equal(logs[0], '--min-delay 2 --max-delay 5 post create Verified fallback post --company-id 112883208');
    assert.equal(logs[1], '--system-profile --min-delay 2 --max-delay 5 post create Verified fallback post --company-id 112883208');
    assert.match(logs[2], /^python-verify 1 112883208 /);
  });

  it('AT-LIPOST-006: ambiguous fallback submit exits non-zero when feed verification misses', () => {
    const fixture = createFixture();
    fixtures.push(fixture);

    const result = runLinkedInScript(fixture, 'Unverified fallback post', {
      FAKE_LI_ISOLATED_OUTCOME: 'error',
      FAKE_LI_SYSTEM_OUTCOME: 'ambiguous',
      FAKE_LI_VERIFY_RESULT: 'not-found',
    });

    assert.equal(result.status, 17);
    assert.match(result.stderr, /fallback attempt could not be verified/i);
    const logs = readLogLines(fixture);
    assert.equal(logs.length, 3);
    assert.equal(logs[0], '--min-delay 2 --max-delay 5 post create Unverified fallback post --company-id 112883208');
    assert.equal(logs[1], '--system-profile --min-delay 2 --max-delay 5 post create Unverified fallback post --company-id 112883208');
    assert.match(logs[2], /^python-verify 1 112883208 /);
  });

  it('AT-LIPOST-007: profile fallback disabled prevents retry on non-ambiguous failure', () => {
    const fixture = createFixture();
    fixtures.push(fixture);

    const result = runLinkedInScript(fixture, 'No fallback post', {
      FAKE_LI_ISOLATED_OUTCOME: 'error',
      AGENTXCHAIN_LINKEDIN_DISABLE_PROFILE_FALLBACK: '1',
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /profile fallback disabled/i);
    assert.deepEqual(readLogLines(fixture), [
      '--min-delay 2 --max-delay 5 post create No fallback post --company-id 112883208',
    ]);
  });

  it('AT-LIPOST-008: system-profile primary uses --system-profile flag and isolated fallback', () => {
    const fixture = createFixture();
    fixtures.push(fixture);

    const result = runLinkedInScript(fixture, 'System primary post', {
      AGENTXCHAIN_LINKEDIN_USE_SYSTEM_PROFILE: '1',
      FAKE_LI_SYSTEM_OUTCOME: 'error',
      FAKE_LI_ISOLATED_OUTCOME: 'success',
    });

    assert.equal(result.status, 0);
    assert.deepEqual(readLogLines(fixture), [
      '--system-profile --min-delay 2 --max-delay 5 post create System primary post --company-id 112883208',
      '--min-delay 2 --max-delay 5 post create System primary post --company-id 112883208',
    ]);
  });
});
