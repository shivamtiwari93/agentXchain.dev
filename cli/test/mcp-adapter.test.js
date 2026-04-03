import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import * as z from 'zod/v4';

import {
  dispatchMcp,
  extractTurnResultFromMcpToolResult,
  resolveMcpTransport,
  resolveMcpToolName,
} from '../src/lib/adapters/mcp-adapter.js';
import { writeDispatchBundle } from '../src/lib/dispatch-bundle.js';
import { getTurnStagingResultPath } from '../src/lib/turn-paths.js';

function makeTmpDir() {
  const dir = join(tmpdir(), `axc-mcp-adapter-test-${randomBytes(6).toString('hex')}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function makeState(overrides = {}) {
  return {
    run_id: 'run_test123',
    status: 'active',
    phase: 'implementation',
    accepted_integration_ref: 'git:abc123',
    current_turn: {
      turn_id: 'turn_test001',
      assigned_role: 'dev',
      status: 'running',
      attempt: 1,
      started_at: new Date().toISOString(),
      deadline_at: new Date(Date.now() + 600000).toISOString(),
      runtime_id: 'mcp-dev',
    },
    last_completed_turn_id: null,
    blocked_on: null,
    escalation: null,
    budget_status: { spent_usd: 0, remaining_usd: 50 },
    phase_gate_status: {},
    ...overrides,
  };
}

function makeConfig(runtimeOverrides = {}) {
  return {
    schema_version: 4,
    protocol_mode: 'governed',
    project: { id: 'test-project', name: 'Test', default_branch: 'main' },
    roles: {
      dev: {
        title: 'Developer',
        mandate: 'Implement approved work.',
        write_authority: 'authoritative',
        runtime_class: 'mcp',
        runtime_id: 'mcp-dev',
      },
    },
    runtimes: {
      'mcp-dev': {
        type: 'mcp',
        command: 'node',
        args: ['--input-type=module', '--eval', buildServerScript('structured')],
        cwd: '.',
        ...runtimeOverrides,
      },
    },
    routing: {
      implementation: { entry_role: 'dev', allowed_next_roles: ['dev', 'qa', 'human'] },
    },
    gates: {},
    budget: { per_turn_max_usd: 2.0, per_run_max_usd: 50.0 },
    rules: { challenge_required: true, max_turn_retries: 2 },
  };
}

function buildServerScript(mode) {
  const inputSchemaBlock = `
        inputSchema: {
          run_id: z.string(),
          turn_id: z.string(),
          role: z.string(),
          phase: z.string(),
          runtime_id: z.string(),
          project_root: z.string(),
          dispatch_dir: z.string(),
          assignment_path: z.string(),
          prompt_path: z.string(),
          context_path: z.string(),
          staging_path: z.string(),
          prompt: z.string(),
          context: z.string()
        }`;
  const outputSchemaBlock = mode === 'structured'
    ? `,
        outputSchema: {
          schema_version: z.string(),
          run_id: z.string(),
          turn_id: z.string(),
          role: z.string(),
          runtime_id: z.string(),
          status: z.string(),
          summary: z.string(),
          decisions: z.array(z.any()),
          objections: z.array(z.any()),
          files_changed: z.array(z.any()),
          artifacts_created: z.array(z.any()),
          verification: z.any(),
          artifact: z.any(),
          proposed_next_role: z.string(),
          phase_transition_request: z.any(),
          run_completion_request: z.any(),
          needs_human_reason: z.any(),
          cost: z.any()
        }`
    : '';

  return `
    import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
    import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
    import * as z from 'zod/v4';

    const server = new McpServer({ name: 'axc-test-server', version: '1.0.0' });

    function makeTurnResult(args) {
      return {
        schema_version: '1.0',
        run_id: args.run_id,
        turn_id: args.turn_id,
        role: args.role,
        runtime_id: args.runtime_id,
        status: 'completed',
        summary: 'Handled by MCP.',
        decisions: [],
        objections: [],
        files_changed: [],
        artifacts_created: [],
        verification: {
          status: 'pass',
          commands: ['npm test'],
          evidence_summary: 'All good.',
          machine_evidence: [{ command: 'npm test', exit_code: 0 }]
        },
        artifact: { type: 'workspace', ref: 'git:dirty' },
        proposed_next_role: 'qa',
        phase_transition_request: null,
        run_completion_request: null,
        needs_human_reason: null,
        cost: { input_tokens: 0, output_tokens: 0, usd: 0 }
      };
    }

    if (${JSON.stringify(mode)} !== 'missing-tool') {
      server.registerTool('agentxchain_turn', { description: 'Execute a governed turn',${inputSchemaBlock}${outputSchemaBlock} }, async (args) => {
        const turnResult = makeTurnResult(args);
        if (${JSON.stringify(mode)} === 'invalid') {
          return { content: [{ type: 'text', text: 'not valid json' }] };
        }
        if (${JSON.stringify(mode)} === 'text') {
          return { content: [{ type: 'text', text: JSON.stringify(turnResult) }] };
        }
        return {
          content: [{ type: 'text', text: 'ok' }],
          structuredContent: turnResult
        };
      });
    } else {
      server.registerTool('other_tool', { description: 'Wrong tool' }, async () => ({
        content: [{ type: 'text', text: 'wrong tool' }]
      }));
    }

    const transport = new StdioServerTransport();
    await server.connect(transport);
  `;
}

function setupDispatchBundle(root, state, config) {
  writeDispatchBundle(root, state, config);
}

let tmpDirs = [];
let httpServers = [];
function createAndTrack() {
  const dir = makeTmpDir();
  tmpDirs.push(dir);
  return dir;
}

function linkNodeModules(root) {
  const realNodeModules = resolve(import.meta.dirname, '..', 'node_modules');
  symlinkSync(realNodeModules, join(root, 'node_modules'), 'dir');
}

function makeTurnResult(args) {
  return {
    schema_version: '1.0',
    run_id: args.run_id,
    turn_id: args.turn_id,
    role: args.role,
    runtime_id: args.runtime_id,
    status: 'completed',
    summary: 'Handled by MCP.',
    decisions: [],
    objections: [],
    files_changed: [],
    artifacts_created: [],
    verification: {
      status: 'pass',
      commands: ['npm test'],
      evidence_summary: 'All good.',
      machine_evidence: [{ command: 'npm test', exit_code: 0 }],
    },
    artifact: { type: 'workspace', ref: 'git:dirty' },
    proposed_next_role: 'qa',
    phase_transition_request: null,
    run_completion_request: null,
    needs_human_reason: null,
    cost: { input_tokens: 0, output_tokens: 0, usd: 0 },
  };
}

async function startStreamableHttpServer(mode = 'structured') {
  const requests = [];
  const server = createServer(async (req, res) => {
    if (req.url !== '/mcp') {
      res.writeHead(404).end('not found');
      return;
    }

    if (req.method === 'GET') {
      res.writeHead(405, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        jsonrpc: '2.0',
        error: { code: -32000, message: 'Method not allowed.' },
        id: null,
      }));
      return;
    }

    if (req.method !== 'POST') {
      res.writeHead(405).end();
      return;
    }

    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    const bodyText = Buffer.concat(chunks).toString('utf8');
    const body = bodyText ? JSON.parse(bodyText) : undefined;
    requests.push({
      method: req.method,
      headers: req.headers,
      body,
    });

    const mcpServer = new McpServer({ name: 'axc-http-test-server', version: '1.0.0' });

    if (mode !== 'missing-tool') {
      mcpServer.registerTool('agentxchain_turn', {
        description: 'Execute a governed turn',
        inputSchema: {
          run_id: z.string(),
          turn_id: z.string(),
          role: z.string(),
          phase: z.string(),
          runtime_id: z.string(),
          project_root: z.string(),
          dispatch_dir: z.string(),
          assignment_path: z.string(),
          prompt_path: z.string(),
          context_path: z.string(),
          staging_path: z.string(),
          prompt: z.string(),
          context: z.string(),
        },
      }, async (args) => {
        if (mode === 'invalid') {
          return { content: [{ type: 'text', text: 'not valid json' }] };
        }
        if (mode === 'text') {
          return { content: [{ type: 'text', text: JSON.stringify(makeTurnResult(args)) }] };
        }
        return {
          content: [{ type: 'text', text: 'ok' }],
          structuredContent: makeTurnResult(args),
        };
      });
    } else {
      mcpServer.registerTool('other_tool', { description: 'Wrong tool' }, async () => ({
        content: [{ type: 'text', text: 'wrong tool' }],
      }));
    }

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
    });
    await mcpServer.connect(transport);
    res.on('close', () => {
      void transport.close();
      void mcpServer.close();
    });
    await transport.handleRequest(req, res, body);
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  httpServers.push(server);
  const address = server.address();
  return {
    url: `http://127.0.0.1:${address.port}/mcp`,
    requests,
  };
}

afterEach(async () => {
  for (const dir of tmpDirs) {
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
  }
  tmpDirs = [];
  for (const server of httpServers) {
    try {
      await new Promise((resolve) => server.close(resolve));
    } catch {}
  }
  httpServers = [];
});

describe('mcp-adapter', () => {
  it('returns error when required MCP tool is missing', async () => {
    const root = createAndTrack();
    linkNodeModules(root);
    const state = makeState();
    const config = makeConfig({
      args: ['--input-type=module', '--eval', buildServerScript('missing-tool')],
    });
    setupDispatchBundle(root, state, config);

    const result = await dispatchMcp(root, state, config);
    assert.equal(result.ok, false);
    assert.match(result.error, /does not expose required tool "agentxchain_turn"/);
  });

  it('stages structuredContent turn results', async () => {
    const root = createAndTrack();
    linkNodeModules(root);
    const state = makeState();
    const config = makeConfig();
    setupDispatchBundle(root, state, config);

    const result = await dispatchMcp(root, state, config);
    assert.equal(result.ok, true, result.error);

    const staged = readJson(join(root, getTurnStagingResultPath(state.current_turn.turn_id)));
    assert.equal(staged.run_id, state.run_id);
    assert.equal(staged.turn_id, state.current_turn.turn_id);
    assert.equal(staged.runtime_id, 'mcp-dev');
  });

  it('stages JSON text turn results', async () => {
    const root = createAndTrack();
    linkNodeModules(root);
    const state = makeState();
    const config = makeConfig({
      args: ['--input-type=module', '--eval', buildServerScript('text')],
    });
    setupDispatchBundle(root, state, config);

    const result = await dispatchMcp(root, state, config);
    assert.equal(result.ok, true, result.error);

    const staged = readJson(join(root, getTurnStagingResultPath(state.current_turn.turn_id)));
    assert.equal(staged.summary, 'Handled by MCP.');
  });

  it('fails when tool content is not valid turn-result JSON', async () => {
    const root = createAndTrack();
    linkNodeModules(root);
    const state = makeState();
    const config = makeConfig({
      args: ['--input-type=module', '--eval', buildServerScript('invalid')],
    });
    setupDispatchBundle(root, state, config);

    const result = await dispatchMcp(root, state, config);
    assert.equal(result.ok, false);
    assert.match(result.error, /none of the text blocks contained valid turn-result JSON/);
  });

  it('stages turn results from a streamable_http MCP server and forwards headers', async () => {
    const root = createAndTrack();
    const remote = await startStreamableHttpServer('structured');
    const state = makeState();
    const config = makeConfig({
      transport: 'streamable_http',
      url: remote.url,
      headers: {
        'x-agentxchain-project': 'test-suite',
      },
    });
    delete config.runtimes['mcp-dev'].command;
    delete config.runtimes['mcp-dev'].args;
    delete config.runtimes['mcp-dev'].cwd;
    setupDispatchBundle(root, state, config);

    const result = await dispatchMcp(root, state, config);
    assert.equal(result.ok, true, result.error);

    const staged = readJson(join(root, getTurnStagingResultPath(state.current_turn.turn_id)));
    assert.equal(staged.run_id, state.run_id);
    assert.equal(staged.turn_id, state.current_turn.turn_id);
    assert.ok(
      remote.requests.some((request) => request.headers['x-agentxchain-project'] === 'test-suite'),
      'streamable_http dispatch should forward configured static headers'
    );
  });

  it('returns error when required tool is missing on a streamable_http MCP server', async () => {
    const root = createAndTrack();
    const remote = await startStreamableHttpServer('missing-tool');
    const state = makeState();
    const config = makeConfig({
      transport: 'streamable_http',
      url: remote.url,
    });
    delete config.runtimes['mcp-dev'].command;
    delete config.runtimes['mcp-dev'].args;
    delete config.runtimes['mcp-dev'].cwd;
    setupDispatchBundle(root, state, config);

    const result = await dispatchMcp(root, state, config);
    assert.equal(result.ok, false);
    assert.match(result.error, /does not expose required tool "agentxchain_turn"/);
  });
});

describe('extractTurnResultFromMcpToolResult', () => {
  it('prefers structuredContent when present', () => {
    const result = extractTurnResultFromMcpToolResult({
      structuredContent: { run_id: 'run1', turn_id: 'turn1', status: 'completed' },
      content: [{ type: 'text', text: '{"run_id":"wrong","turn_id":"wrong","status":"wrong"}' }],
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.result, { run_id: 'run1', turn_id: 'turn1', status: 'completed' });
  });

  it('fails when response has no structured object payload', () => {
    const result = extractTurnResultFromMcpToolResult({
      content: [{ type: 'text', text: 'plain text' }],
    });
    assert.equal(result.ok, false);
  });

  it('unwraps nested SDK toolResult wrappers', () => {
    const result = extractTurnResultFromMcpToolResult({
      toolResult: {
        structuredContent: {
          schema_version: '1.0',
          turn_id: 'turn_nested',
          status: 'completed',
        },
      },
    });
    assert.equal(result.ok, true);
    assert.equal(result.result.turn_id, 'turn_nested');
  });
});

describe('resolveMcpToolName', () => {
  it('defaults to agentxchain_turn', () => {
    assert.equal(resolveMcpToolName({}), 'agentxchain_turn');
  });

  it('honors configured tool_name', () => {
    assert.equal(resolveMcpToolName({ tool_name: 'custom_turn_tool' }), 'custom_turn_tool');
  });
});

describe('resolveMcpTransport', () => {
  it('defaults to stdio', () => {
    assert.equal(resolveMcpTransport({}), 'stdio');
  });

  it('honors configured transport', () => {
    assert.equal(resolveMcpTransport({ transport: 'streamable_http' }), 'streamable_http');
  });
});
