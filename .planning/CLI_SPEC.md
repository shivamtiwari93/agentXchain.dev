# CLI Specification — Governed v1.1

> Command reference for the implemented governed operator workflow. This spec is descriptive: it documents what the CLI does today, including the v1.1 parallel-turn and blocked-state surfaces.

---

## Purpose

Define the governed command surface that operators use to initialize runs, assign work, dispatch turns, validate staged results, accept or reject turns, recover blocked or conflicted turns, and approve gated transitions. The goal is to keep command semantics, failure cases, and operator recovery paths testable and aligned with the current implementation.

This spec covers the governed command path only. Legacy v3 commands such as `start`, `watch`, `claim`, and `release` remain supported in the product, but they are out of scope for this governed contract.

---

## Interface/Schema

### Binary

```text
agentxchain <command> [options]
```

### Governed Commands

| Command | Purpose | Governed-only |
|---|---|---|
| `init --governed [--template <id>]` | Scaffold governed project files and initial idle state | No |
| `status` | Show governed state, active turns, blockers, and recovery information | No |
| `resume` | Initialize/resume a run and assign the next turn, or re-dispatch a retained failed/retrying turn | Yes |
| `step` | Run one full governed turn lifecycle or resume a targeted active/retained turn | Yes |
| `accept-turn` | Accept a staged turn result, including targeted and `human_merge` conflict paths | Yes |
| `reject-turn --reason <reason>` | Reject a staged turn result, retry it, or escalate it | Yes |
| `approve-transition` | Approve a pending phase transition | Yes |
| `approve-completion` | Approve a pending run completion | Yes |
| `validate --mode <mode>` | Validate governed project wiring, template binding, and optionally staged turn result | No |
| `migrate` | Convert a legacy v3 project to governed format | No |

### Command Signatures

```text
agentxchain init --governed [--template <id>] [--yes]
agentxchain status [--json]
agentxchain template validate [--json]
agentxchain resume [--role <role>] [--turn <id>]
agentxchain step [--role <role>] [--resume] [--turn <id>] [--poll <seconds>] [--verbose] [--auto-reject]
agentxchain accept-turn [--turn <id>] [--resolution <standard|human_merge>]
agentxchain reject-turn [--turn <id>] [--reason <reason>] [--reassign]
agentxchain approve-transition
agentxchain approve-completion
agentxchain validate [--mode kickoff|turn|full] [--agent <role>] [--json]
agentxchain migrate [--yes] [--json]
```

### Governed Artifact Paths

The governed CLI now uses turn-scoped dispatch and staging paths even in the default sequential case:

- dispatch bundle: `.agentxchain/dispatch/turns/<turn_id>/`
- staged result: `.agentxchain/staging/<turn_id>/turn-result.json`
- dispatch manifest: `.agentxchain/dispatch/index.json`

### Output Contract

The governed CLI has two output classes:

1. **Human-readable summaries**
   - Default mode for all commands
   - Must print the main state transition or failure clearly
   - Blocked and conflicted states should render recovery information when derivable

2. **JSON output**
   - Supported by `status`, `validate`, and `migrate`
   - Intended for scripts and dashboards

Exit code contract:

- `0` for success
- `1` for command failure, invalid project mode, or validation failure

---

## Behavior

### 1. `init --governed [--template <id>]`

Scaffolds a governed project with:

- `agentxchain.json` in governed format, including `"template": "<id>"` (defaults to `"generic"`; built-ins currently include `api-service`, `cli-tool`, `library`, and `web-app`)
- `.agentxchain/state.json` with `schema_version = "1.1"`, `status = "idle"`, `run_id = null`, `active_turns = {}`, and `turn_sequence = 0`
- `.agentxchain/history.jsonl`
- `.agentxchain/decision-ledger.jsonl`
- `.agentxchain/staging/`
- `.agentxchain/dispatch/`
- role prompt files under `.agentxchain/prompts/`
- template-specific planning artifacts under `.planning/` (when `--template` specifies a non-generic template)

When `--template` is omitted, the scaffold is identical to the current behavior (implicitly `generic`). Unknown template IDs fail with exit code 1 and list available templates. See [TEMPLATE_INIT_IMPL_SPEC.md](./TEMPLATE_INIT_IMPL_SPEC.md) for the full implementation contract.

It does not start a run. The initial project remains unassigned until `resume` or `step`.

### 1a. `template validate`

```bash
agentxchain template validate [--json]
```

Validates the built-in governed template registry and, when run inside a repo, the current project's configured `template` binding.

Implemented behavior:

- verifies every registered built-in template manifest exists and passes manifest schema validation
- fails if a manifest JSON file exists on disk but is not registered in the built-in allowlist
- treats a missing project `template` field as implicit `generic`
- fails if the current project's configured `template` is unknown to the installed CLI
- supports `--json` for scriptable proof output

### 2. `status`

Behavior depends on protocol mode:

- legacy project: renders lock/state summary
- governed project: renders phase, run status, accepted integration ref, active turn set, queued drain requests, budget reservations, gate status, and derived recovery descriptor when blocked

When `--json` is supplied, governed output includes:

- `version`
- `protocol_mode`
- `template`
- `config`
- `state`

Implemented governed status behavior:

- Human-readable `status` renders `Template: <id>` between protocol and phase.
- `status --json` emits top-level `template` as a convenience accessor and preserves `config.template` in the normalized config dump.
- `status` does not list template-specific planning artifact filenames in v1; the template ID is the scaffold-intent signal, while actual file presence belongs to `validate` or direct repo inspection.
- When multiple active turns exist, `status` renders each `turn_id`, role, status, and attempt count.
- Conflicted turns render both operator recovery commands:
  - `agentxchain reject-turn --turn <id> --reassign`
  - `agentxchain accept-turn --turn <id> --resolution human_merge`
- Queued phase-transition and run-completion requests render as drain-time waiting state.
- Persisted `blocked` states render `BLOCKED` plus `blocked_reason`-derived recovery guidance.

### 3. `resume`

`resume` is the assignment-only governed command. It does not wait for turn completion.

Implemented behavior:

- if `state.status === "idle"` and `run_id === null`, it initializes a new run
- if `state.status === "paused"` and there is no retained turn, it reactivates the same run and assigns a new turn
- if `state.status === "paused"` and a retained turn has status `failed` or `retrying`, it re-dispatches that same turn instead of assigning a new one
- if multiple retained paused turns exist, `resume --turn <id>` is required to re-dispatch one of them
- if `state.status === "active"` and any active turns exist, it refuses new assignment and instructs the operator to use `step --resume`, `accept-turn`, or `reject-turn`
- if `--role` is omitted, it uses `routing[state.phase].entry_role`
- if `--role` is outside `allowed_next_roles`, it warns but still allows the override
- after assignment or redispatch, it writes the targeted turn bundle under `.agentxchain/dispatch/turns/<turn_id>/`

`resume` is intentionally narrower than `step --resume`: it does not clear a blocked retained-turn state and does not wait on adapters.

### 4. `step`

`step` is the full governed operator command. It still executes one turn lifecycle per invocation, but in v1.1 it can either assign a new turn or target an existing one.

Implemented lifecycle:

1. Load governed project and state
2. Initialize or resume the run if needed
3. Assign a new turn or target a retained/active turn
4. Write the dispatch bundle
5. Dispatch through the runtime adapter
6. Wait for staged output
7. Validate the staged turn result
8. Accept it, or optionally auto-reject on failure
9. Print the outcome and next recovery action

Runtime-specific behavior:

- `manual`: prints instructions and polls for the targeted staged result path
- `local_cli`: spawns a subprocess and optionally streams logs with `--verbose`
- `api_proxy`: performs synchronous API dispatch and stages the result before validation

Implemented v1.1 extensions:

- When the run is `active` and under `max_concurrent_turns`, `step` may assign another turn instead of blocking on the existing one.
- `step --resume` targets an existing active turn and rewrites its dispatch bundle instead of creating a new assignment.
- If multiple active turns exist, `step --resume` fails unless `--turn <id>` is supplied.
- If the targeted turn is `conflicted`, `step --resume` fails fast and prints the two recovery commands instead of silently continuing.
- If the run is `blocked` with a retained turn, `step --resume [--turn <id>]` is the primary recovery path. It clears the blocked state, rewrites the targeted bundle, and re-dispatches that turn.
- If the run is `blocked` with no retained turn, plain `step` clears the blocked state and proceeds with assignment.
- If the run is `paused` for approval (`pending_phase_transition` or `pending_run_completion`), `step` refuses to continue and points the operator to the approval command.

### 5. `accept-turn`

Accepts the staged turn result by invoking the orchestrator write path:

- validates the staged JSON
- observes actual repo changes
- appends an accepted record to `.agentxchain/history.jsonl`
- appends accepted decisions to `.agentxchain/decision-ledger.jsonl`
- appends a prose section to `TALK.md`
- updates `.agentxchain/state.json`
- clears the targeted staging file

Implemented v1.1 acceptance behavior:

- `accept-turn --turn <id>` targets a specific active turn when multiple turns exist.
- If multiple active turns exist and `--turn` is omitted, the command fails with turn-targeting guidance.
- `accept-turn --resolution human_merge` is only valid for conflicted turns and re-runs the normal acceptance pipeline after the operator has manually resolved the workspace.
- Acceptance conflicts do not write history. They persist `conflict_state` on the targeted turn and surface recovery commands instead.
- Acceptance is serialized by an acceptance lock; a held lock surfaces a retryable CLI error with stale-lock guidance.

`accept-turn` does not auto-assign the next turn.

### 6. `reject-turn`

Rejects the current turn result using either:

- validator failure details, or
- a human-supplied `--reason` when the staged result is otherwise valid

Implemented behavior:

- `reject-turn --turn <id>` targets a specific active turn when multiple turns exist
- when multiple active turns exist and `--turn` is omitted, the command fails with targeting guidance
- before retry exhaustion: keeps the same `turn_id`, increments `attempt`, rewrites the dispatch bundle, and leaves the run active
- for conflicted turns, `--reassign` is the conflict-specific convenience path: it keeps the same `turn_id`, increments `attempt`, clears `conflict_state`, preserves structured `conflict_context`, and immediately rewrites the redispatch bundle
- `--reassign` is rejected unless the targeted turn has persisted `conflict_state`
- if the staged result is otherwise valid and the turn is not conflicted, the operator must provide `--reason`
- at retry exhaustion: blocks the run, preserves the failed turn, and records structured escalation and recovery state

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

- built-in template registry integrity and current project template binding
- required governed files exist
- prompt paths in config exist
- gate-required files exist
- state phase and gate references are coherent with config
- history file can be parsed
- in `turn` mode, the targeted staged turn result passes the five-stage validator

If the staged result is missing in `turn` mode, it warns instead of failing.

### 10. `migrate`

Converts a legacy v3 project into governed format.

Implemented behavior:

- backs up `agentxchain.json`
- archives legacy coordination artifacts under `.agentxchain/legacy/`
- rewrites config into governed format
- writes `"template": "generic"` to the migrated config without guessing project shape
- creates governed state, history, and ledger files
- creates prompt templates
- writes a governed state file with `schema_version = "1.1"` and `active_turns = {}`
- sets post-migration status to `paused`
- records `blocked_on = "human:migration-review"`

No automatic backfill from legacy history into governed history is performed.

---

## Error Cases

- Any governed-only command fails on legacy projects with a mode-specific message.
- Any governed command fails when `agentxchain.json` cannot be found.
- `resume` fails when `state.json` is missing, malformed, when any active turns already exist, or when multiple retained paused turns exist and `--turn` is omitted.
- `resume` fails on unknown `--role`.
- `step --resume` fails when multiple active or retained turns exist and `--turn` is omitted.
- `step --resume` fails on conflicted turns and prints recovery commands instead of dispatching blindly.
- `step` fails when a governed project is completed, when no governed state exists, or when adapter dispatch fails without a recoverable staged result.
- `accept-turn` fails when no active turn exists, when multiple active turns exist and `--turn` is omitted, or when staged validation fails.
- `accept-turn --resolution human_merge` fails when the targeted turn is not conflicted.
- `reject-turn` fails when no active turn exists or when multiple active turns exist and `--turn` is omitted.
- `reject-turn` refuses a valid staged result unless `--reason` is supplied.
- `reject-turn --reassign` fails unless the targeted turn has persisted `conflict_state`.
- `approve-transition` fails when there is no pending transition or the run is not paused.
- `approve-completion` fails when there is no pending completion or the run is not paused.
- `validate` exits non-zero when validation errors exist.
- `migrate` fails for non-v3 configs, invalid configs, or unreadable `agentxchain.json`.

---

## Acceptance Tests

1. `agentxchain init --governed` creates `.agentxchain/state.json` with `schema_version = "1.1"`, `status = "idle"`, and `active_turns = {}`, and writes `"template": "generic"` to `agentxchain.json`.
2. `agentxchain status --json` on a governed project emits `protocol_mode = "governed"`, top-level `template`, and a `state` object.
3. `agentxchain resume` on an idle governed project initializes a `run_id`, assigns exactly one turn, and writes `.agentxchain/dispatch/turns/<turn_id>/PROMPT.md`.
4. `agentxchain resume` refuses to assign a new turn when any active turns already exist.
5. `agentxchain resume --role <unknown>` exits non-zero and lists available roles.
6. `agentxchain step --resume` on an active turn rewrites the dispatch bundle for the retained turn instead of allocating a new `turn_id`.
7. `agentxchain step --resume` fails with guidance when multiple active turns exist and `--turn` is omitted.
8. `agentxchain accept-turn --turn <id>` accepts exactly the targeted turn when multiple turns are active.
9. `agentxchain reject-turn --turn <id> --reassign` re-dispatches a conflicted turn with preserved `turn_id` and incremented `attempt`.
10. `agentxchain accept-turn` with a schema-invalid staged result exits non-zero and keeps the targeted turn retained.
11. `agentxchain status` renders queued drain requests, budget reservations, and blocked recovery guidance when present.
12. `agentxchain approve-transition` advances the phase only from a paused pending-transition state.
13. `agentxchain approve-completion` marks the run completed only from a paused pending-completion state.
14. `agentxchain validate --mode turn` reports validator errors for a bad staged result and warns when no staged result exists.
15. `agentxchain migrate --yes` rewrites a v3 project into governed format, writes `"template": "generic"` without inferring a non-generic template, and leaves it paused for human review.

---

## Open Questions

1. Should `resume` gain a blocked-turn recovery mode for symmetry with `step --resume`, or should retained-turn recovery stay intentionally centralized in `step`?
2. Should the operator-facing help and error text stop referring to governed mode as `v4` now that the protocol docs and state schema are frozen as v1.1?
