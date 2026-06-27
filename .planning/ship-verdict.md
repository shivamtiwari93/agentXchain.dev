# Ship Verdict — M15: Govern Without Micromanaging — Human Attention Surface (VISION.md:51)

**Run:** run_2929265fcbabe440
**Turn:** turn_92c39cb5177586c2 (Staff QA Engineer)
**Baseline:** git:e1c177be16581865652694aa4e236c411b328862
**Date:** 2026-06-27

## Verdict: YES

## Rationale

All 6 M15 acceptance criteria (derived from ROADMAP.md lines 171-176) independently verified by QA on
QA-run evidence. The surface — `human-attention.js` (`evaluateHumanAttention` composing **6** govern-by-
exception categories, exceeding the ≥5 floor), the `agentxchain attention` CLI (`--json` / `--all`,
exit 0 in both clear and attention states), and the `human_attention` governance-report summary — is
delivered, committed, and green: **18/18 human-attention tests**, **37/37** with the two contracts the dev
touched, and **46/46** report-integration tests, all exit 0, all re-run by QA this turn. The live CLI on
this repo prints `Nothing needs your attention.` and exits 0 — the empty queue that IS the operational
proof of "govern without micromanaging" (VISION.md:51). A real end-to-end `export → report` confirms
`subject.run.human_attention` is wired into the standard governance report. The module is strictly
read-only (AT-HA-013, byte-identical state) and reimplements no escalation/approval/intake logic. No
blocking issues.

## Acceptance Test Results

- **6/6 PASS** (AC-1 through AC-6) — see acceptance-matrix.md Section A
- AC-1: 6-category composition, read-only, delegates to existing primitives; 18/18 tests
- AC-2: `attention` CLI `--json`/`--all`, "Nothing needs your attention" + exit 0 when empty (live-verified)
- AC-3: empty→`clear`/zero items; non-empty→`attention` with deterministic blocking-first priority ordering
- AC-4: governance report `human_attention` summary present (real e2e export→report, clear)
- AC-5: regression suite covers all required scenarios; 18/18
- AC-6: prioritized ≥5-category queue, action_hint per item, composition over existing primitives → VISION.md:51

## Regression Results (QA-Verified)

| Suite | Tests | Result | Exit |
|-------|-------|--------|------|
| human-attention.test.js | 18 | PASS | 0 |
| human-attention + vitest-contract + docs-cli-command-map | 37 | 0 failures | 0 |
| governance-report-content + report-cli + workflow-kit-report | 46 | 0 failures | 0 |
| Live `attention` / `attention --json` / `export`→`report --format json` | n/a | clear, schema-valid, human_attention present | 0 |

**Limitation declared:** the full ~7700-test suite was initiated this turn but did not complete within the
turn budget (QA terminated it after 612 passing tests, **0** `FAIL` markers). Verification is scoped to the
M15 blast radius (8 changed files) + report-integration touchpoints — the accepted M14 precedent. The one
known full-suite failure (`bug-54-real-claude-reliability` Scenario B, a real-binary 50 ms watchdog timing
test) is proven outside M15's blast radius (imports none of the 8 changed files); QA did not run it and does
not claim it passes.

## Dev Decision Verification

| Decision | Status |
|----------|--------|
| DEC-001: credentialed/approval unified, mutually-exclusive classification | VERIFIED — no double-count (AT-HA-005/002) |
| DEC-002: escalation hint = record's own `resolution_command` (`agentxchain unblock <id>`) | VERIFIED — a correctness improvement over the ROADMAP example (AT-HA-003) |
| DEC-003: 6th `manual_action` category for `gate_action:`/`human:` blocks | VERIFIED — closes a real silent-drop gap |
| DEC-004: read-only state helper mirrored from ship-status.js | VERIFIED — Invariant #2 holds (AT-HA-013); minor duplication noted (Finding 3) |
| DEC-005: vitest-contract count 689→690 + docs-cli-command-map `attention` | VERIFIED — 37/37 green; legitimate consequences, not contract-gaming |

## Architecture Invariants

| Invariant | Status |
|-----------|--------|
| Composition layer — reimplements no escalation/approval/intake logic | CONFIRMED |
| Strictly read-only | CONFIRMED (AT-HA-013) |
| Empty queue ⇒ `overall:'clear'` | CONFIRMED (live + AT-HA-001) |
| Every category isolated — one failure never suppresses others | CONFIRMED |
| CLI delegates entirely to the module | CONFIRMED |

## Blocking Issues: 0

## Non-Blocking Findings (carried into the decision trail)

1. **Stale QA artifacts — 10th consecutive run (fixed):** all three artifacts referenced M14; rewritten for M15.
2. **OBJ-001 — report summary is a 3-of-6-category partial view:** `buildHumanAttentionSummary` omits escalations + pending-intents (static-export constraint, documented). The report's `human_attention` can read `clear` while live escalations exist. Per-spec for M15 (build item #4 mandates only the 4 summary fields); does not block. Recommend embedding escalation/intent counts into the export so the report can reach all 6 categories.
3. **Duplicated `readGovernedStateReadOnly` helper (informational):** copied from ship-status.js; future refactor could share it.

## Ship Decision

6/6 acceptance criteria pass. 18/18 + 37/37 + 46/46 tests, 0 failures, all QA-run, all exit 0. 5/5
invariants maintained. 5/5 dev decisions verified (including a genuine correctness improvement in the
escalation action-hint and a real silent-drop gap closed by the 6th category). Live CLI demonstrably answers
VISION.md:51 — the empty queue is the repo's actual state. The one non-blocking design finding (OBJ-001,
partial report summary) is per-spec and documented. ROADMAP M15 build items closed; acceptance line 176
checked off by this turn. **SHIP.**
