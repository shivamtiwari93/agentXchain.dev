#!/usr/bin/env node

/**
 * CI Multi-Phase Write-Owning Proof — proves that a governed run with 3 phases,
 * at least one write-owning (proposed) turn, and a real gate artifact check
 * can complete end-to-end in CI using real model dispatch.
 *
 * This widens the lights-out proof from 2-phase review-only to 3-phase with
 * real file mutations and gate-driven phase advancement.
 *
 * Phases: planning → implementation → qa
 * Roles:  planner (review_only), implementer (proposed), qa (review_only)
 * Gate:   implementation_gate requires src/server.js in workspace
 *
 * The proof harness applies proposed changes to the workspace during dispatch,
 * acting as the CI operator (same role as `agentxchain proposal apply`).
 *
 * Usage:
 *   node examples/ci-runner-proof/run-multi-phase-write.mjs [--json]
 *
 * Environment:
 *   ANTHROPIC_API_KEY — required for api_proxy dispatch
 *
 * Exit codes:
 *   0 — governed lifecycle completed with write-owning turn and gate artifact
 *   1 — any step failed after all retry attempts
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
} = await import(join(cliRoot, 'src', 'lib', 'turn-paths.js'));

// ── Config ─────────────────────────────────────────────────────────────────

function makeConfig() {
  return {
    schema_version: 4,
    protocol_mode: 'governed',
    project: {
      id: `ci-multi-phase-write-${randomBytes(4).toString('hex')}`,
      name: 'CI Multi-Phase Write Proof',
      description: 'Build a hello-world Node.js HTTP server file at src/server.js that responds with "Hello, AgentXchain!" on GET /.',
      default_branch: 'main',
    },
    roles: {
      planner: {
        title: 'Planner',
        mandate: 'The task is: build a hello-world Node.js HTTP server at src/server.js that responds with "Hello, AgentXchain!" on GET /. Produce a one-paragraph implementation plan. Then set phase_transition_request to "implementation".',
        write_authority: 'review_only',
        runtime_class: 'api_proxy',
        runtime_id: 'api-haiku',
      },
      implementer: {
        title: 'Implementer',
        mandate: 'Implement the hello-world Node.js HTTP server. You MUST include a proposed_changes array with exactly one entry: { "path": "src/server.js", "action": "create", "content": "<full file content>" }. The server must use the built-in http module and respond with "Hello, AgentXchain!" on GET /. After proposing the file, set phase_transition_request to "qa" and set proposed_next_role to "qa".',
        write_authority: 'proposed',
        runtime_class: 'api_proxy',
        runtime_id: 'api-haiku',
      },
      qa: {
        title: 'QA Reviewer',
        mandate: 'Review the proposed implementation of src/server.js. Confirm it uses the http module and responds with "Hello, AgentXchain!" on GET /. Then set run_completion_request to true.',
        write_authority: 'review_only',
        runtime_class: 'api_proxy',
        runtime_id: 'api-haiku',
      },
    },
    runtimes: {
      'api-haiku': {
        type: 'api_proxy',
        provider: 'anthropic',
        model: 'claude-haiku-4-5-20251001',
        auth_env: 'ANTHROPIC_API_KEY',
        max_output_tokens: 4096,
        timeout_seconds: 60,
      },
    },
    routing: {
      planning: {
        entry_role: 'planner',
        allowed_next_roles: ['planner', 'implementer', 'qa', 'human'],
        exit_gate: 'planning_gate',
      },
      implementation: {
        entry_role: 'implementer',
        allowed_next_roles: ['planner', 'implementer', 'qa', 'human'],
        exit_gate: 'implementation_gate',
      },
      qa: {
        entry_role: 'qa',
        allowed_next_roles: ['planner', 'implementer', 'qa', 'human'],
        exit_gate: 'qa_gate',
      },
    },
    gates: {
      planning_gate: {
        // No requires_files — auto-advance after planner review
      },
      implementation_gate: {
        requires_files: ['src/server.js'],
      },
      qa_gate: {
        // Terminal phase — auto-advance on completion
      },
    },
    budget: { per_turn_max_usd: 0.50, per_run_max_usd: 3.00 },
    rules: { challenge_required: false, max_turn_retries: 3, max_deadlock_cycles: 1 },
    workflow_kit: {},
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
  mkdirSync(join(root, 'src'), { recursive: true });
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
  writeFileSync(
    join(root, 'TALK.md'),
    '# Talk\n\n## Task\n\nBuild a hello-world Node.js HTTP server at src/server.js that responds with "Hello, AgentXchain!" on GET /.\n',
  );
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
      const phase = state.phase;
      const routing = cfg.routing?.[phase];
      if (!routing?.entry_role) return null;
      return routing.entry_role;
    },

    async dispatch(ctx) {
      const { turn, state, config: cfg, root: projectRoot } = ctx;
      const turnId = turn.turn_id;

      // Finalize dispatch manifest
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

      // Read the staged turn result
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

      // Apply proposed changes to workspace (CI operator role).
      // This is the equivalent of `agentxchain proposal apply` in a lights-out pipeline.
      // The proof harness acts as the operator — the model produces the content.
      if (Array.isArray(turnResult.proposed_changes)) {
        for (const change of turnResult.proposed_changes) {
          if (change.action === 'delete') continue;
          if (typeof change.content !== 'string' || !change.path) continue;
          const absPath = join(projectRoot, change.path);
          mkdirSync(dirname(absPath), { recursive: true });
          writeFileSync(absPath, change.content);
        }
      }

      // Commit so repo-observer and gate evaluator see the files
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

  // Check for gate artifact in workspace
  const gateArtifactPath = join(root, 'src/server.js');
  const gateArtifactExists = existsSync(gateArtifactPath);
  const gateArtifactContent = gateArtifactExists
    ? readFileSync(gateArtifactPath, 'utf8')
    : null;

  // Check for proposed materialization
  const proposedTurns = history.filter(
    (e) => e.write_authority === 'proposed' || e.role === 'implementer',
  );

  // Distinct phases in history
  const phasesInHistory = [...new Set(history.map((e) => e.phase))];

  return {
    state: {
      valid: state.status === 'completed' && Boolean(state.completed_at),
      sha256: sha256(rawState),
      status: state.status,
      phase: state.phase,
      phase_gate_status: state.phase_gate_status || {},
    },
    history: {
      valid: history.length >= 3,
      entry_count: history.length,
      roles: history.map((e) => e.role),
      phases: phasesInHistory,
    },
    ledger: {
      valid: ledger.length >= 3,
      entry_count: ledger.length,
    },
    talk: {
      valid: ['planner', 'implementer', 'qa'].every((role) => talk.includes(role)),
      sha256: sha256(talk),
    },
    gate_artifact: {
      exists: gateArtifactExists,
      non_trivial: gateArtifactContent ? gateArtifactContent.trim().length > 20 : false,
      size_bytes: gateArtifactContent ? Buffer.byteLength(gateArtifactContent) : 0,
    },
    proposed_turns: {
      count: proposedTurns.length,
      has_write_owning: proposedTurns.length > 0,
    },
    cost: {
      total_usd: history.reduce((sum, e) => sum + (e.cost?.usd || 0), 0),
      per_turn: history.map((e) => ({ role: e.role, phase: e.phase, usd: e.cost?.usd || 0 })),
      real_api_calls: history.filter((e) => (e.cost?.usd || 0) > 0).length,
    },
  };
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const root = join(tmpdir(), `axc-ci-multi-phase-${randomBytes(6).toString('hex')}`);
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
    const result = await runLoop(root, config, callbacks, { maxTurns: 8 });

    // ── AT-CIMPA-001: Three-phase lifecycle completion ──
    if (!result.ok) {
      errors.push(`runLoop returned ok: false, stop_reason: ${result.stop_reason}`);
      if (result.errors?.length > 0) errors.push(...result.errors);
    }
    if (result.stop_reason !== 'completed') {
      errors.push(`expected stop_reason "completed", got "${result.stop_reason}"`);
    }
    if ((result.turns_executed || 0) < 3) {
      errors.push(`expected at least 3 turns executed, got ${result.turns_executed}`);
    }

    // Validate governed artifacts
    let artifacts = null;
    try {
      artifacts = validateArtifacts(root);

      if (!artifacts.state.valid) errors.push('final state artifact is invalid');

      // AT-CIMPA-001: 3+ accepted turns across all 3 phases
      if (!artifacts.history.valid) {
        errors.push('history does not contain at least 3 accepted turns');
      }
      const expectedPhases = ['planning', 'implementation', 'qa'];
      for (const phase of expectedPhases) {
        if (!artifacts.history.phases.includes(phase)) {
          errors.push(`phase "${phase}" missing from history — not a true 3-phase run`);
        }
      }
      const expectedGateStatuses = {
        planning_gate: 'passed',
        implementation_gate: 'passed',
        qa_gate: 'passed',
      };
      for (const [gateId, expectedStatus] of Object.entries(expectedGateStatuses)) {
        const actualStatus = artifacts.state.phase_gate_status?.[gateId];
        if (actualStatus !== expectedStatus) {
          errors.push(
            `phase_gate_status.${gateId} expected "${expectedStatus}", got "${actualStatus || 'missing'}"`,
          );
        }
      }

      if (!artifacts.ledger.valid) {
        errors.push('decision ledger does not contain at least 3 entries');
      }
      if (!artifacts.talk.valid) {
        errors.push('TALK.md does not include all role entries');
      }

      // AT-CIMPA-002: Write-owning turn
      if (!artifacts.proposed_turns.has_write_owning) {
        errors.push('no write-owning (proposed) turn found in history');
      }

      // AT-CIMPA-003: Gate artifact exists and is non-trivial
      if (!artifacts.gate_artifact.exists) {
        errors.push('gate artifact src/server.js does not exist in workspace');
      }
      if (!artifacts.gate_artifact.non_trivial) {
        errors.push('gate artifact src/server.js is empty or trivial (< 20 chars)');
      }

      // AT-CIMPA-004: Real API cost across all phases
      if (artifacts.cost.real_api_calls < 3) {
        errors.push(
          `expected at least 3 turns with real API cost, got ${artifacts.cost.real_api_calls}`,
        );
      }
    } catch (err) {
      errors.push(`artifact validation failed: ${err.message}`);
    }

    return report(root, { errors, result, events, artifacts });
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
      runner: 'ci-multi-phase-write-proof',
      runner_interface_version: RUNNER_INTERFACE_VERSION,
      result: passed ? 'pass' : 'fail',
      stop_reason: result?.stop_reason || null,
      turns_executed: result?.turns_executed || 0,
      roles,
      phases: artifacts?.history?.phases || [],
      gates_approved: result?.gates_approved || 0,
      turn_history: result?.turn_history || [],
      event_types: [...new Set(events.map((e) => e.type))],
      event_count: events.length,
      artifacts: artifacts
        ? {
            state: artifacts.state,
            history: {
              entry_count: artifacts.history.entry_count,
              roles: artifacts.history.roles,
              phases: artifacts.history.phases,
            },
            ledger: { entry_count: artifacts.ledger.entry_count },
            phase_gate_status: artifacts.state.phase_gate_status,
            gate_artifact: artifacts.gate_artifact,
            proposed_turns: artifacts.proposed_turns,
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
    console.log(`CI Multi-Phase Write Proof — AgentXchain runner-interface v${RUNNER_INTERFACE_VERSION}`);
    console.log(`  Phases:  ${payload.phases.join(' → ')}`);
    console.log(`  Roles:   ${payload.roles.join(' → ')}`);
    console.log(`  Turns:   ${payload.turns_executed} executed`);
    console.log(`  Gate approvals paused-for-human: ${payload.gates_approved}`);
    console.log(
      `  Phase gate status: ${Object.entries(payload.artifacts?.phase_gate_status || {})
        .map(([gateId, status]) => `${gateId}=${status}`)
        .join(', ') || 'none'}`,
    );
    console.log(`  Gate artifact: src/server.js (${payload.artifacts?.gate_artifact?.size_bytes || 0} bytes)`);
    console.log(`  Cost:    $${payload.artifacts?.cost?.total_usd?.toFixed(4) || '?'} total`);
    console.log(`  Result:  PASS — 3-phase governed lifecycle with write-owning turn and gate artifact`);
  } else {
    console.log(`CI Multi-Phase Write Proof — AgentXchain runner-interface v${RUNNER_INTERFACE_VERSION}`);
    console.log(`  Result:  FAIL`);
    for (const error of payload.errors) {
      console.log(`  Error:   ${error}`);
    }
  }
}

// ── Retry wrapper ──────────────────────────────────────────────────────────

const MAX_ATTEMPTS = 3;
const attempts = [];
for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
  const outcome = await main();
  attempts.push({
    attempt,
    result: outcome.passed ? 'pass' : 'fail',
    stop_reason: outcome.payload.stop_reason,
    phases: outcome.payload.phases,
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
    runner: 'ci-multi-phase-write-proof',
    runner_interface_version: RUNNER_INTERFACE_VERSION,
    result: 'fail',
    stop_reason: attempts[attempts.length - 1]?.stop_reason || null,
    phases: attempts[attempts.length - 1]?.phases || [],
    attempts_used: attempts.length,
    attempt_history: attempts,
    errors: attempts[attempts.length - 1]?.errors || ['Proof failed without a captured error.'],
  },
});
process.exit(1);
