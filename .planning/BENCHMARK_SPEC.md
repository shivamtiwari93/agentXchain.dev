# Benchmark Command — Governed Delivery Compliance Proof

## Purpose

Provide a single command that proves the governed delivery engine works correctly against a standardized workload. Operators use this to verify their installation, CI pipelines use it as a smoke test, and the project uses it as evidence that the governance model actually works.

## Scope (v1)

The first version runs a fully governed lifecycle using mock agents (no API keys) and measures governance compliance. It is NOT a performance benchmark — it is a correctness benchmark. It supports a named workload catalog:

- `baseline` — one accepted turn per phase
- `stress` — an adversarial retry path where the first implementation attempt is rejected before the run recovers and completes
- `completion-recovery` — an adversarial final-phase path where the first QA completion attempt fails its gate because a required artifact is missing, then recovers and completes

## Interface

```bash
agentxchain benchmark [--json] [--workload <name>] [--stress]
```

Options:
- `--json` — output structured JSON instead of human-readable text
- `--workload <name>` — run a named workload from the benchmark catalog
- `--stress` — compatibility alias for `--workload stress`

Exit codes:
- 0 — benchmark passed (all governance checks satisfied)
- 1 — benchmark failed (governance violations detected)

## Behavior

1. Create a temp governed project using the same repo-native governed scaffold shape the benchmark command owns.
2. Run admission control before any turn is assigned. The benchmark fails closed if topology analysis rejects the config.
3. Run one of the standardized workloads:
   - `baseline`: planning accept → implementation accept → qa accept → completion
   - `stress`: planning accept → implementation reject/retry → implementation accept → qa accept → completion
   - `completion-recovery`: planning accept → implementation accept → qa accept with missing ship verdict → completion gate fails → qa repair turn → qa completion succeeds
4. Drive the governed lifecycle through all phases:
   - Start run → execute turns → satisfy gates → transition phases → complete run
4. After completion, collect governance metrics:
   - **Phases completed:** count and names
   - **Turns executed:** total, accepted vs rejected, and per-phase
   - **Gate evaluations:** count, pass/fail
   - **Artifacts produced:** count by type (files, decisions, etc.)
   - **Admission control:** did pre-run pass cleanly?
   - **Export verification:** does the final export artifact verify against embedded bytes, hashes, and summary invariants?
   - **Elapsed time:** wall-clock time for the full lifecycle
5. Output a compliance report
6. Saved benchmark proof currently uses repo-local run exports, not coordinator exports. Operators comparing those saved artifacts through `verify diff` should expect repo-local diff semantics here, not implicit coordinator repo-status behavior.
7. If benchmark proof is ever extended to emit coordinator exports, the comparison contract stays explicit: `verify diff` must treat `summary.repo_run_statuses` as coordinator snapshot metadata only and derive repo-status changes/regressions from authority-first child repo status when nested child exports are readable.

## Output (human-readable)

```
AgentXchain Benchmark — Governed Delivery Compliance

  Mode                 BASELINE
  Phases completed     3/3  (planning → implementation → qa)
  Turns executed       3    (3 accepted, 0 rejected; 1 planning, 1 implementation, 1 qa)
  Gate evaluations     3/3  passed
  Artifacts produced   5
  Admission control    PASS
  Export verification  PASS
  Elapsed              2.4s

  Result: PASS ✓
```

## Output (JSON)

```json
{
  "version": "1.0",
  "mode": "baseline",
  "result": "pass",
  "phases": { "completed": 3, "total": 3, "names": ["planning", "implementation", "qa"] },
  "turns": {
    "total": 3,
    "accepted": 3,
    "rejected": 0,
    "per_phase": { "planning": 1, "implementation": 1, "qa": 1 }
  },
  "gates": { "evaluated": 3, "passed": 3, "failed": 0 },
  "artifacts": { "total": 5 },
  "admission_control": "pass",
  "export_verification": "pass",
  "elapsed_ms": 2400
}
```

## Error Cases

- Temp dir creation fails → exit 1 with error message
- Stress retry unexpectedly validates → exit 1 because the adversarial workload is no longer exercising rejection semantics
- Completion-recovery workload does not observe a real failed completion gate → exit 1 because the adversarial branch was not exercised
- Gate never satisfied → exit 1 with details on which gate blocked
- Unknown workload name or conflicting `--stress` / `--workload` options → exit 1 with valid workload guidance
- Export build or export verification fails → exit 1 with failure details in report

## Acceptance Tests

- AT-BENCH-001: `agentxchain benchmark` completes with exit 0 and prints PASS
- AT-BENCH-002: `agentxchain benchmark --json` returns valid JSON with `result: "pass"`
- AT-BENCH-003: Elapsed time is reported and > 0
- AT-BENCH-004: All three default phases are completed
- AT-BENCH-005: Export verification passes on the benchmark output
- AT-BENCH-006: `agentxchain benchmark --stress --json` completes with exit 0, reports `mode: "stress"`, and records at least one rejected turn before recovery
- AT-BENCH-007: Stress mode still completes all gates and phases after the rejected implementation attempt
- AT-BENCH-013: `agentxchain benchmark --json --workload stress` exits 0 and reports the `stress` workload
- AT-BENCH-014: `agentxchain benchmark --json --workload completion-recovery` exits 0, reports at least one failed gate evaluation, and still completes the run
- AT-BENCH-015: `agentxchain benchmark --stress --workload baseline` exits 1 with a clear conflict error
- AT-BENCH-016: baseline and completion-recovery benchmark artifacts saved with `--output` compare cleanly through `verify diff`
- AT-BENCH-021: benchmark docs/specs state that saved benchmark artifacts are repo-local today and that any future coordinator comparison still inherits `verify diff`'s authority-first child repo-status boundary
- AT-BENCH-022: the `v2.102.0` release-notes page states that benchmark saved artifacts are repo-local today and separately restates the future coordinator `verify diff` truth boundary

## Open Questions

None. Ship it.

## Follow-on

Durable saved proof artifacts are specified separately in `.planning/BENCHMARK_OUTPUT_SPEC.md`.
Named workload catalog behavior is specified separately in `.planning/BENCHMARK_WORKLOAD_CATALOG_SPEC.md`.
Phase topology resolution is specified separately in `.planning/BENCHMARK_PHASE_TOPOLOGY_SPEC.md`.
