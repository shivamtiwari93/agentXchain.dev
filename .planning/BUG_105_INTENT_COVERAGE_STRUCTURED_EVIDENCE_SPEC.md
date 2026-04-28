# BUG-105 Structured Evidence Intent Coverage Spec

## Purpose

BUG-105 fixes the next dogfood blocker after BUG-104: the retained tusq.dev roadmap-replenishment PM turn passed schema and verification normalization on `agentxchain@2.155.58`, but then failed strict intent coverage even though its staged result explicitly recorded all three acceptance-contract clauses.

## Interface

- Input: normalized turn result passed to `evaluateIntentCoverage()`.
- Relevant fields: `summary`, `decisions[]`, `objections[]`, `files_changed[]`, `artifacts_created[]`, `intent_response[]`, `verification.evidence_summary`, and any remaining command-shaped `verification.machine_evidence[]`.
- Output remains unchanged: `{ addressed, unaddressed }`.

## Behavior

- Intent coverage semantic fallback must tokenize acceptance items by word characters, not raw whitespace, so punctuation such as `bounded,` and `testable,` does not make otherwise matching text invisible.
- Intent coverage must include verification summaries in its searchable corpus.
- If BUG-104 moved typed structured observations into `verification.evidence_summary`, those summaries must remain available to intent coverage.
- Remaining command-shaped `machine_evidence[]` may contribute textual command/proof details to the corpus.

## Error Cases

- Strict mode still fails when an acceptance item has insufficient textual/structural coverage.
- The fix must not accept malformed staged results; schema and verification validation still run before intent coverage.
- The fix must not synthesize missing acceptance evidence.

## Acceptance Tests

- `cli/test/beta-tester-scenarios/bug-105-intent-coverage-structured-evidence.test.js` reproduces the tusq.dev retained PM shape: roadmap-replenishment intent, strict acceptance contract, typed `acceptance_contract_check` inside `machine_evidence[]`, and no manual staging edit.
- The command-chain test must accept the turn through `agentxchain accept-turn --turn ...` after BUG-104 normalization moves structured evidence into `evidence_summary`.
- A negative command-chain test must still fail strict intent coverage when the bounded/testable/non-duplicate clause is absent from the staged result.

## Open Questions

- None. This is a framework acceptance-evidence visibility bug, not a tusq.dev product-scoping issue.
