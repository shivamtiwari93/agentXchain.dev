# Phase Inspection Command Spec

**Status:** shipped
**Decision:** DEC-PHASE-INSPECT-001

## Purpose

Operators can currently inspect roles, turns, proposals, history, events, reports, and status through dedicated commands. The governed workflow itself still lacks a first-class inspection surface.

That is a real gap. `routing` and `workflow_kit` define the governed delivery contract: phase order, entry roles, exit gates, allowed next roles, timeout overrides, and artifact ownership. Operators should not have to dump raw config JSON just to answer "what does this phase require?" or "which artifact belongs to whom?"

## Interface

### `agentxchain phase list`

List the governed phases in routing order with the current phase highlighted when state is available.

### `agentxchain phase show [phase]`

Show the selected governed phase in detail.

If `phase` is omitted, the command defaults to the current governed phase from state. If no current phase is available, it falls back to the first phase in routing order.

**Flags:**

- `--json` — emit structured JSON instead of human-readable output

## Summary Output

`phase list` prints, per phase:

- phase id
- whether the phase is current
- entry role
- exit gate
- next phase
- workflow artifact count

`phase show` prints:

- phase id
- whether the phase is current
- entry role
- exit gate
- gate status when available
- next phase
- allowed next roles
- per-phase timeout override and max concurrent turns when configured
- workflow-kit source (`default`, `explicit`, or `not_declared`)
- explicit workflow-kit template id when declared
- workflow-kit artifacts with owner, ownership resolution, `ownership_enforced` flag, required/optional status, semantics, and filesystem presence

## Behavior

1. The command is governed-only and requires v4 config.
2. `phase list` reads routing order from the normalized config.
3. `phase show` defaults to the current state phase when available.
4. When raw `workflow_kit` is absent, the command must still expose the normalized default workflow-kit artifacts for standard phases.
5. When `workflow_kit` is explicit but a phase has no declared entry, the command must report `workflow_source: "not_declared"` instead of pretending defaults apply.
6. The command is read-only. No config or state mutation.
7. **Ownership enforcement boundary (DEC-OWNERSHIP-BOUNDARY-001):** Only explicit `owned_by` is enforced at gate evaluation. When `owned_by` is inferred from `entry_role`, `phase show` must display it as a display-only hint with `ownership_enforced: false` in JSON and "(hint, not enforced)" in text output. This aligns the display surface with the runtime gate evaluator contract.

## Error Cases

1. Repo is missing `agentxchain.json`.
2. Repo is legacy v3 or otherwise not governed.
3. Routing has no phases.
4. Requested phase is unknown; error must list available phases.

## Acceptance Tests

- **AT-PHASE-001:** `phase list` prints routing-ordered phases and marks the current phase.
- **AT-PHASE-002:** `phase list --json` emits the current phase plus structured phase entries.
- **AT-PHASE-003:** `phase show --json` defaults to the current phase and exposes normalized default workflow-kit artifacts when raw `workflow_kit` is absent.
- **AT-PHASE-004:** `phase show <phase> --json` exposes explicit workflow-kit template and artifact ownership for template-defined phases.
- **AT-PHASE-005:** `phase show <unknown>` exits `1` with available phase ids.
- **AT-PHASE-006:** phase commands fail closed on legacy v3 repos with a clear governed/v4 message.
- **AT-PHASE-007:** `phase show --json` marks inferred ownership as `ownership_enforced: false` and explicit ownership as `ownership_enforced: true`.
- **AT-PHASE-008:** `phase show` text output labels inferred ownership as "hint, not enforced" with a footer clarifying the enforcement boundary.

## Open Questions

None. This slice is intentionally narrow: inspect governed phase contracts without adding mutation or validation behavior.
