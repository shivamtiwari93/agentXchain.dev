# Merge Plan — release/v2.0.1 → main

> Written: 2026-04-03T05:45:00Z
> State: 17 commits on release not on main, 17 commits on main not on release
> 9 files conflict. Resolution strategies below.

---

## Conflict Resolution Table

| File | Strategy | Rationale |
|------|----------|-----------|
| `.github/workflows/publish-npm-on-tag.yml` | **keep-release** | Release has correct script-delegation architecture (`publish-from-tag.sh`). Main has inline bash that duplicates logic. |
| `.planning/AGENT-TALK.md` | **manual-merge** | Both branches have unique turn entries. Append release turns after main turns chronologically. |
| `.planning/HUMAN_TASKS.md` | **keep-release** | Release reflects v2.0.1 corrective state with accurate npm auth blocker. Main's tasks are stale. |
| `.planning/LAUNCH_BRIEF.md` | **keep-release** | Release has correct v2.0.1 version, HN deferred, corrected plugin scope. |
| `.planning/LAUNCH_EVIDENCE_REPORT.md` | **manual-merge** | Release has v2.0.1 evidence (960 tests). Main has v2.1 features (988 tests). Post-merge suite run determines final count. |
| `cli/src/lib/hook-runner.js` | **manual-merge (P0)** | Main added HTTP hook support (v2.1-F2). Release has rollback tamper-detection fixes. Must combine both. |
| `cli/test/hook-runner.test.js` | **manual-merge (P0)** | Main has `interpolateHeaders` tests for HTTP hooks. Release has tamper rollback tests. Must combine. |
| `cli/test/launch-evidence.test.js` | **manual-merge** | Post-merge test count replaces both assertions. Run suite first, then update assertion. |
| `run-agents.sh` | **manual-merge** | Release has Twitter support, product boundary, trusted-publish-first guidance. Main has OSS-first principle. Combine. |

## Execution Sequence

1. `git checkout main`
2. `git merge release/v2.0.1 --no-commit` (pauses at conflicts)
3. Resolve each conflict per the table above
4. Run `cd cli && node --test` — all tests must pass
5. Update `cli/test/launch-evidence.test.js` with real post-merge count
6. `git commit` with merge message explaining v2.0.1 corrective release merge-back
7. Push to main

## Pre-Conditions

- Do NOT merge until npm publish succeeds and postflight passes
- If merge is done before publish: the tag still points to the release branch commit, so npm publish is not affected
- Post-merge main test suite is the acceptance gate, not pre-merge count from either branch

## Decision

- `DEC-MERGE-001`: Merge uses explicit merge commit (no rebase). Release branch history is the audit trail for the corrective release.
