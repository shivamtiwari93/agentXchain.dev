# BUG-53 Spec — Continuous Session Re-Entry After Run Completion

> Narrow spec written 2026-04-22 by Claude Opus 4.7 (Turn 233) per GPT 5.4's
> Turn 232 next action: "produce a narrow spec/test plan for continuous session
> re-entry after run completion, explicitly separating it from BUG-60 perpetual
> vision synthesis and preserving the BUG-60 block."

**Status**: BUG-53 remains open in HUMAN-ROADMAP. The bounded clean idle-exit
case is validated on `v2.150.0`. The multi-run chain case is NOT yet proven on
the shipped package. This spec scopes ONLY the re-entry-after-run-completion
defect and does NOT implement BUG-60's perpetual idle-expansion. BUG-60 stays
gated behind its own two-agent research pre-work AND BUG-52 + BUG-59 shipped
quote-back.

---

## 1. Scope — What BUG-53 Is And Is Not

### BUG-53 IS (in scope this spec)

The **post-run-completion re-entry path**. When `advanceContinuousRunOnce()` has
just incremented `session.runs_completed` at `cli/src/lib/continuous-run.js:1041`
after a clean run completion:

1. **R1 — Terminal cap honoured.** If `runs_completed >= maxRuns`, session
   exits with `status: 'completed'` on the next step, no further work attempted.
2. **R2 — Vision-derived next intent.** If `runs_completed < maxRuns` AND a
   derivable vision candidate still exists in `VISION.md`, the next step seeds
   a new intake intent, starts a new governed run, emits the
   `session_continuation` event, and leaves `session.status === 'running'`.
3. **R3 — Clean idle-exit.** If `runs_completed < maxRuns` AND no vision
   candidate remains AND `on_idle` is `'exit'` (the default, per BUG-60's
   forthcoming schema), session increments `idle_cycles` and exits with
   `status: 'idle_exit'` when `idle_cycles >= maxIdleCycles`. This is the
   clean-termination case — **not** `status: 'paused'`.
4. **R4 — Never paused on clean completion.** `session.status === 'paused'` is
   reserved for real blockers (`status: 'blocked'` runs with open escalations
   or `needs_human` gates). A completed run that finds no next work must never
   transition the session to `paused`.

### BUG-53 IS NOT (deferred to BUG-60, still blocked)

- **Perpetual idle-expansion** — synthesising a new intake intent from broader
  sources (ROADMAP.md, SYSTEM_SPEC.md, product state) when vision candidates
  are exhausted. That is BUG-60's `on_idle: 'perpetual'` branch and stays
  blocked behind BUG-60's two-agent pre-work (`BUG-60-RESEARCH-CLAUDE` and
  `BUG-60-REVIEW-GPT` tags, HUMAN-ROADMAP lines 384–423) AND behind BUG-52 +
  BUG-59 shipped-package quote-back.
- **New `on_idle` config field.** BUG-60 introduces the field; BUG-53 reads
  the current codebase default (`exit`) exclusively. BUG-53 must not depend on
  any new config field shipping.
- **PM idle-expansion prompt override.** `.agentxchain/prompts/pm-idle-expansion.md`
  is a BUG-60 artifact.
- **`max_idle_expansions` cap or `vision_expansion_exhausted` status.** All BUG-60.

---

## 2. Current Code Behaviour Audit (2026-04-22)

| Surface | File:line | Observed behaviour |
|---|---|---|
| Terminal max-runs check | `cli/src/lib/continuous-run.js:688-692` | `runs_completed >= maxRuns` → `status: 'completed'`, `action: 'max_runs_reached'`. Correct for R1. |
| Terminal idle-cycles check | `cli/src/lib/continuous-run.js:694-698` | `idle_cycles >= maxIdleCycles` → `status: 'idle_exit'`. Correct for R3. |
| Post-completion `runs_completed += 1` | `cli/src/lib/continuous-run.js:1041` | Increments; does NOT mutate `session.status` away from `running`. Correct for R4. |
| `session_continuation` event emission | `cli/src/lib/continuous-run.js:916-940` | Emitted BEFORE `session.current_run_id` is overwritten; guards on `runs_completed >= 1` AND `previousRunId !== preparedIntent.run_id`. Payload includes `session_id`, `previous_run_id`, `next_run_id`, `next_objective`, `next_intent_id`, `runs_completed`, `trigger`. Correct for R2 audit trail. |
| Vision-derivation fallback | `cli/src/lib/continuous-run.js:867-898` | `seedFromVision()` after intake queue empty; sets `session.idle_cycles = 0` on candidate, increments on idle. Correct for R2/R3. |
| Paused-state guard | `cli/src/lib/continuous-run.js:715-790` | Only triggered when `session.status === 'paused'` which is set only on `isBlockedContinuousExecution(execution)` at lines 764, 822, 999. Clean completion never enters this branch. Correct for R4. |

**Result**: the implementation currently satisfies R1–R4 in the code path.
BUG-53's product-side fix is already shipped. The remaining work is
**evidence-path hardening** and **shipped-package tester quote-back** — the
same pattern as BUG-52/54/59/61/62 closure artifacts.

---

## 3. Testable Acceptance Matrix

Every row is a testable assertion on either the existing
`cli/test/beta-tester-scenarios/bug-53-continuous-auto-chain.test.js` harness
or a new guard this spec introduces.

| # | Condition | Expected | Covered Today? | Gap |
|---|---|---|---|---|
| A1 | Run 1 completes, vision has ≥1 more candidate, `max_runs >= 2` | Run 2 auto-starts, `session.status === 'running'`, `session_continuation` event emitted with `{previous_run_id, next_run_id, next_objective}` | ✅ `bug-53-continuous-auto-chain.test.js:275-322` | None |
| A2 | Runs 1–3 complete, `max_runs === 3` | Session exits with `status: 'completed'`, `runs_completed === 3`, 2× `session_continuation` events between the 3 runs | ✅ same test | None |
| A3 | Runs complete until vision candidates exhausted, `max_runs > candidates` | Session exits with `status: 'idle_exit'` after `max_idle_cycles` consecutive idle scans, **NOT** `paused` | ✅ `bug-53-continuous-auto-chain.test.js:409-463` covers the CLI path with 1 vision goal and `--max-runs 5`; `:464-520` covers the function-call path | None |
| A4 | Run 1 completes cleanly AND governed state transitions to `completed`, session NOT paused | `session.status !== 'paused'` after the advance step | ✅ asserted at line 285–286 (doesNotMatch paused log) | Weaker than direct state assertion; acceptable |
| A5 | `session_continuation.payload` shape locked against field rename | Payload carries exactly `{session_id, previous_run_id, next_run_id, next_objective, next_intent_id, runs_completed, trigger}` | ✅ `bug-53-continuous-auto-chain.test.js` asserts the exact key set via `assertSessionContinuationPayloadShape()` | None after Turn 234 |
| A6 | `prompt_transport` / `env_snapshot` / `auto_retried_ghost` fields do NOT leak into BUG-53 payload | None of those keys appear in `session_continuation.payload` (BUG-54/61 contamination) | ✅ same payload-shape assertion bans the concrete BUG-54/61 diagnostic keys listed in G3 | None after Turn 234 |
| A7 | Shipped-package `2.154.7+` CLI produces R2/R3 behaviour end-to-end, quoted by tester | Tester-quoted `Run 2/N completed` line + `session_continuation` event JSON from `.agentxchain/events.jsonl`, run on real project (not synthetic mock executor) | ❌ not yet | **Gap G4 (tester quote-back)** |

---

## 4. Gap Remediation Plan

### G1 — Idle-exit shorter-than-max-runs path (already covered)

`bug-53-continuous-auto-chain.test.js` already contains the missing CLI-shaped
coverage this spec initially called out:

- one vision candidate with `--max-runs 5`;
- exactly `Run 1/5 completed`;
- no `Run 2/5` through `Run 5/5` output;
- operator-visible `All vision goals appear addressed`;
- terminal `continuous-session.json` status is `completed`, never `paused`;
- `runs_completed === 1`;
- zero `session_continuation` events because no second run was seeded.

This closes R3 explicitly. Do NOT introduce ROADMAP.md/SYSTEM_SPEC.md reading
in the fixture — that is BUG-60. A future stronger variant may use exactly 2
candidates with `--max-runs 5`, but it is not required to close BUG-53's
idle-exit proof because the one-candidate CLI path already proves max-runs is
not mistaken for required work.

### G2 — `session_continuation` payload shape drift guard (next turn)

Add a dedicated assertion in the existing test that the event's `payload`
carries exactly the seven keys listed in §3/A5. Turn 234 implemented this in
`cli/test/beta-tester-scenarios/bug-53-continuous-auto-chain.test.js` via
`assertSessionContinuationPayloadShape()`.

The exact key-set lock is intentional. Additive fields are not forbidden
forever, but they require a deliberate migration/update because tester
quote-back consumers and downstream audit tools depend on this event shape.

### G3 — Cross-bug contamination negative guard

Negative assertion: BUG-53's `session_continuation.payload` does NOT contain
the concrete BUG-54/61 diagnostic keys currently known to belong on other
surfaces: `prompt_transport`, `env_snapshot`, `stdin_bytes`, `watchdog_ms`,
`auto_retried_ghost`, `ghost_retry_exhausted`, `attempts_log`,
`diagnostic_bundle`, or `failure_type`.

This is not a blanket ban on all future session-level counters. If a concrete
use case needs to add a retry summary to `session_continuation`, update the
event contract and quote-back tests in the same change instead of smuggling it
in as an incidental field.

### G4 — Shipped-package tester quote-back

Produce a copy-paste tester ask matching the V1/V2/V3/V4 shape. Proposed filename:
`.planning/TESTER_QUOTEBACK_ASK_V5_BUG53.md` (if V5 slot not otherwise taken).
It must:

- Pin `agentxchain@2.154.7+` (BUG-52-safe).
- Give a concrete `VISION.md` fixture with 2 goals and a `--max-runs 3` command.
- Inline a jq extractor for `session_continuation` events:
  ```bash
  jq -c 'select(.event_type == "session_continuation") | {previous_run_id: .payload.previous_run_id, next_run_id: .payload.next_run_id, next_objective: .payload.next_objective, runs_completed: .payload.runs_completed}' .agentxchain/events.jsonl
  ```
- Reject synthetic or local-checkout evidence — require shipped-package
  execution.
- Add a `cli/test/bug-53-tester-quoteback-ask-content.test.js` drift guard
  matching the V1/V2/V3/V4 test pattern.

G4 is the **closure artifact**. Product behaviour is already shipped; tester
quote-back from `2.154.7+` is the only remaining step. Do NOT flip the
HUMAN-ROADMAP checkbox until the tester produces literal `.agentxchain/events.jsonl`
output showing a real multi-run chain.

---

## 5. Separation From BUG-60

This spec **does not implement**, reference as required, or provide schema for
any of the following BUG-60 concepts:

- `on_idle: 'perpetual'` branch
- `on_idle_perpetual.sources` reading ROADMAP.md or SYSTEM_SPEC.md
- `max_idle_expansions` config field
- `vision_expansion_exhausted` session status
- PM idle-expansion prompt override (`.agentxchain/prompts/pm-idle-expansion.md`)
- `DEC-BUG60-PERPETUAL-CONTINUOUS-POLICY-001`

When BUG-60 ships, its perpetual branch must explicitly dispatch from the
**same** post-completion decision point this spec describes (§2 row
`cli/src/lib/continuous-run.js:694-698`). That is the insertion point. BUG-60
may replace the `status: 'idle_exit'` return with a dispatch-PM branch when
`on_idle === 'perpetual'` is set; BUG-53's R3 remains the default behaviour
when `on_idle === 'exit'`. The two fixes are additive, not mutually exclusive.

**Do not relitigate this separation.** If a future turn argues that BUG-53's
idle-exit case should read ROADMAP.md, reject it and link back here.

---

## 6. Non-Goals (explicit rejections)

1. **Changing default `maxIdleCycles` or `maxRuns` values.** Out of scope.
2. **Adding new CLI flags.** The existing `--max-runs`, `--max-idle-cycles`,
   `--poll-seconds` cover BUG-53 fully.
3. **Changing `session_continuation` event emission order.** Already correct
   per §2; moving emission after `session.current_run_id` overwrite would
   regress A5.
4. **Reworking `paused` semantics.** `paused` is correctly scoped to blocked
   runs today; BUG-53's R4 is a guard against misuse, not a redefinition.

---

## 7. Decision Records

Propose two DECs after G4 ships:

- **DEC-BUG53-CLEAN-COMPLETION-NEVER-PAUSES-001** — `advanceContinuousRunOnce`
  must never transition `session.status` from `running` to `paused` on a
  `stop_reason === 'completed'` execution. `paused` is reserved for
  `isBlockedContinuousExecution(execution) === true`.
- **DEC-BUG53-SESSION-CONTINUATION-PAYLOAD-SHAPE-001** — the
  `session_continuation` event carries exactly seven payload keys:
  `session_id`, `previous_run_id`, `next_run_id`, `next_objective`,
  `next_intent_id`, `runs_completed`, `trigger`. Adding new keys requires a
  migration plan for downstream quote-back consumers.

Do NOT file these DECs speculatively. File them alongside the G2/G4 commits so
the records reference real shipped changes.

---

## 8. Closure Definition

BUG-53 closes when ALL of the following are true:

1. G1 regression is present and green (`bug-53-continuous-auto-chain.test.js`
   CLI idle-exit scenario).
2. G2 payload-shape drift guard committed and green in CI.
3. G3 cross-bug contamination negative guard committed and green in CI.
4. G4 tester-quoted multi-run chain output from `agentxchain@2.154.7+` appended
   to AGENT-TALK with literal `session_continuation` event JSON.
5. Both DEC-BUG53-* records committed.
6. HUMAN-ROADMAP.md checkbox flipped with the tester-quoted evidence inline.

No earlier step (including all four agent-side gaps G1–G3 closing) constitutes
closure. **Closure requires G4.** This preserves the discipline we adopted in
the BUG-52/54/59/61/62 cycle.
