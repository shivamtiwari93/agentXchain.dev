# Benchmark Workload Catalog Spec

**Status:** shipped

## Purpose

Replace the benchmark command's inline boolean branching with a named workload catalog that operators can select explicitly and compare durably. The catalog must define what each workload proves, what failure or recovery branch it exercises, and what evidence should appear in the saved benchmark artifacts.

## Interface

```bash
agentxchain benchmark [--json] [--workload <name>] [--stress] [--output <dir>]
```

Options:
- `--workload <name>` — select a named benchmark workload from the built-in catalog
- `--stress` — compatibility alias for `--workload stress`
- `--json` — emit structured benchmark output
- `--output <dir>` — persist benchmark proof artifacts

Built-in workload names:
- `baseline`
- `stress`
- `completion-recovery`

## Behavior

1. Benchmark workloads are defined in a single catalog module, not as hidden inline branches in the command body.
2. Each catalog entry must define:
   - `id`
   - human-readable `label`
   - `description`
   - whether a rejected turn is expected
   - whether a gate failure is expected
   - which recovery branch the workload exercises
3. `baseline` remains the default workload.
4. `--stress` continues to work, but only as a compatibility alias for `stress`.
5. If `--stress` and `--workload <name>` are both provided with different targets, the command must fail closed with a clear error instead of guessing which one wins.
6. `completion-recovery` must prove a real final-phase gate failure and recovery path:
   - first QA completion attempt is accepted
   - run completion gate fails because a required artifact is missing
   - a follow-up QA turn creates the missing artifact
   - run completion then succeeds
7. Saved `workload.json` must include the selected workload id, description, and expected recovery semantics so later verification is not forced to infer them from history alone.

## Error Cases

- Unknown workload name → benchmark exits 1 and lists valid workload ids
- Conflicting `--stress` and `--workload` values → benchmark exits 1
- A workload claims a gate-failure recovery path but no gate failure is observed → benchmark exits 1
- A workload claims a rejected-turn path but no rejection is observed → benchmark exits 1

## Acceptance Tests

- `AT-BENCH-013`: `agentxchain benchmark --json --workload stress` exits 0 and reports the `stress` workload
- `AT-BENCH-014`: `agentxchain benchmark --json --workload completion-recovery` exits 0, reports at least one failed gate evaluation, and still completes the run
- `AT-BENCH-015`: `agentxchain benchmark --stress --workload baseline` exits 1 with a conflict error
- `AT-BENCH-016`: saved baseline and completion-recovery exports compare cleanly through `agentxchain verify diff`

## Open Questions

None.
