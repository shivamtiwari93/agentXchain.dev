import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  acceptGovernedTurn,
  assignGovernedTurn,
  initializeGovernedRun,
  normalizeGovernedStateShape,
} from '../src/lib/governed-state.js';
import { injectIntent } from '../src/lib/intake.js';
import { getTurnStagingResultPath } from '../src/lib/turn-paths.js';

const tempDirs = [];

function makeConfig() {
  return {
    schema_version: '1.0',
    protocol_mode: 'governed',
    template: 'generic',
    project: { id: 'intent-phase-scope-test', name: 'Intent Phase Scope Test', default_branch: 'main' },
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
  const root = mkdtempSync(join(tmpdir(), 'axc-intent-phase-scope-'));
  tempDirs.push(root);

  mkdirSync(join(root, '.planning'), { recursive: true });
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'README.md'), '# Intent phase scope\n');
  writeFileSync(join(root, 'agentxchain.json'), JSON.stringify(makeConfig(), null, 2));

  execSync('git init -b main', { cwd: root, stdio: 'ignore' });
  execSync('git config user.email "test@test.com"', { cwd: root, stdio: 'ignore' });
  execSync('git config user.name "Test"', { cwd: root, stdio: 'ignore' });
  execSync('git add -A && git commit -m "init"', { cwd: root, stdio: 'ignore' });

  const config = makeConfig();
  const init = initializeGovernedRun(root, config);
  assert.ok(init.ok, init.error);
  return { root, config };
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

afterEach(() => {
  while (tempDirs.length > 0) {
    try {
      rmSync(tempDirs.pop(), { recursive: true, force: true });
    } catch {}
  }
});

describe('intent phase scope', () => {
  it('auto-derives phase_scope from gate references during inject/triage', () => {
    const { root } = createProject();

    const injected = injectIntent(root, 'repair implementation gate wording', {
      priority: 'p1',
      charter: 'repair implementation gate wording',
      acceptance: 'implementation_complete gate can advance to qa once verification passes',
    });
    assert.ok(injected.ok, injected.error);

    const storedIntent = JSON.parse(readFileSync(
      join(root, '.agentxchain', 'intake', 'intents', `${injected.intent.intent_id}.json`),
      'utf8',
    ));
    assert.equal(storedIntent.phase_scope, 'implementation');
  });

  it('skips implementation-scoped coverage on qa acceptance after the gate already passed', () => {
    const { root, config } = createProject();

    writeFileSync(join(root, '.planning', 'IMPLEMENTATION_NOTES.md'), '# Notes\n\n## Changes\n- Added repair\n\n## Verification\n- Baseline verification\n');
    writeFileSync(join(root, 'src', 'api.js'), 'export const ok = true;\n');
    execSync('git add .planning/IMPLEMENTATION_NOTES.md src/api.js && git commit -m "seed implementation artifacts"', {
      cwd: root,
      stdio: 'ignore',
    });

    const implAssign = assignGovernedTurn(root, config, 'dev');
    assert.ok(implAssign.ok, implAssign.error);
    writeFileSync(
      join(root, '.planning', 'IMPLEMENTATION_NOTES.md'),
      '# Notes\n\n## Changes\n- Added repair\n- Verified implementation gate exit\n\n## Verification\n- Gate verification recorded\n',
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

    const qaAssign = assignGovernedTurn(root, config, 'qa', {
      intakeContext: {
        intent_id: 'intent_bound_before_retirement',
        charter: 'repair implementation gate wording',
        phase_scope: 'implementation',
        acceptance_contract: ['implementation_complete gate can advance to qa once verification passes'],
      },
    });
    assert.ok(qaAssign.ok, qaAssign.error);

    const qaResultPath = stageTurnResult(root, qaAssign.turn.turn_id, {
      schema_version: '1.0',
      run_id: qaAssign.state.run_id,
      turn_id: qaAssign.turn.turn_id,
      role: 'qa',
      runtime_id: 'manual-qa',
      status: 'completed',
      summary: 'QA verified the implementation-phase repair without re-litigating it.',
      decisions: [],
      objections: [{ id: 'OBJ-001', target: 'implementation', statement: 'Implementation gate is already passed.', severity: 'low' }],
      files_changed: [],
      verification: { status: 'skipped' },
      artifact: { type: 'review', ref: null },
      proposed_next_role: 'qa',
      phase_transition_request: null,
    });
    const qaAccept = acceptGovernedTurn(root, config, {
      turnId: qaAssign.turn.turn_id,
      resultPath: qaResultPath,
    });

    assert.ok(qaAccept.ok, qaAccept.error);
  });

  it('treats gate-state language as covered even when phase_scope was never recorded', () => {
    const { root, config } = createProject();

    const rawState = readState(root);
    const forcedQaState = {
      ...rawState,
      phase: 'qa',
      phase_gate_status: {
        ...(rawState.phase_gate_status || {}),
        implementation_complete: 'passed',
      },
    };
    writeFileSync(join(root, '.agentxchain', 'state.json'), JSON.stringify(forcedQaState, null, 2));

    const qaAssign = assignGovernedTurn(root, config, 'qa', {
      intakeContext: {
        intent_id: 'intent_without_phase_scope',
        charter: 'repair implementation gate wording',
        acceptance_contract: ['implementation_complete gate can advance to qa once verification passes'],
      },
    });
    assert.ok(qaAssign.ok, qaAssign.error);

    const qaResultPath = stageTurnResult(root, qaAssign.turn.turn_id, {
      schema_version: '1.0',
      run_id: qaAssign.state.run_id,
      turn_id: qaAssign.turn.turn_id,
      role: 'qa',
      runtime_id: 'manual-qa',
      status: 'completed',
      summary: 'QA validation succeeded.',
      decisions: [],
      objections: [{ id: 'OBJ-002', target: 'implementation', statement: 'Implementation gate already passed before QA.', severity: 'low' }],
      files_changed: [],
      verification: { status: 'skipped' },
      artifact: { type: 'review', ref: null },
      proposed_next_role: 'qa',
      phase_transition_request: null,
    });
    const qaAccept = acceptGovernedTurn(root, config, {
      turnId: qaAssign.turn.turn_id,
      resultPath: qaResultPath,
    });

    assert.ok(qaAccept.ok, qaAccept.error);
  });
});
