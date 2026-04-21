# QA Acceptance Gate Contract

## Purpose

Make the QA completion gate depend on real acceptance evidence instead of the mere presence of `.planning/acceptance-matrix.md`.

## Interface

- File under contract: `.planning/acceptance-matrix.md`
- Evaluator entrypoint: `evaluateWorkflowGateSemantics(root, '.planning/acceptance-matrix.md')`
- Consuming gates:
  - `qa_ship_verdict` phase exit
  - final run completion when the current phase gate requires `.planning/acceptance-matrix.md`

## Behavior

The acceptance matrix passes gate semantics only when all of the following are true:

1. The file contains the governed requirement table header with a `Status` column.
2. The table contains at least one real requirement row after the header.
3. Placeholder scaffold rows such as `(QA fills this from ROADMAP.md)` do not count as real requirement rows.
4. Every real requirement row has an affirmative final `Status` value.
5. Accepted affirmative status tokens are `PASS`, `PASSED`, `OK`, and `YES` (case-insensitive).

If any real requirement row is still `pending`, `fail`, blank, or any other non-affirmative value, the gate fails closed.

For BUG-59 full-auto semantics, QA gate evidence enters auto-approval through the existing gate predicates, not through bespoke policy predicates. A `qa_ship_verdict` gate that may close by `approval_policy` must set both `requires_human_approval: true` and `requires_verification_pass: true`; the acceptance matrix then proves "all ACs pass" while the turn verification proves smoke/test execution succeeded. `approval_policy` may remove the human pause only after those predicates pass and only when the gate is not credentialed.

## Error Cases

- Missing table header: fail with a reason that the requirement table header is missing.
- Header exists but there are no real requirement rows: fail with a reason that QA has not recorded any requirement verdicts.
- One or more rows are non-affirmative: fail with a reason naming the affected requirement ids and statuses.
- Extra non-table sections such as `## Template Guidance` are ignored after table parsing and do not satisfy the gate.

## Acceptance Tests

- AT-QA-GATE-001: placeholder scaffold matrix fails the QA gate.
- AT-QA-GATE-002: matrix with one `Pending` requirement fails the QA gate and names the failing row.
- AT-QA-GATE-003: matrix with all requirement rows in `pass` status satisfies the QA gate.
- AT-QA-GATE-004: final run completion reuses the same matrix semantics instead of checking file presence only.
- AT-QA-GATE-005: docs distinguish scaffold proof from gate-ready acceptance proof.
- AT-QA-GATE-006: a full-auto QA ship gate requires both a passing acceptance matrix and `verification.status` of `pass` or `attested_pass` before policy can auto-approve it.

## Open Questions

- None for this slice. Destructive matrix rewrites or automatic table generation are explicitly out of scope.
