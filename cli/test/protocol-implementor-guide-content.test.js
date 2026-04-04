import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

const read = (rel) => readFileSync(join(REPO_ROOT, rel), 'utf8');

const GUIDE_PATH = 'website-v2/docs/protocol-implementor-guide.mdx';
const GUIDE = read(GUIDE_PATH);
const SIDEBARS = read('website-v2/sidebars.ts');
const DOCS_SURFACE_SPEC = read('.planning/DOCS_SURFACE_SPEC.md');
const GUIDE_SPEC = read('.planning/PROTOCOL_IMPLEMENTOR_GUIDE_SPEC.md');

describe('Protocol implementor guide surface', () => {
  it('ships the Docusaurus source page and planning spec', () => {
    assert.ok(existsSync(join(REPO_ROOT, GUIDE_PATH)), 'guide source must exist');
    assert.ok(
      existsSync(join(REPO_ROOT, '.planning/PROTOCOL_IMPLEMENTOR_GUIDE_SPEC.md')),
      'implementor guide spec must exist'
    );
  });

  it('adds the guide under the Protocol docs section', () => {
    assert.match(SIDEBARS, /label:\s*'Protocol'/);
    assert.match(SIDEBARS, /'protocol-implementor-guide'/);
  });

  it('documents the real conformance primitives', () => {
    for (const term of [
      'capabilities.json',
      'stdio-fixture-v1',
      'http-fixture-v1',
      'verify protocol',
      'not_implemented',
      'state_machine',
      'turn_result_validation',
      'gate_semantics',
      'decision_ledger',
      'history',
      'config_schema',
      'dispatch_manifest',
      'hook_audit',
      'coordinator',
    ]) {
      assert.ok(GUIDE.includes(term), `guide must mention ${term}`);
    }
  });

  it('distinguishes adapter exit codes from verifier exit codes', () => {
    assert.match(GUIDE, /Adapter process \| `0=pass`, `1=fail`, `2=error`, `3=not_implemented`/);
    assert.match(GUIDE, /verify protocol` \| `0=overall pass`, `1=one or more fixture failures`, `2=verifier or adapter error`/);
    assert.match(GUIDE, /The verifier never exits `3`/);
  });

  it('keeps planning specs aligned with the public route', () => {
    assert.match(DOCS_SURFACE_SPEC, /\/docs\/protocol-implementor-guide/);
    assert.match(GUIDE_SPEC, /\/docs\/protocol-implementor-guide/);
    assert.match(GUIDE_SPEC, /Protocol Implementor Guide/i);
  });
});
