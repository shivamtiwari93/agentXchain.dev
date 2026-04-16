# Templates Docs Page Spec

> Public docs contract for governed scaffold templates on the Docusaurus docs surface.

Related specs: [TEMPLATE_VALIDATE_SPEC.md](./TEMPLATE_VALIDATE_SPEC.md), [WORKFLOW_KIT_VALIDATE_SPEC.md](./WORKFLOW_KIT_VALIDATE_SPEC.md)

---

## Purpose

Expose a truthful `/docs/templates` deep-dive so operators can choose, inspect, and mutate governed scaffold intent without reverse-engineering command help or template manifests.

This page must document the real product contract:

- templates are scaffold intent, not protocol forks
- the selected template is stored in the top-level `template` field in `agentxchain.json`
- `init --governed --template <id>` scaffolds template artifacts and guidance at creation time
- `template list [--json]` exposes the built-in template surface
- `template validate [--json]` proves the built-in registry, current project template binding, and governed workflow-kit scaffold
- explicit `workflow_kit` changes `template validate` from default-scaffold proof to operator-declared artifact proof
- explicit `workflow_kit.phases.<phase>.template` allows built-in phase-template expansion without copying artifact blocks by hand
- `template set <id> [--yes] [--dry-run]` applies additive mutation semantics to an existing governed repo
- blueprint-backed templates may be init-only when they redefine team topology or the default runtime mix
- authoring a new blueprint-backed template is a CLI-source extension, not a runtime operator command
- `status` and `status --json` keep template choice visible to operators and automation
- template choice does not change the `audit` / `export` / `report --input` evidence boundary

## Interface

### Route

```text
/docs/templates
```

### Source Files

```text
website-v2/docs/templates.mdx
website-v2/sidebars.ts
```

### Build Artifact

```text
website-v2/build/docs/templates/index.html
```

### Implementation Sources Of Truth

```text
cli/bin/agentxchain.js
cli/src/commands/init.js
cli/src/commands/status.js
cli/src/commands/template-list.js
cli/src/commands/template-validate.js
cli/src/commands/template-set.js
cli/src/lib/governed-templates.js
cli/src/templates/governed/*.json
```

## Audience

- Operators choosing a governed scaffold for a new repo
- Teams annotating an existing governed repo with `template set`
- Evaluators checking whether AgentXchain’s SDLC templates are real product behavior

## Behavior

### 1. Explain the contract precisely

The page must state early that template choice is:

- scaffold intent
- recorded in `agentxchain.json`
- additive planning structure and prompt guidance
- visible in status output
- not hidden runtime magic
- not a different protocol mode

### 2. Cover the real command surface

The page must document:

- `agentxchain init --governed --template <id>`
- `agentxchain template list`
- `agentxchain template list --json`
- `agentxchain template validate`
- `agentxchain template validate --json`
- `agentxchain template set <id> [--yes] [--dry-run]`
- `agentxchain status`
- `agentxchain status --json`

The page must not fabricate unshipped template flags or behaviors such as:

- `agentxchain template set --force`
- destructive merge or overwrite semantics
- automatic template inference from repo contents
- conflict detection for `template set`

### 3. Bind built-in templates to manifest truth

The page must list every built-in template from `VALID_GOVERNED_TEMPLATE_IDS` and the real planning artifact filenames from each governed template manifest:

- `generic`
- `api-service`
- `cli-tool`
- `library`
- `web-app`
- `enterprise-app`

`generic` must be described as the baseline governed scaffold with no extra project-type files and a manual-only cold-start runtime mix.

`enterprise-app` must be described honestly as a blueprint-backed template that changes the governed team shape at init time.
Its architecture and security-review artifacts must also be described honestly as ownership-enforced via `owned_by`, not just structural markdown files.

### 4. Document mutation safety truthfully

The page must describe the actual `template set` behavior:

- updates the config `template` field
- creates missing planning artifacts only
- appends prompt guidance once per role when no `## Project-Type-Specific Guidance` section exists
- appends acceptance hints once when `acceptance-matrix.md` has no `## Template Guidance` section
- appends template-specific guidance to `SYSTEM_SPEC.md` when no `## Template-Specific Guidance` section exists
- records a `template_set` entry in `.agentxchain/decision-ledger.jsonl`
- `--dry-run` prints the mutation plan without writing changes
- switching from one non-`generic` template to another is additive, not destructive
- blueprint-backed templates fail closed under `template set` because team-topology or runtime-mix rewrites are not additive

The page must describe what `template set` does not do:

- overwrite existing planning docs
- replace an existing `## Project-Type-Specific Guidance` block in prompts
- replace an existing `## Template Guidance` section in `acceptance-matrix.md`
- replace an existing `## Template-Specific Guidance` section in `SYSTEM_SPEC.md`
- delete old template files
- rewrite `roles`, `runtimes`, `routing`, or `gates` for blueprint-backed templates

### 5. Describe `template list --json` honestly

The page must describe the operator-relevant JSON shape emitted by `template list --json`:

- `id`
- `display_name`
- `description`
- planning artifact filenames
- roles with prompt overrides
- scaffold blueprint roles when present
- acceptance hints

### 6. Describe `template validate` honestly

The page must describe the operator-relevant proof surface emitted by `template validate`:

- built-in registry validation
- current project template validation when `agentxchain.json` is present
- `workflow_kit` JSON output for core scaffold proof
- implicit `generic` behavior when a governed repo omits the `template` field
- failure when the configured project template is unknown to the installed CLI
- failure when the core workflow-kit scaffold loses its minimum structural markers:
  - `Approved:`
  - `## Phases`
  - `| Req # |`
  - `## Verdict:`
- explicit `workflow_kit` causing `workflow_kit.required_files` and `structural_checks` to come from declared artifacts instead of the default governed scaffold
- `workflow_kit.phases.<phase>.template` with shipped ids `planning-default`, `implementation-default`, `qa-default`, `architecture-review`, and `security-review`
- template composition rule: same-path explicit artifacts override built-in phase-template artifact fields; new-path explicit artifacts append after the built-in artifacts
- explicit empty `workflow_kit: {}` as an opt-out instead of a fallback to the default scaffold proof
- the re-init path: `agentxchain init --governed --dir . -y` can scaffold newly declared custom artifact files after an operator adds explicit `workflow_kit`

### 7. Cross-link the operator flow

The page must link back to:

- `/docs/quickstart`
- `/docs/cli`

Quickstart and CLI docs must also link into `/docs/templates`.

The front-door repo docs and fast-start docs must keep the discovery commands visible:

- `README.md` must link to `/docs/templates` and show `agentxchain template list`
- `README.md` must show `agentxchain template list --phase-templates`
- `cli/README.md` must link to `/docs/templates` and show `agentxchain template list`
- `cli/README.md` must show `agentxchain template list --phase-templates`
- `website-v2/docs/getting-started.mdx` must show `agentxchain template list --phase-templates`

### 7a. Preserve the evidence boundary honestly

The templates page must state that template choice does not create a different audit/report mode.

It must teach:

- `agentxchain audit` is the live current repo/workspace inspection path
- `agentxchain export` writes the portable artifact
- `agentxchain report --input ...` reads an existing export artifact
- template-specific planning files and workflow-kit artifacts surface through those same commands
- coordinator partial artifacts keep `repo_ok_count` / `repo_error_count` plus the failed repo row and error, but do not fabricate failed-child drill-down

### 8. Describe blueprint authoring honestly

The page must not imply operators can drop arbitrary local template manifests into an existing install.

It must state the real extension path:

- new governed templates live under `cli/src/templates/governed/<id>.json`
- new template IDs must be registered in `VALID_GOVERNED_TEMPLATE_IDS`
- `scaffold_blueprint` may define `roles`, `runtimes`, `routing`, `gates`, and `workflow_kit`
- those blueprint blocks are validated through the governed config validator
- blueprint-backed templates that rewrite team topology or the runtime baseline remain init-only until a dedicated migrator exists

## Error Cases

| Condition | Required docs behavior |
|---|---|
| Page implies templates change protocol semantics | Wrong. Templates are scaffold guidance, not a protocol fork. |
| Page claims `template set` rewrites, merges, or force-overwrites existing planning docs | Wrong. The command is intentionally additive and conservative. |
| Page fabricates `--force` or conflict-detection behavior for `template set` | Wrong. Those semantics belong elsewhere and are not part of the shipped template mutation surface. |
| Page lists template IDs without manifest-backed artifact differences | Incomplete. Operators still cannot choose honestly. |
| Page claims arbitrary operator-supplied blueprint manifests are supported at runtime | Wrong. New blueprint-backed templates are currently a CLI-source extension point. |
| Spec points at retired static-site output paths | Wrong. The docs system is Docusaurus and the spec must bind to the live source/build surface. |

## Acceptance Tests

1. `website-v2/docs/templates.mdx` exists and is wired into `website-v2/sidebars.ts`.
2. `website-v2/build/docs/templates/index.html` exists after `website-v2` build.
3. The page documents `init --governed --template <id>`, `template list`, `template list --json`, and `template set <id> [--yes] [--dry-run]`.
4. The page documents `template validate` and `template validate --json`.
5. The page documents `status` and `status --json` template visibility.
6. The page lists `generic`, `api-service`, `cli-tool`, `library`, and `web-app`.
6a. The page lists `enterprise-app` and explains its init-only blueprint boundary.
7. The page lists the real planning artifact filenames from governed template manifests.
8. The page explains additive `template set` semantics and records `template_set` in `.agentxchain/decision-ledger.jsonl`.
9. The page does not mention `template set --force` or fake conflict-detection semantics.
10. `website-v2/docs/quickstart.mdx` links to `/docs/templates`.
11. `website-v2/docs/cli.mdx` links to `/docs/templates`.
12. `README.md` and `cli/README.md` link to `/docs/templates` and show both `agentxchain template list` and `agentxchain template list --phase-templates`.
13. `website-v2/docs/getting-started.mdx` shows `agentxchain template list --phase-templates` as part of the custom-phase workflow.
14. The page documents blueprint authoring as a built-in CLI extension path via `cli/src/templates/governed/<id>.json` and `VALID_GOVERNED_TEMPLATE_IDS`, not as an operator runtime command.
15. The page documents the shared `audit` / `export` / `report --input` evidence boundary and preserves the partial coordinator artifact rule.

## Open Questions

1. Should each built-in template later get its own `/docs/templates/<id>` deep dive, or is one manifest-backed comparison page sufficient until operators need more per-template guidance?
