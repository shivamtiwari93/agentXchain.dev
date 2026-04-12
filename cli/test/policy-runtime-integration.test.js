import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { scaffoldGoverned } from '../src/commands/init.js';
import { loadProjectContext } from '../src/lib/config.js';
import { acceptGovernedTurn, assignGovernedTurn, initializeGovernedRun } from '../src/lib/governed-state.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function makeProject(policy) {
  const dir = mkdtempSync(join(tmpdir(), 'agentxchain-policy-runtime-'));
  scaffoldGoverned(dir, 'Policy Runtime Fixture', 'policy-runtime-fixture');
  mkdirSync(join(dir, '.agentxchain', 'staging'), { recursive: true });

  const configPath = join(dir, 'agentxchain.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  config.policies = [policy];
  writeFileSync(configPath, JSON.stringify(config, null, 2));
  return dir;
}

function writeTurnResult(dir, turn, runId, cost, verificationOverrides = {}) {
  const result = {
    schema_version: '1.0',
    run_id: runId,
    turn_id: turn.turn_id,
    role: turn.assigned_role,
    runtime_id: turn.runtime_id,
    status: 'completed',
    summary: 'Runtime integration fixture turn completed.',
    decisions: [{ id: 'DEC-001', category: 'implementation', statement: 'Fixture decision.', rationale: 'Integration proof.' }],
    objections: [{ id: 'OBJ-001', severity: 'low', statement: 'No blocker.', status: 'raised' }],
    files_changed: [],
    artifacts_created: [],
    verification: {
      status: 'pass',
      commands: ['echo ok'],
      evidence_summary: 'Fixture verification passed.',
      machine_evidence: [{ command: 'echo ok', exit_code: 0 }],
      ...verificationOverrides,
    },
    artifact: { type: 'review', ref: null },
    proposed_next_role: 'pm',
    phase_transition_request: null,
    run_completion_request: false,
    needs_human_reason: null,
    cost,
  };
  writeFileSync(join(dir, '.agentxchain', 'staging', 'turn-result.json'), JSON.stringify(result, null, 2));
}

describe('policy runtime integration', () => {
  it('enforces max_cost_per_turn from cost.usd during acceptance', () => {
    const dir = makeProject({
      id: 'turn-cost-cap',
      rule: 'max_cost_per_turn',
      params: { limit_usd: 0.01 },
      action: 'block',
    });

    try {
      const context = loadProjectContext(dir);
      assert.ok(context, 'expected project context');
      const init = initializeGovernedRun(dir, context.config);
      assert.ok(init.ok, init.error);
      const assign = assignGovernedTurn(dir, context.config, 'pm');
      assert.ok(assign.ok, assign.error);
      const turn = Object.values(assign.state.active_turns || {})[0];
      assert.ok(turn, 'expected turn assignment');

      writeTurnResult(dir, turn, assign.state.run_id, { usd: 0.02, input_tokens: 1, output_tokens: 1 });
      const result = acceptGovernedTurn(dir, context.config);
      assert.equal(result.ok, false);
      assert.equal(result.error_code, 'policy_violation');
      assert.match(result.error, /turn cost \$0\.02 exceeds limit \$0\.01/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('accepts legacy cost.total_usd for compatibility', () => {
    const dir = makeProject({
      id: 'turn-cost-cap',
      rule: 'max_cost_per_turn',
      params: { limit_usd: 0.01 },
      action: 'block',
    });

    try {
      const context = loadProjectContext(dir);
      assert.ok(context, 'expected project context');
      const init = initializeGovernedRun(dir, context.config);
      assert.ok(init.ok, init.error);
      const assign = assignGovernedTurn(dir, context.config, 'pm');
      assert.ok(assign.ok, assign.error);
      const turn = Object.values(assign.state.active_turns || {})[0];
      assert.ok(turn, 'expected turn assignment');

      writeTurnResult(dir, turn, assign.state.run_id, { total_usd: 0.02, input_tokens: 1, output_tokens: 1 });
      const result = acceptGovernedTurn(dir, context.config);
      assert.equal(result.ok, false);
      assert.equal(result.error_code, 'policy_violation');
      assert.match(result.error, /turn cost \$0\.02 exceeds limit \$0\.01/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('AT-RVP-004: blocks acceptance when reproducible verification policy has no machine evidence', () => {
    const dir = makeProject({
      id: 'replay-proof',
      rule: 'require_reproducible_verification',
      action: 'block',
    });

    try {
      const context = loadProjectContext(dir);
      assert.ok(context, 'expected project context');
      const init = initializeGovernedRun(dir, context.config);
      assert.ok(init.ok, init.error);
      const assign = assignGovernedTurn(dir, context.config, 'pm');
      assert.ok(assign.ok, assign.error);
      const turn = Object.values(assign.state.active_turns || {})[0];
      assert.ok(turn, 'expected turn assignment');

      writeTurnResult(dir, turn, assign.state.run_id, { usd: 0.001 }, {
        machine_evidence: [],
        commands: ['npm test'],
        evidence_summary: 'Narrative only.',
      });
      const result = acceptGovernedTurn(dir, context.config);
      assert.equal(result.ok, false);
      assert.equal(result.error_code, 'policy_violation');
      assert.match(result.error, /machine_evidence/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('AT-RVP-005: blocks acceptance when reproducible verification replay mismatches', () => {
    const dir = makeProject({
      id: 'replay-proof',
      rule: 'require_reproducible_verification',
      action: 'block',
    });

    try {
      const context = loadProjectContext(dir);
      assert.ok(context, 'expected project context');
      const init = initializeGovernedRun(dir, context.config);
      assert.ok(init.ok, init.error);
      const assign = assignGovernedTurn(dir, context.config, 'pm');
      assert.ok(assign.ok, assign.error);
      const turn = Object.values(assign.state.active_turns || {})[0];
      assert.ok(turn, 'expected turn assignment');

      writeTurnResult(dir, turn, assign.state.run_id, { usd: 0.001 }, {
        machine_evidence: [{ command: 'node -e "process.exit(1)"', exit_code: 0 }],
        evidence_summary: 'False positive fixture.',
      });
      const result = acceptGovernedTurn(dir, context.config);
      assert.equal(result.ok, false);
      assert.equal(result.error_code, 'policy_violation');
      assert.match(result.error, /commands matched declared exit codes/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('AT-RVP-006: accepts and records replay summary when reproducible verification matches', () => {
    const dir = makeProject({
      id: 'replay-proof',
      rule: 'require_reproducible_verification',
      action: 'block',
    });

    try {
      const context = loadProjectContext(dir);
      assert.ok(context, 'expected project context');
      const init = initializeGovernedRun(dir, context.config);
      assert.ok(init.ok, init.error);
      const assign = assignGovernedTurn(dir, context.config, 'pm');
      assert.ok(assign.ok, assign.error);
      const turn = Object.values(assign.state.active_turns || {})[0];
      assert.ok(turn, 'expected turn assignment');

      writeTurnResult(dir, turn, assign.state.run_id, { usd: 0.001 }, {
        machine_evidence: [{ command: 'node -e "process.exit(0)"', exit_code: 0 }],
        evidence_summary: 'Executable proof recorded.',
      });
      const result = acceptGovernedTurn(dir, context.config);
      assert.equal(result.ok, true, result.error);
      assert.equal(result.accepted?.verification_replay?.overall, 'match');
      assert.equal(result.accepted?.verification_replay?.replayed_commands, 1);
      assert.match(result.accepted?.verification_replay?.verified_at || '', /^\d{4}-\d{2}-\d{2}T/);
      assert.equal(result.verification_replay?.matched_commands, 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
