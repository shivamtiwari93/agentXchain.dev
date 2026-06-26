/**
 * Stream-JSON cost parser — extracts usage/cost metadata from Claude Code's
 * stream-json NDJSON stdout output.
 *
 * Claude Code with `--output-format stream-json --verbose` emits newline-
 * delimited JSON events.  The final `result` event contains a `usage` object
 * with `input_tokens`, `output_tokens`, and optionally cache token counts,
 * plus a top-level `cost_usd` and `model` field.
 *
 * This parser accumulates stdout chunks, splits by newline, parses each
 * complete line as JSON, and stores the last `result` event's cost data.
 *
 * Resilience guarantees:
 *   - Partial JSON lines are buffered until the next newline arrives.
 *   - Non-JSON lines are silently skipped (no throw, no error log).
 *   - Multiple `result` events: last one wins.
 *   - Missing `usage` in a `result` event: getResult() returns null.
 */

// Claude-specific bundled cost rates (USD per million tokens).
// Duplicated from api-proxy-adapter.js for this module's use only — DEC-004
// defers extraction to a shared module.
const CLAUDE_COST_RATES = {
  'claude-sonnet-4-6': { input_per_1m: 3.00, output_per_1m: 15.00 },
  'claude-opus-4-6': { input_per_1m: 5.00, output_per_1m: 25.00 },
  'claude-haiku-4-5-20251001': { input_per_1m: 1.00, output_per_1m: 5.00 },
};

/**
 * Resolve cost rates for a model. Checks operator-supplied overrides first,
 * then falls back to the bundled Claude rates.
 *
 * @param {string} model
 * @param {object} [config]
 * @returns {{ input_per_1m: number, output_per_1m: number } | null}
 */
export function getClaudeCostRates(model, config) {
  const operatorRates = config?.budget?.cost_rates;
  if (operatorRates && typeof operatorRates === 'object' && operatorRates[model]) {
    const r = operatorRates[model];
    if (Number.isFinite(r.input_per_1m) && Number.isFinite(r.output_per_1m)) {
      return r;
    }
  }
  return CLAUDE_COST_RATES[model] || null;
}

/**
 * @typedef {Object} StreamJsonCostResult
 * @property {number} input_tokens
 * @property {number} output_tokens
 * @property {number|null} cost_usd - Claude Code's self-reported cost (if present)
 * @property {string|null} model - Model identifier for rate lookup
 * @property {number|null} cache_creation_input_tokens
 * @property {number|null} cache_read_input_tokens
 */

/**
 * Create a stateful parser that accumulates stream-json chunks and extracts
 * the final result event containing usage metadata.
 *
 * @returns {{ push(chunk: string): void, getResult(): StreamJsonCostResult | null }}
 */
export function createStreamJsonCostParser() {
  let buffer = '';
  /** @type {StreamJsonCostResult | null} */
  let lastResult = null;

  return {
    /**
     * Feed a stdout chunk into the parser.
     * @param {string} chunk
     */
    push(chunk) {
      buffer += chunk;
      const lines = buffer.split('\n');
      // Last element is either empty (line ended with \n) or a partial line
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        let parsed;
        try {
          parsed = JSON.parse(trimmed);
        } catch {
          // Non-JSON line (tool output, diagnostic text) — skip silently
          continue;
        }

        if (
          parsed &&
          typeof parsed === 'object' &&
          parsed.type === 'result' &&
          parsed.usage &&
          typeof parsed.usage === 'object' &&
          Number.isFinite(parsed.usage.input_tokens) &&
          Number.isFinite(parsed.usage.output_tokens)
        ) {
          lastResult = {
            input_tokens: parsed.usage.input_tokens,
            output_tokens: parsed.usage.output_tokens,
            cost_usd: typeof parsed.cost_usd === 'number' && Number.isFinite(parsed.cost_usd)
              ? parsed.cost_usd
              : null,
            model: typeof parsed.model === 'string' ? parsed.model : null,
            cache_creation_input_tokens: Number.isFinite(parsed.usage.cache_creation_input_tokens)
              ? parsed.usage.cache_creation_input_tokens
              : null,
            cache_read_input_tokens: Number.isFinite(parsed.usage.cache_read_input_tokens)
              ? parsed.usage.cache_read_input_tokens
              : null,
          };
        }
      }
    },

    /**
     * Return the extracted cost data, or null if no valid result event was found.
     * @returns {StreamJsonCostResult | null}
     */
    getResult() {
      return lastResult;
    },
  };
}

/**
 * Build a cost object from parsed stream-json data for turn-result enrichment.
 *
 * @param {StreamJsonCostResult} parsedCost
 * @param {object} [config] - normalized config (for operator cost_rates overrides)
 * @returns {{ input_tokens: number, output_tokens: number, usd: number, source: string, model?: string, cache_creation_input_tokens?: number, cache_read_input_tokens?: number }}
 */
export function buildCostFromStreamJson(parsedCost, config) {
  const cost = {
    input_tokens: parsedCost.input_tokens,
    output_tokens: parsedCost.output_tokens,
    source: 'stream_json',
  };

  // Prefer Claude Code's own cost_usd when available
  if (typeof parsedCost.cost_usd === 'number' && Number.isFinite(parsedCost.cost_usd)) {
    cost.usd = Math.round(parsedCost.cost_usd * 1000) / 1000;
  } else if (parsedCost.model) {
    const rates = getClaudeCostRates(parsedCost.model, config);
    if (rates) {
      cost.usd = Math.round(
        ((parsedCost.input_tokens / 1_000_000) * rates.input_per_1m +
         (parsedCost.output_tokens / 1_000_000) * rates.output_per_1m) * 1000
      ) / 1000;
    } else {
      cost.usd = 0;
    }
  } else {
    cost.usd = 0;
  }

  if (parsedCost.model) cost.model = parsedCost.model;
  if (parsedCost.cache_creation_input_tokens != null) {
    cost.cache_creation_input_tokens = parsedCost.cache_creation_input_tokens;
  }
  if (parsedCost.cache_read_input_tokens != null) {
    cost.cache_read_input_tokens = parsedCost.cache_read_input_tokens;
  }

  return cost;
}
