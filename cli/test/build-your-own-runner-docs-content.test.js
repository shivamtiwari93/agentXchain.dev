import { strict as assert } from 'node:assert';
import { describe, it } from 'vitest';
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
const RUN_LOOP = read('cli/src/lib/run-loop.js');

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

  it('AT-BYR-002b: documented operations are real exports from runner-interface.js', async () => {
    // Fail-closed: import the actual module and verify each documented symbol is a real export
    const ri = await import('../src/lib/runner-interface.js');
    const documentedExports = [
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
    ];
    for (const name of documentedExports) {
      assert.ok(
        typeof ri[name] === 'function',
        `runner-interface must export "${name}" as a function, got ${typeof ri[name]}`,
      );
    }
  });

  it('AT-BYR-002c: documented adapter imports are real exports from adapter-interface.js', async () => {
    const ai = await import('../src/lib/adapter-interface.js');
    const documentedAdapterExports = [
      'dispatchLocalCli',
      'dispatchApiProxy',
      'dispatchMcp',
      'printManualDispatchInstructions',
      'waitForStagedResult',
      'readStagedResult',
    ];
    for (const name of documentedAdapterExports) {
      assert.ok(
        typeof ai[name] === 'function',
        `adapter-interface must export "${name}" as a function, got ${typeof ai[name]}`,
      );
    }
  });

  it('AT-BYR-002d: return value contracts table names match real exported functions', async () => {
    const ri = await import('../src/lib/runner-interface.js');
    // Extract function names from the return value contracts table
    const tableRows = PAGE.match(/\| `(\w+)\(/g) || [];
    const tableFunctions = tableRows.map((m) => m.match(/`(\w+)/)[1]);
    assert.ok(tableFunctions.length >= 9, `expected at least 9 table rows, got ${tableFunctions.length}`);
    for (const name of tableFunctions) {
      assert.ok(
        typeof ri[name] === 'function',
        `return value table references "${name}" but it is not a function export from runner-interface`,
      );
    }
  });

  it('AT-BYR-002e: Step 2 code example handles null returns from loadContext and loadState', () => {
    // The code example must include null/failure checks, not blind destructuring
    assert.match(PAGE, /if \(!ctx\)|if \(ctx === null\)|if \(!ctx\) throw/, 'Step 2 must guard against null loadContext');
    assert.match(PAGE, /if \(!state\)|if \(state === null\)|if \(!state\) throw/, 'Step 2 must guard against null loadState');
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

  it('AT-BYR-003b: documents the real runLoop callback contract and result fields', async () => {
    const runLoopModule = await import('../src/lib/run-loop.js');
    assert.equal(typeof runLoopModule.runLoop, 'function', 'run-loop export must be a function');
    assert.match(RUN_LOOP, /callbacks - \{ selectRole, dispatch, approveGate, onEvent\? \}/);

    for (const symbol of ['selectRole', 'dispatch', 'approveGate', 'onEvent', 'stop_reason', 'turns_executed']) {
      assert.match(PAGE, new RegExp(symbol), `page must document runLoop ${symbol}`);
    }

    assert.match(PAGE, /runLoop\(root, config, \{/);
    assert.match(PAGE, /return \{ accept: true, turnResult \}/);
    assert.match(PAGE, /return \{ accept: false, reason: /);
    assert.match(PAGE, /console\.log\(result\.stop_reason\)/);
    assert.match(PAGE, /console\.log\(result\.turns_executed\)/);
    assert.match(PAGE, /console\.log\(result\.state\.status\)/);
  });

  it('AT-BYR-004: documents real failure traps and canonical staging-path truth', () => {
    assert.match(PAGE, /agentxchain\/runner-interface/);
    assert.match(PAGE, /agentxchain\/adapter-interface/);
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

  it('AT-BYR-005a: documents both external-consumer starters (manual and adapter-backed)', () => {
    assert.match(PAGE, /run-one-turn\.mjs/);
    assert.match(PAGE, /run-adapter-turn\.mjs/);
    assert.match(PAGE, /dispatchLocalCli/);
    assert.match(PAGE, /Manual staging|runner-interface only/i);
    assert.match(PAGE, /Adapter-backed dispatch|adapter-interface/i);
  });

  it('AT-BYR-005b: external-consumer starter files exist at documented paths', () => {
    assert.ok(
      existsSync(join(REPO_ROOT, 'examples', 'external-runner-starter', 'run-one-turn.mjs')),
      'manual starter must exist',
    );
    assert.ok(
      existsSync(join(REPO_ROOT, 'examples', 'external-runner-starter', 'run-adapter-turn.mjs')),
      'adapter starter must exist',
    );
  });

  it('AT-BYR-005: runner-adoption surfaces link to the tutorial', () => {
    assert.match(RUNNER_INTERFACE_PAGE, /\/docs\/build-your-own-runner/);
    assert.match(QUICKSTART_DOCS, /\/docs\/build-your-own-runner/);
    assert.match(ROOT_README, /https:\/\/agentxchain\.dev\/docs\/build-your-own-runner\//);
    assert.match(CLI_README, /https:\/\/agentxchain\.dev\/docs\/build-your-own-runner\//);
    assert.match(README, /https:\/\/agentxchain\.dev\/docs\/build-your-own-runner\//);
  });

  it('AT-BYR-006: acceptTurn failure shape includes hook-blocked fields', () => {
    // The return value contracts table must document that acceptTurn failure can include
    // state and hookResults (from hook-blocked paths), not just error and validation
    assert.match(
      PAGE,
      /acceptTurn.*\{.*ok: false.*state\?.*hookResults\?/s,
      'acceptTurn failure shape must include state? and hookResults? for hook-blocked paths',
    );
  });
});
