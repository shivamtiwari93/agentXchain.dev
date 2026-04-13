import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');
const read = (rel) => readFileSync(resolve(ROOT, rel), 'utf8');

// ---------------------------------------------------------------------------
// FA-1 / FA-2 / FA-3: Amazon Bedrock must not pretend direct API key auth works
// ---------------------------------------------------------------------------
describe('Amazon Bedrock guide factual accuracy', () => {
  const guide = read('website-v2/docs/integrations/amazon.mdx');

  it('FA-BEDROCK-001: must mention SigV4 or IAM auth requirement', () => {
    assert.match(guide, /SigV4|sigv4|IAM/i,
      'Bedrock guide must explicitly state SigV4/IAM auth requirement');
  });

  it('FA-BEDROCK-002: must not show BEDROCK_API_KEY as working env var', () => {
    // The guide may mention the concept but must not present it as a working auth_env
    assert.doesNotMatch(guide, /auth_env.*BEDROCK_API_KEY/,
      'Bedrock guide must not show auth_env: "BEDROCK_API_KEY" — Bedrock does not accept API keys');
  });

  it('FA-BEDROCK-003: must not show bedrock-runtime URL as base_url in config', () => {
    // The config block's base_url should point to a proxy, not directly to bedrock-runtime
    const configBlocks = guide.match(/```json[\s\S]*?```/g) || [];
    const runtimeConfigs = configBlocks.filter(b => b.includes('"base_url"'));
    for (const block of runtimeConfigs) {
      assert.doesNotMatch(block, /bedrock-runtime\.\w+\.amazonaws\.com/,
        'Config base_url must not point directly to bedrock-runtime — must use a proxy');
    }
  });

  it('FA-BEDROCK-004: must mention proxy requirement prominently', () => {
    assert.match(guide, /proxy/i,
      'Bedrock guide must describe the proxy requirement');
  });

  it('FA-BEDROCK-005: must show proxy setup instructions', () => {
    assert.match(guide, /litellm|LiteLLM|Bedrock Access Gateway/,
      'Bedrock guide must show at least one proxy option (LiteLLM or Bedrock Access Gateway)');
  });
});

// ---------------------------------------------------------------------------
// FA-4: Devin guide must label illustrative URLs
// ---------------------------------------------------------------------------
describe('Devin guide factual accuracy', () => {
  const guide = read('website-v2/docs/integrations/devin.mdx');

  it('FA-DEVIN-001: must label URLs as illustrative', () => {
    assert.match(guide, /illustrative/i,
      'Devin guide must label example URLs as illustrative');
  });

  it('FA-DEVIN-002: must mention checking Devin API docs', () => {
    assert.match(guide, /Devin.*API.*documentation|API.*documentation.*Devin|current API/i,
      'Devin guide must tell operators to check current Devin API docs');
  });
});

// ---------------------------------------------------------------------------
// FA-5: All guides must have governed bootstrap example
// ---------------------------------------------------------------------------
const ALL_GUIDES = [
  'website-v2/docs/integrations/anthropic.mdx',
  'website-v2/docs/integrations/openai.mdx',
  'website-v2/docs/integrations/google.mdx',
  'website-v2/docs/integrations/google-jules.mdx',
  'website-v2/docs/integrations/deepseek.mdx',
  'website-v2/docs/integrations/mistral.mdx',
  'website-v2/docs/integrations/xai.mdx',
  'website-v2/docs/integrations/amazon.mdx',
  'website-v2/docs/integrations/qwen.mdx',
  'website-v2/docs/integrations/groq.mdx',
  'website-v2/docs/integrations/cohere.mdx',
  'website-v2/docs/integrations/ollama.mdx',
  'website-v2/docs/integrations/mlx.mdx',
  'website-v2/docs/integrations/devin.mdx',
  'website-v2/docs/integrations/mcp.mdx',
  'website-v2/docs/integrations/claude-code.mdx',
  'website-v2/docs/integrations/openai-codex-cli.mdx',
  'website-v2/docs/integrations/cursor.mdx',
  'website-v2/docs/integrations/vscode.mdx',
  'website-v2/docs/integrations/windsurf.mdx',
  'website-v2/docs/integrations/openclaw.mdx',
];

describe('All integration guides must have governed bootstrap example (FA-5)', () => {
  for (const guidePath of ALL_GUIDES) {
    const name = guidePath.split('/').pop().replace('.mdx', '');
    const guide = read(guidePath);

    it(`FA-BOOTSTRAP-${name}-001: has init --governed`, () => {
      assert.match(guide, /init --governed/,
        `${name} guide must show the governed init command`);
    });

    it(`FA-BOOTSTRAP-${name}-002: has agentxchain doctor or connector check`, () => {
      assert.match(guide, /agentxchain (doctor|connector check)/,
        `${name} guide must include doctor or connector check step`);
    });

    it(`FA-BOOTSTRAP-${name}-003: mentions guided interactive path`, () => {
      assert.match(guide, /without.*-y|interactive|guided/i,
        `${name} guide must mention the guided interactive scaffold path`);
    });
  }
});
