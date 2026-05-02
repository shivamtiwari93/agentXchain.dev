import { strict as assert } from 'node:assert';
import { describe, it } from 'vitest';
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
// Extended surfaces: comparison pages, launch page, marketing drafts, VS Code extension
const EXTENDED_NO_BARE_NPX_SURFACES = [
  'website-v2/src/pages/launch.mdx',
  'website-v2/docs/compare/vs-metagpt.mdx',
  'website-v2/docs/compare/vs-openhands.mdx',
  'website-v2/docs/compare/vs-openai-agents-sdk.mdx',
  'website-v2/docs/compare/vs-codegen.mdx',
  'website-v2/docs/compare/vs-autogen.mdx',
  'website-v2/docs/compare/vs-langgraph.mdx',
  'website-v2/docs/compare/vs-warp.mdx',
  'website-v2/docs/compare/vs-devin.mdx',
  'website-v2/docs/compare/vs-crewai.mdx',
  '.planning/MARKETING/TWITTER_THREAD.md',
  '.planning/MARKETING/REDDIT_POSTS.md',
  '.planning/MARKETING/HN_SUBMISSION.md',
  '.planning/SHOW_HN_DRAFT.md',
];
const INSTALL_REQUIRED_MULTI_COMMAND_SURFACES = [
  'website-v2/docs/compare/vs-metagpt.mdx',
  'website-v2/docs/compare/vs-openhands.mdx',
  'website-v2/docs/compare/vs-openai-agents-sdk.mdx',
  'website-v2/docs/compare/vs-codegen.mdx',
  'website-v2/docs/compare/vs-autogen.mdx',
  'website-v2/docs/compare/vs-langgraph.mdx',
  'website-v2/docs/compare/vs-warp.mdx',
  'website-v2/docs/compare/vs-devin.mdx',
  'website-v2/docs/compare/vs-crewai.mdx',
  '.planning/SHOW_HN_DRAFT.md',
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

describe('extended no-bare-npx surfaces', () => {
  it('AT-NPX-FD-005: comparison, launch, and marketing surfaces do not use bare npx demo', () => {
    for (const rel of EXTENDED_NO_BARE_NPX_SURFACES) {
      assert.doesNotMatch(read(rel), /`npx agentxchain demo`/, `${rel} must not advertise bare npx demo shorthand`);
      assert.doesNotMatch(read(rel), /^npx agentxchain demo$/m, `${rel} must not have bare npx demo in code blocks`);
    }
  });

  it('AT-NPX-FD-006: comparison, launch, and marketing surfaces do not use bare npx init', () => {
    for (const rel of EXTENDED_NO_BARE_NPX_SURFACES) {
      assert.doesNotMatch(read(rel), /`npx agentxchain init/, `${rel} must not advertise bare npx init shorthand`);
      assert.doesNotMatch(read(rel), /^npx agentxchain init/m, `${rel} must not have bare npx init in code blocks`);
    }
  });

  it('AT-NPX-FD-007: multi-command public shell examples install before repeated bare commands', () => {
    for (const rel of INSTALL_REQUIRED_MULTI_COMMAND_SURFACES) {
      const content = read(rel);
      assert.match(content, /npm install -g agentxchain/, `${rel} must install the CLI before repeated bare commands`);
      assert.doesNotMatch(
        content,
        /npx --yes -p agentxchain@latest -c "agentxchain init --governed"[\s\S]*\nagentxchain /,
        `${rel} must not mix package-bound init with later bare commands in the same example`,
      );
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
    assert.match(SPEC, /AT-NPX-FD-007/);
  });
});
