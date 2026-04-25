/**
 * AgentXchain MCP Server — exposes governance operations as MCP tools.
 *
 * This module creates an MCP server that lets any MCP-compatible client
 * (Claude Code, Cursor, Windsurf, VS Code extensions, etc.) natively
 * query run status, approve gates, read events/history, and record
 * intake events against a governed AgentXchain project.
 *
 * The existing mcp-adapter.js is the inverse: AgentXchain as an MCP client
 * dispatching turns TO an MCP server. This module makes AgentXchain itself
 * the server.
 *
 * Spec: .planning/SPEC-MCP-SERVER.md
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import * as z from 'zod/v4';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { findProjectRoot, loadProjectContext, loadProjectState } from './config.js';
import { readRunEvents } from './run-events.js';
import { queryRunHistory } from './run-history.js';
import { getActiveTurns } from './governed-state.js';
import { getOpenHumanEscalation, findCurrentHumanEscalation } from './human-escalations.js';
import { readContinuousSession } from './continuous-run.js';

const SERVER_NAME = 'agentxchain';
const SERVER_VERSION = '1.0.0';

/**
 * Create and configure the AgentXchain MCP server.
 *
 * @param {string} root - Absolute path to the project root.
 * @returns {McpServer} Configured MCP server (not yet connected to a transport).
 */
export function createAgentXchainMcpServer(root) {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
      instructions:
        'AgentXchain governance server. Use tools to query governed run status, ' +
        'read events and history, approve human gates, and record intake events.',
    },
  );

  registerTools(server, root);
  registerResources(server, root);

  return server;
}

// ── Tools ──────────────────────────────────────────────────────────────────

function registerTools(server, root) {
  server.tool(
    'agentxchain_status',
    'Read current governed project and run status',
    {},
    () => handleStatus(root),
  );

  server.tool(
    'agentxchain_events',
    'Read recent events from the governed project event log',
    { limit: z.number().optional().describe('Max events to return (default 50)') },
    (args) => handleEvents(root, args),
  );

  server.tool(
    'agentxchain_history',
    'Read run history entries',
    { limit: z.number().optional().describe('Max history entries to return (default 20)') },
    (args) => handleHistory(root, args),
  );

  server.tool(
    'agentxchain_approve_gate',
    'Approve a pending human gate/escalation to unblock a governed run',
    {
      gate_id: z.string().describe('The escalation ID to approve (e.g. hesc_abc123)'),
      reason: z.string().optional().describe('Optional reason for approval'),
    },
    (args) => handleApproveGate(root, args),
  );

  server.tool(
    'agentxchain_intake_record',
    'Record a new intake event for the governed project',
    {
      source: z.string().describe('Event source (e.g. manual, ci_failure, schedule)'),
      title: z.string().describe('Short title for the intake event'),
      description: z.string().optional().describe('Detailed description'),
      priority: z.string().optional().describe('Priority level (e.g. high, medium, low)'),
    },
    (args) => handleIntakeRecord(root, args),
  );
}

// ── Resources ──────────────────────────────────────────────────────────────

function registerResources(server, root) {
  server.resource(
    'governed-state',
    'agentxchain://state',
    { description: 'Current .agentxchain/state.json contents', mimeType: 'application/json' },
    () => handleReadState(root),
  );

  server.resource(
    'continuous-session',
    'agentxchain://session',
    { description: 'Current .agentxchain/continuous-session.json contents', mimeType: 'application/json' },
    () => handleReadSession(root),
  );
}

// ── Tool handlers ──────────────────────────────────────────────────────────

function handleStatus(root) {
  const context = loadProjectContext(root);
  if (!context) {
    return toolResult({ ok: false, error: `No governed project found at ${root}` });
  }

  const { config } = context;
  const state = loadProjectState(root, config);

  const result = {
    ok: true,
    project: config.project || null,
    protocol_mode: config.protocol_mode || null,
    run_id: state?.run_id || null,
    phase: state?.phase || null,
    status: state?.status || null,
    active_turns: state ? getActiveTurnsSummary(state) : [],
    pending_gates: state?.blocked_reason?.type || null,
    blocked: state?.status === 'blocked',
    blocked_on: state?.blocked_on || null,
  };

  const session = readContinuousSession(root);
  if (session) {
    result.continuous = {
      session_id: session.session_id || null,
      status: session.status || null,
      runs_completed: session.runs_completed || 0,
      idle_cycles: session.idle_cycles || 0,
    };
  }

  return toolResult(result);
}

function handleEvents(root, args) {
  const context = loadProjectContext(root);
  if (!context) {
    return toolResult({ ok: false, error: `No governed project found at ${root}` });
  }

  const limit = typeof args.limit === 'number' && args.limit > 0 ? args.limit : 50;
  const events = readRunEvents(root, { limit });

  return toolResult({ ok: true, count: events.length, events });
}

function handleHistory(root, args) {
  const context = loadProjectContext(root);
  if (!context) {
    return toolResult({ ok: false, error: `No governed project found at ${root}` });
  }

  const limit = typeof args.limit === 'number' && args.limit > 0 ? args.limit : 20;
  const entries = queryRunHistory(root, { limit });

  return toolResult({ ok: true, count: entries.length, entries });
}

function handleApproveGate(root, args) {
  const context = loadProjectContext(root);
  if (!context) {
    return toolResult({ ok: false, error: `No governed project found at ${root}` });
  }

  const { config } = context;
  const state = loadProjectState(root, config);
  if (!state) {
    return toolResult({ ok: false, error: 'No governed state found.' });
  }

  const gateId = typeof args.gate_id === 'string' ? args.gate_id.trim() : '';
  if (!gateId) {
    return toolResult({ ok: false, error: 'gate_id is required.' });
  }

  if (state.status !== 'blocked') {
    return toolResult({
      ok: false,
      error: `Run is not blocked (status: "${state.status}"). Nothing to approve.`,
    });
  }

  const escalation = getOpenHumanEscalation(root, gateId);
  if (!escalation) {
    return toolResult({ ok: false, error: `No open escalation found for ${gateId}.` });
  }

  const current = findCurrentHumanEscalation(root, state);
  if (!current || current.escalation_id !== escalation.escalation_id) {
    return toolResult({
      ok: false,
      error: `${gateId} is not the current blocker for this run.`,
    });
  }

  // We return the gate info rather than performing the unblock directly,
  // because unblock has side-effects (resume) that should be explicit.
  // The caller should use the CLI `agentxchain unblock <id>` for the actual mutation.
  return toolResult({
    ok: true,
    gate_id: gateId,
    type: escalation.type,
    detail: escalation.detail || null,
    instruction: `Gate ${gateId} is the current blocker. Run "agentxchain unblock ${gateId}" to approve and resume.`,
  });
}

function handleIntakeRecord(root, args) {
  const context = loadProjectContext(root);
  if (!context) {
    return toolResult({ ok: false, error: `No governed project found at ${root}` });
  }

  const source = typeof args.source === 'string' ? args.source.trim() : '';
  const title = typeof args.title === 'string' ? args.title.trim() : '';

  if (!source || !title) {
    return toolResult({ ok: false, error: 'Both source and title are required.' });
  }

  // Similar to approve_gate: we expose the information needed to record,
  // but defer the actual mutation to the intake pipeline.
  // Direct mutation via MCP would bypass the CLI's validation and event emission.
  return toolResult({
    ok: true,
    instruction: `Use "agentxchain intake record --source ${source} --title '${title}'${args.description ? ` --description '${args.description}'` : ''}${args.priority ? ` --priority ${args.priority}` : ''}" to record this event.`,
    source,
    title,
    description: args.description || null,
    priority: args.priority || null,
  });
}

// ── Resource handlers ──────────────────────────────────────────────────────

function handleReadState(root) {
  const statePath = join(root, '.agentxchain', 'state.json');
  if (!existsSync(statePath)) {
    return { contents: [{ uri: 'agentxchain://state', text: '{}', mimeType: 'application/json' }] };
  }
  try {
    const text = readFileSync(statePath, 'utf8');
    return { contents: [{ uri: 'agentxchain://state', text, mimeType: 'application/json' }] };
  } catch {
    return { contents: [{ uri: 'agentxchain://state', text: '{}', mimeType: 'application/json' }] };
  }
}

function handleReadSession(root) {
  const sessionPath = join(root, '.agentxchain', 'continuous-session.json');
  if (!existsSync(sessionPath)) {
    return { contents: [{ uri: 'agentxchain://session', text: '{}', mimeType: 'application/json' }] };
  }
  try {
    const text = readFileSync(sessionPath, 'utf8');
    return { contents: [{ uri: 'agentxchain://session', text, mimeType: 'application/json' }] };
  } catch {
    return { contents: [{ uri: 'agentxchain://session', text: '{}', mimeType: 'application/json' }] };
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function getActiveTurnsSummary(state) {
  try {
    const turns = getActiveTurns(state);
    return turns.map((t) => ({
      turn_id: t.turn_id,
      role: t.assigned_role,
      status: t.status,
      phase: t.phase,
    }));
  } catch {
    return [];
  }
}

function toolResult(data) {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
  };
}
