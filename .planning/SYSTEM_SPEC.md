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

## Resolved Questions

1. **Standalone protocol doc vs implementation-embedded spec?** → Standalone. Protocol spec lives in `.planning/SYSTEM_SPEC.md`, implementation follows it. VISION.md: "the protocol is core" and "should become the stable standard." (DEC-PM-001)

2. **Minimum viable recovery model for ghost turns?** → Reissue with attempt counter (max 2), escalate to human after exhaustion. Already shipped at v2.155.72, proven through DOGFOOD BUG-112/113/114. No open question. (DEC-PM-002)

3. **Dynamic vs static role registration?** → Dynamic. Roles defined in `agentxchain.json`, validated at dispatch time. VISION.md: "roles must be open-ended and charter-driven" and "the framework must support arbitrary agent roles and arbitrary charters." Already the implementation. (DEC-PM-003)

4. **What causes ghost turns on local_cli runtimes with stream-json output?** → Missing `--verbose` flag in runtime command config. Claude Code CLI requires `--verbose` when `--print --output-format stream-json` is used. Without it, immediate exit (code 1) with error to stderr only → orchestrator never sees startup proof → ghost classification. Fixed in commit `6cf44000d`. (DEC-PM-004, run `run_984f0f8c07a30a5c`)
