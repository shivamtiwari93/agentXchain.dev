import { strict as assert } from 'node:assert';
import { afterEach, describe, it } from 'node:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(__dirname, '..', 'bin', 'agentxchain.js');

/** Read the CLI's own version for assertions. */
const cliPkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8'));
const CLI_VERSION = cliPkg.version;

const tempDirs = new Set();

/**
 * Create a temp directory with a stub `npm` script that returns controlled output.
 * The stub is placed on PATH ahead of the real npm so the update command
 * talks to our fake instead of the real registry.
 */
function createStubNpmDir(opts = {}) {
  const dir = join(tmpdir(), `agentxchain-update-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const binDir = join(dir, 'bin');
  mkdirSync(binDir, { recursive: true });
  tempDirs.add(dir);

  // Build stub npm script
  let script = '#!/usr/bin/env node\n';
  script += 'const args = process.argv.slice(2).join(" ");\n';

  if (opts.viewFails) {
    // npm view should fail
    script += 'if (args.includes("view")) { process.stderr.write("npm ERR! 404 Not Found"); process.exit(1); }\n';
  } else if (opts.latestVersion) {
    // npm view returns a specific version
    script += `if (args.includes("view")) { process.stdout.write("${opts.latestVersion}\\n"); process.exit(0); }\n`;
  } else {
    // npm view returns the current version (already up to date)
    script += `if (args.includes("view")) { process.stdout.write("${CLI_VERSION}\\n"); process.exit(0); }\n`;
  }

  if (opts.installFails) {
    script += 'if (args.includes("install")) { process.stderr.write("npm ERR! EACCES permission denied"); process.exit(1); }\n';
  } else {
    script += 'if (args.includes("install")) { process.exit(0); }\n';
  }

  // Default: pass through
  script += 'process.exit(0);\n';

  const stubPath = join(binDir, 'npm');
  writeFileSync(stubPath, script);
  chmodSync(stubPath, 0o755);

  return { dir, binDir };
}

function runUpdate(extraEnv = {}) {
  const result = spawnSync(process.execPath, [CLI_BIN, 'update'], {
    encoding: 'utf8',
    timeout: 15000,
    env: { ...process.env, ...extraEnv, FORCE_COLOR: '0' },
    // Run from tmpdir so no project context interferes
    cwd: tmpdir(),
  });
  return {
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    status: result.status,
    combined: (result.stdout || '') + (result.stderr || ''),
  };
}

afterEach(() => {
  for (const d of tempDirs) {
    try { rmSync(d, { recursive: true, force: true }); } catch {}
  }
  tempDirs.clear();
});

describe('agentxchain update', () => {
  it('AT-UPDATE-001: output includes the current CLI version', () => {
    const { dir, binDir } = createStubNpmDir();
    tempDirs.add(dir);
    const { combined } = runUpdate({ PATH: `${binDir}:${process.env.PATH}` });
    assert.ok(
      combined.includes(CLI_VERSION),
      `Expected output to include current version "${CLI_VERSION}" but got:\n${combined}`
    );
  });

  it('AT-UPDATE-002: already on latest prints up-to-date message', () => {
    const { dir, binDir } = createStubNpmDir({ latestVersion: CLI_VERSION });
    tempDirs.add(dir);
    const { combined } = runUpdate({ PATH: `${binDir}:${process.env.PATH}` });
    assert.ok(
      combined.includes('Already on the latest version'),
      `Expected "Already on the latest version" but got:\n${combined}`
    );
  });

  it('AT-UPDATE-003: newer version available prints the latest version and attempts update', () => {
    const newerVersion = '99.99.99';
    const { dir, binDir } = createStubNpmDir({ latestVersion: newerVersion });
    tempDirs.add(dir);
    const { combined } = runUpdate({ PATH: `${binDir}:${process.env.PATH}` });
    assert.ok(
      combined.includes(newerVersion),
      `Expected output to include newer version "${newerVersion}" but got:\n${combined}`
    );
    assert.ok(
      combined.includes('Updating') || combined.includes('Updated'),
      `Expected "Updating" or "Updated" message but got:\n${combined}`
    );
  });

  it('AT-UPDATE-004: npm view failure shows fallback install guidance', () => {
    const { dir, binDir } = createStubNpmDir({ viewFails: true });
    tempDirs.add(dir);
    const { combined } = runUpdate({ PATH: `${binDir}:${process.env.PATH}` });
    assert.ok(
      combined.includes('npm install -g agentxchain@latest'),
      `Expected fallback guidance but got:\n${combined}`
    );
  });

  it('AT-UPDATE-005: npm install failure shows permission fix guidance', () => {
    const newerVersion = '99.99.99';
    const { dir, binDir } = createStubNpmDir({ latestVersion: newerVersion, installFails: true });
    tempDirs.add(dir);
    const { combined } = runUpdate({ PATH: `${binDir}:${process.env.PATH}` });
    assert.ok(
      combined.includes('sudo npm install -g') || combined.includes('permission') || combined.includes('npm config get prefix'),
      `Expected permission fix guidance but got:\n${combined}`
    );
  });
});
