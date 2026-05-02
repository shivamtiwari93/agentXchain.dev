import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..', '..');
const read = (rel) => readFileSync(resolve(ROOT, rel), 'utf8');
const { integrationSections } = await import(
  pathToFileURL(resolve(ROOT, 'website-v2/src/data/integrations.mjs')).href
);
const indexEntry = (title) => integrationSections
  .flatMap((section) => section.items)
  .find((item) => item.title === title);

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
// Jules guide must not pretend Gemini API == direct Jules integration
// ---------------------------------------------------------------------------
describe('Google Jules guide factual accuracy', () => {
  const guide = read('website-v2/docs/integrations/google-jules.mdx');
  const index = read('website-v2/docs/integrations/index.mdx');

  it('FA-JULES-001: must state that direct Jules integration is not yet shipped', () => {
    assert.match(guide, /does \*\*not\*\* currently ship a native Jules connector|not shipped yet|not currently ship/i,
      'Jules guide must explicitly say that native Jules integration is not currently shipped');
  });

  it('FA-JULES-002: must name the Gemini / Google Generative AI path as the supported current path', () => {
    assert.match(guide, /closest supported path today|Generative AI API|generativelanguage\.googleapis\.com/i,
      'Jules guide must name the Gemini / Google Generative AI path as the currently supported path');
  });

  it('FA-JULES-003: must mention Jules REST API or Jules Tools CLI as separate official surfaces', () => {
    assert.match(guide, /Jules REST API|Jules Tools CLI|jules\.google\/docs\/api\/reference|jules\.google\/docs\/cli\/reference/i,
      'Jules guide must mention the official Jules API or CLI as separate surfaces');
  });

  it('FA-JULES-004: must distinguish GOOGLE_API_KEY from JULES_API_KEY auth', () => {
    assert.match(guide, /GOOGLE_API_KEY[\s\S]*JULES_API_KEY|JULES_API_KEY[\s\S]*GOOGLE_API_KEY/i,
      'Jules guide must distinguish Gemini auth from Jules auth');
  });

  it('FA-JULES-005: must not claim provider google is a direct Jules connector', () => {
    assert.doesNotMatch(guide, /connects to AgentXchain via the `api_proxy` adapter using Google's Generative AI API/i,
      'Jules guide must not claim that provider google directly connects the Jules product');
  });

  it('FA-JULES-006: integrations index must clarify that the current path is not a native Jules connector', () => {
    assert.equal(indexEntry('Google Jules')?.summary, 'Gemini path today; native Jules connector not yet shipped',
      'Integrations index data must clarify the Jules entry instead of labeling it as a direct adapter integration');
  });
});

// ---------------------------------------------------------------------------
// Cursor guide must not pretend a native Cursor connector exists
// ---------------------------------------------------------------------------
describe('Cursor guide factual accuracy', () => {
  const guide = read('website-v2/docs/integrations/cursor.mdx');

  it('FA-CURSOR-001: must state that native Cursor connector is not shipped', () => {
    assert.match(guide, /does not currently ship a native Cursor connector/i,
      'Cursor guide must explicitly say no native Cursor connector is shipped');
  });

  it('FA-CURSOR-002: must not show cursor --cli as a working command in primary config', () => {
    const primarySection = guide.split(/## Future/i)[0];
    assert.doesNotMatch(primarySection, /"cursor",\s*"--cli"/,
      'Primary config must not show cursor --cli as a working command');
  });

  it('FA-CURSOR-003: primary config must use a proven CLI agent (Claude Code or Codex)', () => {
    assert.match(guide, /"claude"|"codex"/,
      'Cursor guide primary config must use a proven CLI agent');
  });

  it('FA-CURSOR-004: must state Cursor is GUI-first with no headless CLI mode', () => {
    assert.match(guide, /GUI-only|does not expose.*headless/i,
      'Cursor guide must state that Cursor AI features are GUI-only');
  });

  it('FA-CURSOR-005: speculative future CLI section must be labeled as not working today', () => {
    const futureSection = guide.split(/## Future/i)[1] || '';
    assert.match(futureSection, /speculative|not a working config today/i,
      'Future CLI section must be labeled as speculative');
  });

  it('FA-CURSOR-006: integrations index must clarify no native connector', () => {
    assert.equal(indexEntry('Cursor')?.summary, 'Editor + separate CLI agent; no native Cursor connector yet',
      'Integrations index data must clarify the Cursor entry is not a direct adapter integration');
  });
});

// ---------------------------------------------------------------------------
// Windsurf guide must not pretend a native Windsurf connector exists
// ---------------------------------------------------------------------------
describe('Windsurf guide factual accuracy', () => {
  const guide = read('website-v2/docs/integrations/windsurf.mdx');

  it('FA-WINDSURF-001: must state that native Windsurf connector is not shipped', () => {
    assert.match(guide, /does not currently ship a native Windsurf connector/i,
      'Windsurf guide must explicitly say no native Windsurf connector is shipped');
  });

  it('FA-WINDSURF-002: must not show windsurf --cli as a working command in primary config', () => {
    // The speculative future section may mention it, but the primary config must not
    const primarySection = guide.split(/## Future/i)[0];
    assert.doesNotMatch(primarySection, /"windsurf",\s*"--cli"/,
      'Primary config must not show windsurf --cli as a working command');
  });

  it('FA-WINDSURF-003: primary config must use a proven CLI agent (Claude Code or Codex)', () => {
    assert.match(guide, /"claude"|"codex"/,
      'Windsurf guide primary config must use a proven CLI agent');
  });

  it('FA-WINDSURF-004: must state Windsurf is GUI-first with no headless CLI', () => {
    assert.match(guide, /GUI-first|GUI-only|does not expose.*headless/i,
      'Windsurf guide must state that Windsurf is a GUI-first IDE');
  });

  it('FA-WINDSURF-005: speculative future CLI section must be labeled as not working today', () => {
    const futureSection = guide.split(/## Future/i)[1] || '';
    assert.match(futureSection, /speculative|not a working config today/i,
      'Future CLI section must be labeled as speculative');
  });

  it('FA-WINDSURF-006: integrations index must clarify no native connector', () => {
    assert.equal(indexEntry('Windsurf (Codeium)')?.summary, 'Editor + separate CLI agent; no native Windsurf connector yet',
      'Integrations index data must clarify the Windsurf entry is not a direct adapter integration');
  });
});

// ---------------------------------------------------------------------------
// Integrations index must render from shared metadata, not a hand-written list
// ---------------------------------------------------------------------------
describe('Integrations index source of truth', () => {
  const index = read('website-v2/docs/integrations/index.mdx');

  it('FA-INDEX-001: index imports the shared integrations data module', () => {
    assert.match(index, /integrationSections.*@site\/src\/data\/integrations\.mjs/,
      'Integrations index must import shared integrations metadata');
  });

  it('FA-INDEX-002: index renders the shared integrations component', () => {
    assert.match(index, /<IntegrationsIndexSections sections=\{integrationSections\} \/>/,
      'Integrations index must render the shared integrations index component');
  });

  it('FA-INDEX-003: index no longer contains the old hand-written Cursor bullet', () => {
    assert.doesNotMatch(index, /- \[Cursor\]\(\/docs\/integrations\/cursor\)/,
      'Integrations index must not keep the old hand-written bullet list');
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

// ---------------------------------------------------------------------------
// FA-6: cost_rates examples must explain override truth for non-bundled models
// ---------------------------------------------------------------------------
const COST_OVERRIDE_GUIDES = [
  {
    path: 'website-v2/docs/integrations/openai.mdx',
    model: 'gpt-5.4',
  },
  {
    path: 'website-v2/docs/integrations/cohere.mdx',
    model: 'command-a-reasoning',
  },
  {
    path: 'website-v2/docs/integrations/deepseek.mdx',
    model: 'deepseek-coder-v3',
  },
  {
    path: 'website-v2/docs/integrations/groq.mdx',
    model: 'gpt-oss-120b',
  },
  {
    path: 'website-v2/docs/integrations/xai.mdx',
    model: 'grok-4.20-beta-2',
  },
  {
    path: 'website-v2/docs/integrations/amazon.mdx',
    model: 'bedrock/amazon.nova-pro-v2',
  },
];

describe('Integration guide cost-rate override truth (FA-6)', () => {
  for (const { path, model } of COST_OVERRIDE_GUIDES) {
    const guide = read(path);
    const name = path.split('/').pop().replace('.mdx', '');

    it(`FA-COST-${name}-001: explains cost_rates as operator overrides`, () => {
      assert.match(guide, /operator override/i,
        `${name} guide must say the cost_rates example is an operator override`);
    });

    it(`FA-COST-${name}-002: requires exact runtime model string as key`, () => {
      assert.match(guide, /exact runtime `model` string/i,
        `${name} guide must tell operators to use the exact runtime model string as the cost_rates key`);
      assert.match(guide, new RegExp(model.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
        `${name} guide must retain the example model key ${model}`);
    });

    it(`FA-COST-${name}-003: explains bundled defaults do not cover the example model`, () => {
      assert.match(guide, /bundled (cost )?defaults?/i,
        `${name} guide must explain that bundled defaults do not cover this example model`);
    });
  }
});
