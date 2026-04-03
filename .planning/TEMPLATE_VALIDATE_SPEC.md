# Template Validate Spec

> Narrow operator-facing contract for proving the governed template registry and the current project's template binding are coherent.

Depends on: [SDLC_TEMPLATE_SYSTEM_SPEC.md](./SDLC_TEMPLATE_SYSTEM_SPEC.md), [CLI_SPEC.md](./CLI_SPEC.md)

---

## Purpose

Close the current proof gap in the governed template system.

Today, built-in templates are only validated indirectly when a code path happens to load them (`init`, `template list`, `template set`, intake planning, tests). That is weak. Operators need an explicit command that proves:

- every registered built-in manifest is present and schema-valid
- the on-disk manifest directory has not drifted from the hardcoded registry
- the current project's configured `template` value, if any, resolves to a known built-in template

This spec adds that proof surface without turning templates into a new runtime subsystem.

## Interface

### CLI Surface

```bash
agentxchain template validate
agentxchain template validate --json
```

### Output Shape

Human-readable mode prints:

- overall pass/fail verdict
- built-in registry summary
- current project template summary when `agentxchain.json` is present
- explicit errors and warnings

JSON mode prints:

```json
{
  "ok": true,
  "registry": {
    "ok": true,
    "registered_ids": ["generic", "api-service", "cli-tool", "library", "web-app"],
    "manifest_ids": ["generic", "api-service", "cli-tool", "library", "web-app"],
    "errors": [],
    "warnings": []
  },
  "project": {
    "present": true,
    "template": "library",
    "source": "agentxchain.json",
    "ok": true,
    "errors": [],
    "warnings": []
  },
  "errors": [],
  "warnings": []
}
```

Field expectations:

- `registry.registered_ids`: exact hardcoded built-in registry in CLI order
- `registry.manifest_ids`: manifest ids discovered from `cli/src/templates/governed/*.json`, sorted for deterministic output
- `project.present`: `true` when `agentxchain.json` exists in the working directory
- `project.template`: configured template or implicit `generic`
- `project.source`: `"agentxchain.json"` when explicitly set, `"implicit_default"` when absent, `null` when no project exists

## Behavior

### 1. Registry Validation Is Explicit

The registry validation must check all of the following:

- every ID in `VALID_GOVERNED_TEMPLATE_IDS` has a corresponding manifest file
- every manifest file under `cli/src/templates/governed/` is registered in `VALID_GOVERNED_TEMPLATE_IDS`
- every manifest parses as JSON
- every manifest passes `validateGovernedTemplateManifest()`
- every manifest `id` matches its filename

This is stricter than `loadAllGovernedTemplates()`, which only proves the happy path for registered IDs and would silently ignore orphan manifests.

### 2. Project Binding Validation

If the current working directory contains `agentxchain.json`:

- if `template` is missing, treat the project as `generic` with `source = "implicit_default"`
- if `template` is present and resolves to a valid built-in template, mark project validation as passing
- if `template` is present but not recognized by the current CLI registry, fail validation

This rule is important:

- config loading remains tolerant so older or future configs can still be inspected
- explicit validation is not tolerant; it must fail when the local CLI cannot prove the project's template binding

Anything less turns `validate` into false comfort.

### 3. Relationship To `agentxchain validate`

`agentxchain validate` for governed projects must reuse the same template-validation logic.

That means governed validation now fails when:

- the built-in template registry is broken in the installed CLI
- the current project's configured template is unknown to the installed CLI

Legacy projects are unchanged.

### 4. Non-goals

This command does not:

- inspect or verify the contents of template-generated planning docs in the repo
- infer a template from repo contents
- validate npm tarball contents directly
- introduce template-specific runtime gates

## Error Cases

| Condition | Required behavior |
|---|---|
| Registered template missing its manifest file | Fail with a registry error naming the missing ID |
| Manifest file exists but is not registered | Fail with a registry error naming the orphan manifest |
| Manifest JSON is invalid | Fail with captured parse error context |
| Manifest schema is invalid | Fail with manifest validation errors |
| `agentxchain.json` cannot be parsed | Fail project validation if the command is run inside that repo |
| Project template is unknown | Fail and name the invalid template plus the valid built-ins |
| No `agentxchain.json` in cwd | Registry validation still runs; project block reports `present = false` |

## Acceptance Tests

- **AT-TEMPLATE-VALIDATE-001**: `agentxchain template validate --json` passes in the repo and reports all built-in template IDs in both `registered_ids` and `manifest_ids`.
- **AT-TEMPLATE-VALIDATE-002**: `agentxchain template validate` run inside a governed project with `template: "library"` reports the project template as valid.
- **AT-TEMPLATE-VALIDATE-003**: `agentxchain template validate` run inside a governed project with no `template` field reports implicit `generic` and still passes.
- **AT-TEMPLATE-VALIDATE-004**: `agentxchain template validate` run inside a governed project with `template: "future-template"` exits `1` and names the unknown template.
- **AT-TEMPLATE-VALIDATE-005**: governed `agentxchain validate` reuses the same checks and fails when `agentxchain.json.template` is unknown.
- **AT-TEMPLATE-VALIDATE-006**: registry validation fails if the manifest directory contains an unregistered `*.json` file.

## Open Questions

1. Should future release preflight call `agentxchain template validate --json` as a first-class packaging proof, or is reuse through `npm test` and `agentxchain validate` sufficient for now?
