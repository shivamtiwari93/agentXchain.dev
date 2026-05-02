# System Spec — agentXchain.dev M1 Ghost Turn Elimination

**Run:** `run_984f0f8c07a30a5c`
**Baseline:** `git:da4cd47ac3e5ff7f5e86715f9ae99b7a17149e5d`
**Package version:** `agentxchain@2.155.72`

## Purpose

Diagnose and document the root cause of ghost turns when dispatching to `local_cli` runtimes with `stream-json` output, then harden the adapter and watchdog layers to prevent recurrence. This addresses ROADMAP M1: Self-Governance Hardening — Ghost Turn Elimination.

**Scope:** Ghost turn root cause diagnosis (completed by PM), followed by implementation of startup heartbeat, configurable turn timeout, and regression test coverage (dev phase).

## Interface

### State Machine

- **Phases:** `planning` → `implementation` → `qa`
- **Transitions:** gated by `planning_signoff`, `implementation_complete`, `qa_ship_verdict`
- **State file:** `.agentxchain/state.json` (orchestrator-owned, agents must not modify)

### Turn Contract

Each role produces a `turn-result.json` in `.agentxchain/staging/<turn_id>/` with schema version `1.0`. Required fields: `run_id`, `turn_id`, `role`, `runtime_id`, `status`, `summary`, `decisions[]`, `objections[]`, `files_changed[]`, `verification`, `artifact`, `proposed_next_role`.

### Turn Artifact Contract

- `artifact.type: "workspace"` — role modified repo files. `files_changed` must be non-empty and match observed diff.
- `artifact.type: "review"` — role performed governance/QA/PM work without repo mutations. `files_changed` must be `[]`.
- `artifact.type: "patch"` — role returned structured proposed changes rather than direct writes.
- `artifact.type: "commit"` — role produced or referenced a git commit artifact.
- Empty `workspace` artifacts are recoverable only when the turn is unambiguously a no-edit review; accepted record is normalized to `review` and an `artifact_type_auto_normalized` event is emitted.

### Gate Files

| Gate | Required Files |
|------|---------------|
| `planning_signoff` | `.planning/PM_SIGNOFF.md`, `.planning/ROADMAP.md`, `.planning/SYSTEM_SPEC.md` |
| `implementation_complete` | `.planning/IMPLEMENTATION_NOTES.md` + verification pass |
| `qa_ship_verdict` | `.planning/acceptance-matrix.md`, `.planning/ship-verdict.md`, `.planning/RELEASE_NOTES.md` + verification pass |

### Role Configuration

Roles defined dynamically in `agentxchain.json`. Current roster: `pm`, `dev`, `qa`, `eng_director`. Each role has `title`, `mandate`, and `runtime` binding. Framework supports arbitrary roles with arbitrary charters per VISION.md.

## Behavior

### Phase Progression
1. Orchestrator dispatches `entry_role` for current phase
2. Role executes, produces turn-result.json
3. Orchestrator validates schema, accepts or rejects
4. If accepted: check gate requirements. If gate satisfied → advance phase. If not → route to `proposed_next_role`
5. If rejected: reissue with incremented attempt counter (max 2 retries)

### Ghost Turn Recovery
- If a dispatched turn times out (no result within deadline), orchestrator marks it as `auto_retry_ghost`
- Turn is reissued with new `turn_id`, attempt counter incremented
- After `max_turn_retries` (2) exhausted, escalate to human via `HUMAN_TASKS.md`
- Proven through DOGFOOD BUG-112/113/114 on tusq.dev

### Ghost Turn Root Cause (M1 Diagnosis)

**Diagnosed in `run_984f0f8c07a30a5c`.** Three ghost turns occurred across `run_5fb440e67c8d1cae` and `run_2768a5d6ca1ca89a`:

| Turn | Run | Duration | Pattern |
|------|-----|----------|---------|
| `turn_1da85f162e414be8` | `run_5fb440e67c8d1cae` | 180.6s | Startup watchdog timeout (no stdout within 180s) |
| `turn_1669b781a7401218` | `run_2768a5d6ca1ca89a` | 2.1s | Immediate CLI rejection |
| `turn_cd361d6f48043439` | `run_2768a5d6ca1ca89a` | 2.2s | Immediate CLI rejection |

**Root cause:** The runtime command in `agentxchain.json` used `--print --output-format stream-json` without the `--verbose` flag. Claude Code CLI validates this flag combination at startup and rejects it immediately with `Error: When using --print, --output-format=stream-json requires --verbose` written to **stderr only** (exit code 1).

**Why this manifests as a ghost (not a crash):**
1. The error goes to stderr, which the orchestrator correctly classifies as `diagnostic_only` (per DEC-BUG54: stderr is NOT startup proof)
2. `first_output_at` is only set by stdout output — never set in this case
3. No turn-result.json is staged because the agent process never starts
4. The stale-turn-watchdog fires when the startup proof deadline expires without `first_output_at`
5. For the 2-second ghosts: the process had already exited, but the watchdog still classifies it as a ghost because no startup proof was observed

**Fix applied:** Commit `6cf44000d` added `--verbose` to both `local-opus-4.7` and `local-opus-4.6` runtime command arrays. Subsequent run `run_8485b8044fbc7e77` completed all 3 phases (PM→Dev→QA) with zero ghost turns.

**Architectural finding:** The orchestrator's ghost detection, output classification, and recovery logic are all correct. The failure was purely a configuration-level issue. However, the adapter layer has no explicit validation of CLI flag compatibility before spawning — it passes the command array verbatim to `spawn()`. This is an improvement opportunity (see M1 remaining items).

### Challenge Requirement
- `rules.challenge_required: true` — every role must explicitly challenge the previous turn's work
- No rubber-stamping; substantive review of prior decisions

### Artifact Normalization
- Staged results with shape mismatches (e.g., `workspace` with empty `files_changed`) are auto-normalized when unambiguous
- Non-normalizable mismatches are rejected with typed validation errors
- Proven through DOGFOOD BUG-78/79/80-89

## Error Cases

| Failure Mode | Response |
|-------------|----------|
| Turn timeout (ghost) | Reissue with attempt counter; escalate after max retries |
| Schema validation failure | Reject turn, log error, reissue |
| Credential failure (provider 401) | Classify as `dispatch:claude_auth_failed`, pause session, escalate to human |
| Gate files missing | Block phase transition, route to owning role |
| Budget exceeded | Pause and escalate per `budget.on_exceed` |
| Session break (operator restart) | Counter resets to 0 under DOGFOOD strict criteria |
| Deadlock (role ping-pong) | `max_deadlock_cycles: 2`, then escalate to `eng_director` or human |

## Acceptance Tests

- [x] Planning gate: PM_SIGNOFF.md exists with `Approved: YES`, ROADMAP.md and SYSTEM_SPEC.md complete
- [ ] Turn validation: orchestrator accepts well-formed turn-result.json and rejects malformed ones *(dev phase)*
- [ ] Phase transition: planning→implementation advances when all gate files present *(dev phase — observe whether this transition fires)*
- [ ] Ghost recovery: timed-out turn is reissued without human intervention *(already evidenced: 4 ghost reissues in history.jsonl for this project)*
- [ ] End-to-end: complete planning→implementation→QA cycle produces inspectable audit trail in `.agentxchain/history.jsonl` *(QA phase)*

### Roadmap Tracking Annotations (M1 — run `run_cc4217fafd6611bc`)

**Problem:** `deriveRoadmapCandidates()` in `vision-reader.js` treats every unchecked `[ ]` item under a milestone heading as actionable open work. Longitudinal criteria (e.g., "zero ghost turns across N consecutive runs") cannot be completed in a single run, causing an infinite re-trigger loop where the scanner spawns a new run each time a prior run completes without checking off the item.

**Solution:** Inline `<!-- tracking: ... -->` HTML comment annotations on ROADMAP items. When `deriveRoadmapCandidates()` encounters an unchecked item whose line contains `<!-- tracking:`, it skips the item — treating it as actively tracked but not actionable for a new run.

**Annotation format:**
```
- [ ] Goal description <!-- tracking: <progress description> -->
```

**Semantics:**
- The item remains visually unchecked (`[ ]`) for human review
- The annotation documents current progress (e.g., `3/10 zero-ghost runs`)
- The scanner skips the item, preventing re-triggering
- When the criterion is met, the annotation is removed and the item is checked off (`[x]`)
- Annotations must include evidence references (run IDs, dates) so they can be verified

**Implementation:** Single guard clause in `deriveRoadmapCandidates()` after the unchecked regex match, checking for `<!-- tracking:` in the line text.

### Idle-Expansion Three-State Model (M2 — run `run_e9d2aeed559c018e`)

**Problem:** `detectRoadmapExhaustedVisionOpen()` and `deriveRoadmapCandidates()` disagree on what counts as "unchecked." `deriveRoadmapCandidates()` skips `<!-- tracking: -->` annotated items (added in `run_cc4217fafd6611bc`), but `detectRoadmapExhaustedVisionOpen()` counts them as unchecked, short-circuiting exhaustion detection with `{ open: false, reason: 'has_unchecked' }`.

**Three-state model:**

| State | `deriveRoadmapCandidates` | `detectRoadmapExhaustedVisionOpen` | Correct action |
|-------|--------------------------|-----------------------------------|----------------|
| Roadmap has actionable work | returns candidates | not called (candidates > 0) | Dispatch roadmap work |
| Roadmap functionally exhausted, vision open | returns 0 candidates (tracked items skipped) | should return `{ open: true }` | Dispatch PM roadmap replenishment |
| Vision fully addressed | returns 0 candidates | returns `{ open: false, reason: 'vision_fully_mapped' }` | idle_exit or vision_exhausted |

**Fix:** Add `ROADMAP_TRACKING_ANNOTATION_PATTERN` guard to the `hasUnchecked` check in `detectRoadmapExhaustedVisionOpen()`. Tracked items should not count as unchecked for exhaustion purposes.

**Annotation format reference:**
```
- [ ] Goal description <!-- tracking: <progress description> -->
```

**Semantics:** Tracked items are functionally equivalent to checked items for exhaustion detection — they represent in-progress longitudinal criteria that cannot be completed in a single cycle.

### Vision-Driven Roadmap Replenishment Dispatch (M2 — run `run_b51cc53d95925d53`)

**Context:** When `seedFromVision()` finds zero actionable roadmap candidates (all checked or tracked) but VISION.md has unplanned scope, the system must dispatch PM to derive the next bounded roadmap increment — not idle-stop or fall through to generic vision candidates.

**Implementation (BUG-77, already shipped):**

`seedFromVision()` in `continuous-run.js` enforces a strict priority:

1. **Roadmap unchecked work** (`deriveRoadmapCandidates`) — dispatch the roadmap item directly
2. **Roadmap exhausted + vision open** (`detectRoadmapExhaustedVisionOpen`) — create PM replenishment intent
3. **Broad VISION goals** (`deriveVisionCandidates`) — fallback to generic candidates

When state 2 fires, `seedFromVision()`:
- Records intake event with `category: 'roadmap_exhausted_vision_open'`
- Creates intent with `preferred_role: 'pm'`, `phase_scope: 'planning'`, `priority: 'p1'`
- Charter directs PM to read VISION.md + ROADMAP.md, select one next testable milestone from unplanned sections, and produce concrete unchecked items
- Auto-approves in continuous mode (`triageApproval: 'auto'`)
- Returns `{ idle: false, source: 'roadmap_replenishment' }`
- Main loop emits status: "Roadmap exhausted, vision still open, deriving next increment"

**Dependencies:** Requires `detectRoadmapExhaustedVisionOpen()` to correctly skip tracking-annotated items (fixed in `run_e9d2aeed559c018e`).

**Test coverage:**
- Unit: `vision-reader.test.js` — `detectRoadmapExhaustedVisionOpen` three-state with tracked items
- Integration: `bug-77-roadmap-exhausted-vision-open.test.js` — CLI continuous mode dispatches PM replenishment
- Integration: `seedFromVision()` three-state regression tests (added in this run)

### Tracking Annotation Defense-in-Depth (M2 — run `run_bd3c68e0331fa956`)

**Problem:** M2 item #5 was re-triggered by the vision scanner despite having a `<!-- tracking: 0/5 ... -->` annotation. The tracking skip in `deriveRoadmapCandidates()` at line 264 works correctly (verified by direct regex test and function invocation), but a timing anomaly caused the scan to read the ROADMAP before the checkpoint commit persisted the annotation.

**Two defense-in-depth gaps identified:**

1. **Goal text leaks annotation markup:** The unchecked regex capture group `(.+?)` at line 262 captures the full line text including any `<!-- tracking: ... -->` comment. If a tracked item bypasses the skip, the annotation pollutes the charter text and `isGoalAddressed()` keyword matching.

2. **No mixed-state integration test:** Existing tests cover all-tracked → replenishment and simple-unchecked → roadmap_open_work, but not the mixed state (tracked M1/M2 + untracked M3) which is the normal operating state.

**Fix:**
- Strip `ROADMAP_TRACKING_ANNOTATION_PATTERN` from goal text at extraction time (line 266 of `vision-reader.js`)
- Add `seedFromVision()` mixed-state integration test: tracked items skipped, untracked items returned, charter text clean

**Test coverage:**
- Unit: `vision-reader.test.js` — tracking annotation skip (existing)
- Integration: `continuous-run.test.js` — `seedFromVision` mixed tracked + untracked state (new)
- Integration: `seedFromVision()` three-state regression tests (existing)

### Multi-Model Turn Handoff Context Preservation (M3 — run `run_fb3583590a1a4799`)

**Problem:** When a governed turn completes and the next role is dispatched to a different model (e.g., PM on Opus 4.7 → Dev on GPT 5.5 → QA on Opus 4.6), the CONTEXT.md handoff document omits which model produced the prior turn's work. The receiving model sees decisions, summaries, and objections but cannot distinguish Claude-authored work from GPT-authored work.

**Three gaps identified:**

| Gap | Location | Data available? | Rendered? |
|-----|----------|----------------|-----------|
| Last Accepted Turn missing `runtime_id` | `dispatch-bundle.js:798-813` | YES (history entry at `governed-state.js:5171`) | NO |
| Decision history table missing Runtime column | `dispatch-bundle.js:1415-1420` | NO (ledger lacks `runtime_id`) | NO |
| Decision ledger entries missing `runtime_id` | `governed-state.js:5236-5248` | YES (available as `turnResult.runtime_id` at write time) | N/A |

**Impact on cross-model handoff quality:**
- QA (Opus 4.6) challenging Dev (GPT 5.5) cannot distinguish model-specific patterns
- PM (Opus 4.7) reviewing GPT-authored decisions cannot contextualize model-specific reasoning
- The decision history table (50+ entries) provides no model attribution

**Fix:**
1. Persist `runtime_id` in decision ledger entries at `governed-state.js:5236`
2. Render `runtime_id` in "Last Accepted Turn" section at `dispatch-bundle.js:799`
3. Add `Runtime` column to decision history table at `dispatch-bundle.js:1415`

**Backward compatibility:** Pre-M3 ledger entries lack `runtime_id`. Rendering code uses `d.runtime_id || ''` to show empty cells for historical decisions. No backfill needed.

**Test coverage:**
- Unit: `renderContext()` includes `runtime_id` in Last Accepted Turn when present
- Unit: `renderDecisionHistory()` includes Runtime column with mixed populated/empty entries
- Integration: cross-runtime handoff scenario with GPT 5.5 → Opus 4.6 handoff

### Output Format Parsing Validation (M3 — run `run_3a396386e18575b6`)

**Problem:** The local CLI adapter's output handling is asymmetrically developed across runtime types. Claude runtimes (`--output-format stream-json`) receive three layers of output-aware behavior, while Codex runtimes (`--json`) receive none. This creates misclassification of Codex failures and silent configuration errors.

**Two production runtime output formats in use:**

| Runtime | Binary | Output flag | Format | Error classification |
|---------|--------|------------|--------|---------------------|
| `local-opus-4.7` | `claude` | `--output-format stream-json` | NDJSON event stream | YES (3 classifiers) |
| `local-opus-4.6` | `claude` | `--output-format stream-json` | NDJSON event stream | YES (3 classifiers) |
| `local-gpt-5.5` | `codex` | `--json` | Single JSON blob | NO (zero classifiers) |

**Existing Claude-specific output handling (reference):**
1. `validateLocalCliCommandCompatibility()` at `local-cli-adapter.js:741` — blocks dispatch when `--print --output-format stream-json` is used without `--verbose`
2. `hasClaudeAuthFailureOutput()` at `local-cli-adapter.js:796` — matches `authentication_failed|authentication_error|invalid authentication credentials|unauthorized|API Error:\s*401` against stdout/stderr logs
3. `hasClaudeNodeRuntimeIncompatibilityOutput()` at `local-cli-adapter.js:801` — matches Node.js version incompatibility patterns against stderr

**Missing Codex output handling (gap):**
1. No `isCodexLocalCliRuntime()` detector in adapter scope — `connector-probe.js:354` has the logic but it's not exported for adapter use
2. No `hasCodexAuthFailureOutput()` classifier — Codex/OpenAI auth errors go undetected
3. No Codex error branch in `dispatchLocalCli()` close handler — Codex failures always fall through to the generic "subprocess exited without writing a staged turn result" path
4. No Codex command validation in `validateLocalCliCommandCompatibility()` — missing `exec` subcommand is not caught at pre-flight

**Impact on multi-model handoff quality:**
- Codex auth failures are reported as generic retryable failures, wasting 2 retry attempts before human escalation
- Codex command misconfiguration is only caught at runtime (subprocess exit), not at dispatch pre-flight
- The orchestrator's `classified.error_class` field is always empty for Codex failures, preventing automated recovery routing

**Fix:**
1. Add `isCodexLocalCliRuntime()` detector — pattern: binary is `codex` or ends with `/codex`
2. Add `hasCodexAuthFailureOutput()` classifier — match OpenAI auth error patterns
3. Add Codex error branch in `dispatchLocalCli()` close handler at `local-cli-adapter.js:504` — return `{ blocked: true, classified: { error_class: 'codex_auth_failed' } }`
4. Extend `validateLocalCliCommandCompatibility()` — catch `codex` without `exec` subcommand

**Design constraint:** The adapter's turn result contract remains file-based (staged `turn-result.json`). Output parsing is diagnostic-only — it classifies errors and collects audit logs, but never extracts turn results from stdout. Cost event parsing from stream-json is deferred to M4.

**Test coverage:**
- Unit: Codex `--json` auth failure → `codex_auth_failed` typed blocker
- Unit: Codex missing `exec` → `local_cli_command_incompatible` pre-flight block
- Unit: Codex `--json` normal turn → `ok: true` with staged result
- Regression: Claude `stream-json` auth failure → `claude_auth_failed` (unchanged)
- Regression: Claude `stream-json` normal turn → `ok: true` (unchanged)

### Checkpoint Model Identity Metadata (M3 — run `run_37fb509c4b6ed593`)

**Problem:** The checkpoint flow in `turn-checkpoint.js` records `runtime_id` in the git commit body (`Runtime: local-opus-4.6` at line 211) but omits it from three programmatic metadata surfaces that downstream code reads.

**Three gaps identified:**

| Surface | Location | runtime_id available? | runtime_id persisted? |
|---------|----------|----------------------|----------------------|
| Checkpoint commit body | turn-checkpoint.js:211 | YES | YES (already present) |
| `state.json last_completed_turn` | turn-checkpoint.js:469-476 | YES (from history entry) | NO |
| `turn_checkpointed` event | turn-checkpoint.js:479-486 | YES (from history entry) | NO |
| Checkpoint commit subject | turn-checkpoint.js:205 | YES (from history entry) | NO |

**Impact on multi-model audit and tooling:**
- Consumers reading `state.json` to learn about the last checkpoint (session-checkpoint.js:95, operator-commit-reconcile.js:71) get turn/role/phase but not which model produced the work
- Event consumers processing events.jsonl `turn_checkpointed` entries cannot determine model identity without cross-referencing history.jsonl
- `git log --oneline` shows only role/phase in checkpoint subjects — model identity requires `git show` to read the body

**Fix:**
1. Add `runtime_id: entry.runtime_id || null` to `last_completed_turn` object at turn-checkpoint.js:469
2. Add `runtime_id: entry.runtime_id || null` to `turn` object in `turn_checkpointed` event at turn-checkpoint.js:483
3. Add `runtime=${entry.runtime_id || '(unknown)'}` to checkpoint commit subject at turn-checkpoint.js:205

**Backward compatibility:** History entries from pre-runtime_id era have `runtime_id: undefined`. The `|| null` / `|| '(unknown)'` fallbacks produce clean output for legacy entries. No backfill needed.

**Test coverage:**
- Unit: `state.json last_completed_turn.runtime_id` populated after checkpoint
- Unit: `turn_checkpointed` event includes `runtime_id` in `turn` object
- Unit: Checkpoint commit subject includes `runtime=<id>`
- Unit: Legacy entries without `runtime_id` produce `null`/`(unknown)` fallbacks

## Resolved Questions

1. **Standalone protocol doc vs implementation-embedded spec?** → Standalone. Protocol spec lives in `.planning/SYSTEM_SPEC.md`, implementation follows it. VISION.md: "the protocol is core" and "should become the stable standard." (DEC-PM-001)

2. **Minimum viable recovery model for ghost turns?** → Reissue with attempt counter (max 2), escalate to human after exhaustion. Already shipped at v2.155.72, proven through DOGFOOD BUG-112/113/114. No open question. (DEC-PM-002)

3. **Dynamic vs static role registration?** → Dynamic. Roles defined in `agentxchain.json`, validated at dispatch time. VISION.md: "roles must be open-ended and charter-driven" and "the framework must support arbitrary agent roles and arbitrary charters." Already the implementation. (DEC-PM-003)

4. **What causes ghost turns on local_cli runtimes with stream-json output?** → Missing `--verbose` flag in runtime command config. Claude Code CLI requires `--verbose` when `--print --output-format stream-json` is used. Without it, immediate exit (code 1) with error to stderr only → orchestrator never sees startup proof → ghost classification. Fixed in commit `6cf44000d`. (DEC-PM-004, run `run_984f0f8c07a30a5c`)
