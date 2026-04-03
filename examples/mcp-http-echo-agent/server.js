#!/usr/bin/env node

/**
 * agentxchain-mcp-http-echo-agent
 *
 * Minimal MCP server that implements the agentxchain_turn tool contract
 * over streamable HTTP transport. This is the remote counterpart of the
 * stdio mcp-echo-agent — same governed tool contract, different transport.
 *
 * Usage:
 *
 *   node server.js                    # listens on http://127.0.0.1:8787/mcp
 *   node server.js --port 9000        # custom port
 *   PORT=9000 node server.js          # custom port via env
 *
 * Then configure a runtime in your agentxchain.json:
 *
 *   {
 *     "mcp-remote": {
 *       "type": "mcp",
 *       "transport": "streamable_http",
 *       "url": "http://127.0.0.1:8787/mcp",
 *       "tool_name": "agentxchain_turn",
 *       "headers": {
 *         "x-agentxchain-project": "my-project"
 *       }
 *     }
 *   }
 *
 * This is a reference implementation. Replace the echo logic with your
 * own agent logic to build a real governed remote MCP agent.
 */

import { createServer } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';

// --- Port resolution ---
const portArg = process.argv.indexOf('--port');
const PORT = portArg !== -1 ? Number(process.argv[portArg + 1]) : Number(process.env.PORT) || 8787;

// --- Build the governed turn result ---
function buildTurnResult(args) {
  const {
    run_id, turn_id, role, phase, runtime_id,
    prompt, context, assignment_path,
  } = args;

  const promptLines = prompt.split('\n').length;
  const contextLines = context.split('\n').length;

  return {
    schema_version: '1.0',
    run_id,
    turn_id,
    role,
    runtime_id,
    status: 'completed',
    summary: `Remote echo agent completed ${role} turn in ${phase} phase. Received ${promptLines}-line prompt and ${contextLines}-line context.`,
    decisions: [
      {
        id: 'DEC-001',
        category: 'implementation',
        statement: `Acknowledge ${role} assignment for the ${phase} phase without modifying product files.`,
        rationale: 'The remote echo server is a transport reference, not a real worker.',
      },
    ],
    objections: [
      {
        id: 'OBJ-001',
        severity: 'low',
        statement: 'No-op remote MCP example does not perform real implementation or verification work.',
        status: 'raised',
      },
    ],
    files_changed: [],
    artifacts_created: [],
    verification: {
      status: 'skipped',
      commands: [],
      evidence_summary: 'Remote echo agent intentionally skips verification. Replace with real test execution.',
      machine_evidence: [],
    },
    artifact: { type: 'review', ref: assignment_path },
    proposed_next_role: 'human',
    phase_transition_request: null,
    run_completion_request: null,
    needs_human_reason: null,
    cost: {
      input_tokens: 0,
      output_tokens: 0,
      usd: 0,
    },
  };
}

// --- HTTP server ---
const httpServer = createServer(async (req, res) => {
  // Only handle /mcp endpoint
  if (req.url !== '/mcp') {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found. Use /mcp endpoint.' }));
    return;
  }

  // Reject non-POST methods per MCP streamable HTTP spec
  if (req.method !== 'POST') {
    res.writeHead(405, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed. POST to /mcp.' },
      id: null,
    }));
    return;
  }

  // Read request body
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const bodyText = Buffer.concat(chunks).toString('utf8');
  const body = bodyText ? JSON.parse(bodyText) : undefined;

  // Create a per-request MCP server instance (stateless mode)
  const mcpServer = new McpServer({
    name: 'agentxchain-http-echo-agent',
    version: '1.0.0',
  });

  // Register the governed-turn tool with the exact contract the adapter expects.
  mcpServer.tool(
    'agentxchain_turn',
    'Execute a governed AgentXchain turn over remote HTTP transport. Receives assignment metadata, dispatch paths, and rendered prompt/context. Returns a valid turn-result object.',
    {
      // Identity fields
      run_id: z.string().describe('Current run identifier'),
      turn_id: z.string().describe('Current turn identifier'),
      role: z.string().describe('Assigned role for this turn'),
      phase: z.string().describe('Current governed phase (planning, implementation, qa)'),
      runtime_id: z.string().describe('Runtime identifier from config'),

      // Paths — the adapter provides absolute paths to dispatch files
      project_root: z.string().describe('Absolute path to the project root'),
      dispatch_dir: z.string().describe('Absolute path to the dispatch turn directory'),
      assignment_path: z.string().describe('Absolute path to ASSIGNMENT.json'),
      prompt_path: z.string().describe('Absolute path to PROMPT.md'),
      context_path: z.string().describe('Absolute path to CONTEXT.md'),
      staging_path: z.string().describe('Absolute path where the adapter will write the staged result'),

      // Rendered content — convenience copies so the tool does not need to read files
      prompt: z.string().describe('Rendered PROMPT.md content'),
      context: z.string().describe('Rendered CONTEXT.md content'),
    },
    async (args) => ({
      structuredContent: buildTurnResult(args),
    }),
  );

  // Create transport and handle the request
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  await mcpServer.connect(transport);

  // Clean up when the connection closes
  res.on('close', () => {
    void transport.close();
    void mcpServer.close();
  });

  await transport.handleRequest(req, res, body);
});

httpServer.listen(PORT, '127.0.0.1', () => {
  const addr = httpServer.address();
  console.log(`agentxchain-mcp-http-echo-agent listening on http://127.0.0.1:${addr.port}/mcp`);
  console.log('Press Ctrl+C to stop.');
});
