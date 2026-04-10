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

const SPEC = read('.planning/NPX_FRONTDOOR_COMMAND_SPEC.md');
const DEMO_CMD = 'npx --yes -p agentxchain@latest -c "agentxchain demo"';
const FRONTDOOR_SURFACES = [
  'README.md',
  'cli/README.md',
  'website-v2/src/pages/index.tsx',
  'website-v2/docs/quickstart.mdx',
  'website-v2/docs/getting-started.mdx',
  'website-v2/docs/tutorial.mdx',
  'website-v2/docs/first-turn.mdx',
];
const INSTALL_SURFACES = [
  'README.md',
  'cli/README.md',
  'website-v2/src/pages/index.tsx',
  'website-v2/docs/quickstart.mdx',
  'website-v2/docs/getting-started.mdx',
  'website-v2/docs/tutorial.mdx',
  'website-v2/docs/first-turn.mdx',
];
const INIT_SURFACES = [
  'README.md',
  'cli/README.md',
  'website-v2/src/pages/index.tsx',
  'website-v2/docs/quickstart.mdx',
  'website-v2/docs/getting-started.mdx',
  'website-v2/docs/tutorial.mdx',
  'website-v2/docs/first-turn.mdx',
  'website-v2/docs/templates.mdx',
];

describe('front-door install surface', () => {
  it('AT-NPX-FD-001: front-door surfaces use the package-bound demo command', () => {
    for (const rel of FRONTDOOR_SURFACES) {
      assert.match(read(rel), new RegExp(DEMO_CMD.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${rel} must use the package-bound demo command`);
    }
  });

  it('AT-NPX-FD-002: repeated walkthrough surfaces install the CLI before bare commands', () => {
    for (const rel of INSTALL_SURFACES) {
      assert.match(read(rel), /npm install -g agentxchain/, `${rel} must show install-once guidance`);
    }
  });

  it('AT-NPX-FD-003: front-door surfaces do not advertise bare npx demo shorthand', () => {
    for (const rel of FRONTDOOR_SURFACES) {
      assert.doesNotMatch(read(rel), /npx agentxchain demo/, `${rel} must not advertise bare npx demo shorthand`);
    }
  });

  it('AT-NPX-FD-004: front-door surfaces do not advertise bare npx init shorthand', () => {
    for (const rel of INIT_SURFACES) {
      assert.doesNotMatch(read(rel), /npx agentxchain init/, `${rel} must not advertise bare npx init shorthand`);
    }
  });
});

describe('front-door install spec', () => {
  it('records the boundary and acceptance tests', () => {
    assert.match(SPEC, /## Purpose/);
    assert.match(SPEC, /## Interface/);
    assert.match(SPEC, /## Behavior/);
    assert.match(SPEC, /## Acceptance Tests/);
    assert.match(SPEC, /AT-NPX-FD-001/);
    assert.match(SPEC, /AT-NPX-FD-004/);
  });
});
