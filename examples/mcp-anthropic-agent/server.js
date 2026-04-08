#!/usr/bin/env node

/**
 * agentxchain-mcp-anthropic-agent
 *
 * MCP server that implements the agentxchain_turn tool contract backed by
 * the real Anthropic Messages API. Unlike the echo agent, this server sends
 * the rendered prompt and context to Claude and returns the model's actual
 * turn-result JSON.
 *
 * Usage with agentxchain:
 *
 *   In your agentxchain.json runtimes section:
 *   {
 *     "mcp-anthropic": {
 *       "type": "mcp",
 *       "command": "node",
 *       "args": ["./examples/mcp-anthropic-agent/server.js"],
 *       "tool_name": "agentxchain_turn"
 *     }
 *   }
 *
 * Environment variables:
 *   ANTHROPIC_API_KEY   (required) — Anthropic API key
 *   ANTHROPIC_MODEL     (optional, default: claude-haiku-4-5-20251001)
 *   ANTHROPIC_MAX_TOKENS (optional, default: 4096)
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';
const DEFAULT_MAX_TOKENS = 4096;

const SYSTEM_PROMPT = [
  'You are acting as a governed agent in an AgentXchain protocol run.',
  'Your task and rules are described in the user message.',
  'You MUST respond with a valid JSON object matching the turn result schema provided in the prompt.',
  'Do NOT wrap the JSON in markdown code fences. Respond with raw JSON only.',
].join('\n');

const SEPARATOR = '\n\n---\n\n';

/**
 * Call the Anthropic Messages API and return the raw response.
 */
async function callAnthropic(prompt, context, apiKey) {
  const model = process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;
  const maxTokens = parseInt(process.env.ANTHROPIC_MAX_TOKENS, 10) || DEFAULT_MAX_TOKENS;

  const userContent = context
    ? `${prompt}${SEPARATOR}${context}`
    : prompt;

  const response = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userContent }],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '(no body)');
    throw new Error(`Anthropic API ${response.status}: ${errorText}`);
  }

  return response.json();
}

/**
 * Extract turn-result JSON from an Anthropic response.
 * Mirrors the extraction logic in api-proxy-adapter.js.
 */
function extractTurnResultFromResponse(responseData) {
  if (!responseData?.content || !Array.isArray(responseData.content)) {
    return { ok: false, error: 'API response has no content blocks' };
  }

  const textBlock = responseData.content.find((b) => b.type === 'text');
  if (!textBlock?.text) {
    return { ok: false, error: 'API response has no text content block' };
  }

  const text = textBlock.text.trim();

  // Try raw JSON first
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && parsed.schema_version) {
      return { ok: true, result: parsed };
    }
  } catch {
    // Not pure JSON — try markdown fences
  }

  // Try JSON inside markdown fences
  const fenceMatch = text.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  if (fenceMatch) {
    try {
      const parsed = JSON.parse(fenceMatch[1].trim());
      if (parsed && typeof parsed === 'object' && parsed.schema_version) {
        return { ok: true, result: parsed };
      }
    } catch {
      // Invalid JSON inside fence
    }
  }

  // Try extracting first JSON object
  const jsonStart = text.indexOf('{');
  const jsonEnd = text.lastIndexOf('}');
  if (jsonStart >= 0 && jsonEnd > jsonStart) {
    try {
      const parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1));
      if (parsed && typeof parsed === 'object' && parsed.schema_version) {
        return { ok: true, result: parsed };
      }
    } catch {
      // Not valid JSON
    }
  }

  return {
    ok: false,
    error: `Model returned text but no valid turn-result JSON. First 500 chars: ${text.slice(0, 500)}`,
  };
}

/**
 * Ensure identity fields are present in the turn result.
 * Models sometimes omit or return placeholder identity fields;
 * we inject the real values from the tool call arguments.
 */
function ensureIdentityFields(result, args) {
  result.run_id = args.run_id;
  result.turn_id = args.turn_id;
  result.role = args.role;
  result.runtime_id = args.runtime_id;
  return result;
}

// ── MCP Server ────────────────────────────────────────────────────────────

const server = new McpServer({
  name: 'agentxchain-mcp-anthropic-agent',
  version: '1.0.0',
});

server.tool(
  'agentxchain_turn',
  'Execute a governed AgentXchain turn backed by a real Anthropic AI model. Receives assignment metadata, dispatch paths, and rendered prompt/context. Calls Claude and returns the model turn result.',
  {
    run_id: z.string().describe('Current run identifier'),
    turn_id: z.string().describe('Current turn identifier'),
    role: z.string().describe('Assigned role for this turn'),
    phase: z.string().describe('Current governed phase (planning, implementation, qa)'),
    runtime_id: z.string().describe('Runtime identifier from config'),
    project_root: z.string().describe('Absolute path to the project root'),
    dispatch_dir: z.string().describe('Absolute path to the dispatch turn directory'),
    assignment_path: z.string().describe('Absolute path to ASSIGNMENT.json'),
    prompt_path: z.string().describe('Absolute path to PROMPT.md'),
    context_path: z.string().describe('Absolute path to CONTEXT.md'),
    staging_path: z.string().describe('Absolute path where the adapter will write the staged result'),
    prompt: z.string().describe('Rendered PROMPT.md content'),
    context: z.string().describe('Rendered CONTEXT.md content'),
  },
  async (args) => {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              error: 'ANTHROPIC_API_KEY environment variable is required',
            }),
          },
        ],
        isError: true,
      };
    }

    try {
      const responseData = await callAnthropic(args.prompt, args.context, apiKey);

      const extraction = extractTurnResultFromResponse(responseData);
      if (!extraction.ok) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: extraction.error }) }],
          isError: true,
        };
      }

      const turnResult = ensureIdentityFields(extraction.result, args);

      // Attach model cost if available from the API response
      if (responseData.usage) {
        turnResult.cost = {
          input_tokens: responseData.usage.input_tokens || 0,
          output_tokens: responseData.usage.output_tokens || 0,
          usd: 0, // Caller can compute from cost rates
        };
      }

      return { structuredContent: turnResult };
    } catch (error) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: error.message }) }],
        isError: true,
      };
    }
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
