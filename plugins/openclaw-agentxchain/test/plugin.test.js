import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pluginRoot = resolve(__dirname, '..');

describe('OpenClaw plugin package structure', () => {
  it('has a valid openclaw.plugin.json manifest', () => {
    const manifest = JSON.parse(
      readFileSync(resolve(pluginRoot, 'openclaw.plugin.json'), 'utf-8'),
    );
    assert.equal(manifest.name, '@agentxchain/openclaw-plugin');
    assert.equal(manifest.schema_version, '1.0');
    assert.ok(manifest.entry, 'manifest must specify an entry point');
    assert.ok(manifest.compatibility?.openclaw, 'manifest must declare OpenClaw compatibility');
  });

  it('declares all three governance tools in the manifest', () => {
    const manifest = JSON.parse(
      readFileSync(resolve(pluginRoot, 'openclaw.plugin.json'), 'utf-8'),
    );
    const toolNames = manifest.tools.map((t) => t.name);
    assert.ok(toolNames.includes('agentxchain_step'), 'missing agentxchain_step');
    assert.ok(toolNames.includes('agentxchain_accept_turn'), 'missing agentxchain_accept_turn');
    assert.ok(
      toolNames.includes('agentxchain_approve_transition'),
      'missing agentxchain_approve_transition',
    );
  });

  it('each tool has required parameter schema', () => {
    const manifest = JSON.parse(
      readFileSync(resolve(pluginRoot, 'openclaw.plugin.json'), 'utf-8'),
    );
    for (const tool of manifest.tools) {
      assert.ok(tool.parameters, `${tool.name} must have parameters`);
      assert.ok(
        tool.parameters.properties?.working_directory,
        `${tool.name} must require working_directory`,
      );
      assert.ok(
        tool.parameters.required?.includes('working_directory'),
        `${tool.name} must mark working_directory as required`,
      );
    }
  });

  it('package.json has correct metadata', () => {
    const pkg = JSON.parse(
      readFileSync(resolve(pluginRoot, 'package.json'), 'utf-8'),
    );
    assert.equal(pkg.name, '@agentxchain/openclaw-plugin');
    assert.equal(pkg.type, 'module');
    assert.ok(pkg.main, 'package.json must specify main entry');
  });

  it('TypeScript source exports definePluginEntry', () => {
    const src = readFileSync(resolve(pluginRoot, 'src/index.ts'), 'utf-8');
    assert.ok(
      src.includes('export function definePluginEntry'),
      'source must export definePluginEntry',
    );
  });

  it('definePluginEntry registers all three tools via register(api)', () => {
    const src = readFileSync(resolve(pluginRoot, 'src/index.ts'), 'utf-8');
    assert.ok(src.includes("registerTool('agentxchain_step'"), 'must register agentxchain_step');
    assert.ok(
      src.includes("registerTool('agentxchain_accept_turn'"),
      'must register agentxchain_accept_turn',
    );
    assert.ok(
      src.includes("registerTool('agentxchain_approve_transition'"),
      'must register agentxchain_approve_transition',
    );
  });

  it('tools shell out to agentxchain CLI via execFileSync', () => {
    const src = readFileSync(resolve(pluginRoot, 'src/index.ts'), 'utf-8');
    assert.ok(src.includes("execFileSync('agentxchain'"), 'must invoke agentxchain CLI');
  });
});
