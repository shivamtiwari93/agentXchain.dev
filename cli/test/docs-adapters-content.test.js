import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');
const read = (rel) => readFileSync(resolve(ROOT, rel), 'utf8');

/**
 * Code-backed guard for the adapters deep-dive page.
 *
 * Reads adapter implementation files and asserts that adapters.mdx
 * documents runtime behavior truthfully. Catches:
 * - Wrong prompt transport mode names
 * - Wrong timeout/grace period values
 * - Fabricated error classifications
 * - Fabricated provider support
 * - Wrong retry policy shapes
 * - Missing v1 constraints
 */

describe('Adapter docs contract', () => {
  const adapterDocs = read('website-v2/docs/adapters.mdx');
  const localCliSource = read('cli/src/lib/adapters/local-cli-adapter.js');
  const apiProxySource = read('cli/src/lib/adapters/api-proxy-adapter.js');
  const normalizedConfigSource = read('cli/src/lib/normalized-config.js');
  const turnResultValidatorSource = read('cli/src/lib/turn-result-validator.js');

  describe('prompt transport modes', () => {
    // Extract valid transports from normalized-config.js
    const transportMatch = normalizedConfigSource.match(/VALID_PROMPT_TRANSPORTS\s*=\s*\[([^\]]+)\]/);

    it('normalized-config.js defines VALID_PROMPT_TRANSPORTS', () => {
      assert.ok(transportMatch, 'VALID_PROMPT_TRANSPORTS found in normalized-config.js');
    });

    it('docs list the correct transport mode names', () => {
      const validTransports = transportMatch[1].match(/'([^']+)'/g).map(s => s.replace(/'/g, ''));
      for (const transport of validTransports) {
        assert.match(adapterDocs, new RegExp(`\`${transport}\``),
          `adapters.mdx must document transport mode "${transport}"`);
      }
    });

    it('docs do NOT list fabricated transport modes', () => {
      // These were the old fabricated names
      assert.doesNotMatch(adapterDocs, /\| `file` \|/,
        'adapters.mdx must not list fabricated "file" transport mode');
      assert.doesNotMatch(adapterDocs, /\| `arg` \|/,
        'adapters.mdx must not list fabricated "arg" transport mode');
    });

    it('local-cli-adapter.js resolvePromptTransport uses the same modes', () => {
      const adapterTransportMatch = localCliSource.match(/VALID_TRANSPORTS\s*=\s*\[([^\]]+)\]/);
      assert.ok(adapterTransportMatch, 'VALID_TRANSPORTS found in local-cli-adapter.js');
      const adapterTransports = adapterTransportMatch[1].match(/'([^']+)'/g).map(s => s.replace(/'/g, ''));
      for (const transport of adapterTransports) {
        assert.match(adapterDocs, new RegExp(`\`${transport}\``),
          `adapters.mdx must document transport mode "${transport}" from local-cli-adapter.js`);
      }
    });
  });

  describe('local_cli timeout and signal handling', () => {
    it('SIGTERM grace period in docs matches code (10 seconds)', () => {
      // Extract grace period from local-cli-adapter.js
      const graceMatch = localCliSource.match(/sigkillHandle\s*=\s*setTimeout\(\(\)\s*=>\s*\{[\s\S]*?\},\s*(\d+)\)/);
      assert.ok(graceMatch, 'SIGKILL grace timeout found in local-cli-adapter.js');
      const graceMs = parseInt(graceMatch[1], 10);
      const graceSeconds = graceMs / 1000;

      // Docs must state the correct grace period
      assert.match(adapterDocs, new RegExp(`${graceSeconds} seconds.*SIGKILL|SIGTERM.*${graceSeconds}s.*SIGKILL`, 'i'),
        `adapters.mdx must document ${graceSeconds}-second grace period`);
    });

    it('docs do NOT claim a 5-second grace period', () => {
      assert.doesNotMatch(adapterDocs, /waits? 5 seconds.*SIGKILL|5 seconds after.*SIGTERM/i,
        'adapters.mdx must not claim a 5-second grace period');
    });

    it('default timeout documented as 20 minutes', () => {
      // local-cli-adapter.js uses 1200000 as fallback
      assert.match(localCliSource, /1200000/,
        'local-cli-adapter.js uses 1200000ms fallback');
      assert.match(adapterDocs, /20 minutes.*1,?200,?000/i,
        'adapters.mdx must document the 20-minute default timeout for local_cli');
    });
  });

  describe('api_proxy error classification', () => {
    it('docs list real error classes from implementation', () => {
      // Extract RETRYABLE_ERROR_CLASSES from api-proxy-adapter.js
      const retryableMatch = apiProxySource.match(/RETRYABLE_ERROR_CLASSES\s*=\s*\[([\s\S]*?)\]/);
      assert.ok(retryableMatch, 'RETRYABLE_ERROR_CLASSES found in api-proxy-adapter.js');
      const retryableClasses = retryableMatch[1].match(/'([^']+)'/g).map(s => s.replace(/'/g, ''));

      for (const errorClass of retryableClasses) {
        assert.match(adapterDocs, new RegExp(`\`${errorClass}\``),
          `adapters.mdx must document error class "${errorClass}"`);
      }
    });

    it('docs list non-retryable error classes', () => {
      const nonRetryable = ['auth_failure', 'model_not_found', 'invalid_request', 'context_overflow'];
      for (const errorClass of nonRetryable) {
        assert.match(adapterDocs, new RegExp(`\`${errorClass}\``),
          `adapters.mdx must document non-retryable error class "${errorClass}"`);
      }
    });

    it('docs do NOT use fabricated category names', () => {
      // Old fabricated categories were transient/permanent/parse as the classification taxonomy
      assert.doesNotMatch(adapterDocs, /\| `transient` \|/,
        'adapters.mdx must not use fabricated "transient" category');
      assert.doesNotMatch(adapterDocs, /\| `permanent` \|/,
        'adapters.mdx must not use fabricated "permanent" category');
      assert.doesNotMatch(adapterDocs, /\| `parse` \|/,
        'adapters.mdx must not use fabricated "parse" category');
    });
  });

  describe('api_proxy retry policy', () => {
    it('docs use the real retry_policy shape, not flat max_retries', () => {
      assert.match(adapterDocs, /retry_policy/,
        'adapters.mdx must reference the nested retry_policy object');
      assert.doesNotMatch(adapterDocs, /"max_retries"/,
        'adapters.mdx must not use the fabricated flat max_retries field');
    });

    it('default retry policy values match code', () => {
      const defaultMatch = apiProxySource.match(/DEFAULT_RETRY_POLICY\s*=\s*\{([\s\S]*?)\}/);
      assert.ok(defaultMatch, 'DEFAULT_RETRY_POLICY found in api-proxy-adapter.js');

      // Check max_attempts
      const maxAttempts = defaultMatch[1].match(/max_attempts:\s*(\d+)/);
      assert.ok(maxAttempts, 'max_attempts found in DEFAULT_RETRY_POLICY');
      assert.match(adapterDocs, new RegExp(`\`max_attempts\`.*${maxAttempts[1]}|max_attempts.*${maxAttempts[1]}`),
        `adapters.mdx must document max_attempts default as ${maxAttempts[1]}`);

      // Check base_delay_ms
      const baseDelay = defaultMatch[1].match(/base_delay_ms:\s*(\d+)/);
      assert.ok(baseDelay, 'base_delay_ms found in DEFAULT_RETRY_POLICY');
      assert.match(adapterDocs, new RegExp(baseDelay[1]),
        `adapters.mdx must document base_delay_ms default as ${baseDelay[1]}`);

      // Check jitter
      const jitter = defaultMatch[1].match(/jitter:\s*'(\w+)'/);
      assert.ok(jitter, 'jitter found in DEFAULT_RETRY_POLICY');
      assert.match(adapterDocs, new RegExp(`"${jitter[1]}"|'${jitter[1]}'|\`${jitter[1]}\``),
        `adapters.mdx must document jitter default as "${jitter[1]}"`);
    });
  });

  describe('api_proxy supported providers', () => {
    it('PROVIDER_ENDPOINTS keys match docs', () => {
      const endpointMatch = apiProxySource.match(/PROVIDER_ENDPOINTS\s*=\s*\{([\s\S]*?)\}/);
      assert.ok(endpointMatch, 'PROVIDER_ENDPOINTS found in api-proxy-adapter.js');
      // Extract only object keys (word at start of line before colon, not URL colons)
      const providers = endpointMatch[1].match(/^\s*(\w+)\s*:/gm).map(s => s.trim().replace(':', '').trim());

      for (const provider of providers) {
        assert.match(adapterDocs, new RegExp(provider, 'i'),
          `adapters.mdx must document supported provider "${provider}"`);
      }
    });

    it('docs list OpenAI support when PROVIDER_ENDPOINTS includes it', () => {
      assert.match(apiProxySource, /openai:\s*'https:\/\/api\.openai\.com\/v1\/chat\/completions'/,
        'api-proxy-adapter.js must register the OpenAI endpoint');
      assert.match(adapterDocs, /OpenAI.*Supported|Supported.*OpenAI/i,
        'adapters.mdx must document OpenAI as a supported provider');
      assert.match(adapterDocs, /chat-completions-compatible/i,
        'adapters.mdx must scope OpenAI support to chat-completions-compatible models');
    });

    it('docs do NOT claim custom/base_url support', () => {
      assert.doesNotMatch(adapterDocs, /base_url|Any OpenAI-compatible API/i,
        'adapters.mdx must not claim custom base_url provider support');
    });
  });

  describe('api_proxy v1 restriction', () => {
    it('code enforces review_only for api_proxy', () => {
      assert.match(normalizedConfigSource, /api_proxy.*review_only|review_only.*api_proxy/,
        'normalized-config.js must enforce review_only restriction for api_proxy');
    });

    it('docs document the review_only restriction', () => {
      assert.match(adapterDocs, /review_only.*api_proxy|api_proxy.*review_only/i,
        'adapters.mdx must document that api_proxy is restricted to review_only roles');
    });
  });

  describe('no fabricated custom adapter interface', () => {
    it('docs do NOT claim a TypeScript Adapter interface', () => {
      assert.doesNotMatch(adapterDocs, /implements Adapter|class.*Adapter|import.*Adapter.*from "agentxchain"/,
        'adapters.mdx must not claim a fabricated TypeScript Adapter interface');
    });

    it('docs do NOT claim an adapters registration config key', () => {
      assert.doesNotMatch(adapterDocs, /"adapters":\s*\{[\s\S]*?"module"/,
        'adapters.mdx must not claim a fabricated adapters registration config key');
    });
  });

  describe('objections requirement scoping', () => {
    it('code requires objections only for review_only roles', () => {
      assert.match(turnResultValidatorSource, /review_only.*at least one objection/,
        'turn-result-validator.js scopes objection requirement to review_only');
    });

    it('docs scope the objections requirement to review_only roles', () => {
      assert.match(adapterDocs, /review_only.*objection|objection.*review_only/i,
        'adapters.mdx must scope the objections requirement to review_only roles');
    });

    it('docs do NOT claim all roles must have objections', () => {
      assert.doesNotMatch(adapterDocs, /must contain at least one entry.*blind agreement is a protocol violation/i,
        'adapters.mdx must not claim all roles require objections');
    });
  });

  describe('preflight tokenization', () => {
    it('api_proxy supports preflight tokenization', () => {
      assert.match(apiProxySource, /preflight_tokenization/,
        'api-proxy-adapter.js supports preflight_tokenization');
    });

    it('docs document preflight tokenization', () => {
      assert.match(adapterDocs, /preflight.*tokenization|token.*budget/i,
        'adapters.mdx must document preflight tokenization');
    });

    it('docs state the Anthropic-only provider_local boundary', () => {
      assert.match(normalizedConfigSource, /provider_local.*not supported for provider/,
        'normalized-config.js must fail closed when provider_local tokenizer is unavailable');
      assert.match(adapterDocs, /Anthropic-only|OpenAI.*config validation fails closed/i,
        'adapters.mdx must document that provider_local preflight tokenization is currently Anthropic-only');
    });
  });

  describe('comparison table', () => {
    it('local_cli prompt transport lists correct modes', () => {
      // The comparison table row for local_cli should list the real transport modes
      assert.match(adapterDocs, /`argv`.*`stdin`.*`dispatch_bundle_only`/,
        'comparison table must list correct prompt transport modes for local_cli');
    });

    it('comparison table documents review_only constraint for api_proxy', () => {
      assert.match(adapterDocs, /review_only.*only/i,
        'comparison table must note the review_only constraint for api_proxy');
    });

    it('comparison table states 10s grace period', () => {
      assert.match(adapterDocs, /SIGTERM.*10s.*SIGKILL/i,
        'comparison table must state 10s grace period');
    });
  });
});
