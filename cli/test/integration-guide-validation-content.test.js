import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

function read(relPath) {
  return readFileSync(join(REPO_ROOT, relPath), 'utf8');
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const GUIDES = [
  { path: 'website-v2/docs/integrations/amazon.mdx', validate: 'agentxchain connector validate nova-dev' },
  { path: 'website-v2/docs/integrations/anthropic.mdx', validate: 'agentxchain connector validate claude-qa' },
  { path: 'website-v2/docs/integrations/claude-code.mdx', validate: 'agentxchain connector validate claude-dev' },
  { path: 'website-v2/docs/integrations/cohere.mdx', validate: 'agentxchain connector validate cohere-dev' },
  { path: 'website-v2/docs/integrations/cursor.mdx', validate: 'agentxchain connector validate <runtime_id>' },
  { path: 'website-v2/docs/integrations/deepseek.mdx', validate: 'agentxchain connector validate deepseek-dev' },
  { path: 'website-v2/docs/integrations/devin.mdx', validate: 'agentxchain connector validate devin-dev' },
  { path: 'website-v2/docs/integrations/google-jules.mdx', validate: 'agentxchain connector validate google-dev' },
  { path: 'website-v2/docs/integrations/google.mdx', validate: 'agentxchain connector validate gemini-dev' },
  { path: 'website-v2/docs/integrations/groq.mdx', validate: 'agentxchain connector validate groq-dev' },
  { path: 'website-v2/docs/integrations/mcp.mdx', validate: 'agentxchain connector validate mcp-dev' },
  { path: 'website-v2/docs/integrations/mistral.mdx', validate: 'agentxchain connector validate mistral-dev' },
  { path: 'website-v2/docs/integrations/mlx.mdx', validate: 'agentxchain connector validate mlx-dev' },
  { path: 'website-v2/docs/integrations/ollama.mdx', validate: 'agentxchain connector validate ollama-dev' },
  { path: 'website-v2/docs/integrations/openai-codex-cli.mdx', validate: 'agentxchain connector validate codex-dev' },
  { path: 'website-v2/docs/integrations/openai.mdx', validate: 'agentxchain connector validate gpt-dev' },
  { path: 'website-v2/docs/integrations/openclaw.mdx', validate: 'agentxchain connector validate openclaw-dev' },
  { path: 'website-v2/docs/integrations/qwen.mdx', validate: 'agentxchain connector validate qwen-dev' },
  { path: 'website-v2/docs/integrations/windsurf.mdx', validate: 'agentxchain connector validate <runtime_id>' },
  { path: 'website-v2/docs/integrations/xai.mdx', validate: 'agentxchain connector validate grok-dev' },
];

describe('integration guide validation handoff', () => {
  for (const { path, validate } of GUIDES) {
    const guide = read(path);
    const shortName = path.split('/').pop().replace('.mdx', '');

    it(`AT-CCV-009 ${shortName}: includes connector validate after connector check before run`, () => {
      assert.match(
        guide,
        new RegExp(
          `${escapeRegex('agentxchain doctor')}[\\s\\S]*` +
            `${escapeRegex('agentxchain connector check')}[\\s\\S]*` +
            `${escapeRegex(validate)}[\\s\\S]*` +
            `${escapeRegex('agentxchain run')}`
        ),
        `${shortName} must show doctor -> connector check -> connector validate -> run`
      );
    });

    it(`AT-CCV-009 ${shortName}: mentions the guide-specific connector validate command`, () => {
      assert.match(
        guide,
        new RegExp(escapeRegex(validate)),
        `${shortName} must include ${validate}`
      );
    });

    if (guide.includes('## Verify the connection')) {
      it(`AT-CCV-009 ${shortName}: verify section includes connector validate`, () => {
        const verifySection = guide.split('## Verify the connection')[1].split('\n## ', 1)[0];
        assert.match(
          verifySection,
          new RegExp(escapeRegex(validate)),
          `${shortName} verify section must include ${validate}`
        );
      });
    }
  }
});
