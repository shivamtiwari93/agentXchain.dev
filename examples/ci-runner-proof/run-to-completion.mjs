#!/usr/bin/env node

/**
 * CI Multi-Turn Runner Proof — executes a complete governed lifecycle using
 * only the declared runner interface.
 *
 * Usage:
 *   node examples/ci-runner-proof/run-to-completion.mjs [--json]
 *
 * Exit codes:
 *   0 — lifecycle completed, artifacts valid
 *   1 — any step failed
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { randomBytes, createHash } from 'crypto';
import { fileURLToPath } from 'url';
import { gitInit, gitCommitAll } from './git-helpers.mjs';

const jsonMode = process.argv.includes('--json');
const cliRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'cli');

const {
  initRun,
  loadState,
  assignTurn,
  writeDispatchBundle,
  getTurnStagingResultPath,
  acceptTurn,
  rejectTurn,
  approvePhaseGate,
  approveCompletionGate,
  RUNNER_INTERFACE_VERSION,
} = await import(join(cliRoot, 'src', 'lib', 'runner-interface.js'));

function makeConfig() {
  return {
    schema_version: 4,
    protocol_mode: 'governed',
    project: {
      id: 'ci-multi-turn-runner-proof',
      name: 'CI Multi-Turn Runner Proof',
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
        requires_files: ['.planning/IMPLEMENTATION_NOTES.md'],
        requires_verification_pass: true,
      },
      qa_ship_verdict: {
        requires_files: ['.planning/acceptance-matrix.md', '.planning/ship-verdict.md', '.planning/RELEASE_NOTES.md'],
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
  // Initialize git repo so repo-observer can detect file changes
  gitInit(root);
  return config;
}

function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function readJsonl(path) {
  const content = readFileSync(path, 'utf8').trim();
  if (!content) return [];
  return content.split('\n').map((line) => JSON.parse(line));
}

function ensureFiles(root, files) {
  for (const [relPath, content] of Object.entries(files)) {
    const absPath = join(root, relPath);
    mkdirSync(dirname(absPath), { recursive: true });
    writeFileSync(absPath, content);
  }
}

function makeTurnResult({ runId, turn, summary, proposedNextRole, phaseTransitionRequest = null, runCompletionRequest = null, filesChanged = [], artifactType, verificationCommands }) {
  return {
    schema_version: '1.0',
    run_id: runId,
    turn_id: turn.turn_id,
    role: turn.assigned_role,
    runtime_id: turn.runtime_id,
    status: 'completed',
    summary,
    decisions: [
      {
        id: 'DEC-001',
        category: 'implementation',
        statement: `${turn.assigned_role} completed the assigned governed slice.`,
        rationale: 'Runner proof requires a valid accepted turn result.',
      },
    ],
    objections: [
      {
        id: 'OBJ-001',
        severity: 'low',
        statement: `Proof objection recorded by ${turn.assigned_role}.`,
        status: 'raised',
      },
    ],
    files_changed: filesChanged,
    artifacts_created: [],
    verification: {
      status: 'pass',
      commands: verificationCommands,
      evidence_summary: `${turn.assigned_role} proof verification passed.`,
      machine_evidence: verificationCommands.map((command) => ({ command, exit_code: 0 })),
    },
    artifact: { type: artifactType, ref: null },
    proposed_next_role: proposedNextRole,
    phase_transition_request: phaseTransitionRequest,
    run_completion_request: runCompletionRequest,
    needs_human_reason: null,
    cost: { input_tokens: 0, output_tokens: 0, usd: 0 },
  };
}

function stageTurnResult(root, turnId, turnResult) {
  const relPath = getTurnStagingResultPath(turnId);
  const absPath = join(root, relPath);
  mkdirSync(dirname(absPath), { recursive: true });
  writeFileSync(absPath, JSON.stringify(turnResult, null, 2));
  return { relPath, absPath };
}

function validateDispatchBundle(bundlePath) {
  const requiredFiles = ['ASSIGNMENT.json', 'PROMPT.md', 'CONTEXT.md'];
  const missing = requiredFiles.filter((name) => !existsSync(join(bundlePath, name)));
  return {
    ok: missing.length === 0,
    missing,
  };
}

function listRejectedArtifacts(root, turnId) {
  const rejectedDir = join(root, '.agentxchain', 'dispatch', 'rejected');
  if (!existsSync(rejectedDir)) return [];
  return readdirSync(rejectedDir)
    .filter((name) => name.startsWith(`${turnId}-attempt-`))
    .sort();
}

function validateArtifacts(root) {
  const statePath = join(root, '.agentxchain/state.json');
  const historyPath = join(root, '.agentxchain/history.jsonl');
  const ledgerPath = join(root, '.agentxchain/decision-ledger.jsonl');
  const talkPath = join(root, 'TALK.md');

  const rawState = readFileSync(statePath, 'utf8');
  const state = JSON.parse(rawState);
  const history = readJsonl(historyPath);
  const ledger = readJsonl(ledgerPath);
  const talk = readFileSync(talkPath, 'utf8');

  return {
    state: {
      valid: state.status === 'completed' && Boolean(state.completed_at) && state.pending_phase_transition == null && state.pending_run_completion == null,
      sha256: sha256(rawState),
      status: state.status,
      phase: state.phase,
    },
    history: {
      valid: history.length === 3,
      entry_count: history.length,
      roles: history.map((entry) => entry.role),
    },
    ledger: {
      valid: ledger.length >= 3,
      entry_count: ledger.length,
    },
    talk: {
      valid: ['pm', 'dev', 'qa'].every((role) => talk.includes(role)),
      sha256: sha256(talk),
    },
  };
}

async function main() {
  const root = join(tmpdir(), `axc-ci-multi-runner-${randomBytes(6).toString('hex')}`);
  const errors = [];
  const dispatchBundles = [];
  const roles = [];
  const rejections = [];
  let phaseTransitionApprovals = 0;
  let completionApprovals = 0;
  let runId = null;

  try {
    mkdirSync(root, { recursive: true });
    const config = scaffoldProject(root);

    const initResult = initRun(root, config);
    if (!initResult.ok) {
      errors.push(`initRun failed: ${initResult.error}`);
      return report(root, { errors, runId, dispatchBundles, roles, rejections, phaseTransitionApprovals, completionApprovals });
    }
    runId = initResult.state.run_id;

    await executeTurn({
      root,
      config,
      roleId: 'pm',
      prepare: () => ensureFiles(root, {
        '.planning/PM_SIGNOFF.md': '# PM Signoff\nApproved: YES\n',
        '.planning/ROADMAP.md': '# Roadmap\n## Slice\nRunner proof implementation.\n',
      }),
      buildTurnResult: ({ turn }) => makeTurnResult({
        runId,
        turn,
        summary: 'PM prepared planning artifacts and requested implementation.',
        proposedNextRole: 'human',
        phaseTransitionRequest: 'implementation',
        filesChanged: ['.planning/PM_SIGNOFF.md', '.planning/ROADMAP.md'],
        artifactType: 'review',
        verificationCommands: ['test -f .planning/PM_SIGNOFF.md', 'test -f .planning/ROADMAP.md'],
      }),
      afterAccept: () => {
        const state = loadState(root, config);
        if (state?.status !== 'paused' || !state.pending_phase_transition) {
          errors.push('planning turn did not pause on pending_phase_transition');
          return;
        }
        const approved = approvePhaseGate(root, config);
        if (!approved.ok) {
          errors.push(`approvePhaseGate failed: ${approved.error}`);
          return;
        }
        phaseTransitionApprovals += 1;
      },
      errors,
      dispatchBundles,
      roles,
    });

    await executeTurnWithRetry({
      root,
      config,
      roleId: 'dev',
      prepare: () => ensureFiles(root, {
        'src/proof-output.js': 'export const runnerProof = true;\n',
        '.planning/IMPLEMENTATION_NOTES.md': '# Implementation Notes\n\n## Changes\n\nImplemented the governed CI proof output and advanced the run into QA.\n\n## Verification\n\nRun the CI multi-turn runner proof and verify retry, gate approval, and artifact cleanup semantics.\n',
      }),
      buildRejectedResult: ({ turn }) => ({
        schema_version: '1.0',
        run_id: runId,
        turn_id: turn.turn_id,
        role: turn.assigned_role,
        runtime_id: turn.runtime_id,
        status: 'invalid',
        summary: 'Dev first attempt intentionally rejected to prove retry semantics.',
        validation_errors: ['Simulated rejection for primitive runner proof'],
      }),
      buildTurnResult: ({ turn }) => makeTurnResult({
        runId,
        turn,
        summary: 'Dev advanced the governed proof into QA.',
        proposedNextRole: 'qa',
        phaseTransitionRequest: 'qa',
        filesChanged: ['src/proof-output.js', '.planning/IMPLEMENTATION_NOTES.md'],
        artifactType: 'workspace',
        verificationCommands: ['test -f src/proof-output.js', 'test -f .planning/IMPLEMENTATION_NOTES.md'],
      }),
      afterAccept: () => {
        const state = loadState(root, config);
        if (state?.phase !== 'qa' || state?.status !== 'active') {
          errors.push('implementation turn did not auto-advance to qa');
        }
      },
      errors,
      dispatchBundles,
      roles,
      rejections,
    });

    await executeTurn({
      root,
      config,
      roleId: 'qa',
      prepare: () => ensureFiles(root, {
        '.planning/acceptance-matrix.md': '# Acceptance Matrix\n\n| Req # | Requirement | Acceptance criteria | Test status | Last tested | Status |\n|-------|-------------|-------------------|-------------|-------------|--------|\n| 1 | Multi-turn governed proof | CI runner proof completes pm -> dev -> qa with one rejected dev retry | pass | 2026-04-06 | pass |\n',
        '.planning/ship-verdict.md': '# Ship Verdict\n\n## Verdict: YES\n',
        '.planning/RELEASE_NOTES.md': '# Release Notes\n\n## User Impact\n\nThe CI runner proof now satisfies the current governed workflow-kit gate contract.\n\n## Verification Summary\n\nThe proof completes the full lifecycle, records one rejection retry, and closes through the QA ship gate.\n',
      }),
      buildTurnResult: ({ turn }) => makeTurnResult({
        runId,
        turn,
        summary: 'QA requested governed completion with ship artifacts present.',
        proposedNextRole: 'human',
        runCompletionRequest: true,
        filesChanged: ['.planning/acceptance-matrix.md', '.planning/ship-verdict.md', '.planning/RELEASE_NOTES.md'],
        artifactType: 'review',
        verificationCommands: ['test -f .planning/acceptance-matrix.md', 'test -f .planning/ship-verdict.md', 'test -f .planning/RELEASE_NOTES.md'],
      }),
      afterAccept: () => {
        const state = loadState(root, config);
        if (state?.status !== 'paused' || !state.pending_run_completion) {
          errors.push('qa turn did not pause on pending_run_completion');
          return;
        }
        const approved = approveCompletionGate(root, config);
        if (!approved.ok) {
          errors.push(`approveCompletionGate failed: ${approved.error}`);
          return;
        }
        completionApprovals += 1;
      },
      errors,
      dispatchBundles,
      roles,
    });

    const artifacts = validateArtifacts(root);
    if (!artifacts.state.valid) errors.push('final state artifact is invalid');
    if (!artifacts.history.valid) errors.push('history artifact does not contain exactly 3 accepted turns');
    if (!artifacts.ledger.valid) errors.push('decision ledger artifact is invalid');
    if (!artifacts.talk.valid) errors.push('TALK.md does not include all role entries');

    return report(root, {
      errors,
      runId,
      dispatchBundles,
      roles,
      rejections,
      phaseTransitionApprovals,
      completionApprovals,
      artifacts,
      finalState: artifacts.state,
    });
  } catch (err) {
    errors.push(`Unexpected error: ${err.message}`);
    return report(root, { errors, runId, dispatchBundles, roles, rejections, phaseTransitionApprovals, completionApprovals });
  }
}

async function executeTurn({ root, config, roleId, prepare, buildTurnResult, afterAccept, errors, dispatchBundles, roles }) {
  if (errors.length > 0) return;

  const assignResult = assignTurn(root, config, roleId);
  if (!assignResult.ok) {
    errors.push(`assignTurn(${roleId}) failed: ${assignResult.error}`);
    return;
  }

  const turn = assignResult.turn;

  const bundleResult = writeDispatchBundle(root, assignResult.state, config);
  if (!bundleResult.ok) {
    errors.push(`writeDispatchBundle(${roleId}) failed: ${bundleResult.error}`);
    return;
  }

  const bundleCheck = validateDispatchBundle(bundleResult.bundlePath);
  if (!bundleCheck.ok) {
    errors.push(`dispatch bundle for ${roleId} missing files: ${bundleCheck.missing.join(', ')}`);
    return;
  }

  prepare();
  const staged = stageTurnResult(root, turn.turn_id, buildTurnResult({ turn }));

  const acceptResult = acceptTurn(root, config);
  if (!acceptResult.ok) {
    errors.push(`acceptTurn(${roleId}) failed: ${acceptResult.error}`);
    return;
  }

  dispatchBundles.push({
    turn_id: turn.turn_id,
    role: roleId,
    pre_accept_bundle_exists: true,
    bundle_path: bundleResult.bundlePath,
    staging_path: staged.relPath,
    post_accept_bundle_removed: !existsSync(bundleResult.bundlePath),
    post_accept_staging_removed: !existsSync(staged.absPath),
  });

  if (!dispatchBundles[dispatchBundles.length - 1].post_accept_bundle_removed) {
    errors.push(`dispatch bundle for ${roleId} still exists after acceptance`);
    return;
  }
  if (!dispatchBundles[dispatchBundles.length - 1].post_accept_staging_removed) {
    errors.push(`staging artifact for ${roleId} still exists after acceptance`);
    return;
  }

  roles.push(roleId);
  afterAccept();
  // Commit so the next authoritative turn gets a clean baseline
  gitCommitAll(root);
}

async function executeTurnWithRetry({
  root,
  config,
  roleId,
  prepare,
  buildRejectedResult,
  buildTurnResult,
  afterAccept,
  errors,
  dispatchBundles,
  roles,
  rejections,
}) {
  if (errors.length > 0) return;

  const assignResult = assignTurn(root, config, roleId);
  if (!assignResult.ok) {
    errors.push(`assignTurn(${roleId}) failed: ${assignResult.error}`);
    return;
  }

  const turn = assignResult.turn;
  const firstAttempt = turn.attempt || 1;

  const firstBundle = writeDispatchBundle(root, assignResult.state, config);
  if (!firstBundle.ok) {
    errors.push(`writeDispatchBundle(${roleId}, attempt 1) failed: ${firstBundle.error}`);
    return;
  }

  const firstBundleCheck = validateDispatchBundle(firstBundle.bundlePath);
  if (!firstBundleCheck.ok) {
    errors.push(`dispatch bundle for ${roleId} attempt 1 missing files: ${firstBundleCheck.missing.join(', ')}`);
    return;
  }

  const rejectedStage = stageTurnResult(root, turn.turn_id, buildRejectedResult({ turn }));
  const rejectResult = rejectTurn(
    root,
    config,
    { stage: 'dispatch', errors: ['Simulated rejection for primitive runner proof'] },
    'Simulated rejection for primitive runner proof',
  );
  if (!rejectResult.ok) {
    errors.push(`rejectTurn(${roleId}) failed: ${rejectResult.error}`);
    return;
  }

  const retryState = loadState(root, config);
  const retryTurn = retryState?.active_turns?.[turn.turn_id];
  const rejectedArtifacts = listRejectedArtifacts(root, turn.turn_id);

  rejections.push({
    role: roleId,
    turn_id: turn.turn_id,
    first_attempt: firstAttempt,
    retry_attempt: retryTurn?.attempt ?? null,
    retry_status: retryTurn?.status ?? null,
    same_turn_id_retained: Boolean(retryTurn?.turn_id === turn.turn_id),
    pre_reject_bundle_exists: true,
    post_reject_staging_removed: !existsSync(rejectedStage.absPath),
    rejected_artifact_count: rejectedArtifacts.length,
    rejected_artifact_preserved: rejectedArtifacts.length > 0,
  });

  const rejection = rejections[rejections.length - 1];
  if (!rejection.post_reject_staging_removed) {
    errors.push(`staging artifact for ${roleId} still exists after rejection`);
    return;
  }
  if (!rejection.same_turn_id_retained) {
    errors.push(`retry for ${roleId} did not retain the same turn_id`);
    return;
  }
  if (rejection.retry_status !== 'retrying') {
    errors.push(`retry for ${roleId} did not enter retrying status`);
    return;
  }
  if (rejection.retry_attempt !== firstAttempt + 1) {
    errors.push(`retry for ${roleId} did not increment attempt`);
    return;
  }
  if (!rejection.rejected_artifact_preserved) {
    errors.push(`rejected artifact for ${roleId} was not preserved`);
    return;
  }

  prepare();

  const retryBundle = writeDispatchBundle(root, retryState, config);
  if (!retryBundle.ok) {
    errors.push(`writeDispatchBundle(${roleId}, retry) failed: ${retryBundle.error}`);
    return;
  }

  const retryBundleCheck = validateDispatchBundle(retryBundle.bundlePath);
  if (!retryBundleCheck.ok) {
    errors.push(`dispatch bundle for ${roleId} retry missing files: ${retryBundleCheck.missing.join(', ')}`);
    return;
  }

  const staged = stageTurnResult(root, retryTurn.turn_id, buildTurnResult({ turn: retryTurn }));
  const acceptResult = acceptTurn(root, config);
  if (!acceptResult.ok) {
    errors.push(`acceptTurn(${roleId}) failed: ${acceptResult.error}`);
    return;
  }

  dispatchBundles.push({
    turn_id: retryTurn.turn_id,
    role: roleId,
    attempt: retryTurn.attempt,
    pre_accept_bundle_exists: true,
    bundle_path: retryBundle.bundlePath,
    staging_path: staged.relPath,
    post_accept_bundle_removed: !existsSync(retryBundle.bundlePath),
    post_accept_staging_removed: !existsSync(staged.absPath),
  });

  if (!dispatchBundles[dispatchBundles.length - 1].post_accept_bundle_removed) {
    errors.push(`dispatch bundle for ${roleId} still exists after retry acceptance`);
    return;
  }
  if (!dispatchBundles[dispatchBundles.length - 1].post_accept_staging_removed) {
    errors.push(`staging artifact for ${roleId} still exists after retry acceptance`);
    return;
  }

  roles.push(roleId);
  afterAccept();
  // Commit so the next authoritative turn gets a clean baseline
  gitCommitAll(root);
}

function report(root, {
  errors,
  runId,
  dispatchBundles,
  roles,
  rejections = [],
  phaseTransitionApprovals,
  completionApprovals,
  artifacts = null,
  finalState = null,
}) {
  const passed = errors.length === 0;

  try {
    rmSync(root, { recursive: true, force: true });
  } catch {}

  if (jsonMode) {
    process.stdout.write(JSON.stringify({
      runner: 'ci-multi-turn-runner-proof',
      runner_interface_version: RUNNER_INTERFACE_VERSION,
      result: passed ? 'pass' : 'fail',
      run_id: runId,
      turns_executed: roles.length,
      roles,
      rejections,
      phase_transition_approvals: phaseTransitionApprovals,
      completion_approvals: completionApprovals,
      final_status: finalState?.status || null,
      final_phase: finalState?.phase || null,
      dispatch_bundles: dispatchBundles,
      artifacts,
      errors,
    }, null, 2));
  } else if (passed) {
    console.log(`CI Multi-Turn Runner Proof — AgentXchain runner-interface v${RUNNER_INTERFACE_VERSION}`);
    console.log(`  Run:     ${runId}`);
    console.log(`  Roles:   ${roles.join(' -> ')}`);
    console.log(`  Retry:   ${rejections.length} rejection retried on same turn_id`);
    console.log(`  Gates:   phase approvals=${phaseTransitionApprovals}, completion approvals=${completionApprovals}`);
    console.log(`  Result:  PASS — completed governed lifecycle without CLI shell-out`);
  } else {
    console.log(`CI Multi-Turn Runner Proof — AgentXchain runner-interface v${RUNNER_INTERFACE_VERSION}`);
    console.log(`  Result:  FAIL`);
    for (const error of errors) {
      console.log(`  Error:   ${error}`);
    }
  }

  process.exit(passed ? 0 : 1);
}

await main();
