import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';

import {
  extractTurnResult,
  buildAnthropicRequest,
  classifyError,
  classifyHttpError,
  COST_RATES,
} from '../src/lib/adapters/api-proxy-adapter.js';

// ── Tests: extractTurnResult ───────────────────────────────────────────────

describe('extractTurnResult', () => {
  const validTurnResult = {
    schema_version: '1.0',
    run_id: 'run_test',
    turn_id: 'turn_test',
    role: 'qa',
    runtime_id: 'api-qa',
    status: 'completed',
    summary: 'Reviewed code',
    decisions: [],
    objections: [{ id: 'OBJ-001', severity: 'low', statement: 'Minor concern', status: 'raised' }],
    files_changed: [],
    artifacts_created: [],
    verification: { status: 'skipped', commands: [], evidence_summary: 'Review turn' },
    artifact: { type: 'review', ref: null },
    proposed_next_role: 'dev',
    phase_transition_request: null,
    run_completion_request: null,
    needs_human_reason: null,
    cost: { input_tokens: 0, output_tokens: 0, usd: 0 },
  };

  it('extracts pure JSON response', () => {
    const response = {
      content: [{ type: 'text', text: JSON.stringify(validTurnResult) }],
    };
    const result = extractTurnResult(response);
    assert.equal(result.ok, true);
    assert.equal(result.turnResult.schema_version, '1.0');
    assert.equal(result.turnResult.role, 'qa');
  });

  it('extracts JSON from markdown code fence', () => {
    const response = {
      content: [{
        type: 'text',
        text: 'Here is my turn result:\n\n```json\n' + JSON.stringify(validTurnResult) + '\n```\n\nThat is my review.',
      }],
    };
    const result = extractTurnResult(response);
    assert.equal(result.ok, true);
    assert.equal(result.turnResult.role, 'qa');
  });

  it('extracts JSON from embedded braces', () => {
    const response = {
      content: [{
        type: 'text',
        text: 'My analysis follows.\n\n' + JSON.stringify(validTurnResult) + '\n\nEnd of turn.',
      }],
    };
    const result = extractTurnResult(response);
    assert.equal(result.ok, true);
    assert.equal(result.turnResult.schema_version, '1.0');
  });

  it('fails on missing content blocks', () => {
    const result = extractTurnResult({});
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('no content blocks'));
  });

  it('fails on no text block', () => {
    const result = extractTurnResult({ content: [{ type: 'tool_use', id: 'x' }] });
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('no text content'));
  });

  it('fails on non-JSON text', () => {
    const result = extractTurnResult({
      content: [{ type: 'text', text: 'I could not complete the review. Sorry!' }],
    });
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('Could not extract'));
  });

  it('fails on JSON without schema_version', () => {
    const result = extractTurnResult({
      content: [{ type: 'text', text: '{"not_a_turn_result": true}' }],
    });
    assert.equal(result.ok, false);
    assert.ok(result.error.includes('Could not extract'));
  });
});

// ── Tests: buildAnthropicRequest ───────────────────────────────────────────

describe('buildAnthropicRequest', () => {
  it('builds correct request shape', () => {
    const req = buildAnthropicRequest('# Prompt', '# Context', 'claude-sonnet-4-6', 4096);
    assert.equal(req.model, 'claude-sonnet-4-6');
    assert.equal(req.max_tokens, 4096);
    assert.ok(req.system.includes('AgentXchain'));
    assert.equal(req.messages.length, 1);
    assert.equal(req.messages[0].role, 'user');
    assert.ok(req.messages[0].content.includes('# Prompt'));
    assert.ok(req.messages[0].content.includes('# Context'));
  });

  it('handles empty context', () => {
    const req = buildAnthropicRequest('# Prompt only', '', 'claude-sonnet-4-6', 2048);
    assert.equal(req.messages[0].content, '# Prompt only');
  });
});

// ── Tests: COST_RATES ──────────────────────────────────────────────────────

describe('COST_RATES', () => {
  it('has rates for supported models', () => {
    assert.ok(COST_RATES['claude-sonnet-4-6']);
    assert.ok(COST_RATES['claude-opus-4-6']);
    assert.equal(typeof COST_RATES['claude-sonnet-4-6'].input_per_1m, 'number');
    assert.equal(typeof COST_RATES['claude-sonnet-4-6'].output_per_1m, 'number');
  });

  it('computes reasonable cost for sonnet', () => {
    const rates = COST_RATES['claude-sonnet-4-6'];
    const cost = (8000 / 1_000_000) * rates.input_per_1m + (1500 / 1_000_000) * rates.output_per_1m;
    assert.ok(cost > 0);
    assert.ok(cost < 1); // Should be well under $1 for 8k in / 1.5k out
  });
});

// ── Tests: classifyError ──────────────────────────────────────────────────

describe('classifyError', () => {
  it('builds correct shape with all fields', () => {
    const err = classifyError(
      'auth_failure', 'Auth failed', 'Check key', false, 401, 'Unauthorized'
    );
    assert.equal(err.error_class, 'auth_failure');
    assert.equal(err.message, 'Auth failed');
    assert.equal(err.recovery, 'Check key');
    assert.equal(err.retryable, false);
    assert.equal(err.http_status, 401);
    assert.equal(err.raw_detail, 'Unauthorized');
  });

  it('defaults http_status and raw_detail to null', () => {
    const err = classifyError('missing_credentials', 'No key', 'Set key', false);
    assert.equal(err.http_status, null);
    assert.equal(err.raw_detail, null);
  });

  it('truncates raw_detail to 500 characters', () => {
    const longDetail = 'x'.repeat(1000);
    const err = classifyError('unknown_api_error', 'err', 'retry', true, 500, longDetail);
    assert.equal(err.raw_detail.length, 500);
  });
});

// ── Tests: classifyHttpError ──────────────────────────────────────────────

describe('classifyHttpError', () => {
  it('classifies 401 as auth_failure', () => {
    const err = classifyHttpError(401, 'Unauthorized', 'anthropic', 'claude-sonnet-4-6', 'ANTHROPIC_API_KEY');
    assert.equal(err.error_class, 'auth_failure');
    assert.equal(err.http_status, 401);
    assert.equal(err.retryable, false);
    assert.ok(err.recovery.includes('ANTHROPIC_API_KEY'));
  });

  it('classifies 403 as auth_failure', () => {
    const err = classifyHttpError(403, 'Forbidden', 'anthropic', 'claude-sonnet-4-6', 'ANTHROPIC_API_KEY');
    assert.equal(err.error_class, 'auth_failure');
    assert.equal(err.http_status, 403);
  });

  it('classifies 429 as rate_limited', () => {
    const err = classifyHttpError(429, 'Too many requests', 'anthropic', 'claude-sonnet-4-6', 'ANTHROPIC_API_KEY');
    assert.equal(err.error_class, 'rate_limited');
    assert.equal(err.retryable, true);
    assert.ok(err.recovery.includes('anthropic'));
  });

  it('classifies 404 as model_not_found', () => {
    const err = classifyHttpError(404, 'Not found', 'anthropic', 'claude-nonexistent-99', 'ANTHROPIC_API_KEY');
    assert.equal(err.error_class, 'model_not_found');
    assert.equal(err.retryable, false);
    assert.ok(err.recovery.includes('claude-nonexistent-99'));
  });

  it('classifies 400 with "context length" as context_overflow', () => {
    const err = classifyHttpError(400, '{"error":{"message":"context length exceeded"}}', 'anthropic', 'claude-sonnet-4-6', 'ANTHROPIC_API_KEY');
    assert.equal(err.error_class, 'context_overflow');
    assert.equal(err.retryable, false);
  });

  it('classifies 400 with "token" keyword as context_overflow', () => {
    const err = classifyHttpError(400, '{"error":{"message":"maximum number of token limit reached"}}', 'anthropic', 'claude-sonnet-4-6', 'ANTHROPIC_API_KEY');
    assert.equal(err.error_class, 'context_overflow');
  });

  it('classifies 400 without context keyword as unknown_api_error', () => {
    const err = classifyHttpError(400, 'Bad request: invalid parameter', 'anthropic', 'claude-sonnet-4-6', 'ANTHROPIC_API_KEY');
    assert.equal(err.error_class, 'unknown_api_error');
    assert.equal(err.retryable, true);
  });

  it('classifies 500 as unknown_api_error', () => {
    const err = classifyHttpError(500, 'Internal server error', 'anthropic', 'claude-sonnet-4-6', 'ANTHROPIC_API_KEY');
    assert.equal(err.error_class, 'unknown_api_error');
    assert.equal(err.http_status, 500);
    assert.equal(err.retryable, true);
  });

  it('classifies 502 as unknown_api_error', () => {
    const err = classifyHttpError(502, 'Bad gateway', 'anthropic', 'claude-sonnet-4-6', 'ANTHROPIC_API_KEY');
    assert.equal(err.error_class, 'unknown_api_error');
    assert.equal(err.retryable, true);
  });
});
