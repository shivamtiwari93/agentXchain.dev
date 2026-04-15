import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';
import { execSync } from 'child_process';
import chalk from 'chalk';
import { runAdmissionControl } from '../lib/admission-control.js';
import { validateStagedTurnResult } from '../lib/turn-result-validator.js';
import { getTurnStagingResultPath } from '../lib/turn-paths.js';
import { verifyExportArtifact } from '../lib/export-verifier.js';
import { resolveBenchmarkWorkload } from './benchmark-workloads.js';

/**
 * `agentxchain benchmark` — governance compliance proof.
 *
 * Runs a complete governed lifecycle in a temp dir using canned turn results,
 * then measures governance metrics: admission control, retry handling,
 * gate satisfaction, and export verification.
 *
 * No API keys required. Proves the governance engine is correct.
 */

function makeConfig(workload) {
  const base = {
    schema_version: 4,
    protocol_mode: 'governed',
    project: { id: 'agentxchain-benchmark', name: 'AgentXchain Benchmark', goal: 'Governance compliance proof workload', default_branch: 'main' },
    roles: {
      pm: {
        title: 'Product Manager',
        mandate: 'Scope and accept.',
        write_authority: 'review_only',
        runtime: 'manual-pm',
        runtime_class: 'manual',
        runtime_id: 'manual-pm',
      },
      dev: {
        title: 'Developer',
        mandate: 'Implement and verify.',
        write_authority: 'authoritative',
        runtime: 'manual-dev',
        runtime_class: 'manual',
        runtime_id: 'manual-dev',
      },
      qa: {
        title: 'QA Reviewer',
        mandate: 'Challenge and approve.',
        write_authority: 'review_only',
        runtime: 'manual-qa',
        runtime_class: 'manual',
        runtime_id: 'manual-qa',
      },
    },
    runtimes: {
      'manual-pm': { type: 'manual' },
      'manual-dev': { type: 'manual' },
      'manual-qa': { type: 'manual' },
    },
    routing: {
      planning: {
        entry_role: 'pm',
        allowed_next_roles: ['pm', 'human'],
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
        requires_files: ['.planning/PM_SIGNOFF.md'],
        requires_human_approval: true,
      },
      implementation_complete: {
        requires_files: ['.planning/IMPLEMENTATION_NOTES.md'],
        requires_human_approval: true,
      },
      qa_ship_verdict: {
        requires_files: ['.planning/acceptance-matrix.md', '.planning/ship-verdict.md'],
        requires_human_approval: true,
      },
    },
    budget: { per_turn_max_usd: 1.0, per_run_max_usd: 5.0 },
    rules: { challenge_required: true, max_turn_retries: 2, max_deadlock_cycles: 1 },
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

  // phase-drift workload: insert extra phases (design) between planning and implementation
  if (workload && Array.isArray(workload.extra_phases) && workload.extra_phases.length > 0) {
    // Add architect role for design phase
    base.roles.architect = {
      title: 'Architect',
      mandate: 'Design systems and validate architecture.',
      write_authority: 'authoritative',
      runtime: 'manual-architect',
      runtime_class: 'manual',
      runtime_id: 'manual-architect',
    };
    base.runtimes['manual-architect'] = { type: 'manual' };

    // Insert design phase between planning and implementation
    const newRouting = {};
    newRouting.planning = {
      entry_role: 'pm',
      allowed_next_roles: ['pm', 'human'],
      exit_gate: 'planning_signoff',
    };
    newRouting.design = {
      entry_role: 'architect',
      allowed_next_roles: ['architect', 'pm', 'human'],
      exit_gate: 'design_signoff',
    };
    newRouting.implementation = base.routing.implementation;
    newRouting.qa = base.routing.qa;
    base.routing = newRouting;

    // Add design gate
    base.gates.design_signoff = {
      requires_files: ['.planning/DESIGN_SIGNOFF.md'],
      requires_human_approval: true,
    };

    // Increase budget for extra phase
    base.budget.per_run_max_usd = 8.0;
  }

  return base;
}

function makeTurnResult(runId, turnId, role, runtimeId, phase, opts = {}) {
  return {
    schema_version: '1.0',
    run_id: runId,
    turn_id: turnId,
    role,
    runtime_id: runtimeId,
    status: 'completed',
    summary: `Benchmark turn: ${role} in ${phase}`,
    decisions: [{ id: `DEC-${String(opts.decisionNum || 1).padStart(3, '0')}`, category: 'scope', statement: `Benchmark decision by ${role}`, rationale: 'Governance compliance proof.' }],
    objections: opts.objections || [],
    files_changed: opts.files_changed || [],
    artifacts_created: [],
    verification: { status: 'pass', commands: [], evidence_summary: 'Benchmark verification.', machine_evidence: [] },
    artifact: { type: opts.artifact_type || 'review', ref: null },
    proposed_next_role: opts.proposed_next_role || 'human',
    phase_transition_request: opts.phase_transition_request || null,
    run_completion_request: opts.run_completion_request || false,
    needs_human_reason: null,
    cost: { input_tokens: 0, output_tokens: 0, usd: 0 },
  };
}

function scaffoldProject(root, config) {
  writeFileSync(join(root, 'agentxchain.json'), JSON.stringify(config, null, 2));
  mkdirSync(join(root, '.agentxchain/prompts'), { recursive: true });
  mkdirSync(join(root, '.planning'), { recursive: true });

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
  writeFileSync(join(root, '.agentxchain/prompts/pm.md'), '# PM Prompt\nBenchmark PM.');
  writeFileSync(join(root, '.agentxchain/prompts/dev.md'), '# Dev Prompt\nBenchmark Dev.');
  writeFileSync(join(root, '.agentxchain/prompts/qa.md'), '# QA Prompt\nBenchmark QA.');
  if (config.roles.architect) {
    writeFileSync(join(root, '.agentxchain/prompts/architect.md'), '# Architect Prompt\nBenchmark Architect.');
  }
  writeFileSync(join(root, 'TALK.md'), '# Benchmark Log\n');
  writeFileSync(join(root, '.planning/PM_SIGNOFF.md'), '# PM Planning Sign-Off\n\nApproved: NO\n');
  writeFileSync(join(root, '.planning/ROADMAP.md'), '# Roadmap\n\n## Wave 1\n\n### Phase: Planning\n');
}

function gitInit(root) {
  execSync('git init', { cwd: root, stdio: 'ignore' });
  execSync('git config user.email "benchmark@agentxchain.dev"', { cwd: root, stdio: 'ignore' });
  execSync('git config user.name "AgentXchain Benchmark"', { cwd: root, stdio: 'ignore' });
  execSync('git add -A', { cwd: root, stdio: 'ignore' });
  execSync('git commit -m "benchmark: scaffold"', { cwd: root, stdio: 'ignore' });
}

function gitCommit(root, message) {
  execSync('git add -A', { cwd: root, stdio: 'ignore' });
  execSync(`git commit -m "${message}" --allow-empty`, { cwd: root, stdio: 'ignore' });
}

function stageTurnResult(root, turnId, result) {
  const stagingDir = join(root, '.agentxchain/staging', turnId);
  mkdirSync(stagingDir, { recursive: true });
  writeFileSync(join(stagingDir, 'turn-result.json'), JSON.stringify(result, null, 2));
}

function recordTurn(metrics, phase, outcome = 'accepted') {
  metrics.turns.total++;
  metrics.turns.per_phase[phase] = (metrics.turns.per_phase[phase] || 0) + 1;
  if (outcome === 'accepted') {
    metrics.turns.accepted++;
  } else if (outcome === 'rejected') {
    metrics.turns.rejected++;
  }
}

function makeInvalidRetryResult(runId, turnId, role, runtimeId, phase) {
  const invalid = makeTurnResult(runId, turnId, role, runtimeId, phase, {
    files_changed: ['benchmark-module.js'],
    artifact_type: 'commit',
    proposed_next_role: 'dev',
    phase_transition_request: null,
    decisionNum: 2,
  });
  delete invalid.schema_version;
  return invalid;
}

function recordGateEvaluation(metrics, outcome) {
  metrics.gates.evaluated++;
  if (outcome === 'passed') {
    metrics.gates.passed++;
  } else if (outcome === 'failed') {
    metrics.gates.failed++;
  }
}

function failEarlyBenchmark(jsonMode, error, validWorkloads = []) {
  const payload = {
    version: '1.0',
    result: 'fail',
    error,
    valid_workloads: validWorkloads,
  };
  if (jsonMode) {
    process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
  } else {
    console.error(chalk.red(`\n  Benchmark FAIL: ${error}\n`));
    if (validWorkloads.length > 0) {
      console.error(`  Valid workloads: ${validWorkloads.join(', ')}\n`);
    }
  }
  process.exitCode = 1;
}

function assertExpectedWorkloadSignals(workload, metrics) {
  if (workload.rejected_turn_expected && metrics.turns.rejected < 1) {
    throw new Error(`Workload "${workload.id}" expected at least one rejected turn, but none were observed.`);
  }
  if (!workload.rejected_turn_expected && metrics.turns.rejected > 0) {
    throw new Error(`Workload "${workload.id}" does not allow rejected turns, but ${metrics.turns.rejected} were observed.`);
  }
  if (workload.gate_failure_expected && metrics.gates.failed < 1) {
    throw new Error(`Workload "${workload.id}" expected at least one failed gate evaluation, but none were observed.`);
  }
  if (!workload.gate_failure_expected && metrics.gates.failed > 0) {
    throw new Error(`Workload "${workload.id}" does not allow failed gate evaluations, but ${metrics.gates.failed} were observed.`);
  }
}

async function buildAndVerifyRunExport(root) {
  const { buildRunExport } = await import('../lib/export.js');
  const exportResult = buildRunExport(root);
  if (!exportResult.ok) {
    return {
      ok: false,
      error: exportResult.error,
    };
  }

  const verification = verifyExportArtifact(exportResult.export);
  if (!verification.ok) {
    return {
      ok: false,
      error: verification.errors.join('; '),
      exportArtifact: exportResult.export,
      verificationReport: verification.report,
    };
  }

  return {
    ok: true,
    exportArtifact: exportResult.export,
    verificationReport: verification.report,
  };
}

function buildProofArtifactPaths(outputDir) {
  if (!outputDir) return null;
  return {
    directory: outputDir,
    metrics: join(outputDir, 'metrics.json'),
    export: join(outputDir, 'run-export.json'),
    verify_export: join(outputDir, 'verify-export.json'),
    workload: join(outputDir, 'workload.json'),
  };
}

function persistBenchmarkArtifacts(paths, metrics, workload, exportArtifact, verificationReport) {
  if (!paths) return;
  mkdirSync(paths.directory, { recursive: true });
  writeFileSync(paths.metrics, JSON.stringify(metrics, null, 2) + '\n');
  writeFileSync(paths.workload, JSON.stringify(workload, null, 2) + '\n');
  if (exportArtifact) {
    writeFileSync(paths.export, JSON.stringify(exportArtifact, null, 2) + '\n');
  }
  if (verificationReport) {
    writeFileSync(paths.verify_export, JSON.stringify(verificationReport, null, 2) + '\n');
  }
}

export async function benchmarkCommand(opts = {}) {
  const jsonMode = opts.json || false;
  const workloadResolution = resolveBenchmarkWorkload(opts);
  if (!workloadResolution.ok) {
    failEarlyBenchmark(jsonMode, workloadResolution.error, workloadResolution.valid_workloads || []);
    return;
  }
  const benchmarkWorkload = workloadResolution.workload;
  const startTime = Date.now();
  const outputDir = opts.output ? resolve(String(opts.output)) : null;
  const proofArtifactPaths = buildProofArtifactPaths(outputDir);

  const root = join(tmpdir(), `agentxchain-benchmark-${randomBytes(6).toString('hex')}`);
  mkdirSync(root, { recursive: true });

  const metrics = {
    version: '1.0',
    workload: benchmarkWorkload.id,
    mode: benchmarkWorkload.id,
    selected_via: workloadResolution.selected_via,
    result: 'fail',
    phases: { completed: 0, total: 3, names: [] },
    turns: { total: 0, accepted: 0, rejected: 0, per_phase: {} },
    gates: { evaluated: 0, passed: 0, failed: 0 },
    artifacts: { total: 0 },
    admission_control: 'fail',
    export_verification: 'fail',
    proof_artifacts: proofArtifactPaths,
    elapsed_ms: 0,
    error: null,
  };
  const workload = {
    version: '1.0',
    workload: benchmarkWorkload.id,
    mode: benchmarkWorkload.id,
    label: benchmarkWorkload.label,
    description: benchmarkWorkload.description,
    selected_via: workloadResolution.selected_via,
    run_id: null,
    project_id: 'agentxchain-benchmark',
    expected_phase_order: null, // set after config is built
    rejected_turn_expected: benchmarkWorkload.rejected_turn_expected,
    gate_failure_expected: benchmarkWorkload.gate_failure_expected,
    recovery_branch: benchmarkWorkload.recovery_branch,
    proof_artifacts: proofArtifactPaths,
  };
  let exportArtifact = null;
  let verificationReport = null;

  try {
    execSync('git --version', { stdio: 'ignore' });

    const {
      loadState,
      initRun,
      assignTurn,
      acceptTurn,
      rejectTurn,
      approvePhaseGate,
      approveCompletionGate,
    } = await import('../lib/runner-interface.js');

    if (!jsonMode) {
      console.log('');
      console.log(chalk.bold('  AgentXchain Benchmark — Governed Delivery Compliance'));
      console.log(chalk.dim('  ' + '─'.repeat(54)));
      console.log('');
      console.log(`  Workload             ${benchmarkWorkload.id === 'baseline' ? chalk.green(benchmarkWorkload.label.toUpperCase()) : chalk.yellow(benchmarkWorkload.label.toUpperCase())}`);
      console.log('');
    }

    // ── Scaffold ──────────────────────────────────────────────────────────
    const config = makeConfig(benchmarkWorkload);
    scaffoldProject(root, config);
    gitInit(root);

    // Adjust metrics and workload metadata for actual phase count
    const phaseNames = Object.keys(config.routing);
    metrics.phases.total = phaseNames.length;
    workload.expected_phase_order = phaseNames;

    // ── Admission Control ────────────────────────────────────────────────
    const admission = runAdmissionControl(config, config);
    metrics.admission_control = admission.ok ? 'pass' : 'fail';
    if (!admission.ok) {
      throw new Error(`Admission control failed: ${admission.errors.join('; ')}`);
    }

    // ── Init run ──────────────────────────────────────────────────────────
    const runResult = initRun(root, config);
    if (!runResult.ok) throw new Error(`initRun failed: ${runResult.error}`);
    const runId = runResult.state.run_id;
    workload.run_id = runId;

    // ── Planning Phase ───────────────────────────────────────────────────
    const pmAssign = assignTurn(root, config, 'pm');
    if (!pmAssign.ok) throw new Error(`PM assign failed: ${pmAssign.error}`);
    const pmTurnId = pmAssign.turn.turn_id;

    // Next phase after planning depends on workload (design for phase-drift, implementation otherwise)
    const phaseAfterPlanning = phaseNames[1] || 'implementation';
    const pmResult = makeTurnResult(runId, pmTurnId, 'pm', 'manual-pm', 'planning', {
      proposed_next_role: 'human',
      phase_transition_request: phaseAfterPlanning,
      decisionNum: 1,
      objections: [{ id: 'OBJ-001', severity: 'medium', statement: 'Benchmark scope challenge: verify edge case handling.', status: 'raised' }],
    });
    stageTurnResult(root, pmTurnId, pmResult);

    writeFileSync(join(root, '.planning/PM_SIGNOFF.md'), '# PM Planning Sign-Off\n\nApproved: YES\n');
    gitCommit(root, 'benchmark: pm planning');

    const pmAccept = acceptTurn(root, config);
    if (!pmAccept.ok) throw new Error(`PM accept failed: ${pmAccept.error}`);
    gitCommit(root, 'benchmark: accept pm');

    recordTurn(metrics, 'planning', 'accepted');
    metrics.artifacts.total += pmResult.decisions.length;

    // Planning gate
    const planGate = approvePhaseGate(root, config);
    if (!planGate.ok) {
      metrics.gates.evaluated++;
      metrics.gates.failed++;
      throw new Error(`Planning gate failed: ${planGate.error}`);
    }
    recordGateEvaluation(metrics, 'passed');
    metrics.phases.completed++;
    metrics.phases.names.push('planning');
    gitCommit(root, 'benchmark: planning gate');

    // ── Design Phase (phase-drift workload only) ─────────────────────────
    if (benchmarkWorkload.extra_phases && benchmarkWorkload.extra_phases.includes('design')) {
      const archAssign = assignTurn(root, config, 'architect');
      if (!archAssign.ok) throw new Error(`Architect assign failed: ${archAssign.error}`);
      const archTurnId = archAssign.turn.turn_id;

      const archResult = makeTurnResult(runId, archTurnId, 'architect', 'manual-architect', 'design', {
        files_changed: ['.planning/DESIGN_SIGNOFF.md'],
        artifact_type: 'commit',
        proposed_next_role: 'human',
        phase_transition_request: 'implementation',
        decisionNum: 10,
        objections: [{ id: 'OBJ-010', severity: 'medium', statement: 'Benchmark architecture review: validate system design.', status: 'raised' }],
      });
      stageTurnResult(root, archTurnId, archResult);

      writeFileSync(join(root, '.planning/DESIGN_SIGNOFF.md'), '# Design Sign-Off\n\nApproved: YES\n');
      gitCommit(root, 'benchmark: architect design');

      const archAccept = acceptTurn(root, config);
      if (!archAccept.ok) throw new Error(`Architect accept failed: ${archAccept.error}`);
      gitCommit(root, 'benchmark: accept architect');

      recordTurn(metrics, 'design', 'accepted');
      metrics.artifacts.total += archResult.decisions.length;

      // Design gate
      const designGate = approvePhaseGate(root, config);
      if (!designGate.ok) {
        metrics.gates.evaluated++;
        metrics.gates.failed++;
        throw new Error(`Design gate failed: ${designGate.error}`);
      }
      recordGateEvaluation(metrics, 'passed');
      metrics.phases.completed++;
      metrics.phases.names.push('design');
      gitCommit(root, 'benchmark: design gate');
    }

    // ── Implementation Phase ─────────────────────────────────────────────
    const devAssign = assignTurn(root, config, 'dev');
    if (!devAssign.ok) throw new Error(`Dev assign failed: ${devAssign.error}`);
    const devTurnId = devAssign.turn.turn_id;

    if (benchmarkWorkload.implementation.reject_invalid_first_attempt) {
      const invalidDevResult = makeInvalidRetryResult(runId, devTurnId, 'dev', 'manual-dev', 'implementation');
      stageTurnResult(root, devTurnId, invalidDevResult);

      const validation = validateStagedTurnResult(root, loadState(root, config), config, {
        stagingPath: getTurnStagingResultPath(devTurnId),
      });
      if (validation.ok) {
        throw new Error('Benchmark stress mode expected the first implementation attempt to fail validation.');
      }

      const rejectResult = rejectTurn(root, config, validation, 'Benchmark stress: reject invalid implementation attempt');
      if (!rejectResult.ok) {
        throw new Error(`Dev reject failed: ${rejectResult.error}`);
      }

      recordTurn(metrics, 'implementation', 'rejected');
    }

    const devResult = makeTurnResult(runId, devTurnId, 'dev', 'manual-dev', 'implementation', {
      files_changed: ['benchmark-module.js', '.planning/IMPLEMENTATION_NOTES.md'],
      artifact_type: 'commit',
      proposed_next_role: 'qa',
      phase_transition_request: 'qa',
      decisionNum: 2,
    });
    stageTurnResult(root, devTurnId, devResult);

    writeFileSync(join(root, 'benchmark-module.js'), '// benchmark implementation artifact\nmodule.exports = { ok: true };\n');
    writeFileSync(join(root, '.planning/IMPLEMENTATION_NOTES.md'), '# Implementation Notes\n\n## Changes\n\n- Benchmark implementation artifact created\n\n## Verification\n\n- All assertions pass\n');
    gitCommit(root, 'benchmark: dev implementation');

    const devAccept = acceptTurn(root, config);
    if (!devAccept.ok) throw new Error(`Dev accept failed: ${devAccept.error}`);
    gitCommit(root, 'benchmark: accept dev');

    recordTurn(metrics, 'implementation', 'accepted');
    metrics.artifacts.total += devResult.decisions.length + devResult.files_changed.length;

    // Implementation gate
    const implGate = approvePhaseGate(root, config);
    if (!implGate.ok) {
      metrics.gates.evaluated++;
      metrics.gates.failed++;
      throw new Error(`Implementation gate failed: ${implGate.error}`);
    }
    recordGateEvaluation(metrics, 'passed');
    metrics.phases.completed++;
    metrics.phases.names.push('implementation');
    gitCommit(root, 'benchmark: implementation gate');

    // ── QA Phase ─────────────────────────────────────────────────────────
    const qaAssign = assignTurn(root, config, 'qa');
    if (!qaAssign.ok) throw new Error(`QA assign failed: ${qaAssign.error}`);
    const qaTurnId = qaAssign.turn.turn_id;

    const qaResult = makeTurnResult(runId, qaTurnId, 'qa', 'manual-qa', 'qa', {
      proposed_next_role: 'human',
      run_completion_request: true,
      decisionNum: 3,
      objections: [{ id: 'OBJ-002', severity: 'low', statement: 'Benchmark QA challenge: verify compliance coverage.', status: 'raised' }],
    });
    stageTurnResult(root, qaTurnId, qaResult);

    writeFileSync(join(root, '.planning/acceptance-matrix.md'), '# Acceptance Matrix\n\n| Req # | Requirement | Status |\n|-------|-------------|--------|\n| 1 | Governance compliance | PASS |\n');
    if (!benchmarkWorkload.qa.missing_completion_files.includes('.planning/ship-verdict.md')) {
      writeFileSync(join(root, '.planning/ship-verdict.md'), '# Ship Verdict\n\n## Verdict: SHIP\n');
    }
    gitCommit(root, 'benchmark: qa review');

    const qaAccept = acceptTurn(root, config);
    if (!qaAccept.ok) throw new Error(`QA accept failed: ${qaAccept.error}`);
    gitCommit(root, 'benchmark: accept qa');

    recordTurn(metrics, 'qa', 'accepted');
    metrics.artifacts.total += qaResult.decisions.length;

    if (benchmarkWorkload.qa.fail_completion_once) {
      const failedCompletionState = loadState(root, config);
      const gateFailure = failedCompletionState?.last_gate_failure;
      if (!gateFailure || gateFailure.gate_type !== 'run_completion') {
        throw new Error(`Workload "${benchmarkWorkload.id}" expected a run-completion gate failure after the first QA turn.`);
      }
      const missingFiles = Array.isArray(gateFailure.missing_files) ? gateFailure.missing_files : [];
      for (const requiredPath of benchmarkWorkload.qa.missing_completion_files) {
        if (!missingFiles.includes(requiredPath)) {
          throw new Error(`Workload "${benchmarkWorkload.id}" expected missing completion artifact "${requiredPath}", but observed: ${missingFiles.join(', ') || 'none'}.`);
        }
      }
      recordGateEvaluation(metrics, 'failed');

      const qaRecoveryAssign = assignTurn(root, config, benchmarkWorkload.qa.recovery_role);
      if (!qaRecoveryAssign.ok) {
        throw new Error(`QA recovery assign failed: ${qaRecoveryAssign.error}`);
      }
      const qaRecoveryTurnId = qaRecoveryAssign.turn.turn_id;
      const qaRecoveryResult = makeTurnResult(runId, qaRecoveryTurnId, benchmarkWorkload.qa.recovery_role, 'manual-qa', 'qa', {
        proposed_next_role: 'human',
        run_completion_request: true,
        decisionNum: 4,
        objections: [{ id: 'OBJ-003', severity: 'medium', statement: 'Benchmark QA recovery: restore the missing ship verdict before completion.', status: 'raised' }],
      });
      stageTurnResult(root, qaRecoveryTurnId, qaRecoveryResult);

      for (const requiredPath of benchmarkWorkload.qa.missing_completion_files) {
        writeFileSync(join(root, requiredPath), '# Ship Verdict\n\n## Verdict: SHIP\n');
      }
      gitCommit(root, 'benchmark: qa recovery');

      const qaRecoveryAccept = acceptTurn(root, config);
      if (!qaRecoveryAccept.ok) {
        throw new Error(`QA recovery accept failed: ${qaRecoveryAccept.error}`);
      }
      gitCommit(root, 'benchmark: accept qa recovery');

      recordTurn(metrics, 'qa', 'accepted');
      metrics.artifacts.total += qaRecoveryResult.decisions.length + benchmarkWorkload.qa.missing_completion_files.length;
    }

    // QA gate + run completion
    const completionResult = approveCompletionGate(root, config);
    if (!completionResult.ok) throw new Error(`Completion failed: ${completionResult.error}`);

    recordGateEvaluation(metrics, 'passed');
    metrics.phases.completed++;
    metrics.phases.names.push('qa');

    // ── Export Verification ──────────────────────────────────────────────
    const exportVerification = await buildAndVerifyRunExport(root);
    if (!exportVerification.ok) {
      metrics.export_verification = 'fail';
      throw new Error(`Export verification failed: ${exportVerification.error}`);
    }
    exportArtifact = exportVerification.exportArtifact;
    verificationReport = exportVerification.verificationReport;
    metrics.export_verification = 'pass';

    assertExpectedWorkloadSignals(benchmarkWorkload, metrics);

    // ── Done ─────────────────────────────────────────────────────────────
    metrics.result = 'pass';
    metrics.elapsed_ms = Date.now() - startTime;
    persistBenchmarkArtifacts(proofArtifactPaths, metrics, workload, exportArtifact, verificationReport);

    if (jsonMode) {
      process.stdout.write(JSON.stringify(metrics, null, 2) + '\n');
    } else {
      console.log(`  Phases completed     ${chalk.green(`${metrics.phases.completed}/${metrics.phases.total}`)}  (${metrics.phases.names.join(' → ')})`);
      console.log(`  Turns executed       ${chalk.bold(String(metrics.turns.total))}    (${metrics.turns.accepted} accepted, ${metrics.turns.rejected} rejected; ${Object.entries(metrics.turns.per_phase).map(([p, n]) => `${n} ${p}`).join(', ')})`);
      console.log(`  Gate evaluations     ${chalk.green(`${metrics.gates.passed}/${metrics.gates.evaluated}`)}  passed`);
      console.log(`  Artifacts produced   ${chalk.bold(String(metrics.artifacts.total))}`);
      console.log(`  Admission control    ${chalk.green('PASS')}`);
      console.log(`  Export verification  ${metrics.export_verification === 'pass' ? chalk.green('PASS') : chalk.red('FAIL')}`);
      if (proofArtifactPaths) {
        console.log(`  Proof artifacts      ${chalk.dim(proofArtifactPaths.directory)}`);
      }
      console.log(`  Elapsed              ${chalk.dim((metrics.elapsed_ms / 1000).toFixed(1) + 's')}`);
      console.log('');
      console.log(`  Result: ${chalk.green.bold('PASS')} ${chalk.green('✓')}`);
      console.log('');
    }
  } catch (err) {
    metrics.result = 'fail';
    metrics.error = err.message;
    metrics.elapsed_ms = Date.now() - startTime;
    persistBenchmarkArtifacts(proofArtifactPaths, metrics, workload, exportArtifact, verificationReport);

    if (jsonMode) {
      process.stdout.write(JSON.stringify(metrics, null, 2) + '\n');
    } else {
      console.error(chalk.red(`\n  Benchmark FAIL: ${err.message}\n`));
    }

    process.exitCode = 1;
  } finally {
    try { rmSync(root, { recursive: true, force: true }); } catch {}
  }
}
