# Workflow Kit Config Spec

> Allow operators to declare per-phase workflow artifacts and gate semantics in `agentxchain.json` instead of relying on the hardcoded 5-file scaffold.

Depends on: [CUSTOM_PHASES_SPEC.md](./CUSTOM_PHASES_SPEC.md), [WORKFLOW_KIT_VALIDATE_SPEC.md](./WORKFLOW_KIT_VALIDATE_SPEC.md), [WORKFLOW_GATE_FILE_SEMANTICS_SPEC.md](./WORKFLOW_GATE_FILE_SEMANTICS_SPEC.md)

---

## Purpose

Close the gap between custom phases and workflow artifacts.

Today the system supports arbitrary phase names via `routing` keys but the workflow-kit scaffold and semantic gate validators are hardcoded to the default 3-phase model (planning → implementation → qa) and its 5 fixed files. An operator who adds `design`, `security_review`, or `architecture` phases gets phase ordering enforcement but zero workflow artifact support for those custom phases — no scaffolded files, no gate file checks, no semantic validation.

This spec adds an optional `workflow_kit` section to `agentxchain.json` that lets operators:

1. Declare which artifacts each phase requires
2. Bind semantic validators to those artifacts
3. Override or extend the default scaffold for governed projects

The invariant: **every phase that has a gate should have workflow artifacts that the gate checks. Phases without gates remain ungated.**

## Interface

### Config Layer (`agentxchain.json`)

```json
{
  "schema_version": "1.0",
  "workflow_kit": {
    "phases": {
      "planning": {
        "artifacts": [
          {
            "path": ".planning/PM_SIGNOFF.md",
            "semantics": "pm_signoff",
            "required": true
          },
          {
            "path": ".planning/SYSTEM_SPEC.md",
            "semantics": "system_spec",
            "required": true
          },
          {
            "path": ".planning/ROADMAP.md",
            "semantics": null,
            "required": true
          }
        ]
      },
      "design": {
        "artifacts": [
          {
            "path": ".planning/DESIGN_DOC.md",
            "semantics": "section_check",
            "semantics_config": {
              "required_sections": ["## Architecture", "## Interfaces", "## Trade-offs"]
            },
            "required": true
          }
        ]
      },
      "implementation": {
        "artifacts": [
          {
            "path": ".planning/IMPLEMENTATION_NOTES.md",
            "semantics": "implementation_notes",
            "required": true
          }
        ]
      },
      "security_review": {
        "artifacts": [
          {
            "path": ".planning/SECURITY_REVIEW.md",
            "semantics": "section_check",
            "semantics_config": {
              "required_sections": ["## Findings", "## Verdict"]
            },
            "required": true
          }
        ]
      },
      "qa": {
        "artifacts": [
          {
            "path": ".planning/acceptance-matrix.md",
            "semantics": "acceptance_matrix",
            "required": true
          },
          {
            "path": ".planning/ship-verdict.md",
            "semantics": "ship_verdict",
            "required": true
          },
          {
            "path": ".planning/RELEASE_NOTES.md",
            "semantics": "release_notes",
            "required": true
          }
        ]
      }
    }
  }
}
```

### Artifact Object Schema

```typescript
interface WorkflowArtifact {
  /** Relative path from project root */
  path: string;

  /**
   * Built-in semantic validator ID, or null for file-existence-only check.
   * Built-in IDs: "pm_signoff", "system_spec", "implementation_notes",
   *   "acceptance_matrix", "ship_verdict", "release_notes", "section_check"
   */
  semantics: string | null;

  /**
   * Optional config for parameterized validators like "section_check".
   * Ignored for fixed-shape validators (pm_signoff, ship_verdict, etc).
   */
  semantics_config?: Record<string, unknown>;

  /** Whether the artifact must exist for the phase gate to pass. Default: true */
  required?: boolean;
}
```

### `section_check` — The Generic Parameterized Validator

The only new validator. Takes a `required_sections` array of markdown heading strings. Checks that the file contains all listed headings. This covers the common case where an operator wants "this doc must have these sections" without writing custom code.

```json
{
  "semantics": "section_check",
  "semantics_config": {
    "required_sections": ["## Architecture", "## Interfaces"]
  }
}
```

No other parameterized validators in v1. Extensibility comes from adding new built-in validator IDs in future versions, not from user-supplied code.

### Defaults (Backward Compatibility)

When `workflow_kit` is absent from the config:

1. If the project has `routing`, derive artifact expectations from the **routing phase names matched against the default artifact map** (see below).
2. If the project has no `routing`, use the full default 5-file scaffold.

**Default artifact map** (applied only when `workflow_kit` is absent):

| Phase name      | Default artifacts                                           |
|-----------------|-------------------------------------------------------------|
| `planning`      | PM_SIGNOFF.md, SYSTEM_SPEC.md, ROADMAP.md                  |
| `implementation`| IMPLEMENTATION_NOTES.md                                     |
| `qa`            | acceptance-matrix.md, ship-verdict.md, RELEASE_NOTES.md    |
| (any other)     | No artifacts (file-existence gates from `gates` config only)|

This means existing 3-phase projects work identically. Custom-phase projects that don't declare `workflow_kit` get artifacts for `planning`, `implementation`, and `qa` phases if they exist in routing, and nothing for other phases.

## Parser Shape

### Location in `normalized-config.js`

New function: `normalizeWorkflowKit(raw, routingPhases)`

```javascript
/**
 * Normalize the workflow_kit config section.
 * @param {object|undefined} raw - raw workflow_kit from config JSON
 * @param {string[]} routingPhases - derived phase names from routing (or defaults)
 * @returns {{ phases: Record<string, { artifacts: NormalizedArtifact[] }> }}
 */
export function normalizeWorkflowKit(raw, routingPhases) {
  if (!raw) {
    return buildDefaultWorkflowKit(routingPhases);
  }
  // Validate and normalize explicit workflow_kit
  return validateAndNormalizeExplicit(raw, routingPhases);
}
```

### Validation Rules

1. `workflow_kit` must be an object if present.
2. `workflow_kit.phases` must be an object if present.
3. Every key in `workflow_kit.phases` must be a valid phase name matching `/^[a-z][a-z0-9_-]*$/`.
4. Every key in `workflow_kit.phases` must correspond to a phase in `routing` (or defaults). **Warning** (not error) if a workflow_kit phase has no matching routing phase — it means the artifacts exist but no gate checks them.
5. Each phase value must be an object with an `artifacts` array.
6. Each artifact must have a `path` (non-empty string, relative, no `..` traversal).
7. Each artifact `semantics` must be `null` or one of the known validator IDs.
8. If `semantics` is `"section_check"`, `semantics_config.required_sections` must be a non-empty array of strings.
9. `required` defaults to `true` when absent.
10. Duplicate `path` values within the same phase are rejected.
11. Cross-phase duplicate paths are allowed (same file can serve multiple phases).

### Integration Point

`normalizeV4()` calls `normalizeWorkflowKit(raw.workflow_kit, derivedPhases)` after routing normalization, and attaches the result to the normalized config as `config.workflow_kit`.

## Validator Behavior

### Gate Evaluation Changes (`gate-evaluator.js` / `governed-state.js`)

When evaluating a phase gate:

1. Look up `config.workflow_kit.phases[currentPhase]`.
2. Build an **effective artifact set keyed by path** from two sources:
   - `gates[exitGate].requires_files`
   - `workflow_kit.phases[currentPhase].artifacts`
3. If the same path appears in both sources:
   - existence is checked once
   - `requires_files` still keeps the file required
   - semantic checks from both sources apply
   - identical built-in semantics are deduplicated so default configs do not double-fail
4. If a workflow-kit artifact path is new for that phase, it is additive:
   - `required: true` means the file must exist
   - `required: false` means a missing file does not block the gate
   - if the file exists and `semantics` is non-null, run the corresponding semantic validator
5. Gate passes only if the merged `requires_files` + workflow-kit artifact contract passes.

Coordinator scope is intentionally unchanged in Slice 2. Child repos enforce their own repo-local `workflow_kit` during `acceptGovernedTurn()` and run-completion evaluation. The coordinator only observes resulting child repo state; coordinator-level `workflow_kit` remains deferred.

### Semantic Validator Registry

Refactor `evaluateWorkflowGateSemantics()` from path-based dispatch to ID-based dispatch:

```javascript
const SEMANTIC_VALIDATORS = {
  pm_signoff: evaluatePmSignoff,
  system_spec: evaluateSystemSpec,
  implementation_notes: evaluateImplementationNotes,
  acceptance_matrix: evaluateAcceptanceMatrix,
  ship_verdict: evaluateShipVerdict,
  release_notes: evaluateReleaseNotes,
  section_check: evaluateSectionCheck, // NEW
};

export function evaluateArtifactSemantics(root, artifact) {
  if (!artifact.semantics) return null; // file-existence only
  const validator = SEMANTIC_VALIDATORS[artifact.semantics];
  if (!validator) return null; // unknown validator = skip
  const content = readFile(root, artifact.path);
  if (content === null) return null; // file missing handled separately
  if (artifact.semantics === 'section_check') {
    return validator(content, artifact.semantics_config);
  }
  return validator(content);
}
```

### `section_check` Validator Implementation

```javascript
function evaluateSectionCheck(content, config) {
  if (!config?.required_sections?.length) {
    return { ok: true };
  }
  const missing = config.required_sections.filter(
    section => !content.includes(section)
  );
  if (missing.length > 0) {
    return {
      ok: false,
      reason: `Document must contain sections: ${missing.join(', ')}`,
    };
  }
  return { ok: true };
}
```

### Template Validate Changes

`template validate --json` workflow_kit block changes:

1. `required_files` is now the union of core scaffold files (from `workflow_kit.phases`) plus gate `requires_files`.
2. `structural_checks` is generated from the `semantics` declarations in the workflow_kit config, not hardcoded.
3. For custom phases, structural checks use the artifact's `semantics` and `semantics_config` to generate check descriptions.

## Backward Compatibility Rules

1. **No `workflow_kit` in config**: behavior is identical to today. Default artifact map applies.
2. **Empty `workflow_kit: {}`**: explicitly declares no per-phase artifacts. Gates still use `requires_files` only. This is a valid opt-out.
3. **Partial `workflow_kit`**: operator declares artifacts for some phases but not others. Un-declared phases get no workflow-kit artifacts (not the defaults). This is explicit-over-implicit.
4. **Existing `gates.requires_files` entries**: continue to work unchanged. Workflow-kit artifacts are additive, and duplicate paths merge instead of double-counting.
5. **Semantic validator path independence**: today `evaluateWorkflowGateSemantics` dispatches by file path. After this change, it dispatches by `semantics` ID. The path-based dispatch is kept as a fallback for configs without `workflow_kit` to maintain backward compat for any code that calls it directly.

### Migration Path

No migration required. Existing configs without `workflow_kit` get identical behavior through the default artifact map. Operators adopt `workflow_kit` when they want explicit control.

## Error Cases

| Condition | Behavior |
|---|---|
| `workflow_kit.phases.foo` where `foo` is not in routing | Warning: "workflow_kit declares phase 'foo' which is not in routing" |
| Artifact path contains `..` | Error: "artifact path must not traverse above project root" |
| Artifact `semantics` is unknown string | Error: "unknown semantics validator 'xyz'; valid values: pm_signoff, system_spec, ..." |
| `section_check` without `semantics_config.required_sections` | Error: "section_check requires semantics_config.required_sections" |
| `section_check` with empty `required_sections` array | Error: "section_check required_sections must be non-empty" |
| Duplicate artifact path within same phase | Error: "duplicate artifact path '.planning/FOO.md' in phase 'planning'" |
| `workflow_kit` is not an object | Error: "workflow_kit must be an object" |
| Artifact missing `path` | Error: "artifact in phase 'planning' requires a path" |
| Required artifact file missing at gate time | Gate fails: "required artifact '.planning/DESIGN_DOC.md' for phase 'design' does not exist" |
| Required artifact exists but semantic check fails | Gate fails with semantic validator reason |
| Same path declared in `requires_files` and `workflow_kit` | Existence is checked once; semantic checks are merged and identical built-in checks are deduped |

## Acceptance Tests

### Config Validation

- **AT-WKC-001**: Config with explicit `workflow_kit` declaring artifacts for custom phases validates without error.
- **AT-WKC-002**: Config with `workflow_kit.phases.foo` where `foo` is not in routing produces a warning.
- **AT-WKC-003**: Config with artifact path containing `..` is rejected.
- **AT-WKC-004**: Config with unknown `semantics` value is rejected.
- **AT-WKC-005**: Config with `section_check` missing `required_sections` is rejected.
- **AT-WKC-006**: Config with duplicate artifact paths in the same phase is rejected.

### Backward Compatibility

- **AT-WKC-010**: Config without `workflow_kit` produces identical normalized output to today's behavior.
- **AT-WKC-011**: Config with empty `workflow_kit: {}` produces no per-phase artifacts.
- **AT-WKC-012**: Config with `workflow_kit` declaring only `planning` artifacts leaves other phases artifact-free.
- **AT-WKC-013**: Existing `gates.requires_files` entries still work alongside workflow-kit artifacts.

### Gate Evaluation

- **AT-WKC-020**: Phase gate with required artifact that exists and passes semantics → gate passes.
- **AT-WKC-021**: Phase gate with required artifact that is missing → gate fails with specific message.
- **AT-WKC-022**: Phase gate with required artifact that exists but fails semantic check → gate fails with semantic reason.
- **AT-WKC-023**: Phase gate with `required: false` artifact that is missing → gate passes.
- **AT-WKC-024**: `section_check` validator passes when all required sections are present.
- **AT-WKC-025**: `section_check` validator fails when a section is missing, naming the missing section.
- **AT-WKC-026**: Duplicate-path artifact declarations merge semantics instead of replacing them; built-in gate semantics still apply alongside explicit `workflow_kit` semantics.

### Template Validate Integration

- **AT-WKC-030**: `template validate --json` with explicit `workflow_kit` reflects declared artifacts in `workflow_kit.required_files`.
- **AT-WKC-031**: `template validate --json` with explicit `workflow_kit` generates `structural_checks` from `semantics` declarations.
- **AT-WKC-032**: `template validate --json` without `workflow_kit` produces identical output to today.

### Scaffold (governed init)

- **AT-WKC-040**: `agentxchain init --governed` with a config containing `workflow_kit` scaffolds the declared artifact files with appropriate placeholder content.
- **AT-WKC-041**: `agentxchain init --governed` without `workflow_kit` scaffolds the default 5 files (unchanged behavior).

## Open Questions

1. Should `governed init` scaffold custom artifact files declared in `workflow_kit`, or only the defaults? **Recommendation**: scaffold them with minimal placeholder content matching the `semantics` type (e.g., `section_check` artifacts get the required section headings pre-filled). Deferred to implementation.
2. Should operators be able to declare `workflow_kit` at the coordinator level (`agentxchain-multi.json`) to standardize artifacts across child repos? **Recommendation**: defer to a future spec. Coordinator-level workflow-kit would need inheritance/override semantics that add complexity without clear demand yet.
3. Should there be a `workflow_kit` CLI command to list/inspect declared artifacts? **Recommendation**: `template validate --json` already covers this. No new command needed.

## Implementation Slices

### Slice 1: Parser + Validator (no runtime behavior change)
- Add `normalizeWorkflowKit()` to `normalized-config.js`
- Add validation rules to `validateV4Config()`
- Add `section_check` validator to `workflow-gate-semantics.js`
- Refactor semantic dispatch from path-based to ID-based with path fallback
- Tests: AT-WKC-001 through AT-WKC-006, AT-WKC-010 through AT-WKC-013

### Slice 2: Gate evaluation integration
- Modify gate evaluation to check workflow-kit artifacts
- Tests: AT-WKC-020 through AT-WKC-025

### Slice 3: Template validate + scaffold integration
- Extend `template validate --json` output
- Extend `governed init` scaffold for custom artifacts
- Tests: AT-WKC-030 through AT-WKC-041
