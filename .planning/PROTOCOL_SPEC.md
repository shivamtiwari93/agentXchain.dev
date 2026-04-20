# AgentXchain Protocol Spec — v7 Core Boundary

> Durable protocol contract for runner authors and future non-reference implementations. This spec freezes the constitutional boundary of AgentXchain as it exists today; it does not promote every reference-runner feature into protocol scope.

---

## Purpose

Define the repo-native AgentXchain protocol boundary clearly enough that a third-party runner can implement it without copying the reference CLI wholesale.

This spec exists to pin down:

- the canonical artifacts a conforming runner must read and write
- the governed run and turn lifecycle the protocol requires
- the evidence, decision, and challenge rules that make the system governable
- the conformance boundary for protocol `v7`
- the workflow surfaces that are intentionally outside current protocol scope

This spec is normative for planning and conformance intent. If code and prose disagree, shipped code plus fixture-backed conformance behavior wins until this spec is updated.

## Interface

### Required Artifact Contract

A protocol-conforming repo owns its governed state under `.agentxchain/`.

Minimum required artifacts for protocol `v7`:

| Artifact | Role |
| --- | --- |
| `.agentxchain/state.json` | Authoritative run state, phase, current turn, blockers, approvals, and accepted integration ref |
| `.agentxchain/staging/<turn_id>/turn-result.json` | Agent-submitted turn result awaiting validation and acceptance |
| `.agentxchain/history.jsonl` | Accepted-turn ledger for the current and prior runs |
| `.agentxchain/decision-ledger.jsonl` | Durable decision and governance-event ledger |
| `.agentxchain/events.jsonl` | Run event lifecycle evidence |
| `.agentxchain/run-history.jsonl` | Terminal run history and inherited continuity context |
| `.agentxchain-conformance/capabilities.json` | Declared protocol version, surfaces, and adapter invocation contract |

### Required Runtime Roles

The protocol does not hardcode an org chart. Roles are open-ended chartered actors.

Protocol invariants:

- every role has a stable role id
- every turn is assigned to exactly one role
- every role operates within declared authority boundaries
- review-only roles must challenge, not silently approve

### Conformance Adapter Interface

Protocol `v7` conformance is fixture-driven.

Required adapter shapes:

- local adapter: `adapter.protocol = "stdio-fixture-v1"`
- remote adapter: `adapter.protocol = "http-fixture-v1"`

Required local adapter behavior:

1. read one fixture JSON document
2. materialize fixture state
3. execute the requested protocol operation
4. compare actual behavior against expected behavior
5. emit one JSON result with `status`, `message`, and `actual`

### Current Protocol-v7 Surface Claims

The current conformance surfaces are:

- `state_machine`
- `turn_result_validation`
- `gate_semantics`
- `decision_ledger`
- `history`
- `config_schema`
- `dispatch_manifest`
- `hook_audit`
- `coordinator`
- `delegation`
- `decision_carryover`
- `parallel_turns`
- `event_lifecycle`

### Explicitly Out Of Scope For v7

These reference-runner features are real product surfaces, but they are not required for protocol-v7 conformance today:

- mission hierarchy and mission plans under `.agentxchain/missions/`
- dashboard APIs, views, and browser UX
- export, report, and release operator surfaces
- website structure, docs layout, and marketing surfaces

## Behavior

### 1. Repo-Native Governance

The protocol is repo-native and runner-agnostic.

- runners enforce the protocol; they are not the protocol
- connectors are replaceable execution bridges, not constitutional state owners
- workflow artifacts live with the repo so another runner can continue from durable state

### 2. Governed Run Lifecycle

A governed run progresses through a finite state machine persisted in `state.json`.

Current run-level statuses:

- `idle`
- `active`
- `paused`
- `blocked`
- `completed`
- `failed` is reserved but not materially emitted in the current writer path

Protocol expectations:

- one active run has at most one current turn unless a declared parallel-turn surface is in play
- a turn remains recoverable until explicitly accepted, rejected, superseded, or archived
- paused or blocked states must retain enough evidence for explicit operator recovery
- continuation runs inherit context without contaminating current-run counters

### 3. Turn Contract

Every governed turn is a contract between orchestration and a chartered role.

Required fields on a valid staged result include:

- `run_id`
- `turn_id`
- `role`
- `runtime_id`
- `status`
- `summary`
- `decisions`
- `objections`
- `files_changed`
- `verification`
- `artifact`
- `proposed_next_role`

Protocol expectations:

- turn identity must match the assigned turn in `state.json`
- review-only roles must raise at least one objection
- routing proposals must still be legal for the active phase and workflow rules
- a result may request phase advance or run completion, but not both ambiguously

### 4. Challenge And Decision Requirements

The protocol treats disagreement as first-class governed evidence.

- accepted decisions become durable ledger entries
- objections are part of the protocol surface, not optional commentary
- decision carryover must survive across turns and continuation runs
- governance evidence must explain why a run is blocked, paused, retried, or escalated

### 5. Gate And Approval Semantics

Turn acceptance does not automatically mean phase advancement or completion.

Protocol expectations:

- gates evaluate accepted work against workflow-kit contracts
- human approval remains a distinct protocol state, not an implicit side effect
- queued versus pending approval objects must stay consistent with operator-visible status
- checkpoint and acceptance semantics must advance the current run's baseline, not a parent run's stale baseline

### 6. Event And History Truth

Protocol evidence is append-only by default.

- `history.jsonl` records accepted turn truth
- `decision-ledger.jsonl` records accepted decisions plus governance events
- `events.jsonl` records run lifecycle events such as assignment, blocking, escalation, and retained stalled turns
- `run-history.jsonl` records terminal run truth while keeping inherited continuity context under separate parent metadata

### 7. Conformance Boundary

Protocol `v7` is only real if another implementation can prove it against the shipped fixture corpus.

- Tier 1 covers constitutional behavior
- Tier 2 adds trust-hardening surfaces
- Tier 3 adds multi-repo coordination

A non-reference runner may truthfully claim protocol `v7` without implementing reference-runner workflow surfaces outside that fixture-backed boundary.

## Error Cases

- A runner writes governed state outside the declared artifact contract or mutates artifacts it does not own.
- A staged turn result passes schema shape but violates assignment truth (`run_id`, `turn_id`, `role`, or `runtime_id` drift).
- A result claims review-only behavior without objections.
- A runner advances phase or completion without satisfying the relevant gate or approval contract.
- A continuation run copies parent aggregates into current-run counters instead of preserving them as parent context.
- A runner claims protocol `v7` while omitting required conformance artifacts or emitting unsupported surface claims in `capabilities.json`.
- A connector-specific workflow surface is presented as constitutional protocol behavior without fixture-backed promotion.

## Acceptance Tests

1. `.planning/PROTOCOL_SPEC.md` exists and includes `Purpose`, `Interface`, `Behavior`, `Error Cases`, `Acceptance Tests`, and `Open Questions`.
2. The spec names the required repo-native artifacts: `state.json`, `turn-result.json`, `history.jsonl`, `decision-ledger.jsonl`, `events.jsonl`, `run-history.jsonl`, and `.agentxchain-conformance/capabilities.json`.
3. The spec states that roles are open-ended chartered actors and that review-only roles must challenge.
4. The spec freezes the current protocol-v7 surface claims and distinguishes them from out-of-scope reference-runner workflow features such as missions, dashboard, export, report, and release UX.
5. The spec states that runners enforce the protocol, connectors are replaceable, and conformance is fixture-backed rather than CLI-shape-backed.

## Open Questions

1. Should a future protocol-v8 cut promote any workflow-kit surfaces, or should those remain reference-runner-only until fixture-backed independently?
2. Should the constitutional protocol eventually standardize a richer multi-turn or parallel-turn assignment model beyond the current current-turn-centric state envelope?
3. Should mission-plan and dashboard surfaces remain permanently outside protocol scope, or become optional higher-tier conformance surfaces later?
