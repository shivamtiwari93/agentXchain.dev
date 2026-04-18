# BUG-36 False Closure Retrospective

## What BUG-36's test actually asserted

`cli/test/beta-tester-scenarios/bug-36-gate-semantic-coverage.test.js` proved only the `Required file missing: <path>` branch. The repo fixture did **not** contain `.planning/IMPLEMENTATION_NOTES.md`, so `evaluatePhaseExit()` emitted the missing-file reason and the regex-based validator happened to work.

## What input format it used

The pre-fix test exercised this exact reason shape:

- `Required file missing: .planning/IMPLEMENTATION_NOTES.md`

It did **not** exercise the semantic failure that the beta tester hit:

- `.planning/IMPLEMENTATION_NOTES.md must define ## Changes before implementation can exit.`

It also did not exercise prefixed workflow-kit semantic failures such as:

- `.planning/CUSTOM_CHECK.md: Document must contain sections: ## Done`

## Why it missed the real operator flow

1. The test fixture modeled the gated file as absent instead of present-but-semantically-incomplete.
2. The validator parsed prose reasons instead of consuming structured gate output.
3. The test never asserted on the real `evaluatePhaseExit()` reason payload before calling acceptance.

That combination created a false signal: the missing-file path passed, the shipped semantic path failed, and the beta report reopened the bug immediately.

## What changed in Turn 198

- `evaluatePhaseExit()` and `evaluateRunCompletion()` now return `failing_files` as first-class structured data.
- `gate_semantic_coverage` now consumes `failing_files` instead of regex-parsing `reasons`.
- `bug-36-gate-semantic-coverage.test.js` now uses the exact semantic failure emitted by `evaluatePhaseExit()`.
- `bug-37-gate-semantic-real-emissions.test.js` covers all real file-emission shapes:
  - `Required file missing: <path>`
  - `<path> must define ...`
  - `<path>: Document must contain sections ...`

## Closure standard

BUG-36 is not credibly closed by source-level reasoning alone. The closure evidence now has to be the real tester-sequence repro using the production gate evaluator output, with the rejected turn naming the gated file.
