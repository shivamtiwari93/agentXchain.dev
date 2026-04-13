import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');
const read = (rel) => readFileSync(resolve(ROOT, rel), 'utf8');

/**
 * Guard test: local_cli integration guides must use the governed bootstrap path
 * established by DEC-COMPARISON-LAUNCH-FRONTDOOR-001 and DEC-GUIDED-GOVERNED-INIT-001.
 *
 * Correct pattern:
 *   agentxchain init --governed ... --dir <dir> -y
 *   cd <dir>
 *   agentxchain doctor
 *   agentxchain run
 *
 * Anti-patterns:
 *   - mkdir + cd instead of --dir flag
 *   - missing agentxchain doctor before run
 *   - no mention of guided interactive path
 */

const LOCAL_CLI_GUIDES = [
  'website-v2/docs/integrations/claude-code.mdx',
  'website-v2/docs/integrations/openai-codex-cli.mdx',
  'website-v2/docs/integrations/cursor.mdx',
  'website-v2/docs/integrations/vscode.mdx',
  'website-v2/docs/integrations/ollama.mdx',
  'website-v2/docs/integrations/openclaw.mdx',
];

describe('Local CLI integration guide bootstrap paths', () => {
  for (const guidePath of LOCAL_CLI_GUIDES) {
    const name = guidePath.split('/').pop().replace('.mdx', '');

    describe(name, () => {
      it(`AT-LCG-${name}-001: guide exists`, () => {
        assert.ok(
          existsSync(resolve(ROOT, guidePath)),
          `${guidePath} must exist`
        );
      });

      it(`AT-LCG-${name}-002: uses --dir flag instead of mkdir`, () => {
        const content = read(guidePath);
        assert.ok(
          !content.includes('mkdir my-project'),
          `${name} must not use "mkdir my-project" — use --dir flag instead`
        );
      });

      it(`AT-LCG-${name}-003: includes agentxchain doctor before run`, () => {
        const content = read(guidePath);
        assert.ok(
          content.includes('agentxchain doctor'),
          `${name} must include "agentxchain doctor" in the bootstrap path`
        );
      });

      it(`AT-LCG-${name}-004: mentions guided interactive init path`, () => {
        const content = read(guidePath);
        assert.ok(
          content.includes('agentxchain init --governed\n') ||
          content.includes('agentxchain init --governed`'),
          `${name} must mention the guided interactive path (agentxchain init --governed without -y)`
        );
      });
    });
  }
});
