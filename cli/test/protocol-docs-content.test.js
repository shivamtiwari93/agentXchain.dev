import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

const read = (rel) => readFileSync(join(REPO_ROOT, rel), 'utf8');

const PROTOCOL_V6_MD = read('PROTOCOL-v6.md');
const PROTOCOL_DOCS_MDX = read('website-v2/docs/protocol.mdx');
const PROTOCOL_SPEC = read('.planning/PROTOCOL_DOC_PAGE_SPEC.md');
const DOCS_SURFACE_SPEC = read('.planning/DOCS_SURFACE_SPEC.md');
const CLI_DOC_SPEC = read('.planning/CLI_DOC_PAGE_SPEC.md');
const V2_SCOPE = read('.planning/V2_SCOPE_BOUNDARY.md');
const ROOT_README = read('README.md');
const CLI_README = read('cli/README.md');
const INIT_COMMAND = read('cli/src/commands/init.js');
const MIGRATE_COMMAND = read('cli/src/commands/migrate.js');
const GOVERNED_STATE = read('cli/src/lib/governed-state.js');
const TURN_RESULT_VALIDATOR = read('cli/src/lib/turn-result-validator.js');
const COORDINATOR_CONFIG = read('cli/src/lib/coordinator-config.js');

describe('Protocol v6 artifact presence', () => {
  it('ships the normative markdown and Docusaurus docs source', () => {
    assert.ok(existsSync(join(REPO_ROOT, 'PROTOCOL-v6.md')), 'PROTOCOL-v6.md must exist');
    assert.ok(existsSync(join(REPO_ROOT, 'website-v2', 'docs', 'protocol.mdx')), 'website-v2/docs/protocol.mdx must exist');
  });
});

describe('Protocol docs content', () => {
  it('promotes v6 as the current normative protocol surface', () => {
    assert.match(PROTOCOL_DOCS_MDX, /Protocol v6/i);
    assert.doesNotMatch(
      PROTOCOL_DOCS_MDX,
      /SPEC-GOVERNED-v5\.md/,
      'protocol docs must not present v5 as the current normative spec'
    );
  });

  it('documents multi-repo coordinator concepts in the docs page', () => {
    for (const term of [
      'agentxchain-multi.json',
      'super_run_id',
      'barrier',
      'cross-repo',
      'coordinator',
      'multi approve-gate',
      '/docs/multi-repo',
    ]) {
      assert.ok(PROTOCOL_DOCS_MDX.toLowerCase().includes(term.toLowerCase()), `protocol docs must mention ${term}`);
    }
  });

  it('documents the shipped default repo-local phase names and not a fake verification phase', () => {
    assert.match(INIT_COMMAND, /qa_ship_verdict/);
    assert.match(PROTOCOL_DOCS_MDX, /\| `qa` \|/);
    assert.doesNotMatch(
      PROTOCOL_DOCS_MDX,
      /\| `verification` \|/,
      'protocol docs must not present "verification" as the shipped default phase name'
    );
  });

  it('documents the review_only objection rule instead of claiming objections are mandatory for every role', () => {
    assert.match(TURN_RESULT_VALIDATOR, /review_only roles MUST raise at least one objection/);
    assert.match(PROTOCOL_DOCS_MDX, /review_only/);
    assert.match(PROTOCOL_DOCS_MDX, /at least one objection/i);
    assert.doesNotMatch(
      PROTOCOL_DOCS_MDX,
      /mandatory objections/i,
      'protocol docs must not flatten the challenge rule into a blanket objections requirement'
    );
  });

  it('documents mixed artifact schema versions instead of claiming 1.0 for everything', () => {
    assert.match(INIT_COMMAND, /schema_version: '1\.0'/);
    assert.match(INIT_COMMAND, /schema_version: '1\.1'/);
    assert.match(COORDINATOR_CONFIG, /schema_version must be "0\.1"/);
    for (const term of ['governed config `1.0`', 'governed state `1.1`', 'coordinator config/state `0.1`']) {
      assert.ok(PROTOCOL_DOCS_MDX.includes(term), `protocol docs must mention ${term}`);
    }
    assert.doesNotMatch(
      PROTOCOL_DOCS_MDX,
      /schema version `1\.0` for all artifacts/i,
      'protocol docs must not claim all artifacts use schema version 1.0'
    );
  });

  it('documents queued-versus-pending gate semantics from the governed runtime', () => {
    assert.match(GOVERNED_STATE, /queued_phase_transition/);
    assert.match(GOVERNED_STATE, /queued_run_completion/);
    assert.match(GOVERNED_STATE, /pending_phase_transition/);
    assert.match(GOVERNED_STATE, /pending_run_completion/);
    for (const term of [
      'queued_phase_transition',
      'queued_run_completion',
      'pending_phase_transition',
      'pending_run_completion',
    ]) {
      assert.ok(PROTOCOL_DOCS_MDX.includes(term), `protocol docs must mention ${term}`);
    }
  });

  it('documents the real migrate contract for governed config and state', () => {
    assert.match(MIGRATE_COMMAND, /schema_version: '1\.0'/);
    assert.match(MIGRATE_COMMAND, /schema_version: '1\.1'/);
    assert.match(MIGRATE_COMMAND, /blocked_on: 'human:migration-review'/);
    for (const term of ['schema `1.0`', 'schema `1.1`', 'human:migration-review', 'does not backfill legacy history']) {
      assert.ok(PROTOCOL_DOCS_MDX.includes(term), `protocol docs must mention ${term}`);
    }
  });

  it('describes the decision ledger truthfully', () => {
    assert.match(GOVERNED_STATE, /Does NOT append to history\.jsonl or decision-ledger\.jsonl\./);
    assert.match(PROTOCOL_DOCS_MDX, /accepted decisions plus selected conflict\/governance events/);
    assert.doesNotMatch(
      PROTOCOL_DOCS_MDX,
      /gate approvals, and rejections/i,
      'protocol docs must not claim generic rejection logging in the decision ledger'
    );
  });

  it('documents the full multi-repo coordinator contract in the normative spec', () => {
    for (const term of [
      'agentxchain-multi.json',
      'multi approve-gate',
      'acceptance_projection',
      'context_generated',
      'context_invalidations',
      'COORDINATOR_CONTEXT.json',
      'before_assignment',
      'after_acceptance',
      'before_gate',
      'on_escalation',
    ]) {
      assert.ok(PROTOCOL_V6_MD.includes(term), `PROTOCOL-v6.md must mention ${term}`);
    }
  });
});

describe('Protocol planning specs stay aligned', () => {
  it('updates planning specs to the Docusaurus v6 surface instead of the retired static html contract', () => {
    assert.match(PROTOCOL_SPEC, /website-v2\/docs\/protocol\.mdx/);
    assert.match(PROTOCOL_SPEC, /\/docs\/protocol/);
    assert.match(PROTOCOL_SPEC, /\/docs\/protocol-v6/);
    assert.match(DOCS_SURFACE_SPEC, /PROTOCOL-v6\.md/);
    assert.match(DOCS_SURFACE_SPEC, /\/docs\/protocol-v6/);
    assert.match(CLI_DOC_SPEC, /\/docs\/protocol/);
    assert.doesNotMatch(PROTOCOL_SPEC, /website\/docs\/protocol\.html/);
    assert.doesNotMatch(CLI_DOC_SPEC, /SPEC-GOVERNED-v5\.md on GitHub until a local protocol page exists/);
    assert.match(V2_SCOPE, /protocol\.mdx/);
  });
});

describe('Public links stay host-safe and point at the latest protocol alias', () => {
  it('keeps README protocol links on the clean Docusaurus route', () => {
    assert.match(ROOT_README, /https:\/\/agentxchain\.dev\/docs\/protocol\/?/);
    assert.match(CLI_README, /https:\/\/agentxchain\.dev\/docs\/protocol\/?/);
    assert.doesNotMatch(ROOT_README, /docs\/protocol\.html/);
    assert.doesNotMatch(CLI_README, /docs\/protocol\.html/);
  });
});
