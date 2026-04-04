# Quickstart Docs Page Spec

> Contract for the first public docs page at `/docs/quickstart`.

---

## Purpose

Give a new operator a credible path from zero to a completed governed run without hiding the real mechanics. The page must explain the actual turn-result handoff, gate approvals, and adapter behavior instead of pretending `step` alone ships software.

## Interface

### Route

```text
/docs/quickstart
```

### Files

```text
website-v2/docs/quickstart.mdx
website-v2/sidebars.ts
```

### Audience

- Engineers arriving from the landing page
- HN / GitHub readers evaluating whether the governed workflow is real
- Operators who need the minimum viable command path before reading the full spec

## Behavior

### 1. Install and prerequisites

The page must state:

- Node.js requirement
- `npx` and global install options
- the reproducible non-interactive scaffold path: `init --governed -y`
- git repository requirement
- the default runtime mix created by `init --governed -y`: manual PM, local CLI dev, api_proxy QA
- that `run` requires every active role to use a non-`manual` runtime
- the automation prerequisites for the shipped default mix: a working local coding CLI for `local-dev`, plus the API key for review-only `api_proxy` roles when used

### 2. Governed scaffold overview

The page must show the real governed scaffold:

- `agentxchain.json`
- `.agentxchain/state.json`
- `.agentxchain/history.jsonl`
- `.agentxchain/decision-ledger.jsonl`
- `.agentxchain/dispatch/turns/<turn_id>/`
- `.agentxchain/staging/<turn_id>/turn-result.json`
- `.planning/*`
- `TALK.md`

### 3. Automated-first walkthrough

The page must walk through:

1. `npx agentxchain init --governed`
2. showing that the default scaffold is mixed-mode and not immediately runnable via `agentxchain run`
3. changing `pm` from `manual-pm` to a non-manual runtime, or explicitly telling the operator to keep the manual path instead
4. calling `agentxchain run`
5. documenting `--auto-approve` for non-interactive execution
6. documenting `--max-turns` as a safety cap
7. calling `agentxchain status` after the run

### 4. Manual fallback walkthrough

The page must also walk through the truthful manual path for the shipped default scaffold:

1. `agentxchain step --role pm`
2. opening the generated dispatch bundle
3. filling the staged `turn-result.json`
4. showing a minimal turn-result JSON excerpt and telling readers to copy the exact template from the dispatch bundle
5. optional `agentxchain validate --mode turn`
6. `agentxchain accept-turn`
7. `agentxchain approve-transition`
8. dev turn
9. QA turn
10. `agentxchain approve-completion`

### 5. Truthful adapter framing

The page must explicitly distinguish:

- `manual`: operator completes the turn and stages the result
- `local_cli`: AgentXchain dispatches to a local coding agent
- `api_proxy`: AgentXchain calls a provider API directly
- `run`: only works when the run does not need a `manual` role
- `step`: remains the truthful fallback for mixed-mode or human-driven workflows

### 6. Escape hatches

The page must include a short troubleshooting section covering:

- why `run` stops immediately when a role is still bound to `manual`
- missing staged result
- blocked/pending approval state
- when to use `status`

## Error Cases

| Condition | Required docs behavior |
|---|---|
| User expects one command to finish a whole run | State that governed mode is staged and gate-driven. |
| User does not know where turn artifacts live | Show dispatch and staging paths explicitly. |
| User does not understand why `run` will not start on the default scaffold | Explain that `pm` defaults to `manual-pm`, so the operator must either rebind that role or use `step`. |
| User does not understand why `step` stops | Explain that adapters and approvals determine the next action. |
| User confuses governed mode with legacy lock-based mode | Keep examples on governed commands only. |

## Acceptance Tests

1. `/docs/quickstart` is sourced from `website-v2/docs/quickstart.mdx`.
2. The page links from the landing page nav or CTA.
3. The page includes the real dispatch and staging paths for governed turns.
4. The page documents `agentxchain run` as the primary automated workflow.
5. The page documents `agentxchain step --role pm` as the manual fallback for the shipped default scaffold.
6. The page explicitly states that the default scaffold is mixed-mode (`manual-pm`, `local-dev`, `api-qa`) and that `run` needs non-manual runtimes for active roles.
7. The walkthrough includes both `accept-turn` and human approval commands.
8. The page does not mention legacy-first artifacts such as `PROJECT.md`, `REQUIREMENTS.md`, or `qa/`.

## Open Questions

1. Should the next docs page after quickstart be `/docs/cli` or `/docs/adapters`?
2. Should we add copy-paste JSON examples for `turn-result.json`, or keep quickstart focused on the command flow and artifact locations?
