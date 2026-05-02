import { describe, it, beforeAll, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, cpSync, readFileSync, rmSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * Subprocess E2E tests for built-in plugin discovery and installation.
 *
 * Acceptance criteria:
 * - AT-PLUGIN-BUILTIN-001: `plugin list-available` lists all 3 built-in plugins
 * - AT-PLUGIN-BUILTIN-002: `plugin list-available --json` returns structured plugin data
 * - AT-PLUGIN-BUILTIN-003: `plugin install slack-notify` installs from bundled path
 * - AT-PLUGIN-BUILTIN-004: `plugin install json-report` installs from bundled path
 * - AT-PLUGIN-BUILTIN-005: `plugin install github-issues` installs from bundled path
 * - AT-PLUGIN-BUILTIN-006: short-name install records source type as 'builtin'
 * - AT-PLUGIN-BUILTIN-007: npm pack dry-run includes builtin plugin files in the tarball
 * - AT-PLUGIN-BUILTIN-008: builtin plugin copies stay byte-identical to the source plugin trees
 */

const ROOT = join(import.meta.dirname, '../..');
const BIN = join(ROOT, 'cli/bin/agentxchain.js');
const GOVERNED_FIXTURE = join(ROOT, 'examples/governed-todo-app/agentxchain.json');

function run(args, cwd) {
  return spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 15_000,
  });
}

function listRelativeFiles(rootDir, currentDir = rootDir) {
  const files = [];
  for (const entry of readdirSync(currentDir)) {
    const absolute = join(currentDir, entry);
    const stats = statSync(absolute);
    if (stats.isDirectory()) {
      files.push(...listRelativeFiles(rootDir, absolute));
      continue;
    }
    files.push(absolute.slice(rootDir.length + 1));
  }
  return files.sort();
}

describe('built-in plugin discovery', () => {
  it('AT-PLUGIN-BUILTIN-001: plugin list-available lists all 3 built-in plugins', () => {
    const result = run(['plugin', 'list-available'], ROOT);
    assert.equal(result.status, 0, `stderr: ${result.stderr}`);
    assert.match(result.stdout, /Available built-in plugins: 3/);
    assert.match(result.stdout, /slack-notify/);
    assert.match(result.stdout, /json-report/);
    assert.match(result.stdout, /github-issues/);
  });

  it('AT-PLUGIN-BUILTIN-002: plugin list-available --json returns structured data', () => {
    const result = run(['plugin', 'list-available', '--json'], ROOT);
    assert.equal(result.status, 0, `stderr: ${result.stderr}`);
    const data = JSON.parse(result.stdout);
    assert.equal(data.plugins.length, 3);
    const names = data.plugins.map((p) => p.short_name).sort();
    assert.deepStrictEqual(names, ['github-issues', 'json-report', 'slack-notify']);
    for (const plugin of data.plugins) {
      assert.ok(plugin.name, 'plugin has full name');
      assert.ok(plugin.version, 'plugin has version');
      assert.ok(plugin.description, 'plugin has description');
      assert.ok(plugin.install_command, 'plugin has install_command');
      assert.match(plugin.install_command, /agentxchain plugin install/);
    }
  });

  describe('short-name install from bundled path', () => {
    let tmpDir;

    beforeAll(() => {
      tmpDir = mkdtempSync(join(tmpdir(), 'axc-builtin-plugin-'));
      cpSync(GOVERNED_FIXTURE, join(tmpDir, 'agentxchain.json'));
    });

    afterAll(() => {
      if (tmpDir && existsSync(tmpDir)) rmSync(tmpDir, { recursive: true });
    });

    it('AT-PLUGIN-BUILTIN-003: plugin install slack-notify installs from bundled path', () => {
      const result = run(['plugin', 'install', 'slack-notify', '--json'], tmpDir);
      assert.equal(result.status, 0, `stderr: ${result.stderr}`);
      const data = JSON.parse(result.stdout);
      assert.equal(data.ok, true);
      assert.equal(data.name, '@agentxchain/plugin-slack-notify');
      assert.ok(data.hooks.after_acceptance);
    });

    it('AT-PLUGIN-BUILTIN-004: plugin install json-report installs from bundled path', () => {
      const result = run(['plugin', 'install', 'json-report', '--json'], tmpDir);
      assert.equal(result.status, 0, `stderr: ${result.stderr}`);
      const data = JSON.parse(result.stdout);
      assert.equal(data.ok, true);
      assert.equal(data.name, '@agentxchain/plugin-json-report');
    });

    it('AT-PLUGIN-BUILTIN-005: plugin install github-issues installs from bundled path', () => {
      const result = run(
        ['plugin', 'install', 'github-issues', '--json', '--config', JSON.stringify({ repo: 'owner/repo', issue_number: 1 })],
        tmpDir
      );
      assert.equal(result.status, 0, `stderr: ${result.stderr}`);
      const data = JSON.parse(result.stdout);
      assert.equal(data.ok, true);
      assert.equal(data.name, '@agentxchain/plugin-github-issues');
    });

    it('AT-PLUGIN-BUILTIN-006: short-name install records source type as builtin', () => {
      // Re-read the config to check the source types from the installs above
      const config = JSON.parse(readFileSync(join(tmpDir, 'agentxchain.json'), 'utf8'));
      const slackPlugin = config.plugins?.['@agentxchain/plugin-slack-notify'];
      assert.ok(slackPlugin, 'slack plugin found in config');
      assert.equal(slackPlugin.source.type, 'builtin');
      assert.equal(slackPlugin.source.spec, 'slack-notify');
    });
  });

  it('AT-PLUGIN-BUILTIN-007: npm pack dry-run includes builtin plugin files in the tarball', () => {
    const builtinDir = join(ROOT, 'cli/builtin-plugins');
    assert.ok(existsSync(builtinDir), 'builtin-plugins/ exists in CLI dir');
    assert.ok(existsSync(join(builtinDir, 'plugin-slack-notify/agentxchain-plugin.json')));
    assert.ok(existsSync(join(builtinDir, 'plugin-json-report/agentxchain-plugin.json')));
    assert.ok(existsSync(join(builtinDir, 'plugin-github-issues/agentxchain-plugin.json')));

    const pkg = JSON.parse(readFileSync(join(ROOT, 'cli/package.json'), 'utf8'));
    assert.ok(pkg.files.includes('builtin-plugins/'), 'builtin-plugins/ is in package.json files');

    const result = spawnSync('npm', ['pack', '--json', '--dry-run'], {
      cwd: join(ROOT, 'cli'),
      encoding: 'utf8',
      timeout: 30_000,
    });
    assert.equal(result.status, 0, `stderr: ${result.stderr}`);

    const dryRun = JSON.parse(result.stdout);
    assert.equal(dryRun.length, 1, 'expected a single tarball entry');
    const filePaths = dryRun[0].files.map((entry) => entry.path);

    assert.ok(filePaths.includes('builtin-plugins/plugin-slack-notify/agentxchain-plugin.json'));
    assert.ok(filePaths.includes('builtin-plugins/plugin-json-report/agentxchain-plugin.json'));
    assert.ok(filePaths.includes('builtin-plugins/plugin-github-issues/agentxchain-plugin.json'));
  });

  it('AT-PLUGIN-BUILTIN-008: builtin plugin copies stay byte-identical to the source plugin trees', () => {
    const pluginPairs = [
      'plugin-slack-notify',
      'plugin-json-report',
      'plugin-github-issues',
    ];

    for (const pluginDir of pluginPairs) {
      const sourceRoot = join(ROOT, 'plugins', pluginDir);
      const builtinRoot = join(ROOT, 'cli', 'builtin-plugins', pluginDir);

      const sourceFiles = listRelativeFiles(sourceRoot);
      const builtinFiles = listRelativeFiles(builtinRoot);
      assert.deepStrictEqual(
        builtinFiles,
        sourceFiles,
        `${pluginDir} bundled file list drifted from source plugin`,
      );

      for (const relativePath of sourceFiles) {
        const sourceContent = readFileSync(join(sourceRoot, relativePath));
        const builtinContent = readFileSync(join(builtinRoot, relativePath));
        assert.deepStrictEqual(
          builtinContent,
          sourceContent,
          `${pluginDir}/${relativePath} drifted between source and builtin copy`,
        );
      }
    }
  });
});
