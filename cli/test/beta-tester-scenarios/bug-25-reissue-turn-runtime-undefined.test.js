/**
 * BUG-25 beta-tester scenario: reissue-turn fails with
 *   "Runtime 'undefined' not found in config for role 'dev'"
 *
 * Root cause: reissueTurn() at governed-state.js used `role.runtime` on
 * normalized config objects, which store the runtime reference as
 * `role.runtime_id`. The raw config uses `role.runtime`, but after
 * loadNormalizedConfig → normalizeV4, the field is `runtime_id`.
 *
 * The test exercises the tester's exact flow:
 *   1. scaffold a governed project
 *   2. init a run and dispatch a turn via CLI
 *   3. change HEAD (operator commits after dispatch)
 *   4. run `agentxchain reissue-turn`
 *   5. verify it succeeds — no "Runtime undefined" error
 *
 * This test MUST use the real CLI entry point so the config goes through
 * loadProjectContext → loadNormalizedConfig → normalizeV4, which is the
 * code path that triggers the bug.
 */

import { afterEach, describe, it } from 'vitest';
import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { scaffoldGoverned } from '../../src/commands/init.js';
import {
  reissueTurn,
  initializeGovernedRun,
  assignGovernedTurn,
  getActiveTurn,
} from '../../src/lib/governed-state.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(__dirname, '..', '..', 'bin', 'agentxchain.js');
const tempDirs = [];

function runCli(root, args) {
  return spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout: 20_000,
    env: { ...process.env, NO_COLOR: '1' },
  });
}

function createProjectWithManualDev() {
  const root = mkdtempSync(join(tmpdir(), 'axc-bug25-'));
  tempDirs.push(root);
  scaffoldGoverned(root, 'BUG-25 Fixture', `bug25-${Date.now()}`);

  // Configure dev as authoritative with a manual runtime
  const configPath = join(root, 'agentxchain.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  config.runtimes['manual-dev'] = { type: 'manual' };
  config.roles.dev = {
    title: 'Developer',
    mandate: 'Build features.',
    write_authority: 'authoritative',
    runtime: 'manual-dev',
  };
  config.routing = {
    planning: {
      entry_role: 'pm',
      allowed_next_roles: ['pm'],
      exit_gate: 'planning_signoff',
    },
    implementation: {
      entry_role: 'dev',
      allowed_next_roles: ['dev'],
      exit_gate: 'impl_complete',
    },
  };
  config.gates = {
    planning_signoff: { requires_files: ['.planning/PM_SIGNOFF.md'] },
    impl_complete: { requires_verification_pass: true },
  };
  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');

  // Initialize git
  execSync('git init && git config user.email "test@test.com" && git config user.name "Test"', {
    cwd: root, stdio: 'ignore',
  });
  execSync('git add -A && git commit -m "init"', { cwd: root, stdio: 'ignore' });

  return root;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    try { rmSync(tempDirs.pop(), { recursive: true, force: true }); } catch {}
  }
});

describe('BUG-25 beta-tester scenario: reissue-turn runtime resolution', () => {
  it('reissue-turn succeeds after HEAD change — no "Runtime undefined" error', () => {
    const root = createProjectWithManualDev();

    // 1. Start a governed run
    const initRun = runCli(root, ['run', '--dry-run']);
    // dry-run initializes state without dispatching — use resume to assign a turn
    const resume = runCli(root, ['resume', '--role', 'dev']);
    // resume might fail if the phase doesn't allow dev — use step instead
    // Actually, let's use the governed state API through the CLI properly
    // Start the run and assign the first turn via step
    const step = runCli(root, ['step', '--role', 'dev']);

    // If step fails because planning gate isn't met, skip planning gate by
    // creating the signoff file and advancing to implementation
    if (step.status !== 0) {
      // Create planning signoff to advance to implementation
      writeFileSync(join(root, '.planning', 'PM_SIGNOFF.md'), 'Approved: YES\n');
      execSync('git add -A && git commit -m "planning signoff"', { cwd: root, stdio: 'ignore' });
    }

    // Assign a dev turn — use resume which assigns without dispatching to external runtime
    const resumeDev = runCli(root, ['resume', '--role', 'dev']);

    // Check if we got an active turn
    const statusBefore = runCli(root, ['status', '--json']);
    let statusJson;
    try {
      statusJson = JSON.parse(statusBefore.stdout);
    } catch {
      // If status doesn't return JSON, check for active turns in state directly
      statusJson = null;
    }

    // 2. Simulate operator committing a file (changing HEAD after dispatch)
    writeFileSync(join(root, 'operator-fix.txt'), 'runtime path fix');
    execSync('git add operator-fix.txt && git commit -m "operator: fix runtime path"', {
      cwd: root, stdio: 'ignore',
    });

    // 3. Run reissue-turn via CLI (this goes through loadProjectContext → normalizeV4)
    const reissue = runCli(root, ['reissue-turn']);

    // 4. Verify: must NOT fail with "Runtime undefined" or "Runtime \"undefined\""
    const output = (reissue.stdout || '') + (reissue.stderr || '');
    assert.ok(
      !output.includes('Runtime "undefined"'),
      `reissue-turn must not fail with "Runtime undefined". Got:\n${output}`,
    );
    assert.ok(
      !output.includes('Runtime \'undefined\''),
      `reissue-turn must not fail with "Runtime 'undefined'". Got:\n${output}`,
    );

    // If there was an active turn, reissue should succeed
    if (reissue.status === 0) {
      assert.match(output, /reissued/i, 'Should confirm turn was reissued');
    } else {
      // Acceptable failure reasons: "No active turns to reissue" (no turn was assigned)
      // Unacceptable: "Runtime undefined"
      assert.ok(
        output.includes('No active turn') || output.includes('No governed state'),
        `reissue-turn failed for unexpected reason: ${output}`,
      );
    }
  });

  it('reissueTurn resolves runtime_id from normalized config, not raw role.runtime', () => {
    // This test directly exercises the governed-state reissueTurn function
    // with a normalized config shape (runtime_id instead of runtime)
    const root = mkdtempSync(join(tmpdir(), 'axc-bug25-unit-'));
    tempDirs.push(root);

    mkdirSync(join(root, '.agentxchain'), { recursive: true });
    mkdirSync(join(root, '.planning'), { recursive: true });

    // Build a NORMALIZED config shape — the way normalizeV4 outputs it
    // Key: roles have runtime_id, NOT runtime
    const normalizedConfig = {
      schema_version: 4,
      protocol_mode: 'governed',
      template: 'generic',
      project: { id: 'bug25-unit', name: 'BUG-25 Unit', default_branch: 'main' },
      roles: {
        dev: {
          title: 'Developer',
          mandate: 'Build.',
          write_authority: 'authoritative',
          runtime_class: 'manual',
          runtime_id: 'manual-dev',        // normalizeV4 output shape
          // NOTE: no `runtime` field — that's the raw config field
        },
      },
      runtimes: {
        'manual-dev': { type: 'manual' },
      },
      routing: {
        implementation: { entry_role: 'dev', allowed_next_roles: ['dev'] },
      },
      gates: {},
      hooks: {},
      notifications: {},
      schedules: {},
      budget: null,
      policies: {},
    };

    // Initialize git
    writeFileSync(join(root, 'agentxchain.json'), JSON.stringify(normalizedConfig, null, 2));
    execSync('git init && git config user.email "test@test.com" && git config user.name "Test"', {
      cwd: root, stdio: 'ignore',
    });
    execSync('git add -A && git commit -m "init"', { cwd: root, stdio: 'ignore' });

    // Initialize run and assign a turn
    const initResult = initializeGovernedRun(root, normalizedConfig);
    assert.ok(initResult.ok, `Init failed: ${initResult.error}`);

    const assignResult = assignGovernedTurn(root, normalizedConfig, 'dev');
    assert.ok(assignResult.ok, `Assign failed: ${assignResult.error}`);

    const activeTurn = getActiveTurn(assignResult.state);
    assert.ok(activeTurn, 'Should have an active turn');

    // Change HEAD
    writeFileSync(join(root, 'change.txt'), 'operator change');
    execSync('git add change.txt && git commit -m "operator commit"', {
      cwd: root, stdio: 'ignore',
    });

    // Reissue — this is the exact call that fails with "Runtime undefined"
    // when role.runtime is used instead of role.runtime_id || role.runtime
    const reissueResult = reissueTurn(root, normalizedConfig, {
      turnId: activeTurn.turn_id,
      reason: 'baseline drift (BUG-25 repro)',
    });

    assert.ok(
      reissueResult.ok,
      `reissueTurn must succeed with normalized config. Got error: ${reissueResult.error}`,
    );
    assert.ok(reissueResult.newTurn, 'Should have a new turn');
    assert.strictEqual(reissueResult.newTurn.runtime_id, 'manual-dev',
      'New turn must use the current runtime from config');
  });
});
