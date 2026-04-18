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
      '--title "Release hardening"',
      '--plan',
      'agentxchain mission list',
      'agentxchain mission show',
      'agentxchain mission attach-chain',
      'agentxchain mission plan latest',
      '--planner-output-file ./planner-output.json',
      'agentxchain mission plan show latest',
      'agentxchain mission plan approve latest',
      'agentxchain mission plan launch latest',
      '--retry',
      'agentxchain mission plan autopilot',
      '--max-waves',
      '--continue-on-failure',
      'agentxchain mission plan list',
      'agentxchain run --chain --mission latest',
      'agentxchain run --chain --mission mission-release-hardening',
    ]) {
      assert.ok(DOC.includes(cmd), `missions docs must mention ${cmd}`);
    }

    assert.match(DOC, /primary operator flow/i);
    assert.match(DOC, /manual fallback/i);
    assert.match(DOC, /decomposed mission planning/i);
    assert.match(DOC, /convenience layer/i);
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
    assert.match(DOC, /deterministic or offline/i);
    assert.match(DOC, /completion percentage/i);
    for (const status of ['`proposed`', '`approved`', '`superseded`', '`completed`', '`ready`', '`blocked`', '`launched`', '`needs_attention`']) {
      assert.ok(DOC.includes(status), `missions docs must mention ${status}`);
    }
  });
});

describe('Missions docs coordinator-bound launch surface', () => {
  it('documents coordinator-bound mission plan launch behavior', () => {
    assert.match(DOC, /coordinator-bound mission plan/i);
    assert.match(DOC, /dispatch_mode.*coordinator/);
    assert.match(DOC, /repo_dispatches/);
    assert.match(DOC, /super_run_id/);
    assert.match(DOC, /completion_barrier/);
  });

  it('documents the coordinator launch record shape with required fields', () => {
    for (const field of [
      'dispatch_mode',
      'super_run_id',
      'repo_dispatches',
      'repo_id',
      'repo_turn_id',
      'completion_barrier',
      'barrier_id',
    ]) {
      assert.ok(DOC.includes(field), `coordinator launch record docs must mention ${field}`);
    }
  });

  it('documents coordinator completion synchronization', () => {
    assert.match(DOC, /completion synchronization/i);
    assert.match(DOC, /coordinator_progress/);
    assert.match(DOC, /accepted_repo_ids/);
    assert.match(DOC, /pending_repo_ids/);
    assert.match(DOC, /failed_repo_ids/);
    assert.match(DOC, /repo_failure_count/);
    assert.match(DOC, /repo_failures/);
    assert.match(DOC, /completion_barrier_status/);
    assert.match(DOC, /accepted_repo_count/);
  });

  it('documents coordinator wave execution for batch operations', () => {
    assert.match(DOC, /coordinator.*wave/i);
    assert.match(DOC, /--all-ready.*dispatches.*ready.*workstreams/i);
    assert.match(DOC, /autopilot.*wave.*based/i);
    assert.match(DOC, /barrier.*semantics/i);
  });

  it('documents coordinator-specific error cases', () => {
    assert.match(DOC, /coordinator.*workspace.*missing/i);
    assert.match(DOC, /coordinator.*state.*not.*active/i);
    assert.match(DOC, /coordinator.*config/i);
    assert.match(DOC, /phase/i);
  });

  it('documents mission plan show coordinator synchronization', () => {
    assert.match(DOC, /mission plan show.*synchronize/i);
    assert.match(DOC, /acceptance projection/i);
    assert.match(DOC, /barrier state/i);
    assert.match(DOC, /repo-local turn outcome/i);
    assert.match(DOC, /failed_acceptance/i);
    assert.match(DOC, /needs_attention/i);
  });

  it('does not regress to the obsolete fail-closed coordinator wave story', () => {
    assert.doesNotMatch(
      DOC,
      /Both exit immediately with an error directing the operator to `mission plan launch --workstream <id>`/i,
    );
    assert.match(DOC, /--all-ready.*dispatches one repo-local turn for each currently `ready` workstream/i);
    assert.match(DOC, /autopilot.*repeats that wave loop until the plan completes/i);
    assert.match(DOC, /barrier satisfaction rather than synthetic chain reports/i);
  });

  it('documents repo-local recovery for failed coordinator workstreams', () => {
    assert.match(DOC, /Recovering a failed coordinator workstream/i);
    assert.match(DOC, /repo_failures\[\]/);
    assert.match(DOC, /agentxchain mission plan show latest --json/);
    assert.match(DOC, /agentxchain status/);
    assert.match(DOC, /agentxchain events/);
    assert.match(DOC, /agentxchain doctor/);
    assert.match(DOC, /agentxchain mission plan launch latest --workstream <id> --retry/);
    assert.match(DOC, /agentxchain reissue-turn --turn <turn_id>/);
    assert.match(DOC, /agentxchain reject-turn --turn <turn_id> --reassign --reason/);
    assert.match(DOC, /agentxchain step --resume --turn <turn_id>/);
    assert.match(DOC, /support targeted `--retry`/i);
    assert.match(DOC, /no unattended coordinator `--auto-retry` surface/i);
  });
});

describe('CLI docs retry description distinguishes single-repo vs coordinator behavior', () => {
  it('cli.mdx --retry section describes coordinator append-to-same-launch-record behavior', () => {
    assert.match(CLI_DOC, /coordinator-bound missions.*appends.*repo_dispatches/i);
    assert.match(CLI_DOC, /no new launch record or chain ID/i);
    assert.match(CLI_DOC, /reconciliation_required: true/i);
    assert.match(CLI_DOC, /coordinator_acceptance_projection_incomplete/i);
    assert.match(CLI_DOC, /coordinator_retry_projection_warning/i);
  });

  it('cli.mdx --retry section describes single-repo new-launch-record behavior', () => {
    assert.match(CLI_DOC, /single-repo missions.*new launch record.*new chain ID/i);
  });

  it('cli.mdx --retry section does not claim coordinator retry creates a new launch record', () => {
    // Guard: the old text said "creates a new launch record with a new chain ID" without
    // distinguishing single-repo from coordinator. Ensure that claim is scoped.
    assert.doesNotMatch(
      CLI_DOC,
      /`--retry`[^.]*creates a new launch record[^.]*(?!single-repo|For single)/i
    );
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
    assert.match(CLI_ENTRY, /Generate a proposed mission plan immediately after mission creation/);
    assert.match(CLI_ENTRY, /Read planner JSON output from a file instead of calling the configured planner/);
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
