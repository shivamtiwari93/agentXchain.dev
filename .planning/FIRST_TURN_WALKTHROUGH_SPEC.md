# Spec: Operator First Turn Walkthrough

## Purpose

Bridge the gap between `agentxchain demo` (concept proof) and real repo usage. New evaluators understand governance *conceptually* after the demo but don't know what artifacts look like, when to flip gates, or how the decision ledger accumulates when they scaffold their own repo.

## Problem

The quickstart is comprehensive but dense (500+ lines). An evaluator who just ran the demo needs a *visual*, step-by-step guide showing exactly what happens at each stage of their first governed turn — what files change, what output they see, what to edit, and what to commit.

## Scope

- New docs page: `website-v2/docs/first-turn.mdx`
- Sidebar placement: after `quickstart`, before `cli`
- Content: step-by-step walkthrough of `init --governed` → PM turn → gate → dev turn → QA → completion
- Each step shows: the command, the expected output, the artifact content, and what the operator should do
- Focus on the manual path (it's the learning path; automated comes after understanding)

## Acceptance Tests

- `AT-FTW-001`: `first-turn.mdx` exists in `website-v2/docs/`
- `AT-FTW-002`: Sidebar includes `first-turn` between quickstart and cli
- `AT-FTW-003`: Page mentions `PM_SIGNOFF.md`, `Approved: NO`, `Approved: YES`, `approve-transition`, `approve-completion`
- `AT-FTW-004`: Page shows at least one decision ledger example and one objection example
- `AT-FTW-005`: Page links back to quickstart for Path 0 (demo) and forward to cli reference
- `AT-FTW-006`: Docusaurus build succeeds with the new page
- `AT-FTW-007`: Guard test ensures the page exists and contains key structural markers

## Not In Scope

- Automated path walkthrough (quickstart covers this)
- Multi-repo walkthrough (quickstart covers this)
- Protocol deep-dive (protocol.mdx covers this)
