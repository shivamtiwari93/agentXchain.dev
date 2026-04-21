# BUG-52/53/54/55 Tester Unblock Runbook Spec

## Purpose

Provide one compact tester-facing checklist that converts the four remaining
open beta reliability bugs into quote-back evidence on `agentxchain@2.150.0`.
The existing roadmap entries contain the closure contracts, but they are spread
across long bug narratives. This runbook is the operator bridge.

## Interface

- Artifact: `.planning/BUG_52_53_54_55_TESTER_UNBLOCK_RUNBOOK.md`
- Guard: `cli/test/bug-52-53-54-55-tester-unblock-runbook-content.test.js`
- Package under test: `agentxchain@2.150.0`

## Behavior

- The runbook stays under 60 non-empty lines.
- It names one executable evidence command for each open bug:
  - BUG-52 phase-gate unblock chain
  - BUG-53 continuous auto-chain
  - BUG-54 local CLI reproduction harness
  - BUG-55 checkpoint completeness
- It names the exact quote-back fields or terminal strings required to close
  each bug without asking the tester to paste full logs.
- It tells the tester where to paste the evidence.

## Error Cases

- If a command uses local source paths without saying how to prove the package
  version, the guard fails.
- If BUG-54 omits the discriminator JSON fields, the guard fails.
- If BUG-52 omits both planning and QA gate lanes, the guard fails.
- If BUG-55 omits `git status --short`, the guard fails.

## Acceptance Tests

- `node --test cli/test/bug-52-53-54-55-tester-unblock-runbook-content.test.js`
  passes.
- The guard verifies line count, package version, four commands, quote fields,
  and paste target.

## Open Questions

- None. This is an evidence collection surface, not a new product behavior.
