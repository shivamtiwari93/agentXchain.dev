#!/usr/bin/env node

/**
 * CI API Dispatch Proof — proves that a governed run completes end-to-end
 * in CI using real model dispatch via the api_proxy adapter.
 *
 * This is the LIGHTS-OUT proof: no human terminal, no interactive gates,
 * no synthetic turn results. A real model produces real governed artifacts.
 *
 * Usage:
 *   node examples/ci-runner-proof/run-with-api-dispatch.mjs [--json]
 *
 * Environment:
 *   ANTHROPIC_API_KEY — required for api_proxy dispatch
 *
 * Exit codes:
 *   0 — governed lifecycle completed via real API dispatch
 *   1 — any step failed
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { randomBytes, createHash } from 'crypto';
import { fileURLToPath } from 'url';
import { gitInit, gitCommitAll } from './git-helpers.mjs';

const jsonMode = process.argv.includes('--json');
const cliRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'cli');

const { runLoop } = await import(join(cliRoot, 'src', 'lib', 'run-loop.js'));
const { RUNNER_INTERFACE_VERSION, loadState } = await import(
  join(cliRoot, 'src', 'lib', 'runner-interface.js')
);
const { dispatchApiProxy } = await import(
  join(cliRoot, 'src', 'lib', 'adapters', 'api-proxy-adapter.js')
);
const { finalizeDispatchManifest } = await import(
  join(cliRoot, 'src', 'lib', 'dispatch-manifest.js')
);
const {
  getTurnStagingResultPath,
  getDispatchTurnDir,
  getDispatchAssignmentPath,
  getDispatchPromptPath,
  getDispatchContextPath,
  getDispatchEffectiveContextPath,
} = await import(join(cliRoot, 'src', 'lib', 'turn-paths.js'));

// ── Config ─────────────────────────────────────────────────────────────────

function makeConfig() {
  return {
    schema_version: 4,
    protocol_mode: 'governed',
    project: {
      id: `ci-api-dispatch-proof-${randomBytes(4).toString('hex')}`,
      name: 'CI API Dispatch Proof',
      description: 'Build a hello-world Node.js HTTP server that responds with "Hello, AgentXchain!" on GET /.',
      default_branch: 'main',
    },
    roles: {
      planner: {
        title: 'Planner',
        mandate: 'The task is: build a hello-world Node.js HTTP server that responds with "Hello, AgentXchain!" on GET /. Produce a one-paragraph plan for this task. Then set phase_transition_request to "review".',
        write_authority: 'review_only',
        runtime_class: 'api_proxy',
        runtime_id: 'api-planner',
      },
      reviewer: {
        title: 'Reviewer',
        mandate: 'Review the plan produced by the planner for the hello-world server task. Confirm it is reasonable. Then set run_completion_request to true.',
        write_authority: 'review_only',
        runtime_class: 'api_proxy',
        runtime_id: 'api-reviewer',
      },
    },
    runtimes: {
      'api-planner': {
        type: 'api_proxy',
        provider: 'anthropic',
        model: 'claude-haiku-4-5-20251001',
        auth_env: 'ANTHROPIC_API_KEY',
        max_output_tokens: 2048,
        timeout_seconds: 60,
      },
      'api-reviewer': {
        type: 'api_proxy',
        provider: 'anthropic',
        model: 'claude-haiku-4-5-20251001',
        auth_env: 'ANTHROPIC_API_KEY',
        max_output_tokens: 2048,
        timeout_seconds: 60,
      },
    },
    routing: {
      planning: {
        entry_role: 'planner',
        allowed_next_roles: ['planner', 'reviewer', 'human'],
        exit_gate: 'planning_done',
      },
      review: {
        entry_role: 'reviewer',
        allowed_next_roles: ['planner', 'reviewer', 'human'],
        exit_gate: 'review_done',
      },
    },
    gates: {
      planning_done: {
        // No requires_files, no requires_human_approval — auto-advance
      },
      review_done: {
        // No requires_files, no requires_human_approval — auto-advance
      },
    },
    budget: { per_turn_max_usd: 0.50, per_run_max_usd: 2.00 },
    rules: { challenge_required: false, max_turn_retries: 3, max_deadlock_cycles: 1 },
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

// ── Scaffolding ────────────────────────────────────────────────────────────

function scaffoldProject(root) {
  const config = makeConfig();
  mkdirSync(join(root, '.agentxchain'), { recursive: true });
  mkdirSync(join(root, '.planning'), { recursive: true });
  writeFileSync(join(root, 'agentxchain.json'), JSON.stringify(config, null, 2));
  writeFileSync(
    join(root, '.agentxchain/state.json'),
    JSON.stringify(
      {
        schema_version: '1.1',
        project_id: config.project.id,
        status: 'idle',
        phase: 'planning',
        run_id: null,
        turn_sequence: 0,
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
  writeFileSync(join(root, 'TALK.md'), '# Talk\n\n## Task\n\nBuild a hello-world Node.js HTTP server that responds with "Hello, AgentXchain!" on GET /.\n');
  gitInit(root);
  return config;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

function readJsonl(path) {
  const content = readFileSync(path, 'utf8').trim();
  if (!content) return [];
  return content.split('\n').map((line) => JSON.parse(line));
}

// ── Callbacks ──────────────────────────────────────────────────────────────

function makeCallbacks(root) {
  return {
    selectRole(state, cfg) {
      // Select the entry_role for the current phase — mirrors run.js behavior
      const phase = state.phase;
      const routing = cfg.routing?.[phase];
      if (!routing?.entry_role) return null;
      return routing.entry_role;
    },

    async dispatch(ctx) {
      const { turn, state, config: cfg, root: projectRoot } = ctx;
      const turnId = turn.turn_id;

      // Finalize dispatch manifest (same as run.js)
      const manifestResult = finalizeDispatchManifest(projectRoot, turnId, {
        run_id: state.run_id,
        role: turn.assigned_role,
      });
      if (!manifestResult.ok) {
        return { accept: false, reason: `dispatch manifest failed: ${manifestResult.error}` };
      }

      // Dispatch via real api_proxy adapter
      const adapterResult = await dispatchApiProxy(projectRoot, state, cfg, {
        verifyManifest: true,
      });

      if (adapterResult.aborted) {
        return { accept: false, reason: 'dispatch aborted' };
      }
      if (adapterResult.timedOut) {
        return { accept: false, reason: 'dispatch timed out' };
      }
      if (!adapterResult.ok) {
        const errorDetail = adapterResult.classified
          ? `${adapterResult.classified.error_class}: ${adapterResult.classified.recovery}`
          : adapterResult.error;
        return { accept: false, reason: errorDetail || 'adapter dispatch failed' };
      }

      // Read the staged turn result (adapter wrote it)
      const stagingFile = join(projectRoot, getTurnStagingResultPath(turnId));
      if (!existsSync(stagingFile)) {
        return { accept: false, reason: 'adapter completed but no staged result found' };
      }

      let turnResult;
      try {
        turnResult = JSON.parse(readFileSync(stagingFile, 'utf8'));
      } catch (err) {
        return { accept: false, reason: `failed to parse staged result: ${err.message}` };
      }

      // Commit after dispatch so the next turn gets a clean baseline
      gitCommitAll(projectRoot);

      return { accept: true, turnResult };
    },

    async approveGate() {
      // Auto-approve all gates (none require human approval in this config)
      return true;
    },
  };
}

// ── Validation ─────────────────────────────────────────────────────────────

function validateArtifacts(root) {
  const rawState = readFileSync(join(root, '.agentxchain/state.json'), 'utf8');
  const state = JSON.parse(rawState);
  const history = readJsonl(join(root, '.agentxchain/history.jsonl'));
  const ledger = readJsonl(join(root, '.agentxchain/decision-ledger.jsonl'));
  const talk = readFileSync(join(root, 'TALK.md'), 'utf8');

  return {
    state: {
      valid: state.status === 'completed' && Boolean(state.completed_at),
      sha256: sha256(rawState),
      status: state.status,
      phase: state.phase,
    },
    history: {
      valid: history.length >= 2,
      entry_count: history.length,
      roles: history.map((e) => e.role),
    },
    ledger: {
      valid: ledger.length >= 2,
      entry_count: ledger.length,
    },
    talk: {
      valid: ['planner', 'reviewer'].every((role) => talk.includes(role)),
      sha256: sha256(talk),
    },
    cost: {
      total_usd: history.reduce((sum, e) => sum + (e.cost?.usd || 0), 0),
      per_turn: history.map((e) => ({ role: e.role, usd: e.cost?.usd || 0 })),
      real_api_calls: history.filter((e) => (e.cost?.usd || 0) > 0).length,
    },
  };
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const root = join(tmpdir(), `axc-ci-api-dispatch-${randomBytes(6).toString('hex')}`);
  const errors = [];

  try {
    mkdirSync(root, { recursive: true });
    const config = scaffoldProject(root);
    const callbacks = makeCallbacks(root);

    // Capture events
    const events = [];
    callbacks.onEvent = (evt) => {
      events.push(evt);
      if (evt.type === 'turn_accepted' || evt.type === 'gate_approved') {
        gitCommitAll(root);
      }
    };

    // Run the governed loop with real API dispatch
    const result = await runLoop(root, config, callbacks, { maxTurns: 6 });

    // Validate result
    if (!result.ok) {
      errors.push(`runLoop returned ok: false, stop_reason: ${result.stop_reason}`);
      if (result.errors?.length > 0) errors.push(...result.errors);
    }

    if (result.stop_reason !== 'completed') {
      errors.push(`expected stop_reason "completed", got "${result.stop_reason}"`);
    }

    if ((result.turns_executed || 0) < 2) {
      errors.push(`expected at least 2 turns executed, got ${result.turns_executed}`);
    }

    // Validate governed artifacts
    let artifacts = null;
    try {
      artifacts = validateArtifacts(root);

      if (!artifacts.state.valid) errors.push('final state artifact is invalid');
      if (!artifacts.history.valid) errors.push('history does not contain at least 2 accepted turns');
      if (!artifacts.ledger.valid) errors.push('decision ledger does not contain at least 2 entries');
      if (!artifacts.talk.valid) errors.push('TALK.md does not include all role entries');

      // Key differentiator from synthetic proofs: real API cost > 0
      if (artifacts.cost.real_api_calls < 2) {
        errors.push(
          `expected at least 2 turns with real API cost, got ${artifacts.cost.real_api_calls} — this would be 0 with synthetic dispatch`,
        );
      }
    } catch (err) {
      errors.push(`artifact validation failed: ${err.message}`);
    }

    return report(root, {
      errors,
      result,
      events,
      artifacts,
    });
  } catch (err) {
    errors.push(`Unexpected error: ${err.message}`);
    return report(root, { errors, result: null, events: [], artifacts: null });
  }
}

function report(root, { errors, result, events, artifacts }) {
  const passed = errors.length === 0;
  const roles = result?.turn_history?.filter((t) => t.accepted).map((t) => t.role) || [];

  try {
    rmSync(root, { recursive: true, force: true });
  } catch {}

  return {
    passed,
    payload: {
      runner: 'ci-api-dispatch-proof',
      runner_interface_version: RUNNER_INTERFACE_VERSION,
      result: passed ? 'pass' : 'fail',
      stop_reason: result?.stop_reason || null,
      turns_executed: result?.turns_executed || 0,
      roles,
      gates_approved: result?.gates_approved || 0,
      turn_history: result?.turn_history || [],
      event_types: [...new Set(events.map((e) => e.type))],
      event_count: events.length,
      artifacts: artifacts
        ? {
            state: artifacts.state,
            history: { entry_count: artifacts.history.entry_count, roles: artifacts.history.roles },
            ledger: { entry_count: artifacts.ledger.entry_count },
            cost: artifacts.cost,
          }
        : null,
      errors,
    },
  };
}

function emitReport({ payload }) {
  if (jsonMode) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else if (payload.result === 'pass') {
    console.log(`CI API Dispatch Proof — AgentXchain runner-interface v${RUNNER_INTERFACE_VERSION}`);
    console.log(`  Run:     ${payload.artifacts?.state?.run_id || 'unknown'}`);
    console.log(`  Roles:   ${payload.roles.join(' -> ')}`);
    console.log(`  Turns:   ${payload.turns_executed} executed`);
    console.log(`  Gates:   ${payload.gates_approved} approved`);
    console.log(`  Cost:    $${payload.artifacts?.cost?.total_usd?.toFixed(4) || '?'} total`);
    console.log(`  Result:  PASS — governed lifecycle completed via real API dispatch`);
  } else {
    console.log(`CI API Dispatch Proof — AgentXchain runner-interface v${RUNNER_INTERFACE_VERSION}`);
    console.log(`  Result:  FAIL`);
    for (const error of payload.errors) {
      console.log(`  Error:   ${error}`);
    }
  }
}

// Retry wrapper: cheap models have transient hallucination failures
// (run_id digit flips, invalid enum values). Retry up to MAX_ATTEMPTS.
const MAX_ATTEMPTS = 3;
const attempts = [];
for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
  const outcome = await main();
  attempts.push({
    attempt,
    result: outcome.passed ? 'pass' : 'fail',
    stop_reason: outcome.payload.stop_reason,
    errors: outcome.payload.errors,
  });
  if (outcome.passed) {
    if (jsonMode) {
      outcome.payload.attempts_used = attempt;
      outcome.payload.attempt_history = attempts;
    }
    emitReport(outcome);
    process.exit(0);
  }
  if (attempt < MAX_ATTEMPTS) {
    if (!jsonMode) console.log(`\n  Retrying (attempt ${attempt + 1}/${MAX_ATTEMPTS})...\n`);
  }
}
emitReport({
  payload: {
    runner: 'ci-api-dispatch-proof',
    runner_interface_version: RUNNER_INTERFACE_VERSION,
    result: 'fail',
    stop_reason: attempts[attempts.length - 1]?.stop_reason || null,
    attempts_used: attempts.length,
    attempt_history: attempts,
    errors: attempts[attempts.length - 1]?.errors || ['Proof failed without a captured error.'],
  },
});
process.exit(1);
