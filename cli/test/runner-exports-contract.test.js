import { strict as assert } from 'node:assert';
import { describe, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = join(__dirname, '..');
const REPO_ROOT = join(CLI_ROOT, '..');

const PKG = JSON.parse(readFileSync(join(CLI_ROOT, 'package.json'), 'utf8'));
const RUNNER_INTERFACE_SRC = readFileSync(
  join(CLI_ROOT, 'src', 'lib', 'runner-interface.js'),
  'utf8',
);
const RUN_LOOP_SRC = readFileSync(
  join(CLI_ROOT, 'src', 'lib', 'run-loop.js'),
  'utf8',
);
const TUTORIAL_PAGE = readFileSync(
  join(REPO_ROOT, 'website-v2', 'docs', 'build-your-own-runner.mdx'),
  'utf8',
);
const RUNNER_INTERFACE_PAGE = readFileSync(
  join(REPO_ROOT, 'website-v2', 'docs', 'runner-interface.mdx'),
  'utf8',
);

describe('Runner package exports contract', () => {
  it('AT-EXPORT-001: package.json declares runner-interface and run-loop exports', () => {
    assert.ok(PKG.exports, 'package.json must have an exports field');
    assert.ok(
      PKG.exports['./runner-interface'],
      'must export ./runner-interface',
    );
    assert.ok(PKG.exports['./run-loop'], 'must export ./run-loop');

    // Export paths must point to real source files
    assert.match(
      PKG.exports['./runner-interface'],
      /runner-interface\.js$/,
      'runner-interface export must point to runner-interface.js',
    );
    assert.match(
      PKG.exports['./run-loop'],
      /run-loop\.js$/,
      'run-loop export must point to run-loop.js',
    );
  });

  it('AT-EXPORT-002: exported files exist and contain expected symbols', () => {
    // runner-interface.js must export the documented lifecycle operations
    const requiredExports = [
      'loadContext',
      'loadState',
      'initRun',
      'assignTurn',
      'acceptTurn',
      'rejectTurn',
      'approvePhaseGate',
      'approveCompletionGate',
      'RUNNER_INTERFACE_VERSION',
    ];
    for (const sym of requiredExports) {
      assert.ok(
        RUNNER_INTERFACE_SRC.includes(sym),
        `runner-interface.js must export ${sym}`,
      );
    }

    // run-loop.js must export runLoop
    assert.match(RUN_LOOP_SRC, /export\s+(?:async\s+)?function\s+runLoop/);
  });

  it('AT-EXPORT-003: docs use package export paths, not relative source paths', () => {
    // Tutorial must use agentxchain/runner-interface, not ../cli/src/lib/
    assert.match(
      TUTORIAL_PAGE,
      /from\s+['"]agentxchain\/runner-interface['"]/,
      'tutorial must use agentxchain/runner-interface import path',
    );
    assert.ok(
      !TUTORIAL_PAGE.includes("from '../cli/src/lib/runner-interface.js'"),
      'tutorial must not use relative path to runner-interface',
    );

    // Runner interface page must mention the package export
    assert.match(
      RUNNER_INTERFACE_PAGE,
      /agentxchain\/runner-interface/,
      'runner-interface page must mention the package export path',
    );
    assert.match(
      RUNNER_INTERFACE_PAGE,
      /agentxchain\/run-loop/,
      'runner-interface page must mention the run-loop package export path',
    );
  });

  it('AT-EXPORT-004: docs include installation instructions', () => {
    assert.match(
      TUTORIAL_PAGE,
      /npm install agentxchain/,
      'tutorial must include npm install instruction',
    );
    assert.match(
      RUNNER_INTERFACE_PAGE,
      /npm install agentxchain/,
      'runner-interface page must include npm install instruction',
    );
  });

  it('AT-EXPORT-005: tutorial documents return value contracts', () => {
    assert.match(
      TUTORIAL_PAGE,
      /Return value contracts/i,
      'tutorial must have return value section',
    );
    // Key return shapes must be documented
    assert.match(TUTORIAL_PAGE, /ok: true, state, turn/);
    assert.match(TUTORIAL_PAGE, /ok: false, error/);
    assert.match(TUTORIAL_PAGE, /loadContext.*null/i);
    assert.match(TUTORIAL_PAGE, /loadState.*null/i);
  });

  it('AT-EXPORT-006: package.json type is module (required for ESM exports)', () => {
    assert.equal(PKG.type, 'module', 'package must be type: module');
  });
});
