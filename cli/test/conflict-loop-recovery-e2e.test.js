import { strict as assert } from 'node:assert';
import { describe, it, afterEach } from 'node:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(__dirname, '..', 'bin', 'agentxchain.js');

function runCli(dir, args) {
  return spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd: dir,
    encoding: 'utf8',
    env: process.env,
  });
}

const dirs = [];
afterEach(() => {
  for (const d of dirs) {
    try { rmSync(d, { recursive: true, force: true }); } catch {}
  }
  dirs.length = 0;
});

function createGovernedProject(stateOverrides = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'agentxchain-conflict-e2e-'));
  dirs.push(dir);

  mkdirSync(join(dir, '.agentxchain', 'prompts'), { recursive: true });
  mkdirSync(join(dir, '.agentxchain', 'staging'), { recursive: true });
  mkdirSync(join(dir, '.planning'), { recursive: true });

  const config = {
    schema_version: '1.0',
    project: { id: 'conflict-e2e', name: 'Conflict E2E', default_branch: 'main' },
    roles: {
      dev: {
        title: 'Developer',
        mandate: 'Implement features.',
        write_authority: 'authoritative',
        runtime: 'local-dev',
      },
      qa: {
        title: 'QA',
        mandate: 'Verify correctness.',
        write_authority: 'review_only',
        runtime: 'local-qa',
      },
    },
    runtimes: {
      'local-dev': { type: 'manual' },
      'local-qa': { type: 'manual' },
    },
    workflow: {
      phases: [{ id: 'build', description: 'Build phase', roles: ['dev', 'qa'] }],
      gates: [],
    },
  };

  const turnId = stateOverrides.turnId || 'turn_conflict_01';
  mkdirSync(join(dir, '.agentxchain', 'staging', turnId), { recursive: true });

  const state = {
    schema_version: '1.0',
    protocol_version: 'v7',
    run_id: 'run_conflict_e2e',
    project_id: 'conflict-e2e',
    status: 'active',
    phase: 'build',
    turn_counter: 3,
    phase_index: 0,
    turn_history: [],
    decision_ledger_dispatch_index: 0,
    active_turns: {},
    ...stateOverrides.state,
  };

  writeFileSync(join(dir, 'agentxchain.json'), JSON.stringify(config, null, 2));
  writeFileSync(join(dir, '.agentxchain', 'state.json'), JSON.stringify(state, null, 2));
  writeFileSync(join(dir, '.agentxchain', 'decision-ledger.jsonl'), '');

  return { dir, turnId };
}

describe('Conflict-loop recovery — subprocess E2E', () => {
  // AT-CLR-001: status shows conflict_loop typed_reason and reject-turn recovery action
  it('AT-CLR-001: status renders conflict_loop recovery guidance when run is blocked', () => {
    const turnId = 'turn_conflict_01';
    const { dir } = createGovernedProject({
      turnId,
      state: {
        status: 'blocked',
        blocked_on: `human:conflict_loop:${turnId}`,
        active_turns: {
          [turnId]: {
            turn_id: turnId,
            assigned_role: 'dev',
            runtime_id: 'local-dev',
            attempt: 3,
            status: 'conflicted',
            started_at: '2026-04-16T10:00:00Z',
            conflict_state: {
              detected_at: '2026-04-16T10:05:00Z',
              detection_count: 3,
              status: 'pending_operator',
              conflict_error: {
                conflicting_files: ['src/index.js', 'src/utils.js'],
                overlap_ratio: 0.4,
                suggested_resolution: 'reject_and_reassign',
                accepted_since: ['turn_qa_01'],
              },
            },
          },
        },
        blocked_reason: {
          category: 'conflict_loop',
          blocked_at: '2026-04-16T10:05:00Z',
          turn_id: turnId,
          recovery: {
            typed_reason: 'conflict_loop',
            owner: 'human',
            recovery_action: `Serialize the conflicting work, then run agentxchain reject-turn --turn ${turnId} --reassign`,
            turn_retained: true,
          },
        },
      },
    });

    const result = runCli(dir, ['status']);
    assert.equal(result.status, 0, `status exited non-zero: ${result.stderr}`);

    // Must show typed reason
    assert.match(result.stdout, /conflict_loop/, 'must display conflict_loop as reason');

    // Must show recovery action with reject-turn --reassign
    assert.match(
      result.stdout,
      /reject-turn --turn turn_conflict_01 --reassign/,
      'must show reject-turn --reassign recovery action'
    );

    // Must show owner
    assert.match(result.stdout, /human/, 'must show human as recovery owner');

    // Must show turn is retained
    assert.match(result.stdout, /retained/, 'must show turn is retained');
  });

  // AT-CLR-002: status shows both resolution commands for a conflicted (but not blocked) turn
  it('AT-CLR-002: status shows both resolution options for conflicted active run', () => {
    const turnId = 'turn_conflict_02';
    const { dir } = createGovernedProject({
      turnId,
      state: {
        status: 'active',
        active_turns: {
          [turnId]: {
            turn_id: turnId,
            assigned_role: 'dev',
            runtime_id: 'local-dev',
            attempt: 1,
            status: 'conflicted',
            started_at: '2026-04-16T10:00:00Z',
            conflict_state: {
              detected_at: '2026-04-16T10:03:00Z',
              detection_count: 1,
              status: 'pending_operator',
              conflict_error: {
                conflicting_files: ['src/app.js'],
                overlap_ratio: 0.7,
                suggested_resolution: 'human_merge',
                accepted_since: ['turn_qa_02'],
              },
            },
          },
        },
      },
    });

    const result = runCli(dir, ['status']);
    assert.equal(result.status, 0, `status exited non-zero: ${result.stderr}`);

    // Must show both resolution commands
    assert.match(
      result.stdout,
      /reject-turn --turn turn_conflict_02 --reassign/,
      'must show reject-turn --reassign option'
    );
    assert.match(
      result.stdout,
      /accept-turn --turn turn_conflict_02 --resolution human_merge/,
      'must show accept-turn --resolution human_merge option'
    );

    // Must show conflict metadata
    assert.match(result.stdout, /1 file/, 'must show conflicting file count');
    assert.match(result.stdout, /detection #1/, 'must show detection count');
    assert.match(result.stdout, /70%/, 'must show overlap percentage');
    assert.match(result.stdout, /human_merge/, 'must show suggested resolution');
  });

  // AT-CLR-005: reject-turn --reassign fails on a non-conflicted turn
  it('AT-CLR-005: reject-turn --reassign rejects non-conflicted turns', () => {
    const turnId = 'turn_normal_01';
    const { dir } = createGovernedProject({
      turnId,
      state: {
        status: 'active',
        active_turns: {
          [turnId]: {
            turn_id: turnId,
            assigned_role: 'dev',
            runtime_id: 'local-dev',
            attempt: 1,
            status: 'proposed',
            started_at: '2026-04-16T10:00:00Z',
          },
        },
      },
    });

    // Write a minimal turn-result.json so reject-turn has something to work with
    writeFileSync(join(dir, '.agentxchain', 'staging', turnId, 'turn-result.json'), JSON.stringify({
      schema_version: '1.0',
      run_id: 'run_conflict_e2e',
      turn_id: turnId,
      role: 'dev',
      runtime_id: 'local-dev',
      status: 'completed',
      summary: 'Normal work.',
      decisions: [],
      objections: [],
      files_changed: [],
      artifacts_created: [],
      verification: { self_check: 'passed', confidence: 'high' },
    }, null, 2));

    const result = runCli(dir, ['reject-turn', '--turn', turnId, '--reassign', '--reason', 'test']);
    // Must fail — reassign requires conflict_state
    assert.notEqual(result.status, 0, 'reject-turn --reassign must fail on non-conflicted turn');
    // Error message should indicate why
    const combined = result.stdout + result.stderr;
    assert.match(combined, /conflict/i, 'error must mention conflict requirement');
  });
});
