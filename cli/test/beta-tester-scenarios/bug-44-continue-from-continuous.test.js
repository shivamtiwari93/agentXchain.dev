import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import {
  acceptGovernedTurn,
  assignGovernedTurn,
  initializeGovernedRun,
} from '../../src/lib/governed-state.js';
import { injectIntent } from '../../src/lib/intake.js';
import { readRunEvents } from '../../src/lib/run-events.js';
import { getTurnStagingResultPath } from '../../src/lib/turn-paths.js';

const CLI_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI_PATH = join(CLI_ROOT, 'bin', 'agentxchain.js');
const MOCK_AGENT = join(CLI_ROOT, 'test-support', 'mock-agent.mjs');
const tempDirs = [];

function makeConfig() {
  const automatedRuntime = {
    type: 'local_cli',
    command: process.execPath,
    args: [MOCK_AGENT],
    cwd: '.',
    prompt_transport: 'dispatch_bundle_only',
  };

  return {
    schema_version: '1.0',
    protocol_mode: 'governed',
    template: 'generic',
    project: { id: 'bug44-continue', name: 'BUG-44 Continue Continuous Test', default_branch: 'main' },
    roles: {
      dev: { title: 'Developer', mandate: 'Build.', write_authority: 'authoritative', runtime: 'local-dev' },
      qa: { title: 'QA', mandate: 'Verify.', write_authority: 'authoritative', runtime: 'local-qa' },
    },
    runtimes: {
      'local-dev': automatedRuntime,
      'local-qa': automatedRuntime,
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
      qa_ship_verdict: {
        requires_files: ['.planning/acceptance-matrix.md', '.planning/ship-verdict.md', '.planning/RELEASE_NOTES.md'],
      },
    },
  };
}

function createProject() {
  const root = mkdtempSync(join(tmpdir(), 'axc-bug44-cont-'));
  tempDirs.push(root);

  mkdirSync(join(root, '.planning'), { recursive: true });
  writeFileSync(join(root, 'README.md'), '# BUG-44 exact continuous proof\n');
  writeFileSync(join(root, '.planning', 'VISION.md'), '# Vision\n\n## QA\n\n- finish QA without stale implementation repair coverage\n');
  writeFileSync(join(root, 'agentxchain.json'), JSON.stringify(makeConfig(), null, 2));

  execSync('git init -b main', { cwd: root, stdio: 'ignore' });
  execSync('git config user.email "test@test.com"', { cwd: root, stdio: 'ignore' });
  execSync('git config user.name "Test"', { cwd: root, stdio: 'ignore' });
  execSync('git add -A && git commit -m "init"', { cwd: root, stdio: 'ignore' });

  const config = makeConfig();
  const init = initializeGovernedRun(root, config);
  assert.ok(init.ok, init.error);
  return { root, config, runId: init.state.run_id };
}

function stageTurnResult(root, turnId, payload) {
  const resultPath = join(root, getTurnStagingResultPath(turnId));
  mkdirSync(dirname(resultPath), { recursive: true });
  writeFileSync(resultPath, JSON.stringify(payload, null, 2));
  return resultPath;
}

function readIntent(root, intentId) {
  return JSON.parse(readFileSync(
    join(root, '.agentxchain', 'intake', 'intents', `${intentId}.json`),
    'utf8',
  ));
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop(), { recursive: true, force: true });
  }
});

describe('BUG-44: exact continue-from continuous command retires stale implementation intent and keeps QA moving', () => {
  it('dispatches the queued QA intent instead of rebinding the exited implementation repair intent', () => {
    const { root, config, runId } = createProject();

    const implementationRepair = injectIntent(root, 'implementation repair intent from beta bug report #13', {
      priority: 'p1',
      charter: 'add literal ## Changes section to .planning/IMPLEMENTATION_NOTES.md, preserve implementation summary, allow implementation to advance to QA.',
      acceptance: 'implementation_complete gate can advance to qa once verification passes',
      approver: 'tester-sequence',
    });
    assert.ok(implementationRepair.ok, implementationRepair.error);

    const qaFollowup = injectIntent(root, 'qa validation should continue after the implementation repair', {
      priority: 'p2',
      charter: 'Execute the QA turn and record the ship verdict after the repaired implementation advances.',
      acceptance: 'qa_ship_verdict gate can advance once QA evidence is captured',
      approver: 'tester-sequence',
    });
    assert.ok(qaFollowup.ok, qaFollowup.error);

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
      '# Implementation Notes\n\n## Summary\n- Existing summary\n\n## Changes\n- Repair completed\n- Gate exit verified\n\n## Verification\n- Gate verification recorded\n',
    );

    const implResultPath = stageTurnResult(root, implAssign.turn.turn_id, {
      schema_version: '1.0',
      run_id: runId,
      turn_id: implAssign.turn.turn_id,
      role: 'dev',
      runtime_id: 'local-dev',
      status: 'completed',
      summary: 'Completed the implementation repair and advanced the run to QA.',
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

    const checkpoint = spawnSync(process.execPath, [
      CLI_PATH,
      'checkpoint-turn',
      '--turn', implAssign.turn.turn_id,
    ], {
      cwd: root,
      encoding: 'utf8',
      timeout: 60000,
      env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1', NODE_NO_WARNINGS: '1' },
    });
    assert.equal(checkpoint.status, 0, `checkpoint-turn failed:\n${checkpoint.stdout}\n${checkpoint.stderr}`);

    const retiredIntent = readIntent(root, implementationRepair.intent.intent_id);
    assert.equal(retiredIntent.status, 'satisfied');
    assert.equal(retiredIntent.phase_scope, 'implementation');

    const queuedQaIntent = readIntent(root, qaFollowup.intent.intent_id);
    assert.equal(queuedQaIntent.status, 'approved');
    assert.equal(queuedQaIntent.phase_scope, 'qa');

    const result = spawnSync(process.execPath, [
      CLI_PATH,
      'run',
      '--continue-from', runId,
      '--continuous',
      '--auto-approve',
      '--auto-checkpoint',
      '--max-turns', '20',
      '--max-runs', '1',
      '--max-idle-cycles', '1',
      '--poll-seconds', '0',
      '--triage-approval', 'auto',
    ], {
      cwd: root,
      encoding: 'utf8',
      timeout: 120000,
      env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1', NODE_NO_WARNINGS: '1' },
    });

    assert.equal(result.status, 0, `continuous command failed:\n${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, new RegExp(`Found queued intent: ${qaFollowup.intent.intent_id} \\(approved\\)`));
    assert.doesNotMatch(result.stdout, new RegExp(`Found queued intent: ${implementationRepair.intent.intent_id} \\(approved\\)`));
    assert.doesNotMatch(result.stdout, /Intent coverage incomplete/);
    assert.match(result.stdout, /Run 1\/1 completed: completed|Run 1\/1 completed: run_completed/);

    const finalQaIntent = readIntent(root, qaFollowup.intent.intent_id);
    assert.equal(finalQaIntent.status, 'completed');

    const finalImplementationIntent = readIntent(root, implementationRepair.intent.intent_id);
    assert.equal(finalImplementationIntent.status, 'satisfied');

    const retireEvents = readRunEvents(root).filter((event) => event.event_type === 'intent_retired_by_phase_advance');
    assert.equal(retireEvents.length, 1);
    assert.deepEqual(retireEvents[0].payload.retired_intent_ids, [implementationRepair.intent.intent_id]);
  });
});
