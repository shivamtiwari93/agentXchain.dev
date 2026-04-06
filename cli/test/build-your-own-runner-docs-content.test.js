import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

const read = (rel) => readFileSync(join(REPO_ROOT, rel), 'utf8');

const PAGE_PATH = 'website-v2/docs/build-your-own-runner.mdx';
const PAGE = read(PAGE_PATH);
const README = read('examples/ci-runner-proof/README.md');
const SIDEBARS = read('website-v2/sidebars.ts');
const DOCS_SURFACE_SPEC = read('.planning/DOCS_SURFACE_SPEC.md');
const PAGE_SPEC = read('.planning/BUILD_YOUR_OWN_RUNNER_DOC_SPEC.md');
const RUNNER_INTERFACE_PAGE = read('website-v2/docs/runner-interface.mdx');
const QUICKSTART_DOCS = read('website-v2/docs/quickstart.mdx');
const ROOT_README = read('README.md');
const CLI_README = read('cli/README.md');
const RUNNER_INTERFACE = read('cli/src/lib/runner-interface.js');

describe('Build your own runner docs surface', () => {
  it('AT-BYR-001: ships the page, sidebar entry, and docs surface declaration', () => {
    assert.ok(existsSync(join(REPO_ROOT, PAGE_PATH)), 'tutorial page must exist');
    assert.ok(
      existsSync(join(REPO_ROOT, 'examples', 'ci-runner-proof', 'README.md')),
      'ci-runner-proof README must exist',
    );
    assert.match(SIDEBARS, /'build-your-own-runner'/);
    assert.match(DOCS_SURFACE_SPEC, /\/docs\/build-your-own-runner/);
    assert.match(PAGE_SPEC, /\/docs\/build-your-own-runner/);
  });

  it('AT-BYR-002: documents the real runner-interface sequence and operation names', () => {
    for (const symbol of [
      'loadContext',
      'loadState',
      'initRun',
      'reactivateRun',
      'assignTurn',
      'writeDispatchBundle',
      'getTurnStagingResultPath',
      'acceptTurn',
      'rejectTurn',
      'approvePhaseGate',
      'approveCompletionGate',
    ]) {
      assert.ok(PAGE.includes(symbol), `page must mention ${symbol}`);
      assert.ok(RUNNER_INTERFACE.includes(symbol), `runner-interface.js must export or define ${symbol}`);
    }

    assert.match(PAGE, /Step 2: Load context and state/);
    assert.match(PAGE, /Step 3: Initialize or reactivate the run/);
    assert.match(PAGE, /Step 4: Assign a turn/);
    assert.match(PAGE, /Step 5: Dispatch work and stage the result/);
    assert.match(PAGE, /Step 6: Accept or reject the staged result/);
    assert.match(PAGE, /Step 7: Handle gates truthfully/);
  });

  it('AT-BYR-003: distinguishes primitive and composition proof tiers in the right order', () => {
    for (const doc of [PAGE, README]) {
      assert.match(doc, /examples\/ci-runner-proof\/run-one-turn\.mjs|run-one-turn\.mjs/);
      assert.match(doc, /examples\/ci-runner-proof\/run-to-completion\.mjs|run-to-completion\.mjs/);
      assert.match(doc, /examples\/ci-runner-proof\/run-with-run-loop\.mjs|run-with-run-loop\.mjs/);
      assert.match(doc, /single-turn primitive/i);
      assert.match(doc, /full lifecycle primitive|pm -> dev -> qa|pm → dev → qa/i);
      assert.match(doc, /runLoop|composition/i);
    }

    assert.match(PAGE, /Start with Tier 1\./);
    assert.match(PAGE, /If Tier 1 is not stable, Tier 3 will only hide your defects/);
  });

  it('AT-BYR-004: documents real failure traps and canonical staging-path truth', () => {
    assert.match(PAGE, /agentxchain\/runner-interface/);
    assert.match(PAGE, /getTurnStagingResultPath\(turn\.turn_id\)/);
    assert.match(PAGE, /acceptTurn\(\).*dispatch.*staging/i);
    assert.match(PAGE, /shelling out to `agentxchain step`|CLI wrapper|wrapped the CLI/i);

    for (const doc of [README, PAGE_SPEC]) {
      assert.match(doc, /agentxchain\/runner-interface|runner-interface\.js/);
      assert.match(doc, /getTurnStagingResultPath\(turn\.turn_id\)/);
      assert.match(doc, /acceptTurn\(\).*dispatch.*staging/i);
      assert.match(doc, /shelling out to `agentxchain step`|CLI wrapper|wrapped the CLI/i);
    }
  });

  it('AT-BYR-005: runner-adoption surfaces link to the tutorial', () => {
    assert.match(RUNNER_INTERFACE_PAGE, /\/docs\/build-your-own-runner/);
    assert.match(QUICKSTART_DOCS, /\/docs\/build-your-own-runner/);
    assert.match(ROOT_README, /https:\/\/agentxchain\.dev\/docs\/build-your-own-runner\//);
    assert.match(CLI_README, /https:\/\/agentxchain\.dev\/docs\/build-your-own-runner\//);
    assert.match(README, /https:\/\/agentxchain\.dev\/docs\/build-your-own-runner\//);
  });
});
