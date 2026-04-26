# System Spec — agentXchain.dev

## Purpose

(Describe the problem this slice solves and why it exists.)

## Interface

(List the user-facing commands, files, APIs, or contracts this slice changes.)

### Turn Artifact Contract

- `artifact.type: "workspace"` means the role intentionally modified repo files. `files_changed` must be non-empty and match the observed diff.
- `artifact.type: "review"` means the role performed governance, QA, PM, launch, or routing work without repo mutations. `files_changed` must be `[]`.
- `artifact.type: "patch"` means the role returned structured proposed changes rather than direct workspace writes.
- `artifact.type: "commit"` means the role produced or referenced a git commit artifact.
- Empty `workspace` artifacts are recoverable only when the turn is unambiguously a no-edit review; the accepted record is normalized to `review` and an `artifact_type_auto_normalized` event is emitted.

## Behavior

(Describe the expected behavior, including important edge cases.)

## Error Cases

(List the failure modes and how the system should respond.)

## Acceptance Tests

- [ ] Name the executable checks that prove this slice works.

## Open Questions

- (Capture unresolved product or implementation questions here.)
