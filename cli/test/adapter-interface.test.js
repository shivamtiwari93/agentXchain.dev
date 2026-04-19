import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

import {
  ADAPTER_INTERFACE_VERSION,
  dispatchLocalCli,
  resolvePromptTransport,
  saveDispatchLogs,
} from '../src/lib/adapter-interface.js';
import {
  RUNNER_INTERFACE_VERSION,
  acceptTurn,
  assignTurn,
  getTurnStagingResultPath,
  initRun,
  writeDispatchBundle,
} from '../src/lib/runner-interface.js';

function makeTmpDir() {
  const dir = join(tmpdir(), `axc-adapter-interface-${randomBytes(6).toString('hex')}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function makeConfig(scriptPath) {
  return {
    schema_version: 4,
    protocol_mode: 'governed',
    project: { id: 'adapter-proof', name: 'Adapter Proof', default_branch: 'main' },
    roles: {
      dev: {
        title: 'Developer',
        mandate: 'Implement the governed slice.',
        write_authority: 'authoritative',
        runtime_class: 'local_cli',
        runtime: 'local-dev',
      },
    },
    runtimes: {
      'local-dev': {
        type: 'local_cli',
        command: ['node', scriptPath],
        cwd: '.',
      },
    },
    routing: {
      implementation: {
        entry_role: 'dev',
        allowed_next_roles: ['dev', 'qa', 'human'],
      },
    },
    gates: {},
    budget: { per_turn_max_usd: 2.0, per_run_max_usd: 10.0 },
    rules: { challenge_required: true, max_turn_retries: 1, max_deadlock_cycles: 1 },
    files: {
      talk: 'TALK.md',
      history: '.agentxchain/history.jsonl',
      state: '.agentxchain/state.json',
    },
    compat: {
      next_owner_source: 'state-json',
      lock_based_coordination: false,
      original_version: 4,
    },
  };
}

function scaffoldProject(root, config) {
  mkdirSync(join(root, '.agentxchain'), { recursive: true });
  writeFileSync(join(root, 'agentxchain.json'), JSON.stringify(config, null, 2));
  writeFileSync(join(root, '.agentxchain', 'state.json'), JSON.stringify({
    schema_version: '1.1',
    project_id: config.project.id,
    status: 'idle',
    phase: 'implementation',
    run_id: null,
    active_turns: {},
    next_role: null,
    pending_phase_transition: null,
    pending_run_completion: null,
    blocked_on: null,
    blocked_reason: null,
  }, null, 2));
  writeFileSync(join(root, '.agentxchain', 'history.jsonl'), '');
  writeFileSync(join(root, '.agentxchain', 'decision-ledger.jsonl'), '');
  writeFileSync(join(root, 'TALK.md'), '# Talk\n');
}

let tmpDirs = [];
function createAndTrack() {
  const dir = makeTmpDir();
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tmpDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {}
  }
  tmpDirs = [];
});

describe('adapter interface', () => {
  it('AT-ADAPTER-IFACE-002: exports version and stable adapter entrypoints', () => {
    assert.equal(ADAPTER_INTERFACE_VERSION, '0.1');
    assert.equal(RUNNER_INTERFACE_VERSION, '0.2');
    assert.equal(typeof dispatchLocalCli, 'function');
    assert.equal(typeof resolvePromptTransport, 'function');
    assert.equal(typeof saveDispatchLogs, 'function');
  });

  it('AT-ADAPTER-IFACE-003: programmatic runner can execute one governed local_cli turn through public interfaces', async () => {
    const root = createAndTrack();
    const scriptPath = join(root, 'mock-local-agent.js');
    const config = makeConfig(scriptPath);
    scaffoldProject(root, config);

    const initResult = initRun(root, config);
    assert.ok(initResult.ok, initResult.error);

    const assignResult = assignTurn(root, config, 'dev');
    assert.ok(assignResult.ok, assignResult.error);
    assert.ok(assignResult.turn, 'assignTurn must return top-level turn');

    const bundleResult = writeDispatchBundle(root, assignResult.state, config);
    assert.ok(bundleResult.ok, bundleResult.error);

    const turn = assignResult.turn;
    const turnResult = {
      schema_version: '1.0',
      run_id: assignResult.state.run_id,
      turn_id: turn.turn_id,
      role: turn.assigned_role,
      runtime_id: turn.runtime_id,
      status: 'completed',
      summary: 'Executed through agentxchain/adapter-interface.',
      decisions: [
        {
          id: 'DEC-001',
          category: 'implementation',
          statement: 'Used the public adapter interface for dispatch.',
          rationale: 'External runners need a stable connector boundary.',
        },
      ],
      objections: [],
      files_changed: [],
      artifacts_created: [],
      verification: {
        status: 'pass',
        commands: ['node mock-local-agent.js'],
        evidence_summary: 'Mock local agent wrote a valid staged result.',
        machine_evidence: [{ command: 'node mock-local-agent.js', exit_code: 0 }],
      },
      artifact: { type: 'review', ref: 'git:dirty' },
      proposed_next_role: 'qa',
      phase_transition_request: null,
      run_completion_request: null,
      needs_human_reason: null,
      cost: { input_tokens: 0, output_tokens: 0, usd: 0 },
    };

    writeFileSync(
      scriptPath,
      `
        const fs = require('fs');
        const path = require('path');
        const stagingDir = path.join(process.cwd(), ${JSON.stringify(join('.agentxchain', 'staging', turn.turn_id))});
        fs.mkdirSync(stagingDir, { recursive: true });
        fs.writeFileSync(
          path.join(stagingDir, 'turn-result.json'),
          JSON.stringify(${JSON.stringify(turnResult)}, null, 2)
        );
        console.log('staged governed turn result');
      `,
    );

    const dispatchResult = await dispatchLocalCli(root, assignResult.state, config);
    assert.ok(dispatchResult.ok, dispatchResult.error);
    saveDispatchLogs(root, turn.turn_id, dispatchResult.logs || []);

    const stagedPath = join(root, getTurnStagingResultPath(turn.turn_id));
    const staged = readJson(stagedPath);
    assert.equal(staged.summary, 'Executed through agentxchain/adapter-interface.');

    const acceptResult = acceptTurn(root, config);
    assert.ok(acceptResult.ok, acceptResult.error);
    assert.equal(acceptResult.accepted.turn_id, turn.turn_id);
  });
});
