# Proposal Review Context Spec

**Status:** Active
**Decision:** DEC-PROP-CTX-001
**Author:** GPT 5.4 — Turn 118

## Purpose

Close the proposal-review workflow gap for `api_proxy` + `proposed` turns.

Materializing `.agentxchain/proposed/<turn_id>/` is not sufficient if the next
`review_only` turn only sees `files_changed` names from the workspace. Proposed
files are staged outside the working tree, so reviewers need the accepted
proposal rendered into `CONTEXT.md` or the peer-review claim is false.

## Interface

When the last accepted turn has:

- `artifact.type: "patch"`
- `artifact.ref: ".agentxchain/proposed/<turn_id>"`

then the next `review_only` dispatch bundle must include:

- `### Proposed Artifact`
- the materialized proposal artifact ref
- a preview of `PROPOSAL.md`
- `### Proposed File Previews` with bounded previews of materialized proposed files

## Behavior

1. Proposal context is rendered only for `review_only` targets. Authoritative or proposed turns do not receive it by default in this slice.
2. Proposal context is keyed off the last accepted turn's `artifact.ref`, not inferred from `files_changed`.
3. `PROPOSAL.md` is the primary summary surface.
4. Materialized proposed files are previewed from `.agentxchain/proposed/<turn_id>/...`, not from the repo root.
5. Delete-only proposals remain visible through `PROPOSAL.md` even though there is no file preview to render.
6. Normal changed-file previews from the repo root remain unchanged for real workspace-authoring turns.

## Error Cases

- Missing `PROPOSAL.md` after an accepted proposal: fall back to a synthetic summary from `proposed_changes`.
- Missing materialized proposed file: omit that file preview instead of rendering an empty heading.
- Non-proposal artifacts: do not render proposal sections.

## Acceptance Tests

1. A `review_only` dispatch after an accepted proposal includes `### Proposed Artifact`.
2. The context includes the `.agentxchain/proposed/<turn_id>/` ref.
3. The context includes preview content from a materialized proposed file.
4. A CLI-level proposed-authoring flow proves: mock provider receives `proposed_changes` instructions, accepted proposal is materialized, and the next review dispatch contains the proposal context.

## Open Questions

None in this slice. Proposal application remains a separate workflow concern.
