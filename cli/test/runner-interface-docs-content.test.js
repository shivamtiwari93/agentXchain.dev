import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

const read = (rel) => readFileSync(join(REPO_ROOT, rel), 'utf8');

const PAGE_PATH = 'website-v2/docs/runner-interface.mdx';
const PAGE = read(PAGE_PATH);
const SIDEBARS = read('website-v2/sidebars.ts');
const CLI_DOCS = read('website-v2/docs/cli.mdx');
const QUICKSTART_DOCS = read('website-v2/docs/quickstart.mdx');
const PROTOCOL_DOCS = read('website-v2/docs/protocol.mdx');
const DOCS_SURFACE_SPEC = read('.planning/DOCS_SURFACE_SPEC.md');
const PAGE_SPEC = read('.planning/RUNNER_INTERFACE_DOC_PAGE_SPEC.md');
const RUNNER_INTERFACE_SPEC = read('.planning/RUNNER_INTERFACE_SPEC.md');
const RUNNER_INTERFACE = read('cli/src/lib/runner-interface.js');

describe('Runner interface docs surface', () => {
  it('AT-RID-001: ships the page source, planning spec, and sidebar entry', () => {
    assert.ok(existsSync(join(REPO_ROOT, PAGE_PATH)), 'runner interface docs page must exist');
    assert.ok(
      existsSync(join(REPO_ROOT, '.planning/RUNNER_INTERFACE_DOC_PAGE_SPEC.md')),
      'runner interface docs page spec must exist',
    );
    assert.match(SIDEBARS, /'runner-interface'/);
    assert.match(DOCS_SURFACE_SPEC, /\/docs\/runner-interface/);
    assert.match(PAGE_SPEC, /\/docs\/runner-interface/);
  });

  it('AT-RID-002: documents the real runner-interface exports and versioning', () => {
    for (const symbol of [
      'RUNNER_INTERFACE_VERSION',
      '0.2',
      'loadContext',
      'loadState',
      'initRun',
      'reactivateRun',
      'assignTurn',
      'acceptTurn',
      'rejectTurn',
      'approvePhaseGate',
      'approveCompletionGate',
      'markRunBlocked',
      'escalate',
      'writeDispatchBundle',
      'getTurnStagingResultPath',
      'runHooks',
      'emitNotifications',
      'acquireLock',
      'releaseLock',
      'getActiveTurns',
      'getActiveTurnCount',
      'getActiveTurn',
      'getMaxConcurrentTurns',
    ]) {
      assert.ok(PAGE.includes(symbol), `page must mention ${symbol}`);
      assert.ok(RUNNER_INTERFACE.includes(symbol), `runner-interface.js must export or define ${symbol}`);
    }
  });

  it('AT-RID-003: links to the shipped CI runner proof', () => {
    assert.match(PAGE, /examples\/ci-runner-proof\/run-one-turn\.mjs/);
    assert.match(PAGE, /examples\/ci-runner-proof\/run-to-completion\.mjs/);
    assert.match(PAGE, /\.github\/workflows\/ci-runner-proof\.yml/);
    assert.match(PAGE, /runLoop/);
    assert.match(PAGE, /does not replace these primitive proofs/);
  });

  it('AT-RID-004: CLI, quickstart, and protocol docs link to the runner page', () => {
    assert.match(CLI_DOCS, /\/docs\/runner-interface/);
    assert.match(QUICKSTART_DOCS, /\/docs\/runner-interface/);
    assert.match(PROTOCOL_DOCS, /\/docs\/runner-interface/);
  });

  it('AT-RID-005: docs and specs use the real dispatch signature and cleanup semantics', () => {
    for (const doc of [PAGE, PAGE_SPEC, RUNNER_INTERFACE_SPEC]) {
      assert.match(
        doc,
        /writeDispatchBundle\(root, state, config, opts\?\)/,
        'writeDispatchBundle signature must match the shipped API',
      );
    }

    assert.match(
      PAGE,
      /`acceptTurn\(\)` is destructive for transient turn artifacts\./,
      'public docs must warn that acceptTurn removes transient turn artifacts',
    );
    assert.match(
      PAGE_SPEC,
      /acceptTurn\(\).*dispatch and staging directories after commit/,
      'page spec must require the cleanup note',
    );
    assert.match(
      RUNNER_INTERFACE_SPEC,
      /\.agentxchain\/dispatch\/turns\/<turn_id>\//,
      'runner interface spec must use the real dispatch bundle path',
    );
    assert.match(
      RUNNER_INTERFACE_SPEC,
      /\.agentxchain\/staging\/<turn_id>\/turn-result\.json/,
      'runner interface spec must use the real staging path',
    );
    assert.match(
      RUNNER_INTERFACE_SPEC,
      /removes both `\.agentxchain\/dispatch\/turns\/<turn_id>\/` and `\.agentxchain\/staging\/<turn_id>\/`/,
      'runner interface spec must describe acceptTurn cleanup semantics',
    );
  });
});
