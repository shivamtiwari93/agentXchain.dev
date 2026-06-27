# Release Notes — M15: Govern Without Micromanaging — Human Attention Surface (VISION.md:51)

**Run:** run_2929265fcbabe440
**Turn:** turn_92c39cb5177586c2 (QA ship verdict)
**Date:** 2026-06-27

## Summary

Formal closure of ROADMAP.md M15: "Govern Without Micromanaging — Human Attention Surface (VISION.md:51)" —
the final unaddressed "Why This Must Exist" pain bullet, *"humans lose the ability to govern without
micromanaging."* A new read-only composition layer, `human-attention.js`, aggregates the scattered
human-decision triggers across runs into a single prioritized `HumanAttentionReport`, surfaced through the
new `agentxchain attention` CLI command and embedded in the governance report. The defining property:
when no human decision is pending the queue is **empty** (`overall: 'clear'`, exit 0, "Nothing needs your
attention") — the operational proof that a human can step back and let governed autonomy run without
micromanaging or blind trust (VISION.md:220).

## What Changed (This Run)

### New module — `cli/src/lib/human-attention.js`

`evaluateHumanAttention(repoDir)` composes the cross-run human-decision queue across **6** govern-by-exception
categories (exceeding the ≥5 floor), reaching each through its existing public surface — reimplementing none:

| Category | Source (composed, not reimplemented) | Blocking |
|----------|--------------------------------------|----------|
| `credentialed_gate` | `state.blocked_on` `human_approval:<gate>` + `isCredentialedExitGate` (approval-policy.js) | yes |
| `escalation` | `readHumanEscalations` (human-escalations.js), open records | yes |
| `approval` | `state.blocked_on` `human_approval:<gate>` (non-credentialed) / pending transition/completion | yes |
| `manual_action` | `state.blocked_on` `gate_action:<gate>` / `human:<detail>` | yes |
| `budget_policy` | `state.blocked_on` `budget:exhausted` / `policy:<id>` | yes |
| `pending_intent` | `findPendingApprovedIntents` (intake.js) | no (informational) |

Output is a `HumanAttentionReport` — `{ overall: 'clear' | 'attention', items[], items_count, blocking_count,
categories[], evidence_summary }` — with `items` deterministically ordered blocking-first, then by ascending
priority (credentialed-gate & escalation outrank plain approval outranks budget/policy; pending-intent last),
ties broken by `run_id` then `summary`. Each item carries a concrete `action_hint`. The module is strictly
read-only (reads state without writeback) and isolates every category so a failure in one never blanks the queue.

### New CLI command — `agentxchain attention [--json] [--all]`

The single govern-by-exception operator command answering "what needs MY attention right now, and nothing
else?" Default output lists only the blocking items, highest-priority first, each with its action hint;
informational pending-intents are summarized as a count unless `--all` is passed. `--json` emits the full
`HumanAttentionReport`. It is a **status surface, not a gate** — it exits 0 in both the clear and attention
states. When the queue is empty it prints `Nothing needs your attention.`

### Governance report integration — `cli/src/lib/report.js`

`buildGovernanceReport()` now embeds a `human_attention` summary (`overall`, `items_count`, `blocking_count`,
`categories[]`) in `subject.run`, beside the existing `ship_status` summary. (The report summary, operating on
a static export artifact, evaluates the 3 state/config-derivable categories; the live `agentxchain attention`
command surfaces the full 6-category queue — see ship-verdict.md OBJ-001.)

### Tests + contracts

- New `cli/test/human-attention.test.js` — **18 tests** (AT-HA-001..013 + 3 report-integration cases): clear
  queue, pending approval, open escalation, pending intent, credentialed gate, budget/policy, mixed-category
  ordering, `--json`/`--all` CLI, and the read-only invariant.
- Updated two contracts the new command + test file legitimately shifted: `vitest-contract.test.js`
  (test-file count 689→690) and `docs-cli-command-map-content.test.js` + `website-v2/docs/cli.mdx`
  (`attention` added to the governed-command map).

### ROADMAP.md M15 closed

Build items (lines 171-175) checked off by the dev with delivery+verification provenance; acceptance item
(line 176) checked off by this QA ship verdict.

## User Impact

- **Vision closure:** VISION.md:51 "humans lose the ability to govern without micromanaging" is now addressed.
  Instead of polling `status`, the dashboard, escalations, intents, and budget/policy state separately
  (micromanaging) or trusting blindly (forbidden by VISION.md:220), an operator runs one command:
  `agentxchain attention`.
- **Govern by exception:** the command shows ONLY what needs a human, highest-priority first, each with a
  concrete next action (`agentxchain approve-transition`, the escalation's own `agentxchain unblock <id>`,
  `agentxchain start`, …). When nothing is pending it says so and exits 0 — the empty queue is the proof you
  can step back.
- **Report visibility:** governance reports now carry a `human_attention` summary, so the attention state is
  visible in the standard report surface (state/config-derivable categories).
- **No breaking changes:** one new module, one new read-only command, one additive report field, 18 new tests,
  and two legitimate contract updates. The composition is read-only and reuses existing escalation/approval/
  intake evaluators.

## Verification Summary

QA independently ran (turn_92c39cb5177586c2):
- `npx vitest run test/human-attention.test.js` → **18/18 pass, exit 0**
- `npx vitest run test/human-attention.test.js test/vitest-contract.test.js test/docs-cli-command-map-content.test.js` → **37/37 pass, exit 0**
- `npx vitest run test/governance-report-content.test.js test/report-cli.test.js test/workflow-kit-report.test.js` → **46/46 pass, exit 0**
- `node cli/bin/agentxchain.js attention` → `Nothing needs your attention.`, **exit 0**
- `node cli/bin/agentxchain.js attention --json` → schema-valid `HumanAttentionReport` (clear), **exit 0**
- `agentxchain export | agentxchain report --format json` → `subject.run.human_attention` present (clear), **exit 0**

Result: **6/6 acceptance criteria pass, 5/5 architecture invariants confirmed, 5/5 dev decisions verified,
0 blocking issues.** Limitation declared: the full ~7700-test suite was initiated but did not complete within
the turn budget (QA terminated after 612 passing tests, 0 `FAIL` markers); verification scoped to the M15
blast radius (8 changed files) + report-integration touchpoints, per the accepted M14 precedent. The one
known full-suite failure (`bug-54-real-claude-reliability` Scenario B, a real-binary timing test) is outside
M15's blast radius and was not run. **Ship verdict: YES.**
