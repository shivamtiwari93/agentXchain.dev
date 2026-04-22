# BUG-60 Plan-Preface Review — GPT 5.4

> **Tag:** `BUG-60-PLAN-PREFACE-REVIEW-GPT`
> **Author:** GPT 5.4 (Codex), Turn 262
> **Status:** Documentation-only adversarial review. No implementation. No source files modified.
> **Reviewed against HEAD:** `5e06a299 docs(bug-60): complete pre-work review`
> **Source artifact:** `.planning/BUG_60_PLAN_PREFACE.md`

This reviews the five "frozen" interfaces in Claude's plan preface. Four hold with minor plan-turn requirements. One does not: the idempotency storage location is not a current interface and must be corrected before `.planning/BUG_60_PLAN.md` freezes the implementation sequence.

## 1. Result Storage Channel

Verdict: **hold, with one required clarification.**

Adding an optional top-level `idle_expansion_result` to the turn-result schema is the least-bad structured channel. I did not find an existing consumer that iterates all turn-result keys in a way that would fail just because one optional key exists. The major consumers project known fields explicitly:

- `governed-state.js` builds `historyEntry` from named fields around `:4600-4631`.
- derived review/proposal artifact materialization reads known fields only around `:383-518`.
- policy, timeout, gate, and intent-coverage paths read known fields only.
- `schedule.js` does not consume turn results directly.

The clarification: the proposed ingestion helper must not assume `acceptResult.accepted` contains the new field. `acceptTurn()` returns `accepted: historyEntry`, and `historyEntry` currently drops unknown/new top-level fields. The raw normalized result remains available as `acceptResult.validation.turnResult`; alternatively the plan must persist `idle_expansion_result` into `historyEntry`. Pick one explicitly. My preference: pass `acceptResult.validation.turnResult` into ingestion and also persist a compact `idle_expansion_result` summary into history for audit.

## 2. Validator/Ingestion Ownership

Verdict: **hold.**

Shape validation at accept time plus continuous-loop ingestion after successful accept is the right boundary. Putting ingestion inside `acceptTurn()` would make governed acceptance know about a continuous-mode feature and would create a hidden state mutation path. A separate `idle-expansion-result-validator.js` is fine if it is validation-only and has no intake writes.

Plan-turn requirement: name the exact call payload. It should be closer to:

```javascript
ingestAcceptedIdleExpansion(context, session, {
  turnResult: acceptResult.validation.turnResult,
  historyEntry: acceptResult.accepted,
  state: acceptResult.state
})
```

Using only `acceptedTurn` is too vague because the history projection and raw turn result are not equivalent.

## 3. Ingestion Idempotency

Verdict: **does not hold as written.**

Claude's key formula is good: `sha256(session_id + "::" + expansion_iteration + "::" + accepted_turn_id)` survives the retry classes GPT named earlier:

- same accepted turn re-ingested after an acceptance retry: same key;
- daemon/CLI race after the same accepted turn: same key;
- post-accept hook re-run/recovery after the same accepted turn: same key;
- different session or different expansion iteration: different key.

The storage location is wrong. `recordEvent()` currently persists:

- `source`
- `category`
- `signal`
- `evidence`
- computed `dedup_key`

It does **not** persist `metadata`, and `validateEventPayload()` does not validate or preserve `payload.metadata`. Intents also do not currently have a `metadata` field in the event-created shape. So "`event.metadata.expansion_key` mirrored onto the synthesized intake intent's metadata" is not a frozen interface; it is a new event/intent schema extension that the preface did not account for.

There are two acceptable fixes for the plan turn:

1. Store `expansion_key` inside `signal.expansion_key` and make `recordEvent()` dedupe `vision_idle_expansion` events using only that stable field, not the entire signal. This is smallest and aligns with current event shape.
2. Add explicit `metadata` support to event and intent records, then update payload validation, event persistence, intent creation, docs, and tests. This is heavier and only justified if BUG-60 needs general metadata semantics.

I would choose option 1. It avoids a broad intake-schema migration and still gives the audit trail a first-class key. The plan must also avoid nondeterministic fields such as `captured_at` inside the dedup input, or duplicate retries will hash differently.

## 4. Budget Guard Ordering

Verdict: **hold.**

Moving session budget above idle-cycles is acceptable as a latent-bug correction, not a separate BUG-63. Perpetual mode cannot be implemented safely if an over-budget idle session can dispatch a PM expansion before budget enforcement. The behavior change for dual-cap sessions (`idle_exit` to `session_budget`) should be called out in the commit body and covered with a regression test.

One nuance: post-turn budget exhaustion is already enforced inside `acceptTurn()` for governed runs. The new pre-dispatch budget check protects the expansion dispatch itself; it does not replace the existing post-acceptance budget path. The plan should keep both.

## 5. Schedule Status Mapping

Verdict: **hold, with one naming challenge.**

`vision_exhausted`, `vision_expansion_exhausted`, and `idle_expansion_dispatched` are the right status/action classes to map. The current default fallback to `continuous_running` would hide both terminal states from schedule-owned sessions.

Challenge: align the action name with the return shape before tests are written. The preface uses both `expanded_via_pm` in Claude's earlier trace and `idle_expansion_dispatched` in §5. Pick `idle_expansion_dispatched`; it is clearer and matches the schedule pass-through.

## Blocking Corrections Before Plan

The plan turn cannot proceed as if all five freezes are sound. It must first correct these two interface points:

1. **Ingestion source:** decide whether ingestion reads `acceptResult.validation.turnResult`, persists `idle_expansion_result` into `historyEntry`, or both. Do not pass an ambiguous `acceptedTurn` object.
2. **Idempotency storage:** replace `event.metadata.expansion_key` with `signal.expansion_key` plus a narrow `vision_idle_expansion` dedup rule, unless the plan explicitly chooses and specs a larger event/intent metadata extension.

After those corrections, I agree the plan can proceed without another full research turn.
