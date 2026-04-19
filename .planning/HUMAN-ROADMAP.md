# Human Roadmap — AgentXchain

Human-prioritized work for the agents.

Rules:
- Agents should read this file before acting.
- Unchecked items here take priority over general exploration in `AGENT-TALK.md`.
- When an item is complete, agents should mark it complete and briefly record what changed.
- If an item is too large, agents should split it into smaller checklist items and work them down in order.
- Only move an item back to `HUMAN_TASKS.md` if it truly requires operator-only action.

Current focus: **BUG-46 — post-acceptance deadlock. Acceptance, checkpoint, and resume disagree about what the accepted turn changed.** Tester verified v2.140.0 improves prior issues but hit a new blocker. Accepted QA turn leaves 7 modified repo files, but `checkpoint-turn` reports "Accepted turn has no writable files_changed paths to checkpoint" while `resume` refuses to dispatch next turn because workspace is dirty. Only manual `git commit` unblocks. Classic 3-way semantic misalignment. BUG-44 and BUG-45 still open pending tester verification (fixes shipped in v2.139.0/v2.140.0 respectively, not yet confirmed). Full report in archive under "Beta-tester bug report #15 (2026-04-19)".

## Priority Queue

- [ ] **BUG-46: Post-acceptance deadlock — accepted turn's `files_changed` in history is empty (or all-ephemeral), so `checkpoint-turn` refuses to checkpoint, but repo files were actually modified, so `resume` refuses next turn** — Verified code path at `cli/src/lib/turn-checkpoint.js:139-145`: `checkpointAcceptedTurn` fails with "Accepted turn has no writable files_changed paths to checkpoint" when `normalizeFilesChanged(entry.files_changed).length === 0`. The normalize filter strips ephemeral paths (`.agentxchain/staging/`, `.agentxchain/dispatch/`) per BUG-43. If the turn's recorded `files_changed` was either (a) empty to start with, or (b) entirely composed of ephemeral paths, checkpoint fails silently while acceptance had already succeeded and the real repo mutations are stranded.
  - **Tester's exact scenario (for tester-sequence test):**
    - Run `run_c8a4701ce0d4952d`, phase `qa`, QA role configured as `authoritative + local_cli` (unusual — QA is typically `review_only`, but tester's config is valid governance)
    - Accepted turn `turn_e015ce32fdafc9c5` (role `qa`) produced 7 repo mutations:
      - `.planning/RELEASE_NOTES.md`, `.planning/acceptance-matrix.md`, `.planning/ship-verdict.md`
      - `tests/fixtures/express-sample/tusq.manifest.json`
      - `tests/fixtures/express-sample/tusq-tools/{get_users_users,index,post_users_users}.json`
    - `agentxchain resume` refused: "Working tree has uncommitted changes in actor-owned files... Authoritative/proposed turns require a clean baseline in v1."
    - `agentxchain checkpoint-turn --turn turn_e015ce32fdafc9c5` returned: "Accepted turn has no writable files_changed paths to checkpoint."
    - Manual `git add && git commit` was the only recovery.
  - **The 3-way disagreement:**
    1. **Acceptance** said: this turn is valid (accepted the turn, persisted history)
    2. **Checkpoint** said: no writable files_changed to checkpoint (empty after filter)
    3. **Resume/baseline** said: there are uncommitted actor-owned files (7 of them)
    - If #1 + #2 are true, then #3 should be false (the "actor-owned files" wouldn't exist)
    - If #1 + #3 are true, then #2 should be false (there would be writable files to checkpoint)
    - One of acceptance / checkpoint / baseline has wrong information. Fix the mismatch at the source.
  - **Root cause — tester-confirmed evidence (2026-04-19):**
    - Persisted history entry for `turn_e015ce32fdafc9c5` has `"files_changed": []`
    - AND `observed_artifact.files_changed: []`
    - AND `observed_artifact.baseline_ref: "git:bee94a4248..."` AND `observed_artifact.accepted_ref: "git:bee94a4248..."` (SAME SHA)
    - BUT `observed_artifact.diff_summary` shows 17 files changed (27,449 insertions / 7,985 deletions)
    - AND `artifact.type: "workspace"` (internally inconsistent with `files_changed: []` — workspace artifacts should have populated files)
    - AND QA is explicitly configured `"write_authority": "authoritative"`
    - Four overlapping defects producing the deadlock:
      1. **Observation layer compares identical git refs** — since no checkpoint commit happens between dispatch and acceptance, `baseline_ref === accepted_ref`. The diff is computed over committed state only, so it finds zero files. But the working tree is dirty. Observation MUST compare working-tree state (including uncommitted changes + untracked files), not just git-ref-to-git-ref.
      2. **BUG-1 mismatch validator doesn't fire** because both declared `files_changed: []` and observed `files_changed: []` match. No mismatch → no rejection → turn accepted with empty files_changed. The validator needs to cross-check against the dirty-tree detection that `resume` uses — if resume sees dirty actor-owned files, acceptance should too.
      3. **Framework-owned file pollution** — diff_summary includes `.agentxchain/decision-ledger.jsonl`, `.agentxchain/events.jsonl`, `.agentxchain/history.jsonl`, `.agentxchain/intake/*`, `.agentxchain/reports/*`, `.agentxchain/run-history.jsonl`, `.agentxchain/session.json`, `.agentxchain/state.json`, `TALK.md` — ALL framework-owned writes. Only `.agentxchain/human-escalations.jsonl` is in the baseline exclusion list (`repo-observer.js:50`). Every other framework-owned write path pollutes the dirty-tree check.
      4. **Verification commands create untracked fixtures** — tester confirmed fixture files (`tests/fixtures/express-sample/tusq-tools/*.json`, `tusq.manifest.json`) were produced by `node tests/smoke.mjs` verification step, NOT by the subprocess directly. They appear as untracked files in the observation but never in the turn's declared `files_changed`. Verification-produced artifacts need explicit classification — either "turn outputs" (should be in files_changed, eligible for checkpoint) or "ignored side effects" (excluded from observation).
  - **Fix requirements — ordered by leverage:**
    1. **Expand baseline exclusion list in `repo-observer.js:50`.** Currently only `.agentxchain/human-escalations.jsonl` is excluded. All framework-owned write paths must be excluded: `.agentxchain/decision-ledger.jsonl`, `.agentxchain/events.jsonl`, `.agentxchain/history.jsonl`, `.agentxchain/human-escalations.jsonl`, `.agentxchain/intake/**/*.json`, `.agentxchain/intake/**/*.jsonl`, `.agentxchain/reports/*`, `.agentxchain/run-history.jsonl`, `.agentxchain/session.json`, `.agentxchain/state.json`, `.agentxchain/continuous-session.json`, `.agentxchain/locks/*.lock`, `.agentxchain/staging/**`, `.agentxchain/dispatch/**`, `TALK.md`, `HUMAN_TASKS.md` (from BUG-45). Centralize this list — don't duplicate across `repo-observer.js`, `turn-checkpoint.js:57` (EPHEMERAL_PATH_PREFIXES), `export.js:44`, and wherever else it's hardcoded.
    2. **Fix observation to diff working tree, not committed state.** The observation layer must compute `files_changed` by comparing the working-tree snapshot AT DISPATCH against the working-tree snapshot AT ACCEPTANCE. Using `git:<sha>` refs on both sides produces empty diffs when no checkpoint has happened yet. `observed_artifact.files_changed` should include both uncommitted changes AND untracked files that the turn produced.
    3. **Cross-validate acceptance against dirty-tree detection.** The same code path that `resume` uses to detect "dirty actor-owned files" must be called during acceptance. If resume would refuse because of dirty files, and those files are NOT in the turn's declared `files_changed` (after framework exclusions), acceptance must refuse. No more "accepted but can't continue" states.
    4. **Classify verification-produced artifacts explicitly.** Extend the turn result schema with `verification.produced_files: []` — files that verification commands are expected to create (e.g., fixture outputs from `node tests/smoke.mjs`). These are (a) included in the turn's artifact set for checkpoint, OR (b) explicitly declared as ignored side-effects. Don't leave them in the current ambiguous middle.
    5. **Respect `write_authority: authoritative` on QA (and all roles).** Role-level write authority should drive artifact type defaults, not the role name. If QA is authoritative and modifies repo files, the turn's artifact type must be `workspace`, not `review`. And workspace artifacts MUST have non-empty `files_changed` or fail validation.
    6. **Fail acceptance loudly.** If `artifact.type === "workspace"` but `files_changed: []`, reject with: `"Turn declared artifact.type: 'workspace' but files_changed is empty. Either declare the files modified, or set artifact.type: 'review' if no repo mutations were intended."`
    7. **Tester-sequence test using tester's exact state:** seed `turn_e015ce32fdafc9c5`-shape scenario — QA role with `write_authority: authoritative`, turn result with `artifact.type: "workspace"`, `files_changed: []`, verification commands that produce fixture files. Run full `accept-turn`. Assert acceptance REFUSES with a specific error, not silently accepts. If the fix path takes approach #4 (explicit `verification.produced_files`), exercise that too.
  - **Acceptance:** tester's exact scenario on `v2.144.0` or later — QA turn with workspace mutations either (a) has accurate `files_changed` populated, checkpoints cleanly via `checkpoint-turn`, and `resume` proceeds, OR (b) fails acceptance upstream with a clear error. No silent deadlock. Tester's quoted output on a published package containing the full BUG-46 fix bundle is closure evidence per rule #12.

### Implementation notes for BUG-46

- **Before coding, get the turn's actual history entry.** Ask the tester for the `files_changed` field on `turn_e015ce32fdafc9c5`. This resolves the hypothesis tree in seconds. If the tester can't share, spin up a local reproduction using `authoritative + local_cli` QA role with a similar task.
- **This is not a regression — it's a latent bug exposed by tester's QA=authoritative config.** BUG-1/BUG-23/BUG-43 all assumed QA is review_only. With QA=authoritative, different code paths fire. There's likely a whole class of untested combinations here.
- **Audit matrix update:** `BUG_31_33_COVERAGE_GAP_POSTMORTEM.md` needs a new dimension — "role × write_authority × runtime." Standard governance (QA=review_only) is covered. Authoritative QA, authoritative product_marketing, authoritative eng_director — these are valid configurations the tester is using, but the framework's internal assumptions may not match. Enumerate the combinations. Which ones have tester-sequence coverage?
- **Do NOT mark closed until tester verifies.** Rule #12 is in force.
- **Version map:** use `.planning/BUG_44_45_46_FIX_VERSION_MAP.md` as the single private reference for what shipped where. BUG-44 first shipped in `v2.139.0`, BUG-45 first shipped in `v2.140.0`, BUG-46 first reached npm in `v2.141.1` because the `v2.141.0` tag never published successfully, and `v2.143.0` is the latest published package carrying the full bundled fix surface.
- **Tester target:** ask for verification on `v2.144.0` or later by default. Earlier versions can still prove individual bugs, but they are no longer the preferred closure target because the release lane moved.

- [ ] **BUG-44: Intent coverage must retire phase-scoped intents when that phase is exited by gate-pass + phase advance** — Verified code gap. `cli/src/lib/governed-state.js:3162` runs `evaluateIntentCoverage(turnResult, intakeCtx)` on every acceptance. No phase-scoping, no retirement-on-phase-advance logic anywhere in `intake.js`, `intent-startup-migration.js`, or `governed-state.js`. An implementation-scoped repair intent stays `approved` with its acceptance contract unaddressed even after `implementation_complete` passes and the phase advances to `qa`. Continuous mode then pauses on "Intent coverage incomplete" during QA acceptance — enforcing an intent that belongs to a phase the run has already exited.
  - **Tester's exact scenario (for tester-sequence test):**
    - Intent `intent_1776534863659_5752` was an implementation-phase repair intent: "add literal `## Changes` section to `.planning/IMPLEMENTATION_NOTES.md`, preserve implementation summary, allow implementation to advance to QA."
    - The repair was completed. `.planning/IMPLEMENTATION_NOTES.md` now contains `## Changes`. `implementation_complete` gate shows `passed`. Phase is `qa`.
    - QA turn `turn_e6b31574217ab1d2` dispatch, acceptance fails: `acceptTurn(qa): Intent coverage incomplete: 1 acceptance item(s) not addressed: implementation_complete gate can advance to qa once verification passes`.
    - The acceptance item is effectively satisfied by gate pass + phase advance, but the intent still sits in the queue demanding coverage.
  - **Fix requirements:**
    1. **Intents gain a `phase_scope` field.** When an intent is created (via `inject`, `intake record`, vision-seeding, etc.), optionally record which phase it's scoped to. If omitted, intent is phase-agnostic. If set, intent is only enforceable while the run is in that phase.
    2. **Auto-derive phase_scope when possible.** If the intent's charter or acceptance items reference a gate name (e.g., "implementation_complete"), auto-scope to that gate's phase.
    3. **Retire phase-scoped intents on phase advance.** When `acceptGovernedTurn()` processes a phase transition, scan the intake queue. For every `approved` intent where `phase_scope === <exited_phase>`, transition to `status: "satisfied"` with reason `"phase <X> exited; <phase>-scoped repair no longer required"`. Emit `intent_retired_by_phase_advance` event.
    4. **Retire intents whose acceptance items are satisfied by gate state.** Even without explicit `phase_scope`, if an acceptance item literally says "gate X can advance" or "gate X passes" AND that gate shows `passed`, treat the item as covered. This handles the implicit-phase-scoping case.
    5. **The intent coverage validator must be phase-aware.** `evaluateIntentCoverage()` must skip acceptance items that belong to an already-exited phase OR items that are satisfied by current gate state.
    6. **Tester-sequence test MUST use the tester's actual scenario:** seed an implementation-scoped repair intent, complete the repair, pass the gate, advance to QA, dispatch a QA turn. Assert acceptance succeeds without complaining about the implementation-phase intent.
    7. **Live-proof discipline:** closure must include the tester's quoted output showing `agentxchain run --continue-from run_c8a4701ce0d4952d --continuous` progressing through QA without pausing on stale implementation coverage. Per rule #12.
  - **Acceptance:** tester's run on `v2.144.0` or later successfully completes the QA turn without the "Intent coverage incomplete" error referencing implementation-phase intents.

- [ ] **BUG-45: Retained-turn acceptance uses stale embedded `intake_context.acceptance_contract` instead of reconciling against current intent state** — Verified code gap. `cli/src/lib/governed-state.js:3228-3234` reads `currentTurn.intake_context.acceptance_contract` from the turn's embedded state, not from the live intent file on disk. When an intent is effectively satisfied by a retained turn's artifacts and verification, but the framework hasn't retired the intent yet, the retained turn stays in `failed_acceptance` forever. `intake resolve` is a no-op on `executing` intents (`cli/src/lib/intake.js:1273-1288` returns `no_change: true`). The only way out is manual `.agentxchain/` state surgery: mark intent completed, clear `injected-priority.json`, null out `intake_context` on state.json + ASSIGNMENT.json. That is not an acceptable recovery path.
  - **Tester's exact scenario:**
    - Retained turn `turn_1e8cabbfdda98f5d`, role `product_marketing`, phase `qa`, on v2.138.0
    - Intent `intent_1776535590576_a157` (live-site consolidation) is `executing`
    - Staged turn result at `.agentxchain/staging/turn_1e8cabbfdda98f5d/turn-result.json` has `files_changed` covering the contract and `verification.status: "pass"` with commands that literally verify the `## Changes` heading exists, acceptance-matrix/ship-verdict/release-notes exist, and the build+typecheck pass
    - Acceptance keeps failing: `Validation failed at stage intent_coverage. Detail: Unaddressed acceptance items: ...`
    - `intake resolve --intent intent_1776535590576_a157 --json` returns `{"previous_status": "executing", "new_status": "executing", "no_change": true}`
    - Only manual state surgery (mark intent completed → null out intake_context → rerun accept-turn) unblocks
  - **Three distinct defects in this bug (all must be fixed):**
    1. **Retained-turn acceptance must re-read the live intent state, not the embedded copy.** Change `governed-state.js:3228` to look up the current intent by `intake_context.intent_id` from `.agentxchain/intake/intents/`. If the intent is `completed`/`satisfied`/`superseded`/`suppressed`, skip coverage enforcement entirely. If `approved`/`executing`, use the CURRENT `acceptance_contract` from disk (it may have been updated), not the stale embedded one.
    2. **`intake resolve` must be able to transition `executing → completed` when the retained turn's evidence satisfies the contract.** Currently `resolveIntent` refuses. Add a new disposition: if the caller passes `--outcome satisfied` or detects that a retained turn exists with evidence covering every acceptance item, transition executing → completed atomically. Or provide a new `agentxchain intake complete --intent <id> --turn <turn_id>` command that performs the retirement explicitly.
    3. **Framework-generated `HUMAN_TASKS.md` edits must not poison retained-turn artifact observation.** When the escalation layer appends a resolved-escalation block to `HUMAN_TASKS.md`, the diff shows up as an undeclared file change in the next turn's acceptance. `cli/src/lib/repo-observer.js:50` already excludes `.agentxchain/human-escalations.jsonl` from baseline observation — add `HUMAN_TASKS.md` to the same exclusion list (it's framework-owned, not turn-owned).
  - **Fix requirements:**
    1. Write tester-sequence test that seeds the tester's exact state: retained turn with `intake_context.acceptance_contract` embedded, intent file on disk in `executing` status, staged result satisfying the contract. Run `accept-turn --turn <id>`. Assert acceptance succeeds without manual state surgery.
    2. Second tester-sequence test for the `HUMAN_TASKS.md` dirty-state: trigger framework-generated escalation resolution, then dispatch a retained-turn accept. Assert no "Undeclared file changes detected: HUMAN_TASKS.md" error.
    3. Tester must verify a published package containing the BUG-45 fix surface with their exact reproduction before closure (discipline rule #12). Default target: `v2.143.0` or later.
  - **Acceptance:** tester's exact scenario on `v2.144.0` or later — retained turn `turn_1e8cabbfdda98f5d`-shape with embedded stale contract + satisfied-on-disk repo state — accepts cleanly via `accept-turn` without manual `.agentxchain/` edits.

### Implementation notes

- **BUG-44 and BUG-45 share a root cause** (acceptance treats embedded/historical intent state as authoritative instead of reconciling against the live intent file). A single "intent state reconciler" function — called before `evaluateIntentCoverage()` — looks up the live intent, applies phase-scope retirement (BUG-44) AND contract updates (BUG-45). Both fixes shipped: BUG-44 in `v2.139.0`, BUG-45 in `v2.140.0`, both carried forward through `v2.143.0`. No further implementation needed — awaiting tester verification per rule #12.
- **Do NOT mark either closed until tester verifies.** Rule #12 is in force.
- **Historical ship order:** `v2.139.0` first shipped BUG-44, `v2.140.0` first shipped BUG-45, `v2.141.1` first published BUG-46 to npm, `v2.142.0` consolidated status/hardening, and `v2.143.0` carried the latest published proof surface. Do not send testers back to the failed `v2.141.0` npm target.
- **Coverage matrix update:** `BUG_31_33_COVERAGE_GAP_POSTMORTEM.md` needs a new column — "retained-turn reconciliation." Every acceptance path must be tested with intent-state-drift scenarios: intent completed between dispatch and acceptance, intent contract changed between dispatch and acceptance, intent retired by phase advance between dispatch and acceptance.
- **Framework-dirties-repo pattern:** The `HUMAN_TASKS.md` case is one instance of a broader risk — any file the framework itself writes that ISN'T in the baseline exclusion list will poison artifact observation. Audit ALL framework write paths: human-escalations, events.jsonl, session.json, state.json, history.jsonl, decision-ledger.jsonl, etc. Cross-check each against `repo-observer.js` baseline exclusions. Any framework-owned write target must be excluded.
- **Stretch goal:** `intake resolve --verify-from-turn <turn_id>` — operator-friendly command that completes an executing intent if a specific turn's evidence satisfies the contract. Removes the need for manual state surgery even when the automatic reconciler misses an edge case.

---

## Active discipline (MUST follow on every fix going forward)

Established across the 2026-04-18/19 beta cycle after 7 false closures (BUG-17/19/20/21, BUG-36, BUG-39, BUG-40, BUG-41). Apply on every BUG-N closure:

1. **No bug closes without live end-to-end repro.** The failing test must exercise the beta tester's exact command sequence in a temp governed repo with real runtimes. Unit tests + "the code path is covered" is not sufficient evidence. If the tester's sequence still reproduces the defect on the freshly-built CLI, the bug is not fixed.

2. **Every previously-closed beta bug is a permanent regression test.** Lives in `cli/test/beta-tester-scenarios/`. One file per bug (BUG-1 through BUG-44). CI runs them on every release. A single failure blocks the release.

3. **Release notes describe exactly what shipped — no more, no less.** No overclaiming coverage. No "partial fix" marketing language. Let the tests speak.

4. **Internal `false_closure` retrospectives live in `.planning/`, NOT on the website.** When a closed bug reopens, write `.planning/BUG_NN_FALSE_CLOSURE.md` privately. Never post to docs, release notes, or marketing.

5. **Do NOT broadcast limitations publicly.** No "known limitations" callouts. No blog posts about what doesn't work. No scoping-down of case study or comparison pages. The answer to "the product doesn't do what we say" is to make the product do what we say — quietly, quickly — not to tell the world we've been wrong.

6. **Every bug close must include:**
   - Tester-sequence test file (committed BEFORE the fix)
   - Test output showing PASS on a fresh install
   - CLI version and commit SHA the test was run against
   - A line in the closure note: "reproduces-on-tester-sequence: NO"

7. **Slow down.** A bug that takes 3 days to close correctly is vastly better than one that takes 1 day and reopens in 2.

8. **Use REAL emission formats in tester-sequence tests** (added during BUG-37 closure). Any test that asserts on error messages, gate reasons, or event payloads must call the real emitter, not construct synthetic strings. Hardcoded reason strings in beta-tester-scenario tests are banned.

9. **"Claim-reality" gate in release preflight** (added during BUG-37 closure). For every BUG-N marked fixed, preflight must run the tester-sequence test against the shipped CLI binary (not the source tree), to catch "works from source, broken when built" bugs.

10. **Startup-path coverage matrix** (added during BUG-40 closure). Every code path that can produce turn dispatches must be covered in the tester-sequence matrix (`run`, `run --continue-from`, `run --continuous`, `restart`, `resume`, `step --resume`, `schedule daemon`, etc.). Matrix lives in `.planning/BUG_31_33_COVERAGE_GAP_POSTMORTEM.md` and is updated whenever a new startup surface lands.

11. **Tester-sequence tests must seed realistic accumulated state, not just clean fixtures** (added during BUG-41 closure). For migration/reconciliation bugs, the test MUST simulate a repo that has already been through prior versions — pre-existing session files, state.json, intent files in various legacy formats. Use `createLegacyRepoFixture()` in `cli/test/beta-tester-scenarios/_helpers/`.

12. **No bug closes without the beta tester's verified output** (added during BUG-42/43 cycle — the rule that finally broke the false-closure streak). For tester-reported bugs, closure notes must include either (a) the tester's quoted output showing the fix works on their machine, OR (b) a live proof run on a copy of their actual `.agentxchain/` state. Synthetic tests prove the code compiles; they do NOT prove the fix works.

---

## Recent closures (see `HUMAN-ROADMAP-ARCHIVE.md` for full detail)

### Beta cycle 2026-04-19 — closed
- ✅ **BUG-42** — phantom intent detection for rebound legacy intents (first non-false closure after 7 false ones)
- ✅ **BUG-43** — checkpoint-turn filters ephemeral staging/dispatch paths from `files_changed`
- Release: v2.138.0

### Beta cycle 2026-04-18 — closed
- ✅ **BUG-41** — session-flag guard removed; `migrate-intents` repair command shipped
- ✅ **BUG-40** — continuous startup + resume migration (shared `intent-startup-migration.js` helper)
- ✅ **BUG-37/38/39** — gate_semantic_coverage real-emissions, non-progress convergence guard, pre-BUG-34 intent archival
- ✅ **BUG-34/35/36** — cross-run intent scoping, retry-prompt intent re-binding, gate_semantic_coverage validator
- ✅ **BUG-31/32/33** — `human_merge` completion, forward-revision vs destructive conflict, iterative planning coverage
- ✅ **DOC-1** — website sidebar Examples → Products/Proofs split
- Releases: v2.130.x → v2.137.0

### Earlier 2026-04-17/18 clusters (details in archive)
- ✅ **BUG-1..30** — acceptance/validation, drift recovery, intake integration, state reconciliation, checkpoint handoff, false-closure fixes
- ✅ **B-1..B-11** — CLI version safety, runtime matrix, authority model, local_cli canonical, migration path, Codex recipes, etc.
- ✅ **Framework capabilities** — full-auto vision-driven operation, human priority injection, last-resort escalation, live 3-run proof

---

## Completion Log

- **2026-04-19**: BUG-42/BUG-43 closed with tester-verified output on v2.138.0. First non-false closure of the cycle. Discipline rule #12 held. BUG-44 opened (intent lifecycle across phase boundaries).
- **2026-04-18**: 64-item beta-tester bug cluster (BUG-1..41 + B-1..B-11 + 3 framework capabilities + DOC-1) closed across Turns 1–220. Shipped through v2.126.0–v2.138.0. Internal postmortems: `BUG_31_33_COVERAGE_GAP_POSTMORTEM.md`, `BUG_36_FALSE_CLOSURE.md`, `BUG_39_FALSE_CLOSURE.md`, `BUG_40_FALSE_CLOSURE.md`. Discipline rules 1–12 now in force.
- **2026-04-17**: Framework full-auto vision-driven operation shipped with 3-run live proof (cont-0e280ba0, $0.025 spend). Human priority injection + last-resort escalation mechanisms landed.
- **2026-04-03**: All 7 original priority queue items completed across Turns 21–4. Docusaurus migration, vision alignment, asset fixes, table formatting, vanity proof replacement, platform split simplification, GCS deployment. v2.2.0 release-ready.
