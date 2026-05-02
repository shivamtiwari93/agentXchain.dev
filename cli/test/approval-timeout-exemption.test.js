import { strict as assert } from 'node:assert';
import { describe, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { scaffoldGoverned } from '../src/commands/init.js';
import { loadProjectContext } from '../src/lib/config.js';
import {
  assignGovernedTurn,
  initializeGovernedRun,
  approvePhaseTransition,
  approveRunCompletion,
} from '../src/lib/governed-state.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(__dirname, '..', 'bin', 'agentxchain.js');

function writeJson(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2));
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function runCli(dir, args) {
  const result = spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
  return {
    status: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    combined: `${result.stdout || ''}${result.stderr || ''}`,
  };
}

/**
 * Build a governed project with aggressive timeouts and gates that require
 * human approval so we can reach pending_phase_transition / pending_run_completion.
 */
function makeProject() {
  const dir = mkdtempSync(join(tmpdir(), 'agentxchain-approval-timeout-'));
  scaffoldGoverned(dir, 'Approval Timeout Exemption', 'approval-timeout-exempt');
  mkdirSync(join(dir, '.agentxchain', 'staging'), { recursive: true });

  const configPath = join(dir, 'agentxchain.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));

  // Aggressive timeouts — all scopes exceeded immediately with backdated timestamps
  config.timeouts = {
    per_turn_minutes: 1,
    per_phase_minutes: 1,
    per_run_minutes: 1,
    action: 'escalate',
  };

  writeJson(configPath, config);
  return dir;
}

describe('approval-timeout exemption (DEC-APPROVAL-TIMEOUT-EXEMPT-001)', () => {
  it('AT-TIMEOUT-013: approve-transition succeeds even when all timeouts are exceeded', () => {
    const dir = makeProject();

    try {
      const context = loadProjectContext(dir);
      assert.ok(context, 'expected governed project context');

      const init = initializeGovernedRun(dir, context.config);
      assert.ok(init.ok, init.error);

      const statePath = join(dir, '.agentxchain', 'state.json');
      const pastDate = '2025-01-01T00:00:00.000Z';

      // Manually set up state as if the run reached a pending phase transition
      // with all timeouts exceeded
      const state = readJson(statePath);
      state.status = 'paused';
      state.blocked_on = 'human_approval:planning_signoff';
      state.created_at = pastDate;
      state.phase_entered_at = pastDate;
      state.pending_phase_transition = {
        from: 'planning',
        to: 'implementation',
        gate: 'planning_signoff',
        requested_by_turn: 'test-turn-001',
      };
      state.active_turns = {};
      writeJson(statePath, state);

      // approve-transition must succeed without timeout blocking
      const result = approvePhaseTransition(dir, context.config);
      assert.ok(result.ok, `approvePhaseTransition failed: ${result.error}`);
      assert.equal(result.state.phase, 'implementation', 'phase should have advanced');
      assert.equal(result.state.status, 'active', 'run should be active, not timeout-blocked');
      assert.equal(result.state.pending_phase_transition, null, 'pending should be cleared');

      // Also verify via CLI subprocess
      // Reset to pending state again for CLI test
      const state2 = readJson(statePath);
      state2.status = 'paused';
      state2.phase = 'planning';
      state2.blocked_on = 'human_approval:planning_signoff';
      state2.created_at = pastDate;
      state2.phase_entered_at = pastDate;
      state2.pending_phase_transition = {
        from: 'planning',
        to: 'implementation',
        gate: 'planning_signoff',
        requested_by_turn: 'test-turn-002',
      };
      writeJson(statePath, state2);

      const cliResult = runCli(dir, ['approve-transition']);
      assert.equal(cliResult.status, 0, `CLI approve-transition failed: ${cliResult.combined}`);

      const finalState = readJson(statePath);
      assert.equal(finalState.phase, 'implementation');
      assert.equal(finalState.status, 'active');
      assert.ok(!finalState.blocked_on || !finalState.blocked_on.startsWith('timeout:'),
        `should not be timeout-blocked after approve-transition, got: ${finalState.blocked_on}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('AT-TIMEOUT-014: approve-completion succeeds even when all timeouts are exceeded', () => {
    const dir = makeProject();

    try {
      const context = loadProjectContext(dir);
      assert.ok(context, 'expected governed project context');

      const init = initializeGovernedRun(dir, context.config);
      assert.ok(init.ok, init.error);

      const statePath = join(dir, '.agentxchain', 'state.json');
      const pastDate = '2025-01-01T00:00:00.000Z';

      // Manually set up state as if the run reached pending_run_completion
      // with all timeouts exceeded
      const state = readJson(statePath);
      state.phase = 'implementation';
      state.status = 'paused';
      state.blocked_on = 'human_approval:completion_gate';
      state.created_at = pastDate;
      state.phase_entered_at = pastDate;
      state.pending_run_completion = {
        gate: 'completion_gate',
        requested_by_turn: 'test-turn-001',
        requested_at: pastDate,
      };
      state.active_turns = {};
      writeJson(statePath, state);

      // Library call
      const result = approveRunCompletion(dir, context.config);
      assert.ok(result.ok, `approveRunCompletion failed: ${result.error}`);
      assert.equal(result.state.status, 'completed', 'run should be completed');
      assert.equal(result.state.pending_run_completion, null, 'pending should be cleared');

      // Reset for CLI subprocess test
      const state2 = readJson(statePath);
      state2.status = 'paused';
      state2.blocked_on = 'human_approval:completion_gate';
      state2.created_at = pastDate;
      state2.phase_entered_at = pastDate;
      state2.pending_run_completion = {
        gate: 'completion_gate',
        requested_by_turn: 'test-turn-002',
        requested_at: pastDate,
      };
      state2.completed_at = null;
      writeJson(statePath, state2);

      const cliResult = runCli(dir, ['approve-completion']);
      assert.equal(cliResult.status, 0, `CLI approve-completion failed: ${cliResult.combined}`);

      const finalState = readJson(statePath);
      assert.equal(finalState.status, 'completed');
      assert.ok(!finalState.blocked_on || !finalState.blocked_on.startsWith('timeout:'),
        `should not be timeout-blocked after approve-completion, got: ${finalState.blocked_on}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
