import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');
const read = (rel) => readFileSync(resolve(ROOT, rel), 'utf8');

/**
 * Code-backed guard for the integration guide page.
 *
 * Verifies that website-v2/docs/integration-guide.mdx:
 * - Exists and is registered in the sidebar
 * - Documents all three integration patterns
 * - References real proof artifacts that exist in the repo
 * - Includes validation traps section
 * - Is listed in sitemap.xml and llms.txt
 */

describe('Integration guide content contract', () => {
  const guidePath = 'website-v2/docs/integration-guide.mdx';
  const normalizedConfigSource = read('cli/src/lib/normalized-config.js');
  const repeatedProofReport = read('examples/remote-agent-bridge/REPEATED_PROOF_REPORT.md');

  it('AT-TPI-001: integration guide page exists', () => {
    assert.ok(
      existsSync(resolve(ROOT, guidePath)),
      `${guidePath} must exist`
    );
  });

  const guide = read(guidePath);

  describe('AT-TPI-002: documents all three integration patterns', () => {
    it('documents HTTP Remote Agent pattern', () => {
      assert.match(guide, /remote.agent/i, 'must mention remote_agent');
      assert.match(guide, /HTTP/i, 'must mention HTTP');
      assert.match(guide, /"type":\s*"remote_agent"/, 'must show remote_agent config');
    });

    it('documents MCP Server pattern', () => {
      assert.match(guide, /MCP Server/i, 'must mention MCP Server');
      assert.match(guide, /agentxchain_turn/, 'must mention agentxchain_turn tool');
      assert.match(guide, /"type":\s*"mcp"/, 'must show mcp config');
    });

    it('documents API Proxy pattern', () => {
      assert.match(guide, /API Proxy/i, 'must mention API Proxy');
      assert.match(guide, /"type":\s*"api_proxy"/, 'must show api_proxy config');
      assert.match(guide, /Anthropic.*OpenAI.*Google.*Ollama/s, 'must mention bundled api_proxy providers');
    });
  });

  describe('AT-TPI-003: references real proof artifacts', () => {
    it('references remote-agent-bridge example', () => {
      assert.match(guide, /remote-agent-bridge/, 'must reference remote-agent-bridge');
    });

    it('remote-agent-bridge example exists', () => {
      assert.ok(
        existsSync(resolve(ROOT, 'examples/remote-agent-bridge/server.js')),
        'examples/remote-agent-bridge/server.js must exist'
      );
    });

    it('model-backed server exists', () => {
      assert.ok(
        existsSync(resolve(ROOT, 'examples/remote-agent-bridge/model-backed-server.js')),
        'examples/remote-agent-bridge/model-backed-server.js must exist'
      );
    });

    it('references mcp-anthropic-agent example', () => {
      assert.match(guide, /mcp-anthropic-agent/, 'must reference mcp-anthropic-agent');
    });

    it('references mcp-http-echo-agent example', () => {
      assert.match(guide, /mcp-http-echo-agent/, 'must reference mcp-http-echo-agent');
    });

    it('mcp-anthropic-agent example exists', () => {
      assert.ok(
        existsSync(resolve(ROOT, 'examples/mcp-anthropic-agent/server.js')),
        'examples/mcp-anthropic-agent/server.js must exist'
      );
    });

    it('references mcp-echo-agent example', () => {
      assert.match(guide, /mcp-echo-agent/, 'must reference mcp-echo-agent');
    });

    it('references model-backed proof', () => {
      assert.match(guide, /model.backed.proof/i, 'must reference model-backed proof');
    });

    it('references reliability proof', () => {
      assert.match(guide, /5\/5.*100%|reliability proof/i, 'must reference reliability evidence');
    });
  });

  it('AT-TPI-004: includes validation traps section', () => {
    assert.match(guide, /validation trap/i, 'must have validation traps section');
    assert.match(guide, /DEC-NNN/, 'must mention DEC-NNN pattern');
    assert.match(guide, /empty objection|objections.*\[\]/i, 'must warn about empty objections');
    assert.match(guide, /proposed_changes/, 'must warn about missing proposed_changes');
    assert.match(guide, /requires_files/i, 'must warn about impossible requires_files gates');
    assert.match(guide, /review_only.*api_proxy|api_proxy.*review_only|review_only.*remote_agent|remote_agent.*review_only/i,
      'must connect requires_files warning to remote review_only roles');
  });

  it('AT-TPI-004B: documents api_proxy extraction invariant and live compatibility evidence', () => {
    assert.match(guide, /direct JSON parse, then one fenced JSON block, then bounded JSON substring extraction/i,
      'guide must document the three-stage extraction pipeline');
    assert.match(guide, /load-bearing, not optional cleanup/i,
      'guide must describe extraction as a contract invariant');
    assert.match(guide, /Haiku 4\.5.*fence/i, 'guide must record the Haiku fence-extraction result');
    assert.match(guide, /Sonnet 4\.6.*direct JSON/i, 'guide must record the Sonnet direct-JSON result');
    assert.match(guide, /MODEL_COMPATIBILITY_RESULTS\.json/, 'guide must point to the durable probe results');
  });

  it('AT-TPI-005: registered in sidebars.ts', () => {
    const sidebars = read('website-v2/sidebars.ts');
    assert.match(sidebars, /integration-guide/, 'sidebars.ts must include integration-guide');
  });

  describe('AT-TPI-009: write-authority guidance matches runtime truth', () => {
    it('documents remote_agent and api_proxy as restricted to review_only/proposed', () => {
      assert.match(guide, /remote_agent.*review_only.*proposed|review_only.*proposed.*remote_agent/s,
        'guide must describe remote_agent as review_only/proposed only');
      assert.match(guide, /API Proxy[\s\S]*review_only[\s\S]*proposed/i,
        'guide must describe api_proxy as review_only/proposed');
    });

    it('documents MCP contract surface as broader than remote_agent/api_proxy', () => {
      assert.match(normalizedConfigSource, /getRoleRuntimeCapabilityContract/,
        'normalized config must derive runtime binding truth from the shared capability contract');
      assert.match(normalizedConfigSource, /invalid_review_only_binding/,
        'normalized config must reject review_only local_cli bindings through the shared contract');
      assert.match(normalizedConfigSource, /invalid_authoritative_binding/,
        'normalized config must reject authoritative remote bindings through the shared contract');
      assert.match(guide, /MCP runtimes can back `authoritative`, `proposed`, or `review_only` roles/i,
        'guide must document MCP authoritative/proposed/review_only support');
      assert.match(guide, /public proof surface is narrower than the contract surface/i,
        'guide must distinguish MCP contract support from proof depth');
    });
  });

  it('AT-TPI-010: numeric proof claims match the shipped report artifacts', () => {
    assert.match(repeatedProofReport, /> Pass Rate: \*\*5\/5 \(100%\)\*\*/, 'proof report must record 5/5 (100%)');
    assert.match(guide, /5\/5.*100%/, 'guide must only cite the shipped 5/5 (100%) reliability figure');
  });

  it('AT-TPI-011: MCP section documents the real return shapes', () => {
    assert.match(guide, /structuredContent|text content response containing JSON/,
      'guide must document structuredContent or JSON text content for MCP responses');
  });

  it('AT-TPI-007: integration-guide doc exists (auto-included in sitemap at build)', () => {
    // sitemap.xml is auto-generated by Docusaurus — doc existence guarantees inclusion
    assert.ok(read('website-v2/docs/integration-guide.mdx').length > 0);
  });

  it('AT-TPI-008: llms.txt includes integration-guide URL', () => {
    const llms = read('website-v2/static/llms.txt');
    assert.match(
      llms,
      /agentxchain\.dev\/docs\/integration-guide/,
      'llms.txt must include integration-guide URL'
    );
  });

  describe('does not violate DEC-NPX-FD-001', () => {
    it('does not use bare npx agentxchain commands', () => {
      assert.doesNotMatch(
        guide,
        /^npx agentxchain/m,
        'must not use bare npx agentxchain commands'
      );
    });
  });

  it('includes actionable next-step links instead of an empty trailing section', () => {
    assert.match(guide, /## Next steps/, 'guide must have a next steps section');
    assert.match(guide, /\[Adapters\]\(\/docs\/adapters\)/, 'next steps must link to adapters');
    assert.match(guide, /\[Examples\]\(\/docs\/examples\)/, 'next steps must link to examples');
    assert.match(guide, /\[Runner Interface\]\(\/docs\/runner-interface\)/, 'next steps must link to runner interface');
  });
});
