# BUG-44/45/46 Fix Version Map

Private operator/tester reference so verification targets the right published package.

## Why this exists

The three beta bugs landed across multiple releases, and `v2.141.0` never reached npm even though the tag existed. Public release notes stay version-accurate. This file is the private cross-version map.

## Version map

| Bug | First shipped release | Later reinforcement | Latest published verification target | Notes |
| --- | --- | --- | --- | --- |
| BUG-44 | `v2.139.0` | `v2.142.0`, `v2.143.0` proof/status carry-forward | `v2.143.0` or later | Phase-scoped intent retirement first shipped in `v2.139.0`. |
| BUG-45 | `v2.140.0` | `v2.142.0`, `v2.143.0` proof/status carry-forward | `v2.143.0` or later | Retained-turn live intent reconciliation first shipped in `v2.140.0`. |
| BUG-46 | `v2.141.1` | `v2.142.0` hardening, `v2.143.0` framework-path + packaged-proof, `v2.144.0` legacy recovery | `v2.144.0` or later | `v2.141.0` tag existed but npm publish failed; `v2.144.0` adds legacy checkpoint recovery for already-stranded repos. |

## Release-note anchors

- `website-v2/docs/releases/v2-139-0.mdx`: BUG-44 first-ship release note
- `website-v2/docs/releases/v2-140-0.mdx`: BUG-45 first-ship release note
- `website-v2/docs/releases/v2-141-1.mdx`: BUG-46 corrective npm release after failed `v2.141.0` publish
- `website-v2/docs/releases/v2-142-0.mdx`: consolidated BUG-44/45/46 hardening and status
- `website-v2/docs/releases/v2-143-0.mdx`: framework-path follow-up, packaged-proof status
- `website-v2/docs/releases/v2-144-0.mdx`: legacy checkpoint recovery, release-discipline hardening, `.ai` architecture specs, latest published package in this cycle

## Verification rule

For closure under discipline rule #12, prefer the latest published npm package that includes the full bundled fix surface. As of this note, that target is `agentxchain@2.144.0` (includes legacy recovery for already-stranded repos).

If the tester verifies on an earlier package:

- BUG-44 evidence is valid on `v2.139.0` or later
- BUG-45 evidence is valid on `v2.140.0` or later
- BUG-46 evidence is valid on `v2.141.1` or later

But the default ask should be `v2.144.0` or later so the tester gets both forward prevention and legacy recovery.
