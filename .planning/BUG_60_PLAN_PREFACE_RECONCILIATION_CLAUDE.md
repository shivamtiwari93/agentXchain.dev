# BUG-60 Plan-Preface Reconciliation — Claude Opus 4.7

> **Tag:** `BUG-60-PLAN-PREFACE-RECONCILE-CLAUDE`
> **Author:** Claude Opus 4.7, Turn 263
> **Status:** Documentation-only narrow reconciliation. No implementation. No source files modified.
> **Reviewed against HEAD:** `d6108898 docs(bug-60): review plan-preface interfaces`
> **Source artifacts:** `.planning/BUG_60_PLAN_PREFACE.md` (Turn 261), `.planning/BUG_60_PLAN_PREFACE_GPT_REVIEW.md` (Turn 262)

This is the third-turn reconciliation mandated by HUMAN-ROADMAP `:420` ("If Claude's research and GPT's review disagree on even one material point, a third turn reconciles before implementation begins"). Narrow scope: accept or reject the two blocking corrections at `BUG_60_PLAN_PREFACE_GPT_REVIEW.md:88-92` before the plan turn can proceed.

## Verdict Summary

| Correction | Verdict | Reason |
|---|---|---|
| §2 ingestion reads `acceptResult.validation.turnResult`, not `acceptResult.accepted` alone | **Accept** | Evidence cited below |
| §3 idempotency uses `signal.expansion_key` (Option 1), not `event.metadata.expansion_key` | **Accept** | Evidence cited below |

Both corrections land. The two remaining pre-plan amendments to `BUG_60_PLAN_PREFACE.md` §2 and §3 are locked below. §1 (result storage channel), §4 (budget ordering), §5 (scheduler mapping) remain as frozen in Turn 261 per GPT's hold-verdicts.

## Correction 1 — Ingestion Source (Preface §2 amendment)

### Code evidence

`cli/src/lib/governed-state.js:5750-5761` — `acceptTurn()` success return shape:

```javascript
return {
  ok: true,
  state: attachLegacyCurrentTurnAlias(updatedState),
  validation,
  accepted: historyEntry,
  gateResult,
  completionResult,
  hookResults,
  ...(budgetWarning ? { budget_warning: budgetWarning } : {}),
  ...(policyResult.warnings.length > 0 ? { policy_warnings: policyResult.warnings } : {}),
  ...(verificationReplay ? { verification_replay: summarizeVerificationReplay(verificationReplay) } : {}),
};
```

`cli/src/lib/governed-state.js:4599-4644+` — `historyEntry` is a field-by-field projection. No top-level wildcard spread of `turnResult`. No `idle_expansion_result` field. A new optional turn-result key added per §1 is guaranteed NOT to reach `acceptResult.accepted` unless the plan adds an explicit projection line in `historyEntry` construction.

`cli/src/lib/governed-state.js:3847` — raw normalized result lives at `validation.turnResult = validateStagedTurnResult(...).turnResult`. Cross-referenced `:3903` (`const rawTurnResult = validation.turnResult;`) confirms this is the canonical raw-shape access point.

### Amendment to Preface §2

Replace the vague `acceptedTurn` handoff with the exact call shape GPT proposed:

```javascript
ingestAcceptedIdleExpansion(context, session, {
  turnResult: acceptResult.validation.turnResult,  // raw, carries idle_expansion_result
  historyEntry: acceptResult.accepted,              // projection for audit
  state: acceptResult.state
})
```

**Dual-persistence decision (my addition, ties §1 and §2):** the plan turn MUST also extend `historyEntry` construction in `governed-state.js` to project a compact `idle_expansion_result_summary` (not the full object — just `{ kind, expansion_iteration, new_intent_id | reason_excerpt }`). Rationale: `historyEntry` is the audit record the dashboard renders; dropping expansion provenance from history leaves gaps in audit re-construction. The raw object stays in `validation.turnResult` for ingestion; the compact summary lands in history for audit. Both are cheap.

### What this correction does NOT change

- §1 result-storage channel (optional top-level `idle_expansion_result` on turn-result schema) holds.
- §2 two-stage boundary (shape-at-accept + ingestion-in-continuous-loop) holds.
- §2 four invariants hold: never-on-failed-accept, no-cross-boundary-state-mutation, bounded retry semantics, no-silent-ingestion-failure-swallowing.

## Correction 2 — Idempotency Storage (Preface §3 amendment)

### Code evidence

`cli/src/lib/intake.js:348-359` — persisted `event` shape:

```javascript
const event = {
  schema_version: '1.0',
  event_id: eventId,
  source: payload.source,
  category: payload.category || `${payload.source}_signal`,
  created_at: now,
  repo: payload.repo || null,
  ref: payload.ref || null,
  signal: payload.signal,
  evidence: payload.evidence,
  dedup_key: dedupKey,
};
```

No `metadata` field. `validateEventPayload()` at `:256-289` validates only `source`, `signal`, `evidence` — `payload.metadata` is silently dropped if passed. The derived `intent` at `:365-382` likewise has no `metadata` field.

`cli/src/lib/intake.js:63-67` — `computeDedupKey()`:

```javascript
function computeDedupKey(source, signal) {
  const sorted = JSON.stringify(signal, Object.keys(signal).sort());
  const hash = createHash('sha256').update(sorted).digest('hex').slice(0, 16);
  return `${source}:${hash}`;
}
```

`signal` is already the dedup substrate. Placing `expansion_key` inside `signal` means the deterministic retry-same-key property is delivered by the existing code path with zero new branching in `recordEvent()`.

### Amendment to Preface §3

**Canonical storage: `signal.expansion_key`.** The synthesized `vision_idle_expansion` event's `signal` contract is fixed:

```json
{
  "signal": {
    "expansion_key": "sha256(session_id + '::' + expansion_iteration + '::' + accepted_turn_id) hex, 16 chars",
    "expansion_iteration": <integer>,
    "accepted_turn_id": "turn_..."
  }
}
```

**Determinism contract (locks GPT's `captured_at` nondeterminism concern):** `signal` for `vision_idle_expansion` MUST contain ONLY these three keys. No timestamps, no PM-emitted free-form text, no runtime IDs. The full `idle_expansion_result` object lives on the turn-result (per §1) and on `historyEntry.idle_expansion_result_summary` (per §2 amendment above). The event's `signal` is the minimal idempotency key only.

**No new recordEvent() branch needed.** With the three-key signal contract, `computeDedupKey()` hashes `{expansion_key, expansion_iteration, accepted_turn_id}` sorted — which is fully determined by `expansion_key` (the other two are inputs to it). Retry determinism holds without any source-specific dedup branch.

**Dedup detection surfaces naturally.** `recordEvent()` at `:337-344` already returns `{ ok: true, event: dup, intent: linkedIntent, deduplicated: true }` when a dedup hit is found. Ingestion at `continuous-run.js` just reads `result.deduplicated === true` to distinguish first-ingestion from replay.

### Rejected alternative: general event/intent `metadata` schema extension

GPT's Option 2 was "add explicit `metadata` support to event and intent records". Cost: update `validateEventPayload()` (new optional metadata validation), `recordEvent()` (persist metadata on event and copy to intent), intent creation path, intake schema docs, and tests. Benefit for BUG-60: zero beyond what Option 1 delivers. Rejected for this bug. If a future bug needs general event metadata, it can be added then without reopening BUG-60.

## Non-Actions (preserved from Turn 261 §7)

Did not modify `cli/src/lib/continuous-run.js`, `vision-reader.js`, `intake.js`, `normalized-config.js`, `dispatch-bundle.js`, `turn-result.schema.json`, `turn-result-validator.js`, `schedule.js`, `governed-state.js`, or `.agentxchain/prompts/pm.md`. Did not edit `.planning/BUG_60_PLAN_PREFACE.md` directly — this reconciliation artifact is the amendment record; the plan turn consumes preface + this file together. Did not touch `.planning/VISION.md`, `.planning/PM_SIGNOFF.md`, `.planning/ROADMAP.md`, `.planning/SYSTEM_SPEC.md`. Did not file `DEC-BUG60-*`. Did not flip any HUMAN-ROADMAP checkbox. Did not edit V1/V2/V3/V4/V5. Did not modify `.planning/HUMAN-ROADMAP.md` audit table (defer to plan turn). Did not cut a release, post to social, or change product behavior.

## Plan-Turn Inputs Now Frozen

The plan turn consumes: `.planning/BUG_60_PLAN_PREFACE.md` §1/§4/§5 as-written + this reconciliation's §2/§3 amendments. All five frozen interfaces are settled. Remaining open questions from Preface §6 (config-field path, expansion_iteration persistence location, PM charter text review, sources-default parsing contract, test fixture shape) are plan-turn deliverables, not reconciliation items. No further pre-work turn is required.

## Closure Path (unchanged from Preface §8)

Reconciliation → plan turn (`BUG_60_PLAN.md`) → BUG-52 + BUG-59 shipped-package tester quote-back → implementation → SPEC + V6 tester ask → tester quote-back flips the BUG-60 checkbox.
