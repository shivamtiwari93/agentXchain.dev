const DEFAULT_PHASE_ORDER = Object.freeze(['planning', 'implementation', 'qa']);

const DESIGN_PHASE_SPEC = Object.freeze({
  id: 'design',
  handler: 'generic',
  role: Object.freeze({
    id: 'architect',
    title: 'Architect',
    mandate: 'Design systems and validate architecture.',
    write_authority: 'authoritative',
  }),
  runtime: Object.freeze({
    id: 'manual-architect',
    type: 'manual',
  }),
  prompt: '# Architect Prompt\nBenchmark Architect.',
  allowed_next_roles: Object.freeze(['architect', 'pm', 'human']),
  gate: Object.freeze({
    id: 'design_signoff',
    requires_files: Object.freeze(['.planning/DESIGN_SIGNOFF.md']),
    requires_human_approval: true,
  }),
  execution: Object.freeze({
    files_changed: Object.freeze(['.planning/DESIGN_SIGNOFF.md']),
    files_to_write: Object.freeze([
      Object.freeze({
        path: '.planning/DESIGN_SIGNOFF.md',
        content: '# Design Sign-Off\n\nApproved: YES\n',
      }),
    ]),
    artifact_type: 'commit',
    proposed_next_role: 'human',
    decision_num: 10,
    objections: Object.freeze([
      Object.freeze({
        id: 'OBJ-010',
        severity: 'medium',
        statement: 'Benchmark architecture review: validate system design.',
        status: 'raised',
      }),
    ]),
    commit_message: 'benchmark: architect design',
    accept_commit_message: 'benchmark: accept architect',
    gate_commit_message: 'benchmark: design gate',
  }),
});

export const BENCHMARK_WORKLOADS = Object.freeze({
  baseline: Object.freeze({
    id: 'baseline',
    label: 'Baseline',
    description: 'One accepted turn per phase with no recovery branches.',
    phase_order: DEFAULT_PHASE_ORDER,
    rejected_turn_expected: false,
    gate_failure_expected: false,
    recovery_branch: 'none',
    implementation: Object.freeze({
      reject_invalid_first_attempt: false,
    }),
    qa: Object.freeze({
      fail_completion_once: false,
      missing_completion_files: [],
      recovery_role: 'qa',
    }),
  }),
  stress: Object.freeze({
    id: 'stress',
    label: 'Stress',
    description: 'Reject the first implementation attempt, then recover and complete the run.',
    phase_order: DEFAULT_PHASE_ORDER,
    rejected_turn_expected: true,
    gate_failure_expected: false,
    recovery_branch: 'implementation_rejection',
    implementation: Object.freeze({
      reject_invalid_first_attempt: true,
    }),
    qa: Object.freeze({
      fail_completion_once: false,
      missing_completion_files: [],
      recovery_role: 'qa',
    }),
  }),
  'completion-recovery': Object.freeze({
    id: 'completion-recovery',
    label: 'Completion Recovery',
    description: 'Fail the first QA completion gate on a missing required artifact, then repair and complete.',
    phase_order: DEFAULT_PHASE_ORDER,
    rejected_turn_expected: false,
    gate_failure_expected: true,
    recovery_branch: 'run_completion_gate_failure',
    implementation: Object.freeze({
      reject_invalid_first_attempt: false,
    }),
    qa: Object.freeze({
      fail_completion_once: true,
      missing_completion_files: ['.planning/ship-verdict.md'],
      recovery_role: 'qa',
    }),
  }),
  'phase-drift': Object.freeze({
    id: 'phase-drift',
    label: 'Phase Drift',
    description: 'Run with a 4-phase workflow (planning → design → implementation → qa) to produce a different workflow_phase_order. Diffing against baseline proves REG-PHASE-ORDER detection.',
    phase_order: Object.freeze(['planning', 'design', 'implementation', 'qa']),
    rejected_turn_expected: false,
    gate_failure_expected: false,
    recovery_branch: 'none',
    custom_phases: Object.freeze({
      design: DESIGN_PHASE_SPEC,
    }),
    implementation: Object.freeze({
      reject_invalid_first_attempt: false,
    }),
    qa: Object.freeze({
      fail_completion_once: false,
      missing_completion_files: [],
      recovery_role: 'qa',
    }),
  }),
});

export function listBenchmarkWorkloadIds() {
  return Object.keys(BENCHMARK_WORKLOADS);
}

function normalizeBenchmarkWorkloadId(value) {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.toLowerCase().replace(/_/g, '-');
}

export function benchmarkWorkloadsCommand(opts = {}) {
  const ids = listBenchmarkWorkloadIds();
  const jsonMode = opts.json || false;

  if (jsonMode) {
    const workloads = ids.map(id => {
      const w = BENCHMARK_WORKLOADS[id];
      return {
        id: w.id,
        label: w.label,
        description: w.description,
        phase_order: Array.isArray(w.phase_order) ? [...w.phase_order] : [],
        phase_count: Array.isArray(w.phase_order) ? w.phase_order.length : null,
        rejected_turn_expected: w.rejected_turn_expected,
        gate_failure_expected: w.gate_failure_expected,
        recovery_branch: w.recovery_branch,
      };
    });
    process.stdout.write(JSON.stringify({ workloads }, null, 2) + '\n');
    return;
  }

  console.log('');
  console.log('  Available benchmark workloads:');
  console.log('');
  for (const id of ids) {
    const w = BENCHMARK_WORKLOADS[id];
    const flags = [];
    const phaseLabel = Array.isArray(w.phase_order) ? `phases: ${w.phase_order.join(' -> ')}` : null;
    if (phaseLabel) flags.push(phaseLabel);
    if (w.rejected_turn_expected) flags.push('rejected-turn');
    if (w.gate_failure_expected) flags.push('gate-failure');
    if (w.recovery_branch !== 'none') flags.push(`recovery: ${w.recovery_branch}`);
    const flagStr = flags.length > 0 ? ` [${flags.join(', ')}]` : '';
    console.log(`    ${id.padEnd(22)} ${w.description}${flagStr}`);
  }
  console.log('');
  console.log('  Usage: agentxchain benchmark --workload <name>');
  console.log('');
}

export function resolveBenchmarkWorkload(opts = {}) {
  const requestedWorkload = normalizeBenchmarkWorkloadId(opts.workload);
  const stressRequested = Boolean(opts.stress);

  if (stressRequested && requestedWorkload && requestedWorkload !== 'stress') {
    return {
      ok: false,
      error: `Conflicting benchmark workload options: --stress implies "stress" but --workload requested "${requestedWorkload}".`,
      valid_workloads: listBenchmarkWorkloadIds(),
    };
  }

  const workloadId = requestedWorkload || (stressRequested ? 'stress' : 'baseline');
  const workload = BENCHMARK_WORKLOADS[workloadId];

  if (!workload) {
    return {
      ok: false,
      error: `Unknown benchmark workload "${workloadId}". Expected one of: ${listBenchmarkWorkloadIds().join(', ')}.`,
      valid_workloads: listBenchmarkWorkloadIds(),
    };
  }

  return {
    ok: true,
    workload,
    selected_via: requestedWorkload ? '--workload' : (stressRequested ? '--stress' : 'default'),
  };
}
