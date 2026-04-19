#!/usr/bin/env node

/**
 * Adapter-backed external runner starter.
 *
 * Unlike run-one-turn.mjs (which stages results manually), this starter
 * uses agentxchain/adapter-interface to dispatch work through the local_cli
 * adapter — the same path the shipped CLI uses.
 *
 * Proves: a clean consumer can import both runner-interface AND adapter-interface,
 * dispatch a real governed turn through local_cli, and accept the result.
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  RUNNER_INTERFACE_VERSION,
  acceptTurn,
  assignTurn,
  getTurnStagingResultPath,
  initRun,
  writeDispatchBundle,
} from 'agentxchain/runner-interface';
import {
  ADAPTER_INTERFACE_VERSION,
  dispatchLocalCli,
  saveDispatchLogs,
} from 'agentxchain/adapter-interface';

const jsonMode = process.argv.includes('--json');

function makeConfig(agentScriptPath) {
  return {
    schema_version: 4,
    protocol_mode: 'governed',
    project: {
      id: 'adapter-starter',
      name: 'Adapter Starter',
      default_branch: 'main',
    },
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
        command: ['node', agentScriptPath],
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
  writeFileSync(
    join(root, '.agentxchain', 'state.json'),
    JSON.stringify(
      {
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
      },
      null,
      2,
    ),
  );
  writeFileSync(join(root, '.agentxchain', 'history.jsonl'), '');
  writeFileSync(join(root, '.agentxchain', 'decision-ledger.jsonl'), '');
  writeFileSync(join(root, 'TALK.md'), '# Talk\n');
}

function writeMockAgent(scriptPath, turnId, runId) {
  const turnResult = {
    schema_version: '1.0',
    run_id: runId,
    turn_id: turnId,
    role: 'dev',
    runtime_id: 'local-dev',
    status: 'completed',
    summary: 'Adapter-backed starter proved the public dispatch boundary.',
    decisions: [
      {
        id: 'DEC-001',
        category: 'implementation',
        statement: 'Used agentxchain/adapter-interface for governed dispatch.',
        rationale: 'External runners use the adapter boundary for real agent dispatch.',
      },
    ],
    objections: [],
    files_changed: [],
    artifacts_created: [],
    verification: {
      status: 'pass',
      commands: ['node run-adapter-turn.mjs --json'],
      evidence_summary: 'Adapter-backed starter dispatched and accepted a governed turn.',
      machine_evidence: [{ command: 'node run-adapter-turn.mjs --json', exit_code: 0 }],
    },
    artifact: { type: 'review', ref: 'git:dirty' },
    proposed_next_role: 'qa',
    phase_transition_request: null,
    run_completion_request: null,
    needs_human_reason: null,
    cost: { input_tokens: 0, output_tokens: 0, usd: 0 },
  };

  const stagingRelative = join('.agentxchain', 'staging', turnId);
  writeFileSync(
    scriptPath,
    [
      `const fs = require('fs');`,
      `const path = require('path');`,
      `const stagingDir = path.join(process.cwd(), ${JSON.stringify(stagingRelative)});`,
      `fs.mkdirSync(stagingDir, { recursive: true });`,
      `fs.writeFileSync(`,
      `  path.join(stagingDir, 'turn-result.json'),`,
      `  JSON.stringify(${JSON.stringify(turnResult)}, null, 2)`,
      `);`,
      `console.log('adapter-backed starter: staged governed turn result');`,
    ].join('\n'),
  );
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function main() {
  const root = join(tmpdir(), `axc-adapter-starter-${randomBytes(6).toString('hex')}`);
  mkdirSync(root, { recursive: true });

  try {
    const agentScriptPath = join(root, 'mock-agent.js');
    const config = makeConfig(agentScriptPath);
    scaffoldProject(root, config);

    // Step 1: Initialize run
    const initResult = initRun(root, config);
    if (!initResult.ok) throw new Error(`initRun failed: ${initResult.error}`);

    // Step 2: Assign turn
    const assignResult = assignTurn(root, config, 'dev');
    if (!assignResult.ok) throw new Error(`assignTurn failed: ${assignResult.error}`);

    const { state, turn } = assignResult;

    // Step 3: Write dispatch bundle (required before adapter dispatch)
    const bundleResult = writeDispatchBundle(root, state, config);
    if (!bundleResult.ok) throw new Error(`writeDispatchBundle failed: ${bundleResult.error}`);

    // Step 4: Write the mock agent script that stages a valid result
    writeMockAgent(agentScriptPath, turn.turn_id, state.run_id);

    // Step 5: Dispatch through adapter-interface (real local_cli dispatch)
    const dispatchResult = await dispatchLocalCli(root, state, config);
    if (!dispatchResult.ok) throw new Error(`dispatchLocalCli failed: ${dispatchResult.error}`);

    // Step 6: Save dispatch logs
    saveDispatchLogs(root, turn.turn_id, dispatchResult.logs || []);

    // Step 7: Verify staged result exists
    const stagedPath = join(root, getTurnStagingResultPath(turn.turn_id));
    const staged = JSON.parse(readFileSync(stagedPath, 'utf8'));
    if (staged.status !== 'completed') {
      throw new Error(`staged result status is ${staged.status}, expected completed`);
    }

    // Step 8: Accept the turn
    const acceptResult = acceptTurn(root, config);
    if (!acceptResult.ok) throw new Error(`acceptTurn failed: ${acceptResult.error}`);

    const stateContent = readFileSync(join(root, '.agentxchain', 'state.json'), 'utf8');
    const output = {
      result: 'pass',
      runner: 'adapter-starter',
      runner_interface_version: RUNNER_INTERFACE_VERSION,
      adapter_interface_version: ADAPTER_INTERFACE_VERSION,
      run_id: acceptResult.state.run_id,
      turn_id: turn.turn_id,
      final_status: acceptResult.state.status,
      dispatched_via: 'local_cli',
      state_sha256: sha256(stateContent),
    };

    if (jsonMode) {
      process.stdout.write(`${JSON.stringify(output)}\n`);
      return;
    }

    process.stdout.write(
      [
        'PASS: adapter-backed starter',
        `runner-interface ${RUNNER_INTERFACE_VERSION}`,
        `adapter-interface ${ADAPTER_INTERFACE_VERSION}`,
        `dispatched via local_cli`,
        `run ${output.run_id}`,
        `turn ${output.turn_id}`,
      ].join('\n') + '\n',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  if (jsonMode) {
    process.stdout.write(`${JSON.stringify({ result: 'fail', error: message })}\n`);
  } else {
    process.stderr.write(`FAIL: ${message}\n`);
  }
  process.exitCode = 1;
});
