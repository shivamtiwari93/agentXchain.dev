# V1.1 Release Scope Spec — AgentXchain

> **SUPERSEDED.** This defined the v1.1.0 graduating features. v1.1.0 was never published as a separate release — these features shipped as part of the 2.x series starting at v2.1.1. The activation semantics and acceptance criteria documented here remain accurate descriptions of the shipped behavior. Preserved for historical feature-scope context.

---

## Purpose

v1.0.0 ships a single-run, single-repo, sequential-turn governed protocol. Five feature sets are already implemented and tested in the workspace but excluded from the v1.0.0 contract. This spec freezes the v1.1 release boundary: what ships, how it activates, what breaks if misconfigured, and how we know it's done.

---

## Graduating Features

### F1: Parallel Agent Turns

**Activation:** `max_concurrent_turns > 1` in `agentxchain.json` phase config.
**Default:** `max_concurrent_turns = 1` (v1.0.0 sequential behavior preserved).
**Cap:** `max_concurrent_turns <= 4` (DEC-PARALLEL-010).
**Schema impact:** `schema_version` bumps from `"1.0"` to `"1.1"`. `current_turn` is replaced by `active_turns` map. Backward-compatible reader migrates `current_turn` to `active_turns` on first load.
**Operator surface changes:**
- `status` and `status --json` render multiple active turns
- `step --resume --turn <id>` for targeted resume
- `accept-turn --turn <id>` / `reject-turn --turn <id>` for targeted acceptance
- `reject-turn --turn <id> --reassign` for conflict-caused re-dispatch
- Ambiguous commands (e.g. `step --resume` with multiple active turns and no `--turn`) fail with guidance
**Specs:** `PARALLEL_TURN_STATE_MODEL_SPEC.md`, `PARALLEL_DISPATCH_SPEC.md`, `PARALLEL_MERGE_ACCEPTANCE_SPEC.md`, `PARALLEL_CONFLICT_RECOVERY_SPEC.md`

### F2: Auto-Retry with Backoff (api_proxy)

**Activation:** `retry_policy.enabled = true` on an `api_proxy` runtime config block.
**Default:** No `retry_policy` block or `enabled = false` — v1.0.0 one-shot behavior.
**Scope:** Adapter-local only. Does not create governed turns, mutate governed attempt counters, or change the turn lifecycle.
**Audit artifact:** `api-retry-trace.json` in the dispatch directory when retries occur.
**Cost accounting:** Success-path `turn-result.json → cost` aggregates usage across all attempts (including retried ones).
**Spec:** `API_PROXY_RETRY_POLICY_SPEC.md`

### F3: Preemptive Tokenization

**Activation:** `preflight_tokenization.enabled = true` on an `api_proxy` runtime config block.
**Prerequisite:** `context_window_tokens` must be set (positive integer) when preflight is enabled.
**Default:** No `preflight_tokenization` block or `enabled = false` — v1.0.0 behavior (context overflow detected post-hoc via API error).
**Scope:** `api_proxy` + `anthropic` provider only in v1.1.
**Audit artifacts:** `TOKEN_BUDGET.json` and `CONTEXT.effective.md` in the dispatch directory.
**Behavior:** Local token count before dispatch. If over budget, attempt bounded compression of advisory context sections. If still over budget, fail locally with `context_overflow` without making the API call.
**Spec:** `PREEMPTIVE_TOKENIZATION_SPEC.md`

### F4: Provider-Specific Error Mapping (Anthropic)

**Activation:** Automatic when the runtime provider is `anthropic`. No config opt-in required.
**Default:** Active. This is a precision improvement to existing error classification, not a new behavior mode.
**Behavior:**
- Provider-native error type extraction runs before the HTTP-status fallback
- New error classes: `invalid_request`, `provider_overloaded`
- Daily/spend 429s classified as `rate_limited` but non-retryable
- Anthropic 529 (`overloaded_error`) classified as `provider_overloaded` and retryable
- `provider_error_type` / `provider_error_code` preserved in `api-error.json`
- Unknown structured provider errors fall back to HTTP classification while preserving provider fields
**Spec:** `PROVIDER_ERROR_MAPPING_SPEC.md`

### F5: Persistent Blocked State

**Activation:** Automatic. No config opt-in required.
**Default:** Active. This is a state-visibility improvement, not a new behavior mode.
**Behavior:**
- `blocked` is a first-class `state.json` status alongside `idle`, `active`, `paused`, `completed`, `failed`
- `blocked_reason` is required whenever `status === "blocked"`
- Enters `blocked` on: accepted `needs_human`, retry exhaustion/escalation, surfaced dispatch failure after adapter-local retries exhausted or non-retryable error
- `paused` survives only for explicit human approval gates (phase transitions, run completion)
- Legacy `paused + human:*` / `paused + escalation:*` states migrate in-place to `blocked` on read
- `step --resume` is the recovery path for preserved-turn blocked states
**Spec:** `PERSISTENT_BLOCKED_STATE_SPEC.md`

---

## Activation / Defaults Summary

| Feature | Activation | v1.0.0 Default | v1.1 Default |
|---------|-----------|----------------|--------------|
| Parallel turns | `max_concurrent_turns > 1` | `1` (sequential) | `1` (sequential) |
| Auto-retry | `retry_policy.enabled = true` | absent (no retry) | absent (no retry) |
| Preemptive tokenization | `preflight_tokenization.enabled = true` | absent (no preflight) | absent (no preflight) |
| Provider error mapping | Automatic (Anthropic) | N/A | Active |
| Persistent blocked state | Automatic | N/A | Active |

**Key invariant:** A v1.0.0 config file with no new fields runs identically under v1.1. No silent behavior changes. The two automatic features (F4, F5) improve precision and visibility but do not change the operator's required actions.

---

## Schema Version

v1.1 bumps `schema_version` from `"1.0"` to `"1.1"`.

**Migration contract:**
- v1.1 reads `"1.0"` state files and migrates in place (backward compatible reader).
- v1.0 does NOT read `"1.1"` state files. Forward compatibility is not guaranteed.
- Migration is triggered on first `loadGovernedState()` call. The migrated state is written back immediately.
- Migration actions:
  1. `current_turn` (if present) → `active_turns[turn_id]`; `current_turn` field removed.
  2. `paused + human:*` / `paused + escalation:*` → `blocked` + `blocked_reason`.
  3. `schema_version` updated to `"1.1"`.

**Validation:**
- v1.1 rejects state files with `schema_version` values other than `"1.0"` or `"1.1"`.
- v1.1 rejects state files with `schema_version: "1.1"` that still contain `current_turn`.

---

## Error Cases

### Configuration Errors (fail at `init` or first `step`)

| Condition | Error |
|-----------|-------|
| `max_concurrent_turns < 1` | Config validation failure |
| `max_concurrent_turns > 4` | Config validation failure (v1.1 cap) |
| `retry_policy.enabled = true` with `max_attempts < 1` | Config validation failure |
| `retry_policy.retry_on` contains unknown class | Config validation failure |
| `preflight_tokenization.enabled = true` without `context_window_tokens` | Config validation failure |
| `context_window_tokens <= max_output_tokens + safety_margin_tokens` | Config validation failure |

### Runtime Errors

| Condition | Behavior |
|-----------|----------|
| Parallel acceptance file conflict | Turn moves to `conflicted` substatus; operator chooses `reject_and_reassign` or `human_merge` |
| Retry exhaustion (all attempts failed) | Run enters `blocked` with `retries_exhausted` reason |
| Preflight context overflow after compression | Local `context_overflow` failure, no API call made |
| Provider error mapping finds no match | Falls back to HTTP-status classification (v1.0 behavior) |

---

## Acceptance Tests

### AT-1: v1.0.0 Config Backward Compatibility
- Given a valid v1.0.0 `agentxchain.json` (no new fields)
- When run under v1.1
- Then behavior is identical to v1.0.0: sequential turns, no retry, no preflight, blocked state active, provider mapping active

### AT-2: Schema Migration
- Given a `state.json` with `schema_version: "1.0"` and `current_turn` populated
- When loaded by v1.1
- Then `schema_version` becomes `"1.1"`, `active_turns` contains the migrated turn, `current_turn` is removed

### AT-3: Parallel Turn Happy Path
- Given `max_concurrent_turns = 2`
- When two turns are assigned to different roles
- Then both appear in `status --json`, both can be independently accepted, history records both

### AT-4: Parallel Conflict Detection
- Given two active turns with overlapping observed files
- When the second is accepted after the first
- Then the second enters `conflicted` substatus with persisted conflict state

### AT-5: Retry Policy Activation
- Given `retry_policy.enabled = true, max_attempts = 3`
- When the first API call returns a retryable 429
- Then the adapter retries with backoff, `api-retry-trace.json` is written, and success-path cost aggregates all attempts

### AT-6: Retry Exhaustion
- Given `retry_policy.enabled = true, max_attempts = 2`
- When both attempts fail with retryable errors
- Then the run enters `blocked` with `retries_exhausted` category

### AT-7: Preemptive Tokenization Overflow
- Given `preflight_tokenization.enabled = true` and a bundle that exceeds `available_input_tokens` even after compression
- Then the adapter fails locally with `context_overflow`, no API call is made, `TOKEN_BUDGET.json` records the overflow

### AT-8: Provider Error Mapping Precision
- Given Anthropic returns 429 with `error.type = "rate_limit_error"` and daily spend indicator
- Then classified as `rate_limited` and `retryable = false`

### AT-9: Blocked State Visibility
- Given a turn completes with `needs_human`
- Then `state.json.status === "blocked"`, `blocked_reason.category === "needs_human"`, and `status` CLI renders `BLOCKED`

### AT-10: Forward Compatibility Guard
- Given a `state.json` with `schema_version: "2.0"` (unknown)
- Then v1.1 rejects with a clear error message pointing to version mismatch

---

## What Is NOT In v1.1

- Multi-repo orchestration (v2.0)
- OpenAI / other provider error mappings (v1.2+)
- `preflight_tokenization` for `local_cli` or `manual` adapters
- `max_concurrent_turns > 4`
- Automatic three-way merge for conflicts
- Push-based conflict notification
- Batch multi-turn adapter dispatch
- Scenario D live escalation dogfood (requires human operator post-release, tracked in HUMAN_TASKS.md)

---

## Open Questions

1. **SPEC-GOVERNED update timing:** Should `SPEC-GOVERNED-v4.md` be updated to a v5 reflecting v1.1 additions before or after the v1.0.0 cut? Updating before risks spec/release confusion. Updating after means there's a window where the normative spec doesn't cover shipped code.
   - **Recommendation:** Update AFTER v1.0.0 cut but BEFORE v1.1 tag. Create `SPEC-GOVERNED-v5.md` as a v1.1-scoped normative spec. v4 remains the v1.0.0 reference.

2. **CHANGELOG scope:** Should v1.1 CHANGELOG be a delta from v1.0.0, or a cumulative entry? Delta is cleaner for operators upgrading from v1.0.0. Cumulative is better for new adopters.
   - **Recommendation:** Delta format with a "New in v1.1" section. New adopters can read v1.0.0 + v1.1 entries sequentially.

3. **Scenario D timing:** Scenario D escalation dogfood is listed as Tier 1 in POST_V1_ROADMAP.md but requires human operator + live API. Should it be a v1.1 release gate or a parallel validation track?
   - **Recommendation:** Parallel validation track. Do not gate v1.1 on it — the code is already tested. The dogfood validates operator ergonomics, not correctness.
