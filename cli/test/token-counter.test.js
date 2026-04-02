import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { countTokens, SUPPORTED_TOKEN_COUNTER_PROVIDERS } from '../src/lib/token-counter.js';

describe('token-counter', () => {
  it('returns 0 for empty input', () => {
    assert.equal(countTokens('', 'anthropic'), 0);
  });

  it('returns a positive integer for non-empty anthropic input', () => {
    const tokens = countTokens('hello world', 'anthropic');

    assert.equal(Number.isInteger(tokens), true);
    assert.ok(tokens > 0);
  });

  it('normalizes provider names case-insensitively', () => {
    assert.equal(countTokens('hello world', 'Anthropic'), countTokens('hello world', 'anthropic'));
  });

  it('rejects unsupported providers', () => {
    assert.throws(
      () => countTokens('hello world', 'openai'),
      /Unsupported token counter provider "openai"/
    );
  });

  it('documents the supported provider set explicitly', () => {
    assert.deepEqual(SUPPORTED_TOKEN_COUNTER_PROVIDERS, ['anthropic']);
  });
});
