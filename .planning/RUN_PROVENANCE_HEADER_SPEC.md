# Run Provenance Header — Spec

## Purpose

When an operator starts `agentxchain run --continue-from <id>` or `--recover-from <id>`, the run header should confirm the chain relationship immediately — not force the operator to run `status` separately to verify that provenance was applied.

## Current State

The run header (lines 179-181 of `run.js`) prints:

```
agentxchain run
  Max turns: 50  Gate mode: interactive
```

No mention of provenance, parent run, or context inheritance. The operator gets no immediate feedback that their flags took effect.

Meanwhile, `status` already renders provenance (`Origin:` line) and inheritance (`Inherits:` line) correctly. The gap is that `run` itself is silent.

## Interface

After the existing run header, add provenance context lines:

```
agentxchain run
  Max turns: 50  Gate mode: interactive
  Origin:    continuation from abc12345 (via operator)
  Inherits:  parent abc12345 (completed) — 3 phases, 2 decisions, 1 turn
```

- `Origin:` line appears when any provenance exists (continuation or recovery)
- `Inherits:` line appears only when `--inherit-context` was used and context was built
- Both lines use the same `chalk.magenta` color as `status` for consistency
- The `Inherits:` line includes a compact summary: parent status, phases completed count, decisions count, accepted turns count

## Behavior

1. If `provenance` is set after flag validation (line 92), render `Origin:` using `summarizeRunProvenance(provenance)` — same function `status` uses
2. If `inheritedContext` is non-null (line 106), render `Inherits:` with a compact summary
3. Both lines are dim-labeled like the existing `Max turns:` / `Gate mode:` line
4. No extra blank line — fits naturally in the existing header block

## Error Cases

- No provenance → no extra lines (fresh run behavior unchanged)
- Provenance but no inherited context → only `Origin:` line
- Both provenance and inherited context → both lines

## Acceptance Tests

- `AT-RPH-001`: `run --continue-from` shows `Origin: continuation from <id>` in stdout
- `AT-RPH-002`: `run --continue-from --inherit-context` shows both `Origin:` and `Inherits:` lines
- `AT-RPH-003`: `run --recover-from` shows `Origin: recovery from <id>` in stdout
- `AT-RPH-004`: Plain `run` (no provenance) does NOT show `Origin:` line
