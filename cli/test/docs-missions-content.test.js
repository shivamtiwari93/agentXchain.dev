import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

const read = (rel) => readFileSync(join(REPO_ROOT, rel), 'utf8');

const DOC_PATH = 'website-v2/docs/missions.mdx';
const DOC = read(DOC_PATH);
const SIDEBARS = read('website-v2/sidebars.ts');
const LLMS = read('website-v2/static/llms.txt');
const SPEC = read('.planning/MISSIONS_DOC_PAGE_SPEC.md');
const CLI_ENTRY = read('cli/bin/agentxchain.js');
const MISSIONS_LIB = read('cli/src/lib/missions.js');
const RUN_CHAIN_DOC = read('website-v2/docs/run-chaining.mdx');
const CLI_DOC = read('website-v2/docs/cli.mdx');

describe('Missions docs surface', () => {
  it('ships the Docusaurus page and planning spec', () => {
    assert.ok(existsSync(join(REPO_ROOT, DOC_PATH)), 'missions docs page must exist');
    assert.ok(
      existsSync(join(REPO_ROOT, '.planning/MISSIONS_DOC_PAGE_SPEC.md')),
      'missions docs spec must exist'
    );
  });

  it('adds the page under Continuous Delivery and includes it in llms.txt', () => {
    assert.match(SIDEBARS, /label:\s*'Continuous Delivery'/);
    assert.match(SIDEBARS, /'missions'/);
    assert.match(LLMS, /https:\/\/agentxchain\.dev\/docs\/missions/);
  });

  it('keeps mission explicitly separate from coordinator initiative', () => {
    assert.match(DOC, /Mission.*repo-local/i);
    assert.match(DOC, /Initiative.*multi-repo/i);
    assert.ok(
      !DOC.includes('Mission is the multi-repo coordinator surface'),
      'missions docs must not collapse mission into coordinator initiative'
    );
  });

  it('documents the shipped mission CLI commands and preferred binding path', () => {
    for (const cmd of [
      'agentxchain mission start',
      'agentxchain mission list',
      'agentxchain mission show',
      'agentxchain mission attach-chain',
      'agentxchain mission plan latest',
      'agentxchain mission plan show latest',
      'agentxchain mission plan approve latest',
      'agentxchain mission plan launch latest',
      'agentxchain mission plan list',
      'agentxchain run --chain --mission latest',
      'agentxchain run --chain --mission mission-release-hardening',
    ]) {
      assert.ok(DOC.includes(cmd), `missions docs must mention ${cmd}`);
    }

    assert.match(DOC, /primary operator flow/i);
    assert.match(DOC, /manual fallback/i);
    assert.match(DOC, /decomposed mission planning/i);
  });

  it('documents real artifact and dashboard/api surfaces', () => {
    for (const term of [
      '.agentxchain/missions/<mission_id>.json',
      '.agentxchain/missions/plans/<mission_id>/<plan_id>.json',
      '.agentxchain/reports/chain-<id>.json',
      'GET /api/missions',
      'GET /api/plans',
    ]) {
      assert.ok(DOC.includes(term), `missions docs must mention ${term}`);
    }
    assert.match(DOC, /dashboard [`']?Mission[`']? view/i);
  });

  it('documents the derived mission status contract from implementation', () => {
    assert.match(MISSIONS_LIB, /return 'planned'/);
    assert.match(MISSIONS_LIB, /return 'progressing'/);
    assert.match(MISSIONS_LIB, /return 'needs_attention'/);
    assert.match(MISSIONS_LIB, /return 'degraded'/);

    for (const status of ['planned', 'progressing', 'needs_attention', 'degraded']) {
      assert.ok(DOC.includes(`\`${status}\``), `missions docs must mention ${status}`);
    }
  });

  it('documents explicit-vs-latest failure asymmetry truthfully', () => {
    assert.match(DOC, /fails closed/i);
    assert.match(DOC, /warns and continues/i);
  });

  it('documents mission-plan execution and launch-state truthfully', () => {
    assert.match(DOC, /not bookkeeping-only/i);
    assert.match(DOC, /workstream_id -> chain_id/i);
    assert.match(DOC, /executes the workstream immediately/i);
    for (const status of ['`proposed`', '`approved`', '`superseded`', '`ready`', '`blocked`', '`launched`', '`completed`', '`needs_attention`']) {
      assert.ok(DOC.includes(status), `missions docs must mention ${status}`);
    }
  });
});

describe('Missions docs cross-linking and implementation alignment', () => {
  it('is linked from CLI and run-chaining docs', () => {
    assert.match(CLI_DOC, /\[Missions\]\(\/docs\/missions\)/);
    assert.match(RUN_CHAIN_DOC, /\[Missions\]\(\/docs\/missions\)/);
  });

  it('matches the shipped mission command registration', () => {
    assert.match(CLI_ENTRY, /\.command\('mission'\)/);
    assert.match(CLI_ENTRY, /\.command\('start'\)/);
    assert.match(CLI_ENTRY, /\.command\('list'\)/);
    assert.match(CLI_ENTRY, /\.command\('show \[mission_id\]'\)/);
    assert.match(CLI_ENTRY, /\.command\('attach-chain \[chain_id\]'\)/);
    assert.match(CLI_ENTRY, /Group chained runs under a single-repo long-horizon mission/);
  });

  it('ships a standalone missions docs spec', () => {
    assert.match(SPEC, /## Purpose/);
    assert.match(SPEC, /## Interface/);
    assert.match(SPEC, /## Behavior/);
    assert.match(SPEC, /## Error Cases/);
    assert.match(SPEC, /## Acceptance Tests/);
    assert.match(SPEC, /\/docs\/missions/);
  });
});
