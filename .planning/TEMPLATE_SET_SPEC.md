# Template Set Command Spec

> Narrow implementation contract for `agentxchain template set <id>`.

Depends on: [TEMPLATE_INIT_IMPL_SPEC.md](./TEMPLATE_INIT_IMPL_SPEC.md), [SDLC_TEMPLATE_SYSTEM_SPEC.md](./SDLC_TEMPLATE_SYSTEM_SPEC.md)

---

## Purpose

Define the mutation semantics for annotating an existing governed project with a template after initial scaffold. This covers the common case: a project was created with `init --governed` (defaulting to `generic`) and the operator later wants to apply `api-service`, `cli-tool`, `library`, or `web-app` guidance. Blueprint-backed templates such as `enterprise-app` are explicitly out of scope here because they redefine team topology and are not additive mutations.

This is a **metadata + guidance** command, not a destructive rewrite. The operator is choosing to annotate their project with a template's planning artifacts and prompt overrides. The command must be safe to run at any point in a governed project's lifecycle.

---

## CLI Surface

```bash
agentxchain template set <id>
agentxchain template set <id> --yes
agentxchain template set <id> --dry-run
```

| Flag | Behavior |
|------|----------|
| `<id>` | Required. One of the valid template IDs. |
| `--yes` | Skip confirmation prompt. |
| `--dry-run` | Print what would change without writing anything. Exit 0. |

The command is governed-only. Running it against a non-governed project (v3 or no config) exits with code 1 and a clear error.
A governed project must also have an existing `.agentxchain/` workspace. `template set` mutates governed prompts and writes an audit ledger entry; it must not run against a config-only skeleton with no governed workspace.

---

## Mutation Semantics

### 1. Config update

The command rewrites the `"template"` field in `agentxchain.json`:

```json
{ "template": "api-service" }
```

This is the only field it touches in `agentxchain.json`. It does not alter roles, runtimes, routing, gates, budget, retention, rules, or prompts config. The template field is a metadata annotation, not a config transformer.

### 2. Planning artifacts: additive, never destructive

For each `planning_artifacts` entry in the target template manifest:

- **If the file does NOT exist** under `.planning/`: create it from `content_template` with `{{project_name}}` interpolation.
- **If the file already exists**: skip it. Do not overwrite, merge, or diff. The operator's edits are sovereign.

Rationale: planning artifacts are operator-authored documents after initial scaffold. Overwriting them silently would destroy work. Merging them is ambiguous (what does "merge" mean for a markdown checklist?). Skipping is the only safe default.

The command MUST report which files were created vs. skipped so the operator knows what happened.

### 3. Prompt overrides: append once, idempotent

For each `prompt_overrides` entry in the target template manifest:

- Read the prompt file at the path specified in `agentxchain.json.prompts[roleId]`.
- **If the prompt file does NOT contain the separator `## Project-Type-Specific Guidance`**: append the override using the same separator format as init: `\n\n---\n\n## Project-Type-Specific Guidance\n\n{override}\n`.
- **If the prompt file already contains `## Project-Type-Specific Guidance`**: skip. Do not double-append. Do not replace the existing override section.

Rationale: prompt files are operator-editable. The operator may have customized the override section after init. Replacing it destroys their work. Appending again creates duplicates. Skipping when the section already exists is idempotent and safe.

The command MUST report which prompts were appended vs. skipped.

### 4. Acceptance hints: append once, idempotent

- Read `.planning/acceptance-matrix.md`.
- **If the file does NOT contain `## Template Guidance`**: append the hints section.
- **If it already contains `## Template Guidance`**: skip.

Same rationale as prompt overrides.

### 5. Switching templates (non-generic to non-generic)

When switching from one non-generic template to another (e.g., `api-service` → `web-app`):

- The `"template"` field in `agentxchain.json` is updated to the new ID.
- New planning artifacts from the target template are created if they don't exist.
- Old template planning artifacts are **NOT deleted**. They are operator documents now.
- Prompt overrides: if `## Project-Type-Specific Guidance` already exists from the old template, it is **NOT replaced**. The operator must manually update prompts if they want the new template's override. The command prints a warning: `Prompt for <role> already has project-type guidance. Skipping. Edit manually if you want the new template's guidance.`
- Acceptance hints: same logic — skip if section exists, warn.

This is the conservative choice. A `--force` flag that replaces existing overrides is explicitly **out of scope for v1** to avoid accidental destruction.

### 6. Setting to `generic`

`agentxchain template set generic` is allowed. It:
- Updates `"template"` to `"generic"` in config.
- Creates no planning artifacts (generic has none).
- Appends no prompt overrides (generic has none).
- Does NOT delete planning artifacts or prompt overrides from the previous template.

This is a "remove annotation" operation, not a "strip template artifacts" operation.

---

## Decision Ledger Recording

The command appends a decision to `.agentxchain/decision-ledger.jsonl`:

```json
{
  "type": "template_set",
  "timestamp": "2026-04-02T18:00:00Z",
  "previous_template": "generic",
  "new_template": "api-service",
  "files_created": ["api-contract.md", "operational-readiness.md", "error-budget.md"],
  "files_skipped": [],
  "prompts_appended": ["pm", "dev", "qa"],
  "prompts_skipped": [],
  "acceptance_hints_appended": true,
  "operator": "human"
}
```

This ensures the template change is auditable. The decision ledger is the governed project's memory.

---

## Failure Behavior

| Scenario | Behavior | Exit Code |
|----------|----------|-----------|
| Unknown template ID | Error with valid template list | 1 |
| Non-governed project | Error: "This is not a governed project." | 1 |
| No `agentxchain.json` | Error: "No agentxchain.json found." | 1 |
| Missing `.agentxchain/` workspace | Error: "Governed workspace missing." | 1 |
| Same template as current | Prints "Already set to <id>. No changes." | 0 |
| Disk write failure | Error with specific file path | 1 |
| Missing prompt file path | Warning; skip prompt append for that role | 0 (with warning) |
| Missing `.planning/acceptance-matrix.md` | Warning; skip acceptance hints | 0 (with warning) |

---

## Dry Run Output

`--dry-run` prints the mutation plan without writing anything:

```
Template: generic → api-service

Config:
  agentxchain.json: template field will be updated

Planning artifacts:
  .planning/api-contract.md: WILL CREATE
  .planning/operational-readiness.md: WILL CREATE
  .planning/error-budget.md: EXISTS (skip)

Prompts:
  .agentxchain/prompts/pm.md: WILL APPEND override
  .agentxchain/prompts/dev.md: WILL APPEND override
  .agentxchain/prompts/qa.md: ALREADY HAS guidance (skip)

Acceptance hints:
  .planning/acceptance-matrix.md: WILL APPEND template guidance

No changes written. Use without --dry-run to apply.
```

---

## What This Spec Does NOT Cover

- `--force` flag for replacing existing prompt overrides. Deferred until operator feedback demands it.
- `agentxchain template list` — listing available templates. Could be useful but is not required for the mutation contract. Can be a separate trivial command.
- `agentxchain template diff` — showing what a template would add compared to current state. The `--dry-run` flag covers the immediate need.
- Remote template registries.
- Template-specific gate enforcement (promoting acceptance hints to machine-enforced gates).

---

## Acceptance Tests

- **AT-TEMPLATE-SET-001**: `template set api-service` on a `generic` project updates `agentxchain.json` template field to `"api-service"`.
- **AT-TEMPLATE-SET-002**: `template set api-service` creates all planning artifacts from the manifest when none exist.
- **AT-TEMPLATE-SET-003**: `template set api-service` skips planning artifacts that already exist. Existing file content is preserved byte-for-byte.
- **AT-TEMPLATE-SET-004**: `template set api-service` appends prompt overrides to role prompt files that do not already have `## Project-Type-Specific Guidance`.
- **AT-TEMPLATE-SET-005**: `template set api-service` skips prompt append for prompts that already contain `## Project-Type-Specific Guidance`. Existing content is preserved.
- **AT-TEMPLATE-SET-006**: `template set api-service` appends acceptance hints to `acceptance-matrix.md` when `## Template Guidance` section does not exist.
- **AT-TEMPLATE-SET-007**: `template set api-service` skips acceptance hints when `## Template Guidance` section already exists.
- **AT-TEMPLATE-SET-008**: `template set unknown-id` exits with code 1 and lists valid template IDs.
- **AT-TEMPLATE-SET-009**: `template set <id>` on a non-governed project exits with code 1.
- **AT-TEMPLATE-SET-009b**: `template set <id>` on a config-only project with no `.agentxchain/` workspace exits with code 1.
- **AT-TEMPLATE-SET-010**: `template set api-service` when template is already `api-service` prints "Already set" and exits 0 with no writes.
- **AT-TEMPLATE-SET-011**: `template set web-app` on an `api-service` project updates the template field, creates new planning artifacts, does NOT delete old template artifacts, and warns about existing prompt overrides.
- **AT-TEMPLATE-SET-012**: `template set <id> --dry-run` prints the mutation plan without writing any files. Config, planning, prompts, and acceptance-matrix are all unchanged.
- **AT-TEMPLATE-SET-013**: `template set <id>` appends a `template_set` decision to `decision-ledger.jsonl` with previous/new template, files created/skipped, and prompts appended/skipped.
- **AT-TEMPLATE-SET-014**: Running `template set <id>` twice in succession is idempotent — second run reports "Already set" and exits 0.
- **AT-TEMPLATE-SET-015**: `template set generic` on a non-generic project updates the field but creates no artifacts and does not delete existing template artifacts.

---

## Open Questions

| Question | Status |
|----------|--------|
| Should `template set` require a specific project phase (e.g., planning only)? | **No.** The command is metadata + guidance. It should work at any phase. Phase-specific template gates are a future concern. |
| Should `template set` re-run validation after the config change? | **Deferred.** Validation is a separate concern. The operator can run `agentxchain validate` after setting the template. |
| Should `template set` update the status command's output immediately? | **Yes, implicitly.** The status command reads `template` from normalized config. Updating `agentxchain.json` is sufficient. |
