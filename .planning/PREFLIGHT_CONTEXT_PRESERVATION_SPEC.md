# Preflight Context Preservation Spec

## Purpose

Prevent `api_proxy` preflight tokenization from silently stripping real orchestrator-authored context sections when compression is required.

The current risk is not hypothetical. `CONTEXT.md` already renders `## Project Goal` and `## Inherited Run Context`, but the preflight parser/compressor only preserved a narrower historical section set. When compression ran, those sections disappeared from `CONTEXT.effective.md` without any declared compression step or audit signal.

## Interface

### Sections Covered

The preflight parser must explicitly preserve these top-level `CONTEXT.md` sections:

- `## Project Goal` → `project_goal`
- `## Inherited Run Context` → `inherited_run_context`

These sections become part of the token-budget report section list alongside the existing current-state, last-turn, decision-history, workflow-artifact, gate, blocker, and escalation sections.

### Compression Policy

- `project_goal` is `required: true`
- `inherited_run_context` is `required: true`

Preflight compression may not drop either section in v1.

## Behavior

1. Parsing `CONTEXT.md` must round-trip `Project Goal` and `Inherited Run Context` byte-for-byte through `parseContextSections()` and `renderContextSections()`.
2. When preflight compression is needed, the effective context may drop only declared compressible sections. `project_goal` and `inherited_run_context` must survive unchanged.
3. If the request still does not fit after all declared compression steps, the adapter must fail locally instead of silently omitting sticky context.
4. `TOKEN_BUDGET.json.report.sections` must include `project_goal` and `inherited_run_context` with action `kept` when they are present.

## Error Cases

- If either section is absent from `CONTEXT.md`, parsing still succeeds; no empty synthetic node is created.
- If token pressure is so high that the payload cannot fit while preserving sticky sections, preflight returns `sent_to_provider = false`. This is correct fail-closed behavior, not a parser fallback.

## Acceptance Tests

1. A context document containing `Project Goal` and `Inherited Run Context` round-trips through the parser without drift.
2. When compression is required, `effective_context` still contains both sections.
3. The token-budget report marks both sections as `kept`.
4. Existing compression order for explicitly compressible sections remains unchanged.

## Open Questions

None. This is a corrective truth slice, not a new product capability.
