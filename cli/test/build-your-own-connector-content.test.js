import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { loadNormalizedConfig } from '../src/lib/normalized-config.js';

const WEBSITE_ROOT = resolve(import.meta.dirname, '..', '..', 'website-v2');
const DOCS_DIR = join(WEBSITE_ROOT, 'docs');
const STATIC_DIR = join(WEBSITE_ROOT, 'static');
const SIDEBAR_PATH = join(WEBSITE_ROOT, 'sidebars.ts');
const TUTORIAL_PATH = join(DOCS_DIR, 'build-your-own-connector.mdx');

function readFile(filePath) {
  return readFileSync(filePath, 'utf8');
}

function extractStep3Config(content) {
  const step3 = content.split('## Step 3: Configure AgentXchain')[1]?.split('## Step 4: Run a governed turn')[0] || '';
  const match = step3.match(/```json[^\n]*\n([\s\S]*?)```/);
  assert.ok(match, 'Step 3 must contain a JSON config block');
  return JSON.parse(match[1]);
}

describe('Build Your Own Connector tutorial', () => {
  // AT-BYOC-001: Tutorial page exists
  it('AT-BYOC-001: tutorial page exists', () => {
    assert.ok(existsSync(TUTORIAL_PATH), 'build-your-own-connector.mdx must exist');
  });

  describe('contract documentation', () => {
    const content = readFile(TUTORIAL_PATH);

    // AT-BYOC-002: Request envelope contract
    it('AT-BYOC-002: documents the request envelope contract', () => {
      assert.ok(content.includes('run_id'), 'must document run_id');
      assert.ok(content.includes('turn_id'), 'must document turn_id');
      assert.ok(content.includes('role'), 'must document role');
      assert.ok(content.includes('phase'), 'must document phase');
      assert.ok(content.includes('prompt'), 'must document prompt');
      assert.ok(content.includes('context'), 'must document context');
      assert.ok(content.includes('Request envelope') || content.includes('request envelope'), 'must have request envelope section');
    });

    // AT-BYOC-003: Response contract
    it('AT-BYOC-003: documents the response contract', () => {
      assert.ok(content.includes('schema_version'), 'must document schema_version');
      assert.ok(content.includes('status'), 'must document status');
      assert.ok(content.includes('decisions'), 'must document decisions');
      assert.ok(content.includes('objections'), 'must document objections');
      assert.ok(content.includes('verification'), 'must document verification');
      assert.ok(content.includes('proposed_changes'), 'must document proposed_changes');
      assert.ok(content.includes('Response contract') || content.includes('response contract'), 'must have response contract section');
    });

    // AT-BYOC-004: Runnable server code
    it('AT-BYOC-004: includes runnable server code', () => {
      assert.ok(content.includes('createServer'), 'must include Node.js server code');
      assert.ok(content.includes('server.js'), 'must reference server.js');
      assert.ok(content.includes('server.listen') || content.includes('.listen('), 'must include server listen');
    });

    // AT-BYOC-005: agentxchain.json configuration
    it('AT-BYOC-005: includes agentxchain.json configuration', () => {
      assert.ok(content.includes('agentxchain.json'), 'must reference agentxchain.json');
      assert.ok(content.includes('"remote_agent"'), 'must show remote_agent type');
      assert.ok(content.includes('"url"'), 'must show url config');
      assert.ok(content.includes('"runtimes"'), 'must show runtimes config');
      assert.ok(content.includes('"schema_version": 4'), 'must show schema_version 4 for a valid governed config');
      assert.ok(content.includes('"project"'), 'must show the required project object');
    });

    // AT-BYOC-006: Validation traps
    it('AT-BYOC-006: includes validation traps with at least 3 traps', () => {
      const trapMatches = content.match(/### Trap \d/g) || [];
      assert.ok(trapMatches.length >= 3, `must have at least 3 validation traps, found ${trapMatches.length}`);
      assert.ok(content.includes('decision ID') || content.includes('DEC-'), 'must mention decision ID format');
      assert.ok(content.includes('objection') || content.includes('challenge requirement'), 'must mention objection requirement');
      assert.ok(content.includes('proposed_changes'), 'must mention proposed_changes requirement');
    });

    // AT-BYOC-008: References the remote-agent-bridge example
    it('AT-BYOC-008: references the remote-agent-bridge example', () => {
      assert.ok(content.includes('remote-agent-bridge'), 'must reference remote-agent-bridge example');
    });

    // AT-BYOC-009: Decision IDs in runnable code use DEC-NNN format
    it('AT-BYOC-009: runnable code examples use DEC-NNN format', () => {
      // Extract DEC- references from the runnable server code (between "Step 2" and "Validation traps")
      const runnableSection = content.split('## Validation traps')[0] || '';
      const decMatches = runnableSection.match(/"DEC-[^"]+"/g) || [];
      for (const match of decMatches) {
        assert.ok(/^"DEC-\d{3}"$/.test(match), `Decision ID ${match} in runnable code must use DEC-NNN numeric format`);
      }
      assert.ok(decMatches.length > 0, 'must have at least one DEC-NNN example in runnable code');
    });

    // AT-BYOC-010: No bare npx agentxchain commands
    it('AT-BYOC-010: no bare npx agentxchain commands (DEC-NPX-FD-001)', () => {
      const bareNpxPattern = /^npx agentxchain /m;
      assert.ok(!bareNpxPattern.test(content), 'must not contain bare npx agentxchain commands');
    });
  });

  it('AT-BYOC-011: embedded config example validates through the real v4 loader', () => {
    const content = readFile(TUTORIAL_PATH);
    const rawConfig = extractStep3Config(content);
    const result = loadNormalizedConfig(rawConfig, process.cwd());
    assert.equal(result.ok, true, `config example must validate, got errors: ${(result.errors || []).join('; ')}`);
    assert.equal(result.version, 4, 'config example must be a v4 governed config');
  });

  it('AT-BYOC-012: includes a governed bootstrap path before config editing', () => {
    const content = readFile(TUTORIAL_PATH);
    assert.ok(
      content.includes('agentxchain init --governed --dir . -y'),
      'tutorial must include an explicit governed bootstrap path'
    );
  });

  // AT-BYOC-007: Sidebar registration
  it('AT-BYOC-007: registered in sidebar under Integration', () => {
    const sidebar = readFile(SIDEBAR_PATH);
    assert.ok(sidebar.includes("'build-your-own-connector'"), 'must be in sidebar');
    // Must be in the Integration category (after adapters)
    const integrationIdx = sidebar.indexOf("label: 'Integration'");
    const connectorIdx = sidebar.indexOf("'build-your-own-connector'");
    assert.ok(integrationIdx < connectorIdx, 'must be inside Integration category');
  });

  it('sitemap.xml includes the page', () => {
    const sitemap = readFile(join(STATIC_DIR, 'sitemap.xml'));
    assert.ok(sitemap.includes('build-your-own-connector'), 'sitemap must include the page');
  });

  it('llms.txt includes the page', () => {
    const llms = readFile(join(STATIC_DIR, 'llms.txt'));
    assert.ok(llms.includes('build-your-own-connector'), 'llms.txt must include the page');
  });

  it('remote-agent-bridge example exists on disk', () => {
    const bridgePath = resolve(import.meta.dirname, '..', '..', 'examples', 'remote-agent-bridge');
    assert.ok(existsSync(bridgePath), 'examples/remote-agent-bridge must exist');
    assert.ok(existsSync(join(bridgePath, 'server.js')), 'examples/remote-agent-bridge/server.js must exist');
  });
});
