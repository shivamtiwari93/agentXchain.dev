# Turn Inspection Command Spec

**Status:** shipped
**Decision:** DEC-TURN-INSPECT-001

## Purpose

Operators can currently inspect role definitions, proposals, history, events, reports, and status through dedicated commands. Active turn dispatch bundles still require manual filesystem spelunking under `.agentxchain/dispatch/turns/<turn_id>/`.

That is a real operator-surface gap. The dispatch bundle is the live execution contract for a governed turn. Operators need a first-party CLI path to inspect the selected turn and read the generated artifacts without dropping into raw file browsing.

## Interface

### `agentxchain turn show [turn_id]`

Shows the selected active turn with dispatch-bundle paths and artifact availability.

If exactly one active turn exists, `turn_id` is optional. If multiple active turns exist, `turn_id` is required.

**Flags:**

- `--artifact <name>` — print one dispatch artifact directly (`assignment`, `prompt`, `context`, or `manifest`)
- `--json` — emit structured JSON instead of the human-readable summary

### Summary output

Text output includes:

- turn id
- run id
- phase
- role
- runtime
- status
- attempt
- dispatch directory
- staging result path
- dispatch artifact paths and existence

### Artifact output

`--artifact prompt` and `--artifact context` print the raw markdown artifact.

`--artifact assignment --json` and `--artifact manifest --json` emit parsed JSON content plus turn metadata instead of raw filesystem output.

## Behavior

1. The command is governed-only.
2. `turn show` defaults to the single active turn when exactly one exists.
3. `turn show` fails closed when no active turn exists.
4. `turn show` requires explicit targeting when multiple active turns exist.
5. `turn show --artifact <name>` fails if the selected artifact file is missing.
6. The command is read-only. No dispatch, assignment, or mutation side effects.

## Error Cases

1. Ungoverned repo: fail with a governed-only message.
2. No active turns: fail with `No active turn found.`
3. Multiple active turns without `turn_id`: fail with available active turn ids.
4. Unknown `turn_id`: fail with available active turn ids.
5. Unknown artifact name: fail with the allowed artifact ids.
6. Missing artifact file: fail with the missing dispatch path.

## Acceptance Tests

- **AT-TURN-001:** `turn show` defaults to the single active turn and prints the dispatch artifact paths.
- **AT-TURN-002:** `turn show --json` emits structured turn metadata and artifact existence.
- **AT-TURN-003:** `turn show --artifact prompt` prints the generated `PROMPT.md`.
- **AT-TURN-004:** `turn show --artifact assignment --json` returns parsed assignment content for the selected turn.
- **AT-TURN-005:** `turn show` fails closed when multiple active turns exist and no `turn_id` was provided.
- **AT-TURN-006:** `turn show` fails closed when no active turn exists.

## Open Questions

None. This slice is intentionally narrow: inspect active governed turns and their dispatch artifacts without broadening into mutation or validation commands.
