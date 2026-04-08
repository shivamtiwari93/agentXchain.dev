# Roadmap Phase Display Spec

## Purpose

Make scaffolded `.planning/ROADMAP.md` phase labels operator-readable without mangling common abbreviations.

The current formatter title-cases routing keys mechanically, which turns `qa` into `Qa`. That is visibly wrong in a shipped artifact and undermines the claim that scaffold output is production-usable by default.

## Interface

- File: `cli/src/commands/init.js`
- Surface: `buildRoadmapPhaseTable(routing, roles)`
- Input:
  - routing keys such as `planning`, `implementation`, `qa`, `security_review`
  - role map used for phase-goal derivation
- Output:
  - markdown table rows in `.planning/ROADMAP.md`

## Behavior

1. Scaffolded phase labels must preserve readable word spacing for underscore-delimited phase keys.
2. Known acronym-style phases must render with their operator-facing capitalization.
3. `qa` must render as `QA`, not `Qa`.
4. Non-acronym phases continue to render in title case:
   - `planning` -> `Planning`
   - `security_review` -> `Security Review`
5. This is a display-only rule. Routing keys, phase IDs, and runtime behavior remain unchanged.
6. Do not add a new manifest or routing contract for display names in this slice. A small formatter map is sufficient for the current defect.

## Error Cases

- If a phase key is unknown to the display-name override map, fall back to the existing underscore-to-title-case behavior.
- Do not infer acronyms from role titles or mutate routing keys at runtime. The change is confined to ROADMAP scaffold rendering.

## Acceptance Tests

- `AT-RPD-001`: generic scaffold renders `QA` in the roadmap phase table.
- `AT-RPD-002`: enterprise-app scaffold renders `QA` in the roadmap phase table.
- `AT-RPD-003`: enterprise-app scaffold still renders `Security Review` and preserves routing order.
- `AT-RPD-004`: full CLI suite remains green after the display change.

## Open Questions

None. If future templates need richer labels than simple acronym preservation, that can justify a separate `display_name` contract later.
