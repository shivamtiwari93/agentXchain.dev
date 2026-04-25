# Hacker News Launch Surface Alignment Spec

## Purpose

Keep the Hacker News launch materials aligned with the current public proof story before submission. The repo had two launch surfaces: `.planning/MARKETING/HN_SUBMISSION.md` and `.planning/SHOW_HN_DRAFT.md`; both must track the package version, current aggregate release evidence, current conformance corpus, and durable dogfood proof so operators do not copy stale launch prose.

## Interface

Launch editors use:

- `.planning/MARKETING/HN_SUBMISSION.md` as the canonical ready-to-post version.
- `.planning/SHOW_HN_DRAFT.md` as the editable draft mirror, not an independent stale copy.
- `.planning/dogfood-tusq-dev-evidence/DOGFOOD-EXTENDED-10-CYCLES-EVIDENCE-INDEX.md` as the durable evidence anchor.

## Behavior

- Both HN launch files must name the current launch version from `cli/package.json`.
- Both files must include the package-bound demo command: `npx --yes -p agentxchain@latest -c "agentxchain demo"`.
- Both files must include the 10-cycle tusq.dev dogfood proof: 987 lines of product code, 42 checkpoint commits, all 4 governed phases per cycle.
- Both files must include the current conformance corpus size.
- Both files must reference the durable dogfood evidence index.
- The active posting instructions must use the current homepage URL, not the historical `/launch` snapshot.
- The next launch window may be queued for Wednesday 2026-04-29, which is within the Tuesday-Thursday 10-11am ET posting window.

## Error Cases

- Stale launch text names `v2.149.1`, `v2.149.2`, or pending tester verification.
- Stale launch text advertises 172 beta tests as the current proof story.
- The draft tells operators to post on the wrong weekday for an exact date.
- The draft uses bare `npx agentxchain demo` or a mixed package-bound/bare multi-command sequence.

## Acceptance Tests

- `AT-HN-LAUNCH-001`: both HN surfaces name the current package version, the package-bound demo command, and the homepage URL.
- `AT-HN-LAUNCH-002`: both HN surfaces include 10-cycle dogfood proof stats, current conformance corpus size, and the durable evidence index path.
- `AT-HN-LAUNCH-003`: both HN surfaces reject stale beta-cycle claims (`v2.149.1`, pending tester verification, 172 tests).
- `AT-HN-LAUNCH-004`: posting notes identify Wednesday 2026-04-29 as an eligible Tuesday-Thursday launch window, not Tuesday.

## Open Questions

- Whether the HN comment should link directly to the GitHub evidence index in the first post or reserve it for the first reply. Current recommendation: include the repo path and be ready with the GitHub URL in replies.
