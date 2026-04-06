# Coordinator Report Drill-Down Spec

**Status**: active
**Decision**: `DEC-COORD-DRILL-001`
**Depends on**: `DEC-REPORT-CTX-001` (operator context enrichment)

## Purpose

Coordinator governance reports currently surface only summary-level child-repo data: repo_id, status, run_id, phase. An operator reviewing a coordinator report must open each child repo's export separately to see turn timelines, decisions, gate outcomes, hook activity, or blocked/recovery context. This forces context-switching and defeats the purpose of a coordinator-level audit surface.

The coordinator export already embeds each child repo's full `agentxchain_run_export`. The report extraction layer intentionally discards this detail. This spec closes that gap.

## Interface

### Input

No new input. The existing coordinator export artifact already contains `repos[repoId].export` with full child-repo exports.

### Output — Extended `buildCoordinatorSubject()` repo entries

Each repo entry in `report.subject.repos` gains these optional fields (only present when `repo.ok === true` and data exists):

```typescript
{
  // existing fields unchanged
  repo_id: string;
  path: string | null;
  ok: boolean;
  status: string | null;
  run_id: string | null;
  phase: string | null;
  project_id: string | null;
  project_name: string | null;
  error: string | null;

  // NEW drill-down fields
  turns: TurnEntry[];           // from extractHistoryTimeline()
  decisions: DecisionEntry[];   // from extractDecisionDigest()
  hook_summary: HookSummary | null;  // from extractHookSummary()
  gate_summary: GateEntry[];    // from extractGateSummary()
  recovery_summary: RecoverySummary | null;  // from extractRecoverySummary()
  blocked_on: string | null;    // from child export state
}
```

Types reuse the same shapes already returned by `buildRunSubject()`.

### Output — Text and Markdown formatters

Coordinator report text and markdown outputs gain per-repo detail sections:

- **Turn Timeline** per repo (only if turns exist) — same row format as governed-run reports
- **Decisions** per repo (only if decisions exist)
- **Gate Outcomes** per repo (only if gates exist)
- **Hook Activity** per repo (only if hooks exist)
- **Recovery** per repo (only if recovery data exists)
- **Blocked on** per repo (only if blocked)

Sections are nested under each repo heading. Empty sections produce no output.

## Behavior

1. `buildCoordinatorSubject()` iterates `artifact.repos`. For each repo where `ok === true` and `export` exists, it calls the same extraction functions used by `buildRunSubject()` on the embedded child export.
2. Failed repos (`ok === false`) get no drill-down fields — they already surface `error`.
3. The coordinator-level summary fields remain unchanged. Drill-down is additive.
4. Text and markdown formatters render per-repo subsections under a repo heading, using the same formatting patterns as governed-run reports.

## Error Cases

- Child repo with `ok: true` but missing/malformed `export` — drill-down fields default to empty arrays / null. No crash.
- Child repo with empty history — `turns` is `[]`, no Turn Timeline section rendered.
- Child repo with no hook-audit.jsonl — `hook_summary` is `null`, no Hook Activity section rendered.

## Acceptance Tests

- `AT-COORD-DRILL-001`: Coordinator export with child repos that have turn history produces `report.subject.repos[].turns` arrays with correct entries.
- `AT-COORD-DRILL-002`: Coordinator export with child repo decisions produces `report.subject.repos[].decisions` arrays.
- `AT-COORD-DRILL-003`: Coordinator text output contains per-repo Turn Timeline and Decisions sections.
- `AT-COORD-DRILL-004`: Coordinator markdown output contains per-repo `### <repo_id>` sections with turn tables and decision lists.
- `AT-COORD-DRILL-005`: Failed child repo (`ok: false`) has no drill-down fields.
- `AT-COORD-DRILL-006`: Child repo with empty history produces empty `turns` array and no rendered timeline section.

## Open Questions

None. The data contract is established, the extraction functions exist, and the rendering patterns are proven by the governed-run report.
