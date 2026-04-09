#!/usr/bin/env node

/**
 * Remote Agent Bridge — Example Server
 *
 * A runnable HTTP server that accepts governed turn envelopes from the
 * AgentXchain `remote_agent` adapter and returns valid turn-result JSON.
 *
 * This is NOT a stub or mock. It receives the same envelope that a real
 * remote agent service would receive and returns structurally valid
 * turn results that the acceptance pipeline will process.
 *
 * Usage:
 *   node server.js                      # listen on port 8799
 *   node server.js --port 9000          # custom port
 *   BRIDGE_TOKEN=secret node server.js  # require Bearer auth
 *
 * The server handles two write-authority modes:
 *   - review_only: returns a review turn result (no proposed_changes)
 *   - proposed: returns a turn result with proposed_changes[]
 *
 * It determines the mode from the role in the incoming envelope:
 *   - "qa" → review_only
 *   - anything else → proposed (with example file changes)
 */

import { createServer } from 'node:http';

const DEFAULT_PORT = 8799;

function resolvePort(argv, env) {
  const portIndex = argv.indexOf('--port');
  const value = portIndex !== -1 ? argv[portIndex + 1] : env.PORT || DEFAULT_PORT;
  const port = Number.parseInt(String(value), 10);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid port "${value}"`);
  }
  return port;
}

function writeJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'content-type': 'application/json',
    connection: 'close',
  });
  res.end(JSON.stringify(payload, null, 2));
}

function requireBearerToken(req, res, expectedToken) {
  if (!expectedToken) return true;
  if (req.headers.authorization !== `Bearer ${expectedToken}`) {
    writeJson(res, 401, { message: 'Unauthorized' });
    return false;
  }
  return true;
}

async function readBody(req) {
  let body = '';
  req.setEncoding('utf8');
  for await (const chunk of req) body += chunk;
  return body;
}

/**
 * Build a proposed-authoring turn result (dev role).
 * Returns proposed_changes[] instead of claiming direct workspace writes.
 */
function buildProposedResult(envelope) {
  return {
    schema_version: '1.0',
    run_id: envelope.run_id,
    turn_id: envelope.turn_id,
    role: envelope.role || 'dev',
    runtime_id: envelope.runtime_id || 'remote-bridge',
    status: 'completed',
    summary: `Remote bridge proposed changes for ${envelope.role || 'dev'} turn.`,
    decisions: [{
      id: 'DEC-001',
      category: 'implementation',
      statement: 'Proposed file changes through the remote_agent bridge.',
      rationale: 'remote_agent v1 uses proposed write authority — changes are staged for review.',
    }],
    objections: [],
    files_changed: ['src/bridge-feature.js'],
    artifacts_created: [],
    verification: {
      status: 'pass',
      commands: ['echo bridge-ok'],
      evidence_summary: 'remote bridge proposal staged',
      machine_evidence: [{ command: 'echo bridge-ok', exit_code: 0 }],
    },
    artifact: { type: 'patch', ref: null },
    proposed_next_role: 'qa',
    phase_transition_request: null,
    run_completion_request: null,
    needs_human_reason: null,
    proposed_changes: [
      {
        path: 'src/bridge-feature.js',
        action: 'create',
        content: '// Created by remote agent bridge example\nexport const bridgeFeature = "delivered";\n',
      },
    ],
    cost: { input_tokens: 100, output_tokens: 150, usd: 0.005 },
  };
}

/**
 * Build a review-only turn result (qa role).
 * Returns a review without proposed_changes.
 */
function buildReviewResult(envelope) {
  return {
    schema_version: '1.0',
    run_id: envelope.run_id,
    turn_id: envelope.turn_id,
    role: envelope.role || 'qa',
    runtime_id: envelope.runtime_id || 'remote-bridge',
    status: 'completed',
    summary: 'Remote bridge QA review completed.',
    decisions: [{
      id: 'DEC-002',
      category: 'quality',
      statement: 'Reviewed proposed changes through the remote_agent bridge.',
      rationale: 'review_only turns derive audit artifacts without claiming repo writes.',
    }],
    objections: [{
      id: 'OBJ-001',
      severity: 'low',
      against_turn_id: 'turn_prev',
      statement: 'Consider adding negative-path test coverage for the remote bridge.',
      status: 'raised',
    }],
    files_changed: [],
    artifacts_created: [],
    verification: {
      status: 'pass',
      commands: ['echo review-ok'],
      evidence_summary: 'remote bridge review passed',
      machine_evidence: [{ command: 'echo review-ok', exit_code: 0 }],
    },
    artifact: { type: 'review', ref: null },
    proposed_next_role: 'human',
    phase_transition_request: null,
    run_completion_request: null,
    needs_human_reason: null,
    cost: { input_tokens: 80, output_tokens: 120, usd: 0.003 },
  };
}

async function handleTurn(req, res, token) {
  if (req.method !== 'POST') {
    writeJson(res, 405, { message: 'Method not allowed — POST only' });
    return;
  }

  if (!requireBearerToken(req, res, token)) return;

  let envelope;
  try {
    envelope = JSON.parse(await readBody(req));
  } catch (err) {
    writeJson(res, 400, { message: `Invalid JSON: ${err.message}` });
    return;
  }

  if (!envelope.run_id || !envelope.turn_id) {
    writeJson(res, 400, { message: 'Missing required fields: run_id, turn_id' });
    return;
  }

  console.log(`[bridge] ${new Date().toISOString()} — ${envelope.role}/${envelope.turn_id} (run: ${envelope.run_id})`);

  const result = envelope.role === 'qa'
    ? buildReviewResult(envelope)
    : buildProposedResult(envelope);

  writeJson(res, 200, result);
}

async function handleHealth(_req, res) {
  writeJson(res, 200, {
    status: 'ok',
    service: 'agentxchain-remote-agent-bridge-example',
    timestamp: new Date().toISOString(),
  });
}

async function main() {
  const port = resolvePort(process.argv.slice(2), process.env);
  const token = process.env.BRIDGE_TOKEN || null;

  const server = createServer((req, res) => {
    if (req.url === '/health') {
      void handleHealth(req, res);
    } else if (req.url === '/turn' || req.url === '/') {
      void handleTurn(req, res, token).catch((err) => {
        writeJson(res, 500, { message: err.message });
      });
    } else {
      writeJson(res, 404, { message: 'Not found. Use POST /turn' });
    }
  });

  server.listen(port, '127.0.0.1', () => {
    console.log(`agentxchain-remote-agent-bridge listening on http://127.0.0.1:${port}/turn`);
    if (token) console.log('Bearer auth enabled via BRIDGE_TOKEN.');
  });
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
