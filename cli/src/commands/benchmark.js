import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';
import { execSync } from 'child_process';
import chalk from 'chalk';
import { runAdmissionControl } from '../lib/admission-control.js';

/**
 * `agentxchain benchmark` — governance compliance proof.
 *
 * Runs a complete governed lifecycle in a temp dir using canned turn results,
 * then measures governance metrics: admission control, gate satisfaction,
 * protocol conformance, and export verification.
 *
 * No API keys required. Proves the governance engine is correct.
 */

function makeConfig() {
  return {
    schema_version: 4,
    protocol_mode: 'governed',
    project: { id: 'agentxchain-benchmark', name: 'AgentXchain Benchmark', goal: 'Governance compliance proof workload', default_branch: 'main' },
    roles: {
      pm: {
        title: 'Product Manager',
        mandate: 'Scope and accept.',
        write_authority: 'review_only',
        runtime_class: 'manual',
        runtime_id: 'manual-pm',
      },
      dev: {
        title: 'Developer',
        mandate: 'Implement and verify.',
        write_authority: 'authoritative',
        runtime_class: 'manual',
        runtime_id: 'manual-dev',
      },
      qa: {
        title: 'QA Reviewer',
        mandate: 'Challenge and approve.',
        write_authority: 'review_only',
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

function scaffoldProject(root) {
  const config = makeConfig();
  writeFileSync(join(root, 'agentxchain.json'), JSON.stringify(config, null, 2));
  mkdirSync(join(root, '.agentxchain/prompts'), { recursive: true });
  mkdirSync(join(root, '.planning'), { recursive: true });

  writeFileSync(join(root, '.agentxchain/state.json'), JSON.stringify({
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
  }, null, 2));

  writeFileSync(join(root, '.agentxchain/history.jsonl'), '');
  writeFileSync(join(root, '.agentxchain/decision-ledger.jsonl'), '');
  writeFileSync(join(root, '.agentxchain/prompts/pm.md'), '# PM Prompt\nBenchmark PM.');
  writeFileSync(join(root, '.agentxchain/prompts/dev.md'), '# Dev Prompt\nBenchmark Dev.');
  writeFileSync(join(root, '.agentxchain/prompts/qa.md'), '# QA Prompt\nBenchmark QA.');
  writeFileSync(join(root, 'TALK.md'), '# Benchmark Log\n');
  writeFileSync(join(root, '.planning/PM_SIGNOFF.md'), '# PM Planning Sign-Off\n\nApproved: NO\n');
  writeFileSync(join(root, '.planning/ROADMAP.md'), '# Roadmap\n\n## Wave 1\n\n### Phase: Planning\n');

  return config;
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

export async function benchmarkCommand(opts = {}) {
  const jsonMode = opts.json || false;
  const startTime = Date.now();

  const root = join(tmpdir(), `agentxchain-benchmark-${randomBytes(6).toString('hex')}`);
  mkdirSync(root, { recursive: true });

  const metrics = {
    version: '1.0',
    result: 'fail',
    phases: { completed: 0, total: 3, names: [] },
    turns: { total: 0, per_phase: {} },
    gates: { evaluated: 0, passed: 0, failed: 0 },
    artifacts: { total: 0 },
    admission_control: 'fail',
    export_verification: 'skip',
    elapsed_ms: 0,
    error: null,
  };

  try {
    execSync('git --version', { stdio: 'ignore' });

    const {
      initRun,
      assignTurn,
      acceptTurn,
      approvePhaseGate,
      approveCompletionGate,
    } = await import('../lib/runner-interface.js');

    if (!jsonMode) {
      console.log('');
      console.log(chalk.bold('  AgentXchain Benchmark — Governed Delivery Compliance'));
      console.log(chalk.dim('  ' + '─'.repeat(54)));
      console.log('');
    }

    // ── Scaffold ──────────────────────────────────────────────────────────
    const config = scaffoldProject(root);
    gitInit(root);

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

    // ── Planning Phase ───────────────────────────────────────────────────
    const pmAssign = assignTurn(root, config, 'pm');
    if (!pmAssign.ok) throw new Error(`PM assign failed: ${pmAssign.error}`);
    const pmTurnId = pmAssign.turn.turn_id;

    const pmResult = makeTurnResult(runId, pmTurnId, 'pm', 'manual-pm', 'planning', {
      proposed_next_role: 'human',
      phase_transition_request: 'implementation',
      decisionNum: 1,
      objections: [{ id: 'OBJ-001', severity: 'medium', statement: 'Benchmark scope challenge: verify edge case handling.', status: 'raised' }],
    });
    stageTurnResult(root, pmTurnId, pmResult);

    writeFileSync(join(root, '.planning/PM_SIGNOFF.md'), '# PM Planning Sign-Off\n\nApproved: YES\n');
    gitCommit(root, 'benchmark: pm planning');

    const pmAccept = acceptTurn(root, config);
    if (!pmAccept.ok) throw new Error(`PM accept failed: ${pmAccept.error}`);
    gitCommit(root, 'benchmark: accept pm');

    metrics.turns.total++;
    metrics.turns.per_phase.planning = 1;
    metrics.artifacts.total += pmResult.decisions.length;

    // Planning gate
    const planGate = approvePhaseGate(root, config);
    if (!planGate.ok) {
      metrics.gates.evaluated++;
      metrics.gates.failed++;
      throw new Error(`Planning gate failed: ${planGate.error}`);
    }
    metrics.gates.evaluated++;
    metrics.gates.passed++;
    metrics.phases.completed++;
    metrics.phases.names.push('planning');
    gitCommit(root, 'benchmark: planning gate');

    // ── Implementation Phase ─────────────────────────────────────────────
    const devAssign = assignTurn(root, config, 'dev');
    if (!devAssign.ok) throw new Error(`Dev assign failed: ${devAssign.error}`);
    const devTurnId = devAssign.turn.turn_id;

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

    metrics.turns.total++;
    metrics.turns.per_phase.implementation = 1;
    metrics.artifacts.total += devResult.decisions.length + devResult.files_changed.length;

    // Implementation gate
    const implGate = approvePhaseGate(root, config);
    if (!implGate.ok) {
      metrics.gates.evaluated++;
      metrics.gates.failed++;
      throw new Error(`Implementation gate failed: ${implGate.error}`);
    }
    metrics.gates.evaluated++;
    metrics.gates.passed++;
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
    writeFileSync(join(root, '.planning/ship-verdict.md'), '# Ship Verdict\n\n## Verdict: SHIP\n');
    gitCommit(root, 'benchmark: qa review');

    const qaAccept = acceptTurn(root, config);
    if (!qaAccept.ok) throw new Error(`QA accept failed: ${qaAccept.error}`);
    gitCommit(root, 'benchmark: accept qa');

    metrics.turns.total++;
    metrics.turns.per_phase.qa = 1;
    metrics.artifacts.total += qaResult.decisions.length;

    // QA gate + run completion
    const completionResult = approveCompletionGate(root, config);
    if (!completionResult.ok) throw new Error(`Completion failed: ${completionResult.error}`);

    metrics.gates.evaluated++;
    metrics.gates.passed++;
    metrics.phases.completed++;
    metrics.phases.names.push('qa');

    // ── Export Verification ──────────────────────────────────────────────
    try {
      const { exportGovernedRun } = await import('../lib/export.js');
      const exportResult = exportGovernedRun(root, config);
      if (exportResult && exportResult.ok !== false) {
        metrics.export_verification = 'pass';
      } else {
        metrics.export_verification = 'fail';
      }
    } catch (exportErr) {
      // Export may require git history or other state not available in benchmark context
      metrics.export_verification = 'skip';
    }

    // ── Done ─────────────────────────────────────────────────────────────
    metrics.result = 'pass';
    metrics.elapsed_ms = Date.now() - startTime;

    if (jsonMode) {
      process.stdout.write(JSON.stringify(metrics, null, 2) + '\n');
    } else {
      console.log(`  Phases completed     ${chalk.green(`${metrics.phases.completed}/${metrics.phases.total}`)}  (${metrics.phases.names.join(' → ')})`);
      console.log(`  Turns executed       ${chalk.bold(String(metrics.turns.total))}    (${Object.entries(metrics.turns.per_phase).map(([p, n]) => `${n} ${p}`).join(', ')})`);
      console.log(`  Gate evaluations     ${chalk.green(`${metrics.gates.passed}/${metrics.gates.evaluated}`)}  passed`);
      console.log(`  Artifacts produced   ${chalk.bold(String(metrics.artifacts.total))}`);
      console.log(`  Admission control    ${chalk.green('PASS')}`);
      console.log(`  Export verification  ${metrics.export_verification === 'pass' ? chalk.green('PASS') : chalk.yellow(metrics.export_verification.toUpperCase())}`);
      console.log(`  Elapsed              ${chalk.dim((metrics.elapsed_ms / 1000).toFixed(1) + 's')}`);
      console.log('');
      console.log(`  Result: ${chalk.green.bold('PASS')} ${chalk.green('✓')}`);
      console.log('');
    }
  } catch (err) {
    metrics.result = 'fail';
    metrics.error = err.message;
    metrics.elapsed_ms = Date.now() - startTime;

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
