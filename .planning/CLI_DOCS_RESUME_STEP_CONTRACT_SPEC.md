# CLI Docs Resume/Step Contract Spec

> Status: **shipped**
> Scope: `/docs/cli` turn-lifecycle semantics for `resume` vs `step`

---

## Purpose

Keep the operator-facing `resume` vs `step` docs truthful to the shipped governed lifecycle instead of letting the comparison table drift into slogan copy.

The flag surface is already guarded elsewhere. This spec covers the behavioral contract:

- when `resume` creates or reuses a turn
- when `resume` refuses and points the operator to `step --resume`
- what `step` does that `resume` explicitly does not do

## Interface

### Docs surface

```text
website-v2/docs/cli.mdx
```

### Contract test

```text
cli/test/docs-cli-governance-content.test.js
```

### Implementation evidence

```text
cli/src/commands/resume.js
cli/src/commands/step.js
cli/src/lib/governed-state.js
```

## Behavior

### 1. `resume` is not “existing-turn only”

`resume` must be documented as a non-waiting assignment / re-dispatch command.

Truthful cases from shipped code:

- idle run with no `run_id` → initialize run, assign a new turn, write dispatch bundle
- paused run with `run_id` and no retained failed turn → reactivate run, assign a new turn, write dispatch bundle
- paused run with retained `failed` / `retrying` turn → re-dispatch the same turn

Approval-held pauses are excluded:

- paused run with `pending_phase_transition` or `pending_run_completion` → reject and direct the operator to `approve-transition` or `approve-completion`

Therefore the docs must **not** claim:

- `Creates a turn? No`
- `resume` only targets an already-existing pending turn

### 2. `resume` does not run the adapter or wait for completion

`resume` writes the dispatch bundle and exits. It does not:

- invoke the runtime adapter
- wait for staged result completion
- validate the staged result
- accept or reject the turn

That is the actual contrast with `step`.

### 3. Active-turn recovery belongs to `step --resume`

If a turn is already active, `resume` exits with guidance to use `agentxchain step --resume`.

The docs must say:

- `resume` is for assignment / re-dispatch without waiting
- `step --resume` is the path for continuing an already-active turn through adapter execution and staged-result handling

The docs must **not** tell operators to use `resume` for an already-active interrupted turn.

### 4. `step` is the full lifecycle command

`step` must be documented as the end-to-end command that:

- creates a new turn when no turn is active
- can continue an existing active or retained turn via `--resume`
- runs the adapter
- waits for output
- validates the staged result
- records the outcome

## Error Cases

1. If the docs say `resume` never creates a turn, they are wrong and must fail the contract test.
2. If the docs describe `resume` as the recovery path for an already-active turn, they are wrong; the shipped command points operators to `step --resume`.
3. If the docs blur “dispatch bundle materialized” with “adapter executed”, they are wrong. `resume` does the former, `step` does both.
4. If the docs claim `resume` clears approval-held paused runs, they are wrong. Those pauses require approval commands.

## Acceptance Tests

- `AT-CLI-RS-001`: `/docs/cli` no longer claims `resume` is “assignment only” or “creates no turn”
- `AT-CLI-RS-002`: `/docs/cli` states that `resume` initializes/resumes a run and assigns or re-dispatches one turn without waiting
- `AT-CLI-RS-003`: `/docs/cli` states that `step --resume` is the path for continuing an already-active turn
- `AT-CLI-RS-004`: `cli/test/docs-cli-governance-content.test.js` ties those docs claims to `resume.js`, `step.js`, and `assignGovernedTurn()`
- `AT-CLI-RS-005`: `/docs/cli` states that approval-held paused runs must use `approve-transition` / `approve-completion`, not `resume`

## Open Questions

None. The shipped command behavior is already clear enough to document without inventing new semantics.
