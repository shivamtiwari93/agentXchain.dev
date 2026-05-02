#!/usr/bin/env node

/**
 * agentxchain-mcp-echo-agent
 *
 * Minimal MCP server that implements the agentxchain_turn tool contract.
 * It reads the dispatched PROMPT.md and CONTEXT.md, then returns a
 * validator-clean governed turn result with a summary that echoes
 * the assignment.
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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';

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
      project_root, assignment_path, prompt, context,
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
    const writesWorkspace = role === 'dev' && phase === 'implementation';
    const filesChanged = writesWorkspace ? ['src/mcp-echo-agent-output.js'] : [];
    if (writesWorkspace) {
      const outputPath = join(project_root, filesChanged[0]);
      mkdirSync(dirname(outputPath), { recursive: true });
      writeFileSync(
        outputPath,
        `export const mcpEchoAgentTurn = ${JSON.stringify(turn_id)};\n`,
      );
    }

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
          id: 'DEC-001',
          category: 'implementation',
          statement: writesWorkspace
            ? `Acknowledge ${role} assignment for the ${phase} phase and write a minimal workspace artifact.`
            : `Acknowledge ${role} assignment for the ${phase} phase without modifying product files.`,
          rationale: writesWorkspace
            ? 'Implementation-phase dev turns must declare a product file, even for the reference echo transport.'
            : 'The echo server is a transport reference, not a real worker.',
        },
      ],
      objections: [
        {
          id: 'OBJ-001',
          severity: 'low',
          statement: 'No-op MCP example does not perform real implementation or verification work.',
          status: 'raised',
        },
      ],
      files_changed: filesChanged,
      artifacts_created: [],
      verification: {
        status: 'skipped',
        commands: [],
        evidence_summary: 'Echo agent intentionally skips verification. Replace with real test execution.',
        machine_evidence: [],
      },
      artifact: writesWorkspace
        ? { type: 'workspace', ref: 'git:dirty' }
        : assignment?.artifact || { type: 'review', ref: assignment_path },
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

    // Return via structuredContent (preferred path).
    return {
      structuredContent: turnResult,
    };
  },
);

// Start the stdio transport
const transport = new StdioServerTransport();
await server.connect(transport);
