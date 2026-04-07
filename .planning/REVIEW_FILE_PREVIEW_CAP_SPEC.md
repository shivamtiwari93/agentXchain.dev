# Review File Preview Cap Spec

## Purpose

Reduce false QA objections caused by truncating modest changed files before review-only turns can inspect their syntactic completeness.

## Interface

- `cli/src/lib/dispatch-bundle.js`
- `cli/test/dispatch-bundle.test.js`

## Behavior

1. Review-only turns still receive bounded changed-file previews.
2. The line cap must be high enough that small single-file implementations are usually shown in full.
3. Larger files must still truncate with an explicit indicator.

## Error Cases

| Case | Required behavior |
|------|-------------------|
| Small file slightly above the old 80-line cap | Show the full file instead of truncating away the closing lines |
| Large file exceeds the cap | Truncate deterministically and show the cap in the indicator |

## Acceptance Tests

- **AT-RFPC-001**: An 81-line changed file is rendered in full for a review-only QA turn.
- **AT-RFPC-002**: A larger changed file still truncates and the indicator names the new cap.

## Open Questions

- None. This is a bounded review-surface adjustment, not a protocol change.
