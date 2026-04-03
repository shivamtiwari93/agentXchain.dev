#!/usr/bin/env node

/**
 * agentxchain-mcp-echo-agent
 *
 * Minimal MCP server that implements the agentxchain_turn tool contract.
 * It reads the dispatched PROMPT.md and CONTEXT.md, then returns a valid
 * governed turn result with a summary that echoes the assignment.
 *
 * Usage with agentxchain:
 *
 *   In your agentxchain.json runtimes section:
 *   {
 *     "mcp-echo": {
 *       "type": "mcp",
 *       "command": "node",
 *       "args": ["./examples/mcp-echo-agent/server.js"],
 *       "tool_name": "agentxchain_turn"
 *     }
 *   }
 *
 * This is a reference implementation. Replace the echo logic with your
 * own agent logic to build a real governed MCP agent.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { readFileSync, existsSync } from 'fs';

const server = new McpServer({
  name: 'agentxchain-echo-agent',
  version: '1.0.0',
});

// Register the governed-turn tool with the exact contract the adapter expects.
server.tool(
  'agentxchain_turn',
  'Execute a governed AgentXchain turn. Receives assignment metadata, dispatch paths, and rendered prompt/context. Returns a valid turn-result object.',
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
  async (args) => {
    const {
      run_id, turn_id, role, phase, runtime_id,
      assignment_path, prompt, context,
    } = args;

    // Read the assignment for additional metadata (optional — the prompt
    // and context strings already contain the rendered content).
    let assignment = null;
    if (existsSync(assignment_path)) {
      try {
        assignment = JSON.parse(readFileSync(assignment_path, 'utf8'));
      } catch {
        // Non-fatal: assignment is supplementary
      }
    }

    const promptLines = prompt.split('\n').length;
    const contextLines = context.split('\n').length;

    // Build the turn result. This is the minimum viable governed turn result.
    // A real agent would do actual work here — read files, write code, run
    // tests — and report the results in this structure.
    const turnResult = {
      schema_version: '1.0',
      run_id,
      turn_id,
      role,
      runtime_id,
      status: 'completed',
      summary: `Echo agent completed ${role} turn in ${phase} phase. Received ${promptLines}-line prompt and ${contextLines}-line context.`,
      decisions: [
        {
          id: `echo-${turn_id}`,
          description: `Acknowledged assignment for ${role} in ${phase} phase.`,
          rationale: 'Echo agent confirms receipt of governed turn dispatch.',
        },
      ],
      objections: [],
      files_changed: [],
      artifacts_created: [],
      verification: {
        ran: false,
        passed: false,
        detail: 'Echo agent does not run verification. Replace with real test execution.',
      },
      artifact: assignment?.artifact || null,
      proposed_next_role: null,
      phase_transition_request: null,
      run_completion_request: null,
      needs_human_reason: null,
      cost: {
        input_tokens: 0,
        output_tokens: 0,
        usd: 0,
      },
    };

    // Return via structuredContent (preferred path).
    return {
      structuredContent: turnResult,
    };
  },
);

// Start the stdio transport
const transport = new StdioServerTransport();
await server.connect(transport);
