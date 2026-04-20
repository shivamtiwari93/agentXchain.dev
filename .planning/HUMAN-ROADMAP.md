# Human Roadmap — AgentXchain

Human-prioritized work for the agents.

Rules:
- Agents should read this file before acting.
- Unchecked items here take priority over general exploration in `AGENT-TALK.md`.
- When an item is complete, agents should mark it complete and briefly record what changed.
- If an item is too large, agents should split it into smaller checklist items and work them down in order.
- Only move an item back to `HUMAN_TASKS.md` if it truly requires operator-only action.

Current focus: **🎯 BUG-54 ROOT CAUSE IDENTIFIED — Claude CLI subprocess hangs silently waiting for macOS keychain auth that never resolves in non-TTY subprocess context.** Tester ran `reproduce-bug-54.mjs` on v2.148.0 clean worktree and produced definitive diagnostic JSON: 5/5 attempts = `spawn_attached: true`, `stdout_attached: false`, `first_stderr_ms: null`, `watchdog_fires: 5`, exit 143 (SIGTERM). **Zero bytes on BOTH streams for 30 seconds** = subprocess is blocking, not crashing. Auth env booleans all false — no `ANTHROPIC_API_KEY`, no `CLAUDE_CODE_OAUTH_TOKEN`, none. Hypothesis 3 + 5 combined: Claude CLI tries to read OAuth token from macOS keychain, subprocess has no UI-authorized keychain access, hangs waiting for auth prompt that never appears in non-interactive spawn. This matches the `claude --bare` flag's existence (exists specifically to skip keychain reads). **Fix path:** (1) doctor preflight warning when `local_cli` + `claude` runtime has no env-based auth, (2) adapter auto-injects `ANTHROPIC_API_KEY` from parent process if present, OR (3) add `--bare` to spawn args to skip keychain, OR (4) operator docs must require explicit `export ANTHROPIC_API_KEY`. Full tester JSON in `/Users/shivamtiwari.highlevel/VS Code/1008apps/tusq.cloud/tusq.dev-21480-clean/bug-54-repro-21480-clean.json`. Full diagnostic report in archive under "Beta-tester bug report #21 (BUG-54 root cause isolated)".

## Priority Queue

- [ ] **BUG-54: local_cli runtime spawn/attach repeatedly fails — reliability bug, not detection. ROOT CAUSE STILL NOT FIXED.** Verified. `cli/src/lib/adapters/local-cli-adapter.js:133,309,350` emits `runtime_spawn_failed` / `stdout_attach_failed` — **detection works**. But 27 commits of post-v2.148.0 "fixes" are all classification/display work, not root-cause work. Tester's v2.148.0 clean-retest (fresh worktree, session, run) reproduces the same failure on PM turns — kills state-corruption hypothesis and shows this is `local_cli` runtime-general, not QA-specific.
  - **Tester's v2.147.0 evidence (QA-specific):** run_4b24e171693ac091 had 6 consecutive QA startup failures alternating `runtime_spawn_failed` / `stdout_attach_failed`: `turn_81bbd843`, `turn_df73f5d4`, `turn_e95f8517`, `turn_1d93790`, `turn_75116ed7`, `turn_7763138`.
  - **Tester's v2.148.0 clean-retest evidence (PM-affected too):** isolated worktree `tusq.dev-21480-clean`, session `cont-68fcad95`, run `run_15787079e4eb9e07`. PM turns repeatedly fail with same 3 failure modes. Reissued repeatedly via native recovery, keeps reproducing. Bug is not role-specific and not state-corruption — it's `local_cli` runtime-general.
  - **AMPLIFIED EVIDENCE (tester's expanded report 2026-04-20):** **29 consecutive clean PM attempts in `tusq.dev-21480-clean` produced ZERO successful PM turns.** Quoted: *"No PM turn completed successfully. No turn was accepted, merged, or checkpointed as completed work. No implementation or QA phase started. The repeated 'work' was only framework recovery: `reissue-turn --reason ghost`, `step --resume`."* Every single attempt hit `runtime_spawn_failed` / `stdout_attach_failed` / `ghost_turn`. ~2.5 hours of framework time produced exactly one thing: more diagnostic evidence that v2.148.0 is broken. This rules out reliability-class hypotheses: it's not flaky (0% success, not 20%), it's not a race (deterministic reproduction), it's not file-descriptor exhaustion (first attempt fails, not just Nth). **This is a deterministic environmental or invocation-level failure.** Native recovery (`reissue-turn` + `step --resume`) does NOT help — every reissued turn hits the same spawn/attach failure. The path forward MUST start with running the adapter's exact spawn directly and capturing the full stderr/exit-code/signal. Remaining hypothesis probability:
    - Hypothesis 1 (FD exhaustion): **unlikely** — would get worse over attempts, but the tester sees consistent failure from attempt 1
    - Hypothesis 2 (stdout race): **unlikely** — races produce intermittent failures, tester sees deterministic
    - Hypothesis 3 (Claude CLI `-p` mode startup time): **possible** — 30s watchdog might fire before real first-byte
    - Hypothesis 4 (stdin handling / EPIPE): **possible** — deterministic failure mode fits
    - Hypothesis 5 (auth env not propagating to subprocess): **most likely** — explains 0% success, role-general, state-independent, deterministic
  - **STOP DOING CLASSIFICATION WORK.** The 27 post-v2.148.0 commits (`6dbc10cc`, `2ca1d543`, `34b5f358`, `e7da4f6f`, `ab130ebe`, `15cd166d`, `ae057781`, and others) all refine **how failures are reported/classified/timed**. None investigate why Claude CLI subprocesses fail to spawn/attach in the first place. This is the BUG-47→BUG-51 pattern repeating: improving observability while reliability stays broken. **If the next fix is another classification tweak, it will not close BUG-54.**
  - **Root cause hypotheses (INVESTIGATE THESE, do not ship classification fixes instead):**
    1. **Resource leak / file-descriptor exhaustion** — after one spawn failure, something isn't cleaned up, so subsequent spawns fail. Check if the adapter releases stdio file descriptors on subprocess failure. `3f1b74e2 fix(adapter): release stdio on spawn error` claims to address this — but tester evidence shows it didn't solve the problem. Re-audit that fix under tester-sequence conditions.
    2. **Race condition in stdout attachment** — the spawn succeeds but the stdout pipe attachment happens on a different event loop tick and races with process exit / first output. The classic symptom is `stdout_attach_failed` immediately after a successful spawn — which matches the tester's evidence perfectly.
    3. **Claude CLI `-p` mode behavior** — when invoked as `claude -p "..." --output-format stream-json --verbose`, does the CLI need time to authenticate / load config / start before producing output? If yes, the 30-second watchdog may fire during normal startup. Test by running the exact command the adapter spawns (pulled from `ASSIGNMENT.json`) directly in a terminal and timing first-byte-out.
    4. **stdin handling for `prompt_transport: stdin`** — if the prompt is written to stdin but the subprocess exits before reading it all, EPIPE could kill the spawn silently. Does the adapter properly handle the stdin close timing?
    5. **ANTHROPIC_API_KEY or auth-chain issue specific to subprocess environment** — the parent process may have Claude auth in a keychain/keyring that the subprocess can't read. Check if `claude -p` subprocess gets auth via `ANTHROPIC_API_KEY` env var or via the CLI's own keychain (which may not propagate across spawn).
  - **Fix requirements — in this order:**
    1. **DIAGNOSTIC PROOF FIRST.** Before any code fix, reproduce the failure on the agents' own dev box by running the exact spawn the adapter does. Capture: PID, exit code, first-byte-out timestamp, stdout content, stderr content, exit signal. If reproduction fails to reproduce, the bug is environmental — ask the tester to run a diagnostic subprocess capture.
    2. **Publish the reproduction script.** Add `cli/scripts/reproduce-bug-54.mjs` that runs the same spawn the adapter does with full logging. The tester can then run it in their environment and share output. This is the ONLY way to close the root-cause question without guessing. **(✅ Shipped Turn 95, 2026-04-20.** `cli/scripts/reproduce-bug-54.mjs` mirrors the adapter's `resolveCommand` + `spawn` shape exactly — same stdio, env, cwd, prompt transport. Captures per-attempt: PID, spawn_attached/first_stdout/first_stderr timestamps, watchdog_fired flag with elapsed time, exit_code/signal, raw FULL stdout + stderr (no truncation), spawn_error/process_error with code/errno/syscall, and an env_snapshot with PATH/HOME/PWD/SHELL/TMPDIR + boolean-only auth-key presence flags for ANTHROPIC_API_KEY/CLAUDE_API_KEY/CLAUDE_CODE_OAUTH_TOKEN/CLAUDE_CODE_USE_VERTEX/CLAUDE_CODE_USE_BEDROCK. Classifies each attempt into `spawn_attach_failed` / `watchdog_no_output` / `watchdog_stderr_only` / `exit_stderr_only` / `exit_no_output` / `exit_clean_with_stdout` / `exit_nonzero_with_stdout` / `spawn_unattached` / `spawn_error_pre_process`. Five-test classification contract locked in `cli/test/reproduce-bug-54-script.test.js`. **Tester action:** run `node cli/scripts/reproduce-bug-54.mjs --attempts 10` (or `--synthetic "Say READY and nothing else."` to isolate from prompt content) inside the failing worktree (`tusq.dev-21480-clean`) and attach the resulting `bug-54-repro-*.json` to AGENT-TALK or the bug thread. That JSON is the artifact required to discriminate hypotheses 1–5.)
    3. Only AFTER root cause is identified (hypothesis 1, 2, 3, 4, or 5): ship the actual reliability fix. Not a classification tweak. Not a better ghost detector. A fix that makes the spawn succeed.
    4. Add tester-sequence test that dispatches 10 consecutive `local_cli` turns (PM, dev, and QA) and asserts ≥9 complete successfully. Current single-turn tests don't catch this reliability class.
    5. Per rule #12: closure requires tester-quoted output showing `local_cli` turns completing reliably on a new version — not "startup failures are detected" or "stderr is correctly classified."
  - **Acceptance:** tester's clean-retest scenario on vX.Y.Z — 10 consecutive PM/dev/QA `local_cli` dispatches succeed at >90% rate, not <20%.

- [ ] **BUG-55: Checkpoint-turn doesn't fully clean the worktree — accepted+checkpointed work leaves dirty actor-owned files + verification side-effects** — Two distinct sub-defects surfacing as one operational problem:
  - **Sub-defect A: Checkpoint doesn't commit all declared `files_changed`.** Tester's evidence from `run_5fa4a26c3973e02d`: after QA turn `turn_af4fdc071f440a23` accepted + checkpointed at SHA `9d06e5d1...`, these actor-owned files remained dirty: `.planning/RELEASE_NOTES.md`, `.planning/acceptance-matrix.md`, `src/cli.js`, `tests/smoke.mjs`. Had to manually `git commit` with message "checkpoint framework depth implementation and QA evidence" (`13ef927`) before `agentxchain restart` could proceed.
  - **Sub-defect B: Verification side-effects (fixture generation) break acceptance.** Same run, QA acceptance initially failed at `2026-04-20T11:52:24.291Z` because untracked fixture outputs appeared: `tests/fixtures/fastify-sample/.tusq/scan.json`, `tests/fixtures/fastify-sample/tusq.config.json`, `tests/fixtures/nest-sample/.tusq/scan.json`, `tests/fixtures/nest-sample/tusq.config.json`. These were produced by verification commands (e.g., `node tests/smoke.mjs` or tusq scans), not by the QA subprocess directly. BUG-46 hypothesis #4 was supposed to classify these, but coverage is still incomplete.
  - **Fix requirements:**
    1. **Checkpoint-turn must commit the entire declared `files_changed` set.** Audit `turn-checkpoint.js` — either it's silently skipping paths that fail some filter, or the `files_changed` stored in history isn't the full declared set. Verify that `git add <paths>` adds every declared file and fails loudly if any path doesn't exist.
    2. **Extend the `verification.produced_files` classification from BUG-46 to cover actual observed cases.** The agents added the schema field in BUG-46's fix, but apparently aren't requiring or generating the declaration for verification outputs that hit this pattern. Either auto-detect fixture-generating verification commands (e.g., any command that writes to `tests/fixtures/`) and auto-classify their outputs, OR force acceptance to reject turns where verification commands produce untracked files without declaration.
    3. **Tester-sequence test for sub-defect A:** seed a QA turn with `files_changed: ["a.md", "b.js", "c.json"]`, run accept + checkpoint, assert all 3 files are committed (not just some).
    4. **Tester-sequence test for sub-defect B:** seed a QA turn whose verification command produces untracked fixture files, run acceptance, assert either (a) turn is rejected with actionable error naming the undeclared files, OR (b) if `verification.produced_files` declared them, acceptance succeeds cleanly.
  - **Acceptance:** after `accept-turn` + `checkpoint-turn` on a real QA turn, `git status` shows clean tree (no dirty actor-owned files, no undeclared fixture outputs).

- [ ] **BUG-52: Phase-gate resolution doesn't advance phase — `unblock` redispatches same-phase role instead of transitioning** — **FALSE CLOSURE on v2.147.0.** Shipped fix `31e53de2 fix(governed): reconcile phase gates before redispatch` + qa→launch tester-sequence test (`a094eaaa`). Packaged claim-reality proof passed. **Tester reproduced the planning_signoff false-loop on BOTH v2.147.0 runs**, required manual state.json patching each time. The fix works in the synthetic test but not in the real operator flow — classic BUG-36 / BUG-39 / BUG-40 pattern: tests the seam, not the flow.
  - **Tester's evidence (two reproductions):**
    - `run_5fa4a26c3973e02d`: PM turn `turn_addce63aff584689` accepted 11:11:43, checkpointed 11:11:48 at `8b2c86d2...`, `hesc_76f8ace83bfea425` resolved 11:11:54 → new PM turn `turn_2435871a999d9386` dispatched in planning 11:11:54.9 (0.9s after unblock). Phase still planning.
    - `run_4b24e171693ac091`: PM turn `turn_dca9c6c9fe1063eb` accepted 12:35:57, checkpointed 12:36:09 at `a9ffb1e9...`, `hesc_f1ef7f2500523302` resolved 12:36:19 → new PM turn `turn_2a43417238e0f19c` dispatched 12:36:19.6 (0.6s after unblock). Phase still planning.
  - **Required false-closure retrospective:** `.planning/BUG_52_FALSE_CLOSURE.md`. What did `reconcile phase gates before redispatch` actually cover? What specific code path fires during `unblock → resume`? Which path does the tester hit that the test doesn't? The qa→launch tester-sequence test passes but planning→implementation real flow fails — why isn't the test catching this?
  - **New fix requirements:**
    1. **Reproduce the tester's EXACT sequence** — do not rely on seeded fixtures. Run `agentxchain init` + follow the tester's steps: PM dispatch, accept, checkpoint, unblock, observe next dispatch. That reproduction MUST fail on current HEAD before any fix lands.
    2. **The fix must handle the `gate_failed` lane.** Turn 44's diagnosis showed the tester lands in `gate_failed` with `last_gate_failure` populated — not the `pending_phase_transition` lane. Verify the fix actually reaches and handles this specific state.
    3. **Integration test at the command-sequence level**, not just function-call level. Run `accept-turn` → `checkpoint-turn` → `unblock` → `resume` as child processes, and assert the dispatched turn's phase is the NEXT phase, not the current one.
    4. **Consider a simpler model:** instead of "unblock clears escalation, then dispatcher re-evaluates gates," make unblock explicitly advance phase if the gate is now satisfied AND a `phase_transition_request` is pending. This eliminates the race between unblock completing and dispatcher reading stale state.
  - **Acceptance:** tester runs v2.148.0 with their exact command sequence — planning_signoff unblock AND qa_ship_verdict unblock both advance phase without manual state.json surgery. reproduces-on-tester-sequence: NO confirmed via tester-quoted output. Verified code gap. Zero matches in `cli/src/lib/` or `cli/src/commands/unblock*.js` for logic that consults gate status after escalation resolution to trigger phase advancement. `unblock` only clears the escalation; it does not cross-check whether the underlying gate is now satisfied and the run should advance. Result: after `accept-turn` + `checkpoint-turn` + `unblock`, the dispatcher re-runs its normal role-selection logic, sees the current phase is still marked as current, and dispatches the same-phase role again.
  - **Tester's evidence:**
    - PM turn `turn_360905c7f7c8ac1a` checkpointed at `ffb26736...`, `hesc_29db2799c2f4bca6` planning_signoff escalation resolved via `unblock` → system dispatched new PM turn `turn_ecb26fc55ead053d` in planning instead of moving to implementation.
    - Same pattern QA → launch: `turn_1e99db5881d4cad6` checkpointed at `3ba58238...`, `hesc_62f7df0b8b93d623` qa_ship_verdict resolved via `unblock` → system dispatched new QA turn `turn_c3b56a26e34c5e40` instead of launch role.
    - Manual recovery: patch `.agentxchain/state.json` to set next phase + mark gate as `passed` + clear redundant turn → restart → phase finally advances.
  - **Fix requirements:**
    1. After `unblock` resolves a human escalation, if the gate the escalation was tied to is now satisfied by current artifacts AND there's an approved `phase_transition_request` on the most-recent accepted turn, advance the phase atomically. Emit `phase_transitioned` event.
    2. Or: after `checkpoint-turn` completes AND the run is unblocked AND the phase exit gate passes, auto-advance phase even without a new dispatch. This is cleaner because the trigger is the gate pass, not the `unblock` command specifically.
    3. Prevent redundant same-phase redispatch: before `resume` / `step --resume` dispatches a role, check if the current phase's exit gate is now satisfied. If yes, do not dispatch — instead, advance phase and dispatch the next phase's entry role.
    4. Tester-sequence test: accept PM turn with `phase_transition_request: "implementation"` → checkpoint → unblock planning_signoff escalation → assert phase advances to implementation automatically AND next dispatched role is `dev`, not another PM.
    5. Per rule #12: closure requires tester-quoted output showing planning → implementation and qa → launch transitions happen natively without state.json patching.
  - **Acceptance:** tester's exact scenario on v2.147.0 — complete PM planning turn, checkpoint, unblock signoff escalation, next dispatch is `dev` in `implementation`, not another PM in `planning`. Same for qa → launch.

- [ ] **BUG-53: Continuous session doesn't auto-chain after run completion — pauses instead of deriving next vision objective** — Verified code gap. `cli/src/lib/continuous-run.js:600` increments `session.runs_completed` and logs "Run X/Y completed" but does NOT unconditionally loop back to vision scan. The session transitions to `paused` or exits instead of re-entering the vision-candidate-derivation path. Tester's evidence: session `cont-5d436a8f` ended up paused after `run_78133e963b912f46` completed cleanly (all 4 gates passed, final checkpoint `32a38b0a3bbd5e1e6ce82d7271ee45e4b6e5a44b`), no new `vision_scan` run created, no next objective derived.
  - **Fix requirements:**
    1. After `session.runs_completed += 1`, the continuous loop must:
       - Check against `contOpts.maxRuns` — if reached, exit cleanly with status `completed`
       - If not reached, call `deriveVisionCandidates()` again to find the next unaddressed vision goal
       - If a candidate exists, seed a new intent via the standard `intake record → triage → approve` pipeline and start the next run
       - If no candidate exists (all vision goals addressed), exit with status `idle_exit` (clean termination, NOT paused)
    2. `paused` status should only be used for real blockers (`needs_human`, `blocked`), never for "I finished a run and didn't know what to do next."
    3. Cold-start vs warm-completion parity: the same vision-scan code path that runs at session startup must run at post-completion. Extract into a shared helper to prevent divergence.
    4. Emit `session_continuation` event with payload `{previous_run_id, next_objective, next_run_id}` so the operator has a clear audit trail of the auto-chain.
    5. Tester-sequence test: start continuous session with `--max-runs 3`, complete first run (mock or real), assert session immediately seeds next intent from vision candidates, starts run 2, does NOT pause. Repeat through 3 runs, then assert clean exit at max_runs.
  - **Acceptance:** tester's exact scenario on v2.147.0 — `run --continuous --max-runs 5` where first run completes, second run is automatically created from the next vision candidate without any operator intervention. Session status stays `running`, never `paused`, until either max_runs is hit or no vision candidates remain.

### Implementation notes for BUG-52/53/54/55

- **The cycle has a new false closure.** BUG-52's fix was the first proved-via-packaged-claim-reality-preflight closure to still fail on tester reproduction. That means rule #9 (packaged preflight) is necessary but not sufficient — the test itself needs to use the tester's exact command sequence, not just the right code paths. **Rule #13 has now been added** to the Active Discipline section below: command-chain integration tests are mandatory for any CLI workflow bug.
- **Ordering (v2.148.0):**
  1. **BUG-54 first** — QA runtime reliability is blocking every QA turn. Without QA completing, nothing else reaches launch. This is the operator's biggest pain point.
  2. **BUG-52** — false-closure retrospective + real-flow fix. Can proceed in parallel with BUG-54.
  3. **BUG-55** — checkpoint completeness + verification side-effects. Smaller scope, can ship with either.
  4. **BUG-53** stays open awaiting explicit tester evidence of the session-pause pattern. The tester had two runs in this retest, so auto-chain MAY be working.
- **BUG-52 needs a different shape of test this time.** Not a function-call seam test — a child-process command-chain test. Spawn `agentxchain accept-turn` then `checkpoint-turn` then `unblock` then `resume` as separate CLI invocations against a real governed state, and assert the final dispatched turn's phase is the next phase. That's the only shape of test that would have caught this.
- **Coverage matrix update:** `BUG_31_33_COVERAGE_GAP_POSTMORTEM.md` needs (a) command-chain integration tests as a first-class category (separate from function-call tests and packaged preflight), (b) a "repeated-dispatch reliability" column for spawn-path defects (BUG-54 class), (c) a "checkpoint completeness" row (BUG-55 sub-A), (d) an "undeclared verification outputs" row (BUG-55 sub-B).
- **Do NOT broadcast publicly.** Release notes: matter-of-fact. No acknowledgment of BUG-52's false closure.
- **Rule #12 still in force.** No close without tester-quoted output.

---

## Active discipline (MUST follow on every fix going forward)

Established across the 2026-04-18/20 beta cycle after 8 false closures (BUG-17/19/20/21, BUG-36, BUG-39, BUG-40, BUG-41, BUG-52). All 13 rules remain in force:

1. **No bug closes without live end-to-end repro.** Unit tests + "code path covered" is not sufficient.
2. **Every previously-closed beta bug is a permanent regression test** in `cli/test/beta-tester-scenarios/`. CI runs on every release; single failure blocks release.
3. **Release notes describe exactly what shipped** — no overclaiming, no "partial fix" marketing.
4. **Internal `false_closure` retrospectives live in `.planning/`**, never on website.
5. **Do NOT broadcast limitations publicly.** Make the product do what we say, quietly.
6. **Every bug close must include:** tester-sequence test file (committed before fix), test output showing PASS on fresh install, CLI version + commit SHA, closure line "reproduces-on-tester-sequence: NO".
7. **Slow down.** 3 days to close correctly beats 1 day that reopens.
8. **Use REAL emission formats** in tester-sequence tests — no synthetic strings.
9. **"Claim-reality" gate in release preflight** — tester-sequence tests run against shipped CLI binary, not source tree. Now mechanically enforced via `test(claim-reality): packaged behavioral proof` commits.
10. **Startup-path coverage matrix** in `BUG_31_33_COVERAGE_GAP_POSTMORTEM.md` — every dispatch code path × every lifecycle stage has tester-sequence test.
11. **Tester-sequence tests must seed realistic accumulated state**, not just clean fixtures. `createLegacyRepoFixture()` helper.
12. **No bug closes without the beta tester's verified output** — the rule that finally broke the 7-false-closure streak. Tester's quoted output OR live proof on copy of actual `.agentxchain/` state. Synthetic tests prove code compiles, not that the fix works.

13. **Command-chain integration tests are mandatory for any CLI workflow bug** (added 2026-04-20 after BUG-52's false closure, the 8th of the cycle). Function-call tests that exercise an internal seam are NOT sufficient for bugs where the operator's reproduction is a chain of CLI commands (`accept-turn` → `checkpoint-turn` → `unblock` → `resume`, etc.). The tester-sequence test MUST spawn each step as a separate child-process CLI invocation against a governed state, and assert the observed behavior after the full chain — not just assert that a function returns the right value. BUG-52 shipped with a unit-style test + packaged claim-reality preflight that both passed, but the tester's CLI-chain reproduction still failed because the test didn't exercise the invocation sequence the operator runs. Every tester-sequence test file in `cli/test/beta-tester-scenarios/` must have at least one assertion that uses `execFileSync('agentxchain', [...])` (or equivalent child-process spawn) to mirror the operator's real command chain. Rule 9 (packaged preflight) + rule 13 (command-chain integration) together form the full "ship only what the operator actually gets" contract.

---

## Recent closures (see `HUMAN-ROADMAP-ARCHIVE.md` for full detail)

### Beta cycle 2026-04-20 — closed
- ✅ **BUG-47, BUG-48, BUG-49, BUG-50, BUG-51** — stale-turn watchdog + intent lifecycle + checkpoint ref update + run-history contamination + fast-startup watchdog. All 5 tester-verified on v2.146.0. Second triple-or-more close of the cycle.
- Release: v2.145.0 (BUG-47..50), v2.146.0 (BUG-51 + hardening)

### Earlier 2026-04-18/19 clusters (details in archive)
- ✅ **BUG-44/45/46** — phase-scoped intent retirement, retained-turn reconciliation, post-acceptance deadlock resolved (tester-verified on v2.144.0)
- ✅ **BUG-42/43** — phantom intent detection, checkpoint ephemeral path filtering (first non-false closure after 7 false ones)
- ✅ **BUG-31..41** — iterative planning, intake integration, state reconciliation, full-auto checkpoint handoff, false-closure fixes
- ✅ **BUG-1..30** — acceptance/validation, drift recovery, intake integration, etc.
- ✅ **B-1..B-11** — CLI version safety, runtime matrix, authority model, Codex recipes, etc.
- ✅ **Framework capabilities** — full-auto vision-driven operation, human priority injection, last-resort escalation, live 3-run proof
- ✅ **DOC-1** — website sidebar Examples → Products/Proofs split

---

## Completion Log

- **2026-04-20**: BUG-47/48/49/50/51 closed with tester-verified output on v2.146.0. Second triple-or-more close of the cycle. Claude Opus 4.7 + GPT 5.4 with high-effort config active. BUG-52 and BUG-53 opened from tester report #18 — last two full-auto blockers.
- **2026-04-19**: BUG-44/45/46 closed with tester-verified output on v2.144.0. First non-false closure after 7 false ones.
- **2026-04-18**: 64-item beta-tester bug cluster closed through v2.138.0. Discipline rules 1–12 now in force. Internal postmortems: `BUG_31_33_COVERAGE_GAP_POSTMORTEM.md`, `BUG_36_FALSE_CLOSURE.md`, `BUG_39_FALSE_CLOSURE.md`, `BUG_40_FALSE_CLOSURE.md`.
- **2026-04-17**: Framework full-auto vision-driven operation shipped with 3-run live proof.
- **2026-04-03**: Original 7 priority queue items completed. Docusaurus migration, vision alignment, v2.2.0 release-ready.
