import { afterAll, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const REPO_ROOT = join(import.meta.dirname, '..', '..');
const SOURCE_SCRIPT = join(REPO_ROOT, 'marketing', 'post-twitter.sh');
const SOURCE_BROWSER_DIR = '/Users/shivamtiwari.highlevel/VS Code/1008apps/x-browser';

function writeExecutable(path, content) {
  writeFileSync(path, content);
  chmodSync(path, 0o755);
}

function createFixture() {
  const root = mkdtempSync(join(tmpdir(), 'axc-post-twitter-'));
  const marketingDir = join(root, 'marketing');
  const fakeBrowserDir = join(root, 'fake-x-browser');
  const fakeBinDir = join(fakeBrowserDir, '.venv', 'bin');

  mkdirSync(marketingDir, { recursive: true });
  mkdirSync(fakeBinDir, { recursive: true });

  const patchedScript = readFileSync(SOURCE_SCRIPT, 'utf8')
    .replace(
      `XBROWSER_DIR="${SOURCE_BROWSER_DIR}"`,
      `XBROWSER_DIR="${fakeBrowserDir}"`,
    )
    // Keep fixture runs fast while preserving the fallback control flow.
    .replace(/sleep 5/, 'sleep 0');
  writeExecutable(join(marketingDir, 'post-twitter.sh'), patchedScript);

  writeExecutable(
    join(fakeBinDir, 'x-browser'),
    [
      '#!/usr/bin/env bash',
      'set -euo pipefail',
      '',
      'LOG_FILE="${FAKE_X_LOG_FILE:?}"',
      'printf "%s\\n" "$*" >> "${LOG_FILE}"',
      '',
      'if printf "%s\\n" "$*" | grep -Fq "user timeline"; then',
      '  printf "%s\\n" "${FAKE_X_TIMELINE_JSON:-[]}"',
      '  exit "${FAKE_X_TIMELINE_STATUS:-0}"',
      'fi',
      '',
      'if ! printf "%s\\n" "$*" | grep -Fq "tweet post"; then',
      '  echo "unexpected x-browser args: $*" >&2',
      '  exit 64',
      'fi',
      '',
      'outcome="${FAKE_X_ISOLATED_OUTCOME:-success}"',
      'if printf "%s\\n" "$*" | grep -Fq -- "--system-profile"; then',
      '  outcome="${FAKE_X_SYSTEM_OUTCOME:-success}"',
      'fi',
      '',
      'case "${outcome}" in',
      '  success)',
      '    echo "tweet published"',
      '    exit 0',
      '    ;;',
      '  ambiguous)',
      '    echo "still on compose page after clicking Post" >&2',
      '    exit 17',
      '    ;;',
      '  error)',
      '    echo "x-browser transport failure" >&2',
      '    exit 23',
      '    ;;',
      '  *)',
      '    echo "unknown fake outcome: ${outcome}" >&2',
      '    exit 65',
      '    ;;',
      'esac',
    ].join('\n'),
  );

  return { root, logFile: join(root, 'x-browser.log') };
}

function runTwitterScript(fixture, text, envOverrides = {}) {
  return spawnSync('bash', ['marketing/post-twitter.sh', text], {
    cwd: fixture.root,
    encoding: 'utf8',
    env: {
      ...process.env,
      FAKE_X_LOG_FILE: fixture.logFile,
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

afterAll(() => {
  for (const fixture of fixtures) {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

describe('post-twitter.sh behavior', () => {
  it('AT-XPOST-008A: ambiguous primary submit verifies timeline and does not retry', () => {
    const fixture = createFixture();
    fixtures.push(fixture);

    const result = runTwitterScript(fixture, 'Ship verified tweet', {
      FAKE_X_SYSTEM_OUTCOME: 'ambiguous',
      FAKE_X_ISOLATED_OUTCOME: 'success',
      FAKE_X_TIMELINE_JSON: '[{"text":"Ship verified tweet"}]',
    });

    assert.equal(result.status, 0);
    assert.match(result.stderr, /verifying account timeline before any retry/i);
    assert.match(result.stderr, /treating the attempt as success/i);
    assert.deepEqual(readLogLines(fixture), [
      '--system-profile --min-delay 2 --max-delay 5 tweet post Ship verified tweet',
      '--system-profile --json user timeline agentxchaindev --max 5',
    ]);
  });

  it('AT-XPOST-008B: ambiguous primary submit exits non-zero when timeline verification misses', () => {
    const fixture = createFixture();
    fixtures.push(fixture);

    const result = runTwitterScript(fixture, 'Unverified primary tweet', {
      FAKE_X_SYSTEM_OUTCOME: 'ambiguous',
      FAKE_X_ISOLATED_OUTCOME: 'success',
      FAKE_X_TIMELINE_JSON: '[{"text":"different tweet"}]',
    });

    assert.equal(result.status, 17);
    assert.match(result.stderr, /could not be verified after an ambiguous submit/i);
    assert.deepEqual(readLogLines(fixture), [
      '--system-profile --min-delay 2 --max-delay 5 tweet post Unverified primary tweet',
      '--system-profile --json user timeline agentxchaindev --max 5',
    ]);
  });

  it('AT-XPOST-008C: non-ambiguous primary failure retries once with the opposite profile', () => {
    const fixture = createFixture();
    fixtures.push(fixture);

    const result = runTwitterScript(fixture, 'Fallback success tweet', {
      FAKE_X_SYSTEM_OUTCOME: 'error',
      FAKE_X_ISOLATED_OUTCOME: 'success',
    });

    assert.equal(result.status, 0);
    assert.match(result.stderr, /retrying once with isolated-profile/i);
    assert.deepEqual(readLogLines(fixture), [
      '--system-profile --min-delay 2 --max-delay 5 tweet post Fallback success tweet',
      '--min-delay 2 --max-delay 5 tweet post Fallback success tweet',
    ]);
  });

  it('AT-XPOST-008D: ambiguous fallback submit verifies timeline before succeeding', () => {
    const fixture = createFixture();
    fixtures.push(fixture);

    const result = runTwitterScript(fixture, 'Verified fallback tweet', {
      FAKE_X_SYSTEM_OUTCOME: 'error',
      FAKE_X_ISOLATED_OUTCOME: 'ambiguous',
      FAKE_X_TIMELINE_JSON: '[{"text":"Verified fallback tweet"}]',
    });

    assert.equal(result.status, 0);
    assert.match(result.stderr, /fallback attempt reached an ambiguous submit/i);
    assert.match(result.stderr, /timeline after fallback; treating the attempt as success/i);
    assert.deepEqual(readLogLines(fixture), [
      '--system-profile --min-delay 2 --max-delay 5 tweet post Verified fallback tweet',
      '--min-delay 2 --max-delay 5 tweet post Verified fallback tweet',
      '--json user timeline agentxchaindev --max 5',
    ]);
  });

  it('AT-XPOST-008E: ambiguous fallback submit exits non-zero when timeline verification misses', () => {
    const fixture = createFixture();
    fixtures.push(fixture);

    const result = runTwitterScript(fixture, 'Unverified fallback tweet', {
      FAKE_X_SYSTEM_OUTCOME: 'error',
      FAKE_X_ISOLATED_OUTCOME: 'ambiguous',
      FAKE_X_TIMELINE_JSON: '[{"text":"different tweet"}]',
    });

    assert.equal(result.status, 17);
    assert.match(result.stderr, /fallback attempt could not be verified/i);
    assert.deepEqual(readLogLines(fixture), [
      '--system-profile --min-delay 2 --max-delay 5 tweet post Unverified fallback tweet',
      '--min-delay 2 --max-delay 5 tweet post Unverified fallback tweet',
      '--json user timeline agentxchaindev --max 5',
    ]);
  });
});
