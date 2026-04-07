# Template-Specific SYSTEM_SPEC Overlay Spec

## Purpose

The baseline `SYSTEM_SPEC.md` created by `agentxchain init --governed` uses generic placeholder text regardless of template. An operator scaffolding an `api-service` gets the same "Describe the problem this slice solves" prompt as one scaffolding a `library`. This makes the spec artifact less useful as a planning guide because it does not prime the PM role with project-shape-specific questions.

This spec adds a `system_spec_overlay` field to template manifests so that `init` and `template set` produce SYSTEM_SPEC.md content that is project-shape-aware.

## Interface

### Manifest field

Each template manifest (`cli/src/templates/governed/*.json`) gains an optional `system_spec_overlay` object:

```json
{
  "system_spec_overlay": {
    "purpose_guidance": "Template-specific guidance for the ## Purpose section.",
    "interface_guidance": "Template-specific guidance for the ## Interface section.",
    "behavior_guidance": "Template-specific guidance for the ## Behavior section.",
    "error_cases_guidance": "Template-specific guidance for the ## Error Cases section.",
    "acceptance_tests_guidance": "Template-specific default acceptance test items.",
    "extra_sections": "Optional additional markdown sections appended after ## Open Questions."
  }
}
```

All fields are optional strings. `generic` template has no overlay (empty object or absent).

### Init path (`agentxchain init --governed --template <id>`)

When a template has `system_spec_overlay`, the SYSTEM_SPEC.md is generated with template-specific guidance replacing the generic placeholders in each section. The required structural markers (`## Purpose`, `## Interface`, `## Acceptance Tests`) are always present regardless of overlay content.

### Template-set path (`agentxchain template set <id>`)

When switching templates on an existing project, if the new template has `system_spec_overlay` and the existing SYSTEM_SPEC.md does not already contain a `## Template-Specific Guidance` separator, a new section is appended with the template-specific guidance. If the separator already exists, the append is skipped (idempotent, same pattern as prompt overrides).

## Behavior

1. **Init path**: The overlay guidance replaces generic placeholder text within each section. The section headers themselves (`## Purpose`, `## Interface`, etc.) are invariant.
2. **Template-set path**: Overlay guidance is appended after existing content under a `## Template-Specific Guidance` separator. Existing content is never overwritten.
3. **Validation**: `validateGovernedTemplateManifest()` validates `system_spec_overlay` when present: must be an object, all keys must be from the allowed set, all values must be non-empty strings.
4. **Generic template**: Has no `system_spec_overlay` (or empty object). Produces the current baseline SYSTEM_SPEC.md unchanged.

## Error Cases

- Template manifest with `system_spec_overlay` containing unknown keys → validation error.
- Template manifest with `system_spec_overlay` containing empty-string values → validation error.
- `template set` on a SYSTEM_SPEC.md that already has `## Template-Specific Guidance` → skip (no error, idempotent).
- `template set` when `.planning/SYSTEM_SPEC.md` does not exist → skip with warning (same as missing acceptance-matrix).

## Acceptance Tests

- AT-SPEC-OVERLAY-001: `init --governed --template api-service` produces SYSTEM_SPEC.md with API-specific guidance in Purpose and Interface sections.
- AT-SPEC-OVERLAY-002: `init --governed --template generic` produces SYSTEM_SPEC.md with the original generic placeholders.
- AT-SPEC-OVERLAY-003: `template set api-service` on a project with generic SYSTEM_SPEC.md appends `## Template-Specific Guidance` section.
- AT-SPEC-OVERLAY-004: `template set api-service` on a project that already has `## Template-Specific Guidance` is idempotent (no duplicate append).
- AT-SPEC-OVERLAY-005: `template set` when SYSTEM_SPEC.md is missing logs a warning and does not fail.
- AT-SPEC-OVERLAY-006: Manifest validation rejects `system_spec_overlay` with unknown keys.
- AT-SPEC-OVERLAY-007: Manifest validation rejects `system_spec_overlay` with empty-string values.
- AT-SPEC-OVERLAY-008: All four non-generic templates have non-empty `system_spec_overlay` in their manifests.

## Open Questions

None — the pattern mirrors the existing `prompt_overrides` and `acceptance_hints` overlay mechanisms.
