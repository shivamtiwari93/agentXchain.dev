import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { once } from 'events';
import { DEFAULT_MCP_TOOL_NAME } from '../src/lib/adapters/mcp-adapter.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = join(__dirname, '..');
const REPO_ROOT = join(CLI_ROOT, '..');
const EXAMPLE_DIR = join(REPO_ROOT, 'examples', 'mcp-http-echo-agent');
const SERVER_PATH = join(EXAMPLE_DIR, 'server.js');
const STDIO_EXAMPLE_DIR = join(REPO_ROOT, 'examples', 'mcp-echo-agent');
const ADAPTER_PATH = join(CLI_ROOT, 'src', 'lib', 'adapters', 'mcp-adapter.js');
const DOCS_PATH = join(REPO_ROOT, 'website-v2', 'docs', 'adapters.mdx');

let childProcesses = [];

afterEach(() => {
  for (const child of childProcesses) {
    try { child.kill('SIGKILL'); } catch {}
  }
  childProcesses = [];
});

describe('MCP HTTP echo agent contract', () => {
  describe('example files', () => {
    it('example server exists', () => {
      assert.ok(existsSync(SERVER_PATH), 'examples/mcp-http-echo-agent/server.js must exist');
    });

    it('example server has package.json with MCP SDK dependency', () => {
      const pkgPath = join(EXAMPLE_DIR, 'package.json');
      assert.ok(existsSync(pkgPath), 'package.json must exist');
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
      assert.ok(pkg.dependencies?.['@modelcontextprotocol/sdk'], 'must depend on @modelcontextprotocol/sdk');
    });

    it('example server has a README', () => {
      const readmePath = join(EXAMPLE_DIR, 'README.md');
      assert.ok(existsSync(readmePath), 'README.md must exist');
      const readme = readFileSync(readmePath, 'utf8');
      assert.ok(readme.includes('agentxchain_turn'), 'README must mention the tool name');
      assert.ok(readme.includes('streamable_http') || readme.includes('streamable HTTP'),
        'README must mention streamable HTTP transport');
      assert.ok(readme.includes('/mcp'), 'README must document the /mcp endpoint');
    });
  });

  describe('tool contract parity with stdio variant', () => {
    it('registers the same default tool name as the stdio example', () => {
      const source = readFileSync(SERVER_PATH, 'utf8');
      assert.ok(
        source.includes(DEFAULT_MCP_TOOL_NAME),
        `server must register tool "${DEFAULT_MCP_TOOL_NAME}"`,
      );
    });

    it('accepts all 13 adapter arguments', () => {
      const adapterSource = readFileSync(ADAPTER_PATH, 'utf8');
      const serverSource = readFileSync(SERVER_PATH, 'utf8');

      const argRegex = /arguments:\s*\{([^}]+)\}/s;
      const adapterMatch = adapterSource.match(argRegex);
      assert.ok(adapterMatch, 'adapter must have arguments object in callTool');

      const adapterArgKeys = adapterMatch[1]
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.match(/^(\w+)[,:]/))
        .map((line) => line.match(/^(\w+)/)[1]);

      assert.ok(adapterArgKeys.length >= 13, `adapter sends ${adapterArgKeys.length} arguments, expected >= 13`);

      for (const key of adapterArgKeys) {
        assert.ok(
          serverSource.includes(`${key}:`),
          `server must declare argument "${key}" in its tool schema`,
        );
      }
    });

    it('returns structuredContent', () => {
      const source = readFileSync(SERVER_PATH, 'utf8');
      assert.ok(
        source.includes('structuredContent'),
        'server must return result via structuredContent',
      );
    });

    it('return object has required turn-result identity fields', () => {
      const source = readFileSync(SERVER_PATH, 'utf8');
      assert.ok(source.includes('run_id'), 'turn result must include run_id');
      assert.ok(source.includes('turn_id'), 'turn result must include turn_id');
      assert.ok(source.includes('status'), 'turn result must include status');
      assert.ok(source.includes("'completed'"), 'turn result must set status to completed');
    });

    it('has the same schema arguments as the stdio variant', () => {
      const httpSource = readFileSync(SERVER_PATH, 'utf8');
      const stdioSource = readFileSync(join(STDIO_EXAMPLE_DIR, 'server.js'), 'utf8');

      // Extract z.string() schema keys from both servers
      const schemaKeyRegex = /^\s+(\w+):\s+z\./gm;
      const httpKeys = [...httpSource.matchAll(schemaKeyRegex)].map(m => m[1]).sort();
      const stdioKeys = [...stdioSource.matchAll(schemaKeyRegex)].map(m => m[1]).sort();

      assert.deepStrictEqual(httpKeys, stdioKeys,
        'HTTP and stdio variants must accept the same tool arguments');
    });
  });

  describe('HTTP transport specifics', () => {
    it('uses StreamableHTTPServerTransport', () => {
      const source = readFileSync(SERVER_PATH, 'utf8');
      assert.ok(
        source.includes('StreamableHTTPServerTransport'),
        'server must use StreamableHTTPServerTransport',
      );
    });

    it('does NOT use StdioServerTransport', () => {
      const source = readFileSync(SERVER_PATH, 'utf8');
      assert.ok(
        !source.includes('StdioServerTransport'),
        'HTTP server must not use StdioServerTransport',
      );
    });

    it('handles the /mcp endpoint', () => {
      const source = readFileSync(SERVER_PATH, 'utf8');
      assert.ok(source.includes("'/mcp'"), 'server must handle /mcp endpoint');
    });

    it('rejects non-POST methods', () => {
      const source = readFileSync(SERVER_PATH, 'utf8');
      assert.ok(
        source.includes('405') || source.includes('Method not allowed'),
        'server must reject non-POST methods',
      );
    });

    it('supports --port flag and PORT env', () => {
      const source = readFileSync(SERVER_PATH, 'utf8');
      assert.ok(source.includes('--port'), 'server must support --port flag');
      assert.ok(source.includes('process.env.PORT'), 'server must support PORT env variable');
    });
  });

  describe('live server proof', () => {
    it('starts and responds to MCP initialize request', async () => {
      // Install deps if needed (CI does not install example deps automatically).
      // Use --userconfig /dev/null to isolate from CI OIDC auth that scopes
      // to npm publishing and can interfere with public registry fetches.
      const nodeModulesPath = join(EXAMPLE_DIR, 'node_modules');
      if (!existsSync(nodeModulesPath)) {
        const { execSync } = await import('child_process');
        execSync('npm install --ignore-scripts --userconfig /dev/null', {
          cwd: EXAMPLE_DIR,
          stdio: 'pipe',
          env: { ...process.env, NODE_AUTH_TOKEN: undefined, NPM_CONFIG_USERCONFIG: undefined },
        });
      }

      // Start the server on a random port
      const port = 10000 + Math.floor(Math.random() * 50000);
      const child = spawn(process.execPath, [SERVER_PATH, '--port', String(port)], {
        cwd: EXAMPLE_DIR,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      childProcesses.push(child);

      // Wait for the server to print its listening message
      let stdout = '';
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Server did not start within 10s')), 10000);
        child.stdout.on('data', (chunk) => {
          stdout += chunk.toString();
          if (stdout.includes('listening on')) {
            clearTimeout(timeout);
            resolve();
          }
        });
        child.on('error', (err) => { clearTimeout(timeout); reject(err); });
        child.on('close', (code) => {
          if (!stdout.includes('listening on')) {
            clearTimeout(timeout);
            reject(new Error(`Server exited with code ${code} before listening`));
          }
        });
      });

      // Send an MCP initialize request
      const initRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'contract-test', version: '1.0.0' },
        },
      };

      const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'accept': 'application/json, text/event-stream',
        },
        body: JSON.stringify(initRequest),
      });

      assert.equal(response.ok, true, `Expected 200, got ${response.status}`);
      const responseText = await response.text();
      assert.ok(responseText.includes('agentxchain-http-echo-agent'),
        'Server should identify itself in initialize response');

      child.kill('SIGTERM');
    });
  });

  describe('docs coverage', () => {
    it('adapters.mdx references the HTTP echo agent example', () => {
      const docs = readFileSync(DOCS_PATH, 'utf8');
      assert.ok(
        docs.includes('mcp-http-echo-agent'),
        'adapters.mdx must reference the mcp-http-echo-agent example',
      );
    });

    it('adapters.mdx documents streamable_http transport', () => {
      const docs = readFileSync(DOCS_PATH, 'utf8');
      assert.ok(
        docs.includes('streamable_http'),
        'adapters.mdx must document streamable_http transport',
      );
    });

    it('adapters.mdx documents remote config fields (url, headers)', () => {
      const docs = readFileSync(DOCS_PATH, 'utf8');
      assert.ok(docs.includes('`url`'), 'adapters.mdx must document url config field');
      assert.ok(docs.includes('`headers`'), 'adapters.mdx must document headers config field');
    });

    it('docs mention the streamable_http Accept header requirement', () => {
      const docs = readFileSync(DOCS_PATH, 'utf8');
      const readme = readFileSync(join(EXAMPLE_DIR, 'README.md'), 'utf8');
      assert.ok(
        docs.includes('Accept: application/json, text/event-stream'),
        'adapters.mdx must document the streamable_http Accept header requirement',
      );
      assert.ok(
        readme.includes('Accept: application/json, text/event-stream'),
        'HTTP echo agent README must document the streamable_http Accept header requirement',
      );
    });

    it('governed-todo-app README documents the remote MCP wiring', () => {
      const todoReadme = readFileSync(
        join(REPO_ROOT, 'examples', 'governed-todo-app', 'README.md'), 'utf8');
      assert.ok(
        todoReadme.includes('streamable_http') || todoReadme.includes('mcp-http-echo-agent'),
        'governed-todo-app README must document the remote MCP wiring path',
      );
    });
  });
});
