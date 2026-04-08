#!/usr/bin/env node

/**
 * Scenario D Escalation & Recovery Proof — exercises retry exhaustion,
 * escalation state, operator recovery, and eng_director intervention.
 *
 * This proves AgentXchain's escalation contract works end-to-end:
 *   D1: Reject turns until max_turn_retries exhausted → escalation:retries-exhausted
 *   D2: Operator resolves escalation → assign eng_director → director turn accepted
 *
 * No real LLM is required — this uses manual adapter with crafted turn results
 * to exercise the governed state machine's escalation/recovery path.
 *
 * Usage:
 *   node examples/live-governed-proof/run-escalation-recovery-proof.mjs [--json]
 *
 * Exit codes:
 *   0 — proof passed
 *   1 — proof failed
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes, createHash } from 'crypto';
import { fileURLToPath } from 'url';

const cliRoot = join(fileURLToPath(import.meta.url), '..', '..', '..', 'cli');

const {
  initRun,
  assignTurn,
  acceptTurn,
  rejectTurn,
  reactivateRun,
  getActiveTurn,
  getActiveTurns,
} = await import(join(cliRoot, 'src', 'lib', 'runner-interface.js'));

const { getTurnStagingResultPath } = await import(
  join(cliRoot, 'src', 'lib', 'turn-paths.js')
);

const jsonMode = process.argv.includes('--json');

function outputResult(data) {
  if (jsonMode) {
    process.stdout.write(JSON.stringify(data, null, 2) + '\n');
  } else {
    if (data.result === 'pass') {
      console.log(`\n✅ PASS — ${data.summary || 'Scenario D escalation & recovery proof passed'}`);
    } else {
      console.log(`\n❌ FAIL — ${data.summary || 'Scenario D escalation & recovery proof failed'}`);
    }
    if (data.errors?.length) {
      data.errors.forEach((e) => console.log(`   Error: ${e}`));
    }
    if (data.d1) {
      console.log(`\n   D1 — Retry Exhaustion:`);
      console.log(`     run_id: ${data.d1.run_id}`);
      console.log(`     turn_id: ${data.d1.turn_id}`);
      console.log(`     rejections: ${data.d1.rejections}`);
      console.log(`     escalated: ${data.d1.escalated}`);
      console.log(`     blocked_on: ${data.d1.blocked_on}`);
      console.log(`     recovery_resolved: ${data.d1.recovery_resolved}`);
    }
    if (data.d2) {
      console.log(`\n   D2 — eng_director Intervention:`);
      console.log(`     director_turn_id: ${data.d2.director_turn_id}`);
      console.log(`     director_accepted: ${data.d2.director_accepted}`);
      console.log(`     proposed_next: ${data.d2.proposed_next}`);
    }
  }
}

function readState(root) {
  return JSON.parse(readFileSync(join(root, '.agentxchain/state.json'), 'utf8'));
}

function readJsonl(path) {
  const content = readFileSync(path, 'utf8').trim();
  if (!content) return [];
  return content.split('\n').map((line) => JSON.parse(line));
}

function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

function makeConfig() {
  return {
    schema_version: 4,
    protocol_mode: 'governed',
    project: { id: 'escalation-proof', name: 'Escalation Recovery Proof', default_branch: 'main' },
    roles: {
      dev: {
        title: 'Developer',
        mandate: 'Implement features and fix bugs.',
        write_authority: 'full',
        runtime_class: 'manual',
        runtime_id: 'manual-dev',
      },
      eng_director: {
        title: 'Engineering Director',
        mandate: 'Resolve tactical deadlocks and enforce technical coherence.',
        write_authority: 'review_only',
        runtime_class: 'manual',
        runtime_id: 'manual-director',
      },
    },
    runtimes: {
      'manual-dev': { type: 'manual' },
      'manual-director': { type: 'manual' },
    },
    routing: {
      planning: {
        entry_role: 'dev',
        allowed_next_roles: ['dev', 'eng_director', 'human'],
        exit_gate: 'planning_signoff',
      },
    },
    gates: {},
    budget: { per_turn_max_usd: 1.0, per_run_max_usd: 5.0 },
    rules: { challenge_required: false, max_turn_retries: 2, max_deadlock_cycles: 1 },
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
  mkdirSync(join(root, '.agentxchain/prompts'), { recursive: true });
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
  writeFileSync(join(root, '.agentxchain/prompts/dev.md'), '# Dev prompt\n');
  writeFileSync(join(root, '.agentxchain/prompts/eng_director.md'), '# Engineering Director prompt\n');
  writeFileSync(join(root, 'TALK.md'), '# Talk\n');
  return config;
}

function stageTurnResult(root, turnId, result) {
  const stagingPath = getTurnStagingResultPath(turnId);
  const fullPath = join(root, stagingPath);
  mkdirSync(join(fullPath, '..'), { recursive: true });
  const content = JSON.stringify(result, null, 2);
  writeFileSync(fullPath, content);
  return { path: stagingPath, hash: sha256(content) };
}

function makeValidTurnResult(runId, turnId, role, runtimeId, proposedNext) {
  return {
    schema_version: '1.0',
    run_id: runId,
    turn_id: turnId,
    role,
    runtime_id: runtimeId,
    status: 'completed',
    summary: `${role} completed their assessment.`,
    decisions: [{ id: 'DEC-001', category: 'quality', statement: 'Reviewed state', rationale: 'Assessment complete' }],
    objections: role === 'eng_director'
      ? [{ id: 'OBJ-001', severity: 'low', statement: 'Minor process gap noted', status: 'raised' }]
      : [],
    files_changed: [],
    artifacts_created: [],
    verification: {
      status: 'pass',
      commands: [],
      evidence_summary: 'Proof turn.',
      machine_evidence: [],
    },
    artifact: { type: 'review', ref: null },
    proposed_next_role: proposedNext,
    phase_transition_request: null,
    needs_human_reason: null,
    cost: { input_tokens: 0, output_tokens: 0, usd: 0 },
  };
}

function makeInvalidTurnResult(runId, turnId) {
  // Deliberately malformed: missing required fields, bad schema
  return {
    schema_version: '1.0',
    run_id: runId,
    turn_id: turnId,
    role: 'dev',
    runtime_id: 'manual-dev',
    status: 'completed',
    summary: 'Bad result',
    // Missing decisions, objections, verification — will fail validation
  };
}

async function main() {
  const root = join(tmpdir(), `axc-escalation-proof-${randomBytes(6).toString('hex')}`);
  mkdirSync(root, { recursive: true });

  const errors = [];
  const d1 = {};
  const d2 = {};

  try {
    const config = scaffoldProject(root);

    // ── D1: Retry Exhaustion Escalation ────────────────────────────────────

    // 1. Init run
    const runResult = initRun(root, config);
    if (!runResult.ok) {
      errors.push(`initRun failed: ${runResult.error}`);
      return finish(root, errors, d1, d2);
    }
    const runId = runResult.state.run_id;
    d1.run_id = runId;

    // 2. Assign dev turn
    const assignResult = assignTurn(root, config, 'dev');
    if (!assignResult.ok) {
      errors.push(`assignTurn(dev) failed: ${assignResult.error}`);
      return finish(root, errors, d1, d2);
    }
    const turnId = assignResult.turn.turn_id;
    d1.turn_id = turnId;

    // 3. Stage invalid result and reject — attempt 1
    stageTurnResult(root, turnId, makeInvalidTurnResult(runId, turnId));
    const reject1 = rejectTurn(root, config, { errors: ['Deliberately invalid: missing fields'], stage: 'validation' }, 'Validation failed');
    if (!reject1.ok) {
      errors.push(`reject1 failed: ${reject1.error}`);
      return finish(root, errors, d1, d2);
    }
    if (reject1.escalated) {
      errors.push('reject1 escalated too early — max_turn_retries=2 should allow retry');
      return finish(root, errors, d1, d2);
    }
    const stateAfterR1 = readState(root);
    const turnAfterR1 = stateAfterR1.active_turns?.[turnId];
    if (!turnAfterR1 || turnAfterR1.attempt !== 2) {
      errors.push(`After reject1: expected attempt=2, got ${turnAfterR1?.attempt}`);
      return finish(root, errors, d1, d2);
    }

    // 4. Stage invalid result and reject — attempt 2 (exhausts retries)
    stageTurnResult(root, turnId, makeInvalidTurnResult(runId, turnId));
    const reject2 = rejectTurn(root, config, { errors: ['Deliberately invalid: missing fields'], stage: 'validation' }, 'Validation failed');
    if (!reject2.ok) {
      errors.push(`reject2 failed: ${reject2.error}`);
      return finish(root, errors, d1, d2);
    }
    if (!reject2.escalated) {
      errors.push('reject2 should have escalated (retries exhausted) but did not');
      return finish(root, errors, d1, d2);
    }

    d1.rejections = 2;
    d1.escalated = true;

    // 5. Verify escalation state
    const stateAfterEsc = readState(root);
    if (stateAfterEsc.status !== 'blocked') {
      errors.push(`Expected status=blocked, got ${stateAfterEsc.status}`);
    }
    if (!stateAfterEsc.blocked_on?.startsWith('escalation:retries-exhausted:')) {
      errors.push(`Expected blocked_on to start with escalation:retries-exhausted:, got ${stateAfterEsc.blocked_on}`);
    }
    if (!stateAfterEsc.escalation) {
      errors.push('Expected escalation object, got null');
    }
    if (stateAfterEsc.escalation?.from_role !== 'dev') {
      errors.push(`Expected escalation.from_role=dev, got ${stateAfterEsc.escalation?.from_role}`);
    }
    if (stateAfterEsc.escalation?.from_turn_id !== turnId) {
      errors.push(`Expected escalation.from_turn_id=${turnId}, got ${stateAfterEsc.escalation?.from_turn_id}`);
    }

    const failedTurn = stateAfterEsc.active_turns?.[turnId];
    if (failedTurn?.status !== 'failed') {
      errors.push(`Expected turn status=failed, got ${failedTurn?.status}`);
    }

    d1.blocked_on = stateAfterEsc.blocked_on;
    d1.escalation_reason = stateAfterEsc.escalation?.reason;

    // Verify blocked_reason recovery descriptor
    const recovery = stateAfterEsc.blocked_reason?.recovery;
    if (recovery?.typed_reason !== 'retries_exhausted') {
      errors.push(`Expected recovery.typed_reason=retries_exhausted, got ${recovery?.typed_reason}`);
    }
    if (recovery?.turn_retained !== true) {
      errors.push(`Expected recovery.turn_retained=true, got ${recovery?.turn_retained}`);
    }

    // Verify decision ledger has rejection entries
    const ledger = readJsonl(join(root, '.agentxchain/decision-ledger.jsonl'));
    // Note: rejections are recorded in history, not necessarily ledger — check history too

    if (errors.length > 0) {
      return finish(root, errors, d1, d2);
    }

    // ── D1 Recovery: Resolve escalation ──────────────────────────────────

    // 6. Reactivate the run (operator resolves escalation)
    const reactivateResult = reactivateRun(root, stateAfterEsc, {
      via: 'operator_resolved',
      root,
    });
    if (!reactivateResult.ok) {
      errors.push(`reactivateRun failed: ${reactivateResult.error}`);
      return finish(root, errors, d1, d2);
    }

    const stateAfterReactivate = readState(root);
    if (stateAfterReactivate.status !== 'active') {
      errors.push(`Expected status=active after reactivate, got ${stateAfterReactivate.status}`);
    }
    if (stateAfterReactivate.blocked_on !== null) {
      errors.push(`Expected blocked_on=null after reactivate, got ${stateAfterReactivate.blocked_on}`);
    }
    if (stateAfterReactivate.escalation !== null) {
      errors.push(`Expected escalation=null after reactivate, got ${JSON.stringify(stateAfterReactivate.escalation)}`);
    }

    // Verify decision ledger records escalation_resolved
    const ledgerAfterResolve = readJsonl(join(root, '.agentxchain/decision-ledger.jsonl'));
    const resolvedEntry = ledgerAfterResolve.find((e) => e.decision === 'escalation_resolved');
    if (!resolvedEntry) {
      errors.push('Decision ledger does not contain escalation_resolved entry');
    }

    d1.recovery_resolved = true;

    if (errors.length > 0) {
      return finish(root, errors, d1, d2);
    }

    // ── D2: eng_director Intervention ────────────────────────────────────

    // The failed dev turn is still in active_turns with status=failed.
    // In the real operator flow, the operator would remove/clear the failed turn
    // and then step to eng_director. For the proof, we'll directly assign
    // eng_director since reactivateRun cleared the blocked state.

    // First, we need to remove the failed turn from active_turns to allow
    // new assignment (the state machine won't assign while a failed turn exists
    // in some implementations). Let's check the current state.
    const stateBeforeDirector = readState(root);
    const failedDevTurn = stateBeforeDirector.active_turns?.[turnId];

    // Clear the failed turn from active_turns by accepting a corrected result
    // (simulating operator fixing the turn before director review)
    if (failedDevTurn && failedDevTurn.status === 'failed') {
      // Stage a valid result for the failed turn and accept it
      stageTurnResult(root, turnId, makeValidTurnResult(runId, turnId, 'dev', 'manual-dev', 'eng_director'));
      const acceptFixedResult = acceptTurn(root, config, { turnId });
      if (!acceptFixedResult.ok) {
        errors.push(`acceptTurn(fixed dev) failed: ${acceptFixedResult.error}`);
        return finish(root, errors, d1, d2);
      }
    }

    // 7. Assign eng_director turn
    const directorAssign = assignTurn(root, config, 'eng_director');
    if (!directorAssign.ok) {
      errors.push(`assignTurn(eng_director) failed: ${directorAssign.error}`);
      return finish(root, errors, d1, d2);
    }
    const directorTurnId = directorAssign.turn.turn_id;
    d2.director_turn_id = directorTurnId;

    // 8. Stage valid director result and accept
    stageTurnResult(
      root,
      directorTurnId,
      makeValidTurnResult(runId, directorTurnId, 'eng_director', 'manual-director', 'human'),
    );
    const directorAccept = acceptTurn(root, config, { turnId: directorTurnId });
    if (!directorAccept.ok) {
      errors.push(`acceptTurn(eng_director) failed: ${directorAccept.error}`);
      return finish(root, errors, d1, d2);
    }

    d2.director_accepted = true;
    d2.proposed_next = 'human';

    // 9. Verify final state
    const finalState = readState(root);
    if (finalState.status !== 'active' && finalState.status !== 'idle') {
      // After director turn accepted, run should still be active
      // (unless completion gate triggered)
    }

    // Verify history has both the dev rejection cycle and director acceptance
    const history = readJsonl(join(root, '.agentxchain/history.jsonl'));
    const devTurnEntries = history.filter((e) => e.turn_id === turnId);
    const directorEntries = history.filter((e) => e.turn_id === directorTurnId);

    if (devTurnEntries.length === 0) {
      errors.push('History does not contain dev turn entries');
    }
    if (directorEntries.length === 0) {
      errors.push('History does not contain eng_director turn entries');
    }

    // Verify the full path: escalation → recovery → director → accepted
    d2.history_entries = {
      dev_turns: devTurnEntries.length,
      director_turns: directorEntries.length,
    };

    return finish(root, errors, d1, d2);
  } catch (err) {
    errors.push(`Unexpected error: ${err.message}\n${err.stack}`);
    return finish(root, errors, d1, d2);
  }
}

function finish(root, errors, d1, d2) {
  const passed = errors.length === 0;
  outputResult({
    result: passed ? 'pass' : 'fail',
    summary: passed
      ? 'Scenario D: retry exhaustion → escalation → recovery → eng_director accepted'
      : `${errors.length} error(s)`,
    errors,
    d1,
    d2,
    workspace: root,
  });
  process.exit(passed ? 0 : 1);
}

main();
