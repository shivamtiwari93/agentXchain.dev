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
      'intake approve',
      'intake plan',
      'intake start',
      'intake resolve',
      'intake scan',
      'intake status',
      '.agentxchain/intake/',
      '.agentxchain/intake/events/',
      '.agentxchain/intake/intents/',
      '.agentxchain/intake/observations/',
      'loop-state.json',
      'dedup_key',
      'approved_by',
      'planning_artifacts',
      'target_run',
      'target_turn',
      'started_at',
      'ci_failure',
      'git_ref_change',
      'schedule',
      'captured_at',
      'deduplicated',
      'rejected',
    ]) {
      assert.ok(DOC.includes(term), `intake docs must mention ${term}`);
    }
  });

  it('documents the shipped intake state machine, intake resolve contract, intake scan contract, and deferred later-v3 states', () => {
    assert.match(DOC, /Implemented now/);
    assert.match(DOC, /Deferred beyond the shipped intake surface/);
    assert.match(DOC, /triaged -> approved/);
    assert.match(DOC, /approved -> planned/);
    assert.match(DOC, /planned -> executing/);
    assert.match(DOC, /executing -> blocked/);
    assert.match(DOC, /executing -> completed/);
    assert.match(DOC, /executing -> failed/);
    assert.match(DOC, /blocked -> approved/);
    assert.match(DOC, /completed -> awaiting_release_approval/);
    assert.match(DOC, /Under the current governed-state contract, `paused` is an approval-held state/);
    assert.match(DOC, /Use `intake resolve` to close the loop/);
    assert.match(DOC, /run_outcome/);
    assert.match(DOC, /no_change/);
    assert.match(DOC, /observations\/<intent_id>/);
    assert.match(DOC, /Use `intake scan` to ingest a deterministic source snapshot/);
    assert.match(DOC, /`manual` is excluded on purpose/);
    assert.match(DOC, /items` must be a non-empty array/);
    assert.doesNotMatch(DOC, /There is still no `intake start` command/);
    assert.doesNotMatch(DOC, /What is intentionally \*\*not\*\* shipped yet:\s*- `agentxchain intake scan`/);
  });

  it('keeps planning specs aligned with the public route, shipped slices, and resolved v3 questions', () => {
    assert.match(DOCS_SURFACE_SPEC, /\/docs\/continuous-delivery-intake/);
    assert.match(DOC_SPEC, /\/docs\/continuous-delivery-intake/);
    assert.match(V3_SCOPE, /V3-S1 \(shipped\)/);
    assert.match(V3_SCOPE, /V3-S2 \(shipped\)/);
    assert.match(V3_SCOPE, /V3-S3 \(shipped\)/);
    assert.match(V3_SCOPE, /V3-S4 \(shipped\)/);
    assert.match(V3_SCOPE, /V3-S5 \(shipped\)/);
    assert.match(V3_SCOPE, /intake lifecycle is feature-complete for now/i);
    assert.match(V3_SCOPE, /`schedule` is a first-class event source/i);
    assert.match(V3_SCOPE, /append-only child records under `\.agentxchain\/intake\/observations\/`/i);
    assert.match(V3_SCOPE, /fallback template is `generic`/i);
  });
});
