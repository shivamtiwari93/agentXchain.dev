# Acceptance Matrix — M15: Govern Without Micromanaging — Human Attention Surface (VISION.md:51)

**Run:** run_2929265fcbabe440
**Turn:** turn_92c39cb5177586c2 (QA; Staff QA ship verdict)
**Baseline:** git:e1c177be16581865652694aa4e236c411b328862 (HEAD of dogfood/2157-lights-out)
**Scope:** Verify `human-attention.js` + `agentxchain attention` compose the cross-run human-decision
queue across ≥5 govern-by-exception categories into a prioritized `HumanAttentionReport`, are empty
(`overall: 'clear'`, exit 0, "Nothing needs your attention") when no human decision is pending, surface
a concrete `action_hint` per item, integrate into the governance report, and address VISION.md:51
"humans lose the ability to govern without micromanaging" as a composition over existing escalation /
approval / intake primitives — reimplementing none.

> **Stale-artifact correction (10th consecutive run):** The three QA workflow artifacts on disk at the
> start of this turn (acceptance-matrix.md, ship-verdict.md, RELEASE_NOTES.md) all referenced the PRIOR
> milestone — **M14 Shippability Visibility, `run_74d17633499b410b`, `turn_b7ac694416a751c0`**. All three
> are rewritten from scratch for M15 / `run_2929265fcbabe440` by this QA turn. See Finding 1.

> **Gate-contract note:** The Section A table below uses the contractually required `| Req # |` header
> (the M14 QA turn was gate-rejected for using `| # |`; `evaluateAcceptanceMatrix`,
> workflow-gate-semantics.js:118). Each requirement row's Status cell is a bare `PASS` token
> (AFFIRMATIVE_ACCEPTANCE_STATUSES). Verified against the real validator — see Section E.

## Section A: Acceptance Criteria (derived from ROADMAP.md M15, lines 171-176)

| Req # | Criterion | Evidence (QA-run THIS turn) | Status |
|-------|-----------|-----------------------------|--------|
| AC-1 | New module `human-attention.js` with `evaluateHumanAttention(repoDir)` composing ≥5 exception categories into a `HumanAttentionReport` (`overall`, priority-ordered `items[]` of `{category,priority,blocking,run_id,summary,action_hint}`, `evidence_summary`); read-only; composes existing modules, reimplements none | QA read the module: **6 categories** exported (`credentialed_gate, escalation, approval, manual_action, budget_policy, pending_intent` — exceeds the ≥5 floor). Composition delegates to `readHumanEscalations` (human-escalations.js), `findPendingApprovedIntents` (intake.js), `isCredentialedExitGate` (approval-policy.js), and `state.blocked_on` parsing — **no escalation/approval/intake logic reimplemented**. `assembleReport` returns the full schema. AT-HA-001 confirms the clear-queue shape; AT-HA-013 confirms read-only (state/escalations/intents byte-identical, no `HUMAN_TASKS.md` written). 18/18 tests pass, exit 0. | PASS |
| AC-2 | `agentxchain attention` CLI with `--json` and `--all`; default lists ONLY items needing a human, highest-priority first, each with a concrete `action_hint`; prints "Nothing needs your attention" and exits 0 when the queue is empty | QA live smoke on THIS repo: `attention` → `Nothing needs your attention.`, **exit 0**; `attention --json` → schema-valid `{overall:'clear',items:[],items_count:0,blocking_count:0,categories:[],evidence_summary}`, **exit 0**. AT-HA-010 (empty→exit 0), AT-HA-010b (attention state also exit 0 — status surface, not a gate), AT-HA-011 (`--json` schema: every item has `category,priority,blocking,run_id,summary,action_hint`), AT-HA-012 (`--all` reveals informational `pending_intent`; default hides it as a count) all green. Command is presentation-only (commands/attention.js delegates to the module). | PASS |
| AC-3 | Govern-by-exception semantics: empty queue ⇒ `overall:'clear'`, zero items; non-empty ⇒ `overall:'attention'` with deterministic priority ordering (blocking before non-blocking; credentialed-gate & escalation outrank informational pending-intent) | `assembleReport`: `overall = items.length===0 ? 'clear' : 'attention'`. `sortItems` orders blocking-first, then ascending `priority`, ties broken by `run_id` then `summary` (fully deterministic). Priority map places all blocking categories <100 and `pending_intent` at 100. AT-HA-008 asserts order `credentialed_gate < escalation < approval < budget_policy < … < pending_intent (last, non-blocking)`; AT-HA-008b asserts a single repo with budget-block + pending-intent orders blocking first; AT-HA-009 asserts `blocking_count` counts only blocking items. All green. | PASS |
| AC-4 | Governance report integration — `buildGovernanceReport()` includes a `human_attention` summary (`overall`, `items_count`, `blocking_count`, `categories[]`) | QA ran a **real end-to-end** on this repo: `agentxchain export` → `agentxchain report --format json` → `subject.run.human_attention` is **present** = `{overall:'clear',items_count:0,blocking_count:0,categories:[]}` (matches the repo's clear state). Wired at report.js:1083 beside the working `ship_status` summary. `buildHumanAttentionSummary` unit tests (clear / budget-blocked→attention,budget_policy / null-artifact→null) green. Report-integration suites (governance-report-content, report-cli, workflow-kit-report) = **46/46 pass, exit 0** — the report.js edit regressed nothing. **Scope limit logged as Finding 2 (OBJ-001):** the report summary evaluates only the 3 state/config-derivable categories (approval/credentialed, budget_policy, manual_action), not live escalations/intents — by design, since the report runs on a static export artifact. | PASS |
| AC-5 | Regression tests (`human-attention.test.js`): clear-queue, pending-approval, open-escalation, pending-intent, credentialed-gate, budget/policy, mixed-category ordering, `--json`/`--all` CLI scenarios | QA ran `npx vitest run test/human-attention.test.js` → **18/18 pass, exit 0**. Coverage confirmed present: AT-HA-001 (clear), 002 (pending approval, non-credentialed), 003 (open escalation + resolve hint + run_id), 004 (pending intent, non-blocking), 005 (credentialed gate, mutually exclusive with approval), 006 (budget:exhausted), 007 (policy:<id>), 008/008b (mixed ordering), 009 (blocking_count), 010/010b (CLI exit 0 both states), 011 (`--json` schema), 012 (`--all`), 013 (read-only), + 3 `buildHumanAttentionSummary` report-integration cases. | PASS |
| AC-6 | Acceptance: `attention` returns a prioritized govern-by-exception queue from ≥5 categories; empty (`clear`, exit 0, "Nothing needs your attention") when no human decision is pending; each item surfaces a concrete `action_hint`; addresses VISION.md:51 as a composition over existing escalation/approval/intake primitives | All sub-clauses met by the evidence above: ≥5 categories (6 delivered, AC-1); empty→clear/exit 0/"Nothing needs your attention" (AC-2, live + AT-HA-001/010); every item carries an `action_hint` (AC-2, schema test AT-HA-011 + every evaluator sets it — `agentxchain approve-transition/approve-completion`, the escalation's own `resolution_command`, `agentxchain unblock`, `agentxchain start`); composition over existing primitives reimplementing none (AC-1). VISION.md:51 closure: the empty queue is the operational proof a human can step back — verified live as the repo's actual state. | PASS |

**Acceptance: 6/6 PASS**

## Section B: Dev Decision Verification

| Decision | QA Verdict |
|----------|------------|
| DEC-001: Unified Categories 1 (pending approval) & 4 (credentialed gate) into one mutually-exclusive classification — a pending human-approval gate is `credentialed_gate` when `isCredentialedExitGate(config,phase)` else `approval` | **VERIFIED.** `evaluatePendingApprovalCategory` resolves a single gate and emits exactly one item. AT-HA-005 asserts the credentialed path does NOT also produce a plain `approval` (no double-count); AT-HA-002 asserts the non-credentialed path is not classified `credentialed_gate`. Sound and prevents double-counting the same decision while honouring the ordering contract. |
| DEC-002: Used each escalation record's own `resolution_command` (`agentxchain unblock <id>`) as the escalation `action_hint` rather than the ROADMAP's suggested `agentxchain escalate --resolve <id>` | **VERIFIED — and a correctness improvement.** QA confirmed the escalation fixtures carry `resolution_command: 'agentxchain unblock hesc_abc'` and the real escalation surface (`human-escalations.js`) emits `agentxchain unblock <id>` as the canonical recovery command. Using the record's own command is MORE correct than the ROADMAP's illustrative example. Falls back to `agentxchain unblock <escalation_id>` when absent. AT-HA-003 locks it. Non-blocking deviation, documented. |
| DEC-003: Added a 6th `manual_action` category for remaining human-owned `blocked_on` encodings (`gate_action:<gate>`, `human:<detail>`) beyond the spec's 5-category floor | **VERIFIED.** Exceeds the ≥5 requirement and closes a real gap — a run blocked on operator action would otherwise be silently dropped. `escalation:<id>` is correctly NOT double-handled here (already represented by its open escalation in Category 2). |
| DEC-004: Reproduced ship-status.js's private `readGovernedStateReadOnly` helper instead of a shared export; mirrored `buildShipStatusSummary` with `buildHumanAttentionSummary(artifact)` | **VERIFIED.** Read-only state read (no `loadProjectState` writeback) preserves Invariant #2; AT-HA-013 proves byte-identical state. Minor duplication noted (Finding 3, non-blocking). |
| DEC-005: Updated two contracts the new command+test legitimately shifted — vitest-contract test-file count 689→690, and docs-cli-command-map (`attention` added to governed-command list + cli.mdx) | **VERIFIED.** QA ran `vitest-contract.test.js` + `docs-cli-command-map-content.test.js` alongside human-attention → **37/37 pass, exit 0**. The count bump and docs row are legitimate consequences of adding one governed command + one test file, not contract-gaming. |

## Section C: Architecture Invariants

| # | Invariant | Evidence | Status |
|---|-----------|----------|--------|
| 1 | Composition layer — reimplements no escalation/approval/intake logic | Delegates to `readHumanEscalations`, `findPendingApprovedIntents`, `isCredentialedExitGate`, `state.blocked_on`. Confirmed in source (imports + call sites). | PASS |
| 2 | Strictly read-only — never mutates state/escalations/intents/artifacts/config | `readGovernedStateReadOnly` parses without writeback. AT-HA-013: state/escalations/intents byte-identical, no `HUMAN_TASKS.md`, `.agentxchain` dir listing unchanged. | PASS |
| 3 | Empty queue ⇒ `overall:'clear'` (the govern-without-micromanaging proof) | `assembleReport` + AT-HA-001 + live CLI on this repo (`clear`, exit 0). | PASS |
| 4 | Every category evaluated independently — a throw/empty in one never suppresses another | `collect()` wraps each evaluator in try/catch and escalation/intent reads are individually isolated; a failing category cannot blank the queue. | PASS |
| 5 | CLI delegates entirely to the module — presentation only | `commands/attention.js` formats + sets exit code; all logic in `human-attention.js`. | PASS |

**Invariants: 5/5 PASS**

## Section D: Composition Verification (VISION.md:51) — live repo state

`agentxchain attention` (QA-run THIS turn) against `run_2929265fcbabe440` mid-QA-phase:

| Surface | Live result | Interpretation |
|---------|-------------|----------------|
| `attention` (default) | `Nothing needs your attention.` — exit 0 | No human decision is pending; the empty queue IS the operational proof of "govern without micromanaging." |
| `attention --json` | `{overall:'clear',items:[],items_count:0,blocking_count:0,categories:[],evidence_summary:"Nothing needs your attention; governed autonomy can run."}` — exit 0 | Schema-valid `HumanAttentionReport`; clear state. |
| `export` → `report --format json` | `subject.run.human_attention = {overall:'clear',items_count:0,blocking_count:0,categories:[]}` | Govern-by-exception summary embedded in the standard governance report. |

The non-empty paths (credentialed gate, escalation, approval, manual action, budget/policy, pending intent),
their priority ordering, and `action_hint`s are exercised by the 18-test suite (AT-HA-002..009, 010b, 012),
which QA re-ran green this turn. **VISION.md:51 addressed:** a single cross-run command answers "what needs
MY attention right now, and nothing else?" and is empty when the answer is "nothing."

## Section E: Regression Results (QA-Verified)

| Suite | Tests | Result | Exit |
|-------|-------|--------|------|
| human-attention.test.js | 18 | PASS | 0 |
| human-attention + vitest-contract + docs-cli-command-map (combined) | 37 | 0 failures | 0 |
| governance-report-content + report-cli + workflow-kit-report (report.js touchpoints) | 46 | 0 failures | 0 |

Commands run by QA (THIS turn, turn_92c39cb5177586c2):
- `npx vitest run test/human-attention.test.js` → 18 passed, exit 0
- `npx vitest run test/human-attention.test.js test/vitest-contract.test.js test/docs-cli-command-map-content.test.js` → 37 passed, exit 0
- `npx vitest run test/governance-report-content.test.js test/report-cli.test.js test/workflow-kit-report.test.js` → 46 passed, exit 0
- `node cli/bin/agentxchain.js attention` → `Nothing needs your attention.`, exit 0
- `node cli/bin/agentxchain.js attention --json` → schema-valid `HumanAttentionReport`, exit 0
- `node cli/bin/agentxchain.js export | report --format json` → `subject.run.human_attention` present (clear), exit 0
- **Gate-validator check** (the exact validator the run-completion gate runs): `evaluateWorkflowGateSemantics(root, '.planning/acceptance-matrix.md' | ship-verdict.md | RELEASE_NOTES.md)` → `{ ok: true }` for all three after this rewrite. See ship-verdict.md Section E.

**Limitation (declared, not hidden):** The full CLI suite (~690 test files / ~7700 tests) was initiated this
turn (`npx vitest run --exclude bug-54-real-claude-reliability`) but did **not** complete within the turn
budget; QA terminated it after 612 passing tests with **zero** `FAIL`/`✗` markers observed. Verification is
therefore scoped to the M15 blast radius (the 8 changed files) and its direct integration touchpoints — all
green above. This matches the accepted M14 QA precedent (surface-scoped verification). The one known
full-suite failure cited by the dev — `bug-54-real-claude-reliability.test.js` Scenario B, a 50 ms watchdog
timing assertion against the **real** Claude binary — is **outside M15's blast radius**: it imports none of
the 8 changed files (verified by grep), and `human-attention.js` is consumed only by `attention.js`,
`report.js`, and its own test. QA does **not** claim that test passes and did not run it (it requires the
live binary and is environment/timing-dependent).

## Section F: QA Findings

### Finding 1 (process, non-blocking, fixed): Stale QA artifacts — 10th consecutive run
All three QA artifacts referenced the prior milestone (M14, `run_74d17633499b410b`) instead of current M15
(`run_2929265fcbabe440`). Tenth consecutive run with this pattern. All three rewritten from scratch.
Root cause is unaddressed by M15 scope (QA artifacts are not run-scoped on creation). Recommend a future
intake item to scaffold per-run QA artifact stubs at phase entry. (Carried forward from M14 Finding 1.)

### Finding 2 (design, non-blocking) — OBJ-001: Report-path summary is a 3-of-6-category partial view
`buildHumanAttentionSummary` (human-attention.js:364-381) evaluates only the 3 state/config-derivable
categories (`approval`/`credentialed_gate`, `budget_policy`, `manual_action`) — it does NOT call
`evaluateEscalationCategory` or `evaluatePendingIntentCategory`. Consequence: the governance report's
`human_attention` summary can read `overall:'clear'` even when open escalations or pending approved intents
exist. This is **by design and documented** in the module (the report operates on a static export artifact,
not live filesystem state; the live `agentxchain attention` command surfaces the full 6-category queue), and
ROADMAP build item #4 only mandates `overall/items_count/blocking_count/categories` in the report summary —
so it does **not** block M15. But an operator relying solely on a report artifact (e.g. a CI-archived report)
could under-read the attention state. Logged for the decision trail; recommend a future enhancement to embed
escalation/intent counts into the export artifact so the report summary can reach all 6 categories.

### Finding 3 (maintainability, informational): Duplicated read-only-state helper
`readGovernedStateReadOnly` is copied from ship-status.js (DEC-004) rather than shared. Pragmatic for an
isolated read-only composition layer, but a future refactor could extract a single
`readGovernedStateReadOnly` into a shared module to avoid drift. Out of M15 scope.
