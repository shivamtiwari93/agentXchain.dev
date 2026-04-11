import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cliRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI_BIN = join(cliRoot, 'bin', 'agentxchain.js');
const tempDirs = [];

afterEach(() => {
  while (tempDirs.length) {
    const dir = tempDirs.pop();
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {}
  }
});

function makeLegacyProject() {
  const root = mkdtempSync(join(tmpdir(), 'axc-legacy-doctor-'));
  tempDirs.push(root);

  writeFileSync(
    join(root, 'agentxchain.json'),
    JSON.stringify({
      version: 3,
      project: 'legacy-timeout-test',
      agents: {
        pm: { name: 'Product Manager', mandate: 'Plan' },
        dev: { name: 'Developer', mandate: 'Build' },
      },
    }, null, 2) + '\n',
  );

  return root;
}

function writeFakeOsascript(root, seconds = 5) {
  const binDir = join(root, 'fake-bin');
  mkdirSync(binDir, { recursive: true });
  const scriptPath = join(binDir, 'osascript');
  writeFileSync(
    scriptPath,
    `#!/bin/sh\nsleep ${seconds}\n`,
  );
  chmodSync(scriptPath, 0o755);
  return binDir;
}

describe('legacy doctor accessibility timeout', () => {
  it('AT-LDAT-001 + AT-LDAT-002: timed-out osascript warns and does not hang doctor', () => {
    const root = makeLegacyProject();
    const fakeBin = writeFakeOsascript(root, 5);
    const start = Date.now();
    const result = spawnSync(process.execPath, [CLI_BIN, 'doctor'], {
      cwd: root,
      encoding: 'utf8',
      timeout: 5000,
      env: {
        ...process.env,
        PATH: `${fakeBin}:${process.env.PATH}`,
      },
    });
    const elapsedMs = Date.now() - start;

    assert.equal(result.status, 0, `legacy doctor should complete successfully: ${result.stderr}`);
    assert.ok(elapsedMs < 4000, `doctor should not hang on osascript timeout, elapsed=${elapsedMs}ms`);
    assert.ok(result.stdout.includes('AgentXchain Doctor'), 'legacy doctor heading should render');
    if (process.platform === 'darwin') {
      assert.ok(
        result.stdout.includes('Accessibility probe timed out'),
        `expected timeout warning in output, got:\n${result.stdout}`,
      );
    } else {
      assert.ok(
        result.stdout.includes('only checked on macOS'),
        `expected non-macOS warning in output, got:\n${result.stdout}`,
      );
    }
  });
});
