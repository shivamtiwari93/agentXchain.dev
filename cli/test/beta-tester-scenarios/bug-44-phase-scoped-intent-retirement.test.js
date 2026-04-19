/**
 * BUG-44 beta-tester scenario: implementation-scoped repair intent must retire
 * when implementation exits and QA starts.
 *
 * Tester sequence distilled into an executable command-path proof:
 *   1. Seed an approved implementation repair intent with the tester's wording
 *   2. Accept a normal implementation turn that passes implementation_complete
 *      and advances the run to QA
 *   3. Dispatch the QA turn through the real CLI (`agentxchain resume`)
 *   4. Accept the QA turn through the real CLI (`agentxchain accept-turn`)
 *   5. Assert QA acceptance succeeds and does not complain about stale
 *      implementation-phase intent coverage
 */

import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  acceptGovernedTurn,
  assignGovernedTurn,
  initializeGovernedRun,
  normalizeGovernedStateShape,
} from '../../src/lib/governed-state.js';
import { getTurnStagingResultPath } from '../../src/lib/turn-paths.js';
import { readRunEvents } from '../../src/lib/run-events.js';

const ROOT = join(import.meta.dirname, '..', '..');
const CLI_PATH = join(ROOT, 'bin', 'agentxchain.js');
const INTENT_ID = 'intent_1776534863659_5752';
const EVENT_ID = 'evt_1776534863659_bug44';
const tempDirs = [];

function makeConfig() {
  return {
    schema_version: '1.0',
    protocol_mode: 'governed',
    template: 'generic',
    project: { id: 'bug44-test', name: 'BUG-44 Test', default_branch: 'main' },
    roles: {
      dev: { title: 'Developer', mandate: 'Build.', write_authority: 'authoritative', runtime: 'manual-dev' },
      qa: { title: 'QA', mandate: 'Verify.', write_authority: 'review_only', runtime: 'manual-qa' },
    },
    runtimes: {
      'manual-dev': { type: 'manual' },
      'manual-qa': { type: 'manual' },
    },
    routing: {
      implementation: { entry_role: 'dev', allowed_next_roles: ['dev', 'qa'], exit_gate: 'implementation_complete' },
      qa: { entry_role: 'qa', allowed_next_roles: ['qa'], exit_gate: 'qa_ship_verdict' },
    },
    gates: {
      implementation_complete: {
        requires_files: ['.planning/IMPLEMENTATION_NOTES.md'],
        requires_verification_pass: true,
      },
      qa_ship_verdict: {},
    },
  };
}

function createProject() {
  const root = mkdtempSync(join(tmpdir(), 'axc-bug44-'));
  tempDirs.push(root);

  mkdirSync(join(root, '.planning'), { recursive: true });
  mkdirSync(join(root, 'src'), { recursive: true });
  mkdirSync(join(root, '.agentxchain', 'intake', 'events'), { recursive: true });
  mkdirSync(join(root, '.agentxchain', 'intake', 'intents'), { recursive: true });

  writeFileSync(join(root, 'README.md'), '# BUG-44\n');
  writeFileSync(join(root, 'agentxchain.json'), JSON.stringify(makeConfig(), null, 2));

  execSync('git init -b main', { cwd: root, stdio: 'ignore' });
  execSync('git config user.email "test@test.com"', { cwd: root, stdio: 'ignore' });
  execSync('git config user.name "Test"', { cwd: root, stdio: 'ignore' });
  execSync('git add -A && git commit -m "init"', { cwd: root, stdio: 'ignore' });

  const config = makeConfig();
  const init = initializeGovernedRun(root, config);
  assert.ok(init.ok, init.error);
  return { root, config, state: init.state };
}

function readState(root) {
  const raw = JSON.parse(readFileSync(join(root, '.agentxchain', 'state.json'), 'utf8'));
  return normalizeGovernedStateShape(raw).state;
}

function stageTurnResult(root, turnId, payload) {
  const resultPath = join(root, getTurnStagingResultPath(turnId));
  mkdirSync(join(root, '.agentxchain', 'staging', turnId), { recursive: true });
  writeFileSync(resultPath, JSON.stringify(payload, null, 2));
  return resultPath;
}

function seedRepairIntent(root, runId, { phaseScope = 'implementation' } = {}) {
  const timestamp = '2026-04-19T00:00:00.000Z';
  writeFileSync(join(root, '.agentxchain', 'intake', 'events', `${EVENT_ID}.json`), JSON.stringify({
    schema_version: '1.0',
    event_id: EVENT_ID,
    source: 'manual',
    category: 'operator_injection',
    created_at: timestamp,
    signal: { description: 'implementation repair', injected: true, priority: 'p0' },
    evidence: [{ type: 'text', value: 'beta tester bug report #13' }],
    dedup_key: 'manual:bug44',
  }, null, 2));

  writeFileSync(join(root, '.agentxchain', 'intake', 'intents', `${INTENT_ID}.json`), JSON.stringify({
    schema_version: '1.0',
    intent_id: INTENT_ID,
    event_id: EVENT_ID,
    status: 'approved',
    priority: 'p0',
    template: 'generic',
    charter: 'add literal ## Changes section to .planning/IMPLEMENTATION_NOTES.md, preserve implementation summary, allow implementation to advance to QA.',
    acceptance_contract: [
      'implementation_complete gate can advance to qa once verification passes',
    ],
    phase_scope: phaseScope,
    approved_run_id: runId,
    created_at: timestamp,
    updated_at: timestamp,
    history: [],
  }, null, 2));
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

describe('BUG-44: retire implementation-scoped intents on phase advance', () => {
  it('qa dispatch and qa acceptance succeed after implementation exits', () => {
    const { root, config, state } = createProject();
    seedRepairIntent(root, state.run_id);

    writeFileSync(
      join(root, '.planning', 'IMPLEMENTATION_NOTES.md'),
      '# Implementation Notes\n\n## Summary\n- Existing summary\n\n## Changes\n- Repair completed\n\n## Verification\n- Baseline verification\n',
    );
    execSync('git add .planning/IMPLEMENTATION_NOTES.md && git commit -m "seed implementation notes"', {
      cwd: root,
      stdio: 'ignore',
    });

    const implAssign = assignGovernedTurn(root, config, 'dev');
    assert.ok(implAssign.ok, implAssign.error);
    writeFileSync(
      join(root, '.planning', 'IMPLEMENTATION_NOTES.md'),
      '# Implementation Notes\n\n## Summary\n- Existing summary\n\n## Changes\n- Repair completed\n- Verified implementation gate exit\n\n## Verification\n- Gate verification recorded\n',
    );

    const implResultPath = stageTurnResult(root, implAssign.turn.turn_id, {
      schema_version: '1.0',
      run_id: implAssign.state.run_id,
      turn_id: implAssign.turn.turn_id,
      role: 'dev',
      runtime_id: 'manual-dev',
      status: 'completed',
      summary: 'Completed the implementation repair and advanced to QA.',
      decisions: [],
      objections: [],
      files_changed: ['.planning/IMPLEMENTATION_NOTES.md'],
      verification: { status: 'pass' },
      artifact: { type: 'workspace', ref: null },
      proposed_next_role: 'qa',
      phase_transition_request: 'qa',
    });
    const implAccept = acceptGovernedTurn(root, config, {
      turnId: implAssign.turn.turn_id,
      resultPath: implResultPath,
    });
    assert.ok(implAccept.ok, implAccept.error);
    assert.equal(implAccept.state.phase, 'qa');

    const storedIntent = JSON.parse(readFileSync(
      join(root, '.agentxchain', 'intake', 'intents', `${INTENT_ID}.json`),
      'utf8',
    ));
    assert.equal(storedIntent.status, 'satisfied');

    const resume = spawnSync('node', [CLI_PATH, 'resume'], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, FORCE_COLOR: '0', NODE_NO_WARNINGS: '1' },
    });
    assert.equal(resume.status, 0, `resume failed: ${resume.stdout}\n${resume.stderr}`);
    assert.doesNotMatch(resume.stdout, /Bound approved intent to next turn: intent_1776534863659_5752/);

    const qaState = readState(root);
    const qaTurn = qaState.current_turn || Object.values(qaState.active_turns || {})[0];
    assert.ok(qaTurn, 'QA turn should be active after resume');
    assert.equal(qaTurn.assigned_role, 'qa');
    assert.equal(qaTurn.intake_context?.intent_id || null, null);

    const qaResultPath = stageTurnResult(root, qaTurn.turn_id, {
      schema_version: '1.0',
      run_id: qaState.run_id,
      turn_id: qaTurn.turn_id,
      role: 'qa',
      runtime_id: 'manual-qa',
      status: 'completed',
      summary: 'QA accepted the implementation repair and found no stale coverage blocker.',
      decisions: [],
      objections: [{ id: 'OBJ-001', target: 'implementation', statement: 'Implementation gate already passed before QA.', severity: 'low' }],
      files_changed: [],
      verification: { status: 'skipped' },
      artifact: { type: 'review', ref: null },
      proposed_next_role: 'qa',
      phase_transition_request: null,
    });
    assert.ok(qaResultPath.endsWith('turn-result.json'));

    const qaAccept = spawnSync('node', [CLI_PATH, 'accept-turn', '--turn', qaTurn.turn_id], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, FORCE_COLOR: '0', NODE_NO_WARNINGS: '1' },
    });

    assert.equal(qaAccept.status, 0, `QA accept failed: ${qaAccept.stdout}\n${qaAccept.stderr}`);
    assert.doesNotMatch(qaAccept.stdout, /Intent coverage incomplete/);

    const retireEvents = readRunEvents(root).filter((event) => event.event_type === 'intent_retired_by_phase_advance');
    assert.equal(retireEvents.length, 1, 'phase advance should emit one retirement event');
    assert.deepEqual(retireEvents[0].payload.retired_intent_ids, [INTENT_ID]);
  });

  it('retires gate-referenced repair intents even when phase_scope was never stored explicitly', () => {
    const { root, config, state } = createProject();
    seedRepairIntent(root, state.run_id, { phaseScope: null });

    writeFileSync(
      join(root, '.planning', 'IMPLEMENTATION_NOTES.md'),
      '# Implementation Notes\n\n## Summary\n- Existing summary\n\n## Changes\n- Repair completed\n\n## Verification\n- Baseline verification\n',
    );
    execSync('git add .planning/IMPLEMENTATION_NOTES.md && git commit -m "seed implementation notes"', {
      cwd: root,
      stdio: 'ignore',
    });

    const implAssign = assignGovernedTurn(root, config, 'dev');
    assert.ok(implAssign.ok, implAssign.error);
    writeFileSync(
      join(root, '.planning', 'IMPLEMENTATION_NOTES.md'),
      '# Implementation Notes\n\n## Summary\n- Existing summary\n\n## Changes\n- Repair completed\n- Verified implementation gate exit\n\n## Verification\n- Gate verification recorded\n',
    );

    const implResultPath = stageTurnResult(root, implAssign.turn.turn_id, {
      schema_version: '1.0',
      run_id: implAssign.state.run_id,
      turn_id: implAssign.turn.turn_id,
      role: 'dev',
      runtime_id: 'manual-dev',
      status: 'completed',
      summary: 'Gate passed and implementation advanced.',
      decisions: [],
      objections: [],
      files_changed: ['.planning/IMPLEMENTATION_NOTES.md'],
      verification: { status: 'pass' },
      artifact: { type: 'workspace', ref: null },
      proposed_next_role: 'qa',
      phase_transition_request: 'qa',
    });
    const implAccept = acceptGovernedTurn(root, config, {
      turnId: implAssign.turn.turn_id,
      resultPath: implResultPath,
    });
    assert.ok(implAccept.ok, implAccept.error);

    const storedIntent = JSON.parse(readFileSync(
      join(root, '.agentxchain', 'intake', 'intents', `${INTENT_ID}.json`),
      'utf8',
    ));
    assert.equal(storedIntent.status, 'satisfied');
    assert.equal(storedIntent.phase_scope, 'implementation');
  });
});
