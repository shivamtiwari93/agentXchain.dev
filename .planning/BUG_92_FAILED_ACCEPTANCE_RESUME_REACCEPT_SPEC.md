# BUG-92: failed_acceptance resume must reattempt staged acceptance

## Purpose

Continuous full-auto recovery must be able to resume a run that paused on a `failed_acceptance` turn after the substrate has shipped a validator or parity fix. The runner must reattempt acceptance of the existing staged result before assigning any new turn.

## Interface

- `agentxchain run`
- `agentxchain run --continuous --vision <path>`
- Existing turn-scoped staging file: `.agentxchain/staging/<turn_id>/turn-result.json`
- Existing active turn state: `active_turns[turn_id].status === "failed_acceptance"`

## Behavior

When a governed run is active and contains a `failed_acceptance` active turn with a turn-scoped staged result:

1. `runLoop()` MUST call `acceptTurn(root, config, { turnId })` before `assignTurn()`.
2. If acceptance succeeds, normal `afterAccept` handling runs, including auto-checkpoint callbacks.
3. The run then continues from the post-acceptance state.
4. No new turn is assigned while the failed-acceptance turn remains active.
5. The CLI output MUST NOT surface `Turn already assigned` for this recovery shape.

## Error Cases

- If no staged result exists for the failed-acceptance turn, the run remains blocked with a typed error naming the missing staging file.
- If reacceptance fails again, the run remains paused/blocked with the new validation error. It must not assign a duplicate turn.
- If multiple failed-acceptance turns exist, the runner may reattempt one at a time; it must never assign over retained active turns.

## Acceptance Tests

- Command-chain regression seeds an active run with one `failed_acceptance` dev turn, a valid staged result, and a baseline-dirty unchanged evidence file, then runs `agentxchain run --max-turns 1 --auto-approve --auto-checkpoint`. Expected: the staged turn accepts and no `Turn already assigned` error appears.
- Negative regression seeds a failed-acceptance turn without a staged result and proves `agentxchain run` exits blocked with a missing-staging recovery error, not duplicate assignment.
- Existing BUG-91 baseline-dirty unchanged acceptance tests still pass.

## Open Questions

- None for this fix. Multi-turn failed-acceptance batch recovery can be optimized later; one-at-a-time recovery is sufficient and safer for phase-transition side effects.
