# Planning Artifact Completeness Validation Spec

> Contract for validating that a governed project's planning artifacts match the configured template's artifact set.

---

## Purpose

Governed templates define `planning_artifacts` — files that `init --governed`, `template set`, and `intake plan` generate into `.planning/`. Currently, neither `agentxchain validate` nor `agentxchain template validate` checks that these artifacts actually exist on disk.

This means an operator can delete a required planning artifact (e.g., `.planning/public-api.md` in a `library` project) and `validate` still reports `ok: true`. That is a governance hole: the template defines the planning contract, but validation does not enforce it.

This spec adds planning artifact completeness checking to both validation paths.

---

## Interface

### New Export in `governed-templates.js`

```javascript
export function validateProjectPlanningArtifacts(root, templateId) → {
  ok: boolean,
  template: string,
  expected: string[],      // filenames from manifest
  present: string[],       // filenames found on disk
  missing: string[],       // filenames not found on disk
  errors: string[],
  warnings: string[],
}
```

### Integration Points

1. **`agentxchain validate`** (`validation.js:validateGovernedProject`) — calls `validateProjectPlanningArtifacts(root, effectiveTemplateId)` and merges errors/warnings into the validation result.
2. **`agentxchain template validate`** (`template-validate.js:templateValidateCommand`) — calls `validateProjectPlanningArtifacts(root, effectiveTemplateId)` when a project is detected, and includes the result in the output payload.

### Output Changes

#### `template validate` (human-readable)

Adds a "Planning artifacts" line after the "Project" line:

```
  Planning: OK (3/3 present)
```

or

```
  Planning: FAIL (1/3 missing: public-api.md)
```

#### `template validate --json`

Adds a `planning_artifacts` key to the output:

```json
{
  "ok": false,
  "registry": { ... },
  "project": { ... },
  "planning_artifacts": {
    "ok": false,
    "template": "library",
    "expected": ["public-api.md", "compatibility-policy.md", "release-adoption.md"],
    "present": ["compatibility-policy.md", "release-adoption.md"],
    "missing": ["public-api.md"],
    "errors": ["Template \"library\" requires planning artifact \".planning/public-api.md\" but it is missing."],
    "warnings": []
  },
  "errors": [...],
  "warnings": [...]
}
```

---

## Behavior

### 1. Template Resolution

Uses the same resolution as `validateGovernedProjectTemplate`: reads `template` from `agentxchain.json`, defaults to `generic` if absent.

### 2. Artifact Check

For each entry in `manifest.planning_artifacts`, checks `existsSync(join(root, '.planning', artifact.filename))`.

### 3. Generic Template

`generic` has `planning_artifacts: []`. Validation passes trivially with `expected: [], present: [], missing: []`.

### 4. Severity

Missing planning artifacts are **errors**, not warnings. The template contract is a governance obligation. If the project declares `template: "library"`, the planning surface must be complete.

### 5. No Project Detected

When no project root is found (e.g., running `template validate` outside a governed project), planning artifact validation is skipped. The result shows `planning_artifacts: null`.

### 6. Template Load Failure

If the template cannot be loaded (invalid ID, missing manifest), planning artifact validation is skipped. The template binding error is already reported by `validateGovernedProjectTemplate`.

---

## Error Cases

| Condition | Behavior |
|-----------|----------|
| Template is `generic` (empty artifacts) | `ok: true`, `expected: []` |
| All artifacts present | `ok: true` |
| One or more artifacts missing | `ok: false`, errors list each missing file |
| Template ID invalid / manifest missing | Skip artifact check; template binding error already reported |
| No project root detected | Skip artifact check; `planning_artifacts: null` in JSON |

---

## Acceptance Tests

1. A `library` project with all 3 planning artifacts passes validation.
2. A `library` project missing `public-api.md` fails validation with an error naming the missing file.
3. A `generic` project (no planning artifacts) passes validation trivially.
4. `agentxchain validate` includes planning artifact errors in its output.
5. `agentxchain template validate --json` includes the `planning_artifacts` key with correct `expected`, `present`, `missing` arrays.
6. A project with no `template` key defaults to `generic` and passes.
7. Planning artifact validation is skipped when no project root is detected.

---

## Scope Exclusions

- Content validation of planning artifacts (checking that `.planning/public-api.md` is not empty or has been filled in). That is a future QA-layer concern.
- Artifact staleness detection (checking that artifacts were updated after template change). Out of scope.
- Planning artifact creation or repair. Validation only reports; it does not fix.

---

## Open Questions

None.
