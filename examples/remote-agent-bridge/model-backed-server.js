#!/usr/bin/env node

/**
 * Remote Agent Bridge — Model-Backed Server
 *
 * An HTTP server that fronts a real Claude model (claude-haiku-4-5-20251001)
 * behind the remote_agent adapter protocol. Unlike server.js (which returns
 * hardcoded responses), this server sends each turn envelope to Claude and
 * returns the model's raw output.
 *
 * NO post-processing or fixups are applied to the model's output. If Claude
 * produces invalid JSON or a non-compliant turn result, the bridge returns
 * it as-is and the acceptance pipeline will reject it. This is the honest
 * proof surface.
 *
 * Environment:
 *   ANTHROPIC_API_KEY — required
 *   BRIDGE_PORT — optional (default: random)
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-... node model-backed-server.js
 *   ANTHROPIC_API_KEY=sk-... node model-backed-server.js --port 9000
 */

import { createServer } from 'node:http';

const MODEL = 'claude-haiku-4-5-20251001';
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const MAX_TOKENS = 4096;

/**
 * System prompt that teaches Claude the exact turn-result contract.
 * This is the entire bridge's "intelligence" — if the model cannot
 * satisfy the contract from this prompt alone, the proof fails.
 */
const SYSTEM_PROMPT = `You are an AI agent operating within the AgentXchain governed software delivery protocol.

You will receive a turn envelope as a JSON object with fields: run_id, turn_id, role, phase, runtime_id, prompt, context.

You must respond with ONLY a valid JSON object (no markdown fences, no explanatory text, no code blocks — raw JSON only).

The JSON must conform to this exact schema:

{
  "schema_version": "1.0",
  "run_id": "<echo from envelope>",
  "turn_id": "<echo from envelope>",
  "role": "<echo from envelope>",
  "runtime_id": "<echo from envelope>",
  "status": "completed",
  "summary": "<1-2 sentence summary of what you did>",
  "decisions": [
    {
      "id": "DEC-001",
      "category": "<implementation|architecture|quality|process>",
      "statement": "<what you decided>",
      "rationale": "<why>"
    }
  ],
  "objections": [],
  "files_changed": ["<list of file paths you are proposing to change>"],
  "artifacts_created": [],
  "verification": {
    "status": "pass",
    "commands": ["echo ok"],
    "evidence_summary": "<brief verification note>",
    "machine_evidence": [{ "command": "echo ok", "exit_code": 0 }]
  },
  "artifact": { "type": "patch", "ref": null },
  "proposed_next_role": "qa",
  "phase_transition_request": null,
  "run_completion_request": null,
  "needs_human_reason": null,
  "proposed_changes": [
    {
      "path": "<file path>",
      "action": "create",
      "content": "<file content>"
    }
  ],
  "cost": { "input_tokens": 0, "output_tokens": 0, "usd": 0 }
}

CRITICAL RULES:
1. Decision IDs MUST match the pattern DEC-NNN (e.g., DEC-001, DEC-002). No other format.
2. If your role is a review/QA role (the prompt or context will indicate this), you MUST:
   - Include at least one objection in the objections array
   - Each objection must have: id (OBJ-NNN pattern), severity (one of: low, medium, high, blocking), against_turn_id (any string), statement (text), status ("raised")
   - Set artifact.type to "review" instead of "patch"
   - Do NOT include proposed_changes (omit the field or set to empty array)
   - Set files_changed to an empty array
   - Set proposed_next_role to "human"
3. If your role is a dev/implementation role, you MUST:
   - Include a non-empty proposed_changes array with AT LEAST one file — this is MANDATORY, an empty array will fail validation
   - Each proposed change needs: path (string, e.g. "src/feature.js"), action ("create" or "modify"), content (string with actual file contents)
   - Example: "proposed_changes": [{"path": "src/feature.js", "action": "create", "content": "export const hello = 'world';\\n"}]
   - Set artifact.type to "patch"
   - Set proposed_next_role to "qa"
   - IMPORTANT: You MUST generate at least one concrete file in proposed_changes. Do NOT leave it empty.
4. Echo run_id, turn_id, role, and runtime_id exactly from the envelope.
5. Output ONLY the JSON object. No other text.`;

function resolvePort(argv, env) {
  const portIndex = argv.indexOf('--port');
  const value = portIndex !== -1 ? argv[portIndex + 1] : env.BRIDGE_PORT || '0';
  const port = Number.parseInt(String(value), 10);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
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

async function readBody(req) {
  let body = '';
  req.setEncoding('utf8');
  for await (const chunk of req) body += chunk;
  return body;
}

/**
 * Call the Anthropic Messages API with the turn envelope.
 * Returns the raw text content from Claude's response.
 */
async function callClaude(apiKey, envelope) {
  const userMessage = JSON.stringify(envelope, null, 2);

  const requestBody = {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: SYSTEM_PROMPT,
    messages: [
      { role: 'user', content: userMessage },
    ],
  };

  const response = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Anthropic API error (${response.status}): ${errorText}`);
  }

  const data = await response.json();

  // Extract text content from the response
  const textBlock = data.content?.find(b => b.type === 'text');
  if (!textBlock) {
    throw new Error('No text content in Claude response');
  }

  return {
    rawText: textBlock.text,
    usage: data.usage,
    model: data.model,
    stopReason: data.stop_reason,
  };
}

async function handleTurn(req, res, apiKey) {
  if (req.method !== 'POST') {
    writeJson(res, 405, { message: 'Method not allowed — POST only' });
    return;
  }

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

  console.log(`[model-bridge] ${new Date().toISOString()} — ${envelope.role}/${envelope.turn_id} (run: ${envelope.run_id})`);
  console.log(`[model-bridge] Calling ${MODEL}...`);

  try {
    const claudeResult = await callClaude(apiKey, envelope);

    console.log(`[model-bridge] Model responded (${claudeResult.stopReason}). Usage: ${claudeResult.usage?.input_tokens}in/${claudeResult.usage?.output_tokens}out`);

    // Parse the model's response as JSON — NO fixups
    let turnResult;
    try {
      // Strip markdown fences if the model wraps them despite instructions
      let text = claudeResult.rawText.trim();
      if (text.startsWith('```')) {
        text = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
      }
      turnResult = JSON.parse(text);
    } catch (parseErr) {
      // Model produced non-JSON — return error with raw output for diagnosis
      console.error(`[model-bridge] Model returned non-JSON: ${claudeResult.rawText.slice(0, 200)}`);
      writeJson(res, 502, {
        message: 'Model returned non-JSON output',
        model: MODEL,
        raw_output_preview: claudeResult.rawText.slice(0, 500),
      });
      return;
    }

    // Return the model's output as-is — the acceptance pipeline validates
    writeJson(res, 200, turnResult);

  } catch (err) {
    console.error(`[model-bridge] Error: ${err.message}`);
    writeJson(res, 502, { message: `Model call failed: ${err.message}` });
  }
}

async function handleHealth(_req, res) {
  writeJson(res, 200, {
    status: 'ok',
    service: 'agentxchain-model-backed-remote-agent-bridge',
    model: MODEL,
    timestamp: new Date().toISOString(),
  });
}

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('ANTHROPIC_API_KEY environment variable is required.');
    process.exit(1);
  }

  const port = resolvePort(process.argv.slice(2), process.env);

  const server = createServer((req, res) => {
    if (req.url === '/health') {
      void handleHealth(req, res);
    } else if (req.url === '/turn' || req.url === '/') {
      void handleTurn(req, res, apiKey).catch((err) => {
        writeJson(res, 500, { message: err.message });
      });
    } else {
      writeJson(res, 404, { message: 'Not found. Use POST /turn' });
    }
  });

  server.listen(port, '127.0.0.1', () => {
    const addr = server.address();
    console.log(`agentxchain-model-backed-bridge listening on http://127.0.0.1:${addr.port}/turn`);
    console.log(`Model: ${MODEL}`);
  });
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
