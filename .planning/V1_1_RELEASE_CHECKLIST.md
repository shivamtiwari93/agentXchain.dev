# V1.1 Release Checklist — AgentXchain

> Gap analysis: what must be true before a credible `1.1.0` release cut can begin.

---

## Purpose

Freeze the v1.1 release gate for the five already-implemented post-v1 capabilities:

1. parallel agent turns
2. `api_proxy` auto-retry with backoff
3. preemptive tokenization
4. Anthropic-specific provider error mapping
5. persistent blocked state

This checklist is the operational companion to `.planning/V1_1_RELEASE_SCOPE_SPEC.md`. The scope spec says what v1.1 is. This file says what must be complete before `cd cli && npm version 1.1.0` is allowed to run.

This is not an open-ended feature build list. The five graduating capabilities are already implemented in-tree and covered by the acceptance matrix below. The remaining unchecked work is release-candidate hygiene, publish-path confirmation, and human release execution.

This checklist is future-facing. Until the `1.0.0` public release is complete, the active human release surface remains `.planning/HUMAN_TASKS.md` plus `.planning/V1_RELEASE_CHECKLIST.md`.

---

## Interface/Schema

### Release Gate Shape

```ts
type V1_1ReleaseGate = {
  scope_frozen: boolean;
  schema_migration_proven: boolean;
  activation_defaults_preserved: boolean;
  acceptance_matrix_green: boolean;
  operator_docs_reconciled: boolean;
  changelog_ready: boolean;
  release_brief_ready: boolean;
  clean_release_workspace_ready: boolean;
  publish_path_ready: boolean;
  homebrew_followup_ready: boolean;
};
```

### Status Key

- `[x]` Done
- `[ ]` Not started
- `[~]` In progress / partial

### Governing Inputs

- `.planning/V1_1_RELEASE_SCOPE_SPEC.md`
- `.planning/PARALLEL_TURN_STATE_MODEL_SPEC.md`
- `.planning/PARALLEL_DISPATCH_SPEC.md`
- `.planning/PARALLEL_MERGE_ACCEPTANCE_SPEC.md`
- `.planning/PARALLEL_CONFLICT_RECOVERY_SPEC.md`
- `.planning/API_PROXY_RETRY_POLICY_SPEC.md`
- `.planning/PREEMPTIVE_TOKENIZATION_SPEC.md`
- `.planning/PROVIDER_ERROR_MAPPING_SPEC.md`
- `.planning/PERSISTENT_BLOCKED_STATE_SPEC.md`
- `.planning/RELEASE_CUT_SPEC.md`
- `.planning/V1_1_RELEASE_HANDOFF_SPEC.md`

---

## Behavior

### 0. Release Sequencing

- [x] The current repo state is treated as pre-`1.0.0`; this checklist does not replace the active `1.0.0` human release path yet
- [x] `.planning/V1_1_RELEASE_HANDOFF_SPEC.md` defines when the `1.1.0` human handoff becomes actionable
- [x] Dedicated human-operated parallel-turn dogfood is explicitly non-gating for `1.1.0`
- [x] Schema migration remains a test-suite/spec concern, not a required shell-preflight smoke check
- [x] v1.1 no longer has a known feature-implementation gap inside scope; remaining work is release hardening only

### 1. Scope Freeze

- [x] v1.1 scope is frozen to exactly five graduating capabilities in `.planning/V1_1_RELEASE_SCOPE_SPEC.md`
- [x] v1.1 preserves v1.0 sequential semantics by default: `max_concurrent_turns = 1`, retry disabled by default, preflight disabled by default
- [x] v1.1 automatic behaviors are limited to precision/visibility improvements only: Anthropic provider mapping and persistent blocked state
- [x] `schema_version` is frozen as `"1.1"` for the v1.1 release contract
- [x] `SPEC-GOVERNED-v5.md` exists as the normative v1.1 protocol reference and does not conflate v1.0 and v1.1 semantics

### 2. Feature Completeness

- [x] Parallel turns are implemented through state migration, assignment, dispatch isolation, acceptance locking, conflict recovery, and CLI targeting
- [x] `api_proxy` retry policy is implemented with config validation, bounded backoff, retry trace artifacts, and aggregated success-path cost accounting
- [x] Preemptive tokenization is implemented with local token budgeting, bounded compression, overflow short-circuit, and audit artifacts
- [x] Anthropic provider mapping is implemented with provider-first classification and HTTP fallback preservation
- [x] Persistent blocked state is implemented with top-level `blocked`, required `blocked_reason`, and in-place migration of legacy paused states

### 3. Acceptance Matrix

Each v1.1 scope acceptance test must map to at least one concrete proof surface before release:

| Scope AT | Requirement | Primary proof surface | Status |
|---|---|---|---|
| AT-1 | v1.0 config backward compatibility | `cli/test/schema.test.js`, `cli/test/e2e-governed-lifecycle.test.js`, `cli/test/e2e-governed-reject-retry.test.js` | [x] |
| AT-2 | `1.0` → `1.1` state migration | `cli/test/schema.test.js`, `cli/test/governed-state.test.js` | [x] |
| AT-3 | Parallel happy path | `cli/test/e2e-parallel-lifecycle.test.js`, `cli/test/e2e-parallel-cli.test.js` | [x] |
| AT-4 | Parallel conflict detection | `cli/test/governed-state.test.js`, `cli/test/e2e-parallel-cli.test.js` | [x] |
| AT-5 | Retry activation | `cli/test/api-proxy-adapter.test.js`, `cli/test/normalized-config.test.js` | [x] |
| AT-6 | Retry exhaustion blocks the run | `cli/test/api-proxy-adapter.test.js`, `cli/test/operator-recovery.test.js`, `cli/test/step-command.test.js` | [x] |
| AT-7 | Preflight overflow short-circuits locally | `cli/test/token-budget.test.js`, `cli/test/api-proxy-adapter.test.js`, `.planning/LIVE_API_PROXY_PREFLIGHT_REPORT.md` | [x] |
| AT-8 | Anthropic error mapping precision | `cli/test/api-proxy-adapter.test.js` | [x] |
| AT-9 | Blocked-state visibility | `cli/test/operator-recovery.test.js`, `cli/test/gate-evaluator.test.js`, `cli/test/run-completion.test.js` | [x] |
| AT-10 | Forward-compatibility guard rejects unknown schema | `cli/test/schema.test.js` | [x] |

### 4. Documentation And Operator Surface

- [x] `SPEC-GOVERNED-v5.md` is written and references the `"1.1"` state model, including `active_turns` and `blocked`
- [x] `.planning/CLI_SPEC.md` is updated for parallel turn targeting, blocked-state rendering, and v1.1-only flags/behaviors
- [x] `README.md` includes a v1.1 upgrade path from sequential v1.0 projects, including config defaults and migration expectations
- [x] `cli/CHANGELOG.md` has a `1.1.0` delta entry that clearly separates new opt-in features from automatic precision improvements
- [x] `.planning/RELEASE_BRIEF.md` is updated for the v1.1 release cut and points to this checklist instead of the v1.0-only release state

### 5. Release Infrastructure

- [ ] A clean release-candidate workspace is prepared before the cut
- [ ] `cd cli && npm test` is rerun on the clean release-candidate workspace and recorded as the v1.1 release baseline
- [x] The release preflight path is reviewed for v1.1 wording and remains correct for the `1.1.0` cut (`RELEASE_PREFLIGHT_VNEXT_SPEC.md`, `cli/scripts/release-preflight.sh`)
- [ ] `cd cli && npm version 1.1.0` is ready to be the canonical version-bump, commit, and tag step
- [ ] The publish step is defined as `git push origin v1.1.0`, which triggers `.github/workflows/publish-npm-on-tag.yml` and `scripts/publish-from-tag.sh` after strict preflight
- [ ] The Homebrew tap update path for the published `1.1.0` tarball URL and SHA256 is documented

### 6. Human-Gated Release Work

- [ ] Human release operator is prepared to run the clean-tree version bump, publish, and registry verification steps
- [ ] Human Homebrew maintainer step is prepared for the post-publish formula update

### 7. Non-Gating Validation Track

- [x] Scenario D live escalation dogfood remains tracked as post-v1 human validation and is explicitly NOT a hard v1.1 release gate

---

## Error Cases

1. **Spec drift at release time:** If `SPEC-GOVERNED-v5.md`, `CLI_SPEC.md`, or `README.md` still describe v1.0-only state or commands, do not cut `1.1.0`.
2. **False compatibility claim:** If AT-1 is not demonstrably green, do not claim that v1.0 configs run unchanged under v1.1.
3. **Migration ambiguity:** If any doc or validator permits `"1.1"` state with legacy `current_turn`, the migration contract is not frozen enough for release.
4. **Operator ambiguity:** If `CHANGELOG.md` does not distinguish opt-in features from automatic behavior improvements, upgrade risk remains too high.
5. **Premature gating on Scenario D:** Scenario D is useful evidence, but treating it as a hard release gate would incorrectly block v1.1 on human scheduling rather than product correctness.

---

## Acceptance Tests

1. A reviewer can audit this file and identify exactly which artifacts prove AT-1 through AT-10 from `.planning/V1_1_RELEASE_SCOPE_SPEC.md`.
2. Every v1.1 feature in the scope spec appears in this checklist with a concrete completion state.
3. The checklist distinguishes autonomous release-readiness work from human-only release-day work.
4. The checklist requires `SPEC-GOVERNED-v5.md`, `CLI_SPEC.md`, `README.md`, `CHANGELOG.md`, and `RELEASE_BRIEF.md` reconciliation before `npm version 1.1.0`.
5. The checklist explicitly records Scenario D as a non-gating validation track rather than a mandatory v1.1 gate.
6. The checklist preserves the canonical governed release sequence: clean workspace, test baseline, version bump, strict preflight, tag push, workflow publish, Homebrew update.

---

## Open Questions

None for this slice. The preflight reuse contract is frozen by `RELEASE_PREFLIGHT_VNEXT_SPEC.md`.
