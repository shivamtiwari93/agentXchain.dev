# Workflow-Kit Phase Template Runtime Spec

> Contract for composing built-in workflow-kit phase templates with role-specific overrides and proving them through a real governed run.

Related specs: [WORKFLOW_KIT_CONFIG_SPEC.md](./WORKFLOW_KIT_CONFIG_SPEC.md), [TEMPLATE_BLUEPRINT_SPEC.md](./TEMPLATE_BLUEPRINT_SPEC.md), [CHARTER_ENFORCEMENT_SPEC.md](./CHARTER_ENFORCEMENT_SPEC.md)

---

## Purpose

Close the gap between workflow-kit phase-template configuration and governed runtime proof.

The product claim is not that phase templates can be listed or scaffolded. The claim is that operators can:

- reuse built-in phase templates inside real governed repos,
- layer role-specific metadata such as `owned_by` onto those templates without duplicating the whole artifact contract,
- and run that composed contract through actual phase transitions, gates, and completion.

## Interface

### Config surface

```json
{
  "workflow_kit": {
    "phases": {
      "architecture": {
        "template": "architecture-review",
        "artifacts": [
          {
            "path": ".planning/ARCHITECTURE.md",
            "owned_by": "architect",
            "required": true
          }
        ]
      }
    }
  }
}
```

### Runtime proof surface

- `agentxchain init --governed --template enterprise-app --dir . -y`
- `agentxchain resume`
- `agentxchain accept-turn`
- `agentxchain approve-transition`
- `agentxchain approve-completion`

### Files of record

- `cli/src/lib/workflow-kit-phase-templates.js`
- `cli/src/lib/normalized-config.js`
- `cli/src/templates/governed/enterprise-app.json`
- `cli/test/workflow-kit-config.test.js`
- `cli/test/e2e-workflow-kit-phase-template-runtime.test.js`
- `website-v2/docs/templates.mdx`

## Behavior

### 1. Same-path explicit artifacts override template defaults

When a phase declares both:

- `template: "<built-in-id>"`
- and an explicit artifact entry with the same `path`

the explicit entry overrides or augments the template-backed artifact instead of creating a duplicate.

This is required so operators can add `owned_by`, change `required`, or add other metadata without re-copying the full artifact definition.

### 2. New-path explicit artifacts still append

If an explicit artifact path does not exist in the built-in template, it is appended after the template-backed artifacts. The override rule is only for same-path composition.

### 3. Duplicate explicit overrides still fail closed

Multiple explicit artifacts with the same `path` in one phase remain invalid. Override semantics are for template-to-explicit composition, not for silently accepting ambiguous operator config.

### 4. Blueprint-backed templates may depend on built-in phase templates

`enterprise-app` is allowed to reuse built-in phase templates for:

- `planning`
- `architecture`
- `implementation`
- `security_review`
- `qa`

while layering `owned_by` only where the built-in template intentionally does not infer ownership.

### 5. Runtime proof must use the composed config

The acceptance path must prove a real governed run where:

- the generated `agentxchain.json` contains phase-template references,
- the architect-owned and security-reviewer-owned artifacts retain template semantics plus explicit ownership,
- the run advances across all five phases,
- and governed completion is approved only after the template-backed QA contract passes.

## Error Cases

| Condition | Required behavior |
|---|---|
| Same-path explicit artifact creates a second copy instead of merging | Wrong. Runtime and operator surfaces will show duplicate responsibilities for one file. |
| Explicit artifact with new path overwrites or removes template artifacts | Wrong. Additive extension must remain possible. |
| Multiple explicit artifacts share the same path in one phase | Fail closed. Ambiguous overrides are not allowed. |
| `enterprise-app` keeps copying built-in phase-template artifact blocks instead of reusing them | Incomplete. The product is not proving the abstraction against its own blueprint-backed template. |
| Runtime proof stops at scaffold or validation without phase transitions | Incomplete. The gap is runtime behavior, not config parsing. |

## Acceptance Tests

- `AT-WKC-001c`: same-path explicit override on top of a phase template validates successfully.
- `AT-WKC-012c`: normalization merges same-path explicit overrides onto template-backed artifacts without duplication.
- `AT-WKC-012d`: normalization still appends new-path explicit artifacts after template-backed artifacts.
- `AT-WKC-040e`: scaffold output preserves template headings when the operator overrides the same path to add ownership metadata.
- `AT-WK-PHASE-RUNTIME-001`: `enterprise-app` reuses built-in phase templates, preserves ownership overrides, and completes the full five-phase governed run through `approve-completion`.
