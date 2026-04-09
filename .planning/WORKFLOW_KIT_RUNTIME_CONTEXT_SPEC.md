# Workflow-Kit Runtime Context Spec

> Status: **Active** — Slice 4 of the workflow-kit implementation
> Depends on: WORKFLOW_KIT_CONFIG_SPEC.md (Slices 1-3)

## Purpose

Make the workflow-kit artifact contract visible to agents at dispatch time, before gate evaluation. Today, agents only discover artifact requirements when a gate fails. This slice renders the current phase's `workflow_kit` artifacts into `CONTEXT.md` so every governed turn starts with a clear picture of what artifacts exist, which are required, who owns them, and what semantic checks will run at gate time.

## Interface

A new `## Workflow Artifacts` section is added to `CONTEXT.md` between `## Escalation` and `## Gate Required Files`.

### Section format (non-review roles)

```markdown
## Workflow Artifacts

Current phase **implementation** declares the following artifacts:

| Artifact | Required | Semantics | Owner | Status |
|----------|----------|-----------|-------|--------|
| `.planning/IMPLEMENTATION_NOTES.md` | yes | `implementation_notes` | dev | exists |
| `.planning/acceptance-matrix.md` | yes | `acceptance_matrix` | — | MISSING |
```

### Section format (review-only roles)

Same table, but each existing artifact also gets a preview block (reusing the existing gate-file preview mechanics: max 60 lines, semantic annotation where applicable).

### When the section is omitted

- If the current phase has zero `workflow_kit` artifacts (including explicit `workflow_kit: {}` opt-out), the section is not rendered.
- If `config.workflow_kit` is `undefined` (defaults applied), the section IS rendered because defaults produce artifacts for standard phases.

## Behavior

### Data source

`config.workflow_kit.phases[state.phase].artifacts` — the same source `getWorkflowArtifactsForPhase()` in `gate-evaluator.js` uses. This guarantees context and gate evaluation agree on the artifact set.

### Columns

| Column | Source | Value |
|--------|--------|-------|
| Artifact | `artifact.path` | Relative path from project root |
| Required | `artifact.required` | `yes` / `no` (defaults to `yes` when absent) |
| Semantics | `artifact.semantics` | Semantic ID string, or `—` if null |
| Owner | `artifact.owned_by` | Role ID string, or `—` if null |
| Status | `existsSync(join(root, artifact.path))` | `exists` / `MISSING` |

### Review-only preview

For `review_only` roles, after the table, each **existing** artifact gets:

```markdown
### `.planning/IMPLEMENTATION_NOTES.md`

**Semantic: `implementation_notes`**

\```
(file content preview, max 60 lines)
\```
```

This reuses the existing `buildGateFilePreview()` and `extractGateFileSemantic()` functions. No new preview infrastructure.

### Context section parser

`context-section-parser.js` must register the new section:

```javascript
{ id: 'workflow_artifacts', header: 'Workflow Artifacts', required: false }
```

Position: after `escalation`, before `gate_required_files`. The section is compressible (not required) because it is informational context, not execution state.

## Error Cases

- Phase not present in `workflow_kit.phases`: no section rendered.
- Artifact `path` contains traversal (`..`): already rejected by validation. Not handled here.
- File existence check fails (permission error): treat as `MISSING`.

## Acceptance Tests

These tests must fail before implementation and pass after:

1. **AT-WKR-001**: A governed turn in phase `planning` with default workflow-kit produces a `CONTEXT.md` containing `## Workflow Artifacts` with a table listing `PM_SIGNOFF.md`, `SYSTEM_SPEC.md`, and `ROADMAP.md`.
2. **AT-WKR-002**: Each artifact row shows correct `Required`, `Semantics`, and `Status` columns. An artifact that exists on disk shows `exists`; one that does not shows `MISSING`.
3. **AT-WKR-003**: An artifact with `owned_by: "architect"` shows `architect` in the Owner column.
4. **AT-WKR-004**: A phase with zero artifacts (explicit `workflow_kit: { phases: { planning: { artifacts: [] } } }`) does NOT render the `## Workflow Artifacts` section.
5. **AT-WKR-005**: A `review_only` role sees the table PLUS file previews for existing artifacts, with semantic annotations where applicable.
6. **AT-WKR-006**: `context-section-parser.js` recognizes the `workflow_artifacts` section and classifies it as compressible.
7. **AT-WKR-007**: The section appears between `## Escalation` and `## Gate Required Files` in the rendered output (ordering invariant).

## Open Questions

None. This is a read-only rendering slice. It does not change gate evaluation, turn validation, or protocol behavior.
