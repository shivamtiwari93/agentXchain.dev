#!/usr/bin/env node

/**
 * CI Run-Loop Composition Proof — proves that the runLoop library composes
 * governed execution correctly as a reusable engine.
 *
 * This is a SEPARATE proof boundary from run-to-completion.mjs:
 *   - run-to-completion.mjs validates primitive runner-interface operations
 *   - this script validates runLoop library composition
 *
 * Usage:
 *   node examples/ci-runner-proof/run-with-run-loop.mjs [--json]
 *
 * Exit codes:
 *   0 — lifecycle completed via runLoop, all assertions passed
 *   1 — any assertion failed
 */

import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';
import { fileURLToPath } from 'url';

const jsonMode = process.argv.includes('--json');
const cliRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'cli');

const { runLoop } = await import(join(cliRoot, 'src', 'lib', 'run-loop.js'));
const { RUNNER_INTERFACE_VERSION } = await import(join(cliRoot, 'src', 'lib', 'runner-interface.js'));

// ── Config ─────────────────────────────────────────────────────────────────

function makeConfig() {
  return {
    schema_version: 4,
    protocol_mode: 'governed',
    project: {
      id: `ci-runloop-proof-${randomBytes(4).toString('hex')}`,
      name: 'CI Run-Loop Composition Proof',
      default_branch: 'main',
    },
    roles: {
      pm: {
        title: 'PM',
        mandate: 'Plan with concrete gate-ready artifacts.',
        write_authority: 'review_only',
        runtime_class: 'manual',
        runtime_id: 'manual-pm',
      },
      dev: {
        title: 'Dev',
        mandate: 'Implement the approved work safely.',
        write_authority: 'authoritative',
        runtime_class: 'local_cli',
        runtime_id: 'local-dev',
      },
      qa: {
        title: 'QA',
        mandate: 'Challenge correctness and decide ship readiness.',
        write_authority: 'review_only',
        runtime_class: 'manual',
        runtime_id: 'manual-qa',
      },
    },
    runtimes: {
      'manual-pm': { type: 'manual' },
      'local-dev': { type: 'local_cli' },
      'manual-qa': { type: 'manual' },
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
    gates: {
      planning_signoff: {
        requires_files: ['.planning/PM_SIGNOFF.md', '.planning/ROADMAP.md'],
        requires_human_approval: true,
      },
      implementation_complete: {
        requires_verification_pass: true,
        // No requires_human_approval — auto-advances
      },
      qa_ship_verdict: {
        requires_files: ['.planning/acceptance-matrix.md', '.planning/ship-verdict.md'],
        requires_human_approval: true,
      },
    },
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

// ── Scaffolding ────────────────────────────────────────────────────────────

function scaffoldProject(root) {
  const config = makeConfig();
  mkdirSync(join(root, '.agentxchain'), { recursive: true });
  mkdirSync(join(root, '.planning'), { recursive: true });
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'agentxchain.json'), JSON.stringify(config, null, 2));
  writeFileSync(join(root, '.agentxchain/state.json'), JSON.stringify({
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
  }, null, 2));
  writeFileSync(join(root, '.agentxchain/history.jsonl'), '');
  writeFileSync(join(root, '.agentxchain/decision-ledger.jsonl'), '');
  writeFileSync(join(root, 'TALK.md'), '# Talk\n');
  return config;
}

function ensureFiles(root, files) {
  for (const [relPath, content] of Object.entries(files)) {
    const absPath = join(root, relPath);
    mkdirSync(dirname(absPath), { recursive: true });
    writeFileSync(absPath, content);
  }
}

// ── Turn result builder ────────────────────────────────────────────────────

function makeTurnResult(turn, state, opts) {
  return {
    schema_version: '1.0',
    run_id: state?.run_id || 'unknown',
    turn_id: turn.turn_id,
    role: turn.assigned_role,
    runtime_id: turn.runtime_id,
    status: 'completed',
    summary: opts.summary,
    decisions: [{
      id: 'DEC-001',
      category: 'implementation',
      statement: `${turn.assigned_role} completed governed slice.`,
      rationale: 'Run-loop composition proof.',
    }],
    objections: [{
      id: 'OBJ-001',
      severity: 'low',
      statement: `Proof objection by ${turn.assigned_role}.`,
      status: 'raised',
    }],
    files_changed: opts.filesChanged || [],
    artifacts_created: [],
    verification: {
      status: 'pass',
      commands: ['echo ok'],
      evidence_summary: `${turn.assigned_role} proof passed.`,
      machine_evidence: [{ command: 'echo ok', exit_code: 0 }],
    },
    artifact: { type: opts.artifactType || 'workspace', ref: null },
    proposed_next_role: opts.proposedNextRole,
    phase_transition_request: opts.phaseTransitionRequest || null,
    run_completion_request: opts.runCompletionRequest || null,
    needs_human_reason: null,
    cost: { input_tokens: 0, output_tokens: 0, usd: 0 },
  };
}

// ── Callbacks ──────────────────────────────────────────────────────────────

function makeCallbacks(root) {
  const ROLE_SEQUENCE = ['pm', 'dev', 'qa'];
  let roleIndex = 0;
  let devAttempts = 0;

  return {
    selectRole(state) {
      if (roleIndex >= ROLE_SEQUENCE.length) return null;
      return ROLE_SEQUENCE[roleIndex];
    },

    async dispatch(ctx) {
      const role = ctx.turn.assigned_role;

      if (role === 'pm') {
        roleIndex++;
        ensureFiles(root, {
          '.planning/PM_SIGNOFF.md': '# PM Signoff\nApproved: YES\n',
          '.planning/ROADMAP.md': '# Roadmap\n## Slice\nRun-loop composition proof.\n',
        });
        return {
          accept: true,
          turnResult: makeTurnResult(ctx.turn, ctx.state, {
            summary: 'PM prepared planning artifacts and requested implementation.',
            proposedNextRole: 'human',
            phaseTransitionRequest: 'implementation',
            filesChanged: ['.planning/PM_SIGNOFF.md', '.planning/ROADMAP.md'],
            artifactType: 'review',
          }),
        };
      }

      if (role === 'dev') {
        devAttempts++;
        if (devAttempts === 1) {
          // First attempt: reject to prove retry semantics
          return {
            accept: false,
            reason: 'Simulated rejection to prove run-loop retry composition',
          };
        }
        // Second attempt: accept
        roleIndex++;
        ensureFiles(root, {
          'src/proof-output.js': 'export const runLoopProof = true;\n',
        });
        return {
          accept: true,
          turnResult: makeTurnResult(ctx.turn, ctx.state, {
            summary: 'Dev implemented after retry, advancing to QA.',
            proposedNextRole: 'qa',
            phaseTransitionRequest: 'qa',
            filesChanged: ['src/proof-output.js'],
          }),
        };
      }

      if (role === 'qa') {
        roleIndex++;
        ensureFiles(root, {
          '.planning/acceptance-matrix.md': '# Acceptance Matrix\nAll proof assertions passed.\n',
          '.planning/ship-verdict.md': '# Ship Verdict\n\n## Verdict: YES\n',
        });
        return {
          accept: true,
          turnResult: makeTurnResult(ctx.turn, ctx.state, {
            summary: 'QA approved and requested governed completion.',
            proposedNextRole: 'human',
            runCompletionRequest: true,
            filesChanged: ['.planning/acceptance-matrix.md', '.planning/ship-verdict.md'],
            artifactType: 'review',
          }),
        };
      }

      return { accept: false, reason: `Unknown role: ${role}` };
    },

    async approveGate(gateType, state) {
      // Approve all human-required gates
      return true;
    },
  };
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const root = join(tmpdir(), `axc-runloop-proof-${randomBytes(6).toString('hex')}`);
  const errors = [];

  try {
    mkdirSync(root, { recursive: true });
    const config = scaffoldProject(root);

    // Capture events
    const events = [];
    const callbacks = makeCallbacks(root);
    callbacks.onEvent = (evt) => events.push(evt);

    // Run the loop
    const result = await runLoop(root, config, callbacks);

    // Validate
    if (!result.ok) {
      errors.push(`runLoop returned ok: false, stop_reason: ${result.stop_reason}`);
      if (result.errors.length > 0) errors.push(...result.errors);
    }

    if (result.stop_reason !== 'completed') {
      errors.push(`expected stop_reason "completed", got "${result.stop_reason}"`);
    }

    if (result.turns_executed !== 3) {
      errors.push(`expected 3 turns executed, got ${result.turns_executed}`);
    }

    const roles = result.turn_history.filter(t => t.accepted).map(t => t.role);
    if (roles.join(',') !== 'pm,dev,qa') {
      errors.push(`expected accepted roles [pm, dev, qa], got [${roles.join(', ')}]`);
    }

    if (result.gates_approved !== 2) {
      errors.push(`expected 2 gates approved, got ${result.gates_approved}`);
    }

    const rejections = result.turn_history.filter(t => !t.accepted);
    if (rejections.length !== 1) {
      errors.push(`expected 1 rejection, got ${rejections.length}`);
    }

    if (rejections.length === 1 && rejections[0].role !== 'dev') {
      errors.push(`expected rejection for dev, got ${rejections[0].role}`);
    }

    // Same turn_id for rejection and acceptance of dev
    const devEntries = result.turn_history.filter(t => t.role === 'dev');
    if (devEntries.length === 2) {
      if (devEntries[0].turn_id !== devEntries[1].turn_id) {
        errors.push('dev rejection and retry must share the same turn_id');
      }
    }

    const expectedEventTypes = ['turn_assigned', 'turn_accepted', 'turn_rejected', 'gate_paused', 'gate_approved', 'completed'];
    const capturedTypes = [...new Set(events.map(e => e.type))];
    for (const expected of expectedEventTypes) {
      if (!capturedTypes.includes(expected)) {
        errors.push(`missing event type: ${expected}`);
      }
    }

    if (result.state?.status !== 'completed') {
      errors.push(`expected final state status "completed", got "${result.state?.status}"`);
    }

    return report(root, {
      errors,
      result,
      events,
      rejections,
      capturedTypes,
    });
  } catch (err) {
    errors.push(`Unexpected error: ${err.message}`);
    return report(root, { errors, result: null, events: [], rejections: [], capturedTypes: [] });
  }
}

function report(root, { errors, result, events, rejections, capturedTypes }) {
  const passed = errors.length === 0;

  try {
    rmSync(root, { recursive: true, force: true });
  } catch {}

  if (jsonMode) {
    const roles = result?.turn_history?.filter(t => t.accepted).map(t => t.role) || [];
    process.stdout.write(JSON.stringify({
      runner: 'ci-run-loop-composition-proof',
      runner_interface_version: RUNNER_INTERFACE_VERSION,
      result: passed ? 'pass' : 'fail',
      stop_reason: result?.stop_reason || null,
      turns_executed: result?.turns_executed || 0,
      roles,
      gates_approved: result?.gates_approved || 0,
      turn_history: result?.turn_history || [],
      rejection_count: rejections?.length || 0,
      event_types: capturedTypes || [],
      event_count: events?.length || 0,
      errors,
    }, null, 2));
  } else if (passed) {
    const roles = result.turn_history.filter(t => t.accepted).map(t => t.role);
    console.log(`CI Run-Loop Composition Proof — AgentXchain run-loop v${RUNNER_INTERFACE_VERSION}`);
    console.log(`  Run:     ${result.state?.run_id || 'unknown'}`);
    console.log(`  Roles:   ${roles.join(' -> ')}`);
    console.log(`  Reject:  ${rejections.length} rejection, retry on same turn_id`);
    console.log(`  Gates:   phase_transition=approved, run_completion=approved`);
    console.log(`  Events:  ${events.length} lifecycle events captured`);
    console.log(`  Result:  PASS — runLoop drove governed lifecycle to completion`);
  } else {
    console.log(`CI Run-Loop Composition Proof — AgentXchain run-loop v${RUNNER_INTERFACE_VERSION}`);
    console.log(`  Result:  FAIL`);
    for (const error of errors) {
      console.log(`  Error:   ${error}`);
    }
  }

  process.exit(passed ? 0 : 1);
}

await main();
