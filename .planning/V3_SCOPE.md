# V3 Scope — Continuous Governed Delivery And Agent-Native SDLC

> Defines the first v3 boundary after the v2.2 protocol-conformance surface.

---

## Purpose

v2 proved governed execution, trust hardening, multi-repo coordination, plugin packaging, and protocol conformance.

v3 is the next product step:

- move from manually started governed runs to a continuous governed delivery loop
- make repo-native planning, specs, evidence, and release artifacts first-class runtime inputs
- do this without collapsing human authority or turning `.dev` into hosted SaaS scope

The release question is not "more agent activity." It is:

**Can AgentXchain intake real software-delivery signals continuously, convert them into governed work, and keep an auditable backlog moving without inventing cloud-only dependencies?**

---

## Release Theme

**Continuous governed delivery for repo-native software teams.**

v3 adds a persistent intake-and-triage loop around the existing governed run engine. It does not replace the constitutional workflow. It feeds it.

---

## Interface

### Core Objects

#### Trigger Event

Stored under `.agentxchain/intake/events/<event_id>.json`.

```json
{
  "event_id": "evt_20260403_001",
  "source": "ci_failure",
  "category": "delivery_regression",
  "created_at": "2026-04-03T20:10:00Z",
  "repo": "agentXchain.dev",
  "ref": "refs/heads/main",
  "signal": {
    "workflow": "publish-npm-on-tag",
    "run_id": "23944719936",
    "status": "failed"
  },
  "evidence": [
    {
      "type": "url",
      "value": "https://github.com/shivamtiwari93/agentXchain.dev/actions/runs/23944719936"
    }
  ]
}
```

#### Delivery Intent

Stored under `.agentxchain/intake/intents/<intent_id>.json`.

```json
{
  "intent_id": "intent_20260403_001",
  "event_id": "evt_20260403_001",
  "status": "triaged",
  "priority": "p1",
  "template": "cli-tool",
  "charter": "Stabilize release proof contract for published artifacts.",
  "acceptance_contract": [
    "published tarball is executed by explicit path",
    "workflow proof is rerunnable",
    "docs match the release contract"
  ],
  "requires_human_start": true,
  "target_run": null,
  "created_at": "2026-04-03T20:15:00Z"
}
```

#### Continuous Loop State

Stored at `.agentxchain/intake/loop-state.json`.

```json
{
  "schema_version": "1.0",
  "mode": "active",
  "last_scan_at": "2026-04-03T20:15:00Z",
  "pending_events": 2,
  "pending_intents": 1,
  "active_runs": 1
}
```

### CLI Surface

The first v3 command family:

- `agentxchain intake record --file <event.json>`
- `agentxchain intake triage [--intent <id>]`
- `agentxchain intake approve --intent <id>`
- `agentxchain intake plan --intent <id>`
- `agentxchain intake status [--json]`
- `agentxchain intake scan --source <ci_failure|git_ref_change|schedule>`
- `agentxchain intake start --intent <id>`
- `agentxchain intake resolve --intent <id>`

These commands create and govern intake artifacts. They do not bypass the existing run engine.

### Template Contract Extension

Built-in templates gain an intake profile:

- `template`
- `required_planning_artifacts`
- `triage_checklist`
- `release_evidence_minimums`

This extends the template system already scoped in `.planning/SDLC_TEMPLATE_SYSTEM_SPEC.md`.

---

## State Machine

### Delivery Intent Lifecycle

**Shipped intake lifecycle:**

```text
detected -> triaged -> approved -> planned -> executing
detected -> suppressed
triaged -> rejected
executing -> blocked
blocked -> approved
executing -> completed
executing -> failed
```

**Deferred later-v3 direction:**

```text
completed -> awaiting_release_approval
awaiting_release_approval -> released
released -> observing
observing -> reopened
reopened -> planned
```

### State Rules

1. `detected` means the signal exists but has not been converted into governed work.
2. `triaged` means a delivery intent exists with priority, scope, template, and acceptance contract.
3. `approved` means a human or policy-authorized operator accepted that the intent may start a governed run.
4. `planned` means the planning artifacts for the selected template exist and the run is ready to initialize.
5. `executing` means an existing governed run owns implementation.
6. `blocked` means the active run cannot continue without recovery input; the intent may be re-approved after recovery work.
7. `completed` means the governed run completed successfully and the intake intent closes with recorded run evidence pointers.
8. `failed` means the governed run reached a non-recoverable failure and the intake intent closes as failed.
9. `awaiting_release_approval`, `released`, `observing`, and `reopened` remain deferred later-v3 concepts. They are not part of the shipped CLI truth.
10. `suppressed`, `rejected`, `completed`, and `failed` are terminal for the current intake surface.

---

## Trigger Contracts

### Supported Sources For v3.0

1. `manual`
   - human or agent creates a structured event file explicitly
2. `ci_failure`
   - failed GitHub Actions run or equivalent CI signal
3. `git_ref_change`
   - new tag, release branch movement, or protected-branch divergence
4. `schedule`
   - timed scans for stale release evidence, blocked runs, or unresolved intents

### Explicitly Deferred Sources

1. production metrics streams
2. PagerDuty / incident-management ingestion
3. ticketing-system bidirectional sync
4. cloud-managed webhook intake service

Those require infrastructure and governance decisions that do not belong in v3.0 `.dev`.

---

## Behavior

### 1. Intake Does Not Bypass Governance

The intake loop may create events and intents automatically. It may not start code-writing execution without an explicit approval transition.

### 2. Intent Creation Is Template-Aware

When an event becomes an intent, the system must select a template (`generic`, `cli-tool`, `api-service`, `library`, `web-app`). For unmapped signals, the safe fallback is `generic`. Template-specific planning artifact creation is now part of the shipped approval/planning slice.

### 3. Runs Remain The Execution Boundary

Continuous delivery does not introduce a second execution engine. Once an intent is approved and planned, the existing governed run model executes the work.

### 4. Observation Record Scaffolding Is Part Of The Contract

The shipped S5 slice does not implement a full `observing` state. It does establish the repo-native place where later observation evidence will live. When an intent resolves to `completed`, the CLI creates `.agentxchain/intake/observations/<intent_id>/` as an empty scaffold so future slices do not have to invent a second storage contract.

### 5. Evidence Must Stay Repo-Native

Trigger events, intents, and observation evidence live in repo files. No hosted control plane is required for the v3.0 `.dev` slice.

---

## Delivery Slices

### V3-S1 (shipped): Repo-Native Intake And Governed Triage

**Shipped scope:**

- intake artifact directories under `.agentxchain/intake/`
- `agentxchain intake record`
- `agentxchain intake triage`
- `agentxchain intake status`
- delivery-intent state machine for `detected -> triaged`, plus terminal `suppressed` / `rejected`

### V3-S2 (shipped): Approval And Planning Artifact Generation

**Shipped scope:**

- `agentxchain intake approve`
- `agentxchain intake plan`
- `triaged -> approved -> planned`
- governed-template-backed `.planning/` artifact generation
- atomic artifact-conflict rejection with `--force` override

### V3-S3 (shipped): Planned Intent To Governed Run Start

This slice is now shipped. It closes the obvious gap between backlog preparation and governed execution without inventing a second engine.

The implementation contract for this slice lives in `.planning/V3_S3_START_SPEC.md`.

**Shipped scope:**

- `agentxchain intake start --intent <id>`
- `planned -> executing` transition
- linkage from intake intent to governed `run_id` and first `turn_id`
- reuse of the existing governed run engine and dispatch bundle machinery
- deterministic rejection when the project is already busy, completed, blocked, or missing recorded planning artifacts
- deterministic rejection when the run is paused on approval-hold semantics

**Why this slice mattered:**

- It closes the gap between backlog preparation and governed execution.
- It makes `target_run` real instead of dead schema weight.
- It advances continuous governed delivery without smuggling in auto-execution from raw signals.

**Explicitly not in S3:**

- no background daemon that auto-starts intents from CI or schedule signals
- no multi-intent scheduler
- no post-completion run recycling
- no release approval automation
- no production or incident integrations

### V3-S4 (shipped): Deterministic Intake Scan

The smaller additive slice was `intake scan`, not run recycling.

Run recycling still reopens core governed-run identity, lifecycle closure, and protocol invariants. S4 stayed additive by doing one narrow job well: convert structured source snapshots into repo-native intake events through the existing `record` path.

The implementation contract for this slice lives in `.planning/V3_S4_SCAN_SPEC.md`.

**Shipped scope:**

- `agentxchain intake scan --source <ci_failure|git_ref_change|schedule>`
- deterministic extraction of candidate signals from file or stdin snapshots
- reuse of the existing intake event deduplication and intent-creation path
- structured scan results: scanned, created, deduplicated, rejected
- explicit exclusion of `manual`, which remains on `intake record`
- deterministic rejection for empty `items` arrays instead of fake no-op success

**Explicitly not in S4:**

- no live SaaS polling loop
- no background daemon
- no auto-triage, auto-approval, or auto-start
- no post-release reopen automation
- no run recycling

### V3-S5 (shipped): Execution Exit And Intent Closure Linkage

The next useful v3 boundary was not more ingestion mechanics. It was truthful lifecycle closure after `executing`.

The implementation contract for this slice lives in `.planning/V3_S5_INTENT_CLOSURE_SPEC.md`.

**Shipped scope:**

- `agentxchain intake resolve --intent <id>`
- deterministic linkage from governed run outcomes into intake intent updates
- shipped outcome mappings: `executing -> blocked`, `executing -> completed`, `executing -> failed`
- `blocked -> approved` re-approval through the existing `intake approve` command
- additive intent evidence fields that reference run outcome data instead of copying whole governed state
- repo-native observation directory scaffolding under `.agentxchain/intake/observations/<intent_id>/`
- `no_change: true` behavior for still-running `active` and approval-held `paused` governed runs

**Explicitly not in S5:**

- no post-completion run recycling
- no background polling loop
- no policy-driven auto-triage or auto-start
- no release-gate automation
- no observation evidence writer beyond the empty directory scaffold
- no hosted control plane

### After S5: Recommended Direction

The intake lifecycle is feature-complete for now. More intake automation is not the highest-value move.

If v3 intake work resumes later, the next honest slice is release or observation evidence behavior with its own standalone spec. Do not smuggle that work in through intake automation, run recycling, or hidden policy authority.

---

## What Is Explicitly Out Of Scope For v3.0

1. Hosted multi-tenant control plane
2. Managed adapter fleet
3. Automatic production hotfix generation from telemetry
4. Hook- or policy-driven bypass of constitutional human gates
5. Auto-merge or destructive rollback without explicit approval
6. Public certification or hosted conformance registry
7. Ticketing and incident SaaS connectors as core protocol requirements

---

## Error Cases

1. Duplicate event payload for the same external signal: must be deduplicated or linked, not create unbounded duplicate intents.
2. Intake event missing source-specific evidence: triage fails with a deterministic validation error.
3. Explicit template override invalid or missing template manifest: triage fails with a deterministic validation error.
4. `intake start` must reject any attempt to enter `executing` when recorded planning artifacts are missing on disk.
5. Observation signal for unknown released intent: creates a new `detected` event, not an orphaned reopen transition.

---

## Acceptance Tests

1. `AT-V3-INTAKE-001`: valid `manual` event records under `.agentxchain/intake/events/` and appears in `intake status`.
2. `AT-V3-INTAKE-002`: duplicate `ci_failure` event does not create a second active intent.
3. `AT-V3-INTAKE-003`: triage assigns priority, template, and acceptance contract before leaving `detected`.
4. `AT-V3-INTAKE-004`: `intake approve` records approver identity and transitions `triaged -> approved`.
5. `AT-V3-INTAKE-005`: `intake plan` generates template-backed planning artifacts and transitions `approved -> planned`.
6. `AT-V3-INTAKE-006`: `intake status --intent <id>` returns the linked source event plus intent history.
7. `AT-V3-INTAKE-007`: invalid source-specific payload is rejected with a deterministic error.
8. `AT-V3-INTAKE-008`: `intake status` writes `loop-state.json` as a cache without becoming the source of truth.
9. `AT-V3-INTAKE-009`: `intake start` sets `target_run`, `target_turn`, and transitions `planned -> executing` without waiting for turn completion.
10. `AT-V3-INTAKE-010`: `intake scan` records valid snapshot items through the existing deduplicating `record` path, excludes `manual`, and rejects empty `items` arrays.
11. `AT-V3-INTAKE-011`: `intake resolve` maps governed `blocked`, `completed`, and `failed` outcomes back onto the linked intent, returns `no_change` for `active` and `paused`, and creates `.agentxchain/intake/observations/<intent_id>/` on `completed`.

---

## Resolved Questions

1. `schedule` is a first-class event source in v3.0. It is valid input to the repo-native intake surface and to `intake scan`.
2. Observation evidence belongs in append-only child records under `.agentxchain/intake/observations/`, not by mutating historical intent records.
3. The fallback template is `generic`. Fail-closed template selection is rejected for unmapped signals because it would block safe intake without adding governance value.
4. S3 does not relax the governed paused-state contract. `paused` remains approval-held in current `.dev` scope, so intake start does not resume paused runs.
