import { strict as assert } from 'node:assert';
import { describe, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const CLI_BIN = join(ROOT, 'cli', 'bin', 'agentxchain.js');

function runCli(cwd, args) {
  return spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 15000,
  });
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function createGovernedProjectWithActiveTurn() {
  const dir = mkdtempSync(join(tmpdir(), 'agentxchain-verify-turn-'));
  const init = runCli(ROOT, ['init', '--governed', '--dir', dir, '-y']);
  assert.equal(init.status, 0, init.stderr || init.stdout);

  const resume = runCli(dir, ['resume']);
  assert.equal(resume.status, 0, resume.stderr || resume.stdout);

  const statePath = join(dir, '.agentxchain', 'state.json');
  const state = readJson(statePath);
  const turnId = Object.keys(state.active_turns)[0];
  assert.ok(turnId, 'active turn must exist after resume');

  return {
    dir,
    statePath,
    state,
    turnId,
    turn: state.active_turns[turnId],
  };
}

function writeStagedTurnResult(dir, state, turnId, turn, overrides = {}) {
  const stagingDir = join(dir, '.agentxchain', 'staging', turnId);
  mkdirSync(stagingDir, { recursive: true });

  const base = {
    schema_version: '1.0',
    run_id: state.run_id,
    turn_id: turnId,
    role: turn.assigned_role,
    runtime_id: turn.runtime_id,
    status: 'completed',
    summary: 'Prepared a verification fixture turn.',
    decisions: [
      {
        id: 'DEC-001',
        category: 'process',
        statement: 'Use a staged turn fixture for verify turn command coverage.',
        rationale: 'The command needs a validator-clean governed turn result before replay can be tested.',
      },
    ],
    objections: [
      {
        id: 'OBJ-001',
        severity: 'medium',
        statement: 'Verification replay should fail closed when evidence cannot be reproduced.',
        status: 'raised',
      },
    ],
    files_changed: ['.planning/ROADMAP.md'],
    verification: {
      status: 'pass',
      machine_evidence: [
        {
          command: 'node -e "process.exit(0)"',
          exit_code: 0,
        },
      ],
      evidence_summary: 'Fixture command exited 0.',
    },
    artifact: {
      type: 'review',
      ref: '.agentxchain/reviews/mock-review.md',
    },
    proposed_next_role: 'human',
  };

  const turnResult = {
    ...base,
    ...overrides,
    verification: {
      ...base.verification,
      ...(overrides.verification || {}),
    },
    artifact: {
      ...base.artifact,
      ...(overrides.artifact || {}),
    },
  };

  writeFileSync(
    join(stagingDir, 'turn-result.json'),
    JSON.stringify(turnResult, null, 2) + '\n',
  );
}

describe('agentxchain verify turn command', () => {
  it('AT-VTURN-001: verify turn --json replays a passing machine-evidence command and reports match', () => {
    const { dir, state, turnId, turn } = createGovernedProjectWithActiveTurn();
    try {
      writeStagedTurnResult(dir, state, turnId, turn);

      const result = runCli(dir, ['verify', 'turn', '--json']);
      assert.equal(result.status, 0, result.stderr || result.stdout);

      const payload = JSON.parse(result.stdout);
      assert.equal(payload.turn_id, turnId);
      assert.equal(payload.overall, 'match');
      assert.equal(payload.replayed_commands, 1);
      assert.equal(payload.matched_commands, 1);
      assert.match(payload.verified_at || '', /^\d{4}-\d{2}-\d{2}T/);
      assert.equal(payload.commands[0].declared_exit_code, 0);
      assert.equal(payload.commands[0].actual_exit_code, 0);
      assert.equal(payload.commands[0].matched, true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('AT-VTURN-002: verify turn text output defaults to the single active turn and prints outcome plus exit-code comparison', () => {
    const { dir, turnId, turn, state } = createGovernedProjectWithActiveTurn();
    try {
      writeStagedTurnResult(dir, state, turnId, turn);

      const result = runCli(dir, ['verify', 'turn']);
      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.match(result.stdout, new RegExp(`Verify Turn: ${turnId}`));
      assert.match(result.stdout, /Declared:/);
      assert.match(result.stdout, /Outcome:.*match/);
      assert.match(result.stdout, /declared=0 actual=0/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('AT-VTURN-003: replay drift exits 1 with overall mismatch', () => {
    const { dir, turnId, turn, state } = createGovernedProjectWithActiveTurn();
    try {
      writeStagedTurnResult(dir, state, turnId, turn, {
        verification: {
          status: 'pass',
          machine_evidence: [
            {
              command: 'node -e "process.exit(1)"',
              exit_code: 0,
            },
          ],
          evidence_summary: 'Fixture claims pass but current replay exits 1.',
        },
      });

      const result = runCli(dir, ['verify', 'turn', turnId, '--json']);
      assert.equal(result.status, 1);
      const payload = JSON.parse(result.stdout);
      assert.equal(payload.overall, 'mismatch');
      assert.equal(payload.commands[0].declared_exit_code, 0);
      assert.equal(payload.commands[0].actual_exit_code, 1);
      assert.equal(payload.commands[0].matched, false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('AT-VTURN-004: no machine_evidence fails closed as not_reproducible', () => {
    const { dir, turnId, turn, state } = createGovernedProjectWithActiveTurn();
    try {
      writeStagedTurnResult(dir, state, turnId, turn, {
        verification: {
          status: 'pass',
          machine_evidence: [],
          commands: ['npm test'],
          evidence_summary: 'Command list present, but no machine evidence recorded.',
        },
      });

      const result = runCli(dir, ['verify', 'turn', '--json']);
      assert.equal(result.status, 1);
      const payload = JSON.parse(result.stdout);
      assert.equal(payload.overall, 'not_reproducible');
      assert.match(payload.reason, /machine_evidence/i);
      assert.equal(payload.replayed_commands, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('AT-VTURN-005: declared verification failure with matching non-zero exit code still reports match', () => {
    const { dir, turnId, turn, state } = createGovernedProjectWithActiveTurn();
    try {
      writeStagedTurnResult(dir, state, turnId, turn, {
        verification: {
          status: 'fail',
          machine_evidence: [
            {
              command: 'node -e "process.exit(1)"',
              exit_code: 1,
            },
          ],
          evidence_summary: 'Fixture intentionally reproduces a failing verifier.',
        },
      });

      const result = runCli(dir, ['verify', 'turn', turnId, '--json']);
      assert.equal(result.status, 0, result.stderr || result.stdout);
      const payload = JSON.parse(result.stdout);
      assert.equal(payload.declared_status, 'fail');
      assert.equal(payload.overall, 'match');
      assert.equal(payload.commands[0].actual_exit_code, 1);
      assert.equal(payload.commands[0].matched, true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('AT-VTURN-006: multiple active turns without explicit turn id fail closed', () => {
    const { dir, statePath, state, turnId, turn } = createGovernedProjectWithActiveTurn();
    try {
      writeStagedTurnResult(dir, state, turnId, turn);

      const duplicateId = 'turn_duplicate';
      state.active_turns[duplicateId] = {
        ...turn,
        turn_id: duplicateId,
        assigned_role: 'qa',
        runtime_id: 'manual-qa',
      };
      writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n');

      const result = runCli(dir, ['verify', 'turn']);
      assert.equal(result.status, 2);
      assert.match(result.stdout, /Multiple active turns are present/);
      assert.match(result.stdout, /Available:/);
      assert.match(result.stdout, /turn_duplicate/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('AT-VTURN-007: staged-result validation failure exits 1 and names the failing stage before replay', () => {
    const { dir, turnId, turn, state } = createGovernedProjectWithActiveTurn();
    try {
      writeStagedTurnResult(dir, state, turnId, turn, {
        decisions: 'not-an-array',
      });

      const result = runCli(dir, ['verify', 'turn', '--json']);
      assert.equal(result.status, 1);
      const payload = JSON.parse(result.stdout);
      assert.equal(payload.overall, 'validation_failed');
      assert.equal(payload.validation.stage, 'schema');
      assert.ok(payload.validation.errors.some((error) => /decisions must be an array/i.test(error)));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('AT-VTURN-008: verify turn fails closed on legacy repos', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agentxchain-verify-turn-legacy-'));
    try {
      writeFileSync(join(dir, 'agentxchain.json'), JSON.stringify({
        version: 3,
        project: 'legacy-test',
        agents: { dev: { name: 'Developer', mandate: 'Write code' } },
        log: '.agentxchain/log.md',
        talk_file: 'TALK.md',
        state_file: '.agentxchain/state.json',
        history_file: '.agentxchain/history.jsonl',
        rules: { max_consecutive_claims: 3 },
      }));

      const result = runCli(dir, ['verify', 'turn']);
      assert.equal(result.status, 2);
      assert.match(result.stdout, /governed v4/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
