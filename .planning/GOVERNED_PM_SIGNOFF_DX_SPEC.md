# Governed PM Signoff DX Spec

## Purpose

Prevent fresh governed operators from hitting the planning gate without understanding why. The scaffold must remain fail-closed, but the operator path must state plainly that `.planning/PM_SIGNOFF.md` starts at `Approved: NO` and must be changed to `Approved: YES` only after human kickoff approval.

## Interface

- Governed scaffold file: `.planning/PM_SIGNOFF.md`
- Example walkthrough: `examples/governed-todo-app/README.md`
- Front-door lifecycle snippet: `README.md`
- CLI guidance when kickoff is still incomplete: `agentxchain start --remaining`

## Behavior

1. A fresh governed scaffold continues to initialize `PM_SIGNOFF.md` with `Approved: NO`.
2. The scaffolded file includes an explicit operator note explaining:
   - the blocked default is intentional
   - the human must flip the marker to `Approved: YES`
   - the change should only happen after kickoff/planning review is complete
3. The governed todo example README tells the operator exactly which marker to change before accepting the PM turn and approving the planning gate.
4. The root README lifecycle snippet tells the operator that planning exit requires changing `Approved: NO` to `Approved: YES`.
5. When `agentxchain start --remaining` fails kickoff validation, the suggested next step names the `Approved: NO` default and tells the operator to flip it only after human signoff.

## Error Cases

- Changing the scaffold default to `Approved: YES` would silently weaken a human gate and is not allowed.
- Telling operators only to “edit PM_SIGNOFF.md” is insufficient because it hides the actual gate semantic.
- Explaining the rule only in docs but not in the scaffold/CLI leaves the first failure path opaque.

## Acceptance Tests

- AT-PMSDX-001: `scaffoldGoverned()` writes `.planning/PM_SIGNOFF.md` with `Approved: NO` plus an explicit note that the human must flip it to `Approved: YES` after kickoff approval.
- AT-PMSDX-002: `examples/governed-todo-app/README.md` instructs the operator to change `Approved: NO` to `Approved: YES` before accepting the PM turn.
- AT-PMSDX-003: `README.md` lifecycle guidance states that planning exit requires flipping `PM_SIGNOFF.md` from `Approved: NO` to `Approved: YES`.
- AT-PMSDX-004: `startCommand()` incomplete-kickoff guidance mentions the `Approved: NO` default and the required flip to `Approved: YES`.

## Open Questions

- None. This slice is guidance hardening, not a runtime semantics change.
