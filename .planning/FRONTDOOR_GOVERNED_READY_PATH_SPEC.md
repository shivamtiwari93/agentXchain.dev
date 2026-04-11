# Front-Door Governed-Ready Path Spec

**Status:** shipped
**Author:** GPT 5.4 — Turn 56

## Purpose

Keep the public real-repo onboarding path aligned with the shipped governed product. After the demo, front-door surfaces must route operators through mission-aware scaffold (`--goal`) and readiness proof (`doctor`) instead of teaching a weaker bare-init path or a misleading in-place re-init.

## Interface

Covered surfaces:

- `README.md`
- `cli/README.md`
- `website-v2/src/pages/index.tsx`
- `website-v2/docs/quickstart.mdx`
- `website-v2/docs/getting-started.mdx`

Guard surface:

- `cli/test/frontdoor-governed-ready-path.test.js`

## Behavior

- Public onboarding surfaces that teach a real governed repo must show `agentxchain init --governed --goal "..."` as the primary scaffold command, not bare `init --governed`.
- Public onboarding surfaces that teach a real governed repo must route operators through `agentxchain doctor` before the first governed turn.
- The homepage terminal sample must reflect the same governed-ready path rather than advertising a weaker bare-init path.
- `getting-started.mdx` must not teach a second in-place `init --governed --goal ... --dir . -y` after the repo has already been scaffolded. If the operator skipped `--goal`, the truthful follow-up is editing `project.goal` in `agentxchain.json`, not re-running scaffold.

## Error Cases

- README or homepage implies bare `init --governed` is the recommended post-demo path.
- Front-door docs mention `--goal` only as a side note while the primary code block still omits it.
- Front-door docs skip `doctor` and route operators directly from scaffold to `step`/`run`.
- `getting-started.mdx` teaches a misleading in-place goal-setting re-init flow.

## Acceptance Tests

- `AT-FDGR-001`: `README.md` and `cli/README.md` route the primary governed quick-start through `agentxchain init --governed --goal` and `agentxchain doctor`.
- `AT-FDGR-002`: `website-v2/src/pages/index.tsx` terminal sample shows `agentxchain init --governed --goal` and `agentxchain doctor`.
- `AT-FDGR-003`: `website-v2/docs/quickstart.mdx` and `website-v2/docs/getting-started.mdx` show `--goal` in the primary governed bootstrap sequence and include `agentxchain doctor`.
- `AT-FDGR-004`: `website-v2/docs/getting-started.mdx` does not instruct an in-place `init --governed --goal ... --dir . -y` rerun after scaffold.

## Open Questions

None.
