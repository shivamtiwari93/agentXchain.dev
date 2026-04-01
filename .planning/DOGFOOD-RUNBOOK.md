# AgentXchain v0.9 Dogfood Runbook

Operator checklist for validating the governed v4 lifecycle end-to-end.

---

## Prerequisites

- [ ] `agentxchain` CLI built and linked (`cd cli && npm link`)
- [ ] `claude` CLI installed and authenticated
- [ ] `ANTHROPIC_API_KEY` environment variable set
- [ ] Git available
- [ ] Working tree is clean before any `authoritative` or `proposed` turn assignment

## Setup

```bash
# Use the governed example project
cp -r examples/governed-todo-app /tmp/dogfood-run
cd /tmp/dogfood-run
git init && git add -A && git commit -m "initial scaffold"
```

Verify:
```bash
agentxchain status
# Expected: status=idle, phase=planning, no active turn
```

---

## Scenario A: Happy Path — Full PM → Dev → QA Cycle

### A1. Planning Phase — Manual PM Turn

```bash
agentxchain step
```

Expected output: Manual turn prompt written to `.agentxchain/dispatch/current/PROMPT.md`

**Operator action:** Complete the PM turn manually.

**Note:** The PM role is `review_only`. When `challenge_required` is enabled, every `review_only` turn must include at least one objection. On the first planning turn, a low-severity objection about scope risk, missing information, or "no prior work to challenge yet" is sufficient.

1. Edit `.planning/ROADMAP.md`:

```markdown
# Roadmap — Governed Todo App

## MVP Scope

Build a CLI todo app with three commands: add, list, done.

## Acceptance Criteria

| Req # | Requirement | Criteria |
|-------|-------------|----------|
| R-001 | Add a todo | `todo add "buy milk"` creates an entry in todos.json |
| R-002 | List todos | `todo list` prints all todos with status |
| R-003 | Mark done | `todo done 1` marks todo #1 as completed |
| R-004 | Persistence | Todos survive process restart (file-based storage) |
| R-005 | Error cases | Invalid commands print usage help, not crash |
```

2. Edit `.planning/PM_SIGNOFF.md`:

```markdown
# PM Signoff — Governed Todo App

Approved: YES

## Discovery Checklist
- [x] Target user defined — developer managing personal tasks
- [x] Core pain point defined — no lightweight CLI todo tool
- [x] Core workflow defined — add/list/done
- [x] MVP scope defined — 3 commands, file-based storage
- [x] Out-of-scope list defined — no server, no sync, no auth
- [x] Success metric defined — all 5 acceptance criteria pass
```

3. Write the turn result to `.agentxchain/staging/turn-result.json`:

```json
{
  "schema_version": "1.0",
  "run_id": "<from state.json>",
  "turn_id": "<from state.json current_turn.turn_id>",
  "role": "pm",
  "runtime_id": "manual-pm",
  "status": "completed",
  "summary": "Defined MVP scope: CLI todo app with add/list/done commands. 5 acceptance criteria defined.",
  "decisions": [
    {
      "id": "DEC-001",
      "category": "scope",
      "statement": "MVP is CLI-only with file-based persistence.",
      "rationale": "Simplest useful product. No server overhead for personal use."
    }
  ],
  "objections": [
    {
      "id": "OBJ-001",
      "severity": "low",
      "statement": "No prior turn to challenge — this is the first turn.",
      "status": "raised"
    }
  ],
  "files_changed": [],
  "artifacts_created": [".planning/ROADMAP.md", ".planning/PM_SIGNOFF.md"],
  "verification": {
    "status": "pass",
    "commands": [],
    "evidence_summary": "Planning artifacts created and reviewed."
  },
  "artifact": {
    "type": "review",
    "ref": null
  },
  "proposed_next_role": "human",
  "phase_transition_request": "implementation",
  "run_completion_request": false,
  "needs_human_reason": null,
  "cost": {
    "input_tokens": 0,
    "output_tokens": 0,
    "usd": 0
  }
}
```

4. Accept the turn:
```bash
agentxchain accept-turn
```

**Verify:**
- [ ] Turn accepted (no validation errors)
- [ ] State shows `pending_phase_transition` (gate requires human approval)
- [ ] `history.jsonl` has one entry

### A2. Approve Phase Transition

```bash
agentxchain approve-transition
```

**Verify:**
- [ ] Phase is now `implementation`
- [ ] `phase_gate_status.planning_signoff` is `passed`

### A2.1 Operator Checkpoint — Clean Baseline Before Dev Turn

The next turn is `dev`, which has `authoritative` write authority. `assignGovernedTurn()` enforces a clean worktree for that class of role. Accepting the PM turn and approving the transition updated orchestrator-owned files (`TALK.md`, `.agentxchain/state.json`, `.agentxchain/history.jsonl`), so commit them before dispatching the dev turn.

```bash
git add -A && git commit -m "orchestrator: accept pm turn"
```

### A3. Implementation Phase — Local CLI Dev Turn

```bash
agentxchain step
```

Expected: Dispatches to `claude --print -p {prompt}` with the full seed prompt. The dev agent should:
- Read the roadmap and acceptance criteria
- Implement the todo CLI
- Run tests
- Stage a turn result

**Verify after completion:**
- [ ] `.agentxchain/staging/turn-result.json` exists with valid JSON
- [ ] Product files created (e.g., `todo.js`, `package.json`)
- [ ] `verification.status` is `pass` with real `machine_evidence`
- [ ] `files_changed` matches actual git diff

Accept:
```bash
agentxchain accept-turn
```

**Verify:**
- [ ] Turn accepted
- [ ] `accepted_integration_ref` updated to current HEAD
- [ ] Phase auto-advances to `qa` (implementation gate requires verification pass, no human approval)

### A3.1 Operator Checkpoint — Recommended Audit Anchor Before QA

This commit is not required by the clean-baseline rule because the next turn is `qa` (`review_only`), but it is the cleanest way to preserve the accepted implementation plus orchestrator metadata as a stable audit point before the QA review.

```bash
git add -A && git commit -m "orchestrator: accept dev turn"
```

### A4. QA Phase — API Proxy Turn

```bash
agentxchain step
```

Expected: Sends the dispatch bundle to Anthropic API. The QA agent reviews the implementation against acceptance criteria and stages a structured review.

**Verify after completion:**
- [ ] `.agentxchain/staging/turn-result.json` exists
- [ ] `.agentxchain/staging/provider-response.json` exists (audit trail)
- [ ] `artifact.type` is `review`
- [ ] `objections` array is non-empty
- [ ] `cost` reflects actual API usage (not agent self-report)

Accept:
```bash
agentxchain accept-turn
```

If QA set `run_completion_request: true`:
```bash
agentxchain approve-completion
```

**Verify:**
- [ ] Run status is `completed`
- [ ] All three `phase_gate_status` entries are `passed`
- [ ] `history.jsonl` has entries for all turns
- [ ] `TALK.md` has content from each phase

### A5. Evidence Checklist

After Scenario A, the following files should exist:

- [ ] `.agentxchain/state.json` with `status: "completed"`
- [ ] `.agentxchain/history.jsonl` with 3+ entries
- [ ] `.agentxchain/decision-ledger.jsonl` with at least DEC-001
- [ ] `.planning/ROADMAP.md` with filled acceptance criteria
- [ ] `.planning/PM_SIGNOFF.md` with `Approved: YES`
- [ ] `.planning/acceptance-matrix.md` updated by QA
- [ ] `.planning/ship-verdict.md` updated by QA
- [ ] Product files (todo app code + tests)
- [ ] `TALK.md` with entries from PM, dev, and QA turns

---

## Scenario B: Validation Rejection and Retry

Start from a running governed project (after A2, with phase=implementation).

### B1. Stage an Invalid Turn Result

Create `.agentxchain/staging/turn-result.json` with intentionally bad data:

```json
{
  "schema_version": "1.0",
  "run_id": "<from state.json>",
  "turn_id": "<from state.json>",
  "role": "dev",
  "runtime_id": "local-dev",
  "status": "completed",
  "summary": "Implemented features.",
  "decisions": [],
  "objections": [],
  "files_changed": ["src/nonexistent.js"],
  "artifacts_created": [],
  "verification": {
    "status": "pass",
    "commands": ["npm test"],
    "evidence_summary": "Tests passed."
  },
  "artifact": {
    "type": "workspace",
    "ref": "git:dirty"
  },
  "proposed_next_role": "qa"
}
```

### B2. Attempt Acceptance

```bash
agentxchain accept-turn
```

**Verify:**
- [ ] Rejection with `artifact_error` (declared files don't match observed diff)
- [ ] Turn NOT accepted
- [ ] State still shows the same turn assignment

### B3. Reject and Retry

```bash
agentxchain reject-turn --reason "Declared files don't match actual changes"
```

**Verify:**
- [ ] Rejected artifacts moved to `.agentxchain/dispatch/rejected/`
- [ ] `attempt` counter incremented in state
- [ ] `agentxchain step --resume` re-materializes dispatch bundle with retry context

### B4. Stage Valid Result and Accept

Stage a correct turn result and run `agentxchain accept-turn`.

**Verify:**
- [ ] Turn accepted on second attempt
- [ ] `history.jsonl` contains the eventual accepted turn entry only
- [ ] Rejection evidence is preserved under `.agentxchain/dispatch/rejected/`

---

## Scenario C: Human Pause / Needs Human

### C1. Stage a `needs_human` Result

Create a turn result with:
```json
{
  "status": "needs_human",
  "needs_human_reason": "Acceptance criteria R-003 is ambiguous — does 'mark done' mean delete or flag?"
}
```

### C2. Accept the Turn

```bash
agentxchain accept-turn
```

**Verify:**
- [ ] Run enters `paused` state with `blocked_on` populated
- [ ] No phase advancement occurs
- [ ] `agentxchain status` shows the blocker reason

### C3. Resume

```bash
agentxchain step
# or: agentxchain step --resume
```

**Verify:**
- [ ] Run exits `paused` state
- [ ] New turn assigned correctly
- [ ] Dispatch bundle includes resolution context

---

## Post-Dogfood Checklist

After completing all three scenarios:

- [ ] No state corruption (state.json parseable and consistent)
- [ ] No orphaned turns (every assigned turn was accepted, rejected, or explicitly abandoned)
- [ ] Budget tracking is monotonically non-decreasing
- [ ] History is append-only (no entries modified or removed)
- [ ] All three adapter types exercised (manual, local_cli, api_proxy)
- [ ] At least one real LLM call completed (dev or QA)

## Known Limitations for v0.9

- `api_proxy` supports review-only roles only (no remote code writing)
- `local_cli` requires `prompt_transport: argv` or `stdin` for automatic prompt delivery
- Parallel turns are not supported
- Multi-repo coordination is not supported
