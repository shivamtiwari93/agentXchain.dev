# Benchmark Output Artifacts Spec

**Status:** shipped

## Purpose

Make `agentxchain benchmark` produce durable proof artifacts instead of only ephemeral temp-dir output. Operators need saved artifacts they can verify, diff, upload to CI logs, and compare across benchmark modes.

## Interface

```bash
agentxchain benchmark [--json] [--stress] [--output <dir>]
```

Options:
- `--json` — emit the benchmark result as structured JSON
- `--stress` — run the rejected-turn recovery workload
- `--output <dir>` — persist benchmark proof artifacts into the target directory

Persisted files:
- `metrics.json`
- `run-export.json`
- `verify-export.json`
- `workload.json`

## Behavior

1. The benchmark still runs in a temp governed project.
2. When `--output` is provided, the command creates the target directory if needed and writes durable proof artifacts there before cleaning up the temp project.
3. `run-export.json` must be the real run export artifact built from the benchmark workspace, not a synthetic summary.
4. `verify-export.json` must contain the verification report for `run-export.json`.
5. `metrics.json` must include the benchmark outcome plus absolute paths to the persisted proof files.
6. `workload.json` must record the benchmark mode, run id, expected phase order, and whether the workload intentionally includes a rejected turn.
7. The command remains fail-closed on export verification. If export build or verification fails, the benchmark fails.
8. Saved artifacts must be consumable by the public CLI surfaces:
   - `agentxchain verify export --input <dir>/run-export.json`
   - `agentxchain verify diff <left-dir>/run-export.json <right-dir>/run-export.json`

## Error Cases

- `--output` points to an unwritable directory → benchmark exits 1
- export build fails → benchmark exits 1 and does not report success
- export verification fails → benchmark exits 1 and does not report success
- saved artifact cannot be re-verified through `verify export` → test failure

## Acceptance Tests

- `AT-BENCH-010`: `agentxchain benchmark --json --output <dir>` writes `metrics.json`, `run-export.json`, `verify-export.json`, and `workload.json`
- `AT-BENCH-011`: `agentxchain verify export --input <dir>/run-export.json` exits 0 for a saved benchmark artifact
- `AT-BENCH-012`: baseline and stress benchmark artifacts saved with `--output` can be compared with `agentxchain verify diff` and the command exits 0

## Open Questions

None.
