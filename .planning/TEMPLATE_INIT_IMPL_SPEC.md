# Template Init Implementation Spec

> Narrow implementation contract for `init --governed --template <id>`.

Depends on: [SDLC_TEMPLATE_SYSTEM_SPEC.md](./SDLC_TEMPLATE_SYSTEM_SPEC.md)

---

## Purpose

Define exactly how `--template` integrates into the existing governed init path so that implementation does not require re-reading the system-level spec or guessing runtime mechanics.

---

## CLI Surface

```bash
agentxchain init --governed --template <id>
agentxchain init --governed --template <id> --yes
```

When `--template` is omitted, the scaffold behaves identically to today (implicitly `generic`). No interactive template picker in v1 — the flag is explicit.

When `--yes` is combined with `--template`, the scaffold uses the selected template without interactive prompts, same as today's `--yes` behavior.

---

## Template Metadata Location

### Where templates live on disk

Built-in governed templates live in:

```
cli/src/templates/governed/
  generic.json
  api-service.json
  cli-tool.json
  library.json
  web-app.json
  enterprise-app.json
```

This is a new subdirectory parallel to the existing `cli/src/templates/` (which contains legacy v3 team templates). Governed templates must NOT be mixed into the legacy template directory.

### Manifest schema

Each JSON file conforms to:

```json
{
  "id": "api-service",
  "display_name": "API Service",
  "description": "Governed scaffold for a backend service with explicit API contract and operational QA artifacts.",
  "version": "1",
  "protocol_compatibility": ["1.0", "1.1"],
  "planning_artifacts": [
    {
      "filename": "api-contract.md",
      "content_template": "# API Contract — {{project_name}}\n\n## Endpoints\n\n| Method | Path | Description | Auth | Status |\n|--------|------|-------------|------|--------|\n| | | | | |\n\n## Error Codes\n\n| Code | Meaning | Recovery |\n|------|---------|----------|\n| | | |\n"
    }
  ],
  "prompt_overrides": {
    "qa": "In addition to the standard QA mandate, this project requires:\n- API contract conformance testing\n- Error code coverage verification\n- Migration risk assessment for every schema change"
  },
  "acceptance_hints": [
    "API contract reviewed and endpoints listed",
    "Error cases enumerated",
    "Verification command passes automated tests"
  ]
}
```

Fields:

| Field | Required | Type | Notes |
|-------|----------|------|-------|
| `id` | yes | string | Must match the filename (without `.json`) |
| `display_name` | yes | string | Human-readable name for CLI output |
| `description` | yes | string | One-line description |
| `version` | yes | string | Template manifest version (always `"1"` for now) |
| `protocol_compatibility` | yes | string[] | Which `schema_version` values this template supports |
| `planning_artifacts` | yes | array | Each entry: `{ filename: string, content_template: string }` |
| `prompt_overrides` | no | object | Keys are role IDs, values are appended to the base governed prompt |
| `acceptance_hints` | no | string[] | Human-readable hints written to `acceptance-matrix.md` footer |
| `scaffold_blueprint` | no | object | Optional governed scaffold override for roles, runtimes, routing, gates, and workflow_kit |

### Template interpolation

`content_template` strings support a single variable: `{{project_name}}`, replaced at scaffold time. No other interpolation. No Handlebars. No eval.

---

## Recording Template Choice

The template ID is recorded in `agentxchain.json` as a top-level field:

```json
{
  "schema_version": "1.0",
  "template": "api-service",
  "project": { ... },
  ...
}
```

**Why `agentxchain.json` and not `.agentxchain/state.json`:** The template is a scaffold decision, not run state. It does not change across runs. It informs migrations, prompt regeneration, and operator context. Config is the right home.

**Why not a separate manifest file:** The template ID is a single string. A separate file for one field is over-engineering. If future template metadata grows beyond one field, `agentxchain.json` can hold a `template` object instead of a string — that's a backward-compatible widening.

When `--template` is omitted: `"template": "generic"` is written. This makes the implicit default explicit and queryable. Existing governed projects without a `template` field are treated as `generic` by all downstream code. Migrated v3 projects also persist `"template": "generic"` explicitly; `migrate` must never infer a non-generic template from repo contents.

---

## Runtime Discovery

### How `scaffoldGoverned` finds templates

```javascript
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GOVERNED_TEMPLATES_DIR = join(__dirname, '../templates/governed');

function loadGovernedTemplate(templateId) {
  const filePath = join(GOVERNED_TEMPLATES_DIR, `${templateId}.json`);
  // No dynamic path construction from user input beyond the validated ID
  const raw = readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}
```

The template ID is validated against a hardcoded allowlist BEFORE any filesystem access:

```javascript
const VALID_TEMPLATE_IDS = ['generic', 'api-service', 'cli-tool', 'library', 'web-app', 'enterprise-app'];
```

This prevents path traversal even though the templates directory is read-only packaged data.

### npm packaging

`cli/package.json` `files` array must include `src/templates/governed/`. Verify with `npm pack --dry-run`.

---

## Failure Behavior

### Unknown template ID

```
$ agentxchain init --governed --template flask-api
Error: Unknown template "flask-api".

Available templates:
  generic       Default governed scaffold
  api-service   Governed scaffold for a backend service
  cli-tool      Governed scaffold for a CLI tool
  library       Governed scaffold for a reusable package
  web-app       Governed scaffold for a web application
  enterprise-app Governed scaffold for multi-role enterprise delivery
```

Exit code: 1. No partial scaffold written. No cleanup needed because the error fires before any filesystem writes.

### Missing template file (internal error)

If a valid template ID maps to a missing JSON file (broken package), the error is:

```
Error: Template "api-service" is registered but its manifest is missing.
This is a packaging bug — please report it.
```

Exit code: 1. This should never happen in a correctly packaged release. The acceptance test AT-SDLC-TEMPLATE-006 catches this at build time.

### Partial scaffold write

If the scaffold fails mid-write (disk full, permission error), the behavior is identical to today: partial directory may exist. The init command does not promise transactional rollback. This is acceptable because `init` is a one-time operation and the user can `rm -rf` and retry.

---

## Integration Points

### `scaffoldGoverned()` changes

The function signature gains an optional `templateId` parameter:

```javascript
export function scaffoldGoverned(dir, projectName, projectId, templateId = 'generic')
```

New behavior:
1. Load the template manifest via `loadGovernedTemplate(templateId)`
2. If the manifest has `scaffold_blueprint`, derive `roles`, `runtimes`, `routing`, `gates`, prompt paths, and optional `workflow_kit` from it; otherwise use the default governed team constants
3. Write `"template": templateId` into the config object
4. After writing the base planning artifacts (PM_SIGNOFF, ROADMAP, acceptance-matrix, ship-verdict), write template-specific planning artifacts from `planning_artifacts[]`. ROADMAP.md phase table is derived from routing keys and role mandates — not hardcoded. Blueprint-backed templates with custom routing get a truthful phase table matching their declared phases.
5. If `prompt_overrides` exists, append the override text to the corresponding role prompt file (after the base prompt, separated by `\n\n---\n\n## Project-Type-Specific Guidance\n\n`)
6. If `acceptance_hints` exists, append them to `acceptance-matrix.md` as a "Template Guidance" section
7. If `workflow_kit` came from `scaffold_blueprint`, preserve it in `agentxchain.json` and scaffold any additional artifact placeholders declared there

### `initGoverned()` changes

1. Read `opts.template` (from Commander option)
2. Validate against `VALID_TEMPLATE_IDS`
3. Pass to `scaffoldGoverned()`

### Commander option registration

In `bin/agentxchain.js`, the `init` command gains:

```javascript
.option('--template <id>', 'project template for governed scaffold (generic, api-service, cli-tool, library, web-app, enterprise-app)')
```

### Config loader changes

`loadNormalizedConfig()` must tolerate `template` as an optional field. No validation beyond `typeof === 'string'` — unknown template IDs in existing configs are not errors (the project was already scaffolded).

### `status` command changes

`status` surfaces the template ID in both output modes:

- human-readable `status` shows `Template: <id>`
- `status --json` includes top-level `template` as a convenience accessor in addition to `config.template`

`status` does **not** list template-specific planning artifact filenames in v1. That would conflate scaffold intent with live repo state and create another stale-surface problem. Template name is operator context; file existence belongs to `validate` or direct repo inspection.

### `migrate` command changes

`migrate` writes `"template": "generic"` into the newly generated governed config and may record that in its migration report for operator clarity.

It must **not** infer `api-service`, `cli-tool`, `library`, `web-app`, or `enterprise-app` from repo contents in v1. The no-guess rule still stands; explicit `generic` is the safe baseline.

---

## What This Spec Does NOT Cover

- Template-specific gate enforcement (acceptance artifacts as machine-checkable gates). Deferred to future protocol version.
- Remote template registries. Explicitly a non-goal for v1.
- Interactive template picker during `init --governed` (without `--template`). Deferred — the flag is sufficient for v1.
- Framework-specific generators inside templates. Explicitly a non-goal.
- Safe retroactive rewriting of an existing governed repo into a blueprint-backed team shape. `template set` must fail closed for those templates until a dedicated migrator exists.

---

## Acceptance Tests

- **AT-TEMPLATE-INIT-001**: `init --governed` with no `--template` flag writes `"template": "generic"` to `agentxchain.json`.
- **AT-TEMPLATE-INIT-002**: `init --governed --template api-service` writes `"template": "api-service"` to `agentxchain.json` and creates `api-contract.md`, `operational-readiness.md`, `error-budget.md` in `.planning/`.
- **AT-TEMPLATE-INIT-002b**: `init --governed --template library` writes `"template": "library"` to `agentxchain.json` and creates `public-api.md`, `compatibility-policy.md`, `release-adoption.md` in `.planning/`.
- **AT-TEMPLATE-INIT-002c**: `init --governed --template enterprise-app` writes custom roles/routing/gates/workflow_kit into `agentxchain.json`, creates prompt files for `architect` and `security_reviewer`, and scaffolds enterprise workflow-kit artifacts.
- **AT-TEMPLATE-INIT-002d**: The `enterprise-app` scaffolded `ROADMAP.md` and `SYSTEM_SPEC.md` must be runtime-usable without manual repair. Charter-enforcement E2E must assert the generated 5-phase roadmap and then advance planning using those scaffolded files rather than overwriting them with hand-built fixtures.
- **AT-TEMPLATE-INIT-003**: `init --governed --template unknown-id` exits with code 1, prints available templates, writes no files.
- **AT-TEMPLATE-INIT-004**: All built-in template manifests parse as valid JSON and contain required fields (`id`, `display_name`, `description`, `version`, `protocol_compatibility`, `planning_artifacts`).
- **AT-TEMPLATE-INIT-005**: Template `id` field matches filename for every governed template manifest.
- **AT-TEMPLATE-INIT-006**: `npm pack --dry-run` includes every file in `src/templates/governed/`.
- **AT-TEMPLATE-INIT-007**: `prompt_overrides` content appears in the generated prompt file for the specified role.
- **AT-TEMPLATE-INIT-008**: Existing projects without a `template` field in `agentxchain.json` are treated as `generic` by the config loader (no validation error, no migration required).
- **AT-TEMPLATE-INIT-009**: `agentxchain migrate --yes` writes `"template": "generic"` to the migrated governed config and does not infer a more specific template from repo contents.
- **AT-TEMPLATE-INIT-010**: `template set enterprise-app` fails closed with init-only guidance because blueprint-backed templates change governed team topology.

---

## Open Questions (Resolved)

| Question | Resolution |
|----------|------------|
| Template choice in agentxchain.json or separate file? | `agentxchain.json` — single string field `"template"` |
| Interactive picker or explicit flag? | Explicit `--template <id>` flag only for v1 |
| Prompt overrides: replace or append? | Append after separator — preserves base governed contract |
