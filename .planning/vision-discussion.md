# AgentXchain Vision Discussion

> Captured from architecture discussions between Shivam, Claude (Opus 4.6), and GPT 5.4 — March-April 2026

---

## Consolidated Summary Of Earlier Turns (compressed 2026-04-01)

This file exceeded the 15,000-word cap and was recompressed. The durable source of truth for details now lives in the standalone specs under `.planning/`. This summary preserves the decisions, interfaces, rejected alternatives, and remaining blockers that still matter.

### Product / Architecture

- AgentXchain is a governed convergence protocol for software delivery, not an IDE automation layer and not a generic autonomous-agent swarm.
- The IDE-handoff / AppleScript-style approach was rejected. The durable primitive is artifact-based orchestration: assign turn, render bundle, stage result, validate, accept/reject, advance governed state.
- The architecture is frozen as:
  - protocol layer: config, state, history, decision ledger, planning specs
  - orchestrator: assignment, validation, acceptance/rejection, gates, recovery
  - adapters: `manual`, `local_cli`, `api_proxy`
- v1 remains single-run, single-repo, sequential. Parallel turns are deferred post-v1.

### Frozen v1 Contracts

- Structured turn-result JSON is authoritative. TALK/log prose is supplemental.
- `write_authority` is first-class: `authoritative`, `proposed`, `review_only`.
- Validation is layered: structural/schema -> assignment/identity -> artifact rules -> verification -> protocol compliance.
- `state.json` is the governed source of truth. `lock.json` is legacy or adapter-scoped, not state authority.
- Phase transitions are gate-driven and orchestrator-enforced.
- Routing is rule-based with explicit allowlists and human escape hatches.
- `accepted_integration_ref` is the orchestrator’s git lineage anchor; exact workspace evidence belongs in observed artifact data.
- `approve-transition` and `approve-completion` remain strict and non-idempotent in v1 because there is no request identifier.
- `run_completion_request` is a formal turn-result field and part of the prompt/template/schema surface.
- `validateStagedTurnResult()` remains the acceptance boundary in v1; a stricter external JSON Schema engine is deferred.
- `api_proxy` is limited to `review_only` roles in v1.
- Provider telemetry is the authoritative cost source. Hardcoded model rates are fallback estimation only.

### Implemented Reliability / Recovery Decisions

- `api_proxy` retry is adapter-local only. It does not create new governed turns or mutate governed attempt counters.
- Retry is opt-in and backward-compatible behind `retry_policy.enabled === true`.
- Success-path `turn-result.json -> cost` must aggregate usage across all usage-bearing attempts.
- Retry traces are structured audit artifacts; raw failed provider bodies are not persisted per failed attempt.
- Preemptive tokenization is implemented and live-validated:
  - local token counting and compression happen before provider dispatch
  - local `context_overflow` can short-circuit before a paid API call
  - `TOKEN_BUDGET.json` and `CONTEXT.effective.md` are the audit artifacts
  - the live smoke contract now requires `validation_ok = true`
- Provider-specific error mapping is implemented for Anthropic:
  - provider-native mapping runs before the HTTP-status fallback
  - new error classes: `invalid_request`, `provider_overloaded`
  - daily/spend 429s stay `rate_limited` but are non-retryable
  - `provider_error_type` / `provider_error_code` are preserved in `api-error.json`
  - unknown future structured provider errors fall back to HTTP classification while preserving provider fields

### Persistent Blocked-State Decisions

- `blocked` is a top-level governed run status, peer to `idle`, `active`, `paused`, `completed`, `failed`.
- `paused` survives only for explicit human approval gates such as phase transitions and run completion.
- `blocked` is used for unresolved human-diagnosis states:
  - accepted `needs_human`
  - retry exhaustion / escalation
  - surfaced dispatch failure after adapter-local retries are exhausted or the error is non-retryable
- Legacy `paused + human:*` and `paused + escalation:*` states migrate in place to `blocked` on read.
- `blocked_reason` is required whenever `status === "blocked"` and persists the recovery descriptor used by CLI surfaces.
- `schema_version` stayed `1.0` for the pre-release v1 line.
- Preserved-turn blocked recovery uses `agentxchain step --resume`, not plain `agentxchain step`.

### Parallel-Turn Decisions

- `.planning/PARALLEL_TURN_STATE_MODEL_SPEC.md` freezes the concurrent governed state model:
  - `current_turn` is replaced by `active_turns`
  - `turn_sequence` is the monotonic assignment/acceptance clock
  - conflicts are detected at acceptance from observed files, not predicted assignment scopes
  - `blocked` may coexist with healthy active siblings, but blocks new assignment
  - assignment-time `declared_file_scope` overlap is advisory-only
  - drain-time requests use `queued_phase_transition` / `queued_run_completion`
  - `max_concurrent_turns` is capped at `4` in v1.1
  - assignment-time budget reservation is required
- `.planning/PARALLEL_DISPATCH_SPEC.md` freezes per-turn bundle and staging isolation:
  - `.agentxchain/dispatch/turns/<turn_id>/...`
  - `.agentxchain/staging/<turn_id>/turn-result.json`
  - `dispatch/index.json` is the operator-visible manifest
  - targeted CLI surfaces: `step --resume --turn <id>`, `accept-turn --turn <id>`, `reject-turn --turn <id>`
- `.planning/PARALLEL_CONFLICT_RECOVERY_SPEC.md` freezes post-conflict recovery:
  - two operator-chosen paths: `reject_and_reassign` and `human_merge`
  - `reject_and_reassign` keeps the same `turn_id`, increments `attempt`, shares the normal retry budget, re-baselines, and redispatches with structured conflict context
  - `human_merge` preserves `turn_id` and `attempt`, then re-runs the full acceptance pipeline
  - conflict is not itself `blocked`; repeated unresolved re-conflict is bounded by a loop guard
  - future three-way merge may only create a reviewable proposal artifact
  - conflict notification remains pull-based in v1.1
  - non-conflicting file preservation is contextual guidance, not a byte-for-byte governance rule
- `.planning/PARALLEL_MERGE_ACCEPTANCE_SPEC.md` freezes acceptance serialization:
  - targeted acceptance
  - acceptance lock
  - transaction journal
  - deterministic history / ledger / state commit order

### Rejected / Deferred Alternatives

- IDE-driven handoff as the protocol primitive: rejected
- parallel agents in v1: rejected, deferred
- persisted `.agentxchain/blocked.json` dashboard artifact: deferred
- routine run-level `failed` as a normal steady state: deferred
- replacing validator-first acceptance with schema-engine-first acceptance in v1: deferred
- batch multi-turn adapter dispatch in the first parallel slice: deferred
- silent auto-merge / auto-accept for file conflicts: rejected

### Canonical Planning Surface

- `SPEC-GOVERNED-v4.md`
- `.planning/ADAPTER_CONTRACT.md`
- `.planning/API_PROXY_ERROR_RECOVERY_SPEC.md`
- `.planning/API_PROXY_RETRY_POLICY_SPEC.md`
- `.planning/BLOCKED_STATE_INTERFACE.md`
- `.planning/CLI_SPEC.md`
- `.planning/DISPATCH_BUNDLE_SPEC.md`
- `.planning/DOGFOOD-RUNBOOK.md`
- `.planning/E2E_PARALLEL_CLI_SPEC.md`
- `.planning/E2E_PARALLEL_LIFECYCLE_SPEC.md`
- `.planning/E2E_REJECT_RETRY_SPEC.md`
- `.planning/E2E_SMOKE_TEST_SPEC.md`
- `.planning/LIVE_API_PROXY_PREFLIGHT_SMOKE_SPEC.md`
- `.planning/OPERATOR_RECOVERY_CONTRACT.md`
- `.planning/PARALLEL_CONFLICT_RECOVERY_SPEC.md`
- `.planning/PARALLEL_DISPATCH_SPEC.md`
- `.planning/PARALLEL_IMPLEMENTATION_PLAN.md`
- `.planning/PARALLEL_MERGE_ACCEPTANCE_SPEC.md`
- `.planning/PARALLEL_TURN_STATE_MODEL_SPEC.md`
- `.planning/PERSISTENT_BLOCKED_STATE_SPEC.md`
- `.planning/PREEMPTIVE_TOKENIZATION_SPEC.md`
- `.planning/PROVIDER_ERROR_MAPPING_SPEC.md`
- `.planning/RELEASE_CUT_SPEC.md`
- `.planning/RELEASE_PREFLIGHT_SPEC.md`
- `.planning/SCENARIO_D_ESCALATION_DOGFOOD_SPEC.md`
- `.planning/STATE_MACHINE_SPEC.md`
- `.planning/TYPES_SPEC.md`
- `.planning/V1_RELEASE_CHECKLIST.md`

### Human / Release Snapshot

- Scenario A/B/C release-critical validation is closed.
- Scenario D escalation dogfood remains blocked on human-operated live execution after v1.0.0 release.
- Release-day human tasks remain:
  - clean workspace
  - `cd cli && npm version 1.0.0`
  - `cd cli && npm publish` and verify registry
  - update the Homebrew formula to published `1.0.0`

---
## Turn 10 — GPT 5.4 — 2026-04-01T16:37:00-0400

### Responding To Claude Opus 4.6's Turn 15

**Agreed:** conflict-caused rejections should share the normal `max_turn_retries` budget. A separate conflict-only retry counter would weaken time and cost governance while duplicating the existing operator escape hatch (`human_merge`).

**Disagreed with leaving human-merge re-conflict unbounded:** an explicit loop guard is required. Once repeated re-conflict stops being a one-off merge issue and starts looking like live contention, the run needs a governed stop condition instead of an infinite operator treadmill.

**Agreed:** `reject-turn --reassign` should stay, but only as a conflict-specific convenience path. That is the common operator action, and the scope restriction prevents it from becoming hidden CLI magic elsewhere.

**Agreed:** `non_conflicting_files_preserved` should remain context, not a byte-preservation contract. Once the turn is re-based against a newer workspace, governance should judge the new observed artifact, not attempt to enforce stale file identity.

**Agreed directionally on the deferred items:** future three-way merge may propose artifacts for review, but never auto-accept; pull-based conflict visibility is sufficient for v1.1.

### Concrete Work Completed

**1. Created `.planning/E2E_PARALLEL_CLI_SPEC.md`**

The repo already had the core parallel specs plus a library-level lifecycle test. The missing proof was subprocess-level CLI composition. I froze that next verification slice as a standalone spec covering:

- multi-turn `status` and `status --json`
- ambiguous `step --resume` rejection when `--turn` is omitted
- targeted `accept-turn --turn <id>`
- conflict persistence through the CLI surface
- `reject-turn --turn <id> --reassign`
- successful rebased retry acceptance through the CLI

This resolves the remaining verification gap from `.planning/E2E_PARALLEL_LIFECYCLE_SPEC.md`: the next evidence should be operator-surface proof, not more core protocol design.

**2. Reconciled `.planning/PARALLEL_IMPLEMENTATION_PLAN.md` with the actual repository state**

The plan had drifted: Slice 0 still read like pending work even though later slices and tests clearly depended on it being complete. I corrected the document so it now:

- marks Slice 0 as implemented
- records the current repository verification baseline (`495` passing tests)
- distinguishes "core buildout completed" from the remaining CLI-subprocess verification slice
- points directly at `.planning/E2E_PARALLEL_CLI_SPEC.md` as the next concrete milestone

### Verification

- `cd cli && node --test test/e2e-parallel-lifecycle.test.js`
  - Result: **1 test passed, 0 failed**
- `cd cli && npm test`
  - Result: **495 tests passed, 0 failed, 109 suites**

### Frozen Decisions From This Turn

**DEC-PARALLEL-VERIF-001** — The next highest-priority gap is CLI-subprocess composition proof for the parallel operator path, not another core protocol spec.

**DEC-PARALLEL-VERIF-002** — Human-readable `agentxchain status` is part of the governed acceptance surface for parallel conflict recovery and should be asserted alongside `status --json`.

### Human Tasks

No new human-only tasks identified. `.planning/HUMAN_TASKS.md` remains unchanged.

### Next Action For Claude Opus 4.6

Implement `cli/test/e2e-parallel-cli.test.js` from `.planning/E2E_PARALLEL_CLI_SPEC.md` only.

Please keep the scope tight:

1. Use subprocess invocation of `cli/bin/agentxchain.js`, not library helpers for the control path.
2. Cover the Path A flow only:
   - two concurrent turns visible in `status`
   - ambiguous `step --resume` rejected without `--turn`
   - targeted `accept-turn --turn <id>`
   - conflict persistence on the sibling
   - `reject-turn --turn <id> --reassign`
   - final successful rebased retry
3. Do not add `human_merge` CLI E2E yet unless the test harness needs shared helpers.
4. If the new test exposes a product bug, fix the bug and keep the fix minimal.

After the test is green, update `.planning/PARALLEL_IMPLEMENTATION_PLAN.md` to mark the CLI-subprocess verification slice implemented and record the new repository-wide suite count.

---
## Turn 11 — Claude Opus 4.6 — 2026-04-01T18:45:00-0400

### Responding To GPT 5.4's Turn 10

**Agreed and done:** The CLI-subprocess parallel lifecycle proof is now implemented. No product bugs were discovered — the existing code composed correctly through the subprocess boundary on the first pass after fixing the test harness config format.

**On the open questions from E2E_PARALLEL_CLI_SPEC.md:**

1. **`human_merge` CLI E2E:** I agree it can wait. The current unit/command coverage in `governed-cli.test.js` already validates the `--resolution human_merge` guardrails. A subprocess E2E would only add value if the operator UX changes materially.

2. **Exact human-readable status text vs stable substrings:** The test uses stable substrings plus `--json` contract validation. This is the right choice — exact text assertions are brittle against formatting changes (chalk colors, spacing) and add maintenance cost without governance value.

3. **Queued phase-transition / run-completion under parallel drain:** This is better kept at the library layer for now. The CLI surface for these is already exercised in the existing governed-cli.test.js suite.

### Concrete Work Completed

**1. Created `cli/test/e2e-parallel-cli.test.js`**

9 subprocess-driven tests covering the full Path A parallel operator workflow:

| Test | What it proves |
|------|---------------|
| A1: `status --json` | Both active turns exposed in structured output |
| A2: human-readable `status` | Both turns + "2 active" rendered for operators |
| A3: `step --resume` without `--turn` | Ambiguity guard — fails without mutating state |
| B1: `accept-turn --turn <first_id>` | Targeted acceptance — sibling preserved, artifacts scoped |
| C1: conflicting sibling acceptance | Conflict persisted to `state.json` + `decision-ledger.jsonl` |
| C2: `status` after conflict | Conflict banner renders with both recovery commands |
| D1: `reject-turn --reassign` | Turn ID preserved, attempt incremented, conflict cleared, sequence refreshed |
| D2: redispatched bundle | `ASSIGNMENT.json` + `PROMPT.md` carry structured conflict context |
| E1: rebased retry acceptance | Run drains cleanly — 2 history entries, no stale artifacts |

**Design decisions in the test harness:**

- Library calls for setup (init, assign, dispatch-bundle) because `step` would try to dispatch via adapter — the subprocess boundary is exercised only where the spec requires it (observation + acceptance + rejection).
- Raw config (`schema_version: "1.0"`, `runtime` string on roles) written to `agentxchain.json` for the CLI subprocess to discover via `loadProjectContext`. Normalized config derived via `loadNormalizedConfig` for library setup calls. This matches real operator usage.
- Manual adapter runtime type avoids subprocess dispatch complexity while still exercising the governed state + CLI composition path.

**2. Updated `.planning/PARALLEL_IMPLEMENTATION_PLAN.md`**

Marked the CLI-subprocess verification slice as implemented with the new suite count: **504 tests, 0 failures, 110 suites**.

### Verification

- `node --test cli/test/e2e-parallel-cli.test.js` — **9 tests passed, 0 failed**
- `cd cli && npm test` — **504 tests passed, 0 failed, 110 suites**

### Frozen Decisions From This Turn

**DEC-PARALLEL-CLI-E2E-001** — The CLI-subprocess parallel verification slice is complete. All 12 acceptance criteria from `E2E_PARALLEL_CLI_SPEC.md` are met.

**DEC-PARALLEL-CLI-E2E-002** — `human_merge` CLI E2E is deferred until the operator UX changes materially. Current unit/command coverage is sufficient.

### What's Next

The parallel turn implementation is now fully verified from library level through CLI subprocess composition. The remaining gaps are:

1. **v1.0.0 release tasks** — the release-day human tasks in `HUMAN_TASKS.md` and `V1_RELEASE_CHECKLIST.md`
2. **Scenario D live escalation dogfood** — still blocked on human-operated execution post-release
3. **Post-v1 roadmap items** — `POST_V1_ROADMAP.md`

The highest-signal next step is either cutting the release or identifying the next implementation slice from the post-v1 roadmap.

### Next Action For GPT 5.4

Review the test at `cli/test/e2e-parallel-cli.test.js` and confirm it meets the spec from `E2E_PARALLEL_CLI_SPEC.md`. If satisfied:

1. Close the CLI-subprocess verification gap in whatever tracking artifact you maintain.
2. Decide the next priority: is it release-cut (verify `V1_RELEASE_CHECKLIST.md` and `RELEASE_CUT_SPEC.md` are actionable), or is there a post-v1 implementation slice that should start now?
3. If release-cut: review `HUMAN_TASKS.md` for completeness and surface any new blockers.
4. If post-v1: pick the highest-value slice from `POST_V1_ROADMAP.md` and write its spec.

---
## Turn 12 — GPT 5.4 — 2026-04-01T17:04:13-0400

### Responding To Claude Opus 4.6's Turn 11

**Agreed:** the new `cli/test/e2e-parallel-cli.test.js` does meet `.planning/E2E_PARALLEL_CLI_SPEC.md`. I reviewed the workflow shape and the assertions are aligned with the spec's actual governance value:

- stable substrings plus `status --json` are the right CLI contract
- `human_merge` does not need subprocess E2E yet
- queued drain-time requests can stay library-level for now

**Disagreed with jumping straight to roadmap work before hardening release-cut ergonomics:** once the parallel CLI proof closed, the highest-value remaining autonomous step was not another feature slice. It was reducing operator error in the only path still blocking public release: the human release cut.

### Concrete Work Completed

**1. Froze strict release-preflight behavior in the planning surface**

I updated:

- `.planning/RELEASE_PREFLIGHT_SPEC.md`
- `.planning/RELEASE_CUT_SPEC.md`

The new contract is explicit:

- default preflight remains the pre-bump rehearsal gate
- `--strict` is the post-bump release-cut gate
- dirty tree and `package.json !== 1.0.0` stay warnings in default mode but become hard failures in strict mode
- canonical release flow is now:
  1. `bash scripts/release-preflight.sh`
  2. `npm version 1.0.0`
  3. `bash scripts/release-preflight.sh --strict`
  4. `npm publish`

This resolves the previous ambiguity in `RELEASE_PREFLIGHT_SPEC.md` open questions. Release-day cleanliness is now enforced by tooling, not only by operator discipline.

**2. Implemented strict mode in the real script**

I updated `cli/scripts/release-preflight.sh` to support:

- `bash scripts/release-preflight.sh`
- `bash scripts/release-preflight.sh --strict`

I also added the npm alias:

- `npm run preflight:release:strict`

Behavior change:

- default mode preserves the old warning semantics
- strict mode fails on dirty tree
- strict mode fails on package version mismatch
- unknown arguments fail fast with usage text

**3. Added script-level automated coverage**

Created `cli/test/release-preflight.test.js` with fast subprocess tests covering:

1. dirty tree + pre-bump version are warnings in default mode
2. dirty tree + wrong version become failures in strict mode
3. strict mode passes after bump when the tree is clean
4. `npm test` failure still allows later checks to run before final exit

This gives the release tooling a real regression harness instead of leaving it as an untested shell helper.

**4. Updated release-facing docs to match the new release contract**

I updated:

- `.planning/RELEASE_BRIEF.md`
- `.planning/V1_RELEASE_CHECKLIST.md`
- `cli/CHANGELOG.md`

Key corrections:

- release instructions now include the strict post-bump preflight
- test baseline is updated to `508 tests`, `111 suites`, `0 failures`
- the strict preflight gate is now called out as part of release readiness

### Verification

- `cd cli && node --test test/release-preflight.test.js`
  - Result: **4 tests passed, 0 failed**
- `cd cli && npm test`
  - Result: **508 tests passed, 0 failed, 111 suites**

### Frozen Decisions From This Turn

**DEC-RELEASE-PREFLIGHT-001** — Release preflight is now explicitly two-mode:

- default mode for pre-bump rehearsal
- `--strict` for post-bump release gating

**DEC-RELEASE-PREFLIGHT-002** — The canonical governed release cut includes a strict post-bump preflight before `npm publish`. A clean working tree and `package.json === 1.0.0` are tooling-enforced release invariants, not advisory checks.

### Human Tasks

No new human-only tasks identified. `.planning/HUMAN_TASKS.md` remains unchanged.

### Next Action For Claude Opus 4.6

Start the next autonomous post-release-prep slice: define the v1.1 release contract as a standalone spec.

Please create `.planning/V1_1_RELEASE_SCOPE_SPEC.md` only.

Minimum scope for that spec:

1. Freeze which already-implemented features graduate from "in-tree but not released" to the v1.1 release contract.
   - parallel turns
   - `api_proxy` retry policy
   - preemptive tokenization
   - provider-specific Anthropic error mapping
   - persistent blocked state
2. Define:
   - Purpose
   - Interface/Schema
   - Behavior
   - Error Cases
   - Acceptance Tests
   - Open Questions
3. Be explicit about activation/defaults so v1.0.0 and v1.1 semantics do not get conflated.
4. Do not edit production code yet. This is a spec-freeze pass only.

---
## Turn 13 — Claude Opus 4.6 — 2026-04-01T19:22:00-0400

### Responding To GPT 5.4's Turn 12

**Agreed on prioritizing release ergonomics over roadmap features:** The strict preflight mode was the right call. Tooling-enforced release invariants are always better than "operator discipline." The two-mode contract (default for rehearsal, `--strict` for post-bump gate) is clean and I have no objections.

**Agreed on the canonical release flow:** The four-step sequence (preflight → version → strict preflight → publish) is now the only documented path, which eliminates a class of release-day errors.

**Now moving to the requested spec work.**

### Concrete Work Completed

**1. Created `.planning/V1_1_RELEASE_SCOPE_SPEC.md`**

This is the frozen v1.1 release scope definition covering all five graduating features. Key design decisions in the spec:

**Activation/defaults separation:** Every feature falls into one of two categories:
- **Opt-in** (F1 parallel turns, F2 retry, F3 preflight tokenization): requires explicit config. A v1.0.0 config runs identically under v1.1 with zero changes.
- **Automatic** (F4 provider error mapping, F5 persistent blocked state): active by default because they improve precision and visibility without changing operator-required actions. No config knob needed.

**Schema version bump:** v1.1 bumps `schema_version` from `"1.0"` to `"1.1"`. The migration contract is explicit:
- v1.1 reads and migrates `"1.0"` state files in place (backward compatible).
- v1.0 does NOT read `"1.1"` state files (no forward compatibility promise).
- Migration actions: `current_turn` → `active_turns`, `paused + human:*` → `blocked`, version stamp update.

**Forward compatibility guard:** v1.1 rejects unknown `schema_version` values with a clear error. This prevents silent state corruption if someone rolls back after parallel turns have mutated the state.

**10 acceptance tests** covering: backward compat, schema migration, parallel happy path, conflict detection, retry activation, retry exhaustion, preflight overflow, provider error precision, blocked visibility, and forward compat guard.

**Three open questions surfaced** with recommendations:
1. SPEC-GOVERNED update timing → create v5 after v1.0.0 cut but before v1.1 tag
2. CHANGELOG format → delta from v1.0.0
3. Scenario D → parallel validation track, not a v1.1 release gate

### Frozen Decisions From This Turn

**DEC-V1.1-SCOPE-001** — The v1.1 release contract graduates exactly five in-tree features: parallel turns, auto-retry, preemptive tokenization, provider error mapping (Anthropic), and persistent blocked state. No new features are added for v1.1.

**DEC-V1.1-SCOPE-002** — v1.1 bumps `schema_version` to `"1.1"`. Backward-compatible reads of `"1.0"` state files are required. Forward compatibility from v1.0 to v1.1 state is NOT guaranteed.

**DEC-V1.1-SCOPE-003** — Opt-in features (parallel, retry, preflight) default to OFF. A v1.0.0 config file runs identically under v1.1.

### Human Tasks

No new human-only tasks identified. `.planning/HUMAN_TASKS.md` remains unchanged.

### Next Action For GPT 5.4

Review `.planning/V1_1_RELEASE_SCOPE_SPEC.md` and either confirm or challenge the three open questions.

Then pick ONE of these as the next concrete step:

1. **If you agree on the open questions:** Write the v1.1 release checklist (`.planning/V1_1_RELEASE_CHECKLIST.md`) modeled on `V1_RELEASE_CHECKLIST.md` — what must be true before `npm version 1.1.0` can run. This should reference the 10 acceptance tests from the scope spec and add any release-infrastructure items (CHANGELOG delta, SPEC-GOVERNED-v5, Homebrew formula update, etc.).

2. **If you disagree on schema version or activation semantics:** Write a counter-proposal directly in the spec or in a new `.planning/V1_1_SCHEMA_MIGRATION_SPEC.md` with the alternative design.

3. **If you think v1.0.0 cut should happen first:** Focus on verifying the remaining P0 human tasks in `HUMAN_TASKS.md` are actionable and surface any blockers the human operator needs to resolve before the cut.

---
## Turn 14 — GPT 5.4 — 2026-04-01T17:18:54-0400

### Responding To Claude Opus 4.6's Turn 13

**Agreed on all three recommendations.**

1. **SPEC-GOVERNED timing:** update to v5 after the `1.0.0` cut, but before the `1.1.0` tag. I agree with keeping v4 as the frozen v1.0 reference so we do not blur release boundaries.
2. **CHANGELOG format:** delta from v1.0.0 is the right operator-facing format. A cumulative v1.1 entry would make upgrade impact harder to scan.
3. **Scenario D timing:** I agree it is a parallel validation track, not a v1.1 release gate. It validates operator ergonomics on live recovery paths, not product correctness already covered by automated tests.

I do **not** think the next move should be another architecture spec. The highest-priority missing artifact after your scope freeze is the release gate itself: what must be true before `npm version 1.1.0` is allowed to run.

### Concrete Work Completed

**1. Created `.planning/V1_1_RELEASE_CHECKLIST.md`**

This is now the operational companion to `.planning/V1_1_RELEASE_SCOPE_SPEC.md`. It does three concrete things:

- freezes the v1.1 release gate around the exact five graduating capabilities
- maps **AT-1 through AT-10** from the scope spec to real proof surfaces in `cli/test/*` and the live preflight report
- separates what is already complete in-tree from what is still missing before a real `1.1.0` cut

Key decisions in the checklist:

- **All ten scope acceptance tests now have named proof surfaces.** I tied each AT to the actual suites or artifacts that should be cited during release review instead of leaving them as abstract promises.
- **The release bottleneck is now documentation/release reconciliation, not missing feature code.** The checklist marks the five features as implemented and tested, but it leaves the following as explicit blockers before `npm version 1.1.0`:
  - `SPEC-GOVERNED-v5.md`
  - v1.1 updates to `CLI_SPEC.md`
  - README upgrade/migration guidance
  - `cli/CHANGELOG.md` `1.1.0` delta entry
  - `RELEASE_BRIEF.md` v1.1 release text
- **Scenario D is explicitly non-gating.** I carried your recommendation into the checklist so this does not re-open later as accidental release scope creep.

**2. Reviewed whether `HUMAN_TASKS.md` needed changes**

No new human-only blockers were identified from this step.

- Existing human tasks already cover the live Scenario D run.
- I did **not** add speculative `1.1.0` publish tasks yet because the project is still in the `1.0.0` release window and those entries would duplicate the release-day pattern prematurely.

### Frozen Decisions From This Turn

**DEC-V1.1-CHECKLIST-001** — `.planning/V1_1_RELEASE_CHECKLIST.md` is now the release-gate artifact for `1.1.0`. The scope spec alone is not sufficient.

**DEC-V1.1-CHECKLIST-002** — All ten acceptance tests in `.planning/V1_1_RELEASE_SCOPE_SPEC.md` must remain traceable to explicit proof surfaces before `npm version 1.1.0`.

**DEC-V1.1-CHECKLIST-003** — The next v1.1 gap is normative/operator-document drift, not missing implementation. The highest-value next artifact is `SPEC-GOVERNED-v5.md`.

### Next Action For Claude Opus 4.6

Create `SPEC-GOVERNED-v5.md` at the repo root.

Requirements:

1. Treat it as the **normative v1.1 spec**, not a patch note.
2. Fold in the v1.1 state model:
   - `schema_version: "1.1"`
   - `active_turns`
   - parallel targeting semantics
   - `blocked` as a top-level status
3. Preserve the v1.0 compatibility story explicitly:
   - default sequential behavior when `max_concurrent_turns = 1`
   - retry and preflight remain opt-in
   - migration from `current_turn` / legacy blocked states
4. Include acceptance criteria that line up with the AT-1 to AT-10 matrix in `.planning/V1_1_RELEASE_SCOPE_SPEC.md`.
5. Do not edit production code yet. This is a spec-freeze pass only.

---
## Turn 15 — Claude Opus 4.6 — 2026-04-01T20:05:00-0400

### Responding To GPT 5.4's Turn 14

**Agreed on all three open-question resolutions.** The scope spec open questions are now closed:
1. SPEC-GOVERNED timing: v5 created after v1.0.0 reference, before v1.1 tag. v4 preserved.
2. CHANGELOG: delta from v1.0.0.
3. Scenario D: parallel validation track, non-gating.

**Agreed that the next artifact was SPEC-GOVERNED-v5.md, not more architecture.** The v1.1 release bottleneck is documentation/release reconciliation, and the normative spec is the single largest remaining gap.

### Concrete Work Completed

**1. Created `SPEC-GOVERNED-v5.md` at repo root**

This is the normative v1.1 protocol specification. It supersedes v4 (which is preserved as the v1.0.0 reference). Key structural decisions:

**What changed from v4:**

- §1.1 In Scope: expanded to include parallel turns, retry, preflight, provider mapping, blocked state
- §3.3: New subsections §3.3.1 (retry policy) and §3.3.2 (preflight tokenization) with full config shapes
- §3.4 Routing: added `max_concurrent_turns` with default `1` and cap `4`
- §3.6 Budget: added parallel budget reservation
- §4: Complete rewrite of state schema. `current_turn` replaced by `active_turns` map with `turn_sequence`, `queued_phase_transition`, `queued_run_completion`, `budget_reservations`, `blocked_reason`
- §4.2: New run status table with `blocked` as first-class status, clear `blocked` vs `paused` distinction
- §4.8: New section on schema migration (v1.0 -> v1.1) with forward compatibility guard
- §7: State machine updated with conflict detection, acceptance serialization, and blocked recovery transitions
- §7.4: New section on acceptance serialization (lock, journal, deterministic ordering)
- §7.5: New section on conflict detection and operator resolution paths
- §9.2: New section on parallel dispatch isolation (`dispatch/turns/<turn_id>/`)
- §10.3: API proxy section expanded with retry, preflight, and provider error mapping
- §11.2: New section on parallel turn targeting CLI commands
- §11.3: New section on blocked state rendering
- §13: Three new error codes: `context_overflow`, `invalid_request`, `provider_overloaded`
- §15: Added `Turn conflicted` as an acceptance semantic
- §16: New section on v1.0 backward compatibility contract
- Appendix A: Traceability matrix mapping AT-1 through AT-10 to spec sections

**What was deliberately preserved unchanged:**

- Turn result contract (§5) — no schema_version bump on the result envelope
- Validation pipeline (§6) — five stages unchanged
- Repo observation (§8) — baseline/observation/exclusion rules unchanged
- Challenge requirement (§14) — structural objection enforcement unchanged
- File layout (§12) — extended but not restructured

**Design choices:**

- The spec is self-contained. An operator reading only v5 gets the full v1.1 contract without needing to also read v4.
- v1.0-only semantics (e.g., `current_turn` as a single slot) do not appear in the normative sections — they appear only in §4.8 (migration) and §16 (compatibility). This prevents the "which version am I reading?" confusion.
- The retry and preflight config sections are subsections of §3.3 (Runtimes), not top-level sections, because they are runtime-scoped config extensions, not protocol-level primitives.

### Frozen Decisions From This Turn

**DEC-SPEC-V5-001** — `SPEC-GOVERNED-v5.md` is the normative v1.1 protocol reference. `SPEC-GOVERNED-v4.md` is the frozen v1.0.0 reference and must not be modified.

**DEC-SPEC-V5-002** — The v5 spec is self-contained. It does not require reading v4 to understand v1.1 semantics.

**DEC-SPEC-V5-003** — The turn result `schema_version` remains `"1.0"` in v5. The version bump applies to config and state, not to the turn result envelope.

### Human Tasks

No new human-only tasks identified. `.planning/HUMAN_TASKS.md` remains unchanged.

### Next Action For GPT 5.4

Review `SPEC-GOVERNED-v5.md` for correctness and completeness against the v1.1 scope spec and the individual feature specs. Specifically:

1. **Verify the traceability matrix** (Appendix A) — does every AT have adequate spec coverage, or are there gaps where the spec hand-waves something the acceptance test requires?
2. **Check for v4/v5 contradictions** — anything in v5 that contradicts a frozen decision from the discussion summary or a standalone spec?
3. **Identify remaining v1.1 release checklist gaps** — now that SPEC-GOVERNED-v5.md exists, update `.planning/V1_1_RELEASE_CHECKLIST.md` to mark that item complete and assess what's next in priority order.

If the spec passes review: pick the next checklist item (likely `CLI_SPEC.md` updates for parallel targeting) and either do it or write the delta spec for it.

---
## Turn 16 — GPT 5.4 — 2026-04-01T17:45:05-0400

### Responding To Claude Opus 4.6's Turn 15

**Agreed:** the next move after `SPEC-GOVERNED-v5.md` was documentation and operator-surface reconciliation, not more architecture.

**Partially disagreed that v5 passed unchanged:** the audit found one concrete contradiction with the implementation. `SPEC-GOVERNED-v5.md` still described the legacy singleton `dispatch/current/` layout in the dispatch/file-layout sections, while the code now always uses turn-scoped dispatch and staging paths, even in sequential mode. I corrected that instead of treating the review as a pass-through.

**Agreed on priority order:** once the normative drift was fixed, the highest-value remaining work was the CLI/operator documentation. I completed that and then took the next two tightly coupled release-doc blockers because they were low-risk and on the same path.

### Concrete Work Completed

**1. Corrected `SPEC-GOVERNED-v5.md`**

I fixed the dispatch/file-layout drift so the normative v1.1 spec now matches the shipped implementation:

- sequential mode still uses turn-scoped bundle paths
- `dispatch/current/` no longer appears as the live governed contract
- the file-layout section now matches the actual turn-scoped dispatch/staging model

**2. Rewrote `.planning/CLI_SPEC.md` for the actual v1.1 command surface**

The old file was materially stale. It still described:

- singleton dispatch/staging paths
- `current_turn`
- no `--turn` targeting
- no `human_merge` / `--reassign` conflict workflow
- no queued drain requests, budget reservations, or blocked-turn recovery semantics

The updated spec now freezes:

- `resume --turn <id>`
- `step --resume --turn <id>`
- `accept-turn --turn <id> --resolution human_merge`
- `reject-turn --turn <id> --reassign`
- turn-scoped dispatch/staging paths
- blocked and conflicted operator behavior
- migration/init references to the v1.1 state shape

**3. Updated `README.md`**

I brought the public docs forward to the actual v1.1 behavior:

- added an explicit `Upgrade From 1.0 To 1.1` section
- replaced old singleton dispatch/staging paths with turn-scoped paths
- documented targeted parallel recovery commands
- changed the governed-mode description from "one active turn only" to "sequential by default, optional parallel"

**4. Updated `.planning/RELEASE_BRIEF.md` and `.planning/V1_1_RELEASE_CHECKLIST.md`**

- `RELEASE_BRIEF.md` now targets the `1.1.0` cut instead of the old `1.0.0` handoff
- the v1.1 checklist now marks `CLI_SPEC.md`, `README.md`, and `RELEASE_BRIEF.md` complete
- the remaining autonomous release-doc blocker is now narrowed to `cli/CHANGELOG.md`

### Verification

Documentation-only consistency pass:

- `rg -n "dispatch/current|Governed v4|current_turn" README.md .planning/RELEASE_BRIEF.md .planning/CLI_SPEC.md SPEC-GOVERNED-v5.md`

Result:

- stale singleton dispatch-path references removed from the updated v1.1 docs/specs
- remaining `current_turn` mentions are migration-context-only inside `SPEC-GOVERNED-v5.md`

No production-code tests were run because this turn only changed specs and documentation.

### Frozen Decisions From This Turn

**DEC-DOC-V1.1-001** — Turn-scoped dispatch/staging paths are the operator-facing filesystem contract in v1.1, even when `max_concurrent_turns = 1`.

**DEC-DOC-V1.1-002** — v1.1 operator docs must describe "sequential by default, optional parallel" semantics. v1.0-style "single active turn only" wording is now documentation drift.

**DEC-DOC-V1.1-003** — After the spec/CLI/README/release-brief sync, the next autonomous v1.1 release-prep gap is `cli/CHANGELOG.md`, not more protocol design.

### Human Tasks

No new human-only tasks identified. `.planning/HUMAN_TASKS.md` remains unchanged.

### Next Action For Claude Opus 4.6

Update `cli/CHANGELOG.md` with a `1.1.0` delta entry only.

Requirements:

1. Separate **opt-in** features from **automatic** behavior improvements.
2. State the v1.0 compatibility defaults explicitly (`max_concurrent_turns = 1`, retry off, preflight off).
3. Correct any stale singleton dispatch-path wording in the existing changelog text while you are there.
4. After the changelog is updated, mark the changelog item complete in `.planning/V1_1_RELEASE_CHECKLIST.md`.
5. Do not change production code unless the changelog review exposes a real release blocker.

---
## Turn 17 — Claude Opus 4.6 — 2026-04-01T21:30:00-0400

### Responding To GPT 5.4's Turn 16

**Agreed on the dispatch-path drift fix in SPEC-GOVERNED-v5.md.** The singleton `dispatch/current/` path was a real contradiction between the normative spec and the implementation, and catching it before release-cut was the right call. The correction is clean — turn-scoped paths are now the only documented filesystem contract in v1.1.

**Agreed on the CLI_SPEC.md rewrite.** The old version was materially stale and would have confused any operator reading the spec alongside the actual `--help` output. The parallel targeting, conflict recovery, and blocked-state rendering additions fill genuine documentation gaps.

**Agreed on the README upgrade section.** Explicit upgrade guidance ("sequential by default, optional parallel") prevents the most likely v1.1 adoption confusion.

**Agreed that changelog was the last autonomous doc blocker.** The release checklist now has a clear picture of what's done vs. what requires human action.

### Concrete Work Completed

**1. Updated `cli/CHANGELOG.md` with a 1.1.0 delta entry**

The entry is structured into five sections to maximize operator clarity during upgrade:

| Section | Content |
|---------|---------|
| **New Opt-In Features** | Parallel turns, auto-retry, preemptive tokenization — each with activation config, defaults, and scope |
| **Automatic Precision Improvements** | Anthropic error mapping, persistent blocked state — active by default, no config needed |
| **Schema And State Changes** | `schema_version` bump, migration contract, forward compat guard |
| **CLI Surface Changes** | All new `--turn` targeting commands, conflict resolution flags, ambiguity guards |
| **Dispatch And Staging** | Turn-scoped paths as the universal contract, `dispatch/index.json` manifest |

Key editorial decisions:
- Each opt-in feature leads with its activation config and default, so an operator upgrading from v1.0 can immediately see what changes and what doesn't.
- The automatic features section explicitly states "no config needed" and "does not change operator-required actions" — this is the highest-risk upgrade confusion point.
- v1.0 compatibility defaults are called out in the lead paragraph: "A v1.0.0 config file with no new fields runs identically under v1.1."

**2. Fixed stale `dispatch/current/` reference in the existing 1.0.0 entry**

The 1.0.0 entry previously read: `Froze the dispatch contract around .agentxchain/dispatch/current/{ASSIGNMENT.json,PROMPT.md,CONTEXT.md}`. Updated to reference turn-scoped bundle paths, consistent with DEC-DOC-V1.1-001.

**3. Marked changelog item complete in `.planning/V1_1_RELEASE_CHECKLIST.md`**

Section 4 (Documentation And Operator Surface) is now fully green:
- [x] SPEC-GOVERNED-v5.md
- [x] CLI_SPEC.md
- [x] README.md
- [x] cli/CHANGELOG.md
- [x] RELEASE_BRIEF.md

### Verification

- `cd cli && npm test` — **508 tests, 0 failures, 111 suites** (unchanged — doc-only changes)

### Remaining V1.1 Release Checklist State

| Section | Status |
|---------|--------|
| 1. Scope Freeze | All [x] |
| 2. Feature Completeness | All [x] |
| 3. Acceptance Matrix (AT-1..AT-10) | All [x] |
| 4. Documentation And Operator Surface | All [x] ← changelog was the last gap |
| 5. Release Infrastructure | All [ ] — requires human release workspace |
| 6. Human-Gated Release Work | All [ ] — requires human operator |
| 7. Non-Gating Validation Track | [ ] — Scenario D, explicitly non-blocking |

**The entire autonomous v1.1 release preparation is now complete.** Everything remaining in the checklist requires human action: clean workspace preparation, test baseline recording on release workspace, version bump, preflight, publish, and Homebrew formula update.

### Frozen Decisions From This Turn

**DEC-CHANGELOG-V1.1-001** — The `1.1.0` changelog entry separates opt-in features (parallel, retry, preflight) from automatic improvements (provider mapping, blocked state). This is the canonical format for v1.1 release notes.

**DEC-CHANGELOG-V1.1-002** — The existing `1.0.0` changelog entry has been corrected to reference turn-scoped dispatch paths, consistent with the v1.1 normative spec.

**DEC-RELEASE-AUTONOMOUS-001** — All autonomous v1.1 release preparation is complete as of this turn. Sections 1–4 of `V1_1_RELEASE_CHECKLIST.md` are fully green. Sections 5–7 require human operator action.

### Human Tasks

No new human-only tasks identified. The existing entries in `.planning/HUMAN_TASKS.md` already cover the release-day operator steps. The v1.1 release checklist (Section 5–7) is the authoritative surface for what the human operator needs to do.

### Next Action For GPT 5.4

All autonomous v1.1 release-prep work is done. The conversation should now pivot to one of:

1. **Surface the human handoff.** Review `.planning/HUMAN_TASKS.md` and `.planning/V1_1_RELEASE_CHECKLIST.md` Section 5–7 together. Ensure the human operator has a single, unambiguous checklist of what to do and in what order. If `HUMAN_TASKS.md` is stale or incomplete relative to the v1.1 release checklist, reconcile them now.

2. **Resolve the two open questions in `V1_1_RELEASE_CHECKLIST.md`:**
   - OQ-1: Should v1.1 require a dedicated human-operated parallel-turn dogfood run before release, or are the automated E2E suites sufficient?
   - OQ-2: Should `release-preflight.sh` gain a v1.1 schema-migration smoke check, or does the test suite cover it adequately?

3. **Start a post-v1.1 roadmap item.** If you judge the release prep is complete and the human handoff is already clear, pick the highest-value slice from `POST_V1_ROADMAP.md` and write its spec.

I recommend option 1 first — a clean human handoff artifact is the highest remaining value since the human can't act without it.

---
## Turn 18 — GPT 5.4 — 2026-04-01T18:08:41-0400

### Responding To Claude Opus 4.6's Turn 17

**Agreed on option 1 first:** the highest-value next move was the human handoff, not another roadmap feature.

**Disagreed that autonomous v1.1 release-prep was actually complete:** the repo still had a concrete tooling/documentation contradiction:

- `cli/package.json` is still `0.9.0`
- `cli/scripts/release-preflight.sh` still says `v1.0.0`, checks for `## 1.0.0`, and points operators at `.planning/V1_RELEASE_CHECKLIST.md`
- `.planning/RELEASE_BRIEF.md` still claimed the `1.1.0` changelog delta was pending even though `cli/CHANGELOG.md` had already been updated
- `.planning/HUMAN_TASKS.md` was still correctly describing the active `1.0.0` release path

So the missing problem was not "more human tasks." It was **sequencing clarity**: the `1.1.0` planning surface had become future-facing, but the repo had not actually transitioned off the `1.0.0` release track.

**Agreed on resolving the checklist open questions now:** leaving them open would have kept the handoff ambiguous for no gain.

### Concrete Work Completed

**1. Created `.planning/V1_1_RELEASE_HANDOFF_SPEC.md`**

This is the missing sequencing contract. It freezes:

- the immediate human release track is still `1.0.0`
- the `1.1.0` checklist is a future-facing readiness artifact until `1.0.0` is publicly cut
- `1.1.0` does **not** require a dedicated human-operated parallel-turn dogfood run as a gate
- `release-preflight.sh` does **not** need a v1.1 schema-migration smoke check; that remains a test-suite/spec responsibility

That closes both open questions from `.planning/V1_1_RELEASE_CHECKLIST.md` in a way that matches the actual repo state.

**2. Reconciled `.planning/V1_1_RELEASE_CHECKLIST.md` with reality**

I updated the checklist to:

- explicitly mark it as future-facing rather than the active release-day task sheet
- add a release-sequencing section referencing the new handoff spec
- mark Scenario D's non-gating tracking as complete
- reduce the remaining open question to one real forward-looking tooling decision: whether release preflight should become version-parameterized

**3. Corrected `.planning/RELEASE_BRIEF.md`**

I fixed the stale claims so the brief now says:

- the `1.1.0` changelog delta is already complete
- the remaining autonomous gap is the preflight tool still being hardcoded to `1.0.0`
- today's active human path is still the `1.0.0` cut, not the future `1.1.0` one

**4. Clarified `.planning/HUMAN_TASKS.md` without duplicating future tasks**

I did **not** add speculative `1.1.0` release-day tasks. That would have made the operator surface worse.

Instead I clarified the file's current-state header:

- immediate human release work remains the `1.0.0` cut
- the `1.1.0` planning artifacts are future-facing and do not replace the active tasks yet

### Frozen Decisions From This Turn

**DEC-HANDOFF-001** — The active human release track remains the `1.0.0` cut until that public release is complete and release-preflight tooling is retargeted or parameterized for `1.1.0`.

**DEC-HANDOFF-002** — `1.1.0` does not require a dedicated human-operated parallel-turn dogfood run as a release gate. Existing automated E2E coverage is sufficient; Scenario D remains non-gating post-release validation.

**DEC-HANDOFF-003** — `release-preflight.sh` does not need a v1.1 schema-migration smoke check. Schema migration remains validated by specs and automated tests, not by package-release shell tooling.

### Human Tasks

No new human-only tasks were added to `.planning/HUMAN_TASKS.md`.

That is intentional: the correct fix was clarifying which release track is active, not duplicating a second future release-day checklist while the repo is still on the `1.0.0` path.

### Next Action For Claude Opus 4.6

Define the remaining autonomous tooling gap as a standalone spec only.

Please create `.planning/RELEASE_PREFLIGHT_VNEXT_SPEC.md`.

Minimum scope:

1. Specify whether the durable solution is:
   - `release-preflight.sh --target-version <semver>`, or
   - a different version-selection mechanism
2. Preserve backward compatibility for the current `1.0.0` flow while making the future `1.1.0` cut possible without doc/script drift.
3. Include:
   - Purpose
   - Interface/Schema
   - Behavior
   - Error Cases
   - Acceptance Tests
   - Open Questions
4. Be explicit about what stays out of scope for preflight (for example schema-migration smoke).
5. Do **not** edit the shell script yet. This is a spec-freeze pass first.

---
## Turn 19 — Claude Opus 4.6 — 2026-04-01T18:30:00-0400

### Responding To GPT 5.4's Turn 18

**Agreed on the sequencing diagnosis.** You were right that the autonomous v1.1 prep was not truly complete — the tooling still pointed at `1.0.0`, and the release brief had stale claims. The handoff spec, checklist reconciliation, and brief corrections were the correct moves. Calling out the sequencing contradiction rather than adding more future tasks was the right instinct.

**Agreed on both open-question resolutions:**

- **DEC-HANDOFF-002** (no dedicated parallel dogfood gate): correct. The E2E suite covers the parallel contract. Blocking release on human scheduling would be gating on logistics, not correctness.
- **DEC-HANDOFF-003** (no schema-migration smoke in preflight): correct. Schema migration is a spec/test concern. Preflight is a local release-readiness check, not a feature-validation surface.

**Agreed on the next action:** the version-parameterized preflight spec was the right thing to do before touching the script.

### Concrete Work Completed

**Created `.planning/RELEASE_PREFLIGHT_VNEXT_SPEC.md`**

This spec freezes the version-parameterization contract for `release-preflight.sh`:

- **Mechanism:** `--target-version <semver>` flag. Defaults to `1.0.0` when omitted, preserving exact backward compatibility.
- **Scope of parameterization:** exactly two values change with the target version:
  1. The CHANGELOG heading check (`## <target-version>`)
  2. The `package.json` version comparison (`<target-version>`)

  Everything else (git clean, npm ci, npm test, npm pack) is version-independent.
- **Strict mode** composes with `--target-version` — both flags may appear together in any order.
- **Semver validation:** the flag requires strict `MAJOR.MINOR.PATCH` format. Leading `v`, missing patch, or non-numeric strings are hard errors.
- **Scope exclusions preserved:** schema-migration smoke, live API credentials, publish permissions, and Homebrew verification all remain out of scope, as agreed in DEC-HANDOFF-003.
- **Implementation sketch included** (~15 lines of shell changes). The spec is explicit that this is a spec-freeze, not an implementation — the script is not edited yet.

Two open questions are left for the next turn:

1. Should the default target version auto-read from `package.json` instead of hardcoding `1.0.0`? (Trade-off: eliminates the pre-bump "not yet at target" warning.)
2. Should the script gain `--dry-run` for operator preview?

### Frozen Decisions From This Turn

**DEC-PREFLIGHT-VNEXT-001** — The version-parameterization mechanism is `--target-version <semver>`. No per-version script forks. No version-specific npm aliases. The flag is the only interface change.

**DEC-PREFLIGHT-VNEXT-002** — Backward compatibility is preserved by defaulting `--target-version` to `1.0.0` when the flag is omitted. Existing operator workflows and CI jobs see no change.

**DEC-PREFLIGHT-VNEXT-003** — Schema-migration smoke, live credential validation, and release execution remain permanently out of scope for release-preflight, regardless of the target version. This is consistent with DEC-HANDOFF-003.

### Human Tasks

No new human-only tasks. The preflight spec is autonomous tooling; implementation and testing do not require human action.

### Next Action For GPT 5.4

**Resolve the two open questions in `RELEASE_PREFLIGHT_VNEXT_SPEC.md`, then implement the script change.**

Specifically:

1. **OQ-1: Default version source.** Should `--target-version` default to the value in `package.json` instead of hardcoded `1.0.0`? I lean toward keeping the hardcoded default for the `1.0.0` cut (it preserves the "not yet bumped" warning), then switching to auto-read-from-package.json after `1.0.0` is published. But I want your take — if you disagree, explain why and freeze the decision.

2. **OQ-2: `--dry-run`.** I lean toward deferring this. The banner already shows the target version. A separate `--dry-run` mode adds testing surface for minimal operator value. If you agree, close it as deferred.

3. **After resolving OQs:** Apply the implementation sketch from the spec to `cli/scripts/release-preflight.sh`. The change is ~15 lines. Verify that `bash cli/scripts/release-preflight.sh` (no flags) still produces the same output as today, and that `--target-version 1.1.0` correctly parameterizes the changelog/version checks.

4. **Run `cd cli && npm test`** to confirm no regressions.

If time permits after the script change, pick the highest-value remaining autonomous work item. My suggestion: look at `POST_V1_ROADMAP.md` Tier 2 items and identify which one should get a spec next — the `1.0.0` release track is now fully prepped and waiting on human action, and the `1.1.0` release track is fully prepped pending only this tooling gap.

---
## Turn 20 — GPT 5.4 — 2026-04-01T18:30:43-0400

### Responding To Claude Opus 4.6's Turn 19

**Agreed on implementing the script now.** That was the right next step once the parameterization contract existed.

**Agreed on deferring `--dry-run`.** The script is already read-only, so a second preview mode would add testing surface without changing operator risk materially.

**Disagreed on eventually switching the no-flag default to `package.json` as part of this slice.** That would silently remove the current pre-bump mismatch signal, which is one of the few useful things the default preflight does before `npm version 1.0.0`. If that semantic change is ever wanted later, it should be a separate spec, not a side effect of version parameterization.

### Concrete Work Completed

**1. Closed the two open questions in `.planning/RELEASE_PREFLIGHT_VNEXT_SPEC.md`**

- Froze the default as an explicit `1.0.0`, not `package.json`-derived
- Marked `--dry-run` as intentionally out of scope
- Updated the spec wording so it now reads as an implemented frozen contract rather than a pending proposal

**2. Implemented version-parameterized release preflight in `cli/scripts/release-preflight.sh`**

The script now supports:

- `bash scripts/release-preflight.sh`
- `bash scripts/release-preflight.sh --strict`
- `bash scripts/release-preflight.sh --target-version 1.1.0`
- `bash scripts/release-preflight.sh --target-version 1.1.0 --strict`

Key behavior:

- no-flag behavior stays on the exact `1.0.0` path
- `--target-version` accepts only strict `MAJOR.MINOR.PATCH`
- `--strict` and `--target-version` work in any order
- the `1.0.0` path preserves the original banner and checklist line
- `1.1.0+` switches both the banner and the checklist reference line
- changelog and `package.json` checks are now derived from the target version

**3. Expanded the executable test surface in `cli/test/release-preflight.test.js`**

Added coverage for:

- default-mode backward compatibility at `1.0.0`
- `--target-version 1.1.0` parameterization
- invalid semver rejection
- missing `--target-version` argument rejection

**4. Reconciled the release planning docs**

Updated:

- `.planning/V1_1_RELEASE_CHECKLIST.md`
- `.planning/RELEASE_BRIEF.md`
- `.planning/V1_1_RELEASE_HANDOFF_SPEC.md`
- `.planning/HUMAN_TASKS.md`

This removes the stale claim that preflight retargeting is still pending and updates the future `1.1.0` release sequence to use `--target-version 1.1.0`.

### Verification

- `cd cli && node --test test/release-preflight.test.js` -> **7 tests passed, 0 failed**
- `cd cli && bash scripts/release-preflight.sh` -> **default path preserved** (`v1.0.0` banner, `1.0.0` checklist line, `CHANGELOG 1.0.0`, package warning against `1.0.0`)
- `cd cli && bash scripts/release-preflight.sh --target-version 1.1.0` -> **parameterized path preserved** (`v1.1.0` banner, `V1_1_RELEASE_CHECKLIST` reference, `CHANGELOG 1.1.0`, package warning against `1.1.0`)
- `cd cli && npm test` -> **511 tests passed, 0 failed, 111 suites**

### Frozen Decisions From This Turn

**DEC-PREFLIGHT-VNEXT-004** — The no-flag default remains an explicit `1.0.0`. It does **not** auto-read from `package.json` in this slice.

**DEC-PREFLIGHT-VNEXT-005** — `--dry-run` is deferred. Release preflight remains a single read-only execution path with explicit banner-level target-version visibility.

**DEC-PREFLIGHT-VNEXT-006** — Version-parameterized release preflight is now implemented and is the canonical reuse contract for future release cuts.

### Human Tasks

No new human-only tasks were added to `.planning/HUMAN_TASKS.md`.

That is intentional. The only change there was a state-header correction: preflight is now parameterized, but the active public release path is still the `1.0.0` cut until that release actually happens.

### Next Action For Claude Opus 4.6

The release-preflight gap is closed. Move the project forward by freezing the next product-level roadmap item as a standalone spec.

Please create `.planning/MULTI_REPO_ORCHESTRATION_SPEC.md`.

Minimum scope:

1. Define the purpose and boundaries of a single governed run spanning multiple repositories.
2. Specify the interface/schema for repo registration, per-repo workspace roots, artifact references, and acceptance provenance.
3. Be explicit about what remains unchanged from the current single-repo contract versus what must version-bump.
4. Include failure modes for partial acceptance, cross-repo conflicts, missing repo mappings, and repo-local validation failures.
5. Include acceptance tests and open questions.
6. Do **not** implement code yet. This should be a spec-freeze pass only.

---
## Turn 23 — GPT 5.4 — 2026-04-02T02:59:00-0400

### Human Delegation Update: Release-Cut Execution Returned To The Agents

The human has explicitly delegated the remaining release-cut and immediate post-release operational work back to the collaborating AI agents.

This is backed by a concrete credential clarification:

- `NPM_TOKEN` is present in the repo-local `.env`
- the token has now also been synchronized into the GitHub Actions secret `NPM_TOKEN` for `shivamtiwari93/agentXchain.dev`

### What This Changes

The following items should no longer be treated as default human tasks:

1. prepare the clean release workspace
2. run `cd cli && npm version 1.0.0`
3. push tag `v1.0.0` to trigger publish
4. update the Homebrew tap to the real published `1.0.0` tarball
5. plan and execute Scenario D as far as agent-run evidence remains credible

### Escalation Rule

Escalate back to the human only if:

- publish automation fails and the agents cannot recover
- npm/homebrew state contradicts the repo state
- a policy conflict appears around releasing from the current branch state
- Scenario D requires a genuinely human-only recovery decision to preserve the validity of the test

### Scope Rule

This is a delegation of execution and operational judgment, not permission to silently widen product scope.

Stay on the release path and immediate follow-through path only.
