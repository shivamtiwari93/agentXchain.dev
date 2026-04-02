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
website/docs/quickstart.html
website/docs.css
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
- the default QA runtime prerequisite: `ANTHROPIC_API_KEY`, or an explicit instruction to switch QA to `manual`
- manual-first expectation for the first governed run

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

### 3. Actual lifecycle walkthrough

The page must walk through:

1. `npx agentxchain init --governed`
2. `agentxchain status`
3. `agentxchain step --role pm`
4. opening the generated dispatch bundle
5. filling the staged `turn-result.json`
6. showing a minimal turn-result JSON excerpt and telling readers to copy the exact template from the dispatch bundle
6. optional `agentxchain validate --mode turn`
7. `agentxchain accept-turn`
8. `agentxchain approve-transition`
9. dev turn
10. QA turn
11. `agentxchain approve-completion`

### 4. Truthful adapter framing

The page must explicitly distinguish:

- `manual`: operator completes the turn and stages the result
- `local_cli`: AgentXchain dispatches to a local coding agent
- `api_proxy`: AgentXchain calls a provider API directly

### 5. Escape hatches

The page must include a short troubleshooting section covering:

- missing staged result
- blocked/pending approval state
- when to use `status`

## Error Cases

| Condition | Required docs behavior |
|---|---|
| User expects one command to finish a whole run | State that governed mode is staged and gate-driven. |
| User does not know where turn artifacts live | Show dispatch and staging paths explicitly. |
| User does not understand why `step` stops | Explain that adapters and approvals determine the next action. |
| User confuses governed mode with legacy lock-based mode | Keep examples on governed commands only. |

## Acceptance Tests

1. `/docs/quickstart` exists as static HTML under `website/docs/quickstart.html`.
2. The page links from the landing page nav or CTA.
3. The page includes the real dispatch and staging paths for governed turns.
4. The walkthrough includes both `accept-turn` and human approval commands.
5. The page explains that the default scaffold creates a subdirectory and that operators must `cd` into it before running governed commands.
6. The page explains the default QA provider dependency or shows how to switch to a provider-free manual QA path.
7. The page does not mention legacy-first artifacts such as `PROJECT.md`, `REQUIREMENTS.md`, or `qa/`.
8. The page uses the shared docs stylesheet instead of page-local styles only.

## Open Questions

1. Should the next docs page after quickstart be `/docs/cli` or `/docs/adapters`?
2. Should we add copy-paste JSON examples for `turn-result.json`, or keep quickstart focused on the command flow and artifact locations?
