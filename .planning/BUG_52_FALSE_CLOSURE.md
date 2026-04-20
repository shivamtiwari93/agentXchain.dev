# BUG-52 False Closure Retrospective

**Closed as fixed in:** v2.147.0 (commit `31e53de2 fix(governed): reconcile phase gates before redispatch`)
**Reopened by:** tester report #19 against v2.147.0
**Status:** 8th false closure of the 2026-04-18/20 beta cycle; the first false closure to slip past rule #9 (packaged claim-reality preflight). Drove the addition of discipline rule #13 (command-chain integration tests mandatory for CLI workflow bugs).

## What the fix actually covered

`31e53de2` introduced `reconcilePhaseAdvanceBeforeDispatch()` in `cli/src/lib/governed-state.js:2523` and wired it into `cli/src/commands/resume.js:274` and `cli/src/commands/step.js:325`. On the `resume` path, it:

1. Requires `state.status === 'active'` and `getActiveTurnCount(state) === 0` (i.e. after `reactivateGovernedRun` has cleared the `blocked` status but before any new turn is dispatched).
2. Requires `state.last_gate_failure.gate_type === 'phase_transition'`.
3. Uses `findHistoryTurnRequest(history, last_gate_failure.requested_by_turn || last_completed_turn_id, 'phase_transition')` to look up the PM/QA turn that asked to exit the phase.
4. Re-runs `evaluatePhaseExit()` against the refreshed tree and, if the action is `advance`, writes the next phase, clears `last_gate_failure` / `pending_phase_transition`, marks the gate `passed`, retires phase-scoped approved intents, and emits `phase_entered` with `trigger: "reconciled_before_dispatch"`.
5. For the `awaiting_human_approval` branch it pauses into `pending_phase_transition` and immediately calls `approvePhaseTransition()`.

The qa→launch lane got the same treatment via the `qa_ship_verdict` gate.

## Why the packaged preflight was green

- Unit test `cli/test/governed-state-phase-reconcile.test.js` drives `reconcilePhaseAdvanceBeforeDispatch()` directly. Green.
- Tester-sequence scenario `cli/test/beta-tester-scenarios/bug-52-gate-unblock-phase-advance.test.js` stages a PM result, runs `accept-turn --checkpoint` as a child process, then `escalate`, then `unblock` — asserts `state.phase === 'implementation'` and the new dispatch's `assigned_role === 'dev'`. Green.
- Claim-reality preflight re-runs the same scenario against the packaged tarball with a block-scoped semantic guard (`extractScenarioItBlock`). Green.

All three layers exercised the same code path end-to-end. The tester still reproduced the false loop.

## Why the tester reproduced it anyway

Two structural divergences between the tester's invocation sequence and every test layer we shipped:

1. **`accept-turn --checkpoint` (combined) vs `accept-turn` → `checkpoint-turn` (separated).** Tester's `run_5fa4a26c3973e02d`: PM accepted at `11:11:43`, then a *separate* `checkpoint-turn` ran at `11:11:48` (five seconds later). Our tester-sequence test uses the `--checkpoint` flag, which calls `checkpointAcceptedTurn()` inline in `accept-turn.js:171` against the turn-id that acceptance just produced. The separated path takes a fresh state snapshot, re-resolves the target turn from disk, and exits through a different post-condition branch. Nothing in the v2.147.0 test matrix exercises the two-invocation path — even though the tester's report explicitly shows it. That is a discipline-rule-#13 gap (command-chain integration) *plus* a rule-#11 gap (realistic state): the state after `accept-turn` alone is not the state after `accept-turn --checkpoint`, and neither is the state after the two-command sequence once the reconcile reads `state.last_gate_failure.requested_by_turn` and `last_completed_turn_id` across the gap.
2. **`last_gate_failure.gate_type` carried through `unblock → resume`, but only for the in-memory fixture.** The test fixture writes a fresh governed project, runs one PM turn, accepts, escalates, and unblocks — total lifetime ~seconds, single gate failure on record. The tester's repo carries accumulated state: prior phase transitions, a prior approved PM turn, and (as tester evidence showed) a populated `last_gate_failure` whose `requested_by_turn` may not equal the turn id `findHistoryTurnRequest` picks up when history is long. If `findHistoryTurnRequest` returns an entry whose `phase_transition_request` is null (because the declaration lived on a different turn in the chain), the early-return at line 2564 fires and `advanced: false` — which is exactly the observed "next dispatch is another PM in planning" symptom.

## The discipline failure this represents

Same shape as BUG-36/39/40/41: the test exercised the code path but not the tester's command chain. Rule #9 (packaged preflight) was necessary but not sufficient because the packaged binary ran the same *test* the source tree did. What was missing is the tester's **exact** invocation sequence against a repo with the tester's **exact** accumulated state. Rule #13 now codifies the first half of this (command-chain integration mandatory). The second half — realistic state beyond single-turn fixtures — was already rule #11 but was applied narrowly to intent-scope bugs and not to phase-gate bugs.

## What the v2.148.0 fix must do

1. **Test the separated chain.** Extend `bug-52-gate-unblock-phase-advance.test.js` (or add a sibling scenario) to invoke `accept-turn` *without* `--checkpoint`, then `checkpoint-turn` as a separate child process, then `escalate`, then `unblock`. Assert the same final state. If this test fails on HEAD, we have reproduced the tester's failure in CI — that is the gate for any fix.
2. **Seed realistic accumulated state.** Use `createLegacyRepoFixture()` (or extend it) to create a repo with a prior completed phase transition, a prior accepted PM turn, and a populated history before the scenario under test. Confirm `last_gate_failure.requested_by_turn`, `last_completed_turn_id`, and the PM turn's `phase_transition_request` all align correctly under the reconcile path.
3. **Harden the lookup.** If the reconcile currently picks up a history entry whose `phase_transition_request` is null even though the CURRENT accepted turn declares one, fall back to `state.last_accepted_turn_id` or iterate backwards through history for the most recent turn with `phase_transition_request` set. Do not depend on a single id resolving to the declaring turn.
4. **Explicit unblock-side advance.** The cleaner alternative floated in `HUMAN-ROADMAP.md` BUG-52 notes: make `unblock` itself advance phase when the resolved escalation was a phase-transition gate AND the gate now passes. This eliminates the reliance on `resume` re-reading the right history entry.
5. **Command-chain test for the qa→launch lane, separated.** Same shape as (1), but for `qa_ship_verdict`.

## Closure gate

Per rules #12 and #13 together: BUG-52 cannot close without the beta tester's own command chain — `accept-turn` → `checkpoint-turn` → `unblock` → (implicit resume) → next turn — producing `assigned_role === 'dev'` in `implementation` (and `launch` for the qa lane) on a shipped tarball, quoted verbatim.
