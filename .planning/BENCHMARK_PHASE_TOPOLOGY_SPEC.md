# Benchmark Phase Topology Spec

**Status:** shipped

## Purpose

Stop benchmark workload topology from living as an ad hoc `if (design)` branch inside `benchmark.js`. Workloads that add phases must declare their phase order and any custom phase definitions explicitly so config generation, prompt scaffolding, runtime routing, and workload discovery stay aligned.

## Interface

Workload catalog entries may define:

- `phase_order: string[]`
- `custom_phases?: Record<string, BenchmarkPhaseSpec>`

`BenchmarkPhaseSpec` fields:

- `id`
- `handler`
- `role`
- `runtime`
- `prompt`
- `allowed_next_roles`
- `gate`
- `execution`

Operator discovery surface:

```bash
agentxchain benchmark workloads
agentxchain benchmark workloads --json
```

## Behavior

1. Every workload has an explicit `phase_order`.
2. Built-in benchmark phases remain `planning`, `implementation`, and `qa`.
3. Custom phases may be inserted anywhere between `planning` and `qa` as long as:
   - `planning` is first
   - `implementation` exists
   - `qa` is last
   - `implementation` appears before `qa`
4. Benchmark config generation must build `roles`, `runtimes`, `routing`, and `gates` from resolved phase specs instead of mutating a hand-written base config for a single known workload.
5. Prompt scaffolding must derive prompt files from the resolved phase specs so added benchmark roles do not require bespoke prompt-writing branches.
6. `agentxchain benchmark workloads` must expose phase topology to operators:
   - human-readable output includes a `phases: ...` indicator
   - JSON output includes `phase_order` and `phase_count`
7. `phase-drift` is the first custom topology workload and uses:
   - `planning`
   - `design`
   - `implementation`
   - `qa`

## Error Cases

- A workload references an unknown phase id → benchmark exits 1
- A workload defines duplicate phase ids → benchmark exits 1
- A workload does not start with `planning` → benchmark exits 1
- A workload omits `implementation` → benchmark exits 1
- A workload does not end with `qa` → benchmark exits 1
- A workload places `implementation` after `qa` → benchmark exits 1

## Acceptance Tests

- `AT-BENCH-017`: `phase-drift` completes as a 4-phase workload
- `AT-BENCH-018`: baseline vs `phase-drift` triggers `REG-PHASE-ORDER-001`
- `AT-BENCH-019`: `benchmark workloads` shows the `phase-drift` topology in human-readable output
- `AT-BENCH-020`: `benchmark workloads --json` includes `phase_order` and `phase_count`

## Open Questions

None.
