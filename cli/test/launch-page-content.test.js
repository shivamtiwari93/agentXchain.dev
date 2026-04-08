import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

function read(relativePath) {
  return readFileSync(join(REPO_ROOT, relativePath), 'utf8');
}

const LAUNCH_PAGE = read('website-v2/src/pages/launch.mdx');
const DOCUSAURUS_CONFIG = read('website-v2/docusaurus.config.ts');
const HN_SUBMISSION = read('.planning/MARKETING/HN_SUBMISSION.md');
const REDDIT_POSTS = read('.planning/MARKETING/REDDIT_POSTS.md');
const TWITTER_THREAD = read('.planning/MARKETING/TWITTER_THREAD.md');
const SPEC = read('.planning/LAUNCH_PAGE_SPEC.md');

describe('launch page public contract', () => {
  it('keeps /launch as a first-class public route', () => {
    assert.match(DOCUSAURUS_CONFIG, /to: '\/launch'/);
    assert.match(LAUNCH_PAGE, /^# AgentXchain v2\.24/m);
  });

  it('documents the package-bound npx fallback for stale global installs', () => {
    assert.match(LAUNCH_PAGE, /npx -p agentxchain@2\.24\.1 -c 'agentxchain demo'/);
    assert.match(LAUNCH_PAGE, /unknown command 'demo'/);
  });

  it('keeps the adapter proof boundary honest', () => {
    assert.match(LAUNCH_PAGE, /All 4 adapters proven live/);
    assert.match(LAUNCH_PAGE, /three non-manual adapters/);
    assert.match(LAUNCH_PAGE, /human-in-the-loop control path/);
    assert.doesNotMatch(LAUNCH_PAGE, /manual, local CLI, API proxy, and MCP — is proven live with real AI models/i);
    assert.doesNotMatch(LAUNCH_PAGE, /All 4 adapter types proven live with real AI models/i);
    assert.doesNotMatch(LAUNCH_PAGE, /all four runtime adapters proven live with real AI models/i);
  });
});

describe('launch-linked marketing drafts', () => {
  it('use the launch page as the Hacker News destination', () => {
    assert.match(HN_SUBMISSION, /\*\*URL:\*\* https:\/\/agentxchain\.dev\/launch/);
    assert.doesNotMatch(HN_SUBMISSION, /\*\*URL:\*\* https:\/\/agentxchain\.dev\s*$/m);
  });

  it('do not falsely describe the manual adapter as real-model proof', () => {
    for (const [label, content] of [
      ['HN submission', HN_SUBMISSION],
      ['Reddit posts', REDDIT_POSTS],
      ['Twitter thread', TWITTER_THREAD],
    ]) {
      assert.doesNotMatch(
        content,
        /manual[^\n]*real AI model|all 4 (runtime )?adapters[^\n]*real AI models/i,
        `${label} collapses live-adapter proof into false manual real-model proof`,
      );
    }
  });
});

describe('launch page spec', () => {
  it('records the launch-page contract and acceptance tests', () => {
    assert.match(SPEC, /# Launch Page Spec/);
    assert.match(SPEC, /AT-LAUNCH-PAGE-001/);
    assert.match(SPEC, /AT-LAUNCH-PAGE-004/);
  });
});
