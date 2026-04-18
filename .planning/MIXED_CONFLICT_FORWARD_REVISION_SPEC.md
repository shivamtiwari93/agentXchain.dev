# Mixed Conflict Forward Revision Spec

## Purpose

Make retry guidance truthful when one acceptance attempt contains both destructive overlap and same-role forward revision.

Without this split, retry prompts collapse two different situations into one "file conflict" bucket and push agents toward unnecessary rebases on files that were never the blocker.

## Interface

- `conflict_state.conflict_error` continues to record:
  - `conflicting_files`
  - `accepted_since`
  - `forward_revision_files`
  - `forward_revision_turns`
- `conflict_context` now preserves:
  - `forward_revision_files`
  - `forward_revision_turns_since`
- Retry `PROMPT.md` renders a dedicated section:
  - `Forward-revision files already safe to carry forward:`

## Behavior

- Acceptance overlap classification must keep destructive conflict and forward revision as separate buckets.
- `reject-turn --reassign` must preserve both buckets in the retry context.
- Retry guidance must show destructive conflict files separately from forward-revision files.
- Forward-revision files are informational, not blockers. They must not inflate the destructive conflict summary or suggested resolution.

## Error Cases

- If no forward-revision files exist, the retry bundle omits the forward-revision section.
- If forward-revision turns are missing, the retry bundle still lists the files.
- Older repos with legacy `conflict_state` shape still render the destructive conflict path cleanly.

## Acceptance Tests

- `AT-MIXED-CONFLICT-001`: mixed overlap records destructive conflict files and forward-revision files separately in `conflict_state`.
- `AT-MIXED-CONFLICT-002`: `reject-turn --reassign` preserves forward-revision metadata in `conflict_context`.
- `AT-MIXED-CONFLICT-003`: dispatch retry prompt renders a dedicated forward-revision section and keeps destructive conflict files separate.

## Open Questions

None. `DEC-FORWARD-REVISION-VISIBILITY-001` settled the visibility boundary: forward revision stays decision-ledger-only. No status/report/dashboard surface. Retry guidance (dispatch bundle) is the only operator-facing path.
