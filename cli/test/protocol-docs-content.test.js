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
    ]) {
      assert.ok(PROTOCOL_DOCS_MDX.toLowerCase().includes(term.toLowerCase()), `protocol docs must mention ${term}`);
    }
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
  it('updates planning specs to v6 instead of v5 as the current reference', () => {
    assert.match(PROTOCOL_SPEC, /PROTOCOL-v6\.md/);
    assert.match(PROTOCOL_SPEC, /protocol-v6\.html/);
    assert.match(DOCS_SURFACE_SPEC, /PROTOCOL-v6\.md/);
    assert.match(DOCS_SURFACE_SPEC, /\/docs\/protocol-v6/);
    assert.match(CLI_DOC_SPEC, /\/docs\/protocol/);
    assert.doesNotMatch(CLI_DOC_SPEC, /SPEC-GOVERNED-v5\.md on GitHub until a local protocol page exists/);
    assert.match(V2_SCOPE, /protocol-v6\.html/);
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
