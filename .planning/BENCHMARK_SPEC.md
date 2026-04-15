# Benchmark Command — Governed Delivery Compliance Proof

## Purpose

Provide a single command that proves the governed delivery engine works correctly against a standardized workload. Operators use this to verify their installation, CI pipelines use it as a smoke test, and the project uses it as evidence that the governance model actually works.

## Scope (v1)

The first version runs a fully governed lifecycle using mock agents (no API keys) and measures governance compliance. It is NOT a performance benchmark — it is a correctness benchmark.

## Interface

```bash
agentxchain benchmark [--json] [--phases <n>] [--turns-per-phase <n>]
```

Options:
- `--json` — output structured JSON instead of human-readable text
- `--phases <n>` — number of phases to run (default: 3, matching planning→implementation→qa)
- `--turns-per-phase <n>` — target turns per phase before gate satisfaction (default: 2)

Exit codes:
- 0 — benchmark passed (all governance checks satisfied)
- 1 — benchmark failed (governance violations detected)

## Behavior

1. Create a temp governed project using `scaffoldGoverned` (same as `agentxchain init --governed`)
2. Configure all runtimes to use the internal mock agent (same one used by `demo`)
3. Run a complete governed lifecycle through all configured phases:
   - Start run → execute turns → satisfy gates → transition phases → complete run
4. After completion, collect governance metrics:
   - **Phases completed:** count and names
   - **Turns executed:** total and per-phase
   - **Gate evaluations:** count, pass/fail
   - **Artifacts produced:** count by type (files, decisions, etc.)
   - **Protocol conformance:** did each turn follow the turn contract?
   - **Admission control:** did pre-run pass cleanly?
   - **Export verification:** does the final export verify?
   - **Elapsed time:** wall-clock time for the full lifecycle
5. Output a compliance report

## Output (human-readable)

```
AgentXchain Benchmark — Governed Delivery Compliance

  Phases completed     3/3  (planning → implementation → qa)
  Turns executed       6    (2 per phase)
  Gate evaluations     3/3  passed
  Artifacts produced   9
  Protocol conformance PASS
  Admission control    PASS
  Export verification   PASS
  Elapsed              2.4s

  Result: PASS ✓
```

## Output (JSON)

```json
{
  "version": "1.0",
  "result": "pass",
  "phases": { "completed": 3, "total": 3, "names": ["planning", "implementation", "qa"] },
  "turns": { "total": 6, "per_phase": { "planning": 2, "implementation": 2, "qa": 2 } },
  "gates": { "evaluated": 3, "passed": 3, "failed": 0 },
  "artifacts": { "total": 9 },
  "admission_control": "pass",
  "export_verification": "pass",
  "elapsed_ms": 2400
}
```

## Error Cases

- Temp dir creation fails → exit 1 with error message
- Mock agent fails → exit 1 with failure details in report
- Gate never satisfied → exit 1 with details on which gate blocked

## Acceptance Tests

- AT-BENCH-001: `agentxchain benchmark` completes with exit 0 and prints PASS
- AT-BENCH-002: `agentxchain benchmark --json` returns valid JSON with `result: "pass"`
- AT-BENCH-003: Elapsed time is reported and > 0
- AT-BENCH-004: All three default phases are completed
- AT-BENCH-005: Export verification passes on the benchmark output

## Open Questions

None. Ship it.
