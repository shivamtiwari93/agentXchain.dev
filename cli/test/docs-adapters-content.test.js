import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  BUNDLED_COST_RATES,
  DEFAULT_RETRY_POLICY,
  PROVIDER_ENDPOINTS,
  RETRYABLE_ERROR_CLASSES,
} from '../src/lib/adapters/api-proxy-adapter.js';
import { VALID_API_PROXY_PROVIDERS, VALID_PROMPT_TRANSPORTS, validateV4Config } from '../src/lib/normalized-config.js';

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
    it('docs list the correct transport mode names', () => {
      for (const transport of VALID_PROMPT_TRANSPORTS) {
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

  describe('workflow-kit accountability truth', () => {
    it('documents the review_only attestation boundary', () => {
      assert.match(adapterDocs, /review_only.*attestation|attestation, not file authorship/i,
        'adapters.mdx must explain that review_only ownership is attestation, not direct file writing');
      assert.match(adapterDocs, /reviewing and attesting/i,
        'adapters.mdx must use the shipped review_only prompt language');
      assert.match(adapterDocs, /cannot write repo files directly|escalate if a required artifact is missing/i,
        'adapters.mdx must explain the non-writing boundary for review_only workflow-kit ownership');
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
      for (const errorClass of RETRYABLE_ERROR_CLASSES) {
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
      assert.match(adapterDocs, new RegExp(`\`max_attempts\`.*${DEFAULT_RETRY_POLICY.max_attempts}|max_attempts.*${DEFAULT_RETRY_POLICY.max_attempts}`),
        `adapters.mdx must document max_attempts default as ${DEFAULT_RETRY_POLICY.max_attempts}`);
      assert.match(adapterDocs, new RegExp(String(DEFAULT_RETRY_POLICY.base_delay_ms)),
        `adapters.mdx must document base_delay_ms default as ${DEFAULT_RETRY_POLICY.base_delay_ms}`);
      assert.match(adapterDocs, new RegExp(`"${DEFAULT_RETRY_POLICY.jitter}"|'${DEFAULT_RETRY_POLICY.jitter}'|\`${DEFAULT_RETRY_POLICY.jitter}\``),
        `adapters.mdx must document jitter default as "${DEFAULT_RETRY_POLICY.jitter}"`);
    });
  });

  describe('api_proxy model tier and retry budget warning', () => {
    it('docs contain a model-tier retry warning section', () => {
      assert.match(adapterDocs, /### Model tier and retry budget/,
        'adapters.mdx must have a "Model tier and retry budget" section');
    });

    it('docs reference real models from the BUNDLED_COST_RATES table', () => {
      for (const modelId of Object.keys(BUNDLED_COST_RATES)) {
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
    it('normalized-config provider allowlist matches adapter endpoints', () => {
      const providers = Object.keys(PROVIDER_ENDPOINTS);
      assert.deepEqual([...VALID_API_PROXY_PROVIDERS].sort(), [...providers].sort(),
        'normalized-config.js must allow exactly the provider families implemented by api-proxy-adapter.js');
    });

    it('PROVIDER_ENDPOINTS keys match docs', () => {
      for (const provider of Object.keys(PROVIDER_ENDPOINTS)) {
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

    it('docs list Google Gemini support when PROVIDER_ENDPOINTS includes it', () => {
      assert.match(apiProxySource, /google:\s*'https:\/\/generativelanguage\.googleapis\.com\/v1beta\/models\/\{model\}:generateContent'/,
        'api-proxy-adapter.js must register the Google Gemini endpoint');
      assert.match(adapterDocs, /Google runtime for Gemini models|Google.*Gemini|Gemini.*Google/i,
        'adapters.mdx must document Google Gemini as a supported provider');
      assert.match(adapterDocs, /API-key-as-query-parameter auth|query parameter/i,
        'adapters.mdx must document the Google API-key query-parameter auth boundary');
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

  describe('api_proxy write authority restriction', () => {
    it('code enforces write authority for api_proxy', () => {
      const invalidAuthoritativeConfig = {
        version: 4,
        project: { id: 'docs-contract', name: 'Docs Contract' },
        roles: {
          builder: {
            title: 'Builder',
            mandate: 'Ship changes',
            write_authority: 'authoritative',
            runtime: 'proxy',
          },
        },
        runtimes: {
          proxy: {
            type: 'api_proxy',
            provider: 'anthropic',
            model: 'claude-sonnet-4-6',
            auth_env: 'ANTHROPIC_API_KEY',
          },
        },
      };
      const validation = validateV4Config(invalidAuthoritativeConfig, ROOT);
      assert.equal(validation.ok, false,
        'validateV4Config must reject authoritative roles bound to api_proxy runtimes');
      assert.ok(validation.errors.some((error) => /api_proxy only supports review_only and proposed roles/i.test(error)),
        'validateV4Config must surface the api_proxy authority boundary');
    });

    it('docs document the write authority support', () => {
      assert.match(adapterDocs, /review_only.*proposed|proposed.*review_only/i,
        'adapters.mdx must document that api_proxy supports review_only and proposed roles');
    });

    it('docs say api_proxy turns do not write QA planning files directly', () => {
      assert.match(adapterDocs, /cannot directly author|not applied automatically/i,
        'adapters.mdx must explain that api_proxy does not write planning files directly');
      assert.match(adapterDocs, /\.agentxchain\/reviews\//,
        'adapters.mdx must mention the orchestrator-materialized review artifact path');
    });

    it('docs mention proposed changes materialization path', () => {
      assert.match(adapterDocs, /\.agentxchain\/proposed\//,
        'adapters.mdx must mention the proposed changes materialization path');
    });

    it('docs explain proposal apply conflict detection and force override', () => {
      assert.match(adapterDocs, /fails closed|silently overwriting/i,
        'adapters.mdx must explain that proposal apply refuses diverged workspace state');
      assert.match(adapterDocs, /--force/,
        'adapters.mdx must document the explicit operator override for proposal conflicts');
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

  describe('custom phase workflow-kit boundary', () => {
    it('docs explain that custom phases need explicit workflow_kit for scaffolded artifacts', () => {
      assert.match(adapterDocs, /workflow_kit/,
        'adapters.mdx must mention workflow_kit for custom-phase artifact contracts');
      assert.match(adapterDocs, /requires_files alone|do not inherit the built-in/i,
        'adapters.mdx must explain the boundary between gate files and workflow-kit scaffold truth');
    });

    it('AT-WKP-006: docs explain prompt accountability vs context visibility', () => {
      assert.match(adapterDocs, /PROMPT\.md.*workflow-kit responsibilities|workflow-kit responsibilities.*PROMPT\.md/i,
        'adapters.mdx must document role-scoped workflow-kit prompt guidance');
      assert.match(adapterDocs, /CONTEXT\.md.*Workflow Artifacts|Workflow Artifacts.*CONTEXT\.md/i,
        'adapters.mdx must document the phase-wide workflow artifact table in CONTEXT.md');
      assert.match(adapterDocs, /owned_by.*entry_role|entry_role.*owned_by/i,
        'adapters.mdx must explain ownership resolution for workflow-kit prompt guidance');
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
      assert.match(adapterDocs, /"command":\s*\["claude --print --dangerously-skip-permissions"\]/,
        'stdin custom example must show command as a single string in an array');
    });
  });

  describe('comparison table', () => {
    it('local_cli prompt transport lists correct modes', () => {
      // The comparison table row for local_cli should list the real transport modes
      assert.match(adapterDocs, /`argv`.*`stdin`.*`dispatch_bundle_only`/,
        'comparison table must list correct prompt transport modes for local_cli');
    });

    it('comparison table documents write authority constraint for api_proxy', () => {
      assert.match(adapterDocs, /review_only.*proposed.*only/i,
        'comparison table must note the write authority constraint for api_proxy');
    });

    it('comparison table states 10s grace period', () => {
      assert.match(adapterDocs, /SIGTERM.*10s.*SIGKILL/i,
        'comparison table must state 10s grace period');
    });

    it('comparison table uses the canonical shipped adapter order', () => {
      assert.match(adapterDocs, /\| Feature \| manual \| local_cli \| api_proxy \| mcp \| remote_agent \|/,
        'comparison table must use the canonical shipped adapter order');
      assert.doesNotMatch(adapterDocs, /\| Feature \| manual \| local_cli \| mcp \| api_proxy \|/,
        'comparison table must not regress to the stale mcp-before-api_proxy order');
    });

    it('page metadata uses the canonical shipped adapter order', () => {
      assert.match(adapterDocs, /description: "Five adapters, one contract\. manual, local_cli, api_proxy, mcp, and remote_agent explained\."/,
        'adapters.mdx frontmatter must use the canonical shipped adapter order');
      assert.doesNotMatch(adapterDocs, /description: "Five adapters, one contract\. manual, local_cli, mcp, api_proxy, and remote_agent explained\."/,
        'adapters.mdx frontmatter must not regress to the stale adapter order');
    });
  });

  describe('remote_agent authority boundary', () => {
    it('docs state that remote_agent is review_only/proposed only in v1', () => {
      assert.match(adapterDocs, /remote_agent.*review_only.*proposed/i,
        'adapters.mdx must document remote_agent support for review_only/proposed roles');
      assert.match(adapterDocs, /authoritative.*not supported in v1/i,
        'adapters.mdx must explicitly reject authoritative remote_agent claims in v1');
    });

    it('docs mention proposal apply as the remote proposed workflow', () => {
      assert.match(adapterDocs, /proposal apply/i,
        'adapters.mdx must explain that remote_agent proposed turns materialize proposals for proposal apply');
    });

    it('docs warn about the DEC-NNN and review objection validator traps', () => {
      assert.match(adapterDocs, /DEC-NNN/i,
        'adapters.mdx must tell implementors that decision IDs must match DEC-NNN');
      assert.match(adapterDocs, /review_only.*at least one objection|at least one objection.*review_only/i,
        'adapters.mdx must document the review_only objection requirement for remote_agent implementors');
    });

    it('docs do not imply header interpolation that the runtime does not implement', () => {
      assert.doesNotMatch(adapterDocs, /REMOTE_AGENT_TOKEN/,
        'adapters.mdx must not imply REMOTE_AGENT_TOKEN header interpolation support');
      assert.match(adapterDocs, /does not interpolate.*headers|pre-expand secrets/i,
        'adapters.mdx must state that header values are literal and must be pre-expanded');
    });
  });
});
