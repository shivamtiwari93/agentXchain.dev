# Run Provenance & Dependency — Repo-Local Spec

> Status: **Shipped** — Slice 1 (Turn 22) + Slice 2 lineage/flags (Turn 23) + terminal-state bootstrap correction (Turn 24)
> Author: Claude Opus 4.6
> Scope: Repo-local governed runs only

---

## Purpose

Give operators and downstream tooling a machine-readable answer to: "Why did this run start, and what prior run (if any) produced the context it consumed?"

Today each governed run is an island. `run-history.jsonl` records *what happened* in each run, but nothing links run B back to run A — even when the operator explicitly started run B to continue or recover from run A's output. The coordinator layer solves this for *cross-repo* orchestration via `super_run_id`, barriers, and workstream `depends_on`. This spec addresses the *repo-local* gap only.

---

## Explicit Scope Boundary

### In Scope

- Optional provenance metadata recorded when a repo-local governed run is initialized
- Provenance fields on the run state object (`state.json`)
- Provenance fields on the run-history ledger entry (`run-history.jsonl`)
- Provenance fields on the export object (`export.json`)
- CLI surface to query run lineage within a single repo
- Report rendering of provenance when present

### Out of Scope — Do Not Duplicate

| Existing machinery | Owner | Why excluded |
|---|---|---|
| `super_run_id` | Coordinator (`coordinator-state.js`) | Cross-repo identity; repo-local runs must not generate or claim super_run_ids |
| Workstream `depends_on` / barriers | Coordinator (`coordinator-barriers.js`) | Cross-repo dependency ordering; no repo-local equivalent needed |
| Intake handoff | `intake-handoff.js` | Intent-to-coordinator binding; provenance is complementary, not overlapping |
| Automatic downstream run launching | — | Not proposed; provenance is metadata, not orchestration |

The boundary rule: **provenance is observability. It records relationships. It does not create, enforce, or orchestrate them.**

---

## Interface

### New Fields on Run State (`state.json`)

```jsonc
{
  // ... existing fields ...
  "provenance": {                          // Optional. Null/absent if not supplied.
    "trigger": "manual | continuation | recovery | intake | schedule | coordinator",
    "parent_run_id": "run_abc123",         // Optional. The repo-local run that preceded this one.
    "trigger_reason": "Continuing from blocked planning phase",  // Optional. Human/agent-readable.
    "intake_intent_id": "intent_xyz",      // Optional. Set when trigger=intake.
    "created_by": "operator | coordinator" // Who initialized this run.
  }
}
```

### New Fields on Run-History Entry (`run-history.jsonl`)

```jsonc
{
  // ... existing fields (run_id, status, phases_completed, ...) ...
  "provenance": {
    "trigger": "manual | continuation | recovery | intake | schedule | coordinator",
    "parent_run_id": null,
    "intake_intent_id": null,
    "created_by": "operator"
  }
}
```

### New Fields on Export Summary

```jsonc
{
  "summary": {
    // ... existing fields ...
    "provenance": { /* same shape as above */ }
  }
}
```

### CLI: `agentxchain run` — New Optional Flags

```
--continue-from <run_id>    Set trigger=continuation, parent_run_id=<run_id>
--recover-from <run_id>     Set trigger=recovery, parent_run_id=<run_id>
```

When either flag is supplied:
1. Validate that `<run_id>` exists in `run-history.jsonl` (fail with clear error if not)
2. Validate that the referenced run's status is terminal (`completed` or `blocked`) — cannot chain from an active run
3. If the repo's current `state.json` is terminal, bootstrap a fresh run envelope before initialization instead of reusing the terminal run
4. Populate `provenance` on the new run's state

When neither flag is supplied and the run is started manually: `trigger=manual`, `parent_run_id=null`.

If the repo's current `state.json` is `completed`, plain `agentxchain run` starts a fresh manual run. If the repo's current `state.json` is `blocked`, `agentxchain run` must NOT silently discard the blocked run; operators either recover the existing run with `resume` or explicitly start a new run with `--continue-from` / `--recover-from`.

When the coordinator dispatches a repo-local run: `trigger=coordinator`, `created_by=coordinator`. The coordinator sets this; repo-local code does not.

When intake resolves to a run: `trigger=intake`, `intake_intent_id=<id>`.

### CLI: `agentxchain history` — Lineage View

```
agentxchain history --lineage <run_id>
```

Walks `parent_run_id` backwards through `run-history.jsonl` and prints the chain:

```
Run Lineage for run_def456:
  run_abc123  completed  planning,impl     12 turns  $0.42  (manual)
  └─ run_def456  blocked  qa              8 turns   $0.18  (continuation from run_abc123)
```

`--json` flag emits the chain as a JSON array.

---

## Behavior

### Initialization

`initializeGovernedRun()` in `governed-state.js` gains an optional `provenance` parameter:

```javascript
async function initializeGovernedRun(root, config, { provenance } = {}) {
  // ... existing initialization ...
  state.provenance = provenance || {
    trigger: 'manual',
    parent_run_id: null,
    intake_intent_id: null,
    created_by: 'operator'
  };
  // ... write state ...
}
```

### Terminal-State Bootstrap

`runLoop()` must not treat a terminal on-disk run as the run it should keep driving when the operator has explicitly requested a new run:

- `completed` + plain `agentxchain run` → bootstrap a fresh manual run
- `completed` + `--continue-from <run_id>` / `--recover-from <run_id>` → bootstrap a fresh provenance-linked run
- `blocked` + `--continue-from <run_id>` / `--recover-from <run_id>` → bootstrap a fresh provenance-linked run
- `blocked` + plain `agentxchain run` → do **not** discard the blocked run implicitly; keep the run blocked and require explicit recovery or a provenance flag

Fresh bootstrap resets run-local execution state (`run_id`, phase progress, active turns, budget counters, gate queues, blocked metadata) while preserving repo identity (`project_id`) and config-defined initial phase/gate structure.

### Recording

`recordRunHistory()` in `run-history.js` copies `state.provenance` into the history entry. No transformation — the provenance object is passed through as-is.

### Export

`buildRunExport()` in `export.js` includes `state.provenance` in `summary.provenance`. No new files are added to the export root list.

### Report

`buildGovernanceReport()` in `report.js` renders provenance in the run summary section:

```
Provenance: continuation from run_abc123 ("Continuing from blocked planning phase")
```

If provenance is absent or trigger is `manual` with no parent, the report omits the provenance line (no noise for simple runs).

### Lineage Query

`queryRunLineage(root, runId)` in `run-history.js`:

1. Load all entries from `run-history.jsonl`
2. Find the entry matching `runId`
3. Walk `provenance.parent_run_id` backwards, collecting entries
4. Return the chain as an ordered array (oldest ancestor first)
5. If a `parent_run_id` references a run not found in history, terminate the chain and include a `{ broken_link: true, missing_run_id: '...' }` sentinel

### Validation Rules

- `parent_run_id`, if present, must match a terminal entry in `run-history.jsonl` at initialization time
- `trigger` must be one of the enumerated values; unknown values are rejected
- `intake_intent_id`, if present, must be non-empty string (existence validation of the intent is intake's responsibility, not provenance's)
- Circular references are structurally impossible: a run can only reference a *terminal* prior run, and run_ids are unique timestamps

---

## Error Cases

| Condition | Behavior |
|---|---|
| `--continue-from` references a non-existent run_id | Exit with error: `Run <id> not found in run history` |
| `--continue-from` references an active (non-terminal) run | Exit with error: `Run <id> is still active (status: <status>). Cannot chain from a non-terminal run.` |
| `--continue-from` and `--recover-from` both supplied | Exit with error: `Cannot specify both --continue-from and --recover-from` |
| `provenance.trigger` is not a recognized enum value | `initializeGovernedRun` throws validation error |
| History file missing when `--lineage` is used | Exit with error: `No run history found. Run at least one governed run first.` |
| Lineage walk hits a missing parent | Chain terminates with `broken_link` sentinel; no error |

---

## Acceptance Tests

### AT-1: Manual run has default provenance
```
Given: a fresh governed project
When: `agentxchain run` completes
Then: `state.json` has `provenance.trigger === 'manual'` and `provenance.parent_run_id === null`
And: the `run-history.jsonl` entry includes the same provenance
```

### AT-2: Continuation sets parent_run_id
```
Given: a completed run with run_id=R1 in run-history.jsonl
And: the repo's current `state.json` is terminal for R1
When: `agentxchain run --continue-from R1`
Then: a fresh run is initialized with a new run_id
And: new run state has `provenance.trigger === 'continuation'` and `provenance.parent_run_id === 'R1'`
And: run-history entry for the new run carries the same provenance
```

### AT-3: Recovery sets trigger=recovery
```
Given: a blocked run with run_id=R1 in run-history.jsonl
And: the repo's current `state.json` is blocked for R1
When: `agentxchain run --recover-from R1`
Then: a fresh run is initialized with a new run_id
And: new run state has `provenance.trigger === 'recovery'` and `provenance.parent_run_id === 'R1'`
```

### AT-3b: Plain run after completion starts a fresh manual run
```
Given: a completed run with run_id=R1 in state.json
When: `agentxchain run`
Then: a fresh run is initialized with a new run_id
And: new run state has `provenance.trigger === 'manual'`
And: the old completed run is not reused as the active run
```

### AT-4: Non-existent parent rejected
```
Given: no run with id=FAKE in history
When: `agentxchain run --continue-from FAKE`
Then: process exits with non-zero code and error message containing 'not found'
```

### AT-5: Active parent rejected
```
Given: an active run with id=R1 (not in run-history because it hasn't terminated)
When: `agentxchain run --continue-from R1`
Then: process exits with non-zero code and error message containing 'still active'
```

### AT-6: Both flags rejected
```
When: `agentxchain run --continue-from R1 --recover-from R2`
Then: process exits with non-zero code and error message containing 'Cannot specify both'
```

### AT-7: Lineage walk
```
Given: R1 (manual) → R2 (continuation from R1) → R3 (recovery from R2)
When: `agentxchain history --lineage R3 --json`
Then: output is a JSON array of 3 entries in order [R1, R2, R3]
And: R1 has no parent, R2.provenance.parent_run_id === R1.run_id, R3.provenance.parent_run_id === R2.run_id
```

### AT-8: Export includes provenance
```
Given: a completed run with provenance
When: `agentxchain export` is generated
Then: `summary.provenance` matches the state's provenance object
```

### AT-9: Report renders provenance for non-trivial triggers
```
Given: an export with trigger=continuation and parent_run_id=R1
When: `agentxchain report` is generated
Then: report text contains 'continuation from R1'
```

### AT-10: Report omits provenance for plain manual runs
```
Given: an export with trigger=manual and parent_run_id=null
When: `agentxchain report` is generated
Then: report text does NOT contain 'Provenance:'
```

---

## Resolved Questions

1. **`--continue-from` does not copy the prior run's final phase.** Keep provenance metadata separate from control flow. A “resume at prior phase” feature would be a different product slice with its own routing, gate, and retained-turn semantics; smuggling it into provenance would blur the boundary and create false operator expectations.

2. **Coordinator-dispatched runs do not auto-link `parent_run_id` to prior coordinator-dispatched runs in the same repo.** Repo-local provenance must not guess at coordinator sequencing. The coordinator may set explicit provenance when it has a truthful parent, but repo-local code must not infer lineage from “previous repo run” and present that as protocol truth.

3. **`agentxchain history` should show a `Trigger` column by default, with a truthful legacy fallback.** New runs should record provenance. Older runs that predate the field must render `legacy`, not `manual`, because missing metadata is not the same thing as a manual origin.

4. **The trigger enum remains closed, but it must include `coordinator`.** The Turn 21 draft used `trigger=coordinator` in behavior while omitting it from the enum. That is a spec defect, not an implementation detail.

5. **Lineage stays flat in state and is computed from `run-history.jsonl`.** No nested parent chains on state. The current shape is the right one.
