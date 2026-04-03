# V3-S2 Spec — Intake Approval And Planning Artifact Generation

> Standalone implementation spec for the second v3 slice. Covers `intake approve` and `intake plan` commands, planning-artifact generation from governed templates, and the `triaged -> approved -> planned` transition path.

---

## Purpose

S1 shipped the intake entrypoint: events, intents, triage, suppress, reject. But triaged intents currently dead-end — there is no path from "this work is triaged" to "this work is ready to execute."

S2 closes that gap with two commands:

- `intake approve` — human (or policy) authorization gate for triaged work
- `intake plan` — generates template-specific planning artifacts so the intent is execution-ready

These commands do NOT start execution. They prepare the governed run. `DEC-V3-SCOPE-002` is the controlling decision: continuous delivery may automate intake and triage, but it may not auto-start code-writing execution without an explicit approval transition.

---

## Design Decision: Separate Commands, Not Triage Extensions

`intake approve` and `intake plan` are separate commands, not `--approve` / `--plan` flags on `intake triage`.

Reasons:

1. **Approval is an authorization gate.** Triage is operational classification. Mixing them conflates who-can-classify with who-can-authorize.
2. **Planning generates artifacts.** Triage writes metadata. Mixing them makes triage a side-effect-heavy command.
3. **Triage already has suppress/reject overloading.** Adding more modes would make the command surface confusing.
4. **Separate commands allow separate policy hooks.** Future hook-based governance can gate `intake approve` without touching triage policy.

---

## State Machine Extension

### New Transitions (S2)

```
triaged  -> approved   (via intake approve)
approved -> planned    (via intake plan)
```

### Combined S1+S2 State Machine

```
detected  -> triaged     (via intake triage)
detected  -> suppressed  (terminal, via intake triage --suppress)
triaged   -> approved    (via intake approve)
triaged   -> rejected    (terminal, via intake triage --reject)
approved  -> planned     (via intake plan)
```

States beyond `planned` remain deferred: `executing`, `awaiting_release_approval`, `released`, `observing`, `closed`, `blocked`, `reopened`.

---

## CLI Commands

### `agentxchain intake approve`

Transitions a `triaged` intent to `approved`.

```
agentxchain intake approve --intent <id> [--approver <name>] [--reason <text>] [--json]
```

**Options:**
- `--intent <id>` — required, the intent to approve
- `--approver <name>` — optional, name of the approving authority (defaults to `"operator"`)
- `--reason <text>` — optional, reason for approval (defaults to `"approved for planning"`)
- `--json` — output as JSON

**Behavior:**
1. Load the intent file
2. Validate current status is `triaged` — reject otherwise
3. Set `status` to `approved`
4. Record `approved_by` field on the intent
5. Append transition to `history` array with `approver` and `reason`
6. Update `updated_at`
7. Write intent file

**Exit codes:**
- 0: approval succeeded
- 1: invalid transition (not in `triaged` state)
- 2: intent not found

**Text output:**
```
  Approved intent intent_1712173200000_c3d4
  Approver: operator
  Status: triaged -> approved
```

**JSON output:**
```json
{ "ok": true, "intent": { ... } }
```

### `agentxchain intake plan`

Transitions an `approved` intent to `planned` by generating template-specific planning artifacts.

```
agentxchain intake plan --intent <id> [--project-name <name>] [--force] [--json]
```

**Options:**
- `--intent <id>` — required, the intent to plan
- `--project-name <name>` — optional, substituted into `{{project_name}}` in templates (defaults to repo directory name)
- `--force` — overwrite existing planning artifacts if they already exist
- `--json` — output as JSON

**Behavior:**
1. Load the intent file
2. Validate current status is `approved` — reject otherwise
3. Load the governed template manifest for `intent.template` via `loadGovernedTemplate()`
4. For each `planning_artifacts` entry in the manifest:
   a. Compute target path: `<project_root>/.planning/<filename>`
   b. If the file already exists and `--force` is not set, collect as a conflict
   c. Substitute `{{project_name}}` in `content_template`
   d. Write the file
5. If any conflicts exist (without `--force`), fail with exit 1 listing the conflicting files — do NOT write any files and do NOT transition the intent
6. Record generated artifact paths on the intent as `planning_artifacts: string[]`
7. Set `status` to `planned`
8. Append transition to `history` with list of generated artifacts
9. Update `updated_at`
10. Write intent file

**Exit codes:**
- 0: planning succeeded, artifacts generated
- 1: conflict (existing artifacts without `--force`) or validation error
- 2: intent not found or template not found

**Text output (success):**
```
  Planned intent intent_1712173200000_c3d4
  Template: cli-tool
  Generated planning artifacts:
    .planning/command-surface.md
    .planning/platform-support.md
    .planning/distribution-checklist.md
  Status: approved -> planned
```

**Text output (conflict):**
```
  Cannot plan intent intent_1712173200000_c3d4
  Existing planning artifacts would be overwritten:
    .planning/command-surface.md
  Use --force to overwrite, or remove the existing files first.
```

**JSON output (success):**
```json
{
  "ok": true,
  "intent": { ... },
  "artifacts_generated": [".planning/command-surface.md", ...],
  "artifacts_skipped": []
}
```

**JSON output (conflict):**
```json
{
  "ok": false,
  "error": "existing planning artifacts would be overwritten",
  "conflicts": [".planning/command-surface.md"]
}
```

---

## Intent Schema Extension

After S2, intent files may include two additional fields:

```json
{
  "approved_by": "operator",
  "planning_artifacts": [".planning/command-surface.md", ...]
}
```

These fields are `null` until the respective transitions occur. Existing S1 intents remain valid — the new fields are additive.

---

## Template Integration

Planning artifact generation reuses the existing `governed-templates.js` system:

- `loadGovernedTemplate(intent.template)` loads the manifest
- `manifest.planning_artifacts` defines what to generate
- `content_template` is the file content with `{{project_name}}` substitution
- `generic` template has zero `planning_artifacts` — `intake plan` on a `generic`-templated intent succeeds immediately with no artifacts generated (this is correct, not an error)

No second template system is introduced. No new template schema is required.

---

## Error Cases

1. **Intent not found**: exit 2
2. **Wrong state for approve** (not `triaged`): exit 1 with `"cannot approve from status '<current>' (must be triaged)"`
3. **Wrong state for plan** (not `approved`): exit 1 with `"cannot plan from status '<current>' (must be approved)"`
4. **Template not found** (intent.template references unknown template): exit 2 with template error from `loadGovernedTemplate()`
5. **Artifact conflict** (file exists, no `--force`): exit 1 listing conflicts, no state change, no files written
6. **Template load failure** (corrupt manifest): exit 2 with validation error

---

## Acceptance Tests

- `AT-V3S2-001`: `intake approve` on a `triaged` intent transitions to `approved` with history entry
- `AT-V3S2-002`: `intake approve` on a `detected` intent fails with invalid-transition error
- `AT-V3S2-003`: `intake approve` on a non-existent intent fails with exit 2
- `AT-V3S2-004`: `intake approve` records `approved_by` field from `--approver` option
- `AT-V3S2-005`: `intake plan` on an `approved` intent with `cli-tool` template generates 3 planning artifacts and transitions to `planned`
- `AT-V3S2-006`: `intake plan` on a `triaged` intent fails with invalid-transition error
- `AT-V3S2-007`: `intake plan` with existing artifacts fails with conflict error, no files written, no state change
- `AT-V3S2-008`: `intake plan --force` overwrites existing artifacts and transitions to `planned`
- `AT-V3S2-009`: `intake plan` on a `generic`-templated intent succeeds with zero artifacts generated
- `AT-V3S2-010`: `intake plan` records `planning_artifacts` array on the intent
- `AT-V3S2-011`: `intake approve --json` and `intake plan --json` return structured JSON output
- `AT-V3S2-012`: Full pipeline: `record -> triage -> approve -> plan` produces a `planned` intent with correct artifacts

---

## Open Questions

None. This spec is self-contained and implementable.
