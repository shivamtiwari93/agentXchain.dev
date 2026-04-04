# V2.1 Release Notes Spec — AgentXchain

> **SUPERSEDED.** This was the contract for v2.1.0 release artifacts. v2.1.0 was never published — the project shipped v2.1.1 as the first post-0.8.x npm release, then continued through v2.10.0. The release-notes draft and CHANGELOG entries described here were absorbed into later releases. Preserved for historical context.

---

## Purpose

`main` already contains the implemented `v2.1.0` surface, but before this turn it did not contain a `2.1.0` changelog entry or a usable release-notes draft. That meant the next `release-preflight.sh --target-version 2.1.0` run would fail on documentation before it ever touched packaging, and the eventual GitHub release would have to be improvised from planning prose.

This spec freezes the `v2.1.0` release-artifact contract so the next cut has:

1. a real `cli/CHANGELOG.md` delta entry
2. a publish-ready release-notes draft
3. release docs that agree on the current verified evidence count

---

## Interface

The `v2.1.0` release artifact surface consists of three repo-native documents:

1. `cli/CHANGELOG.md`
   - must contain a top-level `## 2.1.0` heading
   - must describe only the `v2.1` delta, not relitigate the full `2.0.0` surface

2. `.planning/V2_1_RELEASE_NOTES.md`
   - status: draft until `v2.0.1` is published and merged back
   - sections:
     - release theme
     - shipped highlights
     - upgrade / release notes
     - verification status
     - explicitly deferred items

3. `.planning/RELEASE_BRIEF.md`
   - must reference the release-notes draft as the canonical copy source for the eventual GitHub release
   - must use the current verified `main` evidence count

---

## Behavior

1. The `2.1.0` changelog entry is a delta entry, not a cumulative restatement of `2.0.0`.
2. The changelog and draft release notes must match the frozen `v2.1` scope:
   - V2.1-F1 dispatch manifest integrity
   - V2.1-F2 HTTP hooks plus plugin hardening
   - V2.1-F3 dashboard evidence drill-down
3. Release notes must be honest about branch state:
   - the draft is not publishable until `release/v2.0.1` is merged back into `main`
   - the current verification count on `main` is pre-merge evidence, not the final cut proof
4. Release-facing evidence counts on `main` must agree with the maintained evidence report.
5. The artifact surface must not invent `v2.2`/`v3` scope or market cloud/SaaS work as part of `.dev`.

---

## Error Cases

1. If `cli/CHANGELOG.md` lacks `## 2.1.0`, `release-preflight.sh --target-version 2.1.0` will fail before the cut. That is a release-blocking defect.
2. If the release-notes draft omits one of the three shipped `v2.1` features, the eventual GitHub release risks under-reporting shipped behavior.
3. If `RELEASE_BRIEF.md` or launch evidence docs use stale test counts, the repo's claim-governance discipline is broken.
4. If the release notes claim `v2.0.1` follow-through is already merged when it is not, the draft lies about branch state.

---

## Acceptance Tests

1. `cli/CHANGELOG.md` contains a `## 2.1.0` heading.
2. `cli/CHANGELOG.md` names all three `v2.1` shipped features.
3. `.planning/V2_1_RELEASE_NOTES.md` exists and references all three `v2.1` shipped features.
4. `.planning/V2_1_RELEASE_NOTES.md` states that `v2.0.1` publish + merge-back are preconditions to publication.
5. `.planning/RELEASE_BRIEF.md` references `.planning/V2_1_RELEASE_NOTES.md`.
6. `.planning/RELEASE_BRIEF.md` and `.planning/LAUNCH_EVIDENCE_REPORT.md` agree on the current verified main-branch count.
7. Release-facing docs avoid `v2.2`/`v3` feature claims in the `v2.1.0` release material.

---

## Open Questions

1. Once `release/v2.0.1` is merged back, should the final GitHub release notes include a short "includes 2.0.1 corrective publish-path hardening" paragraph, or should that stay implicit through the merged changelog?
