## Framework Path Classification Spec

**Status:** shipped
**Created:** Turn 258 — GPT 5.4

### Purpose

Freeze the path-classification contract behind BUG-46 framework-write hardening so future audits stop treating observation exclusion, clean-baseline exemption, and continuity export as mutually exclusive buckets.

### Interface

- `cli/src/lib/repo-observer.js`
  - exports `classifyRepoPath(filePath)`
  - exports `isOperationalPath(filePath)`
  - exports `isBaselineExemptPath(filePath)`
  - exports `isRunContinuityPath(filePath)`

### Behavior

1. Path classification is flag-based, not mutually exclusive.
2. `operational` means the framework owns the path during dispatch/accept/runtime bookkeeping and the actor must never be blamed for it.
3. `baselineExempt` means the path may remain dirty across turns without blocking the next writing assignment.
4. `continuityState` means the path participates in governed run export/restore.
5. `projectOwned` means the path is actor-visible repo work and must remain observable.
6. Invariants:
   - every `operational` path is `baselineExempt`
   - every `continuityState` path is `baselineExempt`
   - some paths are `operational` but not `continuityState` (for example prompt scaffolds and legacy dispatch progress)
   - some paths are `continuityState` without being `operational` prefixes of current dispatch-time bookkeeping (for example review/proposed/report evidence roots)
7. The framework may add new write paths only by updating the exported constants and the classification proof surfaces together.

### Error Cases

1. A framework-owned path is excluded from observation only by accident via a broad prefix, but the contract is not asserted directly.
2. A continuity path is exported/restored but not treated as baseline-exempt, creating another accept/checkpoint/resume mismatch.
3. A future audit assumes the categories are exclusive and removes a path from one set because it already appears in another.

### Acceptance Tests

- `AT-PCLASS-001`: `classifyRepoPath()` proves overlap for continuity-state paths (`history.jsonl`) and non-continuity operational paths (`prompts/dev.md`, legacy dispatch-progress singleton).
- `AT-PCLASS-002`: project-owned paths (`README.md`) remain observable and are not baseline-exempt.
- `AT-PCLASS-003`: framework-write exclusion tests import exported constants/paths and assert their classification directly instead of relying on accidental prefix coverage.
- `AT-PCLASS-004`: recent shipped specs guard this spec against drifting back to `draft` or `proposed`.

### Open Questions

None. This spec documents the shipped classification boundary already relied on by BUG-46 hardening, export centralization, and framework-write exclusion proof.
