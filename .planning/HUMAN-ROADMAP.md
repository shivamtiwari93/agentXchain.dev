# Human Roadmap — AgentXchain

Human-prioritized work for the agents.

Rules:
- Agents should read this file before acting.
- Unchecked items here take priority over general exploration in `AGENT-TALK.md`.
- When an item is complete, agents should mark it complete and briefly record what changed.
- If an item is too large, agents should split it into smaller checklist items and work them down in order.
- Only move an item back to `HUMAN_TASKS.md` if it truly requires operator-only action.

Current focus: **P1 bug cluster #9 — BUG-36 false closure on v2.135.0, plus non-progress guard + intent migration gaps.** Fourth false closure in this beta cycle. The BUG-36 fix shipped with a regex that doesn't match real gate reasons, so the validator does nothing on the actual operator flow. Full verbatim report in `HUMAN-ROADMAP-ARCHIVE.md` under "Beta-tester bug report #9 (2026-04-18)". This is the discipline problem the roadmap has been flagging for days — agents are still writing tests that pass on synthetic inputs while the real flow breaks.

## Priority Queue

- [x] **BUG-37: REOPEN BUG-36 — gate_semantic_coverage regex doesn't match real gate reason format (confirmed false closure)** — Fixed in Turn 198: `evaluatePhaseExit()`/`evaluateRunCompletion()` now return structured `failing_files`; `gate_semantic_coverage` consumes that field directly instead of regex-parsing `reasons`; `cli/test/beta-tester-scenarios/bug-36-gate-semantic-coverage.test.js` now reproduces the real semantic emission; `cli/test/beta-tester-scenarios/bug-37-gate-semantic-real-emissions.test.js` covers all real file-emission shapes; retrospective written in `.planning/BUG_36_FALSE_CLOSURE.md`. — Verified at `cli/src/lib/governed-state.js:3170-3175`. The two regexes (`(?:Required file missing|file): ([^\s,]+)` and `^([^\s:]+\.md):`) only match paths followed by a literal `:`. The actual gate reason emitted by the framework is `.planning/IMPLEMENTATION_NOTES.md must define ## Changes before implementation can exit.` — no colon after the filename. Result: `failingFiles` stays empty, `uncoveredFiles.length > 0` is always false, validator never fires, turns get accepted despite not touching the gated file. Exactly what BUG-36 was supposed to prevent.
  - **Required actions:**
    1. Write `false_closure` retrospective `.planning/BUG_36_FALSE_CLOSURE.md`. Specifically: what did BUG-36's tester-sequence test assert? What input format did it use? Why didn't it use the real gate emission format?
    2. Tester-sequence test must be updated (or a new one added) that uses the EXACT gate reason format produced by `evaluatePhaseExit` for semantic failures. Do not synthesize a fake reason. Call the real gate evaluator.
    3. Rewrite the file-path extraction to handle all real-world emission formats. Options:
       - Broader regex: `/^([^\s:]+\.md)(?:\s|:|$)/` — matches file followed by whitespace, colon, or end-of-line
       - Structured approach (preferred): `evaluatePhaseExit` should return `failing_files` as a first-class field on its result object. The validator consumes that field directly instead of regex-parsing prose reasons. This eliminates the format-drift risk permanently.
    4. Add assertions against all gate-semantics emission paths. Grep `workflow-gate-semantics.js` and adjacent modules for every place that produces a failure reason mentioning a file. Each one must be exercised by a tester-sequence test.
  - **Acceptance:** beta tester's exact reproduction sequence (gate fails on "IMPLEMENTATION_NOTES.md must define ## Changes", dev proposes `qa` without editing the file) results in a rejected turn with the specific `gate_semantic_coverage` error naming the file.

- [x] **BUG-38: No convergence guard — framework accepts N consecutive turns that don't reduce the same gate failure** — Fixed in Turn 199: `acceptGovernedTurn()` now proactively evaluates the current phase exit gate after every accepted turn (not just on phase transition requests). Tracks `non_progress_signature` and `non_progress_count` on state. When N consecutive accepted turns leave the same gate failure intact without modifying the gated files, blocks with `non_progress` category and emits `run_stalled` event. `reactivateGovernedRun()` with `acknowledge_non_progress` resets the counter. Default threshold: 3, configurable via `run_loop.non_progress_threshold`. Config passthrough fields (`gate_semantic_coverage_mode`, `intent_coverage_mode`, `run_loop`) now survive normalization. Tester-sequence test: `cli/test/beta-tester-scenarios/bug-38-non-progress-convergence-guard.test.js` (3 assertions). — Missing capability entirely, not a regression. Tester observed 5+ accepted dev turns (`turn_48b1c08ef3905243`, `turn_494964a9db3924e0`, `turn_67d4624e95eabff1`, `turn_40a159d90975714c`, `turn_f38c0b19b70c8cf6`) all leaving the same `## Changes` gate failure intact, never escalating, never stopping the loop. Even after BUG-37 lands (strict rejection), the framework should detect non-progress patterns for additional safety.
  - **Fix requirements:**
    - Track `gate_failure_signature` across accepted turns: hash of (gate_id + sorted failing_files + sorted failure_reasons).
    - When N consecutive accepted turns produce the same signature AND the gated file wasn't modified (delta of gated file = 0), emit a `run_stalled` event and transition run status to `needs_human` with escalation reason "Non-progress detected: <N> accepted turns have not reduced gate failure <gate_id>."
    - `N` must be configurable with a sane default (suggest 3). Name: `run_loop.non_progress_threshold`.
    - Non-progress escalation must be visible in `status`, `doctor`, and `agentxchain events` as a first-class blocker.
    - Operator resolution command: `agentxchain unblock-run <run_id> --acknowledge-non-progress` to reset the counter after fixing the underlying issue manually.
    - Tester-sequence test: dispatch 3 dev turns that all decline to modify the gated file, verify the 3rd one triggers the non-progress block, verify `unblock-run` resumes.
  - **Acceptance:** a repo in the tester's exact state cannot accept more than `N` turns with the same gate failure before the framework escalates.

- [x] **BUG-39: Cross-run intent migration doesn't run against pre-existing intent files — `approved_run_id: null` in on-disk JSON for pre-BUG-34 repos** — Fixed in Turn 199: `initializeGovernedRun()` now archives pre-BUG-34 intents (`approved_run_id: null`) with `status: "archived_migration"` instead of silently adopting them. Emits `intents_migrated` event with count and IDs. Returns `migration_notice` for CLI display. `archiveStaleIntents()` in intake.js updated with same behavior. Tester-sequence test: `cli/test/beta-tester-scenarios/bug-39-intent-migration-null-run-id.test.js` (3 assertions). Updated BUG-34 regression test to match new archival behavior. Updated dispatch-path-lifecycle-matrix and intake-manual-resume tests for BUG-39 compatibility. — Confirmed from tester evidence: older intent files at `.agentxchain/intake/intents/*.json` still have `approved_run_id: null` and `run_id: null`. BUG-34's fix stamps these fields on NEW approvals but did not run a migration pass to populate them for existing intent files. Result: continuous mode still picks up stale intents from before the BUG-34 fix landed.
  - **Fix requirements:**
    - On `agentxchain run`/`restart`/`resume`/`continuous` startup, scan `.agentxchain/intake/intents/*.json`. For any `approved` intent with `approved_run_id: null`:
      - If the intent has an associated `run_id` field (some may), use that
      - Otherwise, archive it with an explicit migration note: `status: "archived_migration"`, `archived_reason: "pre-BUG-34 intent with no run scope; archived during v2.X.Y migration"`
      - Do NOT silently re-bind to current run — operator should see the archival and explicitly re-inject if the work is still needed
    - Emit `intents_migrated` event with count of archived intents and their IDs.
    - Add a CLI notice at startup when migration runs: "Archived N pre-BUG-34 intents. Review: agentxchain intake status --archived."
    - Tester-sequence test: seed a repo with intent files having `approved_run_id: null` (matching the tester's actual on-disk state), run `agentxchain run`, verify migration runs and those intents no longer appear as queue candidates.
  - **Acceptance:** tester's repo can run `agentxchain run --continuous` without hitting "Found queued intent: intent_1776473633943_0543 (approved) → Continuous start error" because the old intents have been migrated to archived status.

### Implementation notes

- **This is the 4th false closure pattern in this beta cycle.** BUG-17/19/20/21 (v2.130.1), BUG-36 (v2.135.0), and the ongoing coverage-gap pattern across beta reports 6/7/8/9. The discipline rules have not been enough. Two structural fixes required alongside BUG-37/38/39:
  1. **Mandatory: use REAL emission formats in tester-sequence tests.** Any test that asserts on error messages, gate reasons, or event payloads must call the real emitter, not construct synthetic strings. Add a lint rule or guard test that fails if a beta-tester-scenario test uses hardcoded reason strings instead of calling the production code path.
  2. **Mandatory: add a "claim-reality" gate to release preflight.** For every BUG-N marked "fixed," the preflight must run the tester-sequence test against the shipped CLI binary (not the source tree) and verify the fix holds end-to-end. This catches the "built from source passes, published binary fails" class of bug.
- **Ordering:**
  1. BUG-37 first as v2.135.1 patch — highest-impact, single-file regex fix, unblocks the tester's immediate loop
  2. BUG-39 next — unblocks continuous mode for tester's existing repo state
  3. BUG-38 after — adds the defense-in-depth non-progress guard that would have caught BUG-37 symptoms anyway
- **Internal postmortem required:** `.planning/BUG_36_FALSE_CLOSURE.md` AND extend the existing `BUG_31_33_COVERAGE_GAP_POSTMORTEM.md` with the fourth false-closure entry and the two new structural discipline rules above.
- **Do not broadcast.** The fix ships as v2.135.1 with a matter-of-fact release note: "Fixed gate semantic coverage validator to handle all gate reason formats." No acknowledgment of the false-closure pattern in public surfaces.

- [x] **BUG-34: Continuous mode aborts on stale cross-run intents — "existing planning artifacts would be overwritten"** — Fixed in Turn 191: `approved_run_id` stamped on approval, `findNextDispatchableIntent`/`findPendingApprovedIntents` accept `{ run_id }` for scoping, continuous mode passes `session.current_run_id`, run init archives stale intents from prior runs and adopts pre-run intents. Tester-sequence test: `cli/test/beta-tester-scenarios/bug-34-cross-run-intent-leakage.test.js` (3 assertions). — Verified gap. `governed-state.js:2667` reads intent_id from turn context but no code path archives or filters intents from prior runs. Old intents (`intent_1776473633943_0543`, `intent_1776474414878_c28b` from the tester's first run) still appear in the queue for a later run and `continuous-run.js` picks them up, tries to plan, and aborts with the existing-artifacts error.
  - **Root cause:** intent queue is repo-scoped, not run-scoped. When a new run starts (`run_c8a4701ce0d4952d`), old `approved` intents from previous runs are still visible because the lifecycle didn't mark them `consumed` / `superseded` / `run_bound`.
  - **Fix requirements:**
    - Intents must carry the `run_id` they were approved under, OR explicitly be marked `cross_run_durable` when intended to survive run boundaries.
    - Continuous mode must only consider intents bound to the current run OR explicitly marked cross-run-durable.
    - When a run completes, its run-bound intents (whether satisfied or not) must transition to a terminal state — NOT remain visible as `approved` forever.
    - Retroactive migration: on next `run` / `restart` / `resume`, scan the intent queue. Any `approved` intent without a `run_id` and without `cross_run_durable: true` must be explicitly archived or prompted-for-disposition (default: archive). Do NOT silently delete.
    - Add a tester-sequence test: 2 consecutive runs, inject intent in run 1, complete run 1, start run 2 with `--continuous`, verify run 1's intent doesn't poison run 2's queue.
  - **Acceptance:** continuous mode on `run_c8a4701ce0d4952d` ignores `intent_1776473633943_0543` (from an earlier run) and operates only on the current run's unresolved work.

- [x] **BUG-35: Retry prompts surface rejection reason but don't re-bind the injected repair intent — dev keeps re-running verification instead of editing the gated file** — Fixed in Turn 191: reordered retry PROMPT.md sections so "Previous Attempt Failed" (gate failure) renders BEFORE "Active Injected Intent" (repair guidance). `intake_context` was already preserved via spread in retry turns. Tester-sequence test: `cli/test/beta-tester-scenarios/bug-35-retry-intent-rebinding.test.js`. — Verified gap. BUG-13's fix added intent charter to the initial dispatch bundle. The retry path was not covered. The tester's retry prompt includes "Previous attempt failed. Reason: Did not address implementation_complete gate semantic or pending narrow intent" but does NOT include the intent's charter/acceptance contract verbatim. Result: dev agent sees "previous attempt failed" but not WHAT to fix, so it optimizes for fresh verification instead.
  - **Fix requirements:**
    - The retry dispatch bundle must re-embed the same `### Active Injected Intent` section that the initial dispatch bundle carries (per BUG-13's acceptance criteria).
    - If the prior turn was rejected with a gate-semantic reason (e.g., `.planning/IMPLEMENTATION_NOTES.md must define ## Changes`), that reason must be surfaced as a first-class section in the retry bundle, not buried in a "previous attempt failed" line.
    - If both an injected intent AND a gate failure exist, the retry bundle must include BOTH as top-of-prompt governing instructions. Order: gate failure first (it's the blocker), then injected intent (the operator's narrow repair guidance).
    - Add a tester-sequence test: inject narrow repair intent → dispatch dev → dev ignores the narrow path → reject → verify retry bundle contains both the rejection reason AND the intent charter verbatim.
  - **Acceptance:** after a dev turn is rejected for not addressing a gate semantic, the retry `PROMPT.md` contains the exact gate failure reason AND the injected intent's acceptance contract in the governing-instructions section.

- [x] **BUG-36: Turn validator allows claiming QA transition when the gated file wasn't touched semantically** — Fixed in Turn 191: added `gate_semantic_coverage` validator stage in acceptance flow. Pre-evaluates the exit gate; if failing AND the gated files are not in `files_changed`, rejects with actionable error. Strict mode by default, lenient via `gate_semantic_coverage_mode`. Tester-sequence test: `cli/test/beta-tester-scenarios/bug-36-gate-semantic-coverage.test.js`. — Verified gap. No validator in `gate-evaluator.js` or adjacent modules checks: if gate failed on file X for semantic reason Y, did this turn's `files_changed` actually include file X? The tester observed dev turns (`turn_48b1c08ef3905243` et al) summarizing as "ready for QA handoff" with `files_changed` showing only the staged turn-result file — no repo artifact edits — and proposing `qa` transition while the gate was still failing on `.planning/IMPLEMENTATION_NOTES.md`.
  - **Fix requirements:**
    - When acceptance runs, if the turn proposes a phase transition AND a gate for that transition is failing AND the gated file is NOT in `files_changed`, the turn must be rejected with a structured error: "Gate `<gate_id>` is failing on `<file>`. Your turn did not modify that file. Either edit the file to satisfy the gate, or remove the phase transition request."
    - This is a new validator stage: `gate_semantic_coverage`. Follows the pattern of BUG-1's `artifact_observation` and BUG-14's `intent_coverage`.
    - Strict mode (default): reject. Lenient mode: warn.
    - Add a tester-sequence test: gate fails on `IMPLEMENTATION_NOTES.md` → dev turn doesn't edit it → dev proposes `qa` transition → verify acceptance rejects with the specific gate_semantic_coverage error.
  - **Acceptance:** a dev turn that proposes phase transition while the gated file isn't in its `files_changed` gets rejected with an actionable error naming the file and the gate.

### Implementation notes

- **Ordering:** BUG-34 blocks continuous mode for every existing repo with historical intents — ship first as a patch release (e.g., v2.134.2). BUG-35 and BUG-36 are complementary (binding on dispatch + enforcing on acceptance) and should ship together as v2.135.0 or similar.
- **Coverage gap pattern continues:** this is the third beta-tester report where the tester-sequence suite missed a real operator flow. BUG-20/BUG-29 covered within-run intent lifecycle; BUG-13 covered initial-dispatch intent binding; BUG-14 covered intent coverage validation. None of them covered (a) cross-run intent leakage, (b) retry-dispatch intent re-binding, (c) gate-semantic file coverage. Add a standing item to the coverage audit in `BUG_31_33_COVERAGE_GAP_POSTMORTEM.md`: **every dispatch path × every lifecycle stage must have a tester-sequence test.** Enumerate the matrix. What combinations are still uncovered?
- **Secondary UX issues mentioned by tester (NOT separate items):** status showing turn as running after acceptance, stdout.log missing when CLI printed its path, restart aggressively reassigning. If these reproduce on v2.134.1, roll them into the same patch release. If not reproducible, note in the postmortem and move on.
- **Tester-sequence tests committed FIRST** (discipline rule #6). Failing tests must be on main before the fix commits land.
- **Do not broadcast.** Ship quietly. The proof is a fresh live run of `run --continuous` on a repo with historical intents that successfully continues the current initiative without stale-queue poisoning.

- [x] **BUG-31: `accept-turn --resolution human_merge` is a no-op from the operator's perspective — transitions substate but provides no documented completion path** — Fixed in Turn 158: `human_merge` now accepts the current staged result in one invocation, records `conflict_resolution_selected` + `conflict_resolved`, emits `conflict_resolved`, and is covered by `cli/test/beta-tester-scenarios/bug-31-human-merge-completion.test.js`. Either:
  - **Option A (preferred):** `human_merge` actually merges in a single step — take the active turn's staged result as authoritative if the operator explicitly opts into this resolution, record `resolution_chosen: human_merge` in the decision ledger, emit a `conflict_resolved` event, and advance the turn to `accepted` with appropriate merged-state provenance.
  - **Option B:** if a two-step flow is intended (`human_merge` → operator edits → `accept-turn --complete-merge`), ship the completion command, surface it in the conflict banner output, and document it in `docs/recovery.mdx`.
  - **Either way:** the operator must have a deterministic path from "conflict detected" to "turn accepted" without manual JSON editing. Add a tester-sequence test covering the exact beta-tester flow (dispatch planning repair → conflict detected → `accept-turn --resolution human_merge` → expect turn in `accepted` status, not `conflicted`).
  - **Acceptance:** `accept-turn --resolution human_merge` on a conflicted turn returns a terminal outcome in one invocation — accepted, or a clear actionable next step.

- [x] **BUG-32: Iterative revisions of durable planning artifacts across turns are treated as destructive conflicts** — Fixed in Turn 158: acceptance overlap now classifies PM-owned planning rewrites as `forward_revision` instead of destructive conflict, records `forward_revision_accepted`, and covers the stale-assignment case in `cli/test/governed-state.test.js`. The beta tester's PM repair turn correctly updated `.planning/SYSTEM_SPEC.md` and `.planning/command-surface.md` to satisfy the planning gate. The framework detected 100% overlap with prior accepted PM history on those same files and raised a conflict. **This is the wrong default.** Planning files are supposed to evolve across turns; that's the job. Treating every modification of a previously-accepted file as a conflict makes iterative planning impossible.
  - **Fix requirements:**
    - Conflict detection logic at `cli/src/lib/governed-state.js:1139` uses overlap ratio to suggest resolution. The overlap-based heuristic is not the right signal for durable artifacts owned by a single role across turns. When role X's current turn modifies a file that role X previously modified in an accepted turn, that's **forward revision**, not a conflict.
    - Add explicit distinction between **forward revision** (same role, same file, later turn) and **destructive conflict** (different roles overlapping, or an accepted turn's artifact being overwritten by a turn that didn't include it in its baseline).
    - Planning files under `.planning/` owned by `pm` role (per `roles.pm.artifacts` or equivalent) should allow PM forward revision without conflict.
    - Keep the conflict detection for cases it was designed for: cross-role file ownership violations, stale-baseline writes to files modified since dispatch.
    - Add a tester-sequence test: 2 consecutive PM repair turns on the same planning files should accept cleanly, not raise a conflict.
  - **Acceptance:** a PM repair turn that fixes a planning gate failure by editing `.planning/SYSTEM_SPEC.md` accepts cleanly even when prior PM turns modified the same file.

- [x] **BUG-33: Tester-sequence suite does not cover iterative planning repair flow** — Fixed in Turn 158: added `cli/test/beta-tester-scenarios/iterative-planning-repair.test.js`, added `cli/test/beta-tester-scenarios/bug-31-human-merge-completion.test.js`, and wrote the private postmortem `.planning/BUG_31_33_COVERAGE_GAP_POSTMORTEM.md`. The whole point of the new discipline (Active Discipline rule #1) was that no bug closes without a tester-sequence test exercising the real operator flow. The fact that this bug shipped all the way through v2.130.1 means the suite does not exercise iterative planning repair on durable artifacts.
  - **Fix requirements:**
    - Add `cli/test/beta-tester-scenarios/iterative-planning-repair.test.js` that:
      1. Creates a governed repo with PM role bound to `local_cli` + `authoritative`
      2. Dispatches and accepts a PM turn that creates initial planning artifacts
      3. Surfaces a planning gate failure (e.g., missing `## Interface` in `SYSTEM_SPEC.md`)
      4. Dispatches a PM repair turn that adds the missing section
      5. Asserts acceptance SUCCEEDS (no conflict)
      6. Dispatches a second PM repair turn on the same file
      7. Asserts acceptance SUCCEEDS again
    - This test must fail on current HEAD (confirming BUG-32), then pass after the fix.
    - Also add a separate test covering `accept-turn --resolution human_merge` completion path (BUG-31).
  - **Acceptance:** tester-sequence suite now includes iterative planning coverage; running it on pre-fix HEAD reproduces the beta-tester's loop.

### Implementation notes

- **Ordering:** BUG-32 is the root fix. BUG-31 is the safety valve — even after BUG-32 ships, `human_merge` should be a working escape hatch for the genuine-conflict cases that remain. BUG-33 is the discipline fix that ensures this class of bug can't slip through again. All three land together in one release (v2.130.2 or v2.131.0 — patch vs feature is the agents' call based on scope).
- **Tester-sequence test commits FIRST** (per discipline rule #6). The failing test must be on main before the fix commits land.
- **Do not broadcast the fix as "iterative planning now works."** The public surface has been claiming continuous multi-role evolution all along. Ship quietly. The proof is a fresh multi-role `local_cli` end-to-end run that survives iterative planning repair.
- **Internal retrospective required:** `.planning/BUG_31_33_COVERAGE_GAP_POSTMORTEM.md`. Why did the tester-sequence suite miss iterative planning? What other operator flows are still uncovered? What's the coverage audit plan?

---

## Active discipline (MUST follow on every fix going forward)

These rules were established 2026-04-18 after multiple bugs were closed on partial evidence and reopened by the beta tester. Apply on every BUG-N closure:

1. **No bug closes without live end-to-end repro.** The failing test must exercise the beta tester's exact command sequence in a temp governed repo with real runtimes. Unit tests + "the code path is covered" is not sufficient evidence. If the tester's sequence still reproduces the defect on the freshly-built CLI, the bug is not fixed.

2. **Every previously-closed beta bug is a permanent regression test.** Lives in `cli/test/beta-tester-scenarios/`. One file per bug (BUG-1 through BUG-30). CI runs them on every release. A single failure blocks the release.

3. **Release notes describe exactly what shipped — no more, no less.** No overclaiming coverage. No "partial fix" marketing language. Let the tests speak.

4. **Internal `false_closure` retrospectives live in `.planning/`, NOT on the website.** When a closed bug reopens, write `.planning/BUG_NN_FALSE_CLOSURE.md` privately. Never post to docs, release notes, or marketing.

5. **Do NOT broadcast limitations publicly.** No "known limitations" callouts. No blog posts about what doesn't work. No scoping-down of case study or comparison pages. The answer to "the product doesn't do what we say" is to make the product do what we say — quietly, quickly — not to tell the world we've been wrong.

6. **Every bug close must include:**
   - Tester-sequence test file (committed BEFORE the fix)
   - Test output showing PASS on a fresh install
   - CLI version and commit SHA the test was run against
   - A line in the closure note: "reproduces-on-tester-sequence: NO"

7. **Slow down.** A bug that takes 3 days to close correctly is vastly better than one that takes 1 day and reopens in 2.

---

## Recent closures (2026-04-17 → 2026-04-18)

Full details in `.planning/HUMAN-ROADMAP-ARCHIVE.md`. One-line summaries:

### Framework capabilities (closed 2026-04-17)
- ✅ Full-auto vision-driven operation — `agentxchain run --continuous --vision <path>`
- ✅ Human priority injection — `agentxchain inject` + `intake record/triage/approve` unified
- ✅ Last-resort human escalation — structured blocker taxonomy, `agentxchain unblock <id>`, notifier fan-out
- ✅ Live 3+ back-to-back run demonstration — cont-0e280ba0 session, 3 real runs, $0.025 spend

### Beta-tester bug clusters — all closed 2026-04-18

- ✅ **BUG-1..6** (acceptance/validation) — delta-based artifact validation, consistent baseline capture, failure-path state transitions, failure event logging, operator messaging, live subprocess streaming
- ✅ **BUG-7..10** (drift recovery) — `reissue-turn` unified command, `reject-turn` baseline refresh, integrity checks, actionable drift guidance in `restart`
- ✅ **BUG-11..16** (intake integration) — manual dispatch consumes approved intents as primary charter, `intent_id` in events, dispatch bundle embeds charter verbatim, turn validator checks coverage, status surfaces pending intents, unified manual/scheduler intake semantics
- ✅ **BUG-17..22** (state reconciliation) — restart atomicity (writes bundle before state), integrity checks for state/bundle desync, gate truth recomputation on accept-turn, intent satisfaction lifecycle, intent_id event propagation, reject-turn stale staging rejection
- ✅ **BUG-23** (full-auto checkpoint handoff) — `checkpoint-turn`, `accept-turn --checkpoint`, `run --continuous --auto-checkpoint`, `turn_checkpointed` events, assignment guard messaging
- ✅ **BUG-25..30** (false-closure fixes) — `reissue-turn` runtime_id lookup, doctor/connector spawn-context parity, `restart.js` calls `writeDispatchBundle` (line 379), gate re-evaluation in acceptance flow, intent transitions wired to assignment, `intent_id` emitted in `turn_dispatched`

### Adoption-quality gaps (all closed 2026-04-17/18)
- ✅ **B-1..B-11** — CLI version safety docs + doctor warning, canonical runtime matrix, three-axis authority model docs, `review_only + local_cli` rejection, canonical `all local_cli authoritative` config, manual-to-automated migration path, runtime rebinding (subsumed by BUG-7 `reissue-turn`), clean-tree requirement docs, local CLI recipes (Codex absolute path, Claude Code `--dangerously-skip-permissions`), deeper `connector validate` probes, planning/repo split guidance

---

## Completion Log

- **2026-04-18**: 53-item beta-tester bug cluster (BUG-1..30 + B-1..B-11 + 3 framework capabilities) closed across Turns 1–150. Shipped through v2.126.0–v2.130.1. Internal postmortem: `BETA_FALSE_CLOSURE_POSTMORTEM.md`. Discipline rules above (1–7) now in force.
- **2026-04-17**: Framework full-auto vision-driven operation shipped with 3-run live proof (cont-0e280ba0, $0.025 spend). Human priority injection + last-resort escalation mechanisms landed.
- **2026-04-03**: All 7 original priority queue items completed across Turns 21–4 (Claude Opus 4.6 + GPT 5.4). Docusaurus migration, vision alignment, asset fixes, table formatting, vanity proof replacement, platform split simplification, and GCS deployment with cache busting. v2.2.0 release-ready.
