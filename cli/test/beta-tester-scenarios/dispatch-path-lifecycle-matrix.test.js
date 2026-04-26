/**
 * Command-level coverage for the remaining dispatch-path lifecycle gaps called
 * out in BUG_31_33_COVERAGE_GAP_POSTMORTEM.md.
 *
 * We already had library-level proof for retry bundle content (BUG-35) and
 * gate semantic coverage (BUG-36). The missing operator-visible surfaces were:
 *   1. `step --resume` must re-dispatch a retrying turn without dropping the
 *      injected intent or the retry failure context.
 *   2. `restart` must preserve the retry bundle for an active retrying turn.
 *   3. Manual command flow (`resume` -> `accept-turn`) must surface the exact
 *      gate/file rejection when the gated file was not touched.
 */

import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { scaffoldGoverned } from '../../src/commands/init.js';
import { normalizeGovernedStateShape } from '../../src/lib/governed-state.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = join(__dirname, '..', '..', 'bin', 'agentxchain.js');
const tempDirs = [];

function runCli(root, args, extraEnv = {}) {
  const result = spawnSync(process.execPath, [CLI_BIN, ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout: 30_000,
    env: {
      ...process.env,
      NO_COLOR: '1',
      ...extraEnv,
    },
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    combined: `${result.stdout || ''}${result.stderr || ''}`,
  };
}

function readJson(root, relPath) {
  return JSON.parse(readFileSync(join(root, relPath), 'utf8'));
}

function readState(root) {
  return normalizeGovernedStateShape(readJson(root, '.agentxchain/state.json')).state;
}

function getSingleActiveTurn(root) {
  const state = readState(root);
  const turns = Object.values(state.active_turns || {});
  assert.equal(turns.length, 1, `expected exactly one active turn, got ${turns.length}`);
  return turns[0];
}

function updateActiveTurn(root, turnId, mutate) {
  const statePath = join(root, '.agentxchain', 'state.json');
  const state = readJson(root, '.agentxchain/state.json');
  const activeTurns = state.active_turns || {};
  assert.ok(activeTurns[turnId], `expected active turn ${turnId} to exist`);
  activeTurns[turnId] = mutate(activeTurns[turnId]);
  state.active_turns = activeTurns;
  writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n');
}

function readPrompt(root, turnId) {
  return readFileSync(join(root, '.agentxchain', 'dispatch', 'turns', turnId, 'PROMPT.md'), 'utf8');
}

function writeTurnScopedResult(root, turnId, payload) {
  const turnDir = join(root, '.agentxchain', 'staging', turnId);
  mkdirSync(turnDir, { recursive: true });
  writeFileSync(join(turnDir, 'turn-result.json'), JSON.stringify(payload, null, 2));
}

function makeGateCoverageConfig() {
  return {
    schema_version: '1.0',
    protocol_mode: 'governed',
    template: 'generic',
    project: { id: 'dispatch-gate-proof', name: 'Dispatch Gate Proof', default_branch: 'main' },
    roles: {
      dev: {
        title: 'Developer',
        mandate: 'Implement features and fix bugs.',
        write_authority: 'authoritative',
        runtime: 'manual-dev',
      },
      qa: {
        title: 'QA',
        mandate: 'Verify quality.',
        write_authority: 'review_only',
        runtime: 'manual-qa',
      },
    },
    runtimes: {
      'manual-dev': { type: 'manual' },
      'manual-qa': { type: 'manual' },
    },
    routing: {
      implementation: {
        entry_role: 'dev',
        allowed_next_roles: ['dev', 'qa'],
        exit_gate: 'implementation_complete',
      },
      qa: {
        entry_role: 'qa',
        allowed_next_roles: ['qa'],
      },
    },
    gates: {
      implementation_complete: {
        requires_files: ['.planning/IMPLEMENTATION_NOTES.md'],
        semantics: [
          {
            file: '.planning/IMPLEMENTATION_NOTES.md',
            rule: 'section_exists',
            config: { heading: '## Changes' },
          },
        ],
      },
    },
  };
}

function createProject({ withImplementationGate = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'axc-dispatch-matrix-'));
  tempDirs.push(root);

  scaffoldGoverned(root, 'Dispatch Path Lifecycle Fixture', `dispatch-lifecycle-${Date.now()}`);

  const configPath = join(root, 'agentxchain.json');
  const config = withImplementationGate
    ? makeGateCoverageConfig()
    : (() => {
      const scaffolded = readJson(root, 'agentxchain.json');
      scaffolded.runtimes['manual-dev'] = { type: 'manual' };
      scaffolded.runtimes['manual-qa'] = { type: 'manual' };
      scaffolded.roles.dev.runtime = 'manual-dev';
      scaffolded.roles.qa.runtime = 'manual-qa';
      return scaffolded;
    })();

  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');

  const statePath = join(root, '.agentxchain', 'state.json');
  const state = readJson(root, '.agentxchain/state.json');
  state.phase = 'implementation';
  state.current_phase = 'implementation';
  state.status = 'idle';
  state.phase_gate_status = {
    planning_signoff: 'passed',
    implementation_complete: 'pending',
    qa_ship_verdict: 'pending',
  };
  writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n');

  if (withImplementationGate) {
    try {
      unlinkSync(join(root, '.planning', 'IMPLEMENTATION_NOTES.md'));
    } catch {}
  }

  execSync('git init', { cwd: root, stdio: 'ignore' });
  execSync('git config user.email "test@example.com"', { cwd: root, stdio: 'ignore' });
  execSync('git config user.name "Test User"', { cwd: root, stdio: 'ignore' });
  execSync('git add .', { cwd: root, stdio: 'ignore' });
  execSync('git commit -m "baseline"', { cwd: root, stdio: 'ignore' });

  return root;
}

function injectIntent(root, charter, acceptance) {
  const result = runCli(root, [
    'inject',
    charter,
    '--priority', 'p0',
    '--charter', charter,
    '--acceptance', acceptance.join(','),
    '--json',
  ]);
  assert.equal(result.status, 0, result.combined);
  return JSON.parse(result.stdout);
}

function stageValidRetryCandidate(root, turn) {
  const state = readState(root);
  writeTurnScopedResult(root, turn.turn_id, {
    schema_version: '1.0',
    run_id: state.run_id,
    turn_id: turn.turn_id,
    role: turn.assigned_role,
    runtime_id: turn.runtime_id,
    status: 'completed',
    summary: 'Did unrelated work and missed the operator-injected repair path.',
    decisions: [
      {
        id: 'DEC-001',
        category: 'implementation',
        statement: 'Completed a valid turn payload for retry rebinding proof.',
        rationale: 'reject-turn must have a valid staged result when rejecting with an operator reason.',
      },
    ],
    objections: [
      {
        id: 'OBJ-001',
        severity: 'low',
        statement: 'The narrow repair request still needs to be addressed.',
        status: 'raised',
      },
    ],
    files_changed: [],
    artifacts_created: [],
    verification: {
      status: 'pass',
      evidence_summary: 'Fixture-only valid staged result for retry rebinding proof.',
    },
    artifact: { type: 'review', ref: 'review:dispatch-lifecycle-matrix' },
    proposed_next_role: 'human',
    phase_transition_request: null,
    cost: { usd: 0.01 },
  });
}

function seedRetryingTurn(root, commandName) {
  // BUG-39: inject the intent AFTER the run starts, so it gets stamped with
  // the current run_id and isn't archived during migration.
  // Start the run first via resume (which calls initializeGovernedRun for idle state).
  const initRun = runCli(root, ['resume', '--role', 'dev']);
  assert.equal(initRun.status, 0, initRun.combined);

  // Accept the initial turn quickly so we can inject + re-dispatch
  const initialTurn = getSingleActiveTurn(root);
  const state = readState(root);
  writeTurnScopedResult(root, initialTurn.turn_id, {
    schema_version: '1.0',
    run_id: state.run_id,
    turn_id: initialTurn.turn_id,
    role: initialTurn.assigned_role,
    runtime_id: initialTurn.runtime_id,
    status: 'completed',
    summary: 'Initial bootstrap turn.',
    decisions: [],
    objections: [],
    files_changed: [],
    artifacts_created: [],
    verification: { status: 'pass', evidence_summary: 'bootstrap' },
    artifact: { type: 'review', ref: null },
    proposed_next_role: 'dev',
    phase_transition_request: null,
    cost: { usd: 0.001 },
  });
  const acceptInit = runCli(root, ['accept-turn']);
  assert.equal(acceptInit.status, 0, acceptInit.combined);

  // Now inject the intent (run is active, intent gets stamped with run_id)
  const injected = injectIntent(
    root,
    'Edit .planning/IMPLEMENTATION_NOTES.md to add the missing repair note',
    [
      'return to the narrow repair request',
      'preserve the injected intent in the retry prompt',
    ],
  );

  // Dispatch a new turn that will pick up the intent
  const dispatch = runCli(root, [commandName, '--role', 'dev']);
  assert.equal(dispatch.status, 0, dispatch.combined);

  const turn = getSingleActiveTurn(root);
  const initialPrompt = readPrompt(root, turn.turn_id);
  assert.match(initialPrompt, /Active Injected Intent/, 'initial dispatch must foreground the injected intent');

  stageValidRetryCandidate(root, turn);

  const reject = runCli(root, [
    'reject-turn',
    '--reason',
    'Return to the injected repair path before proceeding',
  ]);
  assert.equal(reject.status, 0, reject.combined);

  const retryTurn = getSingleActiveTurn(root);
  assert.equal(retryTurn.turn_id, turn.turn_id, 'retry must retain the same turn id');
  assert.equal(retryTurn.attempt, 2, 'retry turn must increment the attempt count');

  return {
    turnId: retryTurn.turn_id,
    intentId: injected.intent_id,
    charter: injected.charter,
  };
}

afterEach(() => {
  while (tempDirs.length > 0) {
    try {
      rmSync(tempDirs.pop(), { recursive: true, force: true });
    } catch {}
  }
});

describe('dispatch path lifecycle matrix coverage', () => {
  it('step --resume re-dispatches a retrying turn with failure context and injected intent intact', () => {
    const root = createProject();
    const seeded = seedRetryingTurn(root, 'resume');

    rmSync(join(root, '.agentxchain', 'dispatch', 'turns', seeded.turnId), { recursive: true, force: true });
    updateActiveTurn(root, seeded.turnId, (turn) => ({
      ...turn,
      deadline_at: new Date(Date.now() - 1_000).toISOString(),
    }));

    const resumed = runCli(root, ['step', '--resume']);
    assert.equal(resumed.status, 1, resumed.combined);
    assert.match(resumed.combined, /Turn timed out\. No staged result found\./);

    const retryPrompt = readPrompt(root, seeded.turnId);
    assert.match(retryPrompt, /Previous Attempt Failed/);
    assert.match(retryPrompt, /Return to the injected repair path before proceeding/);
    assert.match(retryPrompt, /Active Injected Intent/);
    assert.match(retryPrompt, /Edit \.planning\/IMPLEMENTATION_NOTES\.md to add the missing repair note/);
    assert.ok(
      retryPrompt.indexOf('Previous Attempt Failed') < retryPrompt.indexOf('Active Injected Intent'),
      'retry failure context must remain above the injected intent after step --resume'
    );
  });

  it('restart preserves the retry bundle for an active retrying turn', () => {
    const root = createProject();
    const seeded = seedRetryingTurn(root, 'resume');

    const restarted = runCli(root, ['restart']);
    assert.equal(restarted.status, 0, restarted.combined);
    assert.match(restarted.stdout, /Reconnected to run|Restarted run/);

    const retryPrompt = readPrompt(root, seeded.turnId);
    assert.match(retryPrompt, /Previous Attempt Failed/);
    assert.match(retryPrompt, /Return to the injected repair path before proceeding/);
    assert.match(retryPrompt, /Active Injected Intent/);
    assert.match(retryPrompt, /return to the narrow repair request/i);
    assert.ok(
      retryPrompt.indexOf('Previous Attempt Failed') < retryPrompt.indexOf('Active Injected Intent'),
      'restart must not drop or reorder the retry bundle sections'
    );
  });

  it('resume -> accept-turn surfaces gate_semantic_coverage with the exact gate and file', () => {
    const root = createProject({ withImplementationGate: true });

    const resumed = runCli(root, ['resume', '--role', 'dev']);
    assert.equal(resumed.status, 0, resumed.combined);

    const turn = getSingleActiveTurn(root);
    const state = readState(root);

    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src', 'index.js'), 'console.log("gate-semantic coverage fixture");\n');

    writeTurnScopedResult(root, turn.turn_id, {
      schema_version: '1.0',
      run_id: state.run_id,
      turn_id: turn.turn_id,
      role: turn.assigned_role,
      runtime_id: turn.runtime_id,
      status: 'completed',
      summary: 'Claims readiness for QA without updating the gated file.',
      decisions: [],
      objections: [],
      files_changed: ['src/index.js'],
      artifacts_created: [],
      verification: {
        status: 'pass',
        evidence_summary: 'Fixture verification pass.',
      },
      artifact: { type: 'workspace', ref: null },
      proposed_next_role: 'qa',
      phase_transition_request: 'qa',
      cost: { usd: 0.01 },
    });

    execSync('git add src/index.js && git commit -m "fixture change"', { cwd: root, stdio: 'ignore' });

    const accepted = runCli(root, ['accept-turn']);
    assert.equal(accepted.status, 1, accepted.combined);
    assert.match(accepted.stdout, /Validation failed at stage gate_semantic_coverage/);
    assert.match(accepted.stdout, /implementation_complete/);
    assert.match(accepted.stdout, /\.planning\/IMPLEMENTATION_NOTES\.md/);
    assert.match(accepted.stdout, /Fix staged result and rerun agentxchain accept-turn/);
  });
});
