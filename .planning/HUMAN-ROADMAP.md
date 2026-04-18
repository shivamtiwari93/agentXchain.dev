# Human Roadmap — AgentXchain

Human-prioritized work for the agents.

Rules:
- Agents should read this file before acting.
- Unchecked items here take priority over general exploration in `AGENT-TALK.md`.
- When an item is complete, agents should mark it complete and briefly record what changed.
- If an item is too large, agents should split it into smaller checklist items and work them down in order.
- Only move an item back to `HUMAN_TASKS.md` if it truly requires operator-only action.

Current focus: **P1 bug cluster — iterative planning on durable artifacts is trapped in a conflict loop on v2.130.1.** Beta tester hit it on the first real upgrade attempt. Full verbatim report in `HUMAN-ROADMAP-ARCHIVE.md` under "Beta-tester bug report #7 (2026-04-18)". Apply Active Discipline rules below on every fix.

## Priority Queue

- [ ] **BUG-31: `accept-turn --resolution human_merge` is a no-op from the operator's perspective — transitions substate but provides no documented completion path** — Code confirmed at `cli/src/lib/governed-state.js:2744`. Running the command flips `conflict_state.status` to `"human_merging"` then re-displays the same conflict banner. There is no documented or discoverable next step for the operator to complete the merge and advance the turn. Either:
  - **Option A (preferred):** `human_merge` actually merges in a single step — take the active turn's staged result as authoritative if the operator explicitly opts into this resolution, record `resolution_chosen: human_merge` in the decision ledger, emit a `conflict_resolved` event, and advance the turn to `accepted` with appropriate merged-state provenance.
  - **Option B:** if a two-step flow is intended (`human_merge` → operator edits → `accept-turn --complete-merge`), ship the completion command, surface it in the conflict banner output, and document it in `docs/recovery.mdx`.
  - **Either way:** the operator must have a deterministic path from "conflict detected" to "turn accepted" without manual JSON editing. Add a tester-sequence test covering the exact beta-tester flow (dispatch planning repair → conflict detected → `accept-turn --resolution human_merge` → expect turn in `accepted` status, not `conflicted`).
  - **Acceptance:** `accept-turn --resolution human_merge` on a conflicted turn returns a terminal outcome in one invocation — accepted, or a clear actionable next step.

- [ ] **BUG-32: Iterative revisions of durable planning artifacts across turns are treated as destructive conflicts** — The beta tester's PM repair turn correctly updated `.planning/SYSTEM_SPEC.md` and `.planning/command-surface.md` to satisfy the planning gate. The framework detected 100% overlap with prior accepted PM history on those same files and raised a conflict. **This is the wrong default.** Planning files are supposed to evolve across turns; that's the job. Treating every modification of a previously-accepted file as a conflict makes iterative planning impossible.
  - **Fix requirements:**
    - Conflict detection logic at `cli/src/lib/governed-state.js:1139` uses overlap ratio to suggest resolution. The overlap-based heuristic is not the right signal for durable artifacts owned by a single role across turns. When role X's current turn modifies a file that role X previously modified in an accepted turn, that's **forward revision**, not a conflict.
    - Add explicit distinction between **forward revision** (same role, same file, later turn) and **destructive conflict** (different roles overlapping, or an accepted turn's artifact being overwritten by a turn that didn't include it in its baseline).
    - Planning files under `.planning/` owned by `pm` role (per `roles.pm.artifacts` or equivalent) should allow PM forward revision without conflict.
    - Keep the conflict detection for cases it was designed for: cross-role file ownership violations, stale-baseline writes to files modified since dispatch.
    - Add a tester-sequence test: 2 consecutive PM repair turns on the same planning files should accept cleanly, not raise a conflict.
  - **Acceptance:** a PM repair turn that fixes a planning gate failure by editing `.planning/SYSTEM_SPEC.md` accepts cleanly even when prior PM turns modified the same file.

- [ ] **BUG-33: Tester-sequence suite does not cover iterative planning repair flow** — The whole point of the new discipline (Active Discipline rule #1) was that no bug closes without a tester-sequence test exercising the real operator flow. The fact that this bug shipped all the way through v2.130.1 means the suite does not exercise iterative planning repair on durable artifacts.
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
