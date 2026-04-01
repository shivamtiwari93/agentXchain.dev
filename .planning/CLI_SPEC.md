# CLI Specification — Governed v1

> Command reference for the implemented governed operator workflow. This spec is descriptive: it documents what the CLI does today, not aspirational behavior.

---

## Purpose

Define the governed command surface that operators use to initialize runs, assign work, dispatch turns, validate staged results, accept or reject turns, and approve gated transitions. The goal is to make command semantics, failure cases, and operator recovery testable before broader dogfood.

This spec covers the governed command path only. Legacy v3 commands such as `start`, `watch`, `claim`, and `release` remain supported in the product, but they are out of scope for this v1 governed contract.

---

## Interface/Schema

### Binary

```text
agentxchain <command> [options]
```

### Governed Commands

| Command | Purpose | Governed-only |
|---|---|---|
| `init --governed` | Scaffold governed project files and initial idle state | No |
| `status` | Show governed state and recovery information | No |
| `resume` | Initialize/resume a run and assign the next turn without waiting | Yes |
| `step` | Run one full governed turn lifecycle | Yes |
| `accept-turn` | Accept the currently staged turn result | Yes |
| `reject-turn --reason <reason>` | Reject the current staged turn result and retry or escalate | Yes |
| `approve-transition` | Approve a pending phase transition | Yes |
| `approve-completion` | Approve a pending run completion | Yes |
| `validate --mode <mode>` | Validate governed project wiring and optionally staged turn result | No |
| `migrate` | Convert a legacy v3 project to governed v4 format | No |

### Command Signatures

```text
agentxchain init --governed [--yes]
agentxchain status [--json]
agentxchain resume [--role <role>]
agentxchain step [--role <role>] [--resume] [--poll <seconds>] [--verbose] [--auto-reject]
agentxchain accept-turn
agentxchain reject-turn [--reason <reason>]
agentxchain approve-transition
agentxchain approve-completion
agentxchain validate [--mode kickoff|turn|full] [--agent <role>] [--json]
agentxchain migrate [--yes] [--json]
```

### Output Contract

The governed CLI has two output classes:

1. **Human-readable summaries**
   - Default mode for all commands
   - Must print the main state transition or failure clearly
   - Blocked states should render recovery information when derivable

2. **JSON output**
   - Supported by `status`, `validate`, and `migrate`
   - Intended for scripts and dashboards

Exit code contract:

- `0` for success
- `1` for command failure, invalid project mode, or validation failure

---

## Behavior

### 1. `init --governed`

Scaffolds a governed project with:

- `agentxchain.json` in governed format
- `.agentxchain/state.json` with `status = "idle"` and `run_id = null`
- `.agentxchain/history.jsonl`
- `.agentxchain/decision-ledger.jsonl`
- `.agentxchain/staging/`
- `.agentxchain/dispatch/`
- role prompt files under `.agentxchain/prompts/`

It does not start a run. The initial project remains unassigned until `resume` or `step`.

### 2. `status`

Behavior depends on protocol mode:

- legacy project: renders lock/state summary
- governed project: renders phase, run status, accepted integration ref, current turn, gate status, budget, and derived recovery descriptor when blocked

When `--json` is supplied, governed output includes:

- `version`
- `protocol_mode`
- `config`
- `state`

### 3. `resume`

`resume` is the assignment-only governed command. It does not wait for turn completion.

Implemented behavior:

- if `state.status === "idle"` and `run_id === null`, it initializes a new run
- if `state.status === "paused"` and there is no active failed turn, it reactivates the same run
- if `state.status === "paused"` and `current_turn.status` is `failed` or `retrying`, it re-dispatches that same turn instead of assigning a new one
- if `state.status === "active"` and `current_turn` exists, it refuses double assignment
- if `--role` is omitted, it uses `routing[state.phase].entry_role`
- if `--role` is outside `allowed_next_roles`, it warns but still allows the override
- after assignment or redispatch, it writes `.agentxchain/dispatch/current/`

### 4. `step`

`step` is the full governed single-turn operator command.

Implemented lifecycle:

1. Load governed project and state
2. Initialize or resume the run if needed
3. Assign or resume a turn
4. Write the dispatch bundle
5. Dispatch through the runtime adapter
6. Wait for staged output
7. Validate the staged turn result
8. Accept it, or optionally auto-reject on failure
9. Print the outcome and next recovery action

Runtime-specific behavior:

- `manual`: prints instructions and polls for `.agentxchain/staging/turn-result.json`
- `local_cli`: spawns a subprocess and optionally streams logs with `--verbose`
- `api_proxy`: performs synchronous API dispatch and stages the result before validation

`step --resume` reuses the currently active turn and rewrites the dispatch bundle instead of creating a new assignment.

### 5. `accept-turn`

Accepts the staged turn result by invoking the orchestrator write path:

- validates the staged JSON
- observes actual repo changes
- appends an accepted record to `.agentxchain/history.jsonl`
- appends accepted decisions to `.agentxchain/decision-ledger.jsonl`
- appends a prose section to `TALK.md`
- updates `.agentxchain/state.json`
- clears the staging file

It does not auto-assign the next turn.

### 6. `reject-turn`

Rejects the current turn result using either:

- validator failure details, or
- a human-supplied `--reason` when the staged result is otherwise valid

Implemented behavior:

- before retry exhaustion: keeps the same `turn_id`, increments `attempt`, rewrites the dispatch bundle, and leaves the run active
- at retry exhaustion: pauses the run, preserves the failed `current_turn`, and records escalation state

It does not append rejected turns to history or decision ledger.

### 7. `approve-transition`

Approves a paused pending phase transition. It only succeeds when:

- `state.pending_phase_transition` exists
- `state.status === "paused"`

On success it:

- advances `state.phase`
- clears `pending_phase_transition`
- clears the blocker
- marks the gate as passed
- leaves the run ready for `step`

### 8. `approve-completion`

Approves a paused pending run completion. It only succeeds when:

- `state.pending_run_completion` exists
- `state.status === "paused"`

On success it:

- sets `state.status = "completed"`
- sets `completed_at`
- clears `pending_run_completion`
- clears the blocker

### 9. `validate`

Supports three modes:

- `kickoff`
- `turn`
- `full`

For governed projects, `validate` checks:

- required governed files exist
- prompt paths in config exist
- gate-required files exist
- state phase and gate references are coherent with config
- history file can be parsed
- in `turn` mode, the staged turn result passes the five-stage validator

If the staged result is missing in `turn` mode, it warns instead of failing.

### 10. `migrate`

Converts a legacy v3 project into governed format.

Implemented behavior:

- backs up `agentxchain.json`
- archives legacy coordination artifacts under `.agentxchain/legacy/`
- rewrites config into governed format
- creates governed state/history/ledger files
- creates prompt templates
- sets post-migration status to `paused`
- records `blocked_on = "human:migration-review"`

No automatic backfill from legacy history into governed history is performed.

---

## Error Cases

- Any governed-only command fails on legacy projects with a mode-specific message.
- Any governed command fails when `agentxchain.json` cannot be found.
- `resume` fails when `state.json` is missing, malformed, or when an active turn already exists.
- `resume` fails on unknown `--role`.
- `step` fails when a governed project is completed, when no governed state exists, or when adapter dispatch fails without a recoverable staged result.
- `accept-turn` fails when no active turn exists or staged validation fails.
- `reject-turn` fails when no active turn exists.
- `reject-turn` refuses a valid staged result unless `--reason` is supplied.
- `approve-transition` fails when there is no pending transition or the run is not paused.
- `approve-completion` fails when there is no pending completion or the run is not paused.
- `validate` exits non-zero when validation errors exist.
- `migrate` fails for non-v3 configs, invalid configs, or unreadable `agentxchain.json`.

---

## Acceptance Tests

1. `agentxchain init --governed` creates `.agentxchain/state.json` with `status = "idle"` and no active turn.
2. `agentxchain status --json` on a governed project emits `protocol_mode = "governed"` plus a `state` object.
3. `agentxchain resume` on an idle governed project initializes a `run_id`, assigns exactly one turn, and writes `.agentxchain/dispatch/current/PROMPT.md`.
4. `agentxchain resume` refuses to assign a second turn when `state.current_turn` already exists.
5. `agentxchain resume --role <unknown>` exits non-zero and lists available roles.
6. `agentxchain step --resume` on an active turn rewrites the dispatch bundle for the retained turn instead of allocating a new `turn_id`.
7. `agentxchain accept-turn` with a valid staged result appends one accepted history entry and clears `current_turn`.
8. `agentxchain accept-turn` with a schema-invalid staged result exits non-zero and keeps the turn retained.
9. `agentxchain reject-turn` without `--reason` rejects only invalid staged results; a valid staged result requires operator rationale.
10. `agentxchain reject-turn --reason "..."` increments retry attempt before exhaustion and pauses with escalation after exhaustion.
11. `agentxchain approve-transition` advances the phase only from a paused pending-transition state.
12. `agentxchain approve-completion` marks the run completed only from a paused pending-completion state.
13. `agentxchain validate --mode turn` reports validator errors for a bad staged result and warns when no staged result exists.
14. `agentxchain migrate --yes` rewrites a v3 project into governed format and leaves it paused for human review.

---

## Open Questions

1. Should `resume` remain a public operator command in v1, or should `step` become the only primary path with `resume` treated as advanced recovery?
2. Should governed commands converge on a fully structured JSON output mode beyond `status`, `validate`, and `migrate` for automation use?
3. Should `approve-transition` and `approve-completion` become idempotent in v1.1 if the pending request has already been consumed?
