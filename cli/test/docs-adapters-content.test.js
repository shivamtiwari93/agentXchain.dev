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
  const mcpAdapterSource = read('cli/src/lib/adapters/mcp-adapter.js');
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

  describe('default Claude runtime truth', () => {
    it('documents the unattended Claude default with write permissions', () => {
      assert.match(adapterDocs, /claude --print --dangerously-skip-permissions/,
        'adapters.mdx must document the actual unattended default Claude command');
      assert.match(adapterDocs, /permission prompt|write access|staging a result/i,
        'adapters.mdx must explain why the extra Claude flag exists');
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

  describe('api_proxy model tier and retry budget warning', () => {
    it('docs contain a model-tier retry warning section', () => {
      assert.match(adapterDocs, /### Model tier and retry budget/,
        'adapters.mdx must have a "Model tier and retry budget" section');
    });

    it('docs reference real models from the COST_RATES table', () => {
      const costRatesMatch = apiProxySource.match(/COST_RATES\s*=\s*\{([\s\S]*?)\n\}/);
      assert.ok(costRatesMatch, 'COST_RATES found in api-proxy-adapter.js');
      const modelIds = costRatesMatch[1].match(/'([^']+)':/g).map(s => s.replace(/[':]/g, ''));
      for (const modelId of modelIds) {
        assert.match(adapterDocs, new RegExp(`\`${modelId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\``),
          `adapters.mdx model-tier section must reference real model "${modelId}" from COST_RATES`);
      }
    });

    it('docs warn about retry overhead for cheaper models', () => {
      assert.match(adapterDocs, /retry.*overhead|worst-case.*cost|retry budget/i,
        'adapters.mdx must warn about retry budget impact for cheaper models');
    });

    it('docs reference the governed retry mechanism (rejectTurn)', () => {
      assert.match(adapterDocs, /rejectTurn.*re-dispatch|governed retry/i,
        'adapters.mdx must explain that governed retry (rejectTurn → re-dispatch) handles schema non-conformance');
    });

    it('docs do NOT claim a specific fixed failure rate', () => {
      // We should NOT hardcode "50% failure rate" — the actual rate varies
      assert.doesNotMatch(adapterDocs, /\d+% failure rate/,
        'adapters.mdx must not claim a fixed failure rate percentage');
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

    it('docs document base_url as an endpoint override for supported providers only', () => {
      assert.match(adapterDocs, /`base_url`/,
        'adapters.mdx must document the optional base_url runtime field');
      assert.match(adapterDocs, /override.*endpoint|endpoint override/i,
        'adapters.mdx must explain that base_url overrides the default provider endpoint');
      assert.match(adapterDocs, /provider.*still determines.*request format|existing provider families only/i,
        'adapters.mdx must scope base_url to supported provider families, not arbitrary providers');
    });

    it('docs do NOT claim arbitrary custom provider support', () => {
      assert.doesNotMatch(adapterDocs, /Any OpenAI-compatible API|custom provider support|unsupported provider families/i,
        'adapters.mdx must not claim arbitrary custom provider support');
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

    it('docs say api_proxy review turns do not write QA planning files directly', () => {
      assert.match(adapterDocs, /cannot directly author .*acceptance-matrix|does not patch your planning docs/i,
        'adapters.mdx must explain that api_proxy does not write QA planning files directly');
      assert.match(adapterDocs, /\.agentxchain\/reviews\//,
        'adapters.mdx must mention the orchestrator-materialized review artifact path');
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

  describe('mcp adapter scope', () => {
    it('docs mention the mcp adapter and the shipped transport set', () => {
      assert.match(adapterDocs, /## mcp adapter/i,
        'adapters.mdx must document the mcp adapter');
      const transportMatch = normalizedConfigSource.match(/VALID_MCP_TRANSPORTS\s*=\s*\[([^\]]+)\]/);
      assert.ok(transportMatch, 'VALID_MCP_TRANSPORTS found in normalized-config.js');
      const validTransports = transportMatch[1].match(/'([^']+)'/g).map((s) => s.replace(/'/g, ''));
      for (const transport of validTransports) {
        assert.match(adapterDocs, new RegExp(`\`${transport}\``),
          `adapters.mdx must document MCP transport "${transport}"`);
      }
    });

    it('docs do NOT claim SSE support in this slice', () => {
      assert.doesNotMatch(adapterDocs, /- remote `sse`|`sse`.*\|\s*Supported|Supported.*`sse`/i,
        'adapters.mdx must not claim SSE support for the mcp adapter');
      assert.match(adapterDocs, /SSE transport is not part of this contract|does not require SSE support/i,
        'adapters.mdx must scope SSE as unsupported in this mcp slice');
    });

    it('docs bind to the real default tool name', () => {
      const toolMatch = mcpAdapterSource.match(/DEFAULT_MCP_TOOL_NAME\s*=\s*'([^']+)'/);
      assert.ok(toolMatch, 'DEFAULT_MCP_TOOL_NAME found in mcp-adapter.js');
      assert.match(adapterDocs, new RegExp(`\`${toolMatch[1]}\``),
        `adapters.mdx must document the default MCP tool name "${toolMatch[1]}"`);
    });

    it('docs do NOT claim arbitrary MCP server compatibility', () => {
      assert.doesNotMatch(adapterDocs, /any MCP server can execute a governed turn/i,
        'adapters.mdx must not claim arbitrary MCP server compatibility');
      assert.match(adapterDocs, /does not claim that any arbitrary MCP server can execute a governed turn/i,
        'adapters.mdx must explain the governed-turn tool boundary');
    });

    it('docs describe remote streamable_http config fields truthfully', () => {
      assert.match(adapterDocs, /`url`.*streamable_http|streamable_http.*`url`/i,
        'adapters.mdx must document the mcp streamable_http url field');
      assert.match(adapterDocs, /`headers`.*streamable_http|streamable_http.*`headers`/i,
        'adapters.mdx must document the mcp streamable_http headers field');
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

  describe('dispatch bundle truth', () => {
    it('docs list MANIFEST.json in the dispatch bundle table', () => {
      assert.match(adapterDocs, /\| `MANIFEST\.json` \|/,
        'dispatch bundle table must include MANIFEST.json');
    });

    it('ASSIGNMENT.json example uses runtime_id, not adapter/adapter_config', () => {
      assert.match(adapterDocs, /"runtime_id":\s*"local-dev"/,
        'ASSIGNMENT.json example must use runtime_id field');
      assert.doesNotMatch(adapterDocs, /"adapter":\s*"local_cli"/,
        'ASSIGNMENT.json example must not use fabricated adapter field');
      assert.doesNotMatch(adapterDocs, /"adapter_config"/,
        'ASSIGNMENT.json example must not use fabricated adapter_config field');
      assert.doesNotMatch(adapterDocs, /"context_ref"/,
        'ASSIGNMENT.json example must not use fabricated context_ref field');
      assert.doesNotMatch(adapterDocs, /"prompt_ref"/,
        'ASSIGNMENT.json example must not use fabricated prompt_ref field');
    });

    it('ASSIGNMENT.json example includes real fields', () => {
      assert.match(adapterDocs, /"write_authority"/,
        'ASSIGNMENT.json example must include write_authority');
      assert.match(adapterDocs, /"staging_result_path"/,
        'ASSIGNMENT.json example must include staging_result_path');
      assert.match(adapterDocs, /"allowed_next_roles"/,
        'ASSIGNMENT.json example must include allowed_next_roles');
      assert.match(adapterDocs, /"budget_reservation_usd"/,
        'ASSIGNMENT.json example must include budget_reservation_usd');
    });
  });

  describe('config format truth', () => {
    it('manual adapter config uses runtime/runtimes format, not adapter/adapter_config', () => {
      // The manual config section should show role.runtime referencing runtimes.<id>
      assert.match(adapterDocs, /"runtime":\s*"manual-pm"/,
        'manual adapter config must use runtime reference format');
      assert.match(adapterDocs, /"manual-pm":\s*\{[\s\S]*?"type":\s*"manual"/,
        'manual adapter config must define the runtime in the runtimes section');
    });

    it('local_cli config uses runtime/runtimes format with command array', () => {
      assert.match(adapterDocs, /"runtime":\s*"local-dev"/,
        'local_cli config must use runtime reference format');
      // command should be an array, not string + args
      assert.match(adapterDocs, /"command":\s*\["claude",\s*"--print",\s*"--dangerously-skip-permissions"\]/,
        'local_cli config must show command as an array, not string + separate args');
    });

    it('non-default init examples show command as single string in array', () => {
      // argv example: single string with {prompt} placeholder
      assert.match(adapterDocs, /"command":\s*\["my-agent run \{prompt\}"\]/,
        'argv example must show command as a single string in an array');
      // stdin custom example: single string
      assert.match(adapterDocs, /"command":\s*\["codex --quiet"\]/,
        'stdin custom example must show command as a single string in an array');
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

    it('comparison table includes the mcp adapter column', () => {
      assert.match(adapterDocs, /\| Feature \| manual \| local_cli \| mcp \| api_proxy \|/,
        'comparison table must include the mcp adapter');
    });
  });
});
