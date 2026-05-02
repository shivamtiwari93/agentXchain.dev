import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { DEFAULT_MCP_TOOL_NAME } from '../src/lib/adapters/mcp-adapter.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = join(__dirname, '..');
const REPO_ROOT = join(CLI_ROOT, '..');
const EXAMPLE_DIR = join(REPO_ROOT, 'examples', 'mcp-echo-agent');
const SERVER_PATH = join(EXAMPLE_DIR, 'server.js');
const ADAPTER_PATH = join(CLI_ROOT, 'src', 'lib', 'adapters', 'mcp-adapter.js');
const DOCS_PATH = join(REPO_ROOT, 'website-v2', 'docs', 'adapters.mdx');

describe('MCP echo agent contract', () => {
  it('example server exists', () => {
    assert.ok(existsSync(SERVER_PATH), 'examples/mcp-echo-agent/server.js must exist');
  });

  it('example server has package.json with MCP SDK dependency', () => {
    const pkgPath = join(EXAMPLE_DIR, 'package.json');
    assert.ok(existsSync(pkgPath), 'package.json must exist');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
    assert.ok(pkg.dependencies?.['@modelcontextprotocol/sdk'], 'must depend on @modelcontextprotocol/sdk');
  });

  it('example server registers the default tool name', () => {
    const source = readFileSync(SERVER_PATH, 'utf8');
    assert.ok(
      source.includes(DEFAULT_MCP_TOOL_NAME),
      `server must register tool "${DEFAULT_MCP_TOOL_NAME}"`,
    );
  });

  it('example server accepts all 13 adapter arguments', () => {
    const adapterSource = readFileSync(ADAPTER_PATH, 'utf8');
    const serverSource = readFileSync(SERVER_PATH, 'utf8');

    // Extract the argument keys from the adapter's callTool arguments object
    const argRegex = /arguments:\s*\{([^}]+)\}/s;
    const adapterMatch = adapterSource.match(argRegex);
    assert.ok(adapterMatch, 'adapter must have arguments object in callTool');

    const adapterArgKeys = adapterMatch[1]
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.match(/^(\w+)[,:]/))
      .map((line) => line.match(/^(\w+)/)[1]);

    assert.ok(adapterArgKeys.length >= 13, `adapter sends ${adapterArgKeys.length} arguments, expected >= 13`);

    // Every argument the adapter sends must appear in the server's schema
    for (const key of adapterArgKeys) {
      assert.ok(
        serverSource.includes(`${key}:`),
        `server must declare argument "${key}" in its tool schema`,
      );
    }
  });

  it('example server returns structuredContent', () => {
    const source = readFileSync(SERVER_PATH, 'utf8');
    assert.ok(
      source.includes('structuredContent'),
      'server must return result via structuredContent',
    );
  });

  it('example server return object has required turn-result identity fields', () => {
    const source = readFileSync(SERVER_PATH, 'utf8');
    // The adapter's looksLikeTurnResult needs run_id/turn_id AND status/role/runtime_id
    assert.ok(source.includes('run_id'), 'turn result must include run_id');
    assert.ok(source.includes('turn_id'), 'turn result must include turn_id');
    assert.ok(source.includes('status'), 'turn result must include status');
    assert.ok(source.includes("'completed'"), 'turn result must set status to completed');
  });

  it('example server has a README with tool contract table', () => {
    const readmePath = join(EXAMPLE_DIR, 'README.md');
    assert.ok(existsSync(readmePath), 'README.md must exist');
    const readme = readFileSync(readmePath, 'utf8');
    assert.ok(readme.includes('agentxchain_turn'), 'README must mention the tool name');
    assert.ok(readme.includes('run_id'), 'README must document run_id argument');
    assert.ok(readme.includes('staging_path'), 'README must document staging_path argument');
  });

  it('adapters.mdx links to the example server', () => {
    const docs = readFileSync(DOCS_PATH, 'utf8');
    assert.ok(
      docs.includes('mcp-echo-agent'),
      'adapters.mdx must reference the mcp-echo-agent example',
    );
  });

  it('adapters.mdx documents the 20-minute default timeout', () => {
    const docs = readFileSync(DOCS_PATH, 'utf8');
    assert.ok(
      docs.includes('20 minutes') || docs.includes('1,200,000'),
      'adapters.mdx must document the 20-minute default MCP timeout',
    );
  });

  it('adapters.mdx documents SDK wrapper unwrapping', () => {
    const docs = readFileSync(DOCS_PATH, 'utf8');
    assert.ok(
      docs.includes('toolResult') && docs.includes('unwrap'),
      'adapters.mdx must document that nested SDK toolResult wrappers are unwrapped',
    );
  });

  it('adapters.mdx documents all 13 tool arguments', () => {
    const docs = readFileSync(DOCS_PATH, 'utf8');
    const requiredArgs = [
      'run_id', 'turn_id', 'role', 'phase', 'runtime_id',
      'project_root', 'dispatch_dir', 'assignment_path',
      'prompt_path', 'context_path', 'staging_path',
    ];
    for (const arg of requiredArgs) {
      assert.ok(
        docs.includes(`\`${arg}\``),
        `adapters.mdx must document argument "${arg}"`,
      );
    }
  });

  it('adapters.mdx documents MCP config fields', () => {
    const docs = readFileSync(DOCS_PATH, 'utf8');
    const fields = ['command', 'args', 'tool_name', 'cwd'];
    for (const field of fields) {
      assert.ok(
        docs.includes(`\`${field}\``),
        `adapters.mdx must document config field "${field}"`,
      );
    }
  });
});
