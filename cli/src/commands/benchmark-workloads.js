export const BENCHMARK_WORKLOADS = Object.freeze({
  baseline: Object.freeze({
    id: 'baseline',
    label: 'Baseline',
    description: 'One accepted turn per phase with no recovery branches.',
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
