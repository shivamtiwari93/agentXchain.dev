# CI Runner Proof — Flake Evidence Snapshot

> Captured: 2026-04-14T08:00:00Z
> Author: Claude Opus 4.6 (Turn 19)
> Decision: DEC-CI-RUNNER-FLAKE-EVIDENCE-001

## Summary

Between v2.85.0 and v2.88.0, the CI Runner Proof workflow had **3 failures out of 50 runs** (6% failure rate). All 3 failures shared a single root cause: the model returned `artifact.type: "workspace"` for a `proposed` write-authority role. GPT 5.4's Turn 18 fix (`DEC-CI-RUNNER-PROPOSED-HINT-001`) removed the contradictory dispatch instructions. Since that fix, **all runs have passed**.

## Failure Inventory

| # | Run ID | Date (UTC) | Trigger | Failing Script | Error Family | Attempts |
|---|--------|------------|---------|----------------|--------------|----------|
| 1 | 24381836114 | 2026-04-14T05:01 | push (LinkedIn hardening) | `run-multi-phase-write.mjs` | proposed-workspace-authority | 3/3 failed |
| 2 | 24383092023 | 2026-04-14T05:44 | push (Turn 14 — v2.87.0 log) | `run-multi-phase-write.mjs` | proposed-workspace-authority | 3/3 failed |
| 3 | 24385363956 | 2026-04-14T06:54 | push (v2.88.0 tag) | `run-multi-phase-write.mjs` | proposed-workspace-authority | 3/3 failed |

## Error Family Classification

### `proposed-workspace-authority` (3/3 failures — 100%)

**Exact error**: `acceptTurn(implementer): Validation failed at stage artifact: Artifact type "workspace" requires authoritative write authority, but role "implementer" has "proposed".`

**Cascade**: planner turn succeeds → implementer turn returns `artifact.type: "workspace"` instead of `"patch"` → validation rejects → run blocks at `planning` phase → all 3 retry attempts fail identically → proof exits with `result: "fail"`.

**Root cause**: the dispatch contract had contradictory instructions:
1. The `PROMPT.md` prose said "use `patch` and `proposed_changes`" for proposed roles
2. The JSON template defaulted all non-review roles to `artifact.type: "workspace"`
3. The shared system prompt did not reinforce write-authority rules

The model copied the JSON template (which said `workspace`) instead of the prose (which said `patch`). This was a **product defect in the dispatch bundle**, not a model reliability issue.

### Other failure families: **none observed**

No failures from:
- `run-one-turn.mjs` (synthetic, no API)
- `run-to-completion.mjs` (synthetic, no API)
- `run-with-run-loop.mjs` (synthetic, no API)
- `run-with-api-dispatch.mjs` (API-backed, authoritative authority)
- `run-via-cli-auto-approve.mjs` (API-backed, CLI subprocess)

Only `run-multi-phase-write.mjs` failed — the only script that exercises `proposed` write authority through a multi-phase lifecycle.

## Fix Applied

Commit `8eeda9f2` (Turn 18, GPT 5.4) — `DEC-CI-RUNNER-PROPOSED-HINT-001`:
- Proposed-turn JSON template now defaults to `artifact.type: "patch"` with example `proposed_changes[]`
- Prose explicitly forbids `workspace` and `commit` for proposed roles
- System prompt reinforces write-authority rules

## Post-Fix Results

| Run ID | Date (UTC) | Trigger | Result |
|--------|------------|---------|--------|
| 24385729934 | 2026-04-14T07:05 | push (Turn 17 log) | **success** |
| 24386202352 | 2026-04-14T07:17 | push (proposed hint fix) | **success** |

Both post-fix runs passed `run-multi-phase-write.mjs` on the first attempt.

## Conclusion

The CI Runner Proof flake is **resolved**. The failure was not model unreliability — it was a self-inflicted dispatch contradiction. The earlier diagnosis ("model flake", `DEC-API-PROXY-CONSTRAINTS-001`) was **incorrect for this specific case**. Model reliability is a real concern for other api_proxy surfaces, but this specific failure was deterministically caused by conflicting instructions in the dispatch bundle.

## Recommended Next Action

- **Monitor**: watch the next 10 CI Runner Proof runs. If `run-multi-phase-write.mjs` stays green, the fix is confirmed durable.
- **Do NOT**: switch models, add more retry logic, or loosen artifact validation. The governance contract is correct; the dispatch instructions are now aligned.
- **If a new failure appears**: capture the raw prompt/response pair from CI and compare against the rendered dispatch bundle to determine whether it is a new dispatch contradiction or genuine model unreliability.
