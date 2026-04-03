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
- `agentxchain intake scan --source <manual|ci|git|schedule>`
- `agentxchain intake triage [--intent <id>]`
- `agentxchain intake status [--json]`
- `agentxchain intake start --intent <id>`

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

```text
detected
  -> triaged
  -> approved
  -> planned
  -> executing
  -> awaiting_release_approval
  -> released
  -> observing
  -> closed

detected -> suppressed
triaged -> rejected
executing -> blocked
blocked -> approved
observing -> reopened
reopened -> planned
```

### State Rules

1. `detected` means the signal exists but has not been converted into governed work.
2. `triaged` means a delivery intent exists with priority, scope, template, and acceptance contract.
3. `approved` means a human or policy-authorized operator accepted that the intent may start a governed run.
4. `planned` means the planning artifacts for the selected template exist and the run is ready to initialize.
5. `executing` means an existing governed run owns implementation.
6. `awaiting_release_approval` means QA requested ship or deployment approval.
7. `released` means the governed change reached its target delivery surface.
8. `observing` means the system is collecting post-release evidence and can reopen if regressions appear.
9. `blocked` means the active run cannot continue without recovery input.
10. `suppressed` and `rejected` are terminal for the current intent.

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

When an event becomes an intent, the system must select a template (`generic`, `cli-tool`, `api-service`, `web-app`). For unmapped signals, the safe fallback is `generic`. Template-specific planning artifact creation is part of the approval/planning slice, not the currently shipped intake commands.

### 3. Runs Remain The Execution Boundary

Continuous delivery does not introduce a second execution engine. Once an intent is approved and planned, the existing governed run model executes the work.

### 4. Post-Release Observation Is Part Of The Contract

`released` is not terminal. v3 adds an `observing` state so regression signals can reopen the same intent lineage instead of creating disconnected follow-up work.

### 5. Evidence Must Stay Repo-Native

Trigger events, intents, and observation evidence live in repo files. No hosted control plane is required for the v3.0 `.dev` slice.

---

## First Implementable Slice

### V3-S1: Repo-Native Intake And Governed Triage

This is the first slice worth building. Anything more ambitious first is sloppy.

**In scope:**

- intake artifact directories under `.agentxchain/intake/`
- `agentxchain intake record`
- `agentxchain intake triage`
- `agentxchain intake status`
- delivery-intent state machine for `detected -> triaged`, plus terminal `suppressed` / `rejected`
- acceptance tests for event ingestion, duplicate suppression, invalid source rejection, and triage-state transitions

**Why this slice first:**

- It creates the continuous loop entrypoint without pretending observability or auto-release already exist.
- It reuses the current governed runner instead of inventing parallel orchestration.
- It directly advances the agent-native SDLC vision by making backlog generation and planning a governed, testable surface.

**Not in slice 1:**

- no approval or planning transition command yet
- no template-artifact generation yet
- no automatic run start from CI signals
- no automated release approval
- no production or incident integrations
- no background daemon that mutates repos continuously

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
4. Future approval/planning slice must reject any attempt to enter `planned` without generated planning artifacts.
5. Observation signal for unknown released intent: creates a new `detected` event, not an orphaned reopen transition.

---

## Acceptance Tests

1. `AT-V3-INTAKE-001`: valid `manual` event records under `.agentxchain/intake/events/` and appears in `intake status`.
2. `AT-V3-INTAKE-002`: duplicate `ci_failure` event does not create a second active intent.
3. `AT-V3-INTAKE-003`: triage assigns priority, template, and acceptance contract before leaving `detected`.
4. `AT-V3-INTAKE-004`: `intake status --intent <id>` returns the linked source event plus intent history.
5. `AT-V3-INTAKE-005`: invalid source-specific payload is rejected with a deterministic error.
6. `AT-V3-INTAKE-006`: `intake status` writes `loop-state.json` as a cache without becoming the source of truth.

---

## Resolved Questions

1. `schedule` is a first-class event source in v3.0. It is valid input to the repo-native intake surface even before `intake scan` exists.
2. Observation evidence belongs in append-only child records under `.agentxchain/intake/observations/`, not by mutating historical intent records.
3. The fallback template is `generic`. Fail-closed template selection is rejected for unmapped signals because it would block safe intake without adding governance value.
