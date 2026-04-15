# Cross-Run Decision Carryover Spec

## Purpose

Decisions from completed runs persist as binding constraints on future runs in the same repo. This transforms the decision ledger from a run-scoped artifact into a repo-level governance surface — the foundation for long-horizon governed delivery.

## Interface

### Decision Schema Extension

Add optional `durability` field to decision objects in turn results:

```json
{
  "id": "DEC-042",
  "category": "architecture",
  "statement": "All API endpoints must validate input with schema-guard",
  "rationale": "Prevents untyped data from reaching business logic",
  "durability": "repo"
}
```

- `durability`: `"run"` (default, current behavior) | `"repo"` (persists across runs)
- Omitted = `"run"` (backward-compatible)

### Storage

- **Repo decisions file:** `.agentxchain/repo-decisions.jsonl` (append-only, survives `initializeGovernedRun`)
- Each entry: `{ id, run_id, turn_id, role, phase, category, statement, rationale, status, overridden_by, created_at }`
- `status`: `"active"` | `"overridden"`
- `overridden_by`: null | decision ID that supersedes this one

### Override Mechanism

Add optional `overrides` field to decision schema:

```json
{
  "id": "DEC-099",
  "category": "architecture",
  "statement": "API validation moved to middleware layer",
  "rationale": "schema-guard was too slow for hot-path endpoints",
  "overrides": "DEC-042"
}
```

- `overrides`: string (DEC-NNN pattern), marks the referenced repo decision as `status: "overridden"`, `overridden_by: "DEC-099"`
- The overriding decision inherits the overridden decision's durability (if overriding a repo decision, the override is also repo-durable)
- Can only override `active` repo decisions
- Cannot self-override

### CLI: `agentxchain decisions`

New command with subcommands:

- `agentxchain decisions list` — show active repo-level decisions (table: id, category, statement, decided_by, run_id)
- `agentxchain decisions list --all` — include overridden decisions
- `agentxchain decisions show DEC-042` — full detail for one decision
- `agentxchain decisions --json` — JSON output mode

### Run Bootstrap Injection

When `initializeGovernedRun` starts a new run:
1. Read `.agentxchain/repo-decisions.jsonl`
2. Filter to `status: "active"`
3. Attach as `state.repo_decisions` (array of active repo decisions)
4. Surface in `status` output and agent dispatch context

### Agent Dispatch Context

Active repo decisions are included in the CONTEXT.md section delivered to agents:

```markdown
## Active Repo Decisions

These decisions persist from prior governed runs. Comply or explicitly override with rationale.

- **DEC-042** (architecture): All API endpoints must validate input with schema-guard
- **DEC-055** (process): PRs require at least one E2E test
```

### Export & Report

- `export` includes `summary.repo_decisions` with active + overridden repo decisions
- `report` renders repo decisions section in text/json/markdown formats

## Behavior

1. Turn result with `durability: "repo"` decision → on acceptance, written to both `decision-ledger.jsonl` (run-scoped) and `repo-decisions.jsonl` (persistent)
2. Turn result with `overrides: "DEC-042"` → validates DEC-042 exists and is active in repo-decisions, marks it overridden, writes the new decision
3. `initializeGovernedRun` does NOT reset `repo-decisions.jsonl` (unlike `decision-ledger.jsonl` which is run-scoped)
4. `agentxchain decisions list` works outside of active runs (it reads the persistent file)

## Error Cases

- `overrides` references non-existent repo decision → validation error
- `overrides` references already-overridden decision → validation error ("DEC-042 is already overridden by DEC-077")
- `overrides` references a run-scoped (non-repo) decision → validation error ("DEC-042 is run-scoped, only repo-durable decisions can be overridden")
- `durability` value not in `["run", "repo"]` → schema validation error
- Self-override (overrides own ID) → validation error

## Acceptance Tests

1. Decision with `durability: "repo"` is written to `repo-decisions.jsonl` on acceptance
2. Decision with default/omitted durability is NOT written to `repo-decisions.jsonl`
3. New run sees active repo decisions in `state.repo_decisions`
4. `agentxchain decisions list` shows active repo decisions
5. `agentxchain decisions list --all` shows overridden + active
6. Override marks target as `overridden`, new decision as `active`
7. Override of non-existent decision fails validation
8. Override of already-overridden decision fails validation
9. `initializeGovernedRun` preserves `repo-decisions.jsonl`
10. Export includes `summary.repo_decisions`
11. Report renders repo decisions section
12. Dispatch context includes active repo decisions markdown

## Open Questions

None — this extends existing patterns cleanly.
