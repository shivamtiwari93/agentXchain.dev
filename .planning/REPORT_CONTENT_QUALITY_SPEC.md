# Governance Report Content Quality Spec

**Status:** shipped
**Author:** Claude Opus 4.6 (Turn 35)
**Decision:** `DEC-REPORT-QUALITY-001`

## Problem

The governance report currently surfaces **metadata counts** but not **governance evidence**. An operator reading `report-<run_id>.md` after a run sees:

- History entries: 4
- Decision entries: 2
- Hook audit entries: 1

This tells them things exist, not what happened. For a governance report to be actionable, it must answer:

1. **What happened?** — Turn-by-turn timeline with role, outcome, summary, and timing.
2. **What was decided?** — Decision statements, not just counts.
3. **Were gates satisfied?** — Phase transitions and their outcomes.
4. **How long did it take?** — Run duration and per-turn timing.
5. **Were there problems?** — Blocked states, objections, hook violations.

## Data Available

The export artifact already contains all the raw data needed. The `files` object includes:

- `.agentxchain/history.jsonl` — per-turn records with: `turn_id`, `role`, `status`, `summary`, `decisions[]`, `objections[]`, `files_changed[]`, `cost`, `accepted_at`, `phase_transition_request`, `run_completion_request`
- `.agentxchain/decision-ledger.jsonl` — per-decision records with: `id`, `turn_id`, `role`, `phase`, `category`, `statement`, `rationale`, `status`
- `.agentxchain/hook-audit.jsonl` — per-hook records with: `hook_id`, `event`, `result`, `blocked`
- `.agentxchain/state.json` — current state with: `phase`, `status`, `blocked_on`, `blocked_reason`, `created_at`

## Interface

### `buildRunSubject(artifact)` additions

Add to the existing `subject.run` object:

```js
{
  // existing fields unchanged ...

  // NEW: timing
  created_at: string | null,        // from state.created_at
  completed_at: string | null,      // from last history entry accepted_at (if status=completed)
  duration_seconds: number | null,  // computed from created_at → completed_at

  // NEW: turn timeline (ordered by accepted_sequence)
  turns: [
    {
      turn_id: string,
      role: string,
      status: string,             // 'accepted'
      summary: string,
      phase: string | null,       // phase at time of acceptance
      phase_transition: string | null, // target phase if transition occurred
      files_changed_count: number,
      decisions: string[],        // decision IDs
      objections: string[],       // objection IDs
      cost_usd: number | null,
      accepted_at: string,
    }
  ],

  // NEW: decision digest (from decision-ledger.jsonl)
  decisions: [
    {
      id: string,
      turn_id: string,
      role: string,
      phase: string,
      statement: string,
    }
  ],

  // NEW: hook summary (from hook-audit.jsonl)
  hook_summary: {
    total: number,
    blocked: number,
    events: { [event: string]: number },  // count per event type
  },
}
```

### Markdown report additions

After the existing bullet list, add:

```markdown
## Turn Timeline

| # | Role | Phase | Summary | Files | Cost | Time |
|---|------|-------|---------|-------|------|------|
| 1 | dev  | dev   | Implemented feature X | 3 | $0.12 | 2026-04-06T20:01:00Z |
| 2 | qa   | qa    | Verified feature X passes | 0 | $0.08 | 2026-04-06T20:02:30Z |

## Decisions

- **DEC-001** (dev, dev phase): Use PostgreSQL for persistence
- **DEC-002** (qa, qa phase): Acceptance criteria met

## Hook Activity

- Total hook executions: 3
- Blocked: 0
- Events: after_acceptance(2), after_phase_transition(1)
```

### Text report additions

Append after existing lines, same data in flat text format.

## Behavior

1. If the export has no `history.jsonl` data (empty or missing), the turn timeline section is omitted entirely (not shown as empty).
2. If there are no decisions, the decisions section is omitted.
3. If there are no hook audit entries, the hook activity section is omitted.
4. Timing fields are `null` when `created_at` is missing from state.
5. Cost is shown as `n/a` when the turn has no cost data.
6. The coordinator report already has repo-level detail; this spec only affects `governed_run` reports.

## Error Cases

- Malformed history entries (missing `turn_id` or `role`) are skipped with no error.
- Malformed decision entries are skipped with no error.
- Hook audit parse failures are treated as 0 entries.

## Acceptance Tests

- `AT-RQ-001`: Report markdown for a run with 2+ accepted turns includes a "Turn Timeline" table with one row per turn.
- `AT-RQ-002`: Report markdown for a run with decisions includes a "Decisions" section listing each decision's ID, role, phase, and statement.
- `AT-RQ-003`: Report markdown for a run with hook audit entries includes a "Hook Activity" section with total/blocked counts.
- `AT-RQ-004`: Report JSON `subject.run.turns` array has one entry per history entry, ordered by `accepted_sequence`.
- `AT-RQ-005`: Report JSON `subject.run.decisions` array mirrors decision-ledger content.
- `AT-RQ-006`: Report JSON `subject.run.created_at` and `completed_at` are populated; `duration_seconds` is computed.
- `AT-RQ-007`: Report with no history entries omits timeline section entirely (no empty table).
- `AT-RQ-008`: Existing report assertions (AT-REPORT-001 through 007) continue to pass unchanged.

## Open Questions

None. The data is already in the export artifact; this is a rendering/structuring change only.
