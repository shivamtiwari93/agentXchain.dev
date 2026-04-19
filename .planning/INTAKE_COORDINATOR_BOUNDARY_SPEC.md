# Intake Coordinator Boundary Spec

> Last updated: 2026-04-06 (Turn 20, GPT 5.4)

---

## Purpose

Make the intake workspace boundary explicit and enforceable. The shipped `agentxchain intake` surface is repo-local. It operates inside governed project roots and is not a coordinator-root orchestration command family.

Without an explicit boundary, operators standing in a coordinator workspace only see a generic missing-project error and have to guess whether intake is unsupported, misconfigured, or secretly supposed to work cross-repo. That ambiguity is bad product design and bad future-integration hygiene.

## Interface

- Command family: `agentxchain intake <subcommand>`
- Affected commands:
  - `record`
  - `triage`
  - `approve`
  - `plan`
  - `start`
  - `resolve`
  - `scan`
  - `status`
- Coordinator marker: `agentxchain-multi.json`
- Governed project marker: `agentxchain.json`
- Shared command helper: `cli/src/commands/intake-workspace.js`
- Public docs:
  - `website-v2/docs/continuous-delivery-intake.mdx`
  - `website-v2/docs/cli.mdx`

## Behavior

1. Intake commands resolve workspace type before any command-specific validation.
2. If the current directory resolves to a governed project, intake proceeds normally.
3. If no governed project is found but the current directory or one of its parents is a coordinator workspace rooted by `agentxchain-multi.json`, intake must fail with an explicit coordinator-boundary error.
4. The coordinator-boundary error must tell operators what to do next:
   - run intake inside a child governed repo
   - use `agentxchain multi step` for coordinator-level orchestration
5. Governed-project detection takes priority over coordinator-workspace detection when both config files exist in the same directory.
6. This slice does not implement intake-to-coordinator handoff. It only makes the current shipped boundary truthful and operator-legible.

## Error Cases

- Do not return the generic `agentxchain.json not found` message from a coordinator workspace root. That hides the real reason for failure.
- Do not block intake inside a directory that is both a governed project and a coordinator workspace. Governed-project semantics win there.
- Do not imply that `intake` can start or coordinate a multi-repo initiative from the coordinator root. That work is unshipped.

## Acceptance Tests

- [x] AT-INTAKE-BOUNDARY-001: all eight intake subcommands fail with exit code `2` when invoked from a coordinator workspace root without a governed project
- [x] AT-INTAKE-BOUNDARY-002: the coordinator-boundary error mentions repo-local intake, `agentxchain-multi.json`, and `agentxchain multi step`
- [x] AT-INTAKE-BOUNDARY-003: coordinator workspace detection works from nested directories under the coordinator root
- [x] AT-INTAKE-BOUNDARY-004: a directory containing both `agentxchain.json` and `agentxchain-multi.json` still allows intake commands to run as a governed project
- [x] AT-INTAKE-BOUNDARY-005: public intake docs describe the coordinator-workspace boundary and the child-repo workflow

## Open Questions

None. A future intake-to-coordinator bridge needs a separate spec. This slice only makes the current boundary explicit.
