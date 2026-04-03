# Acceptance Hint Enforcement Spec

## Purpose

Template-defined acceptance hints are injected into `.planning/acceptance-matrix.md` as markdown checkboxes during `init` and `template set`. Nothing in the governance path currently checks whether those checkboxes have been addressed. An operator can complete a governed run with zero acceptance criteria reviewed.

This spec adds QA-layer enforcement: unchecked acceptance hints surface as **warnings** during validation, giving operators visibility into incomplete governance without hard-blocking runs.

## Interface

### `validateAcceptanceHintCompletion(root, templateId) → result`

Exported from `governed-templates.js`.

**Parameters:**
- `root` — project root directory
- `templateId` — template ID string (defaults to `'generic'` when falsy)

**Returns:**
```js
{
  ok: boolean,         // true when no errors (warnings allowed)
  template: string,    // effective template ID
  total: number,       // total hints defined in template manifest
  checked: number,     // hints marked as checked in acceptance-matrix.md
  unchecked: number,   // hints still unchecked
  missing_file: boolean, // true if acceptance-matrix.md does not exist
  missing_section: boolean, // true if ## Template Guidance section not found
  unchecked_hints: string[], // text of unchecked hints
  errors: string[],    // always empty (hints are warnings, not errors)
  warnings: string[],  // one warning per unchecked hint
}
```

### Integration Points

1. **`agentxchain validate`** — `validateGovernedProject()` calls `validateAcceptanceHintCompletion()` and merges warnings.
2. **`agentxchain template validate`** — `templateValidateCommand()` calls it and displays an "Acceptance" line in human output, and `acceptance_hints` key in JSON output.

## Behavior

1. Load the template manifest for the effective template ID.
2. If the template has zero `acceptance_hints`, return trivially OK (no warnings).
3. Read `.planning/acceptance-matrix.md`.
4. If the file is missing, return `missing_file: true` with one warning.
5. Find the `## Template Guidance` section.
6. If the section is missing, return `missing_section: true` with one warning.
7. Parse lines matching `- [ ] <text>` (unchecked) and `- [x] <text>` (checked, case-insensitive).
8. For each template hint that matches an unchecked line, add to `unchecked_hints` and emit a warning.
9. Hints that do not appear in the file at all are treated as unchecked (they may have been deleted).

## Error Cases

- Template cannot be loaded: skip with warning (same pattern as `validateProjectPlanningArtifacts`).
- `acceptance-matrix.md` missing: single warning, not error.
- `## Template Guidance` section missing: single warning, not error.
- All hints checked: no warnings, `ok: true`.
- Generic template (empty hints): trivially OK.

## Acceptance Tests

1. AT-HINT-001: Library project with all hints checked → no warnings
2. AT-HINT-002: Library project with one hint unchecked → warning naming the hint
3. AT-HINT-003: Library project with missing acceptance-matrix.md → `missing_file` warning
4. AT-HINT-004: Library project with acceptance-matrix.md but no Template Guidance section → `missing_section` warning
5. AT-HINT-005: Generic template → trivially OK, zero warnings
6. AT-HINT-006: `template validate --json` includes `acceptance_hints` key with checked/unchecked counts
7. AT-HINT-007: `agentxchain validate` surfaces unchecked hints as warnings
8. AT-HINT-008: Hint text deleted from file treated as unchecked

## Non-Goals

- Content quality validation (checking if hints are meaningful, not just checked).
- Hard gate enforcement — hints are warnings, not errors. A future governance strictness knob could escalate them.
- Changing the checkbox format or the `## Template Guidance` section header.
