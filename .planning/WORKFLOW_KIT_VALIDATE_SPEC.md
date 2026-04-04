# Workflow Kit Validate Spec

> Extend the existing template-validation surface so governed repos can explicitly prove the shipped workflow-kit scaffold, not just template add-ons.

Depends on: [TEMPLATE_VALIDATE_SPEC.md](./TEMPLATE_VALIDATE_SPEC.md), [SDLC_TEMPLATE_SYSTEM_SPEC.md](./SDLC_TEMPLATE_SYSTEM_SPEC.md), [CLI_SPEC.md](./CLI_SPEC.md)

---

## Purpose

Close the remaining operator-facing proof gap in the workflow kit.

Today the governed scaffold ships a concrete repo-native workflow surface:

- `.planning/PM_SIGNOFF.md`
- `.planning/ROADMAP.md`
- `.planning/acceptance-matrix.md`
- `.planning/ship-verdict.md`

Those files are not decorative. They are the minimum workflow-kit contract the CLI scaffolds, the gate model references, and the public docs describe. But the explicit validation surface only proves:

- built-in template registry coherence
- configured template binding
- template-specific planning artifact completeness
- template acceptance-hint completion

That is incomplete. A repo can pass template validation while its core workflow-kit scaffold is malformed or rewritten into something the operator surface no longer understands.

This spec extends the existing `template validate` command. It does **not** add a second command or a new runtime subsystem.

## Interface

### CLI Surface

No new command. The surface remains:

```bash
agentxchain template validate
agentxchain template validate --json
```

### JSON Output Extension

`template validate --json` adds:

```json
{
  "workflow_kit": {
    "ok": true,
    "required_files": [
      ".planning/PM_SIGNOFF.md",
      ".planning/ROADMAP.md",
      ".planning/acceptance-matrix.md",
      ".planning/ship-verdict.md"
    ],
    "gate_required_files": [
      ".planning/PM_SIGNOFF.md",
      ".planning/ROADMAP.md",
      ".planning/acceptance-matrix.md",
      ".planning/ship-verdict.md"
    ],
    "present": [
      ".planning/PM_SIGNOFF.md",
      ".planning/ROADMAP.md",
      ".planning/acceptance-matrix.md",
      ".planning/ship-verdict.md"
    ],
    "missing": [],
    "structural_checks": [
      {
        "id": "pm_signoff_approved_field",
        "file": ".planning/PM_SIGNOFF.md",
        "ok": true,
        "description": "PM signoff declares an Approved field"
      }
    ],
    "errors": [],
    "warnings": []
  }
}
```

Field expectations:

- `required_files`: unique union of the core governed workflow-kit scaffold plus any configured gate `requires_files`
- `gate_required_files`: unique union of only the configured gate `requires_files`
- `present` / `missing`: file existence result for `required_files`
- `structural_checks`: minimal marker checks for the scaffold files the CLI itself generates

### Human-readable Output Extension

When a governed project is present, human-readable output prints:

- workflow-kit pass/fail summary
- file coverage summary
- structural-check coverage summary
- explicit workflow-kit errors alongside registry/project/template errors

## Behavior

### 1. Reuse The Existing Validation Entry Point

Workflow-kit proof belongs in `template validate`, not in a new command. Templates are already the operator-facing bridge between protocol and workflow scaffolding. Splitting “template proof” and “workflow-kit proof” into separate commands would force operators to guess which one is authoritative.

### 2. File Existence Is Necessary But Not Sufficient

The validator must prove the required workflow-kit files exist:

- `.planning/PM_SIGNOFF.md`
- `.planning/ROADMAP.md`
- `.planning/acceptance-matrix.md`
- `.planning/ship-verdict.md`
- plus any additional gate `requires_files` declared in the normalized governed config

But it must also prove the four scaffold-owned files still expose the minimum structural markers the operator workflow depends on:

- `PM_SIGNOFF.md` contains `Approved:`
- `ROADMAP.md` contains a `## Phases` section
- `acceptance-matrix.md` contains the acceptance table header row (`| Req # |`)
- `ship-verdict.md` contains `## Verdict:`

These are intentionally narrow checks. They prove the repo still exposes the shipped workflow-kit contract without pretending to understand the full human-authored contents of the planning docs.

### 3. Governed `validate` Reuses The Same Workflow-Kit Check

`agentxchain validate` for governed projects must reuse the same workflow-kit validation result instead of open-coding a second file-existence loop for gate-required files.

Otherwise the repo would ship two conflicting definitions of workflow completeness.

### 4. Severity Rules

- Missing workflow-kit files are **errors**
- Missing required structural markers are **errors**
- Acceptance hints remain **warnings**, not errors

Do not silently downgrade workflow-kit drift to warnings. These files are part of the shipped operator contract, not optional guidance.

### 5. Non-goals

This extension does not:

- validate the semantic correctness of roadmap or QA content
- prove every acceptance criterion is filled in
- parse ship verdict state beyond the presence of the verdict heading
- turn template acceptance hints into hard gates
- invent a second workflow configuration model

## Error Cases

| Condition | Required behavior |
|---|---|
| `.planning/ship-verdict.md` missing | Fail workflow-kit validation and name the missing file |
| `PM_SIGNOFF.md` exists but has no `Approved:` line | Fail workflow-kit validation and name the missing marker |
| `ROADMAP.md` exists but omits `## Phases` | Fail workflow-kit validation and name the missing marker |
| A gate declares `requires_files` outside the core four | Include those files in `required_files` and fail if any are missing |
| No governed project in cwd | `workflow_kit` is `null`; registry validation still runs |
| Project config cannot be normalized | Skip workflow-kit proof with a warning explaining why |

## Acceptance Tests

- **AT-WORKFLOW-KIT-001**: fresh governed init passes `template validate --json` with `workflow_kit.ok = true` and the four core files present.
- **AT-WORKFLOW-KIT-002**: removing `.planning/ship-verdict.md` makes `template validate --json` fail with `workflow_kit.missing = [".planning/ship-verdict.md"]`.
- **AT-WORKFLOW-KIT-003**: removing the `Approved:` line from `PM_SIGNOFF.md` makes workflow-kit validation fail with the `pm_signoff_approved_field` check marked `ok = false`.
- **AT-WORKFLOW-KIT-004**: governed `agentxchain validate --json` reuses the same workflow-kit errors instead of passing silently.

## Open Questions

1. If a future workflow-kit slice adds machine-enforced release or QA artifacts beyond the current four-file scaffold, should those extend this same validation block or be promoted into a separate release/QA proof surface?
