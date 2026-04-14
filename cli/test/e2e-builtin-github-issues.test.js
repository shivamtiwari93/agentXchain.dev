import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { scaffoldGoverned } from '../src/commands/init.js';

const cliRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const binPath = join(cliRoot, 'bin', 'agentxchain.js');
const mockAgentPath = join(cliRoot, 'test-support', 'mock-agent.mjs');
const tempDirs = [];

function writeJson(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function readJsonl(path) {
  if (!existsSync(path)) return [];
  const content = readFileSync(path, 'utf8').trim();
  if (!content) return [];
  return content.split('\n').map((line) => JSON.parse(line));
}

function makeProject() {
  const root = mkdtempSync(join(tmpdir(), 'axc-builtin-github-issues-'));
  tempDirs.push(root);
  scaffoldGoverned(root, 'Built-In GitHub Issues E2E', `builtin-github-issues-${Date.now()}`);

  const configPath = join(root, 'agentxchain.json');
  const config = readJson(configPath);
  const mockRuntime = {
    type: 'local_cli',
    command: process.execPath,
    args: [mockAgentPath],
    prompt_transport: 'dispatch_bundle_only',
  };

  for (const key of Object.keys(config.runtimes)) {
    config.runtimes[key] = { ...mockRuntime };
  }
  for (const role of Object.values(config.roles)) {
    role.write_authority = 'authoritative';
  }

  writeJson(configPath, config);
  return root;
}

function runCli(root, args) {
  return spawnSync(process.execPath, [binPath, ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout: 60_000,
    env: { ...process.env, NODE_NO_WARNINGS: '1', NO_COLOR: '1' },
  });
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('E2E built-in github-issues plugin proof', () => {
  it('AT-GHI-PROOF-005: short-name install registers plugin with correct hooks', () => {
    const project = makeProject();

    const install = runCli(project, [
      'plugin', 'install', 'github-issues',
      '--config', JSON.stringify({ repo: 'owner/repo', issue_number: 1 }),
      '--json',
    ]);
    assert.equal(install.status, 0, `plugin install failed:\n${install.stdout}\n${install.stderr}`);
    const installData = JSON.parse(install.stdout);
    assert.equal(installData.name, '@agentxchain/plugin-github-issues');
    assert.equal(installData.source.type, 'builtin');
    assert.equal(installData.source.spec, 'github-issues');

    // Verify hooks are registered in the config
    const config = readJson(join(project, 'agentxchain.json'));
    const pluginMeta = config.plugins?.['@agentxchain/plugin-github-issues'];
    assert.ok(pluginMeta, 'plugin metadata should exist in config');
    assert.ok(pluginMeta.hooks?.after_acceptance?.includes('github_issues_acceptance'), 'after_acceptance hook registered');
    assert.ok(pluginMeta.hooks?.on_escalation?.includes('github_issues_escalation'), 'on_escalation hook registered');
  });

  it('AT-GHI-PROOF-006: governed run invokes github-issues hooks (advisory warn without token)', () => {
    const project = makeProject();

    // Install with valid config shape but no real token available
    const install = runCli(project, [
      'plugin', 'install', 'github-issues',
      '--config', JSON.stringify({ repo: 'owner/repo', issue_number: 1, token_env: 'AGENTXCHAIN_TEST_GH_TOKEN_MISSING' }),
      '--json',
    ]);
    assert.equal(install.status, 0, `plugin install failed:\n${install.stdout}\n${install.stderr}`);

    // Run governed flow — hooks will fire but return warn (missing token)
    // Advisory hooks cannot block, so the run should complete
    const run = runCli(project, ['run', '--auto-approve', '--max-turns', '5']);
    assert.equal(run.status, 0, `run failed:\n${run.stdout}\n${run.stderr}`);
    assert.match(run.stdout, /Run completed/);

    // Verify hook audit log shows the github-issues hooks were invoked
    const auditPath = join(project, '.agentxchain', 'hook-audit.jsonl');
    assert.ok(existsSync(auditPath), 'hook-audit.jsonl should exist');

    const auditEntries = readJsonl(auditPath);
    const ghiEntries = auditEntries.filter(
      (e) => e.hook_name && (e.hook_name === 'github_issues_acceptance' || e.hook_name === 'github_issues_escalation'),
    );

    assert.ok(ghiEntries.length > 0, 'github-issues hooks should appear in audit log');

    // At least one after_acceptance invocation
    const acceptanceEntries = ghiEntries.filter((e) => e.hook_name === 'github_issues_acceptance');
    assert.ok(acceptanceEntries.length > 0, 'github_issues_acceptance hook should be invoked at least once');

    // Advisory hooks return warn when token is missing — verify they did not block
    for (const entry of ghiEntries) {
      assert.notEqual(entry.verdict, 'block', `github-issues hook should not block (advisory mode), but got block for ${entry.hook_name}`);
    }
  });

  it('AT-GHI-PROOF-006b: plugin config validation rejects missing required fields', () => {
    const project = makeProject();

    // Missing issue_number
    const install1 = runCli(project, [
      'plugin', 'install', 'github-issues',
      '--config', JSON.stringify({ repo: 'owner/repo' }),
      '--json',
    ]);
    assert.notEqual(install1.status, 0, 'install should fail without issue_number');

    // Missing repo
    const install2 = runCli(project, [
      'plugin', 'install', 'github-issues',
      '--config', JSON.stringify({ issue_number: 1 }),
      '--json',
    ]);
    assert.notEqual(install2.status, 0, 'install should fail without repo');
  });
});
