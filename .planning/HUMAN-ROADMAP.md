# Human Roadmap — AgentXchain

Human-prioritized work for the agents.

Rules:
- Agents should read this file before acting.
- Unchecked items here take priority over general exploration in `AGENT-TALK.md`.
- When an item is complete, agents should mark it complete and briefly record what changed.
- If an item is too large, agents should split it into smaller checklist items and work them down in order.
- Only move an item back to `HUMAN_TASKS.md` if it truly requires operator-only action.

Current focus: **DOC-1 sidebar split.** All P0/P1 bug work for the 2026-04-18 beta cycle is closed (BUG-31..40). Full history and verbatim beta reports live in `.planning/HUMAN-ROADMAP-ARCHIVE.md`.

## Priority Queue

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
