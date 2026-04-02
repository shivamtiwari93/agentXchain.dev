# Live Scenario D Report — [DATE]

Purpose: capture evidence from the escalation dogfood session so the governed recovery paths are validated against real operator behavior, not just unit tests.

Spec reference: `.planning/SCENARIO_D_ESCALATION_DOGFOOD_SPEC.md`

---

## Preconditions

- agentxchain version: `[published version, e.g. 1.0.0]`
- Repo fixture: `[path or description]`
- Operator: `[name]`
- Clean worktree confirmed: [ ] yes
- Starting state: `idle` with no retained `current_turn`

---

## D1 — Retry Exhaustion Escalation

### Setup

- Run ID: `[run_...]`
- Phase: `[implementation | qa]`
- Assigned role: `[role]`
- Runtime: `[manual | local_cli | api_proxy]`
- `max_turn_retries` config value: `[N]`

### Rejection Cycle

| Attempt | Turn ID | Action | Rejection Reason | Artifact Preserved |
|---------|---------|--------|------------------|--------------------|
| 1 | `[turn_...]` | `reject-turn --reason "..."` | [reason] | `.agentxchain/dispatch/rejected/[filename]` |
| 2 | `[turn_...]` | `reject-turn --reason "..."` | [reason] | `.agentxchain/dispatch/rejected/[filename]` |

### State After Retry Exhaustion

Paste the relevant `state.json` snapshot:

```json
{
  "status": "[expected: paused]",
  "current_turn": {
    "turn_id": "[same as rejected turn]",
    "status": "[expected: failed]",
    "assigned_role": "[role]",
    "attempt": "[final attempt number]",
    "last_rejection": { "..." : "..." }
  },
  "blocked_on": "[expected: escalation:retries-exhausted:{role}]",
  "escalation": {
    "from_role": "[role]",
    "from_turn_id": "[turn_id]",
    "reason": "Turn rejected N times. Retries exhausted.",
    "escalated_at": "[timestamp]"
  }
}
```

### CLI `status` Output After Escalation

```
[paste full agentxchain status output here]
```

Verify these fields in the recovery descriptor:

- [ ] `typed_reason` = `retries_exhausted`
- [ ] `owner` = `human`
- [ ] `recovery_action` = `Resolve the escalation, then run agentxchain step`
- [ ] `turn_retained` = `true` (turn retained, not cleared)
- [ ] `detail` = `escalation:retries-exhausted:{role}`

### Human Resolution

Describe what the operator did to resolve the escalation before redispatch:

> [e.g., "Fixed the dispatch bundle prompt to clarify acceptance criteria", "Updated the config to use a different runtime", etc.]

### Redispatch

- Command used: `agentxchain step`
- State after redispatch: `active`
- `blocked_on` cleared: [ ] yes
- Same `turn_id` preserved: [ ] yes
- Attempt number incremented: [ ] yes

### Acceptance

- Staged result validated: [ ] yes
- `accept-turn` succeeded: [ ] yes
- Run returned to normal flow: [ ] yes
- History entry recorded: [ ] yes

### D1 Verdict

- [ ] **PASS** — retry exhaustion -> paused escalation -> human resolution -> redispatch -> accept works as implemented
- [ ] **FAIL** — describe what broke:

### D1 Operator Friction

List any UX or workflow issues encountered:

1. [e.g., "The error message after exhaustion didn't clearly say what to do next"]
2. ...

---

## D2 — Explicit `eng_director` Intervention

### Setup

- Run ID: `[run_...]` (may be same run as D1, or a fresh one)
- Phase: `[planning | implementation | qa]`
- Prior turn that proposed director: `[turn_...]`
- `current_turn` is null before director assignment: [ ] yes

### Director Assignment

- Command used: `agentxchain step --role eng_director`
- Runtime: `[manual | manual-director]`
- Turn ID: `[turn_...]`

### Director Turn Execution

- Director reviewed: `[what was reviewed]`
- Objections included: [ ] yes (at least one required)
- `write_authority` = `review_only` respected: [ ] yes (no file writes)
- Director's recommendation: `[e.g., proposed_next_role: "human", needs_human_reason: "..."]`

### Director Turn Result

```json
{
  "turn_id": "[turn_...]",
  "assigned_role": "eng_director",
  "status": "completed",
  "write_authority": "review_only",
  "objections": ["[at least one]"],
  "proposed_next_role": "[human | dev | qa | ...]",
  "needs_human_reason": "[if applicable]"
}
```

### Acceptance and Follow-Up

- `accept-turn` succeeded: [ ] yes
- If director requested human intervention:
  - Run paused with human recovery path: [ ] yes
  - `blocked_on` value: `[human:* or pending approval]`
  - Human resolved via: `[describe action]`
- If director proposed next agent role:
  - Next role assigned successfully: [ ] yes
  - Follow-up turn completed: [ ] yes

### D2 Verdict

- [ ] **PASS** — explicit eng_director assignment -> governed review turn -> human follow-up works as implemented
- [ ] **FAIL** — describe what broke:

### D2 Operator Friction

1. [e.g., "Unclear how to trigger eng_director without manually specifying --role"]
2. ...

---

## Overall Verdict

- [ ] **PASS** — both D1 and D2 validated
- [ ] **PARTIAL** — one sub-scenario passed, one failed or skipped
- [ ] **FAIL** — critical path broken

### Categorized Observations

#### Implemented Behavior Validated

- [list behaviors confirmed working]

#### Future Policy Ideas Observed (Not Implemented)

- [list any auto-routing or auto-escalation ideas that came up during dogfood but are not in code]

#### Operator Friction Discovered

- [consolidated list from D1 and D2]

### Open Issues

- [any bugs, spec drift, or UX problems to track]

---

## Evidence Paths

| Artifact | Path |
|----------|------|
| state.json (post-D1-escalation) | `.agentxchain/state-d1-escalation.json` |
| state.json (post-D1-accept) | `.agentxchain/state-d1-accepted.json` |
| state.json (post-D2-accept) | `.agentxchain/state-d2-accepted.json` |
| history.jsonl | `.agentxchain/history.jsonl` |
| Rejected artifacts (D1) | `.agentxchain/dispatch/rejected/` |
| CLI output log | `[operator's terminal capture]` |
| This report | `.planning/LIVE_SCENARIO_D_REPORT.md` |
