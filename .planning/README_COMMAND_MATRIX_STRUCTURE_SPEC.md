# README Command Matrix Structure Spec

## Purpose

Keep the README front doors discoverable without turning them into an unreadable command wall. The command surface has grown large enough that a single flat governed matrix now imposes unnecessary scan cost on new operators.

## Interface

- `README.md`
- `cli/README.md`
- `cli/test/readme-command-matrix-structure.test.js`

## Behavior

1. `README.md` must keep the top-level `Canonical Governed Commands` section, but the command block should be grouped by operator intent instead of one flat sequence.
2. `cli/README.md` must split the governed command table into multiple governed sub-tables with clear headings.
3. The grouped structure must preserve front-door discoverability for:
   - lifecycle and execution commands
   - proof and inspection commands
   - automation, plugins, and continuity commands
4. `doctor` must remain discoverable in governed surfaces without relying on the legacy compatibility section.
5. Artifact-inspection commands that are first-class operator paths must remain discoverable in the grouped structure, including `replay export`.
6. No command should disappear from the front door solely because the structure changed.

## Error Cases

- A future edit collapses the governed command matrix back into one oversized table.
- A command moves back into legacy-only framing even though it is part of governed operation.
- A grouped heading exists, but key commands are missing from the relevant governed section.
- `replay export` disappears from the front door even though it is the shipped artifact-backed dashboard path.

## Acceptance Tests

- `README.md` contains grouped governed command headings under `Canonical Governed Commands`.
- `cli/README.md` contains multiple governed command-group headings under `Command Sets`.
- `run`, `audit`, `doctor`, `connector check`, `plugin list-available`, `export`, `restore`, and `replay export` remain discoverable after the restructure.

## Open Questions

- None. This is a readability and operator-scan optimization, not a behavior change.
