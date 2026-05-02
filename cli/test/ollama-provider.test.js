import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { loadNormalizedConfig } from '../src/lib/normalized-config.js';
import {
  extractTurnResult,
  buildOllamaHeaders,
  buildProviderHeaders,
  buildProviderRequest,
  classifyHttpError,
  BUNDLED_COST_RATES,
  getCostRates,
  PROVIDER_ENDPOINTS,
} from '../src/lib/adapters/api-proxy-adapter.js';

// Minimal valid project config shape for testing
function makeConfig(runtimeOverrides = {}) {
  return {
    schema_version: 4,
    project: { id: 'test', name: 'Test', default_branch: 'main' },
    roles: {
      dev: {
        title: 'Developer',
        mandate: 'Build features',
        write_authority: 'proposed',
        runtime: 'local_ollama',
      },
    },
    runtimes: {
      local_ollama: {
        type: 'api_proxy',
        provider: 'ollama',
        model: 'llama3.2',
        ...runtimeOverrides,
      },
    },
    routing: { implementation: ['dev'] },
  };
}

describe('Ollama provider — config validation', () => {
  it('AT-OLLAMA-001: VALID_API_PROXY_PROVIDERS includes "ollama"', () => {
    // Verify by loading a valid ollama config — if the provider list didn't
    // include ollama, loadNormalizedConfig would return a validation error.
    const result = loadNormalizedConfig(makeConfig());
    assert.ok(result.ok, `Expected valid config, got errors: ${JSON.stringify(result.errors)}`);
  });

  it('AT-OLLAMA-002: config with provider "ollama" and no auth_env validates', () => {
    const config = makeConfig(); // no auth_env
    const result = loadNormalizedConfig(config);
    assert.ok(result.ok, `Expected valid config, got errors: ${JSON.stringify(result.errors)}`);
  });

  it('AT-OLLAMA-003: config with provider "ollama" and explicit auth_env validates', () => {
    const config = makeConfig({ auth_env: 'OLLAMA_API_KEY' });
    const result = loadNormalizedConfig(config);
    assert.ok(result.ok, `Expected valid config, got errors: ${JSON.stringify(result.errors)}`);
  });

  it('AT-OLLAMA-009: cloud providers still require auth_env', () => {
    for (const provider of ['anthropic', 'openai', 'google']) {
      const config = {
        schema_version: 4,
        project: { id: 'test', name: 'Test', default_branch: 'main' },
        roles: {
          dev: {
            title: 'Developer',
            mandate: 'Build features',
            write_authority: 'proposed',
            runtime: 'cloud_rt',
          },
        },
        runtimes: {
          cloud_rt: {
            type: 'api_proxy',
            provider,
            model: 'test-model',
            // no auth_env
          },
        },
        routing: { implementation: ['dev'] },
      };
      const result = loadNormalizedConfig(config);
      assert.ok(!result.ok, `Expected ${provider} without auth_env to fail validation`);
      const authError = result.errors.find(e => e.includes('auth_env'));
      assert.ok(authError, `Expected auth_env error for provider "${provider}"`);
    }
  });
});

describe('Ollama provider — adapter internals', () => {
  it('AT-OLLAMA-004: buildProviderRequest("ollama") produces OpenAI-compatible body', () => {
    const body = buildProviderRequest('ollama', '# Prompt', '# Context', 'llama3.2', 4096);
    assert.ok(body.model === 'llama3.2', 'model should match');
    assert.ok(body.max_tokens === 4096, 'max_tokens should be set');
    assert.ok(!('max_completion_tokens' in body) || body.max_completion_tokens === undefined,
      'ollama request should not rely on max_completion_tokens');
    assert.ok(Array.isArray(body.messages), 'messages should be an array');
    assert.ok(body.messages.length === 2, 'should have system + user message');
    assert.ok(body.messages[0].role === 'developer', 'first message should be developer/system');
    assert.ok(body.messages[1].role === 'user', 'second message should be user');
    assert.ok(body.messages[1].content.includes('# Prompt'), 'user content should include prompt');
    assert.deepEqual(body.response_format, { type: 'json_object' });
  });

  it('AT-OLLAMA-005: default endpoint for ollama is localhost:11434', () => {
    assert.equal(PROVIDER_ENDPOINTS.ollama, 'http://localhost:11434/v1/chat/completions');
  });

  it('AT-OLLAMA-006: no Authorization header when apiKey is null', () => {
    const headers = buildOllamaHeaders(null);
    assert.equal(headers['Content-Type'], 'application/json');
    assert.ok(!('Authorization' in headers), 'Should not have Authorization header');
  });

  it('AT-OLLAMA-007: Authorization header when apiKey is provided', () => {
    const headers = buildOllamaHeaders('test-key');
    assert.equal(headers['Authorization'], 'Bearer test-key');
  });

  it('AT-OLLAMA-006b: buildProviderHeaders("ollama", null) omits auth', () => {
    const headers = buildProviderHeaders('ollama', null);
    assert.ok(!('Authorization' in headers));
  });

  it('AT-OLLAMA-007b: buildProviderHeaders("ollama", "key") includes auth', () => {
    const headers = buildProviderHeaders('ollama', 'key');
    assert.equal(headers['Authorization'], 'Bearer key');
  });

  it('AT-OLLAMA-008: PROVIDER_ERROR_MAPS includes ollama with OpenAI-compatible structure', async () => {
    // Import the error maps through classifyHttpError behavior
    // Verify by simulating a 404 error classification for ollama
    const classified = classifyHttpError(404, { error: { code: 'model_not_found', type: 'error' } }, 'ollama', 'llama3.2', 'UNUSED');
    assert.equal(classified.error_class, 'model_not_found');
    assert.equal(classified.retryable, false);
  });

  it('AT-OLLAMA-010: no bundled cost rates for ollama models', () => {
    assert.equal(getCostRates('llama3.2', {}), null);
    assert.equal(getCostRates('mistral', {}), null);
    assert.equal(BUNDLED_COST_RATES['llama3.2'], undefined);
  });

  it('ollama response extraction uses OpenAI path', () => {
    const responseData = {
      choices: [
        {
          message: {
            content: JSON.stringify({
              schema_version: 4,
              role: 'dev',
              status: 'completed',
              artifacts: [],
              decisions: [{ id: 'DEC-TEST-001', summary: 'Test', rationale: 'Testing' }],
            }),
          },
        },
      ],
    };
    const result = extractTurnResult(responseData, 'ollama');
    assert.ok(result.ok, `Expected successful extraction, got: ${result.error}`);
    assert.equal(result.turnResult.role, 'dev');
  });
});
