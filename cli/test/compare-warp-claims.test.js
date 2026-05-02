import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..', '..');
const page = readFileSync(resolve(root, 'website-v2/docs/compare/vs-warp.mdx'), 'utf8');
const spec = readFileSync(resolve(root, '.planning/COMPARE_WARP_CLAIMS_SPEC.md'), 'utf8');
const legacySpec = readFileSync(resolve(root, '.planning/COMPARE_VS_WARP_SPEC.md'), 'utf8');
const matrix = readFileSync(resolve(root, '.planning/COMPETITIVE_POSITIONING_MATRIX.md'), 'utf8');

describe('Warp comparison claims truth boundary', () => {
  it('AT-WARP-CLAIMS-001: acknowledges Agentic Development Environment framing', () => {
    assert.match(page, /Agentic Development Environment/i, 'must acknowledge current official ADE framing');
    assert.match(page, /AI-native terminal/i, 'must keep legacy search-friendly framing');
  });

  it('AT-WARP-CLAIMS-002: acknowledges Oz cloud-agent orchestration', () => {
    assert.match(page, /Oz cloud-agent|Oz.*cloud-agent|cloud-agent orchestration/i, 'must acknowledge Oz cloud-agent orchestration');
    assert.match(page, /Warp Terminal/i, 'must distinguish Warp Terminal from Oz');
  });

  it('AT-WARP-CLAIMS-003: acknowledges third-party CLI agent support', () => {
    assert.match(page, /third-party CLI agents/i, 'must acknowledge third-party CLI agent support');
    assert.match(page, /Claude Code/i, 'must acknowledge Claude Code support');
    assert.match(page, /OpenAI Codex CLI|Codex/i, 'must acknowledge Codex CLI support');
    assert.match(page, /Gemini CLI/i, 'must acknowledge Gemini CLI support');
    assert.match(page, /OpenCode/i, 'must acknowledge OpenCode support');
  });

  it('AT-WARP-CLAIMS-004: acknowledges profiles, permissions, and autonomy controls', () => {
    assert.match(page, /agent profiles/i, 'must acknowledge agent profiles');
    assert.match(page, /allowlists?\/denylists?|command allowlists?|command denylists?/i, 'must acknowledge command allowlists and denylists');
    assert.match(page, /Run until completion/i, 'must acknowledge Run until completion');
    assert.match(page, /MCP permissions/i, 'must acknowledge MCP permissions');
  });

  it('AT-WARP-CLAIMS-005: acknowledges Full Terminal Use', () => {
    assert.match(page, /Full Terminal Use/i, 'must acknowledge Full Terminal Use');
    assert.match(page, /REPLs|debuggers|servers|editors/i, 'must explain interactive terminal program scope');
  });

  it('AT-WARP-CLAIMS-006: acknowledges Warp Drive and AGENTS.md', () => {
    assert.match(page, /Warp Drive/i, 'must acknowledge Warp Drive');
    assert.match(page, /prompts, notebooks, workflows, rules/i, 'must describe Warp Drive resource types');
    assert.match(page, /AGENTS\.md/i, 'must acknowledge project-scoped AGENTS.md rules');
  });

  it('AT-WARP-CLAIMS-007: acknowledges Oz platform automation surfaces', () => {
    assert.match(page, /CLI\/API\/SDK\/web app|CLI.*API.*SDK.*web app/i, 'must acknowledge CLI/API/SDK/web app');
    assert.match(page, /schedules/i, 'must acknowledge scheduled runs');
    assert.match(page, /environments/i, 'must acknowledge environments');
    assert.match(page, /Slack\/Linear\/GitHub\/custom triggers|Slack.*Linear.*GitHub/i, 'must acknowledge integrations and triggers');
    assert.match(page, /self-hosted|Warp-hosted/i, 'must acknowledge hosting options');
  });

  it('AT-WARP-CLAIMS-008: contrasts with governed software delivery', () => {
    assert.match(page, /governed software delivery|delivery-governance protocol|governance protocol/i, 'must contrast with governed delivery');
    assert.match(page, /mandatory disagreement|mandatory challenge/i, 'must name mandatory challenge boundary');
    assert.match(page, /phase gates|constitutional/i, 'must name phase gate or constitutional authority boundary');
  });

  it('AT-WARP-CLAIMS-009: exposes official source links and last-checked date', () => {
    assert.match(page, /Source baseline/, 'Warp page must expose source baseline');
    assert.match(page, /2026-04-25/, 'must include last-checked date');
    for (const url of [
      'https://docs.warp.dev/',
      'https://docs.warp.dev/agent-platform',
      'https://docs.warp.dev/agent-platform/getting-started/agents-in-warp',
      'https://docs.warp.dev/agent-platform/capabilities/agent-profiles-permissions',
      'https://docs.warp.dev/agent-platform/capabilities/full-terminal-use',
      'https://docs.warp.dev/agent-platform/capabilities/codebase-context',
      'https://docs.warp.dev/agent-platform/local-agents/third-party-cli-agents',
      'https://docs.warp.dev/agent-platform/cloud-agents/platform',
      'https://docs.warp.dev/reference/cli/cli',
      'https://docs.warp.dev/reference/cli/warp-drive',
      'https://docs.warp.dev/agent-platform/cloud-agents/environments',
      'https://docs.warp.dev/agent-platform/cloud-agents/integrations',
      'https://docs.warp.dev/agent-platform/cloud-agents/oz-web-app',
      'https://docs.warp.dev/reference/api-and-sdk/schedules',
      'https://docs.warp.dev/enterprise',
      'https://www.warp.dev/ai',
    ]) {
      assert.ok(page.includes(url), `Warp comparison page must link to ${url}`);
    }
    assert.match(spec, /AT-WARP-CLAIMS-009/, 'spec must reference AT-WARP-CLAIMS-009');
  });

  it('AT-WARP-CLAIMS-010: matrix and legacy spec are aligned to the docs route', () => {
    assert.match(matrix, /\*\*Warp\*\*/, 'matrix must include Warp row');
    assert.match(matrix, /Warp row refreshed.*2026-04-25/i, 'matrix must record 2026-04-25 Warp refresh');
    assert.match(legacySpec, /website-v2\/docs\/compare\/vs-warp\.mdx/, 'legacy spec must point to docs route');
  });

  it('records the ADE/Oz boundary decision', () => {
    assert.match(spec, /DEC-WARP-COMPARE-ADE-OZ-BOUNDARY-001/, 'spec must record ADE/Oz boundary decision');
  });
});
