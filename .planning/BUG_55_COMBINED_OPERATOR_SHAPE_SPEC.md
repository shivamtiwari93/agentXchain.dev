# BUG-55 Combined Operator-Shape Spec

## Purpose

Lock the BUG-55 closure contract at the operator-observable level: a single
real QA turn that exhibits **both** sub-defects in **one** repo state, exercised
through the operator's actual CLI command chain, must produce the right
outcome on both branches.

The two existing scenarios already cover each sub-defect independently.
What the tester report described, however, was a *single* run where the
QA turn declared `files_changed` for actor mutations AND its verification
commands produced fixture outputs. This spec covers that combined shape so
no future regression can reintroduce the cross-defect failure mode the
tester actually hit.

## Interface

The test spawns the published CLI binary at `cli/bin/agentxchain.js` for
every state-changing step. No in-process function calls are used to drive
the chain; only `spawnSync(process.execPath, [CLI_PATH, '<command>'])`.

Commands exercised, in order:

1. `agentxchain accept-turn --turn <id>`
2. `agentxchain checkpoint-turn --turn <id>` (only on the happy path)

Both branches use the same fixture so the only difference between the two
test cases is the presence of `verification.produced_files` declarations.

## Behavior

### Reject branch (no `produced_files` declaration)

- `accept-turn` exits non-zero.
- stdout/stderr names every undeclared fixture path (all four).
- stdout/stderr names `verification.produced_files` as the remediation surface.
- An `acceptance_failed` event is appended to `RUN_EVENTS_PATH` with
  `payload.error_code === 'undeclared_verification_outputs'` and
  `payload.unexpected_dirty_files` containing all four fixture paths.
- The turn remains on `state.active_turns[turnId]` with
  `status === 'failed_acceptance'`.

### Accept branch (all fixtures declared `disposition: 'ignore'`)

- `accept-turn` exits 0.
- All four fixture files are removed from the working tree (BUG-46
  cleanup path).
- `checkpoint-turn` exits 0.
- The HEAD commit's tree contains exactly the four declared
  `files_changed` paths.
- `git status --short` is empty.
- `state.accepted_integration_ref` matches `^git:`.

## Error Cases

- If the schema for `verification.produced_files` changes such that the
  combined declaration shape is rejected, the accept branch fails on
  `accept-turn`. The test surfaces the validator error verbatim.
- If `cleanupIgnoredVerificationFiles` regresses and leaves a fixture in
  the tree, `git status --short` after checkpoint will be non-empty and
  the test fails with the dirty path quoted.
- If the checkpoint-completeness fix regresses and silently drops one of
  the four declared paths, the HEAD-commit tree assertion fails with the
  missing file named.

## Acceptance Tests

The single test file
`cli/test/beta-tester-scenarios/bug-55-combined-tester-shape.test.js`
contains both branches as separate `it(...)` blocks under one
`describe('BUG-55 combined operator shape — tester paths', ...)`.

Both tests must pass. The reject branch must fail loudly when the
verification schema regresses. The accept branch must fail loudly when
either sub-defect's fix regresses.

## Open Questions

- None for closure shape. Whether to also extend the claim-reality
  preflight to require the combined scenario file is left to the
  next decision cycle (tracked in AGENT-TALK Turn 79 next-actions).
