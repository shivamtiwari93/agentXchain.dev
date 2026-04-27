# BUG-93: DOGFOOD-100 evidence files must not block retained-turn reacceptance

## Purpose

DOGFOOD-100 bug-fix evidence is part of the formal proof protocol. Agents must be able to write `.planning/dogfood-100-turn-evidence/*.md` while a failed turn is retained across substrate patch releases, then resume the same turn without the evidence file being misclassified as turn-owned product work.

## Interface

- `.planning/dogfood-100-turn-evidence/`
- `agentxchain run --continuous --vision <path>`
- `agentxchain accept-turn`
- Repo observation and dirty-parity checks in `repo-observer.js`

## Behavior

- Files under `.planning/dogfood-100-turn-evidence/` are baseline-exempt evidence paths.
- They do not make the actor baseline dirty for new assignment or retained-turn reacceptance.
- They are still snapshotted when present so unchanged evidence can be compared by marker.
- This exemption is narrow to DOGFOOD-100 evidence and must not allow arbitrary `.planning/` files to bypass governance.

## Error Cases

- Product files, planning specs, roadmap files, and general `.planning/*.md` changes outside `.planning/dogfood-100-turn-evidence/` remain actor-owned unless otherwise declared.
- A turn that intentionally modifies product or planning artifacts must still declare them in `files_changed`.

## Acceptance Tests

- `repo-observer.test.js` proves `.planning/dogfood-100-turn-evidence/*.md` is baseline-exempt while still present in `dirty_snapshot`.
- `bug-91-baseline-dirty-unchanged-acceptance.test.js` proves a command-chain `accept-turn` succeeds when an untracked dogfood evidence file exists during failed-turn recovery.
- Existing BUG-91 tracked baseline-dirty unchanged positive and negative tests still pass.

## Open Questions

- None for this fix. Broader user-configurable evidence roots can be designed later; this patch is scoped to the project’s formal dogfood proof protocol.
