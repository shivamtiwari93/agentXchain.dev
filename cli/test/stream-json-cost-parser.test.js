import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import {
  createStreamJsonCostParser,
  buildCostFromStreamJson,
  getClaudeCostRates,
} from '../src/lib/stream-json-cost-parser.js';

// ── Fixtures ────────────────────────────────────────────────────────────────

const VALID_RESULT_EVENT = JSON.stringify({
  type: 'result',
  subtype: 'success',
  cost_usd: 0.123,
  duration_ms: 45000,
  duration_api_ms: 30000,
  is_error: false,
  num_turns: 1,
  session_id: 'sess_abc123',
  usage: {
    input_tokens: 12345,
    output_tokens: 6789,
    cache_creation_input_tokens: 100,
    cache_read_input_tokens: 200,
  },
  result: 'Task completed.',
  model: 'claude-opus-4-6',
});

const RESULT_EVENT_NO_COST_USD = JSON.stringify({
  type: 'result',
  subtype: 'success',
  duration_ms: 30000,
  is_error: false,
  num_turns: 1,
  usage: {
    input_tokens: 10000,
    output_tokens: 5000,
  },
  model: 'claude-sonnet-4-6',
});

const RESULT_EVENT_NO_USAGE = JSON.stringify({
  type: 'result',
  subtype: 'success',
  cost_usd: 0.05,
  model: 'claude-opus-4-6',
});

const ASSISTANT_MESSAGE_EVENT = JSON.stringify({
  type: 'assistant',
  message: { role: 'assistant', content: [{ type: 'text', text: 'Hello' }] },
});

const CONTENT_BLOCK_EVENT = JSON.stringify({
  type: 'content_block_start',
  index: 0,
  content_block: { type: 'text', text: '' },
});

// ── AT-COST-001: Valid result event parsed ────────────────────────────────

describe('createStreamJsonCostParser', () => {
  it('AT-COST-001: extracts input_tokens, output_tokens, model from a well-formed result event', () => {
    const parser = createStreamJsonCostParser();
    parser.push(VALID_RESULT_EVENT + '\n');
    const result = parser.getResult();

    assert.ok(result, 'should return a non-null result');
    assert.equal(result.input_tokens, 12345);
    assert.equal(result.output_tokens, 6789);
    assert.equal(result.model, 'claude-opus-4-6');
    assert.equal(result.cache_creation_input_tokens, 100);
    assert.equal(result.cache_read_input_tokens, 200);
  });

  // ── AT-COST-002: cost_usd extracted when present ──────────────────────

  it('AT-COST-002: captures Claude Code self-reported cost_usd', () => {
    const parser = createStreamJsonCostParser();
    parser.push(VALID_RESULT_EVENT + '\n');
    const result = parser.getResult();

    assert.equal(result.cost_usd, 0.123);
  });

  it('AT-COST-002b: cost_usd is null when absent from result event', () => {
    const parser = createStreamJsonCostParser();
    parser.push(RESULT_EVENT_NO_COST_USD + '\n');
    const result = parser.getResult();

    assert.equal(result.cost_usd, null);
  });

  // ── AT-COST-003: Non-JSON lines skipped ───────────────────────────────

  it('AT-COST-003: handles mixed stdout (tool output + JSON events) without error', () => {
    const parser = createStreamJsonCostParser();
    const mixed = [
      'Installing dependencies...',
      '> npm install',
      ASSISTANT_MESSAGE_EVENT,
      '  ✓ 42 tests passed',
      CONTENT_BLOCK_EVENT,
      'Some random diagnostic text with {curly braces}',
      VALID_RESULT_EVENT,
    ].join('\n') + '\n';

    parser.push(mixed);
    const result = parser.getResult();

    assert.ok(result, 'should still extract the result event');
    assert.equal(result.input_tokens, 12345);
    assert.equal(result.output_tokens, 6789);
  });

  // ── AT-COST-004: Partial JSON lines buffered ──────────────────────────

  it('AT-COST-004: correctly handles chunks that split a JSON line across two pushes', () => {
    const parser = createStreamJsonCostParser();
    const fullLine = VALID_RESULT_EVENT + '\n';
    const splitPoint = Math.floor(fullLine.length / 2);

    parser.push(fullLine.slice(0, splitPoint));
    // At this point the result should not be available yet
    assert.equal(parser.getResult(), null, 'partial line should not produce a result');

    parser.push(fullLine.slice(splitPoint));
    const result = parser.getResult();
    assert.ok(result, 'should parse after the second chunk completes the line');
    assert.equal(result.input_tokens, 12345);
  });

  it('AT-COST-004b: handles multiple partial chunks before newline', () => {
    const parser = createStreamJsonCostParser();
    const fullLine = VALID_RESULT_EVENT + '\n';
    // Split into 4 chunks
    const chunk1 = fullLine.slice(0, 50);
    const chunk2 = fullLine.slice(50, 100);
    const chunk3 = fullLine.slice(100, 150);
    const chunk4 = fullLine.slice(150);

    parser.push(chunk1);
    parser.push(chunk2);
    parser.push(chunk3);
    assert.equal(parser.getResult(), null);
    parser.push(chunk4);

    const result = parser.getResult();
    assert.ok(result);
    assert.equal(result.input_tokens, 12345);
  });

  // ── AT-COST-005: Missing usage returns null ───────────────────────────

  it('AT-COST-005: returns null when result event has no usage field', () => {
    const parser = createStreamJsonCostParser();
    parser.push(RESULT_EVENT_NO_USAGE + '\n');

    assert.equal(parser.getResult(), null, 'result event without usage should produce null');
  });

  it('AT-COST-005b: returns null when no result event is found at all', () => {
    const parser = createStreamJsonCostParser();
    parser.push(ASSISTANT_MESSAGE_EVENT + '\n');
    parser.push(CONTENT_BLOCK_EVENT + '\n');
    parser.push('Some non-JSON output\n');

    assert.equal(parser.getResult(), null);
  });

  // ── AT-COST-006: Multiple result events — last wins ───────────────────

  it('AT-COST-006: uses the last result event if multiple appear', () => {
    const parser = createStreamJsonCostParser();
    const firstResult = JSON.stringify({
      type: 'result',
      subtype: 'success',
      cost_usd: 0.050,
      usage: { input_tokens: 1000, output_tokens: 500 },
      model: 'claude-haiku-4-5-20251001',
    });
    const secondResult = JSON.stringify({
      type: 'result',
      subtype: 'success',
      cost_usd: 0.200,
      usage: { input_tokens: 20000, output_tokens: 10000 },
      model: 'claude-opus-4-6',
    });

    parser.push(firstResult + '\n' + secondResult + '\n');
    const result = parser.getResult();

    assert.equal(result.input_tokens, 20000, 'should use second result input_tokens');
    assert.equal(result.output_tokens, 10000, 'should use second result output_tokens');
    assert.equal(result.model, 'claude-opus-4-6', 'should use second result model');
    assert.equal(result.cost_usd, 0.200, 'should use second result cost_usd');
  });
});

// ── AT-COST-010: USD calculated from bundled rates ──────────────────────

describe('buildCostFromStreamJson', () => {
  it('AT-COST-010: calculates USD from bundled rates when cost_usd is absent', () => {
    const parsedCost = {
      input_tokens: 10000,
      output_tokens: 5000,
      cost_usd: null,
      model: 'claude-sonnet-4-6',
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
    };

    const cost = buildCostFromStreamJson(parsedCost);

    // claude-sonnet-4-6: input $3/M, output $15/M
    // (10000/1M) * 3 + (5000/1M) * 15 = 0.03 + 0.075 = 0.105
    assert.equal(cost.usd, 0.105);
    assert.equal(cost.input_tokens, 10000);
    assert.equal(cost.output_tokens, 5000);
    assert.equal(cost.source, 'stream_json');
    assert.equal(cost.model, 'claude-sonnet-4-6');
  });

  it('AT-COST-010b: prefers Claude Code cost_usd over bundled rate calculation', () => {
    const parsedCost = {
      input_tokens: 10000,
      output_tokens: 5000,
      cost_usd: 0.999,
      model: 'claude-sonnet-4-6',
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
    };

    const cost = buildCostFromStreamJson(parsedCost);
    assert.equal(cost.usd, 0.999, 'should prefer cost_usd over computed rate');
  });

  it('AT-COST-010c: returns usd=0 for unknown model when cost_usd is absent', () => {
    const parsedCost = {
      input_tokens: 10000,
      output_tokens: 5000,
      cost_usd: null,
      model: 'claude-unknown-model',
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
    };

    const cost = buildCostFromStreamJson(parsedCost);
    assert.equal(cost.usd, 0);
  });

  it('AT-COST-010d: returns usd=0 when no model and no cost_usd', () => {
    const parsedCost = {
      input_tokens: 10000,
      output_tokens: 5000,
      cost_usd: null,
      model: null,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
    };

    const cost = buildCostFromStreamJson(parsedCost);
    assert.equal(cost.usd, 0);
  });

  it('AT-COST-010e: uses operator-supplied cost rates when available', () => {
    const parsedCost = {
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
      cost_usd: null,
      model: 'claude-opus-4-6',
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
    };

    const config = {
      budget: {
        cost_rates: {
          'claude-opus-4-6': { input_per_1m: 10.00, output_per_1m: 50.00 },
        },
      },
    };

    const cost = buildCostFromStreamJson(parsedCost, config);
    // (1M/1M)*10 + (1M/1M)*50 = 60
    assert.equal(cost.usd, 60);
  });

  // ── AT-COST-011: cost.source marker set ───────────────────────────────

  it('AT-COST-011: enriched cost has source "stream_json"', () => {
    const parsedCost = {
      input_tokens: 5000,
      output_tokens: 2000,
      cost_usd: 0.05,
      model: 'claude-opus-4-6',
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
    };

    const cost = buildCostFromStreamJson(parsedCost);
    assert.equal(cost.source, 'stream_json');
  });

  it('AT-COST-011b: includes cache token counts when present', () => {
    const parsedCost = {
      input_tokens: 5000,
      output_tokens: 2000,
      cost_usd: 0.05,
      model: 'claude-opus-4-6',
      cache_creation_input_tokens: 300,
      cache_read_input_tokens: 700,
    };

    const cost = buildCostFromStreamJson(parsedCost);
    assert.equal(cost.cache_creation_input_tokens, 300);
    assert.equal(cost.cache_read_input_tokens, 700);
  });

  it('AT-COST-011c: omits cache fields when null', () => {
    const parsedCost = {
      input_tokens: 5000,
      output_tokens: 2000,
      cost_usd: 0.05,
      model: 'claude-opus-4-6',
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
    };

    const cost = buildCostFromStreamJson(parsedCost);
    assert.ok(!('cache_creation_input_tokens' in cost));
    assert.ok(!('cache_read_input_tokens' in cost));
  });
});

// ── getClaudeCostRates ──────────────────────────────────────────────────

describe('getClaudeCostRates', () => {
  it('returns bundled rates for known Claude models', () => {
    const rates = getClaudeCostRates('claude-opus-4-6');
    assert.equal(rates.input_per_1m, 5.00);
    assert.equal(rates.output_per_1m, 25.00);
  });

  it('returns null for unknown models', () => {
    assert.equal(getClaudeCostRates('gpt-4o'), null);
  });

  it('prefers operator-supplied rates over bundled', () => {
    const config = {
      budget: {
        cost_rates: {
          'claude-opus-4-6': { input_per_1m: 99, output_per_1m: 199 },
        },
      },
    };
    const rates = getClaudeCostRates('claude-opus-4-6', config);
    assert.equal(rates.input_per_1m, 99);
    assert.equal(rates.output_per_1m, 199);
  });
});
