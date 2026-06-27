# System Spec — M15: Govern Without Micromanaging — Human Attention Surface — Vision Closure (VISION.md:51)

**Run:** `run_2929265fcbabe440`
**Turn:** `turn_fd0c9ed117cd5d23`
**Baseline:** git:b8a92de3a (HEAD of dogfood/2157-lights-out)
**Implementation status:** NOT yet built. This is a new build milestone — a `human-attention.js` composition module + `agentxchain attention` CLI command + report integration + regression tests.

## Purpose

This run delivers ROADMAP.md M15: "Govern Without Micromanaging — Human Attention Surface — Vision Closure (VISION.md:51)."

VISION.md line 51 names the final unaddressed coordination failure from the "Why This Must Exist" section: **"humans lose the ability to govern without micromanaging."** The "Human Role" section (VISION.md:199–220) requires that humans retain five specific rights — set direction, define boundaries, **approve critical transitions**, **intervene during escalation**, and **decide what ships** — while *not* needing to "micromanage every step," and the vision demands "lights-out operation without requiring blind trust" (VISION.md:220).

Today the triggers that legitimately require a human are real but scattered across surfaces: the `status` command shows only the *current* run's escalation and pending intents; the dashboard (M6) shows *everything* live (the opposite of exception-based); `supervise` drives the orchestration loop. There is no single command that answers, across all runs, **"what needs MY attention right now — and nothing else?"** Without it, a human governing a lights-out factory must poll many surfaces (micromanage) or trust blindly.

M15 closes this with a govern-by-exception composition layer (`human-attention.js`) that aggregates the human-decision queue across categories into one prioritized `HumanAttentionReport`, exposed through `agentxchain attention` and the governance report. Critically, when no human decision is pending the queue is **empty** (`overall: 'clear'`) — that empty state is the operational proof that the human can step back and let governed autonomy run.

This milestone is the M11→VISION.md:47, M12→:48, M13→:49, M14→:50, **M15→:51** continuation that systematically closes every "Why This Must Exist" pain bullet.

## Interface

### Module: `cli/src/lib/human-attention.js`

#### `evaluateHumanAttention(repoDir: string): HumanAttentionReport`

Composes the cross-category human-decision queue into a single govern-by-exception assessment. **Read-only** — never mutates state, artifacts, escalations, or config.

```javascript
// HumanAttentionReport structure
{
  overall: 'clear' | 'attention',     // 'clear' iff items.length === 0
  items: [
    {
      category: string,                // one of the category ids below
      priority: number,                // lower = more urgent; deterministic ordering key
      blocking: boolean,               // does this halt forward progress on a run?
      run_id: string | null,           // owning run, when applicable
      summary: string,                 // human-readable description of the decision needed
      action_hint: string              // concrete next command, e.g. "agentxchain approve-transition"
    }
  ],
  items_count: number,
  blocking_count: number,
  categories: string[],                // distinct category ids present
  evidence_summary: string             // one-line summary
}
```

**Category 1: Pending approvals (critical transitions & completion)**
- Source: `governed-state.js` `readState(root)`; `state.blocked_on` strings beginning `human_approval:<gate>` (see governed-state.js:2222–2226). Cross-reference `approval-policy.js` `evaluateApprovalPolicy({ gateResult, gateType, state, config })` for whether the gate requires a human.
- Maps to VISION.md "approve critical transitions" / "decide what ships."
- `action_hint`: `agentxchain approve-transition` or `agentxchain approve-completion`.
- blocking: true.

**Category 2: Open human escalations (intervene during escalation)**
- Source: `human-escalations.js` `readHumanEscalations(root)` (line 316) and `findCurrentHumanEscalation(root, state)` (line 326) — surface every escalation whose status is open.
- Maps to VISION.md "intervene during escalation."
- `action_hint`: `agentxchain escalate --resolve <id>` (or the project's documented resolution command).
- blocking: true.

**Category 3: Pending approved intents awaiting dispatch**
- Source: `intake.js` `findPendingApprovedIntents(root, { run_id })` (line 687).
- Informational human-decision item: work approved but not yet dispatched.
- `action_hint`: `agentxchain intake status` / `agentxchain start`.
- blocking: false.

**Category 4: Credentialed gates requiring a human even in lights-out**
- Source: `approval-policy.js` `isCredentialedExitGate(config, phase)` (line 57) combined with the current phase/gate from `readState`. These are the gates the vision says "may still require a human even in lights-out operation" (VISION.md:36).
- Maps to VISION.md:36 "gates guarding irreversible or credentialed actions."
- `action_hint`: the credentialed approval command for that gate.
- blocking: true.

**Category 5: Budget / policy blockers**
- Source: `state.blocked_on` strings `budget:exhausted` (governed-state.js:868–873) and `policy:<id>` (governed-state.js:691–707).
- A run halted on budget or policy needs a human to raise the budget or override the policy.
- `action_hint`: `agentxchain unblock` / budget or policy adjustment.
- blocking: true.

> Implementer note (compose, don't reimplement): reach each signal through the exported API above. Do **not** re-parse JSONL ledgers by hand where a reader function exists, and do **not** duplicate gate/approval logic that already lives in `approval-policy.js` or `gate-evaluator.js`. ≥5 categories is the floor; additional read-only categories (e.g. ghost-blocked-awaiting-human via `state.blocked_on` `human:`/`gate_action:`) are welcome if composed from existing state.

#### Ordering contract

`items` MUST be returned in deterministic priority order:
1. All `blocking: true` items before any `blocking: false` item.
2. Within the same blocking tier, credentialed-gate (Cat 4) and escalation (Cat 2) categories outrank pending-approval (Cat 1), which outranks budget/policy (Cat 5), which outranks pending-intent (Cat 3).
3. Ties broken by `run_id` then `summary` for stability.

### Command: `agentxchain attention`

**Registration:** `cli/bin/agentxchain.js`

```
agentxchain attention [options]

Options:
  --json   Machine-readable JSON output (the full HumanAttentionReport)
  --all    Include non-blocking/informational items (default shows blocking + escalation first;
           without --all, informational pending-intent items may be summarized as a count)
```

Default output (queue non-empty):
```
Attention needed: 2 items (2 blocking)
  [1] approval     run_abc — planning→implementation transition awaits approval
      → agentxchain approve-transition
  [2] escalation   run_def — credential failure escalated to human
      → agentxchain escalate --resolve esc_123
```

Empty queue (the govern-without-micromanaging state):
```
Nothing needs your attention. (exit 0)
```
The command MUST exit 0 in both the clear and attention states (it is a status surface, not a gate); `--json` always emits a schema-valid `HumanAttentionReport`.

### Report Integration

`buildGovernanceReport()` in `report.js` includes:
```javascript
report.human_attention = {
  overall: 'clear' | 'attention',
  items_count: number,
  blocking_count: number,
  categories: string[]
}
```

### Architecture Invariants

1. `human-attention.js` composes existing modules (`governed-state`, `human-escalations`, `intake`, `approval-policy`) — it does not reimplement escalation, approval, or intake logic.
2. `evaluateHumanAttention()` is read-only — never modifies state, escalations, intents, artifacts, or config.
3. Govern-by-exception: `overall === 'clear'` **iff** `items.length === 0`. An empty queue is a first-class, correct, expected result — not an error.
4. All categories are independently evaluated — a failure/empty in one category never suppresses another.
5. Ordering is deterministic (see Ordering contract) so output and tests are stable.
6. The CLI command delegates entirely to the module — no business logic in the command file.
7. The command exits 0 in both clear and attention states; it surfaces decisions, it does not enforce them.

## Acceptance Tests

### Test Suite: `cli/test/human-attention.test.js`

| # | Test ID | Scenario | Expected |
|---|---------|----------|----------|
| 1 | AT-HA-001 | No pending decisions of any category | overall: 'clear', items: [], items_count 0 |
| 2 | AT-HA-002 | `state.blocked_on = human_approval:<gate>` | overall: 'attention', item category 'approval', blocking true |
| 3 | AT-HA-003 | Open human escalation present | item category 'escalation', blocking true, action_hint references resolve |
| 4 | AT-HA-004 | Pending approved intent awaiting dispatch | item category 'pending_intent', blocking false |
| 5 | AT-HA-005 | Credentialed exit gate active | item category 'credentialed_gate', blocking true |
| 6 | AT-HA-006 | `state.blocked_on = budget:exhausted` | item category 'budget_policy', blocking true, action_hint references unblock |
| 7 | AT-HA-007 | `state.blocked_on = policy:<id>` | item category 'budget_policy', blocking true |
| 8 | AT-HA-008 | Mixed categories present | items ordered per Ordering contract (blocking first; escalation/credentialed outrank pending-intent) |
| 9 | AT-HA-009 | blocking_count reflects only blocking items | blocking_count correct when blocking + informational mixed |
| 10 | AT-HA-010 | CLI default output, empty queue | prints "Nothing needs your attention", exit 0 |
| 11 | AT-HA-011 | CLI `--json` output matches HumanAttentionReport schema | JSON validated, all required fields present |
| 12 | AT-HA-012 | CLI `--all` includes informational pending-intent items | output contains the pending-intent item |
| 13 | AT-HA-013 | `evaluateHumanAttention` performs no writes | state/escalations/intents files byte-identical before/after |

### Acceptance Criteria

| # | Criterion | Evidence Required |
|---|-----------|-------------------|
| AC-1 | `human-attention.js` with `evaluateHumanAttention()` composing ≥5 exception categories into HumanAttentionReport | Module exists, tests AT-HA-001 through AT-HA-009 pass |
| AC-2 | `agentxchain attention` CLI command with `--json` and `--all`, exit 0 in both clear and attention states | Tests AT-HA-010, AT-HA-011, AT-HA-012 pass |
| AC-3 | Govern-by-exception: empty queue ⇒ overall 'clear' with "Nothing needs your attention"; non-empty ⇒ deterministic priority ordering | Tests AT-HA-001, AT-HA-008, AT-HA-010 pass |
| AC-4 | Each item surfaces a concrete `action_hint` next command | Tests AT-HA-002…007 assert action_hint present |
| AC-5 | Governance report includes `human_attention` summary section | Report integration test passes |
| AC-6 | `evaluateHumanAttention()` is read-only | Test AT-HA-013 passes |
| AC-7 | All human-attention tests pass with 0 failures | Dev test output |
| AC-8 | Vision closure: VISION.md:51 "humans lose the ability to govern without micromanaging" addressed by the cross-category govern-by-exception composition | QA ship verdict |
