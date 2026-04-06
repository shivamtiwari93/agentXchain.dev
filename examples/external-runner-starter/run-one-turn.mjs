#!/usr/bin/env node

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
} from 'agentxchain/runner-interface';

const jsonMode = process.argv.includes('--json');

function makeConfig() {
  return {
    schema_version: 4,
    protocol_mode: 'governed',
    project: {
      id: 'external-runner-starter',
      name: 'External Runner Starter',
      default_branch: 'main',
    },
    roles: {
      pm: {
        title: 'PM',
        mandate: 'Plan the next governed slice.',
        write_authority: 'review_only',
        runtime_class: 'manual',
        runtime_id: 'manual-pm',
      },
    },
    runtimes: {
      'manual-pm': { type: 'manual' },
    },
    routing: {
      planning: {
        entry_role: 'pm',
        allowed_next_roles: ['pm', 'human'],
        exit_gate: 'planning_signoff',
      },
    },
    gates: {},
    budget: { per_turn_max_usd: 1.0, per_run_max_usd: 5.0 },
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

function scaffoldProject(root) {
  const config = makeConfig();
  mkdirSync(join(root, '.agentxchain'), { recursive: true });
  writeFileSync(join(root, 'agentxchain.json'), JSON.stringify(config, null, 2));
  writeFileSync(
    join(root, '.agentxchain', 'state.json'),
    JSON.stringify(
      {
        schema_version: '1.1',
        project_id: config.project.id,
        status: 'idle',
        phase: 'planning',
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
  return config;
}

function makeTurnResult(runId, turn) {
  return {
    schema_version: '1.0',
    run_id: runId,
    turn_id: turn.turn_id,
    role: turn.assigned_role,
    runtime_id: turn.runtime_id,
    status: 'completed',
    summary: 'External runner starter proved the installed package boundary.',
    decisions: [
      {
        id: 'DEC-001',
        category: 'implementation',
        statement: 'Imported the runner boundary from the published package export.',
        rationale: 'This is the public package contract for external runner authors.',
      },
    ],
    objections: [
      {
        id: 'OBJ-001',
        severity: 'low',
        statement: 'Starter proof only covers the one-turn primitive.',
        status: 'raised',
      },
    ],
    files_changed: [],
    artifacts_created: [],
    verification: {
      status: 'pass',
      commands: ['node run-one-turn.mjs --json'],
      evidence_summary: 'Installed-package starter completed a governed turn.',
      machine_evidence: [{ command: 'node run-one-turn.mjs --json', exit_code: 0 }],
    },
    artifact: { type: 'review', ref: null },
    proposed_next_role: 'human',
    phase_transition_request: null,
    run_completion_request: null,
    needs_human_reason: null,
    cost: { input_tokens: 0, output_tokens: 0, usd: 0 },
  };
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function main() {
  const root = join(tmpdir(), `axc-external-runner-${randomBytes(6).toString('hex')}`);
  mkdirSync(root, { recursive: true });

  try {
    const config = scaffoldProject(root);
    const initResult = initRun(root, config);
    if (!initResult.ok) throw new Error(`initRun failed: ${initResult.error}`);

    const assignResult = assignTurn(root, config, 'pm');
    if (!assignResult.ok) throw new Error(`assignTurn failed: ${assignResult.error}`);

    const { state, turn } = assignResult;
    const stagedPath = join(root, getTurnStagingResultPath(turn.turn_id));
    mkdirSync(join(root, '.agentxchain', 'staging', turn.turn_id), { recursive: true });
    writeFileSync(stagedPath, JSON.stringify(makeTurnResult(state.run_id, turn), null, 2));

    const acceptResult = acceptTurn(root, config);
    if (!acceptResult.ok) throw new Error(`acceptTurn failed: ${acceptResult.error}`);

    const stateContent = readFileSync(join(root, '.agentxchain', 'state.json'), 'utf8');
    const output = {
      result: 'pass',
      runner: 'external-runner-starter',
      runner_interface_version: RUNNER_INTERFACE_VERSION,
      run_id: acceptResult.state.run_id,
      turn_id: turn.turn_id,
      final_status: acceptResult.state.status,
      state_sha256: sha256(stateContent),
    };

    if (jsonMode) {
      process.stdout.write(`${JSON.stringify(output)}\n`);
      return;
    }

    process.stdout.write(
      [
        'PASS: external runner starter',
        `runner-interface ${RUNNER_INTERFACE_VERSION}`,
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
