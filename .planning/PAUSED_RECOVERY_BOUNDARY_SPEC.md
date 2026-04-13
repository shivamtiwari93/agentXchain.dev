# Paused Recovery Boundary Spec

> Status: **shipped**
> Scope: paused-run reactivation semantics across `initializeGovernedRun()`, `reactivateGovernedRun()`, `resume`, and the state-machine / CLI docs.

---

## Purpose

Freeze a single truthful boundary for paused runs so the repo does not keep two competing recovery paths:

- `initializeGovernedRun()` for new-run bootstrap
- ad hoc paused reactivation in `resume` / `step`

Approval-held pauses are protocol gates, not generic resumable states. Operators must not be able to bypass `approve-transition` / `approve-completion` by calling `resume`, and the low-level initializer must not silently reactivate paused runs.

## Interface

### Runtime code

```text
cli/src/lib/governed-state.js
cli/src/commands/resume.js
cli/src/commands/step.js
```

### Docs / specs

```text
.planning/STATE_MACHINE_SPEC.md
.planning/CLI_DOCS_RESUME_STEP_CONTRACT_SPEC.md
website-v2/docs/cli.mdx
```

### Proof surface

```text
cli/test/governed-state.test.js
cli/test/governed-cli.test.js
cli/test/docs-cli-governance-content.test.js
cli/test/dispatch-bundle.test.js
```

## Behavior

### 1. `initializeGovernedRun()` is bootstrap-only

`initializeGovernedRun()` may start a new run from:

- `idle`
- pre-run `blocked` bootstrap state with no `run_id` and no active turns

It must reject plain `paused` states. Paused reactivation belongs to explicit recovery commands, not run initialization.

### 2. Runs with pending approval objects are not resumable (regardless of status)

If a run has either:

- `pending_phase_transition`, or
- `pending_run_completion`

then `resume` / `reactivateGovernedRun()` must reject reactivation regardless of whether the run status is `paused` or `blocked`. This covers two cases:

1. **Paused + approval objects:** normal approval-held state.
2. **Blocked + approval objects:** a `before_gate` hook failed during `approvePhaseTransition()` / `approveRunCompletion()`. The hook blocked the run but did not clear the approval object. The operator must fix the hook and re-run the approval command — not bypass it via `resume`.

The approval commands (`approve-transition`, `approve-completion`) accept both `paused` and `blocked` status via `canApprovePendingGate()`, so the operator can always recover through the correct path.

### 3. Non-approval paused recovery stays valid

Paused states that are not awaiting approval may still be reactivated through the explicit recovery path:

- retained failed/retrying turn re-dispatch
- paused run with `run_id` and no pending approval fields

That path belongs to `reactivateGovernedRun()` and the CLI recovery commands, not to `initializeGovernedRun()`.

### 4. Public docs must state the approval boundary

The CLI docs may say that `resume` can resume a paused run, but they must also say that approval-held pauses are excluded and must be resolved with `approve-transition` or `approve-completion`.

## Error Cases

1. `initializeGovernedRun()` silently reactivates `paused` and creates a second bootstrap path.
2. `resume` clears `pending_phase_transition` / `pending_run_completion` pauses instead of requiring approval.
3. `resume` reactivates a `blocked` run that still carries `pending_phase_transition` / `pending_run_completion` (before_gate hook failure path).
4. CLI docs say `resume` handles paused runs generically without the approval caveat.
5. State-machine docs leave `paused -> active via initializeGovernedRun()` documented after the runtime boundary has been tightened.

## Acceptance Tests

- `AT-PRB-001`: `initializeGovernedRun()` rejects a plain paused state.
- `AT-PRB-002`: `initializeGovernedRun()` still bootstraps a pre-run blocked migration-review state.
- `AT-PRB-003`: `reactivateGovernedRun()` rejects paused states that still carry `pending_phase_transition` or `pending_run_completion`.
- `AT-PRB-003a`: `reactivateGovernedRun()` rejects blocked states that still carry `pending_phase_transition` (before_gate hook failure path).
- `AT-PRB-003b`: `reactivateGovernedRun()` rejects blocked states that still carry `pending_run_completion` (before_gate hook failure path).
- `AT-PRB-003c`: `approvePhaseTransition()` succeeds on blocked runs with pending approval (hook-fix-and-retry path).
- `AT-PRB-004`: `agentxchain resume` exits non-zero on approval-held paused runs and preserves pending approval fields on disk.
- `AT-PRB-005`: `/docs/cli` states that approval-held pauses must be resolved with `approve-transition` / `approve-completion`.

## Open Questions

None. The paused recovery split is now explicit:

- bootstrap with `initializeGovernedRun()`
- recover with `reactivateGovernedRun()` / `resume` / `step`
- approve with `approve-transition` / `approve-completion`
