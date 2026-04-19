# Human Roadmap — AgentXchain

Human-prioritized work for the agents.

Rules:
- Agents should read this file before acting.
- Unchecked items here take priority over general exploration in `AGENT-TALK.md`.
- When an item is complete, agents should mark it complete and briefly record what changed.
- If an item is too large, agents should split it into smaller checklist items and work them down in order.
- Only move an item back to `HUMAN_TASKS.md` if it truly requires operator-only action.

Current focus: **BUG-42 / BUG-43 — 7th false closure in this beta cycle. This is now embarrassing.**

**Internal note to both agents (not for public surfaces):** We have now shipped seven fixes to the same class of bug, published seven releases claiming it's fixed, and the beta tester has reproduced the failure seven times on the same real repo. That's not a bug; that's a process failure. Ten discipline rules exist and are being quoted in closure notes, but the tests keep passing while the real flow keeps breaking. The "reproduces-on-tester-sequence: NO" marker on BUG-41 turned out to be a claim, not a fact — because the test seeded `startup_reconciled_run_id` but did NOT reproduce the full state the tester actually has on disk (intents already rebound to current run_id by some earlier code path). Stop calling bugs closed until **the exact command the tester is running produces the exact expected output**. No analog tests. No "we believe this would pass." Run the command. Paste the output. Ship.

Full verbatim report in `HUMAN-ROADMAP-ARCHIVE.md` under "Beta-tester bug report #12 (2026-04-18)".

## Priority Queue

- [ ] **BUG-42: REOPEN BUG-41 — legacy intents have been rebound to `approved_run_id: run_c8a4701ce0d4952d` by some prior code path, so they're no longer "legacy" by current migration definition but still break continuous mode** — Verified from tester's on-disk evidence. Intent `intent_1776473633943_0543.json` now shows `approved_run_id: run_c8a4701ce0d4952d, run_id: null, archived_at: null, consumed_at: null`. The `migrate-intents --dry-run` command returns `"archived_count": 0, "message": "No legacy intents found"` — correct per the current "legacy = approved_run_id is null" definition. But the intent is still queueable, still gets picked up by continuous startup, still triggers "existing planning artifacts would be overwritten."
  - **Root cause (hypothesis):** somewhere between BUG-34 and BUG-41, a code path rebound null-scoped intents to the current run_id instead of archiving them. This could have happened during an earlier migration attempt, during an intent observation/acceptance flow, or during a `continue-from` adoption. Once rebound, they pass all queue selection filters because they look like valid current-run intents.
  - **The real bug isn't "null-scoped intents" anymore — it's "phantom intents":** intents whose acceptance contract has already been satisfied (planning artifacts exist from prior accepted PM turns) but whose status is still `approved`. Continuous mode picks them up and tries to plan, which fails because the planning work is already done.
  - **Fix requirements:**
    1. **Stop running migration on a synthetic fixture.** The tester-sequence test for BUG-42 must start from a copy of the tester's actual `.agentxchain/` directory — intents rebound to current run, session file as-is. Simulate nothing; reproduce exactly. Ask the tester to share a sanitized copy of `.agentxchain/intake/intents/`, `.agentxchain/continuous-session.json`, and `.agentxchain/state.json` if needed.
    2. **Detect phantom intents.** A new check in `archiveStaleIntentsForRun()` or equivalent: for every `approved` intent bound to the current run, verify that the planning artifacts it would create do NOT already exist. If they do, the intent is phantom — transition to `superseded` with reason `"planning artifacts for this intent already exist on disk; intent superseded"`.
    3. **Trace where the rebind happened.** Git-blame the code path that could have set `approved_run_id: run_c8a4701ce0d4952d` on a previously null-scoped intent. Fix the root cause so new repos don't accumulate phantom intents.
    4. **Expand `migrate-intents` to cover phantom intents, not just null-scoped ones.** Add `--include-phantom` (or make it default) so operators can clean up repos that already have the problem. Current `--dry-run` must correctly identify phantoms and explain why they'd be archived.
    5. **Tester must run the v2.138.0 fix against their repo** before the bug closes. The closure note must include the tester's verified output of `agentxchain run --continue-from run_c8a4701ce0d4952d --continuous`, NOT a synthetic test output. If we can't get the tester to verify, ship a live proof that uses a copy of their actual state.
  - **Acceptance:** tester's command `npx -p agentxchain@2.138.0 -c 'agentxchain run --continue-from run_c8a4701ce0d4952d --continuous --auto-approve --auto-checkpoint --max-turns 20 --max-runs 5 --triage-approval auto'` produces output that shows phantom intents being superseded AND continuous mode proceeding into QA work (not aborting on "existing planning artifacts would be overwritten"). Tester quoting that output is the only acceptable closure evidence.

- [ ] **BUG-43: `checkpoint-turn` fails after phase advance because staging file is already gone** — New blocker surfaced by the tester on v2.137.0. Accepted dev turn `turn_e20130cc31c3b5b3` advanced the run to QA phase, but the checkpoint is required before QA can start. Running `checkpoint-turn` errors with: `Failed to stage accepted files for checkpoint: fatal: pathspec '.agentxchain/staging/turn_e20130cc31c3b5b3/turn-result.json' did not match any files`.
  - **Root cause (likely):** acceptance flow or phase-advance flow removes the staging file as part of cleanup, but `checkpoint-turn` expects to read it. Either the cleanup is too eager, or checkpoint-turn should read from `history.jsonl` / accepted turn record instead of staging. (BUG-22 taught us staging is ephemeral and must not be trusted for post-acceptance reads.)
  - **Fix requirements:**
    1. Verify the exact sequence: acceptance succeeds → staging cleared? → phase advances → checkpoint-turn tries to read staging → fails.
    2. Change `checkpoint-turn` to read the accepted turn's `files_changed` from the durable history record (`.agentxchain/history.jsonl` or equivalent), NOT from staging. Staging is ephemeral per BUG-22's discipline.
    3. If `files_changed` in history includes file paths, `git add` those paths and create the commit. Staging wasn't needed in the first place — the authoritative source is the accepted turn record.
    4. Tester-sequence test: dispatch turn, accept it, advance phase, THEN run `checkpoint-turn`. Verify it succeeds without touching staging. Seed the scenario to match the tester's exact state: accepted dev turn, staging file already cleaned up, run in QA phase.
    5. If `checkpoint-turn --auto` is part of the continuous flow (it should be per BUG-23's `--auto-checkpoint`), this fix must apply there too.
  - **Acceptance:** `checkpoint-turn` on an already-accepted, phase-advanced turn succeeds without needing the staging file, and produces a commit containing exactly the files in the accepted turn's `files_changed`.

### Implementation notes

- **Seventh false closure (not sixth — I was off-by-one in BUG-41's framing).** BUG-17/19/20/21 (v2.130.1), BUG-36 (v2.135.0), BUG-39 (v2.135.1), BUG-40 (v2.136.0), BUG-41 (v2.137.0). The discipline rules now number 11, and they clearly aren't sufficient alone. They need enforcement.
- **Hard new rule — rule #12: No bug closes without the beta tester's verified output.** For bugs reported by a specific beta tester against a specific real repo, the closure note must include either (a) the tester's quoted output showing the fix works on their machine, OR (b) a live proof run on a copy of their actual `.agentxchain/` state. Synthetic tests are evidence the code compiles; they are not evidence the fix works. Add to the Active Discipline section below.
- **Ordering:**
  1. BUG-42 (phantom intents) — blocks continuous mode for the tester's exact repo
  2. BUG-43 (checkpoint staging) — blocks QA phase handoff post-acceptance
  3. Both ship together as v2.138.0. No other work in this release.
- **No feature work.** Full stop. v2.136.0 shipped connector capabilities + BUG-40 together — that's where the focus slipped. v2.138.0 contains only BUG-42 and BUG-43 fixes, plus the postmortem work.
- **Internal postmortems required:** `.planning/BUG_41_FALSE_CLOSURE.md` explaining why the tester-sequence test seeded session state but not intent state. `.planning/BETA_CYCLE_POSTMORTEM_2026-04-18.md` summarizing all 7 false closures, the pattern across them, what discipline failed, what discipline change actually closes this. These are private.
- **Do NOT broadcast publicly.** Release notes for v2.138.0: "Fixed continuous startup for repos with rebound legacy intents. Fixed checkpoint-turn when staging is cleared post-acceptance." Matter-of-fact. No public admission that we've been shipping broken fixes.

- [x] **BUG-41: REOPEN BUG-40 — migration guard is too aggressive, skips re-migration when legacy intents still exist on disk** — Fixed in v2.137.0 (Turns 216-217): (1) GPT 5.4 removed the session-flag guard so continuous startup always calls `archiveStaleIntentsForRun()` regardless of `startup_reconciled_run_id`; (2) Claude Opus 4.6 shipped `migrate-intents` one-shot repair command as operator escape hatch; (3) 11th discipline rule added (realistic accumulated state in tests); (4) all startup paths (`initializeGovernedRun`, `reactivateGovernedRun`, continuous startup) verified guard-free; (5) `BUG_40_FALSE_CLOSURE.md` retrospective written; (6) production-shaped BUG-41 tester-sequence test seeds pre-existing session with `startup_reconciled_run_id` already set. reproduces-on-tester-sequence: NO — Verified code path: `cli/src/lib/continuous-run.js:157` guards `archiveStaleIntentsForRun` behind `session.startup_reconciled_run_id !== scopedRunId`. Once the session has reconciled a given run_id once — even if that reconciliation failed to actually archive the files, OR if the session file was created by an earlier CLI version that set the flag without running migration — subsequent invocations skip migration entirely. Legacy intents with `approved_run_id: null` stay on disk forever, queue selection picks them up, continuous mode aborts on "existing planning artifacts would be overwritten."
  - **Why this is the 6th false closure:** the BUG-40 tester-sequence test ran migration on a fresh session without a pre-existing `startup_reconciled_run_id`. The tester's real session has that flag already set from prior invocations. Test passes, real flow breaks. Same discipline failure as BUG-36, BUG-39 — tests exercise a clean path the tester's repo isn't on.
  - **Fix requirements:**
    1. Write `BUG_40_FALSE_CLOSURE.md` retrospective. Why did the tester-sequence test not seed a pre-existing `continuous-session.json` with `startup_reconciled_run_id` already set? That's the production condition.
    2. **Make migration idempotent and always-run at continuous startup.** Remove the session-flag guard entirely for migration — the guard was a performance optimization, but migration over a few JSON files is cheap. Alternative: keep the guard but change the condition to "skip only if `listLegacyIntents(root)` returns empty" — source-of-truth is the actual file state, not a session flag.
    3. The session flag `startup_reconciled_run_id` can still be used for OTHER reconciliation work (e.g., scoping prior-run intents via `archiveStaleIntentsForRun`'s run_id comparison). Just not for the legacy-null-scoped migration branch.
    4. Apply the same re-examination to `initializeGovernedRun()` and `reactivateGovernedRun()`: do either of those also guard migration behind a flag that could stale-lock?
    5. Tester-sequence test MUST seed the tester's exact state: (a) `continuous-session.json` with `startup_reconciled_run_id: "run_c8a4701ce0d4952d"` already set, (b) `.agentxchain/intake/intents/` containing multiple intent files with `approved_run_id: null`. Run `agentxchain run --continue-from run_c8a4701ce0d4952d --continuous`. Assert legacy intents are migrated AND continuous mode proceeds without "existing planning artifacts would be overwritten."
    6. Add a `agentxchain migrate-intents` one-shot repair command as an operator escape hatch for any repo that still has legacy intents after v2.137.0 ships. This is belt-and-suspenders — the BUG-41 fix should make this unnecessary, but giving the operator a direct lever is cheap insurance.
  - **Acceptance:** tester's exact reproduction sequence on v2.137.0 produces a migration notice and continuous mode starts cleanly, EVEN WHEN `continuous-session.json` already has `startup_reconciled_run_id` set from prior invocations.

### Implementation notes

- **This is the 6th false closure in this beta cycle.** BUG-17/19/20/21 (v2.130.1), BUG-36 (v2.135.0), BUG-39 (v2.135.1), now BUG-40 (v2.136.0). Same pattern: tester-sequence test runs on a clean fixture path; tester's real repo has accumulated state from prior invocations; test passes; real flow still breaks.
- **Add an 11th discipline rule** (update Active Discipline section below): **Tester-sequence tests must seed realistic accumulated state, not just clean fixtures.** For bugs that involve migration/reconciliation, the test MUST simulate a repo that has already been through prior versions — including pre-existing session files, pre-existing state.json, pre-existing intent files in various legacy formats. Add a `createLegacyRepoFixture()` helper in `cli/test/beta-tester-scenarios/_helpers/` that seeds realistic pre-BUG-N state for all reconciliation-class bugs.
- **Ship as v2.137.0 patch** (minor bump since `migrate-intents` is a new command). Same quiet release voice as v2.135.2. No false-closure acknowledgment in release notes — just list the fix.
- **Do NOT add more features in this release.** The agents have been shipping feature work (connector capabilities in v2.136.0) in parallel with bug fixes. That was fine when bugs were genuinely closing, but the false-closure rate suggests the agents are losing focus. Pause feature work until BUG-41 is truly closed with tester-sequence proof on the production-shaped fixture.

- [x] **DOC-1: Split the website `Examples` sidebar into two sub-categories — `Products` and `Proofs`** — Completed in Turn 212: `website-v2/sidebars.ts` now nests the examples hub under collapsed `Products` and `Proofs` sub-categories, `website-v2/docs/examples.mdx` and `website-v2/static/llms.txt` now cover the previously-missed `checkpoint-handoff-proof` page, and `cli/test/docs-examples-content.test.js` now asserts the real sidebar structure instead of a flat string list. The current `/docs/examples/` section mixes two different kinds of content that serve different audiences. Real products (governed-todo-app, baby-tracker, trail-meals-mobile, HomeCrewNetwork, etc.) are reference implementations that show "how to use agentxchain to build a thing." Proofs (ci-runner-proof, live-governed-proof, continuous-3run-proof, checkpoint-handoff-proof, multi-repo-proof, etc.) are evidence artifacts that show "this capability works end-to-end with real credentials." Mixing them confuses both audiences.
  - **Fix:**
    - In `website-v2/sidebars.ts`, split the `examples` category into two nested sub-categories under `Examples`:
      - `Examples / Products` — governed-todo-app, baby-tracker, trail-meals-mobile, HomeCrewNetwork, habit-board, async-standup-bot, schema-guard, and any other real-product examples
      - `Examples / Proofs` — ci-runner-proof, live-governed-proof, continuous-3run-proof, continuous-mixed-proof, checkpoint-handoff-proof, multi-repo-live-proof, and any script or page whose purpose is evidence (not a reference product)
    - Both sub-categories collapsed by default. Parent `Examples` category stays expandable.
    - Audit each existing page under `website-v2/docs/examples/` and classify it product-vs-proof. If a page is ambiguous (e.g., a product that also serves as a proof), classify by primary purpose and note the secondary purpose in the page body.
    - Update any cross-links in docs, homepage, README, llms.txt, and sitemap.xml that assume the old flat `/docs/examples/<page>` structure. URLs should stay stable under `/docs/examples/<page>/` — only sidebar grouping changes — but verify nothing silently breaks.
    - Add a content-contract test in `cli/test/` asserting the two sub-categories exist and contain the expected pages. Prevents drift.
  - **Acceptance:** `agentxchain.dev/docs/examples/` sidebar shows two collapsible sub-menus labeled "Products" and "Proofs" with the right pages under each. URLs unchanged. No broken cross-links.

---

## Active discipline (MUST follow on every fix going forward)

Established across the 2026-04-18 beta cycle after 5 false closures (BUG-17/19/20/21, BUG-36, BUG-39). Apply on every BUG-N closure:

1. **No bug closes without live end-to-end repro.** The failing test must exercise the beta tester's exact command sequence in a temp governed repo with real runtimes. Unit tests + "the code path is covered" is not sufficient evidence. If the tester's sequence still reproduces the defect on the freshly-built CLI, the bug is not fixed.

2. **Every previously-closed beta bug is a permanent regression test.** Lives in `cli/test/beta-tester-scenarios/`. One file per bug (BUG-1 through BUG-40). CI runs them on every release. A single failure blocks the release.

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

11. **Tester-sequence tests must seed realistic accumulated state, not just clean fixtures** (added during BUG-41 closure). For bugs that involve migration, reconciliation, or session state, the test MUST simulate a repo that has already been through prior versions — including pre-existing session files, pre-existing `state.json`, pre-existing intent files in various legacy formats. A `createLegacyRepoFixture()` helper in `cli/test/beta-tester-scenarios/_helpers/` seeds realistic pre-BUG-N state for all reconciliation-class bugs.

12. **No bug closes without the beta tester's verified output** (added during BUG-42 closure). For bugs reported by a specific beta tester against a specific real repo, the closure note must include either (a) the tester's quoted output showing the fix works on their machine, OR (b) a live proof run on a copy of their actual `.agentxchain/` state. Synthetic tests are evidence the code compiles; they are not evidence the fix works.

---

## Recent closures (see `HUMAN-ROADMAP-ARCHIVE.md` for full detail)

### Beta cycle 2026-04-18 — closed
- ✅ **BUG-40** — continuous startup + resume migration gaps (5th false-closure fix); shared `intent-startup-migration.js` helper
- ✅ **BUG-37/38/39** — gate_semantic_coverage real-emissions, non-progress convergence guard, pre-BUG-34 intent archival
- ✅ **BUG-34/35/36** — cross-run intent scoping, retry-prompt intent re-binding, gate_semantic_coverage validator
- ✅ **BUG-31/32/33** — `human_merge` completion, forward-revision vs destructive conflict, iterative planning coverage
- Releases: v2.130.x → v2.135.1

### Earlier 2026-04-17/18 clusters (details in archive)
- ✅ **BUG-1..30** — acceptance/validation, drift recovery, intake integration, state reconciliation, checkpoint handoff, false-closure fixes
- ✅ **B-1..B-11** — CLI version safety, runtime matrix, authority model, local_cli canonical, migration path, Codex recipes, etc.
- ✅ **Framework capabilities** — full-auto vision-driven operation, human priority injection, last-resort escalation, live 3-run proof

---

## Completion Log

- **2026-04-18**: 64-item beta-tester bug cluster (BUG-1..40 + B-1..B-11 + 3 framework capabilities) closed across Turns 1–212. Shipped through v2.126.0–v2.135.1. Internal postmortems: `BUG_31_33_COVERAGE_GAP_POSTMORTEM.md`, `BUG_36_FALSE_CLOSURE.md`, `BUG_39_FALSE_CLOSURE.md`. Discipline rules 1–10 now in force.
- **2026-04-17**: Framework full-auto vision-driven operation shipped with 3-run live proof (cont-0e280ba0, $0.025 spend). Human priority injection + last-resort escalation mechanisms landed.
- **2026-04-03**: All 7 original priority queue items completed across Turns 21–4. Docusaurus migration, vision alignment, asset fixes, table formatting, vanity proof replacement, platform split simplification, GCS deployment. v2.2.0 release-ready.
