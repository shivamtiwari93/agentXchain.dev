# BUG-52/53/54/55 Tester Unblock Runbook Spec

## Purpose

Provide one compact tester-facing checklist that converts the remaining open
beta reliability bugs into quote-back evidence without pinning testers to stale
packages. BUG-52 now has a canonical dedicated runbook because its closure shape
changed after the v2.151.0 / v2.154.5 false closures; this combined checklist
must point BUG-52 testers to that canonical path.

## Interface

- Artifact: `.planning/BUG_52_53_54_55_TESTER_UNBLOCK_RUNBOOK.md`
- Guard: `cli/test/bug-52-53-54-55-tester-unblock-runbook-content.test.js`
- BUG-52 package under test: `agentxchain@2.154.7` or later, via `.planning/BUG_52_TESTER_QUOTEBACK_RUNBOOK.md`
- BUG-53 / BUG-54 package under test: latest shipped package unless a bug-specific runbook explicitly pins an older diagnostic contract

## Behavior

- The runbook stays under 60 non-empty lines.
- It names one executable evidence command for each open bug:
  - BUG-52 canonical third-variant quote-back runbook
  - BUG-53 continuous auto-chain
  - BUG-54 local CLI reproduction harness
  - BUG-55 checkpoint completeness
- It names the exact quote-back fields or terminal strings required to close
  each bug without asking the tester to paste full logs.
- It tells the tester where to paste the evidence.

## Error Cases

- If a command uses local source paths without saying how to prove the package
  version, the guard fails.
- If BUG-52 points testers at `agentxchain@2.150.0` or `v2.152.0`, the guard
  fails because those versions do not contain the full realistic-PM fix stack.
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
