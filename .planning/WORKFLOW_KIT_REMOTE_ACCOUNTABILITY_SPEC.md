# Workflow-Kit Remote Accountability Spec

## Purpose

Resolve the contract gap where a `review_only` non-writing runtime can be assigned `owned_by` for a workflow-kit artifact but has no truthful way to satisfy that ownership — it cannot write repo files, yet the prompt tells it to "produce" the artifact.

## Decision

**`owned_by` has two semantics depending on `write_authority`:**

| `write_authority` | `owned_by` means | Prompt instruction |
|---|---|---|
| `authoritative` | **Produce** — you must write this file | "You must produce this artifact" |
| `proposed` | **Produce** — you must propose this file | "You must propose this artifact" |
| `review_only` | **Attest** — you must review and confirm this artifact exists and meets standards | "You must review and attest to this artifact" |

This is the smallest correct fix. The gate evaluator already works correctly — it checks file existence and owner participation separately. The gap is only in prompt guidance (which currently tells review_only roles to "produce" artifacts they cannot write).

## Interface Changes

### 1. Config Validation (`normalized-config.js`)

Add a **warning** (not error) when a `required` workflow-kit artifact:
- has `owned_by` set to a `review_only` role, AND
- no `authoritative` or `proposed` role exists in the same phase routing

This detects the case where nobody can write the file. It is a warning because an authoritative role might still participate via fallback/escalation — we flag it, not block it.

### 2. Prompt Guidance (`dispatch-bundle.js`)

The `## Workflow-Kit Responsibilities` section must differentiate instructions:

**For `authoritative`/`proposed` owners:**
```
You are accountable for producing these workflow-kit artifacts in phase `planning`:
- `.planning/SPEC.md` — required; semantics: `section_check`; status: MISSING

Do not request phase transition or run completion while a required workflow-kit artifact you own is missing or incomplete.
```

**For `review_only` owners:**
```
You are accountable for reviewing and attesting to these workflow-kit artifacts in phase `planning`:
- `.planning/SPEC.md` — required; semantics: `section_check`; status: exists

You cannot write repo files directly. Your accountability means you must confirm these artifacts exist, meet quality standards, and satisfy their semantic requirements. If a required artifact you own is missing, escalate to the producing role — do not request phase transition.
```

### 3. Gate Evaluator (`gate-evaluator.js`)

No change. The existing gate logic is already correct:
- Checks file existence (someone must write it)
- Checks owner participation (the owning role must have taken a turn)
- Does NOT check that the owner was the one who wrote the file

This is the right behavior for review_only attestation.

## Behavior

1. Config loads → validation emits warning if review_only role owns required artifact with no writer in phase
2. Dispatch builds PROMPT.md → checks `write_authority` of the responsible role → renders appropriate instruction text
3. Gate evaluates → unchanged (file exists + owner participated)

## Error Cases

- `owned_by` references a role that doesn't exist → already caught by existing validation
- `owned_by` references a `review_only` role with no writer in phase → new warning
- `review_only` role owns required artifact, file never gets written → gate fails on file existence (existing behavior, correct)
- `review_only` role never participates → gate fails on participation check (existing behavior, correct)

## Acceptance Tests

### Config Validation
- `AT-WKRA-001`: Warning emitted when `review_only` role owns `required` artifact and no authoritative/proposed role in phase routing
- `AT-WKRA-002`: No warning when `review_only` role owns artifact but an authoritative role exists in the phase
- `AT-WKRA-003`: No warning when `authoritative` role owns artifact (regardless of other roles)

### Prompt Guidance
- `AT-WKRA-004`: `authoritative` owner sees "producing" language and the blocking instruction
- `AT-WKRA-005`: `review_only` owner sees "reviewing and attesting" language and escalation instruction
- `AT-WKRA-006`: `proposed` owner sees "producing" language (same as authoritative)

### Gate Behavior (existing, verified not broken)
- `AT-WKRA-007`: Gate passes when file exists + review_only owner participated
- `AT-WKRA-008`: Gate fails when file missing (regardless of owner write_authority)
- `AT-WKRA-009`: Gate fails when review_only owner did not participate

## Open Questions

None. This is a narrow, well-bounded fix.
