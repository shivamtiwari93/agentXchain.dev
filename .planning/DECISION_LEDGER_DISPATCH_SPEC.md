# Decision Ledger Dispatch Spec

## Purpose

Surface cumulative governed decisions from `decision-ledger.jsonl` in the dispatch bundle `CONTEXT.md` so agents can see the full decision history across all turns, not just the last turn's decisions.

## Problem Statement

VISION.md lists "explicit decision history" as a core governance property. The decision ledger exists and records every decision across all turns with `{id, turn_id, role, phase, category, statement, rationale, status, created_at}`. However, `dispatch-bundle.js:renderContext()` only includes the last accepted turn's decisions (from `history.jsonl` last entry). An agent in turn N cannot see decisions from turns 1 through N-2.

This causes:
- **Decision relitigation**: agent proposes something already decided against
- **Consistency drift**: agent contradicts an earlier decision without knowing
- **Wasted turns**: agent discovers mid-turn that something was already settled

## Interface

### Input

- `decision-ledger.jsonl` at `.agentxchain/decision-ledger.jsonl`
- Each line is a JSON object. Agent-authored decisions have: `{id, turn_id, role, phase, category, statement, rationale, objections_against, status, overridden_by, created_at}`
- System decisions (gate failures, escalations, conflict resolutions, policy actions) have different shapes with a `type` or `decision` field instead of `id`

### Output

A new `## Decision History` section in `CONTEXT.md`, placed after "Last Accepted Turn" and before "Blockers", containing only agent-authored decisions (those with an `id` field).

### Format

```markdown
## Decision History

| ID | Phase | Role | Statement |
|----|-------|------|-----------|
| DEC-001 | planning | pm | Use PostgreSQL for persistence |
| DEC-002 | planning | architect | REST over GraphQL for v1 API |
| DEC-003 | implementation | dev | Use Vitest for unit tests |
```

### Boundaries

- **Max entries**: 50 most recent agent-authored decisions. If more exist, include the 50 most recent and add a note: `_Showing 50 of N decisions. Full ledger at .agentxchain/decision-ledger.jsonl._`
- **Filter**: Only include entries with an `id` field (agent-authored). Exclude system entries (gate failures, escalations, policy actions, conflict resolutions).
- **Compression**: Decision History is compressible context. In `context-compressor.js`, it is dropped after `phase_gate_status` and before `gate_required_files`, `last_turn_objections`, and `last_turn_decisions`.
- **Empty ledger**: If no agent-authored decisions exist, omit the section entirely.

## Behavior

1. `renderContext()` reads `decision-ledger.jsonl` if it exists
2. Filters to agent-authored entries (has `id` field)
3. Takes the last 50 entries (most recent by file order, which is chronological)
4. Renders as a markdown table with columns: ID, Phase, Role, Statement
5. Inserts after "Last Accepted Turn" section, before "Blockers"

## Error Cases

- File does not exist: omit section (no error)
- File is empty: omit section
- Malformed JSON lines: skip individual lines, push warning
- File read error: push warning, omit section

## Acceptance Tests

1. When `decision-ledger.jsonl` has 3 agent decisions, CONTEXT.md includes a "Decision History" table with 3 rows
2. When ledger has 60 agent decisions, table shows 50 rows with truncation note
3. When ledger has only system entries (no `id` field), section is omitted
4. When ledger file does not exist, section is omitted (no error)
5. When ledger has mixed agent + system entries, only agent entries appear
6. Table columns are: ID, Phase, Role, Statement
7. Decisions appear in chronological order (oldest first in table)
8. Malformed JSON lines are skipped without crashing

## Open Questions

None. This is a narrow, well-bounded addition to the existing dispatch context surface.
