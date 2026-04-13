import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');
const read = (rel) => readFileSync(resolve(ROOT, rel), 'utf8');

const API_PROXY_GUIDES = [
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
];

describe('API proxy integration guide bootstrap paths', () => {
  for (const guidePath of API_PROXY_GUIDES) {
    const name = guidePath.split('/').pop().replace('.mdx', '');

    describe(name, () => {
      it(`AT-APG-${name}-001: guide exists`, () => {
        assert.ok(
          existsSync(resolve(ROOT, guidePath)),
          `${guidePath} must exist`
        );
      });

      it(`AT-APG-${name}-002: avoids mkdir bootstrap anti-pattern`, () => {
        const content = read(guidePath);
        assert.ok(
          !content.includes('mkdir my-project'),
          `${name} must not use "mkdir my-project" — use --dir flag instead`
        );
      });

      it(`AT-APG-${name}-003: includes non-interactive governed bootstrap with --dir`, () => {
        const content = read(guidePath);
        assert.ok(
          content.includes('agentxchain init --governed') &&
            content.includes('--dir my-project -y'),
          `${name} must include a governed bootstrap example with --dir my-project -y`
        );
      });

      it(`AT-APG-${name}-004: includes connector check`, () => {
        const content = read(guidePath);
        assert.ok(
          content.includes('agentxchain connector check'),
          `${name} must include "agentxchain connector check"`
        );
      });

      it(`AT-APG-${name}-005: includes doctor before run`, () => {
        const content = read(guidePath);
        assert.ok(
          content.includes('agentxchain doctor'),
          `${name} must include "agentxchain doctor"`
        );
      });

      it(`AT-APG-${name}-006: includes governed run command`, () => {
        const content = read(guidePath);
        assert.ok(
          content.includes('agentxchain run'),
          `${name} must include "agentxchain run"`
        );
      });

      it(`AT-APG-${name}-007: mentions guided interactive init path`, () => {
        const content = read(guidePath);
        assert.ok(
          content.includes('agentxchain init --governed`') ||
            content.includes('agentxchain init --governed\n'),
          `${name} must mention the guided interactive path`
        );
      });

      it(`AT-APG-${name}-008: tells operators to update agentxchain.json first`, () => {
        const content = read(guidePath);
        assert.ok(
          content.includes('update `agentxchain.json`') ||
            content.includes('Replace the scaffolded runtime wiring in agentxchain.json'),
          `${name} must tell operators to wire the guide config into agentxchain.json before probing or running`
        );
      });
    });
  }
});
