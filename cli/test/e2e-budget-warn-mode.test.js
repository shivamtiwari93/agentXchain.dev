import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { scaffoldGoverned } from '../src/commands/init.js';
import { loadProjectContext } from '../src/lib/config.js';
import { assignGovernedTurn, initializeGovernedRun } from '../src/lib/governed-state.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const CLI_BIN = join(ROOT, 'cli', 'bin', 'agentxchain.js');
const SPEC = readFileSync(join(ROOT, '.planning', 'BUDGET_WARN_CLI_SURFACE_SPEC.md'), 'utf8');

function makeProject() {
  const dir = mkdtempSync(join(tmpdir(), 'agentxchain-budget-warn-e2e-'));
  scaffoldGoverned(dir, 'Budget Warn E2E', 'budget-warn-e2e');
  mkdirSync(join(dir, '.agentxchain', 'staging'), { recursive: true });
  return dir;
}

function runCli(dir, args) {
  const result = spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd: dir,
    encoding: 'utf8',
    timeout: 60000,
    env: { ...process.env, NO_COLOR: '1', NODE_NO_WARNINGS: '1' },
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    combined: `${result.stdout || ''}${result.stderr || ''}`,
  };
}

function writeTurnResult(dir, turn, runId, costUsd) {
  const result = {
    schema_version: '1.0',
    run_id: runId,
    turn_id: turn.turn_id,
    role: turn.assigned_role,
    runtime_id: turn.runtime_id,
    status: 'completed',
    summary: 'Budget warn fixture turn completed.',
    decisions: [{ id: 'DEC-001', category: 'implementation', statement: 'Warn mode continued past budget.', rationale: 'CLI proof.' }],
    objections: [{ id: 'OBJ-001', severity: 'low', statement: 'None.', status: 'raised' }],
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
    cost: { input_tokens: 100, output_tokens: 50, usd: costUsd },
  };

  writeFileSync(join(dir, '.agentxchain', 'staging', 'turn-result.json'), JSON.stringify(result, null, 2));
}

function parseJsonLines(text) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => line.startsWith('{'))
    .map((line) => JSON.parse(line));
}

describe('budget warn mode CLI surface', () => {
  it('AT-BWC-001/002/003/004/005: CLI surfaces warn-mode acceptance, status, config, events, and next assignment warnings', () => {
    const dir = makeProject();

    try {
      for (const args of [
        ['config', '--set', 'budget.per_run_max_usd', '5'],
        ['config', '--set', 'budget.per_turn_max_usd', '2'],
        ['config', '--set', 'budget.on_exceed', 'warn'],
      ]) {
        const result = runCli(dir, args);
        assert.equal(result.status, 0, result.combined);
      }

      const context = loadProjectContext(dir);
      assert.ok(context, 'expected governed project context');

      const init = initializeGovernedRun(dir, context.config);
      assert.ok(init.ok, init.error);

      const assign = assignGovernedTurn(dir, context.config, 'pm');
      assert.ok(assign.ok, assign.error);
      const turn = Object.values(assign.state.active_turns || {})[0];
      assert.ok(turn, 'expected an active turn');

      writeTurnResult(dir, turn, assign.state.run_id, 6.0);

      const accept = runCli(dir, ['accept-turn']);
      assert.equal(accept.status, 0, accept.combined);
      assert.match(accept.stdout, /Turn Accepted/);
      assert.match(accept.stdout, /Budget warning:\s+Budget exhausted:/);
      assert.match(accept.stdout, /Run continues in warn mode/);

      const statusText = runCli(dir, ['status']);
      assert.equal(statusText.status, 0, statusText.combined);
      assert.match(statusText.stdout, /Budget:\s+spent \$6\.00 \/ remaining \$-1\.00 \[OVER BUDGET\]/);
      assert.doesNotMatch(statusText.stdout, /Reason:\s+budget_exhausted/);

      const statusJson = runCli(dir, ['status', '--json']);
      assert.equal(statusJson.status, 0, statusJson.combined);
      const parsedStatus = JSON.parse(statusJson.stdout);
      assert.equal(parsedStatus.state.status, 'active');
      assert.equal(parsedStatus.state.blocked_on, null);
      assert.equal(parsedStatus.state.budget_status.warn_mode, true);
      assert.equal(parsedStatus.state.budget_status.exhausted, true);

      const configGet = runCli(dir, ['config', '--get', 'budget.on_exceed']);
      assert.equal(configGet.status, 0, configGet.combined);
      assert.equal(configGet.stdout.trim(), 'warn');

      const events = runCli(dir, ['events', '--json', '--type', 'budget_exceeded_warn', '--limit', '0']);
      assert.equal(events.status, 0, events.combined);
      const warnEvents = parseJsonLines(events.stdout);
      assert.equal(warnEvents.length, 1, `expected one warn event, got ${warnEvents.length}`);
      assert.equal(warnEvents[0].event_type, 'budget_exceeded_warn');
      assert.match(warnEvents[0].payload.warning, /Run continues in warn mode/);

      const resume = runCli(dir, ['resume', '--role', 'pm']);
      assert.equal(resume.status, 0, resume.combined);
      assert.match(resume.stdout, /Warning: Budget exhausted/);
      assert.match(resume.stdout, /Run continues in warn mode per on_exceed policy/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('budget warn mode CLI surface spec', () => {
  it('records the warn-mode CLI visibility contract', () => {
    assert.match(SPEC, /## Purpose/);
    assert.match(SPEC, /## Interface/);
    assert.match(SPEC, /## Behavior/);
    assert.match(SPEC, /## Error Cases/);
    assert.match(SPEC, /## Acceptance Tests/);
    assert.match(SPEC, /AT-BWC-001/);
    assert.match(SPEC, /AT-BWC-005/);
  });
});
