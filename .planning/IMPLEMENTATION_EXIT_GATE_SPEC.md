# Implementation Exit Gate Contract

## Purpose

Make the implementation-phase exit gate depend on a structured handoff artifact instead of verification status alone. Without this, dev can exit implementation with a passing `verification.status` but provide QA with zero context about what changed, how to verify it, or what is unfinished. The QA phase inherits an opaque "verification passed" signal with no operator-readable bridge.

## Interface

- File under contract: `.planning/IMPLEMENTATION_NOTES.md`
- Evaluator entrypoint: `evaluateWorkflowGateSemantics(root, '.planning/IMPLEMENTATION_NOTES.md')`
- Consuming gates:
  - `implementation_complete` phase exit (implementation → QA transition)

## Behavior

The implementation notes pass gate semantics only when all of the following are true:

1. The file exists at `.planning/IMPLEMENTATION_NOTES.md`.
2. The file contains a `## Changes` section documenting what was built or modified.
3. The file contains a `## Verification` section documenting how to verify the work.
4. The `## Changes` section has at least one non-empty content line below the header (not just the scaffold placeholder).
5. The `## Verification` section has at least one non-empty content line below the header (not just the scaffold placeholder).

The scaffold placeholder text `(Dev fills this during implementation)` does not count as real content.

## Error Cases

- Missing file: fail with reason that `.planning/IMPLEMENTATION_NOTES.md` is required before implementation can exit.
- Missing `## Changes` section: fail with reason naming the missing section.
- Missing `## Verification` section: fail with reason naming the missing section.
- Both sections present but only scaffold placeholder content: fail with reason that dev must replace placeholder text with real content.

## Acceptance Tests

- AT-IMPL-GATE-001: scaffold placeholder IMPLEMENTATION_NOTES.md fails the implementation gate.
- AT-IMPL-GATE-002: IMPLEMENTATION_NOTES.md with real `## Changes` but placeholder `## Verification` fails.
- AT-IMPL-GATE-003: IMPLEMENTATION_NOTES.md with both real `## Changes` and real `## Verification` content satisfies the gate.
- AT-IMPL-GATE-004: missing IMPLEMENTATION_NOTES.md fails the gate with a file-missing reason.
- AT-IMPL-GATE-005: E2E governed lifecycle still advances to QA when gate is satisfied (verification pass + notes file).
- AT-IMPL-GATE-006: docs describe the implementation-exit artifact requirement.

## Open Questions

- None for this slice. Template-specific implementation note overlays are explicitly out of scope.
