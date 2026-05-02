/**
 * BUG-19 beta-tester scenario: after accepting a turn that satisfies a
 * previously-failing gate, `last_gate_failure` is cleared.
 *
 * Tester sequence:
 *   1. Scaffold project with a file-existence gate (planning_signoff requires
 *      .planning/PM_SIGNOFF.md)
 *   2. Start run, attempt phase advance — gate fails (file missing)
 *   3. Assign PM turn, create the signoff file, accept the turn
 *   4. Verify: status --json no longer shows last_gate_failure
 */

import { describe, it, afterEach } from 'vitest';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { execSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  initializeGovernedRun,
  assignGovernedTurn,
  acceptGovernedTurn,
  normalizeGovernedStateShape,
} from '../../src/lib/governed-state.js';
import { writeDispatchBundle } from '../../src/lib/dispatch-bundle.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(__dirname, '..', '..', 'bin', 'agentxchain.js');
const tempDirs = [];

function runCli(root, args) {
  return spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd: root, encoding: 'utf8', timeout: 30_000,
    env: { ...process.env, NO_COLOR: '1' },
  });
}

function createProjectWithGate() {
  const root = mkdtempSync(join(tmpdir(), 'axc-bug19-'));
  tempDirs.push(root);

  mkdirSync(join(root, '.agentxchain', 'staging'), { recursive: true });
  mkdirSync(join(root, '.planning'), { recursive: true });

  const config = {
    schema_version: '1.0',
    protocol_mode: 'governed',
    template: 'generic',
    project: { id: 'bug19-test', name: 'BUG-19 Test', default_branch: 'main' },
    roles: {
      pm: {
        title: 'PM',
        mandate: 'Plan the project.',
        write_authority: 'review_only',
        runtime: 'manual-pm',
      },
    },
    runtimes: {
      'manual-pm': { type: 'manual' },
    },
    routing: {
      planning: {
        entry_role: 'pm',
        allowed_next_roles: ['pm'],
        exit_gate: 'planning_signoff',
      },
      implementation: {
        entry_role: 'pm',
        allowed_next_roles: ['pm'],
      },
    },
    gates: {
      planning_signoff: {
        requires_files: ['.planning/PM_SIGNOFF.md'],
      },
    },
  };

  writeFileSync(join(root, 'agentxchain.json'), JSON.stringify(config, null, 2));

  execSync('git init && git config user.email "test@test.com" && git config user.name "Test"', {
    cwd: root, stdio: 'ignore',
  });
  execSync('git add -A && git commit -m "init"', { cwd: root, stdio: 'ignore' });

  return { root, config };
}

function readState(root) {
  const raw = JSON.parse(readFileSync(join(root, '.agentxchain/state.json'), 'utf8'));
  return normalizeGovernedStateShape(raw).state;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    try { rmSync(tempDirs.pop(), { recursive: true, force: true }); } catch {}
  }
});

describe('BUG-19 beta-tester scenario: gate reconciliation after acceptance', () => {
  it('last_gate_failure is cleared when accepted turn creates the required gate file', () => {
    const { root, config } = createProjectWithGate();

    // 1. Initialize run
    const initResult = initializeGovernedRun(root, config);
    assert.ok(initResult.ok, `Init failed: ${initResult.error}`);

    // 2. Seed a gate failure in state (simulates what happens when
    //    approve-transition fails because PM_SIGNOFF.md is missing)
    let state = readState(root);
    state.last_gate_failure = {
      gate_id: 'planning_signoff',
      gate_type: 'phase_transition',
      missing_files: ['.planning/PM_SIGNOFF.md'],
      missing_verification: false,
      reasons: ['Required file .planning/PM_SIGNOFF.md does not exist.'],
      failed_at: new Date().toISOString(),
    };
    writeFileSync(
      join(root, '.agentxchain', 'state.json'),
      JSON.stringify(state, null, 2),
    );

    // 3. Assign PM turn
    const assignResult = assignGovernedTurn(root, config, 'pm');
    assert.ok(assignResult.ok, `Assign failed: ${assignResult.error}`);

    const turnId = assignResult.turn.turn_id;

    // Write dispatch bundle
    const stateAfterAssign = readState(root);
    writeDispatchBundle(root, stateAfterAssign, config, { turnId });

    // 4. PM creates the missing signoff file
    writeFileSync(
      join(root, '.planning', 'PM_SIGNOFF.md'),
      '# PM Signoff\n\nApproved: YES\n',
    );

    // 5. Stage turn result
    const turnResultPath = join(root, '.agentxchain', 'staging', 'turn-result.json');
    writeFileSync(turnResultPath, JSON.stringify({
      schema_version: '1.0',
      run_id: stateAfterAssign.run_id,
      turn_id: turnId,
      role: 'pm',
      runtime_id: 'manual-pm',
      status: 'completed',
      summary: 'Created PM signoff file for planning gate.',
      decisions: [],
      objections: [{ id: 'OBJ-1', target: 'process', statement: 'Gate reconciliation', severity: 'low' }],
      files_changed: ['.planning/PM_SIGNOFF.md'],
      verification: { status: 'skipped' },
      artifact: { type: 'review', ref: null },
      proposed_next_role: 'pm',
    }, null, 2));

    // Commit so acceptance can diff
    execSync('git add -A && git commit -m "pm signoff"', { cwd: root, stdio: 'ignore' });

    // 6. Accept the turn
    const acceptResult = acceptGovernedTurn(root, config, {
      turnId,
      resultPath: turnResultPath,
    });
    assert.ok(acceptResult.ok, `Accept failed: ${acceptResult.error}`);

    // 7. KEY ASSERTION: last_gate_failure must be cleared
    const stateAfter = readState(root);
    assert.strictEqual(
      stateAfter.last_gate_failure,
      null,
      `last_gate_failure should be null after accepted turn satisfies the gate. ` +
      `Still shows: ${JSON.stringify(stateAfter.last_gate_failure)}`,
    );
  });
});
