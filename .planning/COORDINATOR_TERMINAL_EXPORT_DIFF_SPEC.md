# Coordinator Terminal Export Diff Spec

**Status**: shipped

## Purpose

Keep coordinator export diffs truthful when both compared coordinator exports are already terminal (`status: "completed"`).

Completed coordinators may still disagree with later child-repo snapshots. That drift is real and should remain visible in the diff output, but it is no longer an operator next-step contract. Treating terminal child drift as a governance regression causes `diff --export` / `verify diff` to fail as if the completed coordinator still requires recovery work.

## Interface

```
agentxchain diff <left_export.json> <right_export.json> --export [--json]
agentxchain verify diff <left_export.json> <right_export.json> [--format text|json]
```

## Behavior

When both compared coordinator exports have `summary.status === "completed"`:

1. Changed child repo status still appears in `repo_status_changes`.
2. Changed child nested-export success still appears in `repo_export_changes`.
3. `REG-REPO-STATUS-*` must not be emitted for those child status changes.
4. `REG-REPO-EXPORT-*` must not be emitted for those child export changes.
5. `has_regressions` remains `false` unless some other regression category still applies.
6. `verify diff` must pass when terminal coordinator child drift is the only change.

When either side is non-terminal, the existing child repo regression rules still apply.

## Error Cases

1. If either export is not a coordinator export, this spec does not apply.
2. If either export fails verification, `verify diff` still fails before diff semantics matter.
3. If terminal coordinator exports also include true run-level regressions (for example event loss or malformed phase metadata), those regressions still surface normally.

## Acceptance Tests

1. `AT-COORD-TERM-DIFF-001`: completed-to-completed coordinator child status drift appears in `repo_status_changes` but does not emit `REG-REPO-STATUS-*`.
2. `AT-COORD-TERM-DIFF-002`: completed-to-completed coordinator child export drift appears in `repo_export_changes` but does not emit `REG-REPO-EXPORT-*`.
3. `AT-VERIFY-DIFF-006`: `verify diff` passes for two verified completed coordinator exports when child drift is the only difference.

## Open Questions

None.
