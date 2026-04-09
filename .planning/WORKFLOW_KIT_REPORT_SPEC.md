# Workflow-Kit Report Surface Spec

## Purpose

Extend the governed report (`agentxchain report`) to surface workflow-kit artifact status as a first-class section. Operators should be able to audit which workflow artifacts are required/optional, who owns them, their semantic role, and whether they exist — without reconstructing this from gate failures.

## Data Source

The export artifact already includes `config` (raw `agentxchain.json`) at `artifact.config`. The workflow-kit configuration lives at `artifact.config.workflow_kit.phases[<phase>].artifacts`. The current phase lives at `artifact.summary.phase` or `artifact.state.phase`.

The artifact existence check requires scanning `artifact.files` for the declared paths.

## Interface

### Structured report field

`buildRunSubject()` adds a new field `workflow_kit_artifacts` to `report.subject.run`:

```json
{
  "workflow_kit_artifacts": [
    {
      "path": ".planning/SYSTEM_SPEC.md",
      "required": true,
      "semantics": "system_spec",
      "owned_by": "pm",
      "owner_resolution": "explicit",
      "exists": true
    },
    {
      "path": ".planning/IMPLEMENTATION_NOTES.md",
      "required": false,
      "semantics": "implementation_notes",
      "owned_by": "dev",
      "owner_resolution": "entry_role",
      "exists": false
    }
  ]
}
```

- `path`: artifact path from config
- `required`: `true` if `required !== false`
- `semantics`: semantic ID string or `null`
- `owned_by`: resolved owner (explicit `owned_by` or fallback `entry_role`)
- `owner_resolution`: `"explicit"` when `owned_by` is set in config, `"entry_role"` when falling back
- `exists`: `true` if the file appears in `artifact.files`

### Text format

After the existing "Gate Outcomes" section (or after the last existing section):

```
Workflow Artifacts (planning phase):
  .planning/SYSTEM_SPEC.md | required | system_spec | owner: pm (explicit) | exists
  .planning/IMPLEMENTATION_NOTES.md | optional | implementation_notes | owner: dev (entry_role) | missing
```

### Markdown format

After the existing "Gate Outcomes" section:

```markdown
## Workflow Artifacts

Phase: `planning`

| Artifact | Required | Semantics | Owner | Resolution | Status |
|----------|----------|-----------|-------|------------|--------|
| `.planning/SYSTEM_SPEC.md` | yes | `system_spec` | `pm` | explicit | exists |
| `.planning/IMPLEMENTATION_NOTES.md` | no | `implementation_notes` | `dev` | entry_role | **missing** |
```

## Behavior

1. If `workflow_kit` is absent from `artifact.config`, `workflow_kit_artifacts` is `null` and the section is omitted from text/markdown output.
2. If `workflow_kit` is present but the current phase has no artifacts, `workflow_kit_artifacts` is an empty array `[]` and the section is omitted.
3. Owner resolution follows `DEC-WK-PROMPT-001`: explicit `owned_by` wins; fallback is `routing[phase].entry_role`.
4. File existence is checked against `artifact.files` keys (the same set available to gate evaluation).
5. Artifacts are sorted by path for deterministic output.

## Error Cases

- `artifact.config` missing or not an object: `workflow_kit_artifacts` is `null`.
- `artifact.summary.phase` missing: cannot determine which phase's artifacts to show; `workflow_kit_artifacts` is `null`.
- Phase not found in `workflow_kit.phases`: `workflow_kit_artifacts` is `[]`, section omitted.
- Artifact entry missing `path`: entry is skipped.

## Acceptance Tests

- **AT-WKR-RPT-001**: Report with workflow_kit config includes `workflow_kit_artifacts` array in subject.
- **AT-WKR-RPT-002**: Each artifact has correct `path`, `required`, `semantics`, `owned_by`, `owner_resolution`, `exists` fields.
- **AT-WKR-RPT-003**: Explicit `owned_by` resolves as `"explicit"`; absent `owned_by` falls back to `entry_role` with `"entry_role"` resolution.
- **AT-WKR-RPT-004**: Missing `workflow_kit` in config produces `null` (not empty array).
- **AT-WKR-RPT-005**: Phase with zero artifacts produces `[]` and text/markdown omit the section.
- **AT-WKR-RPT-006**: Text format includes "Workflow Artifacts" section with per-artifact lines.
- **AT-WKR-RPT-007**: Markdown format includes "## Workflow Artifacts" section with a table.
- **AT-WKR-RPT-008**: File existence is checked against `artifact.files` keys.
- **AT-WKR-RPT-009**: Artifacts are sorted by path.

## Open Questions

None. This is a read-only report surface that reuses existing data from the export artifact.
