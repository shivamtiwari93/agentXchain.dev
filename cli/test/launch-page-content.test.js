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
const FRONTDOOR_SPEC = read('.planning/COMPARISON_LAUNCH_FRONTDOOR_SPEC.md');

describe('launch page public contract', () => {
  it('keeps /launch as a first-class public route', () => {
    assert.match(DOCUSAURUS_CONFIG, /to: '\/launch'/);
    assert.match(LAUNCH_PAGE, /^# AgentXchain v2\.24 Launch Snapshot/m);
    assert.match(LAUNCH_PAGE, /<title>AgentXchain v2\.24 Launch Snapshot — Governed Multi-Agent Software Delivery<\/title>/);
    assert.match(LAUNCH_PAGE, /Historical launch snapshot for AgentXchain v2\.24\.1/i);
  });

  it('uses the package-bound demo command per DEC-NPX-FD-001', () => {
    assert.match(LAUNCH_PAGE, /npx --yes -p agentxchain@latest -c "agentxchain demo"/);
    assert.doesNotMatch(LAUNCH_PAGE, /^npx agentxchain demo$/m, 'must not use bare npx demo');
  });

  it('keeps the governed-ready bootstrap path aligned with front-door docs', () => {
    assert.match(LAUNCH_PAGE, /agentxchain init --governed .*--goal "/);
    assert.match(LAUNCH_PAGE, /agentxchain doctor/);
    assert.doesNotMatch(LAUNCH_PAGE, /(^|\n)agentxchain init --governed\s*$/m, 'launch page must not retain bare governed init');
  });

  it('keeps the adapter proof boundary honest', () => {
    assert.match(LAUNCH_PAGE, /Four adapters were proven live at launch/);
    assert.match(LAUNCH_PAGE, /three non-manual adapters/);
    assert.match(LAUNCH_PAGE, /\*\*Historical launch snapshot from April 2026\*\* — At v2\.24\.1, AgentXchain first proved four runtime adapters live/);
    assert.match(LAUNCH_PAGE, /The precise launch-time claim matters:/);
    assert.match(LAUNCH_PAGE, /human-in-the-loop control path/);
    assert.doesNotMatch(LAUNCH_PAGE, /manual, local CLI, API proxy, and MCP — is proven live with real AI models/i);
    assert.doesNotMatch(LAUNCH_PAGE, /All 4 adapter types proven live with real AI models/i);
    assert.doesNotMatch(LAUNCH_PAGE, /all four runtime adapters proven live with real AI models/i);
  });
});

describe('launch-linked marketing drafts', () => {
  it('use the current homepage as the Hacker News destination instead of the historical launch snapshot', () => {
    assert.match(HN_SUBMISSION, /\*\*URL:\*\* https:\/\/agentxchain\.dev\s*$/m);
    assert.doesNotMatch(HN_SUBMISSION, /\*\*URL:\*\* https:\/\/agentxchain\.dev\/launch/);
  });

  it('do not present the historical launch page as the primary CTA in reusable current-truth drafts', () => {
    assert.doesNotMatch(HN_SUBMISSION, /^1\. Submit as "Show HN" with `https:\/\/agentxchain\.dev\/launch`$/m);
    assert.doesNotMatch(REDDIT_POSTS, /- Launch page: https:\/\/agentxchain\.dev\/launch/);
    assert.doesNotMatch(REDDIT_POSTS, /^https:\/\/agentxchain\.dev\/launch \|/m);
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

describe('launch page evidence is labeled as historical snapshot', () => {
  it('keeps the opening and architecture copy explicitly historical', () => {
    assert.match(LAUNCH_PAGE, /\*\*Historical launch snapshot from April 2026\*\*/);
    assert.match(LAUNCH_PAGE, /## What was proven at the v2\.24\.1 launch/);
    assert.match(
      LAUNCH_PAGE,
      /At the v2\.24\.1 launch, this included manual, local CLI, API proxy, and MCP\. Current releases have expanded beyond this launch snapshot\./,
    );
  });

  it('labels the evidence block as v2.24.1 launch-time snapshot', () => {
    assert.match(LAUNCH_PAGE, /Evidence \(v2\.24\.1 launch-time snapshot\)/);
  });

  it('includes a disclaimer that counts are historical', () => {
    assert.match(LAUNCH_PAGE, /state of the codebase at the time v2\.24\.1 shipped/);
    assert.match(LAUNCH_PAGE, /test surface has grown significantly since launch/);
  });

  it('does not present stale counts as if they are current truth', () => {
    // The evidence section should not say "X tests" without the historical label above it
    const evidenceSection = LAUNCH_PAGE.split('## Evidence')[1];
    assert.ok(evidenceSection, 'evidence section must exist');
    assert.match(evidenceSection, /launch-time snapshot/);
  });
});

describe('launch page spec', () => {
  it('records the launch-page contract and acceptance tests', () => {
    assert.match(SPEC, /# Launch Page Spec/);
    assert.match(SPEC, /AT-LAUNCH-PAGE-001/);
    assert.match(SPEC, /AT-LAUNCH-PAGE-004/);
    assert.match(SPEC, /historical `\/launch` snapshot/i);
    assert.match(SPEC, /https:\/\/agentxchain\.dev` as the submission URL/);
  });

  it('records the front-door launch contract in a standalone spec', () => {
    assert.match(FRONTDOOR_SPEC, /# Comparison And Launch Front-Door Spec/);
    assert.match(FRONTDOOR_SPEC, /AT-CLFD-003/);
    assert.match(FRONTDOOR_SPEC, /AT-CLFD-004/);
  });
});
