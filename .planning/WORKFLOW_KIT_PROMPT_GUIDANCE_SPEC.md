# Workflow-Kit Prompt Guidance Spec

> Status: **Shipped** — Slice 5 of the workflow-kit implementation
> Depends on: WORKFLOW_KIT_RUNTIME_CONTEXT_SPEC.md

## Purpose

Make workflow-kit accountability explicit in `PROMPT.md`, not just visible in `CONTEXT.md`.

The prior slice made the full phase artifact contract visible through `## Workflow Artifacts`, but that still left one practical gap: the assigned role had to infer which artifacts were actually theirs to produce or update. This slice closes that gap by rendering a role-scoped responsibility section in `PROMPT.md`.

## Interface

A new `## Workflow-Kit Responsibilities` section is added to `PROMPT.md` after the write-authority guidance block and before `## Phase Exit Gate`.

### Section format

```markdown
## Workflow-Kit Responsibilities

You are accountable for these workflow-kit artifacts in phase `implementation`:

- `.planning/IMPLEMENTATION_NOTES.md` — required; semantics: `implementation_notes`; status: exists
- `.planning/ARCHITECTURE.md` — required; semantics: `section_check`; status: MISSING

Do not request phase transition or run completion while a required workflow-kit artifact you own is missing or incomplete.
```

## Behavior

### Responsibility resolution

Responsibility is computed from the current phase's `workflow_kit` artifact list:

1. If an artifact declares `owned_by`, that role is responsible.
2. If `owned_by` is absent or null, responsibility defaults to `routing[phase].entry_role`.
3. Only artifacts assigned to the current role are listed in `PROMPT.md`.
4. Roles with zero responsibilities for the current phase do **not** get this section.

This is intentionally narrower than `CONTEXT.md`:

- `CONTEXT.md` shows the full phase contract.
- `PROMPT.md` shows only the current role's accountable subset.

### Per-artifact line content

Each bullet includes:

- `artifact.path`
- `required` vs `optional`
- `semantics` ID, or `—` when null
- on-disk status: `exists` or `MISSING`

### Section placement

The section must appear:

1. after the write-authority block (`review_only`, `authoritative`, or `proposed`)
2. before `## Phase Exit Gate` when a gate exists

### Runtime caveat

This slice does **not** change write-authority rules. If a runtime cannot write repo files directly, the existing prompt constraints still apply. The responsibility section clarifies accountability; it does not grant extra write access.

## Error Cases

- `workflow_kit` absent or current phase absent in `workflow_kit.phases`: no section rendered
- artifact missing `path`: ignore it
- file existence check throws: report `MISSING`
- current phase missing from `routing`: only explicit `owned_by` artifacts can resolve; unowned artifacts are omitted

## Acceptance Tests

These tests must fail before implementation and pass after:

1. **AT-WKP-001**: the current phase entry role sees unowned workflow-kit artifacts for that phase in `PROMPT.md`.
2. **AT-WKP-002**: a role sees explicitly owned artifacts (`owned_by`) in `PROMPT.md` even when that role is not the phase entry role.
3. **AT-WKP-003**: a role does **not** see artifacts owned by another role, and the section is omitted when it owns none.
4. **AT-WKP-004**: each responsibility line shows required/optional, semantics, and existence status truthfully.
5. **AT-WKP-005**: the section appears after write-authority guidance and before `## Phase Exit Gate`.
6. **AT-WKP-006**: `website-v2/docs/adapters.mdx` documents that `PROMPT.md` renders role-scoped workflow-kit responsibilities while `CONTEXT.md` renders the full phase artifact table.

## Open Questions

None. The overlap with `CONTEXT.md` is intentional and should remain. `CONTEXT.md` is phase-wide awareness; `PROMPT.md` is role-scoped accountability.
