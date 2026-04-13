#!/usr/bin/env node
/**
 * Model Compatibility Probe — api_proxy + proposed write authority
 *
 * Dispatches a lightweight governed turn to each target model and records
 * whether the model can produce a well-formed turn result with proposed_changes.
 *
 * Usage:
 *   node cli/scripts/model-compatibility-probe.mjs
 *   node cli/scripts/model-compatibility-probe.mjs --json
 *
 * Requires ANTHROPIC_API_KEY in the environment.
 */

const ANTHROPIC_ENDPOINT = 'https://api.anthropic.com/v1/messages';

const SYSTEM_PROMPT = [
  'You are acting as a governed agent in an AgentXchain protocol run.',
  'Your task and rules are described in the user message.',
  'You MUST respond with a valid JSON object matching the turn result schema provided in the prompt.',
  'Do NOT wrap the JSON in markdown code fences. Respond with raw JSON only.',
].join('\n');

const PROBE_PROMPT = `You are a governed agent with write_authority: "proposed".

Your task: create a single file called \`probe-result.txt\` containing the text "model compatibility probe passed".

Respond with a single raw JSON object (no markdown fences) matching this exact schema:

{
  "schema_version": "1.0",
  "run_id": "probe_run",
  "turn_id": "probe_turn_001",
  "role": "dev",
  "runtime_id": "probe_runtime",
  "status": "completed",
  "summary": "Created probe-result.txt for model compatibility verification.",
  "decisions": [],
  "objections": [],
  "files_changed": ["probe-result.txt"],
  "verification": { "status": "pass", "evidence": "File created successfully." },
  "artifact": { "type": "patch", "ref": null },
  "proposed_next_role": "human",
  "proposed_changes": [
    {
      "path": "probe-result.txt",
      "action": "create",
      "content": "model compatibility probe passed"
    }
  ]
}

Return ONLY the JSON object. No explanation, no markdown fences, no extra text.`;

const MODELS = [
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5', maxTokens: 2048, costInput: 1.00, costOutput: 5.00 },
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6', maxTokens: 2048, costInput: 3.00, costOutput: 15.00 },
];

function extractTurnResult(text) {
  if (typeof text !== 'string' || !text.trim()) {
    return { ok: false, error: 'Empty response text' };
  }
  const trimmed = text.trim();

  // Direct JSON parse
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object' && parsed.schema_version) {
      return { ok: true, turnResult: parsed, method: 'direct' };
    }
  } catch { /* not pure JSON */ }

  // Markdown fence extraction
  const fenceMatch = trimmed.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  if (fenceMatch) {
    try {
      const parsed = JSON.parse(fenceMatch[1].trim());
      if (parsed && typeof parsed === 'object' && parsed.schema_version) {
        return { ok: true, turnResult: parsed, method: 'fence' };
      }
    } catch { /* invalid JSON inside fence */ }
  }

  // Substring extraction
  const jsonStart = trimmed.indexOf('{');
  const jsonEnd = trimmed.lastIndexOf('}');
  if (jsonStart >= 0 && jsonEnd > jsonStart) {
    try {
      const parsed = JSON.parse(trimmed.slice(jsonStart, jsonEnd + 1));
      if (parsed && typeof parsed === 'object' && parsed.schema_version) {
        return { ok: true, turnResult: parsed, method: 'substring' };
      }
    } catch { /* not valid JSON */ }
  }

  return { ok: false, error: 'Could not extract structured turn result JSON' };
}

function validateProposedChanges(turnResult) {
  const changes = turnResult?.proposed_changes;
  if (!Array.isArray(changes) || changes.length === 0) {
    return { present: false, wellFormed: false, reason: 'proposed_changes missing or empty' };
  }
  for (const c of changes) {
    if (!c.path || typeof c.path !== 'string') {
      return { present: true, wellFormed: false, reason: `entry missing path` };
    }
    if (!['create', 'modify', 'delete'].includes(c.action)) {
      return { present: true, wellFormed: false, reason: `invalid action: ${c.action}` };
    }
    if ((c.action === 'create' || c.action === 'modify') && (!c.content || typeof c.content !== 'string')) {
      return { present: true, wellFormed: false, reason: `${c.action} entry missing content for ${c.path}` };
    }
  }
  return { present: true, wellFormed: true, count: changes.length };
}

async function probeModel(model, apiKey) {
  const startMs = Date.now();
  const body = {
    model: model.id,
    max_tokens: model.maxTokens,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: PROBE_PROMPT }],
  };

  let responseData;
  let rawError = null;

  try {
    const res = await fetch(ANTHROPIC_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errorBody = await res.text().catch(() => '');
      rawError = `HTTP ${res.status}: ${errorBody.slice(0, 500)}`;
      return {
        model: model.id,
        label: model.label,
        extraction_success: false,
        schema_valid: false,
        proposed_changes_present: false,
        proposed_changes_well_formed: false,
        latency_ms: Date.now() - startMs,
        cost_usd: 0,
        classification: 'unsupported',
        raw_error: rawError,
      };
    }

    responseData = await res.json();
  } catch (err) {
    return {
      model: model.id,
      label: model.label,
      extraction_success: false,
      schema_valid: false,
      proposed_changes_present: false,
      proposed_changes_well_formed: false,
      latency_ms: Date.now() - startMs,
      cost_usd: 0,
      classification: 'unsupported',
      raw_error: err.message,
    };
  }

  const latencyMs = Date.now() - startMs;

  // Extract text from Anthropic response
  const textBlock = responseData?.content?.find(b => b.type === 'text');
  const responseText = textBlock?.text || '';

  // Extract turn result
  const extraction = extractTurnResult(responseText);

  // Calculate cost
  const usage = responseData?.usage || {};
  const inputTokens = usage.input_tokens || 0;
  const outputTokens = usage.output_tokens || 0;
  const costUsd = (inputTokens / 1_000_000) * model.costInput + (outputTokens / 1_000_000) * model.costOutput;

  if (!extraction.ok) {
    return {
      model: model.id,
      label: model.label,
      extraction_success: false,
      extraction_method: null,
      schema_valid: false,
      proposed_changes_present: false,
      proposed_changes_well_formed: false,
      latency_ms: latencyMs,
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cost_usd: Math.round(costUsd * 1_000_000) / 1_000_000,
      classification: 'unsupported',
      raw_error: extraction.error,
      response_preview: responseText.slice(0, 300),
    };
  }

  const tr = extraction.turnResult;
  const schemaValid = typeof tr.schema_version === 'string' && tr.schema_version === '1.0';
  const pcValidation = validateProposedChanges(tr);

  let classification;
  if (schemaValid && pcValidation.present && pcValidation.wellFormed) {
    classification = 'reliable';
  } else if (extraction.ok && (!pcValidation.present || !pcValidation.wellFormed)) {
    classification = 'inconsistent';
  } else {
    classification = 'unsupported';
  }

  return {
    model: model.id,
    label: model.label,
    extraction_success: true,
    extraction_method: extraction.method,
    schema_valid: schemaValid,
    proposed_changes_present: pcValidation.present,
    proposed_changes_well_formed: pcValidation.wellFormed,
    proposed_changes_count: pcValidation.count || 0,
    latency_ms: latencyMs,
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cost_usd: Math.round(costUsd * 1_000_000) / 1_000_000,
    classification,
    raw_error: pcValidation.reason || null,
    status_returned: tr.status,
    summary_returned: typeof tr.summary === 'string' ? tr.summary.slice(0, 100) : null,
  };
}

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('ANTHROPIC_API_KEY not set');
    process.exit(1);
  }

  const jsonMode = process.argv.includes('--json');

  if (!jsonMode) {
    console.log('AgentXchain Model Compatibility Probe');
    console.log('Provider: Anthropic | Write Authority: proposed');
    console.log('─'.repeat(60));
  }

  const results = [];

  for (const model of MODELS) {
    if (!jsonMode) {
      process.stdout.write(`Probing ${model.label} (${model.id})... `);
    }

    const result = await probeModel(model, apiKey);
    results.push(result);

    if (!jsonMode) {
      const icon = result.classification === 'reliable' ? '✓' : result.classification === 'inconsistent' ? '~' : '✗';
      console.log(`${icon} ${result.classification} (${result.latency_ms}ms, $${result.cost_usd})`);
      if (result.raw_error) {
        console.log(`  └─ ${result.raw_error}`);
      }
    }
  }

  const output = {
    probe_version: '1.0',
    timestamp: new Date().toISOString(),
    provider: 'anthropic',
    write_authority: 'proposed',
    models: results,
    total_cost_usd: results.reduce((s, r) => s + r.cost_usd, 0),
  };

  if (jsonMode) {
    console.log(JSON.stringify(output, null, 2));
  } else {
    console.log('─'.repeat(60));
    console.log(`Total cost: $${output.total_cost_usd.toFixed(6)}`);
    console.log();
    console.log('Matrix:');
    for (const r of results) {
      console.log(`  ${r.label.padEnd(12)} ${r.classification.padEnd(14)} extraction=${r.extraction_success} schema=${r.schema_valid} proposed=${r.proposed_changes_well_formed}`);
    }
  }

  // Write results to .planning/ for durable reference
  const { writeFileSync, mkdirSync } = await import('node:fs');
  const { dirname, join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const outPath = join(repoRoot, '.planning', 'MODEL_COMPATIBILITY_RESULTS.json');
  writeFileSync(outPath, JSON.stringify(output, null, 2) + '\n');
  if (!jsonMode) {
    console.log(`\nResults written to: .planning/MODEL_COMPATIBILITY_RESULTS.json`);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
