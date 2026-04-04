#!/usr/bin/env node

/**
 * CI Runner Proof — executes one governed turn using only the runner interface.
 *
 * This is a second runner. It does NOT shell out to any CLI command. It imports the runner-interface library directly and drives the
 * governed state machine programmatically.
 *
 * Usage:
 *   node examples/ci-runner-proof/run-one-turn.mjs [--json]
 *
 * Exit codes:
 *   0 — turn executed, all artifacts valid
 *   1 — turn execution failed or artifact validation failed
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes, createHash } from 'crypto';
import { fileURLToPath } from 'url';

// ── Import ONLY from the declared runner interface ──────────────────────────
// This is the proof boundary: no CLI, no Commander, no chalk.
const cliRoot = join(fileURLToPath(import.meta.url), '..', '..', '..', 'cli');

const {
  initRun,
  assignTurn,
  acceptTurn,
  RUNNER_INTERFACE_VERSION,
} = await import(join(cliRoot, 'src', 'lib', 'runner-interface.js'));

const { getTurnStagingResultPath } = await import(
  join(cliRoot, 'src', 'lib', 'turn-paths.js')
);

// ── Config ──────────────────────────────────────────────────────────────────

const jsonMode = process.argv.includes('--json');

function makeConfig() {
  return {
    schema_version: 4,
    protocol_mode: 'governed',
    project: { id: 'ci-runner-proof', name: 'CI Runner Proof', default_branch: 'main' },
    roles: {
      pm: {
        title: 'PM',
        mandate: 'Plan',
        write_authority: 'review_only',
        runtime_class: 'manual',
        runtime_id: 'manual-pm',
      },
      dev: {
        title: 'Dev',
        mandate: 'Build',
        write_authority: 'authoritative',
        runtime_class: 'local_cli',
        runtime_id: 'local-dev',
      },
      qa: {
        title: 'QA',
        mandate: 'Verify',
        write_authority: 'review_only',
        runtime_class: 'api_proxy',
        runtime_id: 'api-qa',
      },
    },
    runtimes: {
      'manual-pm': { type: 'manual' },
      'local-dev': { type: 'local_cli' },
      'api-qa': { type: 'api_proxy' },
    },
    routing: {
      planning: {
        entry_role: 'pm',
        allowed_next_roles: ['pm', 'dev', 'human'],
        exit_gate: 'planning_signoff',
      },
      implementation: {
        entry_role: 'dev',
        allowed_next_roles: ['dev', 'qa', 'human'],
        exit_gate: 'implementation_complete',
      },
      qa: {
        entry_role: 'qa',
        allowed_next_roles: ['dev', 'qa', 'human'],
        exit_gate: 'qa_ship_verdict',
      },
    },
    gates: {},
    budget: { per_turn_max_usd: 2.0, per_run_max_usd: 50.0 },
    rules: { challenge_required: true, max_turn_retries: 2, max_deadlock_cycles: 2 },
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
  writeFileSync(join(root, 'agentxchain.json'), JSON.stringify(config, null, 2));
  mkdirSync(join(root, '.agentxchain'), { recursive: true });
  writeFileSync(
    join(root, '.agentxchain/state.json'),
    JSON.stringify(
      {
        schema_version: '1.1',
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
  writeFileSync(join(root, '.agentxchain/history.jsonl'), '');
  writeFileSync(join(root, '.agentxchain/decision-ledger.jsonl'), '');
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
    summary: 'CI runner proof: one governed turn executed via runner-interface.js.',
    decisions: [
      {
        id: 'DEC-001',
        category: 'implementation',
        statement: 'Used runner interface directly — no CLI shell-out.',
        rationale: 'Proving PROTOCOL-v6.md section 3: runner independence.',
      },
    ],
    objections: [
      {
        id: 'OBJ-001',
        severity: 'low',
        statement: 'No concerns — this is a proof-of-concept turn.',
        status: 'raised',
      },
    ],
    files_changed: [],
    artifacts_created: [],
    verification: {
      status: 'pass',
      commands: ['node run-one-turn.mjs'],
      evidence_summary: 'CI runner proof passed.',
      machine_evidence: [
        { command: 'node run-one-turn.mjs', exit_code: 0 },
      ],
    },
    artifact: { type: 'review', ref: null },
    proposed_next_role: 'dev',
    phase_transition_request: null,
    needs_human_reason: null,
    cost: { input_tokens: 0, output_tokens: 0, usd: 0 },
  };
}

function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

function readJsonl(path) {
  const content = readFileSync(path, 'utf8').trim();
  if (!content) return [];
  return content.split('\n').map((line) => JSON.parse(line));
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const root = join(tmpdir(), `axc-ci-runner-${randomBytes(6).toString('hex')}`);
  mkdirSync(root, { recursive: true });

  const errors = [];

  try {
    // 1. Scaffold
    const config = scaffoldProject(root);

    // 2. Init
    const runResult = initRun(root, config);
    if (!runResult.ok) {
      errors.push(`initRun failed: ${runResult.error}`);
      return report(root, errors, null, null);
    }
    const runId = runResult.state.run_id;

    // 3. Assign
    const assignResult = assignTurn(root, config, 'pm');
    if (!assignResult.ok) {
      errors.push(`assignTurn failed: ${assignResult.error}`);
      return report(root, errors, runId, null);
    }
    const turn = assignResult.turn;
    if (!turn || !turn.turn_id) {
      errors.push('assignTurn did not return a turn at top level');
      return report(root, errors, runId, null);
    }

    // 4. Stage turn result (this is what an adapter/agent would produce)
    const result = makeTurnResult(runId, turn);
    const stagingDir = join(root, '.agentxchain/staging', turn.turn_id);
    mkdirSync(stagingDir, { recursive: true });
    const stagingPath = join(root, getTurnStagingResultPath(turn.turn_id));
    writeFileSync(stagingPath, JSON.stringify(result, null, 2));

    // 5. Accept
    const acceptResult = acceptTurn(root, config);
    if (!acceptResult.ok) {
      errors.push(`acceptTurn failed: ${acceptResult.error}`);
      return report(root, errors, runId, turn.turn_id);
    }

    // 6. Validate artifacts
    const artifacts = validateArtifacts(root);
    if (artifacts.errors.length > 0) {
      errors.push(...artifacts.errors);
    }

    return report(root, errors, runId, turn.turn_id, artifacts);
  } catch (err) {
    errors.push(`Unexpected error: ${err.message}`);
    return report(root, errors, null, null);
  }
}

function validateArtifacts(root) {
  const result = { state: null, history: null, ledger: null, errors: [] };

  // State
  const statePath = join(root, '.agentxchain/state.json');
  if (!existsSync(statePath)) {
    result.errors.push('state.json does not exist after acceptance');
  } else {
    const raw = readFileSync(statePath, 'utf8');
    try {
      const state = JSON.parse(raw);
      result.state = {
        valid: !!(state.run_id && state.schema_version && state.status && state.phase),
        sha256: sha256(raw),
      };
      if (!result.state.valid) {
        result.errors.push('state.json missing required fields');
      }
    } catch {
      result.errors.push('state.json is not valid JSON');
    }
  }

  // History
  const historyPath = join(root, '.agentxchain/history.jsonl');
  if (!existsSync(historyPath)) {
    result.errors.push('history.jsonl does not exist after acceptance');
  } else {
    const entries = readJsonl(historyPath);
    result.history = {
      valid: entries.length >= 1 && !!entries[0].turn_id && !!entries[0].role,
      entry_count: entries.length,
    };
    if (!result.history.valid) {
      result.errors.push('history.jsonl has no valid entries after acceptance');
    }
  }

  // Decision ledger
  const ledgerPath = join(root, '.agentxchain/decision-ledger.jsonl');
  if (!existsSync(ledgerPath)) {
    result.errors.push('decision-ledger.jsonl does not exist after acceptance');
  } else {
    const entries = readJsonl(ledgerPath);
    result.ledger = {
      valid: entries.length >= 1,
      entry_count: entries.length,
    };
    if (!result.ledger.valid) {
      result.errors.push('decision-ledger.jsonl has no entries after acceptance');
    }
  }

  return result;
}

function report(root, errors, runId, turnId, artifacts) {
  const passed = errors.length === 0;

  // Clean up temp dir
  try {
    rmSync(root, { recursive: true, force: true });
  } catch {}

  if (jsonMode) {
    const output = {
      runner: 'ci-runner-proof',
      runner_interface_version: RUNNER_INTERFACE_VERSION,
      result: passed ? 'pass' : 'fail',
      run_id: runId,
      turn_id: turnId,
      role: 'pm',
      artifacts: artifacts
        ? {
            state: artifacts.state,
            history: artifacts.history,
            ledger: artifacts.ledger,
          }
        : null,
      errors: errors.length > 0 ? errors : undefined,
    };
    process.stdout.write(JSON.stringify(output, null, 2) + '\n');
  } else {
    const lines = [
      `CI Runner Proof — AgentXchain runner-interface v${RUNNER_INTERFACE_VERSION}`,
      `  Project: ci-runner-proof`,
      `  Init:    ${runId ? 'ok' : 'FAIL'} (run_id: ${runId || 'none'})`,
      `  Assign:  ${turnId ? 'ok' : 'FAIL'} (turn_id: ${turnId || 'none'}, role: pm)`,
      `  Accept:  ${passed && artifacts ? 'ok' : 'FAIL'}`,
    ];
    if (artifacts) {
      lines.push(`  Artifacts:`);
      lines.push(
        `    state.json:            ${artifacts.state?.valid ? 'valid' : 'INVALID'} (sha256: ${artifacts.state?.sha256 || 'none'})`,
      );
      lines.push(
        `    history.jsonl:         ${artifacts.history?.valid ? 'valid' : 'INVALID'} (${artifacts.history?.entry_count || 0} entries)`,
      );
      lines.push(
        `    decision-ledger.jsonl: ${artifacts.ledger?.valid ? 'valid' : 'INVALID'} (${artifacts.ledger?.entry_count || 0} entries)`,
      );
    }
    if (errors.length > 0) {
      lines.push(`  Errors:`);
      for (const e of errors) lines.push(`    - ${e}`);
    }
    lines.push(
      `  Result: ${passed ? 'PASS' : 'FAIL'} — ${passed ? 'one governed turn executed via runner interface, no CLI shell-out' : 'proof failed'}`,
    );
    process.stdout.write(lines.join('\n') + '\n');
  }

  process.exit(passed ? 0 : 1);
}

main();
