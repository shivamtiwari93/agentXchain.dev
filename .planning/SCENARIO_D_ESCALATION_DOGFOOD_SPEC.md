# Scenario D Escalation Dogfood Spec

> Post-v1 dogfood contract for validating the governed escalation paths that exist today, without assuming unimplemented auto-routing behavior.

---

## Purpose

Validate the escalation and human-recovery flows end-to-end on a real governed repo after `agentxchain@1.0.0` is released.

This spec closes an important ambiguity in the roadmap:

- the current implementation **does** support retry exhaustion escalation with preserved failed turn state
- the current implementation **does** support explicit routing to `eng_director`
- the current implementation **does not** auto-reassign a retries-exhausted turn to `eng_director`

Scenario D is therefore split into two live sub-scenarios so the dogfood session matches real code:

- `D1` validates retry exhaustion -> paused escalation -> human resolution -> redispatch of the same preserved turn
- `D2` validates explicit `eng_director` intervention -> human follow-up on a governed run

---

## Interface/Schema

### Scenario Envelope

```ts
type ScenarioDEvidence = {
  scenario_id: "D";
  executed_at: string;
  repo_fixture: string;
  release_version: string;
  subscenarios: {
    D1_retry_exhaustion: ScenarioDResult;
    D2_director_intervention: ScenarioDResult;
  };
  overall_verdict: "pass" | "fail" | "partial";
  open_issues: string[];
};

type ScenarioDResult = {
  status: "pass" | "fail" | "skipped";
  run_id: string | null;
  turn_ids: string[];
  evidence_paths: string[];
  notes: string[];
};
```

### Required Runtime / Repo Preconditions

```ts
type ScenarioDPrereqs = {
  published_release_required: true;
  clean_worktree_required: true;
  human_operator_required: true;
  supported_runtimes: Array<"manual" | "local_cli" | "api_proxy">;
};
```

Normative preconditions:

- run against the published governed CLI, not an ad hoc pre-release build
- use a clean repo before assigning any `authoritative` or `proposed` turn
- capture `state.json`, `history.jsonl`, and operator-visible CLI output as evidence
- do not edit `.agentxchain/state.json` manually to force role escalation

### Evidence Artifacts

The live run MUST produce or capture:

- `.planning/LIVE_SCENARIO_D_REPORT.md`
- `.agentxchain/state.json` snapshots at each escalation boundary
- `.agentxchain/history.jsonl` excerpts for accepted turns
- rejected artifact copies under `.agentxchain/dispatch/rejected/` for `D1`
- CLI output from `status`, `reject-turn`, `step --resume`, and any approval command used

---

## Behavior

### 1. Scope Clarification

Scenario D is a dogfood spec for the behavior that exists in code today.

It MUST NOT claim any of the following as current implementation truth:

- automatic reassignment from retries-exhausted turn to `eng_director`
- automatic clearing of `current_turn` during retry exhaustion
- implicit idempotent approval of previously handled human gates

If the team wants "retry exhaustion automatically hands off to `eng_director`" later, that requires a separate routing/state-machine spec before implementation.

### 2. D1 — Retry Exhaustion Escalation

Goal: prove the current escalation path works exactly as implemented.

Flow:

1. Start a governed run with an assignable turn in `implementation` or `qa`.
2. Cause two consecutive rejections of the same assigned turn until `max_turn_retries` is exhausted.
3. Verify the run pauses instead of clearing the turn.
4. Verify the failed turn is preserved for auditability and redispatch context.
5. Perform the required human resolution outside the agent loop.
6. Run `agentxchain step` to redispatch the same preserved turn. (Note: `--resume` is not required here — the paused+failed state handler in `step` automatically re-dispatches without the flag. `--resume` is only needed when `status === "active"` and a turn is already assigned.)
7. Accept a corrected result and confirm the run returns to normal active/completed flow.

Required state after retry exhaustion:

- `state.status === "paused"`
- `state.current_turn.status === "failed"`
- `state.current_turn.turn_id` is unchanged from the rejected turn
- `state.blocked_on === "escalation:retries-exhausted:{role}"`
- `state.escalation.from_turn_id === state.current_turn.turn_id`

Required operator surface:

- `status` renders `typed_reason = retries_exhausted`
- recovery action is `Resolve the escalation, then run agentxchain step`
- `turn_retained = true`

### 3. D2 — Explicit `eng_director` Intervention

Goal: validate the director role as an explicit governed intervention path, not an automatic retry-exhaustion consequence.

Flow:

1. Reach a governed point where an accepted turn proposes `eng_director` as the next role because of deadlock, disagreement, or cross-role conflict.
2. Ensure the run is in a legal state for a new assignment with `current_turn = null`.
3. Assign `eng_director`.
4. Complete an `eng_director` turn through the normal governed loop.
5. Have the director either:
   - return `status = "needs_human"` with a concrete `needs_human_reason`, or
   - complete with `proposed_next_role = "human"` when the decision truly requires explicit operator judgment.
6. Verify the resulting human recovery path is rendered correctly.

Required invariants:

- `eng_director` remains `review_only`
- the director turn includes at least one objection
- no human command succeeds unless the run is paused on the matching pending object or human-needed state

### 4. Human Resolution Rules

For both `D1` and `D2`, human intervention is part of the protocol, not test noise.

Acceptable human actions include:

- making an explicit release/process decision
- clarifying scope or acceptance criteria
- deciding whether the preserved failed turn should be resumed
- approving a pending phase transition or completion request

Unacceptable shortcuts:

- editing `state.json` by hand
- deleting `current_turn` to force reassignment
- bypassing `accept-turn`, `reject-turn`, `approve-transition`, or `approve-completion`

### 5. Reporting

The final report MUST distinguish:

- `implemented behavior validated`
- `future policy idea observed but not implemented`
- `operator friction discovered during dogfood`

This prevents the live report from accidentally rewriting the protocol contract.

---

## Error Cases

- If retry exhaustion is reported as a director handoff without an explicit new assignment, the dogfood result is invalid.
- If `D1` clears `current_turn` on escalation, the run does not match the current state-machine contract.
- If `D2` assigns `eng_director` while a failed preserved turn is still retained from escalation, the operator skipped required recovery sequencing.
- If a `review_only` director turn has empty `objections`, the turn is invalid and must not be accepted.
- If `approve-transition` or `approve-completion` succeeds without a matching paused pending object, the run does not match the strict approval contract.

---

## Acceptance Tests

1. `D1` exhausts retries on one turn and records `state.status = "paused"` with `blocked_on = "escalation:retries-exhausted:{role}"`.
2. `D1` preserves the original `turn_id` and sets `current_turn.status = "failed"` instead of clearing assignment.
3. `status` after `D1` escalation renders a recovery descriptor with `typed_reason = retries_exhausted`, `owner = human`, and `turn_retained = true`.
4. `agentxchain step` after human resolution redispatches the same preserved turn rather than assigning `eng_director`. (`--resume` is not required for paused+failed state.)
5. `D1` stores rejected artifacts under `.agentxchain/dispatch/rejected/` for each failed attempt.
6. `D2` reaches `eng_director` only through normal governed assignment with `current_turn = null`.
7. The accepted `eng_director` turn includes at least one objection and respects `review_only` constraints.
8. If the director requests human intervention, the resulting paused state uses the normal human recovery path (`blocked_on = human:*` or pending approval object), not a hidden special case.
9. No manual edits to `.agentxchain/state.json` are used at any point in either sub-scenario.
10. `.planning/LIVE_SCENARIO_D_REPORT.md` records exact run IDs, turn IDs, evidence paths, and a pass/fail verdict for both `D1` and `D2`.

---

## Open Questions

1. Should v1.2 introduce an explicit policy for auto-routing retries-exhausted turns to `eng_director`, or is human-mediated redispatch the preferred durable model?
2. Should the future director-intervention flow write structured linkage between the director's objections and the prior rejected turn in `decision-ledger.jsonl` / `history.jsonl`?
3. ~~Should a dedicated report template live beside this spec, or is a free-form `LIVE_SCENARIO_D_REPORT.md` sufficient?~~ **Resolved:** Dedicated template created as `.planning/LIVE_SCENARIO_D_REPORT_TEMPLATE.md` with structured sections for D1, D2, evidence paths, checklists, and categorized observations. The operator copies this to `LIVE_SCENARIO_D_REPORT.md` and fills it in during the dogfood session.
