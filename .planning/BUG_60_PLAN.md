# BUG-60 Perpetual Continuous Mode Plan

> **Tag:** `BUG-60-PLAN-GPT`
> **Author:** GPT 5.4 (Codex), Turn 264
> **Status:** Documentation-only plan. No implementation. No source files modified.
> **Written at:** 2026-04-22T23:27:02Z
> **Inputs:** `BUG_60_RESEARCH_CLAUDE.md`, `BUG_60_REVIEW_GPT.md`, `BUG_60_PLAN_PREFACE.md`, `BUG_60_PLAN_PREFACE_GPT_REVIEW.md`, `BUG_60_PLAN_PREFACE_RECONCILIATION_CLAUDE.md`, `BUG_60_DECISION_CANDIDATE_AUDIT.md`, `BUG_60_DOC_SURFACE_AUDIT.md`, `BUG_60_TEST_SURFACE_AUDIT.md`, `BUG_60_PLAN_REVIEW_CLAUDE.md`.

This plan was written before BUG-60 implementation started. Implementation is now in progress — Slice 1 committed at `ef9c4d32` (config parsing), Slice 1 CLI surface at `3bb5c467`. The value of this artifact is to remove ambiguity so implementation does not reopen architecture, schema, prompt, budget, or proof questions under pressure.

## 0. Gate Status (ALL SATISFIED)

- ✅ BUG-52 is closed with literal tester quote-back on `agentxchain@2.154.11`.
- ✅ BUG-59 is shipped in `agentxchain@2.151.0` and checked in HUMAN-ROADMAP. Gate satisfied.
- ✅ BUG-60 pre-work A (Turn 259), pre-work B (Turn 260), preface review, and reconciliation are complete.
- ✅ Plan reviewed and agreed (Turns 265-269). Implementation in progress.

## 1. Architecture Decision

Choose **Option A: intake-pipeline expansion**, with **Choice 3: normal `pm` role carrying idle-expansion instructions in the synthesized intent charter**.

The end-to-end flow is:

1. Continuous loop reaches `max_idle_cycles` with `on_idle: "perpetual"`.
2. Budget guard runs before any PM expansion work can dispatch.
3. Continuous loop records a `vision_idle_expansion` intake event with deterministic `signal.expansion_key`.
4. Existing intake lifecycle runs: `recordEvent -> triageIntent -> approveIntent -> planIntent -> startIntent`.
5. The resulting PM turn uses the normal `pm` role, but its charter explicitly says it is an idle-expansion turn.
6. PM returns a validated `idle_expansion_result` in turn-result.
7. Continuous ingestion consumes `acceptResult.validation.turnResult.idle_expansion_result` and either creates the next intake intent or terminates with `vision_exhausted`.

Reject **Option B: direct special-case PM dispatch**. It bypasses intake, creates a second governance path, and would need bespoke events, retry semantics, and operator inspection surfaces.

Reject **Choice 1: dedicated `pm_idle_expansion` role** for the first implementation. It is a valid future escape hatch if idle expansion needs distinct runtime, tool, or budget policy, but it forces every existing custom-role project to add a new role before the product has proven the behavior.

Reject **Choice 2: per-dispatch prompt override**. It mutates the stable dispatch-bundle prompt-rendering path for all roles to solve a PM-only mode. The charter path is smaller and already flows through the governed context model.

Backward compatibility: default `continuous.on_idle` is `"exit"`. Existing bounded BUG-53 idle-exit behavior must pass unchanged for projects that do not opt in.

Vision-coherence invariant: every synthesized intake intent must cite at least one VISION.md heading or goal it advances; every `vision_exhausted` declaration must classify all top-level VISION.md headings as complete, deferred, or out of scope. The validator enforces this against `session.vision_headings_snapshot` captured when the continuous session starts, not against live VISION.md headings at acceptance time. The session also stores `session.vision_sha_at_snapshot` so the runner can detect content drift even when headings are unchanged. If VISION.md changes between sessions, the next session captures the new heading set and content hash. If VISION.md changes during an active session, the active session keeps its snapshot and the implementation emits an observable `vision_snapshot_stale` warning rather than silently rematching against a moving human-owned document.

## 2. Config Schema

Ship this schema under the existing continuous config block:

```json
{
  "continuous": {
    "enabled": true,
    "vision_path": ".planning/VISION.md",
    "max_runs": 50,
    "max_idle_cycles": 3,
    "triage_approval": "auto",
    "per_session_max_usd": 25,
    "on_idle": "exit",
    "idle_expansion": {
      "sources": [".planning/VISION.md", ".planning/ROADMAP.md", ".planning/SYSTEM_SPEC.md"],
      "max_expansions": 5,
      "role": "pm",
      "output": "intake_intent_or_vision_exhausted",
      "malformed_retry_limit": 1
    }
  }
}
```

Supported `on_idle` values for the first BUG-60 implementation:

- `exit`: current bounded behavior. Default.
- `perpetual`: after idle threshold, dispatch PM idle-expansion instead of terminal idle exit.
- `human_review`: after idle threshold, pause the continuous session with `idle_human_review_required` so an operator can decide whether to inject/approve work, rerun with another idle policy, or stop.

Turn 26 amendment: earlier plan text reserved `human_review`, but the human roadmap fix requirements explicitly require `exit | perpetual | human_review`. The implementation now supports minimal real human-review semantics instead of rejecting it or silently aliasing it.

Use `idle_expansion`, not `on_idle_perpetual`, because the block names the sub-feature rather than one enum value. That keeps future modes from inheriting a value-specific config namespace. The human roadmap used `max_idle_expansions`; the plan uses `idle_expansion.max_expansions` because the nested block already scopes the field to idle expansion. Tester docs and final specs must name the shipped field, not the earlier roadmap placeholder.

`sources` parsing contract: default sources are VISION, ROADMAP, and SYSTEM_SPEC. VISION.md missing or malformed is fail-fast because it is the human-owned source of truth. ROADMAP.md and SYSTEM_SPEC.md missing are warnings in the PM charter context, not hard failures, because new or small projects may not have them yet. ROADMAP/SYSTEM_SPEC are malformed if they cannot be decoded as UTF-8, exceed 64KB, or parse into fewer than one H1/H2 heading. Malformed ROADMAP/SYSTEM_SPEC entries are included in the PM source manifest with warning metadata; the PM can still declare exhaustion or propose a repair intent.

Source access contract: the synthesized PM charter carries file references plus a bounded source manifest, not full arbitrary file contents. The manifest includes path, presence, byte count, warning code, extracted H1/H2 headings, and a bounded preview. Full source reading remains a normal PM turn responsibility using repo file access. Preview truncation is deterministic: at most 16KB per source and 48KB total, using head+tail with `[...truncated middle...]` inserted between halves. This keeps the dispatch prompt bounded while still giving the PM enough orientation to decide what to read.

Persist `session.expansion_iteration` in the continuous session JSON. Deriving this from events is attractive but too expensive and fragile under event compaction. Existing sessions missing the field migrate to `0`.

## 3. Result And Ingestion Contract

Add optional `idle_expansion_result` to the turn-result schema. It is required only for turns whose intake event source is `vision_idle_expansion`.

Canonical result shape:

```json
{
  "idle_expansion_result": {
    "kind": "new_intake_intent",
    "expansion_iteration": 1,
    "vision_traceability": [
      { "vision_heading": "Human Role", "goal": "internal phase transitions are policy-driven", "kind": "advances" }
    ],
    "new_intake_intent": {
      "title": "Implement policy-backed routine gate closure",
      "charter": "Ship the next governed increment...",
      "acceptance_contract": "Pass/fail assertions...",
      "priority": "p1",
      "template": "generic"
    }
  }
}
```

For exhaustion:

```json
{
  "idle_expansion_result": {
    "kind": "vision_exhausted",
    "expansion_iteration": 1,
    "vision_traceability": [],
    "vision_exhausted": {
      "classification": [
        { "vision_heading": "Human Role", "goal": "routine gates are autonomous", "status": "complete", "reason": "..." }
      ]
    }
  }
}
```

Validation lives in `idle-expansion-result-validator.js` and is called from turn-result validation. Ingestion lives in `continuous-run.js` after `acceptTurn()` succeeds, with this exact payload:

```javascript
ingestAcceptedIdleExpansion(context, session, {
  turnResult: acceptResult.validation.turnResult,
  historyEntry: acceptResult.accepted,
  state: acceptResult.state,
});
```

`governed-state.js` must also project a compact `idle_expansion_result_summary` into accepted history: `{ kind, expansion_iteration, new_intent_id | reason_excerpt }`. Raw result stays in `turnResult` for ingestion; history gets the audit summary.

Idempotency uses `signal.expansion_key`, not event metadata. The `vision_idle_expansion` signal contains exactly:

```json
{
  "expansion_key": "<sha256(session_id + '::' + expansion_iteration + '::' + accepted_turn_id)>",
  "expansion_iteration": 1,
  "accepted_turn_id": "turn_..."
}
```

No timestamps or PM free text belong in this signal. The existing `computeDedupKey()` path is sufficient when the signal is deterministic.

## 4. PM Charter Text

Implementation should commit `.agentxchain/prompts/pm-idle-expansion.md` as scaffold documentation, but the runtime path for the first version is the synthesized intake charter. Use this text as the canonical charter body:

```text
# Idle-Expansion Charter

You are running in IDLE-EXPANSION mode. The continuous loop found no directly derivable work after the configured idle threshold. Your task is to decide the next governed product increment from the configured sources, or to declare the product vision exhausted.

Read these sources in order:
1. .planning/VISION.md (read-only; never modify)
2. .planning/ROADMAP.md
3. .planning/SYSTEM_SPEC.md
4. .agentxchain/intake/
5. .planning/acceptance-matrix.md when present

You must emit exactly one structured idle_expansion_result in the turn result:

1. kind: new_intake_intent
   Produce one concrete intake intent with title, priority, template, charter, acceptance_contract, and vision_traceability. The intent must cite at least one existing VISION.md heading or goal it advances. Do not invent work outside the human-owned vision.

2. kind: vision_exhausted
   Classify every top-level VISION.md heading as complete, deferred, or out_of_scope, with a reason for each. Use this only when no next governed product increment can be justified from the configured sources.

Do not modify .planning/VISION.md. If you cannot cite VISION.md for a proposed intent, return vision_exhausted or a deferred classification instead of expanding scope.
```

The prompt scaffold should mirror this text for discoverability, but the validator, not the prompt, is the authority.

## 5. Budget And Loop Safeguards

Order in `advanceContinuousRunOnce()`:

1. `runs_completed >= maxRuns` stops as today.
2. `per_session_max_usd` stops before idle policy and before PM expansion.
3. `idle_cycles >= maxIdleCycles && on_idle === "exit"` returns bounded `idle_exit`.
4. `idle_cycles >= maxIdleCycles && on_idle === "perpetual" && expansion_iteration < max_expansions` records/starts PM expansion.
5. `expansion_iteration >= max_expansions` returns `vision_expansion_exhausted`.

The dual-cap behavior change is intentional: if a session is both idle and over budget, `session_budget` wins. That is a latent bug correction, not a separate BUG-63.

`max_expansions` default is `5`. `malformed_retry_limit` default is `1`, scoped to one expansion iteration. A malformed PM output can be retried once; after that, the iteration counts against the expansion cap and emits an observable malformed event.

## 6. Observability Contract

Terminal states must remain distinguishable:

- bounded `completed`: `max_runs` hit.
- bounded `idle_exit`: `on_idle: "exit"` and no derivable work.
- `vision_exhausted`: PM declared no next governed increment exists.
- `vision_expansion_exhausted`: expansion cap hit or repeated malformed output exhausted the mechanism.
- `session_budget`: budget cap hit in any mode.

Event trail additions:

- `idle_expansion_dispatched`
- `idle_expansion_ingested`
- `idle_expansion_malformed`
- `idle_expansion_ingestion_failed`
- `vision_snapshot_stale`
- `vision_exhausted`
- `vision_expansion_exhausted`

`vision_snapshot_stale` is informational, not terminal. Detect it at `advanceContinuousRunOnce()` entry by comparing the current VISION.md content hash to `session.vision_sha_at_snapshot`; emit it at most once per `session_id + current_vision_sha` so repeated idle cycles do not spam the event trail. No scheduler mapping is required.

`schedule.js` must map `vision_exhausted -> continuous_vision_exhausted`, `vision_expansion_exhausted -> continuous_vision_expansion_exhausted`, and `idle_expansion_dispatched -> continuous_running`.

## 7. File-Level Diff Sequence

Implementation order:

1. `cli/src/lib/schemas/turn-result.schema.json`: add optional `idle_expansion_result`.
2. `cli/src/lib/idle-expansion-result-validator.js`: new validation helper.
3. `cli/src/lib/turn-result-validator.js`: call helper when result is an idle-expansion turn and pass the session VISION heading snapshot.
4. `cli/src/lib/governed-state.js`: project `idle_expansion_result_summary` into history.
5. `cli/src/lib/normalized-config.js`: parse `continuous.on_idle` and `continuous.idle_expansion`; reject reserved `human_review`.
6. `cli/src/lib/vision-reader.js`: add bounded source-manifest helpers, VISION heading snapshot capture, deterministic malformed-source warnings, and preview truncation. Do not add a broad markdown parser rewrite.
7. `cli/src/lib/intake.js`: add `vision_idle_expansion` to `VALID_SOURCES`; keep signal deterministic.
8. `cli/src/lib/continuous-run.js`: move budget guard above idle, capture/persist `session.vision_headings_snapshot` and `session.vision_sha_at_snapshot`, add perpetual branch, add `ingestAcceptedIdleExpansion()`, and include the source manifest in the synthesized PM charter.
9. `cli/src/commands/schedule.js`: map new terminal/action statuses.
10. `.agentxchain/prompts/pm-idle-expansion.md`: add prompt scaffold matching the charter.
11. `SPEC-GOVERNED-v5.md`, `PROTOCOL-v7.md`, docs/spec surfaces from `BUG_60_DOC_SURFACE_AUDIT.md`.
12. `.planning/TESTER_QUOTEBACK_ASK_V6_BUG60.md`: add shipped-package tester ask after implementation proof exists.

No cycle is required. Schema and validator land before the continuous loop consumes results. Config lands before behavior branches. Schedule/docs land after behavior names are final.

## 8. Test Update Order

1. Schema and validator tests for valid `new_intake_intent`, valid `vision_exhausted`, missing required result for idle-expansion turn, mismatched `expansion_iteration`, missing VISION traceability, VISION snapshot exact-match behavior, and VISION.md content-sha drift detection.
2. Config tests for default `on_idle: "exit"`, valid `perpetual`, reserved `human_review` rejected with the actionable unsupported-value message, invalid enum, `idle_expansion.max_expansions`, and migration from missing `expansion_iteration`.
3. Source-manifest tests for ROADMAP/SYSTEM_SPEC missing warnings, malformed warning rules, 16KB-per-source and 48KB-total truncation, and head+tail preview behavior.
4. Intake test for `vision_idle_expansion` source and deterministic signal/dedup.
5. Continuous-loop unit/integration tests for budget-before-idle ordering, bounded default preservation, and cap terminal statuses. Include the dual-cap regression explicitly: `idle_cycles >= maxIdleCycles && cumulative_spent_usd >= per_session_max_usd` returns `session_budget`, not `idle_exit`.
6. Scheduler tests for `continuous_vision_exhausted`, `continuous_vision_expansion_exhausted`, and `idle_expansion_dispatched` pass-through.
7. New command-chain scenario: `cli/test/beta-tester-scenarios/bug-60-perpetual-idle-expansion.test.js`.
8. Packed claim-reality/prepublish coverage for release-note rows 1-9 from `BUG_60_DOC_SURFACE_AUDIT.md`.

The beta scenario must use child-process CLI invocation. Positive case: bounded first run completes, queue goes idle, PM expansion emits a new intake intent, second run starts from that PM-synthesized intent. Negative cases: pre-dispatch budget stop, malformed PM output with `max_expansions: 1`, and PM-declared `vision_exhausted`.

## 9. Commit Slice Shape

Preferred implementation series:

1. `feat(bug-60): parse continuous idle policy defaults`
   Schema/default parsing only. No behavior change.
2. `test(bug-60): extract continuous CLI scenario helper`
   Optional, only if BUG-53 and BUG-60 scenario setup can share temp repo/CLI envelope without hiding scenario-specific fake-agent behavior.
3. `feat(bug-60): validate idle expansion turn results`
   Turn-result schema, validator, history summary.
4. `feat(bug-60): ingest idle expansion through intake`
   Intake source, deterministic signal, continuous ingestion helper.
5. `feat(bug-60): dispatch perpetual idle expansion safely`
   Budget reorder, perpetual branch, terminal statuses.
6. `test(bug-60): prove perpetual idle expansion command chain`
   Positive and negative child-process scenarios.
7. `docs(bug-60): document perpetual continuous policy`
   SPEC/PROTOCOL/website docs/tester ask.
8. Release bump only after full prepublish gate.

Budget: keep each behavior commit under roughly 300 changed lines excluding tests/docs where possible. Do not mix release/version churn into behavior commits.

## 10. Draft DEC Text

Do not append these to `DECISIONS.md` until the remaining BUG-59 quote-back gate clears and the plan is reviewed. Drafts:

### DEC-BUG60-IDLE-POLICY-ARCHITECTURE-001

Status: Draft.

Decision: BUG-60 perpetual continuous mode uses the governed intake pipeline, not direct special-case PM dispatch. Default `continuous.on_idle` remains `exit`; `perpetual` is opt-in. `human_review` pauses at the idle threshold with `idle_human_review_required`. Idle expansion uses the normal `pm` role with an idle-expansion charter carried by the synthesized intake intent. Every `new_intake_intent` result must cite at least one matching VISION.md heading or goal; every `vision_exhausted` result must classify every top-level VISION.md heading.

Why: Intake gives auditability, lifecycle reuse, approval policy inheritance, and operator inspection. Direct dispatch creates a second autonomy path. A dedicated role is deferred until there is a concrete runtime/tool/budget need.

Turn 26 amendment: `continuous.on_idle: "human_review"` is no longer deferred. It is implemented as a non-terminal pause policy with an auditable idle-review event.

### DEC-BUG60-BUDGET-BEFORE-IDLE-EXPANSION-001

Status: Draft.

Decision: `per_session_max_usd` is evaluated before any PM idle-expansion can dispatch or spend. Budget exhaustion dominates idle exhaustion when both are true. This invariant applies under bounded, perpetual, scheduled, and future idle policies.

Why: Perpetual mode must not spend past an operator's categorical budget cap. Moving budget above idle also corrects the existing dual-cap reporting bug.

### DEC-BUG60-IDLE-EXPANSION-OBSERVABILITY-001

Status: Draft.

Decision: BUG-60 owns separate terminal state and event trail contracts. Terminal states distinguish `completed`, `idle_exit`, `vision_exhausted`, `vision_expansion_exhausted`, and `session_budget`. Event trail distinguishes dispatch, ingestion, malformed result, ingestion failure, PM-declared exhaustion, and expansion-cap exhaustion. Scheduler mappings must preserve these distinctions.

Why: Operators need to know whether the loop stopped because bounded work ended, PM declared the vision done, the expansion mechanism failed, budget blocked further work, or the human-owned VISION.md moved during an active session.

### DEC-BUG60-RESULT-SCHEMA-EXTENSION-001

Status: Draft.

Decision: BUG-60 extends the turn-result schema with optional `idle_expansion_result`. The field is required only for accepted turns whose intake event source is `vision_idle_expansion`. It supports exactly two kinds in the first slice: `new_intake_intent` and `vision_exhausted`.

Why: Idle expansion is PM-authored product work, not a hidden runner heuristic. Keeping the PM decision in turn-result makes it reviewable, testable, and governed by the same accept/reject path as other turns.

### DEC-BUG60-VALIDATOR-INGESTION-OWNERSHIP-001

Status: Draft.

Decision: Validation and ingestion remain separate. `idle-expansion-result-validator.js` validates shape, iteration, and VISION snapshot traceability during turn acceptance. `continuous-run.js` ingests only after `acceptTurn()` succeeds, using `acceptResult.validation.turnResult` plus the accepted history entry. Ingestion never mutates state after a failed accept.

Why: Turn acceptance owns whether an agent output is valid. Continuous mode owns what to do with a valid idle-expansion result. Mixing those responsibilities would create a second state-mutation path for rejected work.

### DEC-BUG60-SIGNAL-EXPANSION-KEY-DEDUP-001

Status: Draft.

Decision: `vision_idle_expansion` intake events use a deterministic three-key signal: `expansion_key`, `expansion_iteration`, and `accepted_turn_id`. The expansion key is `sha256(session_id + "::" + expansion_iteration + "::" + accepted_turn_id)`. No timestamps, PM prose, or runtime IDs belong in the signal.

Why: Existing intake dedup hashes `signal`. A fixed signal shape gives idempotency without adding generic event metadata or source-specific dedup branches.

### DEC-BUG60-CONTINUOUS-CLI-SCENARIO-HELPER-001

Status: Deferred draft.

Decision: If helper extraction lands, the helper owns temp repo setup and CLI invocation only. Fake-agent behavior and assertions remain scenario-local. BUG-53 migrates first; BUG-60 becomes the second consumer.

Why: Shared setup is useful only if it does not hide the behavior each scenario is supposed to prove.

## 11. Review Gate Before Implementation

Claude should review this plan in two passes:

1. Sections 1-6: architecture, schema, prompt, budget, observability.
2. Sections 7-10: file sequence, tests, commit slices, DEC drafts.

Both reviews accepted and BUG-59 gate satisfied (checked in roadmap, shipped in `agentxchain@2.151.0`). BUG-52's gate cleared on `agentxchain@2.154.11`. Implementation in progress. If a review finds a material contradiction, write a reconciliation artifact before touching the affected `cli/src/lib/` surface.

### Turn 266 Review Reconciliation

GPT accepts Claude's Turn 265 material challenges with the following locks:

- Challenge 1: use `session.vision_headings_snapshot`. Exact heading validation is against the session snapshot, not live VISION.md.
- Challenge 2: reject reserved `human_review` in the first schema slice. No stub behavior ships.
- Challenge 3: source access uses file references plus a bounded source manifest. ROADMAP/SYSTEM_SPEC malformed rules and preview caps are now testable.

GPT also accepts the dual-cap regression test, VISION snapshot test, and three additional draft DECs above. Architecture-side plan agreement is therefore closed unless Claude finds a new code-cited contradiction. BUG-60 implementation gate satisfied: BUG-59 checked in roadmap (`agentxchain@2.151.0`); BUG-52 closed on `agentxchain@2.154.11`.

### Turn 268 Plan Cleanup

GPT accepts Claude's Turn 267 F1-F4 findings and resolves them in this plan:

- F1/F2: add `session.vision_sha_at_snapshot`, use it for content-drift detection, and define `vision_snapshot_stale` as an informational event emitted once per `session_id + current_vision_sha` at `advanceContinuousRunOnce()` entry.
- F3: keep `idle_expansion.max_expansions` and explicitly document the rename from the roadmap placeholder `max_idle_expansions`.
- F4: remove the speculative `BUG-64` reference from operator-facing validator text and record `human_review` only as deferred future scope in the draft DEC.
