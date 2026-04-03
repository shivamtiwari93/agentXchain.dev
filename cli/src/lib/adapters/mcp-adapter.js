import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import {
  getDispatchAssignmentPath,
  getDispatchContextPath,
  getDispatchPromptPath,
  getDispatchTurnDir,
  getTurnStagingDir,
  getTurnStagingResultPath,
} from '../turn-paths.js';
import { verifyDispatchManifestForAdapter } from '../dispatch-manifest.js';

export const DEFAULT_MCP_TOOL_NAME = 'agentxchain_turn';

/**
 * Dispatch a governed turn to an MCP server over stdio.
 *
 * v1 scope:
 *   - stdio transport only
 *   - single tool call per turn
 *   - required governed-turn tool contract
 *   - synchronous dispatch/wait flow (like api_proxy)
 *
 * The MCP tool must return a valid AgentXchain turn result either as:
 *   - structuredContent, or
 *   - JSON text in a text content block
 */
export async function dispatchMcp(root, state, config, options = {}) {
  const { signal, onStatus, onStderr, turnId } = options;

  const turn = resolveTargetTurn(state, turnId);
  if (!turn) {
    return { ok: false, error: 'No active turn in state' };
  }

  const manifestCheck = verifyDispatchManifestForAdapter(root, turn.turn_id, options);
  if (!manifestCheck.ok) {
    return { ok: false, error: `Dispatch manifest verification failed: ${manifestCheck.error}` };
  }

  const runtimeId = turn.runtime_id;
  const runtime = config.runtimes?.[runtimeId];
  if (!runtime) {
    return { ok: false, error: `Runtime "${runtimeId}" not found in config` };
  }

  const promptPath = join(root, getDispatchPromptPath(turn.turn_id));
  const contextPath = join(root, getDispatchContextPath(turn.turn_id));
  if (!existsSync(promptPath)) {
    return { ok: false, error: 'Dispatch bundle not found. Run writeDispatchBundle() first.' };
  }

  const prompt = readFileSync(promptPath, 'utf8');
  const context = existsSync(contextPath) ? readFileSync(contextPath, 'utf8') : '';
  const { command, args } = resolveMcpCommand(runtime);
  if (!command) {
    return { ok: false, error: `Cannot resolve MCP command for runtime "${runtimeId}". Expected "command" field in runtime config.` };
  }

  const timeoutMs = turn.deadline_at
    ? Math.max(0, new Date(turn.deadline_at).getTime() - Date.now())
    : 1200000;
  const toolName = resolveMcpToolName(runtime);
  const logs = [];

  const stagingDir = join(root, getTurnStagingDir(turn.turn_id));
  mkdirSync(stagingDir, { recursive: true });

  const transport = new StdioClientTransport({
    command,
    args,
    cwd: runtime.cwd ? join(root, runtime.cwd) : root,
    env: buildTransportEnv(process.env),
    stderr: 'pipe',
  });

  if (transport.stderr) {
    transport.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      logs.push(`[stderr] ${text}`);
      if (onStderr) onStderr(text);
    });
  }

  const client = new Client({
    name: 'agentxchain-mcp-adapter',
    version: '1.0.0',
  });
  client.onerror = (error) => {
    logs.push(`[client-error] ${error.message}`);
  };
  transport.onerror = (error) => {
    logs.push(`[transport-error] ${error.message}`);
  };

  try {
    if (signal?.aborted) {
      return { ok: false, aborted: true, logs };
    }

    onStatus?.(`Connecting to MCP stdio server (${command})`);
    await client.connect(transport);

    if (signal?.aborted) {
      return { ok: false, aborted: true, logs };
    }

    onStatus?.(`Listing MCP tools`);
    const toolsResult = await client.listTools(undefined, {
      signal,
      timeout: timeoutMs,
      maxTotalTimeout: timeoutMs,
    });
    const toolNames = toolsResult.tools.map((tool) => tool.name);
    if (!toolNames.includes(toolName)) {
      return {
        ok: false,
        error: `MCP server does not expose required tool "${toolName}". Available tools: ${toolNames.join(', ') || '(none)'}`,
        logs,
      };
    }

    if (signal?.aborted) {
      return { ok: false, aborted: true, logs };
    }

    onStatus?.(`Calling MCP tool "${toolName}"`);
    const toolResult = await client.callTool({
      name: toolName,
      arguments: {
        run_id: state.run_id,
        turn_id: turn.turn_id,
        role: turn.assigned_role,
        phase: state.phase,
        runtime_id: runtimeId,
        project_root: root,
        dispatch_dir: join(root, getDispatchTurnDir(turn.turn_id)),
        assignment_path: join(root, getDispatchAssignmentPath(turn.turn_id)),
        prompt_path: promptPath,
        context_path: contextPath,
        staging_path: join(root, getTurnStagingResultPath(turn.turn_id)),
        prompt,
        context,
      },
    }, undefined, {
      signal,
      timeout: timeoutMs,
      maxTotalTimeout: timeoutMs,
      resetTimeoutOnProgress: true,
    });

    if (toolResult?.isError) {
      return {
        ok: false,
        error: buildMcpToolError(toolName, toolResult),
        logs,
      };
    }

    const turnResult = extractTurnResultFromMcpToolResult(toolResult);
    if (!turnResult.ok) {
      return { ok: false, error: turnResult.error, logs };
    }

    const stagingPath = join(root, getTurnStagingResultPath(turn.turn_id));
    writeFileSync(stagingPath, JSON.stringify(turnResult.result, null, 2));

    return {
      ok: true,
      toolName,
      logs,
    };
  } catch (error) {
    if (signal?.aborted) {
      return { ok: false, aborted: true, logs };
    }
    return {
      ok: false,
      error: `MCP dispatch failed: ${error.message}`,
      logs,
    };
  } finally {
    await safeCloseClient(client, transport);
  }
}

export function resolveMcpCommand(runtime) {
  if (!runtime?.command) return { command: null, args: [] };

  if (Array.isArray(runtime.command)) {
    const [command, ...args] = runtime.command;
    return { command, args };
  }

  return {
    command: runtime.command,
    args: Array.isArray(runtime.args) ? runtime.args : [],
  };
}

export function resolveMcpToolName(runtime) {
  return typeof runtime?.tool_name === 'string' && runtime.tool_name.trim()
    ? runtime.tool_name.trim()
    : DEFAULT_MCP_TOOL_NAME;
}

export function extractTurnResultFromMcpToolResult(toolResult) {
  const directCandidates = [
    toolResult?.structuredContent,
    toolResult?.toolResult?.structuredContent,
    toolResult?.toolResult,
  ];

  for (const candidate of directCandidates) {
    if (looksLikeTurnResult(candidate)) {
      return { ok: true, result: candidate };
    }
  }

  const textBlocks = [
    ...(Array.isArray(toolResult?.content) ? toolResult.content : []),
    ...(Array.isArray(toolResult?.toolResult?.content) ? toolResult.toolResult.content : []),
  ].filter((item) => item?.type === 'text' && typeof item.text === 'string');

  for (const block of textBlocks) {
    const parsed = tryParseJson(block.text);
    if (looksLikeTurnResult(parsed) || isPlainObject(parsed)) {
      return { ok: true, result: parsed };
    }
  }

  if (textBlocks.length === 0) {
    return {
      ok: false,
      error: 'MCP tool returned no structuredContent and no text content blocks containing a turn result.',
    };
  }

  return {
    ok: false,
    error: 'MCP tool returned text content, but none of the text blocks contained valid turn-result JSON.',
  };
}

function buildMcpToolError(toolName, toolResult) {
  const text = Array.isArray(toolResult?.content)
    ? toolResult.content
      .filter((item) => item?.type === 'text' && typeof item.text === 'string')
      .map((item) => item.text.trim())
      .filter(Boolean)
      .join(' ')
    : '';
  if (text) {
    return `MCP tool "${toolName}" returned an error: ${text}`;
  }
  return `MCP tool "${toolName}" returned an error without diagnostic text.`;
}

function buildTransportEnv(env) {
  const result = {};
  for (const [key, value] of Object.entries(env || {})) {
    if (typeof value === 'string') {
      result[key] = value;
    }
  }
  return result;
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function looksLikeTurnResult(value) {
  if (!isPlainObject(value)) return false;
  const hasIdentity = 'run_id' in value || 'turn_id' in value;
  const hasLifecycle = 'status' in value || 'role' in value || 'runtime_id' in value;
  return hasIdentity && hasLifecycle;
}

function tryParseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function resolveTargetTurn(state, turnId) {
  if (turnId && state?.active_turns?.[turnId]) {
    return state.active_turns[turnId];
  }
  return state?.current_turn || Object.values(state?.active_turns || {})[0];
}

async function safeCloseClient(client, transport) {
  try {
    await client.close();
    return;
  } catch {}

  try {
    await transport.close();
  } catch {}
}
