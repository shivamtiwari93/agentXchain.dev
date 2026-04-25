/**
 * agentxchain serve-mcp — start an MCP server exposing governance tools.
 *
 * Runs a stdio-based MCP server that lets any MCP-compatible client
 * (Claude Code, Cursor, Windsurf, VS Code extensions, etc.) interact
 * with a governed AgentXchain project.
 *
 * Usage:
 *   agentxchain serve-mcp [--root <project-root>]
 *
 * The server reads JSON-RPC from stdin and writes responses to stdout,
 * per the MCP specification.
 */

import { resolve } from 'path';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createAgentXchainMcpServer } from '../lib/mcp-server.js';
import { findProjectRoot } from '../lib/config.js';

export async function serveMcpCommand(opts) {
  const rootHint = opts.root || process.cwd();
  const root = findProjectRoot(resolve(rootHint));

  if (!root) {
    // Even without a governed project, start the server so MCP clients
    // get descriptive tool errors instead of a connection-refused.
    process.stderr.write(
      `[agentxchain serve-mcp] Warning: no agentxchain.json found at ${rootHint}. ` +
      `Tools will return errors until a governed project is available.\n`,
    );
  }

  const projectRoot = root || resolve(rootHint);
  const server = createAgentXchainMcpServer(projectRoot);
  const transport = new StdioServerTransport();

  process.stderr.write(`[agentxchain serve-mcp] Starting MCP server for ${projectRoot}\n`);

  await server.connect(transport);
}
