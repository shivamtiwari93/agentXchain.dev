import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');
const read = (rel) => readFileSync(resolve(ROOT, rel), 'utf8');

function countFixtures(dir) {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      total += countFixtures(fullPath);
    } else if (entry.isFile() && entry.name.endsWith('.json')) {
      total += 1;
    }
  }
  return total;
}

describe('Launch evidence report', () => {
  const report = read('.planning/LAUNCH_EVIDENCE_REPORT.md');

  it('exists and contains all four required sections', () => {
    assert.match(report, /## 1\. Evidence Inventory/);
    assert.match(report, /## 2\. Allowed Claims/);
    assert.match(report, /## 3\. Disallowed Claims/);
    assert.match(report, /## 4\. Evidence Gaps/);
  });

  it('every allowed claim row cites an evidence source (E1-E5) or a direct file reference', () => {
    const allowedSection = report.split('## 2. Allowed Claims')[1].split('## 3. Disallowed Claims')[0];
    const rows = allowedSection.split('\n').filter(l => l.startsWith('|') && !l.includes('---') && !l.includes('Claim'));
    assert.ok(rows.length > 0, 'should have allowed claim rows');
    for (const row of rows) {
      assert.match(row, /E[1-5]|`[A-Z]/,
        `Allowed claim row must cite evidence or a file: ${row.slice(0, 80)}`);
    }
  });

  it('references the current test count floor', () => {
    assert.match(report, /1000\+.*launch-copy floor/i,
      'report should state the current launch-copy floor explicitly');
    assert.match(report, /1033 tests\s*[,\/]\s*0 failures/i,
      'report should record the current exact suite count verified on 2026-04-03');
    assert.doesNotMatch(report, /900\+.*launch-copy floor/i,
      'report should not retain the stale 900+ floor after crossing 1000+');
  });

  it('removes stale prerelease references to old publish-gating placeholders', () => {
    assert.doesNotMatch(report, /v1\.0\.0 published to npm/i);
    assert.match(report, /post-release `npx agentxchain` installation verification.*CLOSED/i);
    assert.match(report, /2\.24\.1/i);
  });

  it('records full live governed completion for the three-adapter path', () => {
    assert.match(report, /final-phase QA review, governed completion signaling, and `approve-completion` are now proven live/i);
    assert.match(report, /turn_8fa2ffe2abc2f3b0/);
    assert.match(report, /turn_9710c088069f0ff2/);
    assert.match(report, /approve-completion` completed the run at `2026-04-07T11:14:16\.734Z`/i);
    assert.match(report, /A full governed run is proven live for the `manual` \+ `local_cli` \+ `api_proxy` path/i);
    assert.doesNotMatch(report, /full completion still partial/i);
    assert.doesNotMatch(report, /used `status: "needs_human"` instead of `run_completion_request: true`/i);
  });

  it('records api_proxy proposed-authority proof as an allowed claim', () => {
    assert.match(report, /proposed-authority turns are proven through full governed lifecycle/i);
    assert.match(report, /e2e-api-proxy-proposed-lifecycle/);
    assert.match(report, /e2e-proposal-aware-gates/);
    assert.match(report, /proposal materialization.*gate rejection/i);
  });

  it('records live proposed-authority full lifecycle as proven including run completion', () => {
    // E2c allowed claim: core lifecycle proven live
    assert.match(report, /proposed-authority lifecycle.*proven live against real Anthropic/i);
    assert.match(report, /E2c/);
    // Full completion proof: run_7b067f892916b799 passed all criteria
    assert.match(report, /run_7b067f892916b799/);
    assert.match(report, /Full.*proposed-authority run completion is proven live/i);
    assert.match(report, /pending_run_completion/);
    assert.match(report, /approve-completion/);
    // Disallowed claim is now closed
    assert.match(report, /CLOSED 2026-04-08/);
    assert.match(report, /DEC-PROP-COMPLETION-CONTRACT-001/);
  });

  it('records live MCP dogfood proof for both transports', () => {
    assert.match(report, /E2b — Live MCP Adapter Dogfood/);
    assert.match(report, /turn_e41e35ba8eea9768/);
    assert.match(report, /turn_5292f4de9e01ea71/);
    assert.match(report, /MCP stdio transport.*governed dev turn/i);
    assert.match(report, /MCP streamable_http transport.*governed dev turn/i);
    assert.match(report, /All five adapter types.*CLI execution evidence/i);
  });

  it('records live MCP real-model proof', () => {
    assert.match(report, /E2b\+ — Live MCP Real-Model Proof/);
    assert.match(report, /run_83a64c7bb6925711/);
    assert.match(report, /turn_c8703d87f325e108/);
    assert.match(report, /claude-haiku-4-5-20251001/);
    assert.match(report, /real Anthropic model/i);
  });

  it('records remote agent bridge proof', () => {
    assert.match(report, /E2e — Remote Agent Bridge Proof/);
    assert.match(report, /remote_agent.*adapter.*dispatches.*governed turn envelopes over HTTP/i);
    assert.match(report, /proposed_changes/);
    assert.match(report, /proposal apply/);
    assert.match(report, /review-only.*QA.*derive audit artifacts/i);
    assert.match(report, /run-proof\.mjs/);
    assert.match(report, /e2e-remote-agent-proposed-authoring/);
    assert.match(report, /connector replaceability/i);
  });

  it('records model-backed remote agent proof (E2e+)', () => {
    assert.match(report, /E2e\+.*Remote Agent Model-Backed Proof/);
    assert.match(report, /claude-haiku-4-5/);
    assert.match(report, /model-backed-server\.js/);
    assert.match(report, /run-model-proof\.mjs/);
    assert.match(report, /no field-level repair/i);
    assert.match(report, /markdown fences/i);
    assert.match(report, /full 5-stage acceptance pipeline/i);
  });

  it('records repeated model-backed remote agent proof (E2e++)', () => {
    assert.match(report, /E2e\+\+.*Remote Agent Repeated Model-Backed Proof/);
    assert.match(report, /run-repeated-proof\.mjs/);
    assert.match(report, /REPEATED_PROOF_REPORT\.md/);
    assert.match(report, /5\/5 PASS/);
    assert.match(report, /100%/);
    assert.match(report, /No retries/i);
    assert.match(report, /REPEATABLE_MODEL_PROOF_SPEC\.md/);
  });
});

describe('Launch surfaces do not contain disallowed claims', () => {
  const surfaces = [
    '.planning/SHOW_HN_DRAFT.md',
    '.planning/LAUNCH_BRIEF.md',
    'README.md',
    'website-v2/src/pages/index.tsx',
    'website-v2/src/pages/why.mdx',
  ];

  // Surfaces that contain user-facing copy (not internal constraint docs)
  const copyOnlySurfaces = surfaces.filter(s => !s.includes('LAUNCH_BRIEF'));

  for (const rel of copyOnlySurfaces) {
    describe(rel, () => {
      const content = read(rel);

      it('does not claim "full live end-to-end proof"', () => {
        assert.doesNotMatch(content, /full live (end.to.end|e2e) proof/i);
        assert.doesNotMatch(content, /all adapters proven live/i);
      });

      it('does not claim live proposed-authority run completion', () => {
        if (/proposed-authority|proposal apply|api_proxy/i.test(content)) {
          assert.doesNotMatch(content, /proposed-authority run completion.*proven live/i);
          assert.doesNotMatch(content, /full proposed-authority.*proven live/i);
        }
      });

      it('frames human gate claims as protocol rules, not as implied live proof', () => {
        if (/phase transitions and final completion/i.test(content)) {
          assert.match(content, /protocol requires human approval/i,
            `${rel} should frame completion gating as a protocol rule`);
        }
      });

      it('does not claim "production-proven" or "battle-tested"', () => {
        assert.doesNotMatch(content, /production.proven/i);
        assert.doesNotMatch(content, /battle.tested/i);
      });

      it('does not reference OpenAI Swarm as a current competitor', () => {
        const lines = content.split('\n');
        for (const line of lines) {
          if (/openai swarm/i.test(line) && !/deprecat/i.test(line) && !/replaced/i.test(line)) {
            assert.fail(`${rel} references OpenAI Swarm as current: ${line.trim().slice(0, 100)}`);
          }
        }
      });
    });
  }

  // LAUNCH_BRIEF is an internal doc with "do not claim X" constraint language.
  // We verify it references the evidence report but don't pattern-match its constraint warnings.
  describe('.planning/LAUNCH_BRIEF.md (internal)', () => {
    const content = read('.planning/LAUNCH_BRIEF.md');

    it('does not make positive claims of full live proof in non-constraint sections', () => {
      // Strip the "Evidence-Based Claim Boundaries" section before checking
      const withoutConstraints = content.split('## Evidence-Based Claim Boundaries')[0] +
        (content.split('## Release Day Sequence')[1] || '');
      assert.doesNotMatch(withoutConstraints, /full live (end.to.end|e2e) proof/i);
      assert.doesNotMatch(withoutConstraints, /production.proven/i);
    });

    it('does not retain the stale pre-MCP-proof constraint language', () => {
      assert.doesNotMatch(content, /live MCP evidence still does not exist/i);
      assert.match(content, /All four adapter types are now proven live/i);
      assert.match(content, /only the `manual` \+ `local_cli` \+ `api_proxy` path has a full governed-run proof/i);
    });
  });
});

describe('Website badge version matches package.json', () => {
  const homepage = read('website-v2/src/pages/index.tsx');
  const pkg = JSON.parse(read('cli/package.json'));
  const expectedVersion = process.env.AGENTXCHAIN_RELEASE_TARGET_VERSION || pkg.version;

  it('hero badge shows the current package.json version', () => {
    const badgeMatch = homepage.match(/v(\d+\.\d+\.\d+)/);
    assert.ok(badgeMatch, 'hero badge should contain a version like vX.Y.Z');
    assert.equal(badgeMatch[1], expectedVersion,
      `Website badge shows v${badgeMatch[1]} but expected release surface is ${expectedVersion} — update the badge in website-v2/src/pages/index.tsx`);
  });
});

describe('Conformance count surfaces stay aligned', () => {
  const fixtureRoot = resolve(ROOT, '.agentxchain-conformance', 'fixtures');
  const totalFixtures = countFixtures(fixtureRoot);
  const homepage = read('website-v2/src/pages/index.tsx');
  const guide = read('website-v2/docs/protocol-implementor-guide.mdx');
  const redditDrafts = read('.planning/MARKETING/REDDIT_POSTS.md');
  const twitterThread = read('.planning/MARKETING/TWITTER_THREAD.md');

  it('homepage stat and architecture copy match the real fixture corpus size', () => {
    assert.equal(totalFixtures, 108, 'update this guard when the shipped corpus size changes intentionally');
    assert.match(homepage, new RegExp(`stat-number\">${totalFixtures}`));
    assert.match(homepage, /stat-label">Conformance fixtures</);
  });

  it('implementor guide tier counts match the shipped corpus', () => {
    assert.match(guide, /\| `1` \| Core constitutional behavior .* \| `77` \|/);
    assert.match(guide, /\| `2` \| Trust-hardening behavior .* \| `23` \|/);
    assert.match(guide, /\| `3` \| Multi-repo coordination .* \| `8` \|/);
  });

  it('marketing drafts use the current corpus size', () => {
    assert.match(redditDrafts, /\b108 conformance fixtures\b/);
    assert.match(twitterThread, /\b108 conformance fixtures\b/);
  });
});

describe('Gate semantics docs truth', () => {
  const guide = read('website-v2/docs/protocol-implementor-guide.mdx');

  const requiredSemantics = [
    ['PM_SIGNOFF.md', 'Approved: YES'],
    ['ship-verdict.md', 'Verdict'],
    ['SYSTEM_SPEC.md', 'Acceptance Tests'],
    ['IMPLEMENTATION_NOTES.md', 'scaffold placeholders'],
    ['acceptance-matrix.md', 'requirement table'],
    ['RELEASE_NOTES.md', 'scaffold placeholders'],
  ];

  for (const [file, keyword] of requiredSemantics) {
    it(`implementor guide documents ${file} semantic check`, () => {
      assert.match(guide, new RegExp(file.replace('.', '\\.')),
        `protocol-implementor-guide.mdx must mention ${file} in the gate_semantics section`);
      assert.match(guide, new RegExp(keyword),
        `protocol-implementor-guide.mdx must describe the ${file} semantic check`);
    });
  }
});

describe('Website analytics contract', () => {
  const config = read('website-v2/docusaurus.config.ts');
  const spec = read('.planning/WEBSITE_ANALYTICS_SPEC.md');

  it('pins GA4 to the expected tracking ID through Docusaurus gtag config', () => {
    assert.match(spec, /AT-WA-001/);
    assert.match(config, /gtag:\s*\{/);
    assert.match(config, /trackingID:\s*'G-1Z8RV9X341'/);
  });

  it('keeps anonymizeIP enabled', () => {
    assert.match(spec, /AT-WA-002/);
    assert.match(config, /anonymizeIP:\s*true/);
  });

  it('does not add a second manual GA snippet beside the Docusaurus plugin', () => {
    assert.match(spec, /AT-WA-003/);
    assert.doesNotMatch(config, /googletagmanager\.com\/gtag\/js/);
    assert.doesNotMatch(config, /window\.dataLayer/);
  });
});

describe('Scenario D escalation evidence', () => {
  const report = read('.planning/LAUNCH_EVIDENCE_REPORT.md');
  const proofExists = existsSync(resolve(ROOT, 'examples', 'live-governed-proof', 'run-escalation-recovery-proof.mjs'));

  it('evidence report contains E2d section', () => {
    assert.match(report, /E2d.*Scenario D Escalation.*Recovery Proof/);
  });

  it('E2d section documents retry exhaustion and eng_director intervention', () => {
    assert.match(report, /escalation:retries-exhausted:dev/);
    assert.match(report, /eng_director/);
    assert.match(report, /run_ebf10c05d7419a0c/);
  });

  it('evidence gap for Scenario D is marked closed', () => {
    assert.match(report, /~~Scenario D escalation dogfood~~.*CLOSED/);
  });

  it('allowed claims include escalation recovery', () => {
    assert.match(report, /Retry exhaustion triggers governed escalation/i);
  });

  it('proof script exists', () => {
    assert.ok(proofExists, 'examples/live-governed-proof/run-escalation-recovery-proof.mjs must exist');
  });
});

describe('Launch brief references evidence report', () => {
  const brief = read('.planning/LAUNCH_BRIEF.md');

  it('links to the evidence report', () => {
    assert.match(brief, /LAUNCH_EVIDENCE_REPORT\.md/);
  });

  it('includes claim boundary constraints', () => {
    assert.match(brief, /All four adapter types are now proven live/i);
    assert.match(brief, /proposed-authority.*proven live/i);
    assert.match(brief, /DEC-PROP-COMPLETION-CONTRACT-001/);
    assert.match(brief, /run_7b067f892916b799/);
    assert.match(brief, /production-proven/i);
    assert.match(brief, /DEC-POSITIONING-008/);
  });
});

describe('Mobile nav sidebar regression guard', () => {
  const css = read('website-v2/src/css/custom.css');

  it('disables backdrop-filter when sidebar is shown to prevent fixed-position containment', () => {
    // backdrop-filter on .navbar creates a containing block for position:fixed
    // children, causing .navbar-sidebar to be constrained to the navbar height
    // (~60px) instead of the full viewport. This collapsed .navbar-sidebar__items
    // to height:0 on narrow desktop viewports.
    assert.match(css, /\.navbar-sidebar--show\s*\{[^}]*backdrop-filter:\s*none/,
      '.navbar-sidebar--show must set backdrop-filter:none to prevent fixed-position containment bug');
  });

  it('still applies backdrop-filter to navbar in normal state', () => {
    assert.match(css, /\.navbar\s*\{[^}]*backdrop-filter:\s*blur/,
      '.navbar should retain backdrop-filter blur for the frosted-glass effect');
  });
});
