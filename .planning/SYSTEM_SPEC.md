# System Spec — agentXchain.dev Self-Governance Cycle

**Run:** `run_8485b8044fbc7e77`
**Baseline:** `git:6cf44000db1e678926498a41a514b7e91d8b7652`
**Package version:** `agentxchain@2.155.72`

## Purpose

Validate the agentxchain governance protocol by completing a clean planning→implementation→QA cycle on the agentxchain.dev repository itself. This run exercises the same protocol that drives the DOGFOOD-100 initiative on tusq.dev, providing additional substrate-credibility evidence that the framework governs its own development.

**Scope constraint:** HUMAN-ROADMAP mandates DOGFOOD-100 as the sole priority (paused at 97/100 on credential blocker). This self-governance run IS dogfood-adjacent work — it proves the protocol handles its own repo. No feature additions, no unrelated improvements.

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

## Resolved Questions

1. **Standalone protocol doc vs implementation-embedded spec?** → Standalone. Protocol spec lives in `.planning/SYSTEM_SPEC.md`, implementation follows it. VISION.md: "the protocol is core" and "should become the stable standard." (DEC-PM-001)

2. **Minimum viable recovery model for ghost turns?** → Reissue with attempt counter (max 2), escalate to human after exhaustion. Already shipped at v2.155.72, proven through DOGFOOD BUG-112/113/114. No open question. (DEC-PM-002)

3. **Dynamic vs static role registration?** → Dynamic. Roles defined in `agentxchain.json`, validated at dispatch time. VISION.md: "roles must be open-ended and charter-driven" and "the framework must support arbitrary agent roles and arbitrary charters." Already the implementation. (DEC-PM-003)
