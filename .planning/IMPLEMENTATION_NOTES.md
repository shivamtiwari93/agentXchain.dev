# Implementation Notes — M15: Govern Without Micromanaging — Human Attention Surface — Vision Closure (VISION.md:51)

**Run:** `run_2929265fcbabe440`
**Turn:** `turn_9d23289f5ea9873b`
**Role:** dev
**Runtime:** `local-opus-4.8-ultra`
**Date:** 2026-06-27
**Baseline:** git:e84671ed2 (HEAD of dogfood/2157-lights-out)

---

## Challenge to Previous Turn

The previous accepted turn is the PM signoff for M15 (`turn_fd0c9ed117cd5d23`). I did **not** rubber-stamp it — I verified every compose-target API the spec named actually exists with the claimed signature **against current source** before writing a line of the module, because prior planning turns in this project have repeatedly handed Dev dead-end symbols:

- `governed-state.js` — there is **no exported `readState(root)`** despite the spec's reference to "governed-state.js `readState(root)`". State is a plain JSON file; ship-status.js reads it via a private `readGovernedStateReadOnly` helper. I reproduced that read-only helper rather than invent an export. The `blocked_on` encodings the spec cited are real: `human_approval:<gate>` (governed-state.js:2222), `budget:exhausted` (:868), `policy:<id>` (:691).
- `human-escalations.js` — `readHumanEscalations(root)` (:316) returns materialized records each carrying `status` (`'open'`/`'resolved'`) and a real `resolution_command` of the form `agentxchain unblock <escalation_id>` (:369). The spec's suggested `escalate --resolve <id>` hint does **not** match the code; I used the record's own `resolution_command` so the action hint is the command that actually resolves it.
- `intake.js` `findPendingApprovedIntents(root, {run_id})` (:687), `approval-policy.js` `isCredentialedExitGate(config, phase)` (:57) — both exported as claimed and used as-is.
- `report.js` `buildGovernanceReport` operates on an **export artifact**, not a live repo — so I mirrored `buildShipStatusSummary(artifact)` with an artifact-scoped `buildHumanAttentionSummary(artifact)` rather than calling the live `evaluateHumanAttention`.

## Changes

### New: `cli/src/lib/human-attention.js`
Govern-by-exception composition layer (Architecture Invariants #1–#7). Read-only; composes existing modules, reimplements no escalation/approval/intake logic.

- `evaluateHumanAttention(repoDir)` → `HumanAttentionReport` `{ overall, items[], items_count, blocking_count, categories[], evidence_summary }`. Each item: `{ category, priority, blocking, run_id, summary, action_hint }`. `overall === 'clear'` **iff** `items.length === 0`.
- **6 exception categories** (spec floor is 5), each an independently-exported pure evaluator:
  1. `evaluatePendingApprovalCategory(state, config)` — pending human-approval gate from `blocked_on` `human_approval:<gate>` / `pending_phase_transition` / `pending_run_completion`. **Categories 1 & 4 unified:** the same pending decision is classified as `credentialed_gate` when the phase's exit gate is credentialed (`isCredentialedExitGate`), else `approval` — mutually exclusive, so one decision is never double-counted while still honouring the ordering contract.
  2. `evaluateEscalationCategory(escalations)` — open records from `readHumanEscalations`; action hint = each record's own `resolution_command`.
  3. `evaluateBudgetPolicyCategory(state)` — `budget:exhausted` / `policy:<id>` blockers.
  4. `evaluateManualActionCategory(state)` — **bonus** category catching the remaining human-owned `blocked_on` encodings (`gate_action:<gate>`, `human:<detail>`) so a blocked run is never silently dropped.
  5. `evaluatePendingIntentCategory(intents)` — informational (non-blocking) approved-but-undispatched intents from `findPendingApprovedIntents`.
- **Deterministic Ordering contract:** priorities `credentialed_gate(10) < escalation(20) < approval(30) < manual_action(35) < budget_policy(40) < pending_intent(100)`; blocking categories all `< 100` and informational `>= 100`, so the blocking-first sort plus priority/`run_id`/`summary` tiebreak yields a stable order matching SYSTEM_SPEC §"Ordering contract".
- **Category isolation (Invariant #4):** each category runs inside a `collect()` try/catch; a throw or empty in one never blanks the rest of the queue.
- `buildHumanAttentionSummary(artifact)` — artifact-scoped summary (`overall`, `items_count`, `blocking_count`, `categories[]`) for report integration; evaluates only the state/config-derivable categories (the live command surfaces escalations/intents).

### New: `cli/src/commands/attention.js` + registration in `cli/bin/agentxchain.js`
`agentxchain attention [--json] [--all] [--dir]`. Presentation only — delegates all logic to the module (Invariant #6). Empty queue ⇒ prints "Nothing needs your attention." and **exits 0**; attention state also exits 0 (status surface, not a gate). `--json` always emits the full schema-valid `HumanAttentionReport`. Default view lists blocking items first with each item's `action_hint`; informational pending-intent items are summarized as a count unless `--all`.

### Modified: `cli/src/lib/report.js`
Imports `buildHumanAttentionSummary` and adds `human_attention` to the governed-run subject in `buildRunSubject()`, immediately after `ship_status` (AC-5).

### Tests + contracts
- New `cli/test/human-attention.test.js` — 18 tests covering AT-HA-001…013 plus report-integration (`buildHumanAttentionSummary`) cases.
- Updated `cli/test/vitest-contract.test.js` (test-file count 689 → 690, bumped by the new test file).
- Updated `cli/test/docs-cli-command-map-content.test.js` (added `attention` to the governed-command list + row mapping) and `website-v2/docs/cli.mdx` (added the `attention` command-map row) — both required because adding a governed CLI command is gated by the docs-coverage contract.

## Verification

- `npx vitest run test/human-attention.test.js` → **18/18 pass** (AT-HA-001…013 + integration).
- `npx vitest run test/docs-cli-command-map-content.test.js test/vitest-contract.test.js` → **19/19 pass** (the two count/coverage contracts my new command + test file touched).
- `npx vitest run test/ship-status.test.js test/governance-report-content.test.js test/report-cli.test.js test/e2e-builtin-json-report.test.js test/workflow-kit-report.test.js` → **all pass** (report integration intact, no regression).
- End-to-end report integration: built a valid run export via `buildRunExport` on a budget-blocked fixture and confirmed `report.subject.run.human_attention === { overall:'attention', items_count:1, blocking_count:1, categories:['budget_policy'] }`.
- Live CLI smoke on this repo: `agentxchain attention` → "Nothing needs your attention." exit 0; `--json` → schema-valid `{ overall:'clear', items:[], ... }` exit 0.
- **Full suite** (`npx vitest run`, 690 files / 7711 tests, ~34 min): **7708 passed, 3 failed** at first run. Two failures were the count/coverage contracts my change legitimately shifted (`vitest-contract` 689→690, `docs-cli-command-map` missing `attention`) — both fixed and re-verified green.

### Known pre-existing failure (NOT a regression)
`test/beta-tester-scenarios/bug-54-real-claude-reliability.test.js` › Scenario B fails on this machine: it fires a **50ms watchdog against the real `claude` binary** expecting `no_subprocess_output` on all 10 iterations, but a fast/idle machine lets `claude --version` emit stdout within 50ms on some iterations (iter 5 here). Proven outside M15's blast radius: (a) the file is not among my 5 changed files; (b) its import graph is `local-cli-adapter.js`, `claude-local-auth.js`, `dispatch-bundle.js`, `turn-paths.js` — none of which I touched and none of which import `human-attention`/`attention`/`report`; (c) it fails identically in isolation with my changes present. This is an environment/timing-dependent real-binary test (its own docstring notes it is gated on the local `claude` binary).

## Acceptance Mapping

| AC | Evidence |
|----|----------|
| AC-1 (`evaluateHumanAttention` ≥5 categories) | Module ships 6 categories; AT-HA-001…009 pass |
| AC-2 (`attention` CLI `--json`/`--all`, exit 0 both states) | AT-HA-010, 010b, 011, 012 pass |
| AC-3 (govern-by-exception: empty⇒clear; non-empty⇒deterministic order) | AT-HA-001, 008, 008b, 010 pass |
| AC-4 (each item has concrete `action_hint`) | AT-HA-002…007 assert `action_hint`; `--json` schema test asserts the field on every item |
| AC-5 (report `human_attention` section) | report.js integration + e2e export check + integration tests pass |
| AC-6 (read-only) | AT-HA-013 (state/escalations/intents byte-identical; no `HUMAN_TASKS.md` created) |
| AC-7 (tests pass, 0 failures) | 18/18 human-attention; contract fixes green; only the unrelated pre-existing bug-54 real-claude timing test fails |
| AC-8 (vision closure VISION.md:51) | QA ship verdict — left for QA |

## Notes for QA

- Run `cli/test/human-attention.test.js` (18) and the full suite. Expect the single pre-existing `bug-54-real-claude-reliability.test.js` Scenario B timing failure (real-`claude` watchdog, env-dependent) — confirm it reproduces on baseline / is unrelated to M15, exactly as documented above.
- Verify the empty-queue path on a clean repo: `agentxchain attention` prints "Nothing needs your attention." and exits 0.
- Verify ≥5 categories each yield a correct item + concrete `action_hint`; confirm deterministic ordering (AT-HA-008) and read-only (AT-HA-013).
- ROADMAP M15 acceptance line (176) is intentionally left unchecked for your ship verdict.
