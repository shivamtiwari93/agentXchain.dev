# Verify Diff Spec

**Status:** shipped

## Purpose

Add a single verification surface for comparing two export artifacts safely. Operators should not have to manually chain `verify export` twice and then remember to run `diff --export`. `agentxchain verify diff` verifies both artifacts first, then reports semantic governance regressions from the normalized export diff.

## Interface

```bash
agentxchain verify diff <left_export.json> <right_export.json> [--format text|json]
```

## Behavior

1. Load both export artifacts from file paths.
2. Verify each artifact with the same contract used by `agentxchain verify export`.
3. If either artifact fails verification, do not trust the diff surface:
   - emit a combined verification report
   - skip regression diff construction
   - exit non-zero
4. If both artifacts verify, build the normalized export diff and surface:
   - whether the artifacts changed
   - whether governance regressions exist
   - the regression entries when present
5. `overall: "pass"` means:
   - both exports verified successfully
   - diff construction succeeded
   - no governance regressions were detected
6. `overall: "fail"` means:
   - one or both exports failed verification, or
   - both verified but the diff contains governance regressions
7. `overall: "error"` means command/input failure:
   - missing file
   - invalid JSON
   - unsupported or mismatched export kinds

### Text output

Text output prints:
- left/right inputs
- left/right verification status
- diff subject kind when available
- structural change flag
- governance regression count
- regression entries when present
- explicit note when the diff is skipped because verification failed

### JSON output

JSON output shape:

```json
{
  "overall": "fail",
  "left": { "overall": "pass", "input": "/tmp/left.json" },
  "right": { "overall": "pass", "input": "/tmp/right.json" },
  "diff": {
    "subject_kind": "run",
    "changed": true,
    "has_regressions": true,
    "regression_count": 1,
    "regressions": []
  }
}
```

## Error Cases

1. Left or right file is missing or unreadable: exit code `2`
2. Left or right file is invalid JSON: exit code `2`
3. Export kinds differ: exit code `2`
4. Verified artifact fails integrity or summary checks: exit code `1`

## Acceptance Tests

1. **AT-VERIFY-DIFF-001**: `verify diff --help` documents the command and `--format`
2. **AT-VERIFY-DIFF-002**: identical valid run exports return exit code `0` and `overall: "pass"`
3. **AT-VERIFY-DIFF-003**: verified exports with a governance regression return exit code `1` and include the regression in text + JSON output
4. **AT-VERIFY-DIFF-004**: if one export fails verification, diff construction is skipped and the command exits `1`
5. **AT-VERIFY-DIFF-005**: mismatched export kinds return exit code `2`

## Open Questions

None.
