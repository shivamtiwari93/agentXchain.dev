# Merge Plan — release/v2.0.1 → main

> Written: 2026-04-03T05:45:00Z
> Updated: 2026-04-03T06:20:00Z (Turn 7 — accounts for Turn 6 workflow+postflight changes and Turn 7 forward-port)
> 9 files conflict. Resolution strategies below.

---

## Forward-Ported Files (Turn 7)

The following release-branch files were forward-ported to main in Turn 7 to reduce merge surface:

| File | Status on main |
|------|---------------|
| `.github/workflows/publish-npm-on-tag.yml` | **Ported** — script-delegation + postflight |
| `cli/scripts/release-postflight.sh` | **Ported** — with retry support |
| `cli/test/release-postflight.test.js` | **Ported** |
| `cli/test/release-docs-content.test.js` | **Ported and adapted** for v2.1.0 context |
| `.planning/RELEASE_POSTFLIGHT_SPEC.md` | **Ported** |
| `.planning/GITHUB_NPM_PUBLISH_WORKFLOW_SPEC.md` | **Ported** |
| `.planning/RELEASE_BRIEF.md` | **Rewritten** for v2.1.0 (not ported — main has different release target) |
| `.planning/HUMAN_TASKS.md` | **Rewritten** for current blocker state |

These forward-ports eliminate 4 previously-conflicting files from the merge. The workflow, postflight script, and postflight spec are now identical on both branches.

## Remaining Conflict Resolution Table

| File | Strategy | Rationale |
|------|----------|-----------|
| `.planning/AGENT-TALK.md` | **manual-merge** | Both branches have unique turn entries. Append release turns after main turns chronologically. |
| `.planning/LAUNCH_BRIEF.md` | **keep-release** | Release has correct v2.0.1 version, HN deferred, corrected plugin scope. |
| `.planning/LAUNCH_EVIDENCE_REPORT.md` | **manual-merge** | Release has v2.0.1 evidence (962 tests). Main has v2.1 features (1016+ tests). Post-merge suite run determines final count. |
| `cli/src/lib/hook-runner.js` | **manual-merge (P0)** | Main added HTTP hook support (v2.1-F2). Release has rollback tamper-detection fixes. Must combine both. |
| `cli/test/hook-runner.test.js` | **manual-merge (P0)** | Main has `interpolateHeaders` tests for HTTP hooks. Release has tamper rollback tests. Must combine. |
| `cli/test/launch-evidence.test.js` | **manual-merge** | Post-merge test count replaces both assertions. Run suite first, then update assertion. |
| `run-agents.sh` | **manual-merge** | Release has Twitter support, product boundary, trusted-publish-first guidance. Main has OSS-first principle. Combine. |
| `.planning/HUMAN_TASKS.md` | **keep-main** | Main now has the accurate blocker state (rewritten in Turn 7). Release version is stale. |
| `.planning/RELEASE_BRIEF.md` | **keep-main** | Main now targets v2.1.0 (rewritten in Turn 7). Release version is for v2.0.1 corrective. |
| `cli/test/release-docs-content.test.js` | **keep-main** | Main version is adapted for v2.1.0 context. Release version hardcodes v2.0.1. |

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
- `DEC-MERGE-002`: Forward-port release infrastructure to main before merge to reduce conflict surface. The workflow, postflight script, and release ops docs are now on both branches.
