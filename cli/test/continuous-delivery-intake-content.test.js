import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

const read = (rel) => readFileSync(join(REPO_ROOT, rel), 'utf8');

const DOC_PATH = 'website-v2/docs/continuous-delivery-intake.mdx';
const DOC = read(DOC_PATH);
const SIDEBARS = read('website-v2/sidebars.ts');
const DOCS_SURFACE_SPEC = read('.planning/DOCS_SURFACE_SPEC.md');
const DOC_SPEC = read('.planning/CONTINUOUS_DELIVERY_INTAKE_DOC_SPEC.md');
const V3_SCOPE = read('.planning/V3_SCOPE.md');

describe('Continuous delivery intake docs surface', () => {
  it('ships the Docusaurus page and planning spec', () => {
    assert.ok(existsSync(join(REPO_ROOT, DOC_PATH)), 'intake docs page must exist');
    assert.ok(
      existsSync(join(REPO_ROOT, '.planning/CONTINUOUS_DELIVERY_INTAKE_DOC_SPEC.md')),
      'intake docs spec must exist'
    );
  });

  it('adds the page under a Continuous Delivery docs section', () => {
    assert.match(SIDEBARS, /label:\s*'Continuous Delivery'/);
    assert.match(SIDEBARS, /'continuous-delivery-intake'/);
  });

  it('documents the shipped intake command surface and artifact paths', () => {
    for (const term of [
      'intake record',
      'intake triage',
      'intake status',
      '.agentxchain/intake/',
      '.agentxchain/intake/events/',
      '.agentxchain/intake/intents/',
      'loop-state.json',
      'dedup_key',
      'ci_failure',
      'git_ref_change',
      'schedule',
    ]) {
      assert.ok(DOC.includes(term), `intake docs must mention ${term}`);
    }
  });

  it('distinguishes shipped states from deferred approved/planned transitions', () => {
    assert.match(DOC, /Implemented now/);
    assert.match(DOC, /Defined in v3 scope, not exposed yet/);
    assert.match(DOC, /triaged -> approved -> planned/);
    assert.match(DOC, /there is no `intake approve` or `intake plan` command yet/);
  });

  it('keeps planning specs aligned with the public route and resolved v3 questions', () => {
    assert.match(DOCS_SURFACE_SPEC, /\/docs\/continuous-delivery-intake/);
    assert.match(DOC_SPEC, /\/docs\/continuous-delivery-intake/);
    assert.match(V3_SCOPE, /`schedule` is a first-class event source/i);
    assert.match(V3_SCOPE, /append-only child records under `\.agentxchain\/intake\/observations\/`/i);
    assert.match(V3_SCOPE, /fallback template is `generic`/i);
  });
});
