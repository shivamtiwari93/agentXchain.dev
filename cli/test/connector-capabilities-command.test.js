import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

const ROOT = join(import.meta.dirname, '..');
const CLI_PATH = join(ROOT, 'bin', 'agentxchain.js');

function runCli(cwd, args) {
  return execFileSync('node', [CLI_PATH, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, NODE_NO_WARNINGS: '1' },
    timeout: 15_000,
  });
}

function runCliFail(cwd, args) {
  try {
    execFileSync('node', [CLI_PATH, ...args], {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, NODE_NO_WARNINGS: '1' },
      timeout: 15_000,
    });
    assert.fail('Expected CLI to exit non-zero');
  } catch (err) {
    return err;
  }
}

function createProject() {
  const dir = mkdtempSync(join(tmpdir(), 'axc-cap-'));
  runCli(ROOT, ['init', '--governed', '--dir', dir, '-y']);
  return dir;
}

function readConfig(dir) {
  return JSON.parse(readFileSync(join(dir, 'agentxchain.json'), 'utf8'));
}

function writeConfig(dir, config) {
  writeFileSync(join(dir, 'agentxchain.json'), JSON.stringify(config, null, 2) + '\n');
}

function addRuntime(dir, id, runtime) {
  const config = readConfig(dir);
  config.runtimes[id] = runtime;
  writeConfig(dir, config);
}

describe('connector capabilities command', () => {
  it('AT-CC-001: returns merged contract with correct type defaults for manual runtime', () => {
    const dir = createProject();
    // init --governed creates manual-dev by default
    const out = runCli(dir, ['connector', 'capabilities', 'manual-dev', '--json']);
    const result = JSON.parse(out);

    assert.equal(result.runtime_id, 'manual-dev');
    assert.equal(result.runtime_type, 'manual');
    assert.equal(result.merged_contract.can_write_files, 'direct');
    assert.equal(result.merged_contract.transport, 'manual');
    assert.equal(result.merged_contract.proposal_support, 'none');
    assert.equal(result.merged_contract.workflow_artifact_ownership, 'yes');
    assert.equal(result.merged_contract.requires_local_binary, false);
    assert.deepEqual(result.declared_capabilities, {});
  });

  it('AT-CC-002: MCP with declared overrides shows merged capabilities', () => {
    const dir = createProject();
    addRuntime(dir, 'mcp_tool', {
      type: 'mcp',
      command: ['my-mcp-tool'],
      capabilities: { can_write_files: 'direct', workflow_artifact_ownership: 'yes' },
    });

    const out = runCli(dir, ['connector', 'capabilities', 'mcp_tool', '--json']);
    const result = JSON.parse(out);

    assert.equal(result.runtime_type, 'mcp');
    assert.equal(result.merged_contract.can_write_files, 'direct', 'declared override applied');
    assert.equal(result.merged_contract.workflow_artifact_ownership, 'yes', 'declared override applied');
    assert.equal(result.declared_capabilities.can_write_files, 'direct');
    assert.equal(result.declared_capabilities.workflow_artifact_ownership, 'yes');
  });

  it('AT-CC-003: --all returns all configured runtimes', () => {
    const dir = createProject();
    addRuntime(dir, 'extra_mcp', { type: 'mcp', command: ['extra'] });

    const out = runCli(dir, ['connector', 'capabilities', '--all', '--json']);
    const result = JSON.parse(out);

    assert.ok(Array.isArray(result.runtimes));
    assert.ok(result.runtimes.length >= 2, 'at least default + extra runtime');
    const ids = result.runtimes.map(r => r.runtime_id);
    assert.ok(ids.includes('extra_mcp'), 'added runtime present');
    assert.ok(ids.includes('manual-dev'), 'default runtime present');
  });

  it('AT-CC-004: unknown runtime_id returns error with available list', () => {
    const dir = createProject();

    const err = runCliFail(dir, ['connector', 'capabilities', 'nonexistent', '--json']);
    const result = JSON.parse(err.stdout);
    assert.ok(result.error.includes('nonexistent'));
    assert.ok(Array.isArray(result.available_runtimes));
    assert.ok(result.available_runtimes.length > 0, 'lists available runtimes');
  });

  it('AT-CC-005: role bindings appear with correct effective write paths', () => {
    const dir = createProject();
    // dev role is bound to manual-dev with authoritative write authority
    const out = runCli(dir, ['connector', 'capabilities', 'manual-dev', '--json']);
    const result = JSON.parse(out);

    assert.ok(Array.isArray(result.role_bindings));
    assert.ok(result.role_bindings.length >= 1, 'at least one role bound');

    const dev = result.role_bindings.find(r => r.role_id === 'dev');
    assert.ok(dev, 'dev role bound to manual-dev');
    assert.equal(dev.role_write_authority, 'authoritative');
    assert.equal(dev.effective_write_path, 'direct');
  });

  it('AT-CC-006: declaration warnings surface for known-incompatible combinations', () => {
    const dir = createProject();
    addRuntime(dir, 'proxy', {
      type: 'api_proxy',
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      auth_env: 'ANTHROPIC_API_KEY',
      capabilities: { can_write_files: 'direct' },
    });

    const out = runCli(dir, ['connector', 'capabilities', 'proxy', '--json']);
    const result = JSON.parse(out);

    assert.ok(result.declaration_warnings.length > 0, 'expected at least one warning');
    assert.ok(result.declaration_warnings[0].includes('api_proxy'), 'warning mentions the runtime type');
  });
});
