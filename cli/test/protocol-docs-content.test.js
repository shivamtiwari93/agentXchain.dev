import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

const read = (rel) => readFileSync(join(REPO_ROOT, rel), 'utf8');

const PROTOCOL_V6_MD = read('PROTOCOL-v6.md');
const PROTOCOL_DOCS = read('website/docs/protocol.html');
const PROTOCOL_V6_DOCS = read('website/docs/protocol-v6.html');
const PROTOCOL_SPEC = read('.planning/PROTOCOL_DOC_PAGE_SPEC.md');
const DOCS_SURFACE_SPEC = read('.planning/DOCS_SURFACE_SPEC.md');
const CLI_DOC_SPEC = read('.planning/CLI_DOC_PAGE_SPEC.md');
const V2_SCOPE = read('.planning/V2_SCOPE_BOUNDARY.md');
const ROOT_README = read('README.md');
const CLI_README = read('cli/README.md');

describe('Protocol v6 artifact presence', () => {
  it('ships the normative markdown and versioned docs page', () => {
    assert.ok(existsSync(join(REPO_ROOT, 'PROTOCOL-v6.md')), 'PROTOCOL-v6.md must exist');
    assert.ok(existsSync(join(REPO_ROOT, 'website/docs/protocol-v6.html')), 'website/docs/protocol-v6.html must exist');
  });
});

describe('Protocol docs content', () => {
  it('promotes v6 as the current normative protocol surface', () => {
    assert.match(PROTOCOL_DOCS, /Protocol v6/i);
    assert.match(PROTOCOL_DOCS, /PROTOCOL-v6\.md/);
    assert.doesNotMatch(
      PROTOCOL_DOCS,
      /View full spec on GitHub.*SPEC-GOVERNED-v5\.md/s,
      'protocol.html must not present SPEC-GOVERNED-v5.md as the current normative spec'
    );
  });

  it('documents the implemented multi-repo coordinator contract', () => {
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
      assert.ok(PROTOCOL_DOCS.includes(term), `protocol docs must mention ${term}`);
      assert.ok(PROTOCOL_V6_MD.includes(term), `PROTOCOL-v6.md must mention ${term}`);
    }
  });

  it('ships a versioned permalink page for v6', () => {
    assert.match(PROTOCOL_V6_DOCS, /Protocol v6 permalink/i);
    assert.match(PROTOCOL_V6_DOCS, /PROTOCOL-v6\.md/);
    assert.match(PROTOCOL_V6_DOCS, /acceptance_projection/);
    assert.match(PROTOCOL_V6_DOCS, /context_generated/);
  });
});

describe('Protocol planning specs stay aligned', () => {
  it('updates planning specs to v6 instead of v5 as the current reference', () => {
    assert.match(PROTOCOL_SPEC, /PROTOCOL-v6\.md/);
    assert.match(PROTOCOL_SPEC, /protocol-v6\.html/);
    assert.match(DOCS_SURFACE_SPEC, /PROTOCOL-v6\.md/);
    assert.match(DOCS_SURFACE_SPEC, /\/docs\/protocol-v6/);
    assert.match(CLI_DOC_SPEC, /\/docs\/protocol\.html/);
    assert.doesNotMatch(CLI_DOC_SPEC, /SPEC-GOVERNED-v5\.md on GitHub until a local protocol page exists/);
    assert.match(V2_SCOPE, /protocol-v6\.html/);
  });
});

describe('Public links stay host-safe and point at the latest protocol alias', () => {
  it('keeps README protocol links on explicit .html targets', () => {
    assert.match(ROOT_README, /docs\/protocol\.html/);
    assert.match(CLI_README, /docs\/protocol\.html/);
    assert.doesNotMatch(CLI_README, /docs\/protocol\)(?!\.html)/);
  });
});
