import { strict as assert } from 'node:assert';
import { describe, it, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { scaffoldGoverned } from '../src/commands/init.js';
import { loadProjectContext } from '../src/lib/config.js';
import {
  STATE_PATH,
  HISTORY_PATH,
  STAGING_PATH,
  acceptGovernedTurn,
  assignGovernedTurn,
  initializeGovernedRun,
  normalizeGovernedStateShape,
} from '../src/lib/governed-state.js';

const dirs = [];

function readJson(dir, relPath) {
  const parsed = JSON.parse(readFileSync(join(dir, relPath), 'utf8'));
  if (relPath.endsWith('state.json')) {
    return normalizeGovernedStateShape(parsed).state;
  }
  return parsed;
}

function readJsonl(dir, relPath) {
  const raw = readFileSync(join(dir, relPath), 'utf8').trim();
  if (!raw) return [];
  return raw.split('\n').map((line) => JSON.parse(line));
}

function writeJson(filePath, value) {
  writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function makeProject() {
  const dir = mkdtempSync(join(tmpdir(), 'axc-timeout-state-'));
  dirs.push(dir);
  scaffoldGoverned(dir, 'Timeout Fixture', 'timeout-fixture');
  mkdirSync(join(dir, '.agentxchain', 'staging'), { recursive: true });
  return dir;
}

function loadContext(dir) {
  const context = loadProjectContext(dir);
  assert.ok(context, 'expected governed project context');
  return context;
}

function stageTurnResult(dir, state, overrides = {}) {
  const turn = Object.values(state.active_turns || {})[0];
  assert.ok(turn, 'expected an active turn');
  const result = {
    schema_version: '1.0',
    run_id: state.run_id,
    turn_id: turn.turn_id,
    role: turn.assigned_role,
    runtime_id: turn.runtime_id,
    status: 'completed',
    summary: 'Timeout fixture accepted work.',
    decisions: [{ id: 'DEC-101', category: 'implementation', statement: 'Preserve accepted work after timeout.', rationale: 'Timeout is governance, not validation.' }],
    objections: [{ id: 'OBJ-101', severity: 'low', statement: 'No additional objection.', status: 'raised' }],
    files_changed: [],
    artifacts_created: [],
    verification: {
      status: 'pass',
      commands: ['echo ok'],
      evidence_summary: 'Fixture verification passed.',
      machine_evidence: [{ command: 'echo ok', exit_code: 0 }],
    },
    artifact: { type: 'review', ref: null },
    proposed_next_role: 'pm',
    phase_transition_request: null,
    run_completion_request: false,
    needs_human_reason: null,
    cost: { input_tokens: 100, output_tokens: 50, usd: 0.01 },
    ...overrides,
  };
  writeJson(join(dir, STAGING_PATH), result);
}

afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop();
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {}
  }
});

describe('timeout governed-state integration', () => {
  it('stamps created_at and phase_entered_at on run start and refreshes phase_entered_at on phase advance', () => {
    const dir = makeProject();
    const configPath = join(dir, 'agentxchain.json');
    const rawConfig = JSON.parse(readFileSync(configPath, 'utf8'));
    rawConfig.routing.planning.exit_gate = null;
    writeJson(configPath, rawConfig);
    const context = loadContext(dir);

    const init = initializeGovernedRun(dir, context.config);
    assert.ok(init.ok, init.error);
    assert.match(init.state.created_at, /T/);
    assert.equal(init.state.phase_entered_at, init.state.created_at);

    const assign = assignGovernedTurn(dir, context.config, 'pm');
    assert.ok(assign.ok, assign.error);
    const assignedState = readJson(dir, STATE_PATH);
    writeJson(join(dir, STATE_PATH), {
      ...assignedState,
      phase_entered_at: '2026-04-01T00:00:00.000Z',
    });

    writeFileSync(join(dir, '.planning', 'PM_SIGNOFF.md'), '# PM Signoff\n\nApproved: YES\n');
    writeFileSync(join(dir, '.planning', 'ROADMAP.md'), '# Roadmap\n\n## Scope\n\nTimeout proof.\n');
    writeFileSync(join(dir, '.planning', 'SYSTEM_SPEC.md'), '# System Spec\n\n## Purpose\n\nProve timeout timestamps.\n');

    stageTurnResult(dir, readJson(dir, STATE_PATH), {
      phase_transition_request: 'implementation',
      proposed_next_role: 'pm',
    });

    const accepted = acceptGovernedTurn(dir, context.config);
    assert.ok(accepted.ok, accepted.error);
    assert.equal(accepted.state.status, 'active');
    assert.equal(accepted.state.phase, 'implementation');
    assert.notEqual(accepted.state.phase_entered_at, '2026-04-01T00:00:00.000Z');
  });

  it('accepts work before blocking the run on a timed-out turn', () => {
    const dir = makeProject();
    const configPath = join(dir, 'agentxchain.json');
    const rawConfig = JSON.parse(readFileSync(configPath, 'utf8'));
    rawConfig.timeouts = { per_turn_minutes: 1, action: 'escalate' };
    writeJson(configPath, rawConfig);

    const context = loadContext(dir);
    const init = initializeGovernedRun(dir, context.config);
    assert.ok(init.ok, init.error);
    const assign = assignGovernedTurn(dir, context.config, 'pm');
    assert.ok(assign.ok, assign.error);

    const statePath = join(dir, STATE_PATH);
    const assignedState = readJson(dir, STATE_PATH);
    const [turnId] = Object.keys(assignedState.active_turns);
    writeJson(statePath, {
      ...assignedState,
      active_turns: {
        ...assignedState.active_turns,
        [turnId]: {
          ...assignedState.active_turns[turnId],
          started_at: '2026-04-10T00:00:00.000Z',
        },
      },
    });

    const timedOutState = readJson(dir, STATE_PATH);
    stageTurnResult(dir, timedOutState);
    const accepted = acceptGovernedTurn(dir, context.config);
    assert.ok(accepted.ok, accepted.error);
    assert.equal(accepted.state.status, 'blocked');
    assert.equal(accepted.state.blocked_on, 'timeout:turn');
    assert.equal(accepted.state.blocked_reason.category, 'timeout');
    assert.equal(accepted.state.blocked_reason.recovery.typed_reason, 'timeout');

    const history = readJsonl(dir, HISTORY_PATH);
    assert.equal(history.length, 1);
    assert.equal(history[0].turn_id, turnId);
    assert.equal(Object.keys(accepted.state.active_turns || {}).length, 0);
  });
});
