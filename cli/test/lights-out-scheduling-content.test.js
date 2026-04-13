import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

function read(relPath) {
  return readFileSync(join(REPO_ROOT, relPath), 'utf8');
}

const DOC_PATH = 'website-v2/docs/lights-out-scheduling.mdx';
const DOC = read(DOC_PATH);
const SIDEBARS = read('website-v2/sidebars.ts');
const SPEC = read('.planning/RUN_SCHEDULE_SPEC.md');
const RELEASE = read('website-v2/docs/releases/v2-49-0.mdx');

describe('lights-out scheduling docs contract', () => {
  it('ships the dedicated guide and sidebar entry', () => {
    assert.ok(existsSync(join(REPO_ROOT, DOC_PATH)), 'lights-out scheduling guide must exist');
    assert.match(SIDEBARS, /'lights-out-scheduling'/);
  });

  it('documents the repo-local boundary truthfully', () => {
    assert.match(DOC, /repo-local only/i);
    assert.match(DOC, /agentxchain\.json/);
    assert.match(DOC, /agentxchain-multi\.json/);
    assert.match(DOC, /does \*\*not\*\* run from a coordinator workspace/i);
    assert.match(DOC, /agentxchain multi step/);
  });

  it('documents fresh-repo start eligibility instead of claiming idle\/completed only', () => {
    assert.match(DOC, /fresh repo with no run state yet/i);
    assert.doesNotMatch(DOC, /start only from `idle` or `completed` status/i);
  });
});

describe('lights-out scheduling docs align with shipped schedule boundary', () => {
  it('matches the standalone schedule spec non-scope and fresh-start rules', () => {
    assert.match(SPEC, /Scheduled runs may start only when the repo state is:[\s\S]*missing[\s\S]*`idle`[\s\S]*`completed`/);
    assert.match(SPEC, /schedule fan-out across coordinator child repos/);
  });

  it('matches the original release notes repo-local boundary', () => {
    assert.match(RELEASE, /\*\*Repo-local only\*\* — no hosted schedulers, no cross-repo fan-out, no coordinator-level schedule aggregation/);
  });
});
